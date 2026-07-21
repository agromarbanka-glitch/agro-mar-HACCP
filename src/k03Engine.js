/**
 * K03 – identyfikacja partii produktu (WZ ↔ PZ wg FIFO).
 * Jeden formularz = jedna pozycja WZ (operacja + produkt).
 */

import { getK03PrefixRules, syncK03LotSequences, allocateK03LotNoRpc } from './appSettingsEngine'

export const K03_ENGINE_VERSION = '4.0'

const PRODUCT_CODES = new Map([
  ['malina pulpa', 'Mp'], ['porzeczka czarna', 'Pcz'], ['porzeczka czarna pulpa', 'Pczp'],
  ['porzeczka kolorowa', 'Pk'], ['porzeczka kolorowa pulpa', 'Pkp'],
  ['porzeczka czerwona', 'Pk'], ['porzeczka czerwona pulpa', 'Pkp'],
  ['pcz', 'Pcz'], ['pczp', 'Pczp'], ['pk', 'Pk'], ['pkp', 'Pkp'],
  ['truskawka', 'T'], ['truskawka z szypulka', 'Tsz'], ['aronia', 'A'], ['sliwka', 'S'], ['wisnia', 'W'],
  ['malina klasa i', 'M1'], ['malina extra', 'Mex'], ['malina pw', 'Mpw'],
  ['jablko obierka', 'Jabobier'], ['jablko na obierke', 'Jabobier'], ['jablko przemyslowe', 'Jab'], ['jablko', 'Jab']
])

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]))
}

function isAgromarName(value) {
  return /agro[-\s]?mar|mariusz\s+ba[nń]ka/i.test(String(value || ''))
}

export function inferProductCode(productName, product) {
  if (product?.code) return product.code
  const key = normalizeText(productName)
  if (PRODUCT_CODES.has(key)) return PRODUCT_CODES.get(key)
  const variantKey = normalizeFifoProductKey(productName, product)
  if (variantKey === 'malina pw') return 'Mpw'
  if (variantKey === 'malina klasa i') return 'M1'
  if (variantKey === 'malina extra') return 'Mex'
  if (variantKey === 'malina pulpa') return 'Mpulpa'
  const text = String(productName || 'Produkt')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-zA-Z0-9]/g, '')
  return (text.slice(0, 8) || 'X')
}

/** Numer partii wyrobu K03 – zależy od owocu i trybu przerób / bez przerobu (reguły z Ustawień). */
export function inferK03LotCode(productName, product, options = {}) {
  const mode = options.mode || 'bez_przerobu'
  const rules = options.prefixRules || null
  const variantKey = normalizeFifoProductKey(productName, product)
  const isMalina = /^malina/.test(variantKey)
  const isPorzeczkaCzarna = variantKey === 'porzeczka czarna' || variantKey.startsWith('porzeczka czarna')
  const isPorzeczkaKolorowa = variantKey === 'porzeczka kolorowa' || variantKey === 'porzeczka czerwona'
    || variantKey.startsWith('porzeczka kolorowa') || variantKey.startsWith('porzeczka czerwona')

  const r = rules || {}

  if (isPorzeczkaCzarna) {
    return mode === 'przerob' ? (r.porzeczka_czarna_przerob || 'Pczp') : (r.porzeczka_czarna_bez_przerobu || 'Pcz')
  }
  if (isPorzeczkaKolorowa) {
    return mode === 'przerob' ? (r.porzeczka_kolorowa_przerob || 'Pkp') : (r.porzeczka_kolorowa_bez_przerobu || 'Pk')
  }
  if (mode === 'przerob' && isMalina) return r.malina_przerob || 'Mp'
  if (variantKey === 'malina pw' || variantKey === 'malina swieza') return r.malina_pw || 'Mpw'
  if (variantKey === 'malina klasa i') return r.malina_klasa_i || 'M1'
  if (variantKey === 'malina extra') return r.malina_extra || 'Mex'
  if (variantKey === 'malina pulpa') return r.malina_pulpa || 'Mp'

  const defaults = r.defaults || {}
  const nameKey = normalizeText(productName)
  if (defaults[nameKey]) return defaults[nameKey]
  return inferProductCode(productName, product)
}

/** Rok w numerze partii K03 (ISO lub dd.mm.rrrr). */
export function k03LotReferenceYear(referenceDate) {
  const raw = String(referenceDate || '').trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 4)
  const pl = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (pl) return pl[3]
  const yearMatch = raw.match(/(\d{4})/)
  if (yearMatch) return yearMatch[1]
  return String(new Date().getFullYear())
}

/** Kolejny numer sekwencji partii gotowej – osobno dla każdego kodu (Pcz ≠ Pczp) i roku. */
export function nextK03LotSequence(existingForms, code, year, _productIdIgnored, _productNameIgnored) {
  const codeLower = String(code || '').toLowerCase()
  let maxSeq = 0
  for (const f of existingForms || []) {
    const lot = String(f.lot_no || f.data?.k03_workflow?.lot_no || '').trim()
    const m = lot.match(/^([A-Za-z]{1,8})\/(\d{1,5})\/(\d{2,4})$/)
    if (!m) continue
    if (m[1].toLowerCase() !== codeLower) continue
    const lotYear = m[3].length === 2 ? `20${m[3]}` : m[3]
    if (lotYear !== String(year)) continue
    maxSeq = Math.max(maxSeq, Number(m[2]) || 0)
  }
  return maxSeq + 1
}

export function formatK03LotNo(code, seq, year) {
  return `${code}/${String(seq).padStart(3, '0')}/${year}`
}

function preservedK03LotNo(form) {
  return String(form?.lot_no || form?.data?.k03_workflow?.lot_no || '').trim()
}

export function isInternalLotNumber(value = '') {
  const text = String(value || '').trim().toUpperCase()
  if (!text) return false
  if (/^PZ[\s./-]/.test(text) || text.startsWith('WZ') || text.startsWith('FV') || text.startsWith('FS')) return false
  return /^[A-Z]{1,8}\/\d{1,5}\/\d{2,4}$/.test(text)
}

/** Numer dokumentu PZ źródłowego — nigdy wewnętrzny numer partii (np. T/738/2026). */
export function resolveFifoSourcePzNo(lot, opMap) {
  const docNo = String(opMap?.get?.(lot?.source_operation_id)?.document_no || '').trim()
  if (!docNo || isInternalLotNumber(docNo)) return ''
  return docNo
}

/** Nr PZ do kolumny K03 – nigdy wewnętrzny numer partii magazynowej (T/885/202). */
export function resolveK03PzNoFromRow(row) {
  if (row?.isShortage) return String(row?.pz_no || '').trim()

  const direct = String(row?.pz_no || '').trim()
  if (direct && !isInternalLotNumber(direct)) {
    const formatted = formatK03PzNo({ pz_no: direct })
    if (formatted) return formatted
  }

  for (const field of [row?.supplier, row?.pz_no_display]) {
    const formatted = formatK03PzNo({ pz_no: field })
    if (formatted) return formatted
  }

  return ''
}

/** Czy wiersze K03 wymagają uzupełnienia numerów PZ z bazy. */
export function formNeedsPzRepair(form) {
  return (form?.data?.rawRows || []).some(r =>
    !r.isShortage && Number(r.qty || 0) > 0 && !resolveK03PzNoFromRow(r)
  )
}

/** Uzupełnia brakujące numery PZ w wierszach K03 na podstawie partii magazynowych. */
export async function repairPzRowsFromLots(client, rows, saleContext = null) {
  if (!client || !rows?.length) return rows || []

  const needsRepair = rows.some(r =>
    !r.isShortage && Number(r.qty || 0) > 0 && !resolveK03PzNoFromRow(r)
  )
  if (!needsRepair) return rows

  let lotMap = new Map()
  let opMap = new Map()

  async function loadLotsAndOps(lotIds) {
    const ids = [...new Set((lotIds || []).filter(Boolean))].filter(id => !lotMap.has(id))
    if (!ids.length) return
    const lots = await fetchInChunks(client, 'lots', 'id, lot_no, production_date, source_operation_id', 'id', ids)
    for (const l of lots) lotMap.set(l.id, l)
    const opIds = [...new Set(lots.map(l => l.source_operation_id).filter(Boolean))].filter(id => !opMap.has(id))
    if (!opIds.length) return
    const ops = await fetchInChunks(client, 'operations', 'id, operation_date, document_no', 'id', opIds)
    for (const o of ops) opMap.set(o.id, o)
  }

  function enrichRow(r, lot) {
    const pzOp = opMap.get(lot.source_operation_id) || {}
    const fullDoc = String(pzOp.document_no || '').trim()
    const pzNo = resolveFifoSourcePzNo(lot, opMap) || (fullDoc && !isInternalLotNumber(fullDoc) ? fullDoc : '')
    if (!pzNo) return r
    const pzDate = String(pzOp.operation_date || lot.production_date || r.pz_date || '').slice(0, 10)
    const supplier = formatK03Dostawca({ pz_no: pzNo }) || pzNo
    return {
      ...r,
      pz_no: pzNo,
      pz_no_display: pzNo,
      supplier: supplier || pzNo,
      pz_date: pzDate || r.pz_date,
      source_lot_id: r.source_lot_id || lot.id,
      source_lot_no: r.source_lot_no || lot.lot_no || ''
    }
  }

  const initialLotIds = rows.filter(r => r.source_lot_id && !r.isShortage).map(r => r.source_lot_id)
  await loadLotsAndOps(initialLotIds)

  let out = rows.map(r => {
    if (r.isShortage || resolveK03PzNoFromRow(r)) return r
    if (!r.source_lot_id) return r
    return enrichRow(r, lotMap.get(r.source_lot_id) || {})
  })

  const stillEmpty = out.filter(r => !r.isShortage && Number(r.qty || 0) > 0 && !resolveK03PzNoFromRow(r))
  if (stillEmpty.length && saleContext?.operation_id) {
    let allocQuery = client
      .from('fifo_allocations')
      .select('source_lot_id, qty')
      .eq('operation_id', saleContext.operation_id)
    if (saleContext.product_id) allocQuery = allocQuery.eq('product_id', saleContext.product_id)
    const { data: allocs, error } = await allocQuery
    if (!error && allocs?.length) {
      await loadLotsAndOps(allocs.map(a => a.source_lot_id))
      const usedLotIds = new Set(out.filter(r => r.source_lot_id).map(r => r.source_lot_id))
      out = out.map(r => {
        if (r.isShortage || resolveK03PzNoFromRow(r) || r.source_lot_id) return r
        const qty = Number(r.qty || 0)
        const pzDate = String(r.pz_date || '').slice(0, 10)
        const match = allocs.find(a => {
          if (usedLotIds.has(a.source_lot_id)) return false
          if (Math.abs(Number(a.qty || 0) - qty) >= 0.001) return false
          if (!pzDate || pzDate === '0000-01-01') return true
          const lot = lotMap.get(a.source_lot_id)
          const lotDate = String(opMap.get(lot?.source_operation_id)?.operation_date || lot?.production_date || '').slice(0, 10)
          return lotDate === pzDate
        })
        if (!match) return r
        usedLotIds.add(match.source_lot_id)
        return enrichRow({ ...r, source_lot_id: match.source_lot_id }, lotMap.get(match.source_lot_id) || {})
      })
    }
  }

  return out
}

export function formatK03PzNo(row) {
  const raw = String(row?.pz_no_display ?? row?.pz_no ?? '').trim()
  if (!raw) return ''
  if (row?.isShortage) return raw

  let text = raw.replace(/agro[-\s]*mar[^/]*/gi, '').replace(/^\s*\/\s*/, '').trim()

  const pzIndex = text.search(/\bPZ[\s./,-]?\d/i)
  if (pzIndex >= 0) {
    text = text.slice(pzIndex).trim()
    text = text.split(/\s+-\s+/)[0].trim()
    text = text.replace(/,\s*$/, '')
    return text.replace(/^PZ\s+/i, 'PZ')
  }

  const fvIndex = text.search(/\bF[\s./-]?V[\s./-]?\d/i)
  if (fvIndex >= 0) {
    return text.slice(fvIndex).split(/\s+-\s+/)[0].trim().replace(/,\s*$/, '')
  }

  if (isAgromarName(raw)) return ''
  if (isInternalLotNumber(text)) return ''
  return text.replace(/,\s*$/, '')
}

/** W kolumnie „Dostawca” wyłącznie pełny numer PZ (bez nazw kontrahentów / odbiorców). */
export function formatK03Dostawca(row) {
  if (row?.isShortage) return row?.supplier || ''
  return formatK03PzNo(row)
}

export function formatK03Receiver(value) {
  const text = String(value || '').trim()
  if (!text || isAgromarName(text)) return ''
  return text.replace(/agro[-\s]*mar[^/]*/gi, '').replace(/\s+/g, ' ').trim()
}


function finalizeK03LotNumbers(forms, productMap, outputLotByKey = new Map()) {
  return (forms || []).map(form => {
    if (preservedK03LotNo(form)) return form
    const dbKey = `${form.data?.sale_operation_id}|${form.data?.product_id || 'null'}`
    const fromDb = outputLotByKey.get(dbKey)
    if (fromDb) return { ...form, lot_no: fromDb }
    // Bez numeru partii do momentu przerobu – numer nadaje się dopiero przy zapisie K03.
    return form
  })
}

export function buildK03PaperData(doc) {
  const rawRows = doc?.data?.rawRows || []
  const saleRow = (doc?.data?.saleRows || [])[0] || {}
  const maxRows = Math.max(10, rawRows.length)
  const saleTotal = Number(doc?.qty || 0)
  const rawTotal = Number(doc?.data?.rawTotal || 0)
  const signed = doc?.signed_by_operator || saleRow.signed_by || ''
  const receiver = formatK03Receiver(doc?.data?.odbiorca || saleRow.receiver || '')

  const rows = Array.from({ length: maxRows }).map((_, i) => {
    const r = rawRows[i] || {}
    const pzNo = resolveK03PzNoFromRow(r) || (r.isShortage ? (r.pz_no || '') : '')
    const dostawca = formatK03Dostawca({ ...r, pz_no: pzNo || r.supplier || r.pz_no }) || pzNo
    return {
      lp: i + 1,
      pzNo,
      pzDate: r.pz_date || '',
      dostawca,
      qty: r.qty ? Number(r.qty) : '',
      wzLp: i + 1,
      wzNo: i === 0 ? (saleRow.wz_no || doc?.document_no || '') : '',
      wzDate: i === 0 ? (saleRow.wz_date || doc?.document_date || '') : '',
      wzReceiver: i === 0 ? receiver : '',
      wzQty: i === 0 ? saleTotal : '',
      signed: i === 0 ? signed : ''
    }
  })

  return {
    year: String(doc?.document_date || '').slice(0, 4),
    month: String(doc?.document_date || '').slice(5, 7),
    productName: doc?.product_name || '',
    lotNo: doc?.lot_no || '',
    wzNo: doc?.document_no || '',
    wzDate: doc?.document_date || '',
    saleTotal,
    rawTotal,
    signed,
    receiver,
    shortage: Number(doc?.data?.shortage || 0),
    rows
  }
}

export function buildK03PrintHtml(doc) {
  const paper = buildK03PaperData(doc)
  const rows = paper.rows.map(r => {
    const rightCells = r.lp === 1
      ? `<td class="right-start">${r.wzLp}</td><td>${escapeHtml(r.wzNo)}</td><td>${escapeHtml(r.wzDate)}</td><td>${escapeHtml(r.wzReceiver)}</td><td>${r.wzQty ? escapeHtml(Number(r.wzQty).toLocaleString('pl-PL')) : ''}</td><td>${escapeHtml(r.signed)}</td>`
      : `<td class="right-start">${r.wzLp}</td><td></td><td></td><td></td><td></td><td></td>`
    const qtyCell = r.qty !== '' ? escapeHtml(Number(r.qty).toLocaleString('pl-PL')) : ''
    return `<tr><td>${r.lp}</td><td>${escapeHtml(r.pzNo)}</td><td>${escapeHtml(r.pzDate)}</td><td>${escapeHtml(r.dostawca)}</td><td>${qtyCell}</td>${rightCells}</tr>`
  }).join('')
  const warn = paper.shortage > 0
    ? `<div style="font-weight:bold;color:#900;margin-top:6px">UWAGA: brak ${paper.shortage.toLocaleString('pl-PL')} kg surowca dostępnego na dzień WZ.</div>`
    : ''
  return `<!doctype html><html><head><meta charset="utf-8"><title>K03 ${escapeHtml(paper.wzNo)}</title><style>@page{size:A4 landscape;margin:7mm}body{font-family:"Times New Roman",serif;color:#111;margin:0}table{width:100%;border-collapse:collapse;table-layout:fixed}td,th{border:1px solid #111;padding:3px 2px;text-align:center;vertical-align:middle;font-size:9.5pt;line-height:1.06;word-wrap:break-word;overflow-wrap:anywhere}.company{width:33%;font-weight:bold}.title{width:50%;font-weight:bold}.meta{width:17%;text-align:left}.field td{height:28px;text-align:left;font-size:10pt}.section{font-weight:bold;text-align:center;background:#eee}.sum{font-weight:bold;text-align:right}.col-pz{width:11%}.col-date{width:8%}.col-dost{width:10%}.col-qty{width:7%}.col-wz{width:11%}.col-odb{width:14%}.col-sign{width:10%}@media print{button{display:none}}</style></head><body><table><tbody><tr><td class="company">AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.<br>24-335 ŁAZISKA,<br>KOLONIA ŁAZISKA 30<br>NIP: 7171839598<br>Wersja I/2024</td><td class="title">Karta K03 - Karta identyfikacji partii produktu</td><td class="meta"><b>Rok:</b> ${escapeHtml(paper.year)}<br><br><b>Miesiąc:</b> ${escapeHtml(paper.month)}<br><br><b>Strona:</b></td></tr></tbody></table><table class="field"><tbody><tr><td><b>Nazwa produktu:</b> ${escapeHtml(paper.productName)}</td><td><b>Data sprzedaży (WZ):</b> ${escapeHtml(paper.wzDate)}</td></tr><tr><td><b>Numer WZ:</b> ${escapeHtml(paper.wzNo)}</td><td><b>Ilość WZ (kg):</b> ${escapeHtml(paper.saleTotal.toLocaleString('pl-PL'))}</td></tr><tr><td><b>Nadany numer partii wyrobu gotowego:</b> ${escapeHtml(paper.lotNo)}</td><td><b>Odbiorca:</b> ${escapeHtml(paper.receiver || '-')}</td></tr></tbody></table><table><thead><tr><th class="section" colspan="5">Dane dotyczące dostaw surowców składających się na partię</th><th style="border-left:3px solid #111" class="section" colspan="6">Dane dotyczące sprzedaży partii gotowego produktu</th></tr><tr><th>Lp.</th><th>Nr faktury / PZ</th><th>Data zakupu</th><th>Dostawca</th><th>Ilość surowca (kg)</th><th style="border-left:3px solid #111">Lp.</th><th>Nr faktury / WZ</th><th>Data</th><th>Odbiorca</th><th>Ilość w kg</th><th>Podpis uzupełniającego wpisy</th></tr></thead><tbody>${rows}<tr><td colspan="4" class="sum">Suma surowca:</td><td><b>${escapeHtml(paper.rawTotal.toLocaleString('pl-PL'))}</b></td><td style="border-left:3px solid #111" colspan="4" class="sum">Suma sprzedana:</td><td><b>${escapeHtml(paper.saleTotal.toLocaleString('pl-PL'))}</b></td><td></td></tr></tbody></table>${warn}<script>window.onload=function(){setTimeout(function(){window.focus();window.print()},700)}</script></body></html>`
}

export function buildK03ExcelRows(doc) {
  const paper = buildK03PaperData(doc)
  const rows = []
  rows.push(['AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.', '', '', '', '', '', 'Karta K03 - Karta identyfikacji partii produktu', '', '', '', ''])
  rows.push([`Rok: ${paper.year}`, '', '', '', '', `Miesiąc: ${paper.month}`, '', '', '', '', ''])
  rows.push([`Nazwa produktu: ${paper.productName}`, '', '', '', '', `Data sprzedaży (WZ): ${paper.wzDate}`, '', '', '', '', ''])
  rows.push([`Numer WZ: ${paper.wzNo}`, '', '', '', '', `Ilość WZ (kg): ${paper.saleTotal}`, '', '', '', '', ''])
  rows.push([`Nadany numer partii wyrobu gotowego: ${paper.lotNo}`, '', '', '', '', `Odbiorca: ${paper.receiver || '-'}`, '', '', '', '', ''])
  rows.push(['Dane dotyczące dostaw surowców składających się na partię', '', '', '', '', 'Dane dotyczące sprzedaży partii gotowego produktu', '', '', '', '', ''])
  rows.push(['Lp.', 'Nr faktury / PZ', 'Data zakupu', 'Dostawca', 'Ilość surowca (kg)', 'Lp.', 'Nr faktury / WZ', 'Data', 'Odbiorca', 'Ilość w kg', 'Podpis uzupełniającego wpisy'])
  for (const r of paper.rows) {
    rows.push([
      r.lp,
      r.pzNo,
      r.pzDate,
      r.dostawca,
      r.qty === '' ? '' : r.qty,
      r.wzLp,
      r.wzNo,
      r.wzDate,
      r.wzReceiver,
      r.wzQty === '' ? '' : r.wzQty,
      r.signed
    ])
  }
  rows.push(['', '', '', 'Suma surowca:', paper.rawTotal, '', '', '', 'Suma sprzedana:', paper.saleTotal, ''])
  if (paper.shortage > 0) {
    rows.push(['UWAGA', `Brak ${paper.shortage} kg surowca na dzień WZ`, '', '', '', '', '', '', '', '', ''])
  }
  return rows
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/\s+/g, ' ')
}

/** Skrót Pcz / „porzeczka cz.” — tylko czarna. NIE dopasowuj „porzeczka czerwona” (cz ≠ cze…). */
function isPorzeczkaCzarnaShorthand(text = '') {
  const t = normalizeText(text)
  if (t === 'pcz' || t === 'pczp') return true
  if (/porzeczka\s+czarna\b/.test(t)) return true
  if (t === 'porzeczka cz' || /porzeczka\s+cz\.\s*$/.test(t)) return true
  return false
}

/** Porzeczka kolorowa (Excel: kolor / kolorowa / czerwona). Nie mylić z czarną. */
export function isPorzeczkaKolorowaAlias(productName = '') {
  const text = normalizeText(productName)
  if (text === 'pk' || text === 'pkp') return true
  return /porzeczka\s+(kolorowa|kolor|czerwona)\b/.test(text)
}

/** @deprecated użyj isPorzeczkaKolorowaAlias */
export function isPorzeczkaCzerwonaAlias(productName) {
  return isPorzeczkaKolorowaAlias(productName)
}

/** Porzeczka czarna (Excel: czarna, cz., Pcz). */
export function isPorzeczkaCzarnaAlias(productName = '') {
  if (isPorzeczkaKolorowaAlias(productName)) return false
  const text = normalizeText(productName)
  return isPorzeczkaCzarnaShorthand(text)
}

function isPorzeczkaKolorowaKey(lotKey, group = '') {
  return lotKey === 'porzeczka kolorowa' ||
    lotKey === 'porzeczka kolorowa pulpa' ||
    lotKey === 'porzeczka czerwona' ||
    lotKey === 'porzeczka czerwona pulpa' ||
    lotKey === 'porzeczka kolor' ||
    lotKey === 'pk' ||
    lotKey === 'pkp' ||
    group === 'porzeczka_czerwona'
}

function isPorzeczkaKolorowaSourceKey(key = '') {
  return key === 'porzeczka kolorowa' ||
    key === 'porzeczka kolorowa pulpa' ||
    key === 'porzeczka czerwona' ||
    key === 'porzeczka czerwona pulpa' ||
    key === 'porzeczka kolor' ||
    key === 'pk' ||
    key === 'pkp'
}

function isPorzeczkaCzarnaKey(lotKey, group = '') {
  return lotKey === 'porzeczka czarna' ||
    lotKey === 'porzeczka czarna pulpa' ||
    lotKey === 'pcz' ||
    lotKey === 'pczp' ||
    group === 'porzeczka_czarna'
}

function fifoLabelFromKey(rawKey) {
  const key = normalizeText(rawKey)
  if (key === 'porzeczka_czerwona' || isPorzeczkaKolorowaSourceKey(key)) return 'Porzeczka kolorowa'
  if (key === 'porzeczka_czarna' || key === 'porzeczka czarna') return 'Porzeczka czarna'
  if (key === 'porzeczka kolorowa') return 'Porzeczka kolorowa'
  if (key === 'truskawka') return 'Truskawka'
  if (key === 'truskawka z szypulka') return 'Truskawka z szypułką'
  if (key.startsWith('malina')) return canonicalProductName(rawKey) || rawKey
  return rawKey || key
}

/** Etykieta klasy FIFO do wyświetlania (np. porzeczka_czerwona → Porzeczka kolorowa). */
export function fifoClassDisplayLabel(matchSpecOrKey) {
  const spec = typeof matchSpecOrKey === 'object' ? matchSpecOrKey : null
  if (spec?.mode === 'variant' && spec.sourceKeys?.size) {
    const keys = [...spec.sourceKeys]
    if (keys.length > 1) {
      return keys.map(k => fifoLabelFromKey(k)).join(' + ')
    }
    return fifoLabelFromKey(keys[0])
  }
  const rawKey = spec
    ? (spec.variantKey || spec.productGroup)
    : String(matchSpecOrKey || '')
  return fifoLabelFromKey(rawKey)
}

/** Czy nazwa dotyczy pulpy (produkt po przerobie — nie surowiec przy PZ). */
export function isPulpaProductName(productName = '') {
  return /pulpa/i.test(String(productName || ''))
}

/** Nazwa kanoniczna produktu – synonimy z importu mapowane na nazwy w systemie. */
export function canonicalProductName(productName = '') {
  const raw = String(productName || '').trim()
  if (!raw) return raw
  const text = normalizeText(raw)
  if (/^t$/i.test(raw.trim())) return 'Truskawka'
  if (/^tsz$/i.test(raw.trim())) return 'Truskawka z szypułką'
  if (/truskawka\s+(z\s*)?szyp|truskawka\s*szyp|\btsz\b/.test(text)) return 'Truskawka z szypułką'
  if (/truskawk/.test(text)) return 'Truskawka'
  if (/^m1$/i.test(raw.trim()) || /malina\s+(?:swieza\s+)?(?:klasa\s*)?(?:i|1)\b/.test(text) || text === 'malina i') return 'Malina klasa I'
  if (/^mpw$/i.test(raw.trim()) || /malina\s+(?:swieza\s*)?pw\b/.test(text)) return 'Malina PW'
  if (/^mex$/i.test(raw.trim()) || /malina\s+(?:swieza\s+)?extra\b/.test(text)) return 'Malina extra'
  if (/porzeczka\s+(kolor(\owa)?|czerwona)\s+pulpa/.test(text) || text === 'pkp') return 'Porzeczka kolorowa pulpa'
  if (/porzeczka\s+(kolor(\owa)?|czerwona)\b/.test(text) && !/pulpa/.test(text) || text === 'pk') return 'Porzeczka kolorowa'
  if (/porzeczka\s+czarna\s+pulpa/.test(text) || text === 'pczp') return 'Porzeczka czarna pulpa'
  if (isPorzeczkaCzarnaShorthand(text) && !/pulpa/.test(text)) return 'Porzeczka czarna'
  if (isPorzeczkaCzarnaShorthand(text)) return /pulpa/.test(text) ? 'Porzeczka czarna pulpa' : 'Porzeczka czarna'
  return raw
}

export function productGroupForName(productName) {
  const text = normalizeText(productName)
  if (text === 't' || text === 'tsz') return 'truskawka'
  if (text.includes('malin')) return 'malina'
  if (text.includes('wisn')) return 'wisnia'
  if (isPorzeczkaCzarnaAlias(text)) return 'porzeczka_czarna'
  if (isPorzeczkaKolorowaAlias(text)) return 'porzeczka_czerwona'
  if (text.includes('truskawk')) return 'truskawka'
  if (text.includes('aronia')) return 'aronia'
  if (text.includes('sliw')) return 'sliwka'
  if (text.includes('obier')) return 'jab_obier'
  if (text.includes('jabl')) return 'jab_przem'
  return text.split(' ')[0] || 'inna'
}

export const CANONICAL_PRODUCT_GROUPS = new Set([
  'malina', 'truskawka', 'wisnia', 'porzeczka_czarna', 'porzeczka_czerwona',
  'aronia', 'jab_obier', 'jab_przem', 'sliwka', 'inna'
])

/**
 * Dozwolone źródła PZ dla sprzedaży danego wariantu produktu.
 * Klucze = normalizeFifoProductKey(nazwa sprzedaży).
 */
export const FIFO_SALE_SOURCE_KEYS = {
  truskawka: ['truskawka', 'truskawka z szypulka'],
  'truskawka z szypulka': ['truskawka z szypulka'],
  'malina pulpa': ['malina pw', 'malina klasa i', 'malina extra'],
  'malina klasa i': ['malina klasa i'],
  'malina extra': ['malina extra'],
  'malina pw': ['malina pw'],
  'malina swieza': ['malina pw'],
  'porzeczka czarna pulpa': ['porzeczka czarna'],
  'porzeczka kolorowa pulpa': ['porzeczka kolorowa'],
  'porzeczka czarna': ['porzeczka czarna'],
  'porzeczka kolorowa': ['porzeczka kolorowa'],
  'porzeczka kolor': ['porzeczka kolorowa'],
  'porzeczka czerwona': ['porzeczka kolorowa'],
  'porzeczka czerwona pulpa': ['porzeczka kolorowa'],
  pcz: ['porzeczka czarna'],
  pczp: ['porzeczka czarna'],
  pk: ['porzeczka kolorowa'],
  pkp: ['porzeczka kolorowa'],
  wisnia: ['wisnia'],
  aronia: ['aronia'],
  sliwka: ['sliwka'],
  'jablko obierka': ['jablko obierka'],
  'jablko na obierke': ['jablko obierka'],
  'jablko przemyslowe': ['jablko przemyslowe'],
  jablko: ['jablko przemyslowe']
}

/** Rodzina owocu do wyboru źródeł PZ w modalu K03. */
function fifoSourceFamily(variantKey = '') {
  if (variantKey === 'truskawka' || variantKey === 'truskawka z szypulka') return 'truskawka'
  if (/^malina/.test(variantKey)) return 'malina'
  if (/porzeczka czarna/.test(variantKey) || variantKey === 'pcz' || variantKey === 'pczp') return 'porzeczka_czarna'
  if (isPorzeczkaKolorowaSourceKey(variantKey)) return 'porzeczka_czerwona'
  if (/jablko/.test(variantKey)) return 'jablko'
  if (variantKey === 'wisnia' || variantKey === 'aronia' || variantKey === 'sliwka') return variantKey
  return null
}

const FIFO_SOURCE_PICKERS = {
  truskawka: {
    hint: 'Każda klasa ma osobną pulę FIFO (truskawka ≠ truskawka z szypułką). Zaznacz tylko klasę PZ, z której ten WZ ma pobierać surowiec.',
    choices: [
      { key: 'truskawka', label: 'Truskawka (bez szypułki)' },
      { key: 'truskawka z szypulka', label: 'Truskawka z szypułką' }
    ],
    defaultKeysForVariant: {
      truskawka: ['truskawka'],
      'truskawka z szypulka': ['truskawka z szypulka']
    }
  },
  malina: {
    hint: 'Każda klasa maliny ma osobną pulę (PW ≠ klasa I ≠ extra). Możesz zaznaczyć kilka klas, gdy na jednej partii mieszasz np. malinę PW i klasa I.',
    choices: [
      { key: 'malina pw', label: 'Malina świeża PW (Mpw)' },
      { key: 'malina klasa i', label: 'Malina klasa I (M1)' },
      { key: 'malina extra', label: 'Malina extra (Mex)' }
    ],
    defaultKeysForVariant: {
      'malina pulpa': ['malina pw'],
      'malina klasa i': ['malina klasa i'],
      'malina extra': ['malina extra'],
      'malina pw': ['malina pw'],
      'malina swieza': ['malina pw'],
      _default: ['malina pw']
    }
  },
  porzeczka_czarna: {
    hint: 'Źródło PZ porzeczki czarnej dla tego WZ.',
    choices: [
      { key: 'porzeczka czarna', label: 'Porzeczka czarna' }
    ],
    defaultKeysForVariant: {
      'porzeczka czarna': ['porzeczka czarna'],
      'porzeczka czarna pulpa': ['porzeczka czarna']
    }
  },
  porzeczka_czerwona: {
    hint: 'Źródło PZ porzeczki kolorowej dla tego WZ.',
    choices: [
      { key: 'porzeczka kolorowa', label: 'Porzeczka kolorowa' }
    ],
    defaultKeysForVariant: {
      'porzeczka kolorowa': ['porzeczka kolorowa'],
      'porzeczka kolor': ['porzeczka kolorowa'],
      'porzeczka czerwona': ['porzeczka kolorowa'],
      'porzeczka czerwona pulpa': ['porzeczka kolorowa'],
      'porzeczka kolorowa pulpa': ['porzeczka kolorowa'],
      pk: ['porzeczka kolorowa'],
      pkp: ['porzeczka kolorowa']
    }
  },
  jablko: {
    hint: 'Który rodzaj jabłka (źródło PZ) idzie na ten WZ?',
    choices: [
      { key: 'jablko obierka', label: 'Jabłko na obierkę' },
      { key: 'jablko przemyslowe', label: 'Jabłko przemysłowe' }
    ],
    defaultKeysForVariant: {
      'jablko obierka': ['jablko obierka'],
      'jablko na obierke': ['jablko obierka'],
      'jablko przemyslowe': ['jablko przemyslowe'],
      jablko: ['jablko przemyslowe'],
      _default: ['jablko przemyslowe']
    }
  },
  wisnia: {
    hint: 'Źródło PZ wiśni.',
    choices: [{ key: 'wisnia', label: 'Wiśnia' }],
    defaultKeysForVariant: { wisnia: ['wisnia'] }
  },
  aronia: {
    hint: 'Źródło PZ aronii.',
    choices: [{ key: 'aronia', label: 'Aronia' }],
    defaultKeysForVariant: { aronia: ['aronia'] }
  },
  sliwka: {
    hint: 'Źródło PZ śliwki.',
    choices: [{ key: 'sliwka', label: 'Śliwka' }],
    defaultKeysForVariant: { sliwka: ['sliwka'] }
  }
}

/** Kanoniczny klucz wariantu produktu (T, Tsz, M1, Mex, Mp…) do dopasowania FIFO. */
export function normalizeFifoProductKey(productName = '', product = null, lotGroup = '') {
  const text = normalizeText(productName || product?.name || '')
  if (!text) return 'inna'
  if (PRODUCT_CODES.has(text)) return text

  if (product?.code) {
    const code = String(product.code).toLowerCase()
    for (const [key, val] of PRODUCT_CODES) {
      if (String(val).toLowerCase() === code) return key
    }
    if (code === 't') return 'truskawka'
    if (code === 'tsz') return 'truskawka z szypulka'
    if (code === 'm1') return 'malina klasa i'
    if (code === 'mpw') return 'malina pw'
    if (code === 'mex') return 'malina extra'
    if (code === 'pcz') return 'porzeczka czarna'
    if (code === 'pczp') return 'porzeczka czarna pulpa'
    if (code === 'pk') return 'porzeczka kolorowa'
    if (code === 'pkp') return 'porzeczka kolorowa pulpa'
  }

  if (text === 't') return 'truskawka'
  if (text === 'tsz') return 'truskawka z szypulka'
  if (text === 'm1') return 'malina klasa i'
  if (text === 'mpw') return 'malina pw'
  if (text === 'mex') return 'malina extra'
  if (text === 'pcz') return 'porzeczka czarna'
  if (text === 'pczp') return 'porzeczka czarna pulpa'
  if (text === 'pk') return 'porzeczka kolorowa'
  if (text === 'pkp') return 'porzeczka kolorowa pulpa'

  if (/truskawka\s+(z\s*)?szyp|truskawka\s*szyp|\btsz\b/.test(text)) return 'truskawka z szypulka'
  if (/truskawk/.test(text)) return 'truskawka'

  if (/malina\s+pulpa/.test(text)) return 'malina pulpa'
  if (/malina\s+(?:swieza\s+)?(?:klasa\s*)?(?:i|1)\b/.test(text) || text === 'malina i') return 'malina klasa i'
  if (/malina\s+(?:swieza\s+)?extra\b/.test(text)) return 'malina extra'
  if (/malina\s+(?:swieza\s*)?pw\b/.test(text)) return 'malina pw'
  if (/malina\s+swieza\b/.test(text)) return 'malina pw'
  if (/malina\s+pw\b/.test(text)) return 'malina pw'
  if (/malina/.test(text)) return text

  if (/porzeczka\s+(kolorowa|kolor|czerwona)\s+pulpa/.test(text) || text === 'pkp') return 'porzeczka kolorowa pulpa'
  if (/porzeczka\s+(kolorowa|kolor|czerwona)\b/.test(text) || text === 'pk') return 'porzeczka kolorowa'
  if (/porzeczka\s+czarna\s+pulpa/.test(text) || text === 'pczp') return 'porzeczka czarna pulpa'
  if (isPorzeczkaCzarnaShorthand(text)) return 'porzeczka czarna'

  if (/wisnia\s+(swieza\s*)?pw\b/.test(text)) return 'wisnia pw'
  if (/wisnia\s+(klasa\s*)?(i|1)\b/.test(text) || text === 'wisnia i') return 'wisnia klasa i'
  if (/wisn/.test(text)) return 'wisnia'
  if (/aronia/.test(text)) return 'aronia'
  if (/sliw/.test(text)) return 'sliwka'
  if (/jabl.*obier/.test(text) || /obier.*jabl/.test(text)) return 'jablko obierka'
  if (/jabl/.test(text)) return 'jablko przemyslowe'

  return text.split(' ')[0] || 'inna'
}

/** Drzewo filtrów klas w panelu K03 (grupa → wariant). */
export const K03_CLASS_FILTER_TREE = [
  {
    id: 'malina',
    label: 'Malina',
    variants: [
      { id: 'malina pw', label: 'Świeża PW (Mpw)' },
      { id: 'malina klasa i', label: 'Klasa I (M1)' },
      { id: 'malina extra', label: 'Extra (Mex)' },
      { id: 'malina pulpa', label: 'Pulpa (Mp)' }
    ]
  },
  {
    id: 'truskawka',
    label: 'Truskawka',
    variants: [
      { id: 'truskawka', label: 'Truskawka (T)' },
      { id: 'truskawka z szypulka', label: 'Z szypułką (Tsz)' }
    ]
  },
  {
    id: 'wisnia',
    label: 'Wiśnia',
    variants: [
      { id: 'wisnia pw', label: 'PW' },
      { id: 'wisnia klasa i', label: 'Klasa I' },
      { id: 'wisnia', label: 'Wiśnia (ogólna)' }
    ]
  },
  {
    id: 'porzeczka_czarna',
    label: 'Porzeczka czarna',
    variants: [
      { id: 'porzeczka czarna', label: 'Porzeczka czarna' },
      { id: 'porzeczka czarna pulpa', label: 'Pulpa' }
    ]
  },
  {
    id: 'porzeczka_czerwona',
    label: 'Porzeczka kolorowa',
    variants: [
      { id: 'porzeczka kolorowa', label: 'Porzeczka kolorowa' },
      { id: 'porzeczka kolorowa pulpa', label: 'Pulpa' }
    ]
  },
  {
    id: 'aronia',
    label: 'Aronia',
    variants: [{ id: 'aronia', label: 'Aronia' }]
  },
  {
    id: 'sliwka',
    label: 'Śliwka',
    variants: [{ id: 'sliwka', label: 'Śliwka' }]
  },
  {
    id: 'jab_obier',
    label: 'Jabłko obierka',
    variants: [{ id: 'jablko obierka', label: 'Na obierkę' }]
  },
  {
    id: 'jab_przem',
    label: 'Jabłko przemysłowe',
    variants: [{ id: 'jablko przemyslowe', label: 'Przemysłowe' }]
  }
]

const K03_KNOWN_VARIANT_IDS = new Set(
  K03_CLASS_FILTER_TREE.flatMap(f => (f.variants || []).map(v => v.id))
)

export function normalizeK03ClassFilterValue(filter = 'all') {
  const raw = String(filter || 'all').trim()
  if (!raw || raw === 'all') return 'all'
  let normalized = raw
  if (!raw.startsWith('group:') && !raw.startsWith('variant:')) {
    normalized = `group:${raw}`
  }
  const legacy = {
    'variant:porzeczka czerwona': 'variant:porzeczka kolorowa',
    'variant:porzeczka czerwona pulpa': 'variant:porzeczka kolorowa pulpa'
  }
  return legacy[normalized] || normalized
}

function k03VariantMatchesFilter(variant, filterVariant) {
  if (variant === filterVariant) return true
  const aliasPairs = [
    ['porzeczka kolorowa', 'porzeczka czerwona'],
    ['porzeczka kolorowa pulpa', 'porzeczka czerwona pulpa']
  ]
  return aliasPairs.some(([a, b]) =>
    (variant === a && filterVariant === b) || (variant === b && filterVariant === a)
  )
}

export function matchesK03ClassFilter(productName, productGroup = '', filter = 'all') {
  const normalized = normalizeK03ClassFilterValue(filter)
  if (normalized === 'all') return true

  const canonical = canonicalProductName(productName)
  const group = productGroup || productGroupForName(canonical)
  const variant = normalizeFifoProductKey(canonical)

  if (normalized.startsWith('group:')) {
    const want = normalized.slice(6)
    if (want === 'porzeczka_czerwona' && group === 'porzeczka_czerwona') return true
    return group === want
  }

  if (normalized.startsWith('variant:')) {
    return k03VariantMatchesFilter(variant, normalized.slice(8))
  }

  return false
}

export function collectExtraK03Variants(items = []) {
  const extras = new Map()
  for (const item of items || []) {
    const name = item?.product_name || ''
    if (!name) continue
    const variant = normalizeFifoProductKey(name)
    if (K03_KNOWN_VARIANT_IDS.has(variant)) continue
    if (!extras.has(variant)) extras.set(variant, name)
  }
  return [...extras.entries()].map(([id, label]) => ({ id, label }))
}

export function buildFifoMatchSpecFromSourceKeys(variantKey, sourceKeys) {
  const keys = (sourceKeys || []).filter(Boolean)
  if (!keys.length) return null
  const sorted = keys.slice().sort()
  return {
    mode: 'variant',
    variantKey,
    poolKey: `class:${sorted.join('+')}`,
    sourceKeys: new Set(keys)
  }
}

/** Konfiguracja wyboru źródeł PZ w modalu K03 (wielokrotny wybór klas/odmian). */
export function fifoSourcePickerForProduct(productName = '', product = null) {
  const variantKey = normalizeFifoProductKey(productName, product)
  const family = fifoSourceFamily(variantKey)
  if (!family || !FIFO_SOURCE_PICKERS[family]) return null
  const picker = FIFO_SOURCE_PICKERS[family]
  if ((picker.choices || []).length <= 1) return null
  const defaultKeys = picker.defaultKeysForVariant[variantKey]
    || picker.defaultKeysForVariant._default
    || [variantKey]
  return {
    variantKey,
    family,
    hint: picker.hint,
    choices: picker.choices,
    defaultKeys: defaultKeys.filter(Boolean)
  }
}

export function defaultFifoSourceKeys(productName = '', product = null) {
  const picker = fifoSourcePickerForProduct(productName, product)
  if (picker?.defaultKeys?.length) return picker.defaultKeys
  const variantKey = normalizeFifoProductKey(productName, product)
  return [variantKey]
}

/** Specyfikacja puli FIFO – domyślnie jedna klasa (bez łączenia wariantów). */
export function resolveFifoMatchSpec(product, productName = '', lotGroup = '', options = {}) {
  const variantKey = normalizeFifoProductKey(productName || product?.name || '', product)
  const overrideKeys = options.fifoSourceKeys || options.fifo_source_keys
  if (overrideKeys?.length) {
    const built = buildFifoMatchSpecFromSourceKeys(variantKey, overrideKeys)
    if (built) return built
  }
  const strict = buildFifoMatchSpecFromSourceKeys(variantKey, [variantKey])
  if (strict) return strict
  const group = resolveFifoProductGroup(product, productName, lotGroup)
  return {
    mode: 'group',
    variantKey,
    poolKey: `class:${group}`,
    sourceKeys: new Set([group])
  }
}

export function fifoLotMatchesMatchSpec(lot, productMap, matchSpec) {
  const product = productMap.get(lot.product_id)
  const name = product?.name || ''
  const lotKey = normalizeFifoProductKey(name, product, lot.product_group)
  const group = resolveFifoProductGroup(product, name, lot.product_group)

  if (matchSpec?.mode === 'variant') {
    if (matchSpec.sourceKeys.has(lotKey)) return true
    if (matchSpec.sourceKeys.has('truskawka') && group === 'truskawka' && lotKey !== 'truskawka z szypulka') return true
    if (matchSpec.sourceKeys.has('truskawka z szypulka') && lotKey === 'truskawka z szypulka') return true
    if (matchSpec.sourceKeys.has('malina pw') && lotKey === 'malina pw') return true
    if (matchSpec.sourceKeys.has('malina klasa i') && lotKey === 'malina klasa i') return true
    if (matchSpec.sourceKeys.has('malina extra') && lotKey === 'malina extra') return true
    for (const sk of matchSpec.sourceKeys || []) {
      if (isPorzeczkaKolorowaSourceKey(sk) && isPorzeczkaKolorowaKey(lotKey, group)) return true
      if ((sk === 'porzeczka czarna' || sk === 'porzeczka czarna pulpa' || sk === 'pcz' || sk === 'pczp') &&
        isPorzeczkaCzarnaKey(lotKey, group)) return true
    }
    return false
  }
  return matchSpec?.sourceKeys?.has(group)
}

export function sameFifoPool(specA, specB) {
  if (!specA || !specB) return false
  if (specA.poolKey && specB.poolKey) return specA.poolKey === specB.poolKey
  if (specA.sourceKeys?.size !== specB.sourceKeys?.size) return false
  for (const k of specA.sourceKeys) {
    if (!specB.sourceKeys.has(k)) return false
  }
  return specA.sourceKeys.size > 0
}

function looksLikeIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim())
}

/** Grupa FIFO/K03 – zawsze po nazwie produktu, nie po kodzie (T, M1…) ani dacie w product_group. */
export function resolveFifoProductGroup(product, productName = '', lotGroup = '') {
  const name = String(product?.name || productName || '').trim()
  const byName = productGroupForName(name)
  if (CANONICAL_PRODUCT_GROUPS.has(byName) && byName !== 'inna') return byName

  let stored = String(product?.product_group || lotGroup || '').trim()
  if (looksLikeIsoDate(stored)) stored = ''
  if (CANONICAL_PRODUCT_GROUPS.has(stored)) return stored

  const byStored = productGroupForName(stored)
  if (CANONICAL_PRODUCT_GROUPS.has(byStored) && byStored !== 'inna') return byStored

  return byName || stored || 'inna'
}

/** Naprawia product_group i nazwy produktów porzeczek po imporcie (kolorowa ≠ czarna, skróty Pcz/Pk). */
export async function repairPorzeczkaProductGroups(client, { onProgress } = {}) {
  if (!client) return { products_fixed: 0, lots_fixed: 0 }
  onProgress?.('Synchronizacja grup porzeczek (czarna / kolorowa)…')

  // Cofnij błąd: „czerwona” mylone ze skrótem „cz.” → czarna
  const { data: allProducts } = await client.from('products').select('id, name, code, product_group')
  for (const p of allProducts || []) {
    const n = normalizeText(p.name)
    const code = String(p.code || '').toUpperCase()
    const wronglyBlack = (p.product_group === 'porzeczka_czarna' || /porzeczka\s+czarna/i.test(p.name || '')) &&
      (isPorzeczkaKolorowaAlias(p.name) || code === 'PK' || code === 'PKP' || /czerwon|kolorow|kolor\b/.test(n))
    if (wronglyBlack) {
      const pulpa = /pulpa/.test(n) || code === 'PKP'
      await client.from('products').update({
        name: pulpa ? 'Porzeczka kolorowa pulpa' : 'Porzeczka kolorowa',
        product_group: 'porzeczka_czerwona'
      }).eq('id', p.id)
      await client.from('lots').update({ product_group: 'porzeczka_czerwona' }).eq('product_id', p.id)
    }
  }
  await client.from('operation_items').update({ raw_product_name: 'Porzeczka kolorowa' })
    .or('raw_product_name.ilike.%porzeczka%czerwon%,raw_product_name.ilike.%porzeczka%kolorow%,raw_product_name.ilike.%porzeczka kolor %')
    .not('raw_product_name', 'ilike', '%pulpa%')
  await client.from('operation_items').update({ raw_product_name: 'Porzeczka kolorowa pulpa' })
    .or('raw_product_name.ilike.%porzeczka%czerwon%pulpa%,raw_product_name.ilike.%porzeczka%kolorow%pulpa%')
  await client.from('haccp_documents').update({ product_name: 'Porzeczka kolorowa' })
    .or('product_name.ilike.%porzeczka%czerwon%,product_name.ilike.%porzeczka%kolorow%')
    .not('product_name', 'ilike', '%pulpa%')

  const { data: products, error } = await client.from('products').select('id, name, code, product_group')
  if (error) throw error

  let productsFixed = 0
  const productIdsByGroup = { porzeczka_czarna: [], porzeczka_czerwona: [] }
  const canonicalByProductId = new Map()

  for (const p of products || []) {
    const text = normalizeText(p.name)
    let targetGroup = null
    let canonical = null

    if (isPorzeczkaCzarnaAlias(p.name)) {
      targetGroup = 'porzeczka_czarna'
      if (!/porzeczka\s+czarna/i.test(String(p.name || ''))) {
        canonical = /pulpa/.test(text) || p.code === 'Pczp' ? 'Porzeczka czarna pulpa' : 'Porzeczka czarna'
      }
    } else if (isPorzeczkaKolorowaAlias(p.name)) {
      targetGroup = 'porzeczka_czerwona'
      if (!/porzeczka\s+kolorowa/i.test(String(p.name || ''))) {
        canonical = /pulpa/.test(text) || p.code === 'Pkp' ? 'Porzeczka kolorowa pulpa' : 'Porzeczka kolorowa'
      }
    }

    if (!targetGroup) continue
    productIdsByGroup[targetGroup].push(p.id)
    const displayName = canonical || (targetGroup === 'porzeczka_czerwona'
      ? (/pulpa/.test(text) || p.code === 'Pkp' ? 'Porzeczka kolorowa pulpa' : 'Porzeczka kolorowa')
      : (/pulpa/.test(text) || p.code === 'Pczp' ? 'Porzeczka czarna pulpa' : 'Porzeczka czarna'))
    canonicalByProductId.set(p.id, displayName)

    const patch = {}
    if (p.product_group !== targetGroup) patch.product_group = targetGroup
    if (canonical && normalizeText(p.name) !== normalizeText(canonical)) patch.name = canonical
    if (!Object.keys(patch).length) continue

    const { error: updErr } = await client.from('products').update(patch).eq('id', p.id)
    if (updErr) throw updErr
    productsFixed += 1
  }

  onProgress?.('Nazwy w pozycjach: czerwona → kolorowa…')
  for (const [productId, displayName] of canonicalByProductId) {
    await client.from('operation_items').update({ raw_product_name: displayName }).eq('product_id', productId)
  }
  await client.from('operation_items').update({ raw_product_name: 'Porzeczka kolorowa' }).ilike('raw_product_name', '%porzeczka%czerwon%').not('raw_product_name', 'ilike', '%pulpa%')
  await client.from('operation_items').update({ raw_product_name: 'Porzeczka kolorowa pulpa' }).ilike('raw_product_name', '%porzeczka%czerwon%pulpa%')
  await client.from('haccp_documents').update({ product_name: 'Porzeczka kolorowa' }).ilike('product_name', '%porzeczka%czerwon%').not('product_name', 'ilike', '%pulpa%')
  await client.from('haccp_documents').update({ product_name: 'Porzeczka kolorowa pulpa' }).ilike('product_name', '%porzeczka%czerwon%pulpa%')

  let lotsFixed = 0
  for (const [group, ids] of Object.entries(productIdsByGroup)) {
    if (!ids.length) continue
    for (let i = 0; i < ids.length; i += 80) {
      const chunk = ids.slice(i, i + 80)
      const { error: lotErr } = await client.from('lots').update({ product_group: group }).in('product_id', chunk).neq('product_group', group)
      if (lotErr) throw lotErr
    }
    const { count, error: countErr } = await client.from('lots').select('id', { count: 'exact', head: true }).in('product_id', ids).eq('product_group', group)
    if (!countErr && Number(count || 0) > 0) lotsFixed += Number(count || 0)
  }

  return { products_fixed: productsFixed, lots_fixed: lotsFixed }
}

function resolveProductGroup(product, productName = '', lotGroup = '') {
  return resolveFifoProductGroup(product, productName, lotGroup)
}

export function isSaleOperation(op) {
  if (!op) return false
  const raw = String(op.document_no || op.invoice_no || '').trim()
  const no = raw.toUpperCase()
  if (/^(WZ|FV|FS)[\s./\-]?/i.test(raw)) return true
  if (/\b(WZ|FV|FS)\b/.test(no)) return true
  if (no.includes('/WZ') || no.includes('WZ/')) return true
  return op.operation_type === 'sprzedaz' || op.operation_type === 'sprzedaz_bez_produkcji'
}

function saleDocumentNo(op) {
  return String(op?.document_no || op?.invoice_no || '').trim()
}

function saleOperationDate(op) {
  const d = String(op?.operation_date || '').slice(0, 10)
  if (d) return d
  return String(op?.created_at || '').slice(0, 10) || '0000-01-01'
}

function saleLineKey(operationId, productId, productName = '') {
  const pid = productId || `raw:${normalizeText(productName || 'produkt')}`
  return `${operationId}|${pid}`
}

async function fetchInChunks(client, table, select, column, ids, chunkSize = 80) {
  const uniqueIds = Array.from(new Set((ids || []).filter(Boolean)))
  if (!uniqueIds.length) return []
  const results = []
  for (let i = 0; i < uniqueIds.length; i += chunkSize) {
    const chunk = uniqueIds.slice(i, i + chunkSize)
    const { data, error } = await client.from(table).select(select).in(column, chunk)
    if (error) throw error
    results.push(...(data || []))
  }
  return results
}

function pickSaleItems(items, op) {
  const list = items || []
  const rozchod = list.filter(i => i.direction === 'rozchod' && Math.abs(Number(i.qty || 0)) > 0)
  if (rozchod.length) return rozchod
  if (isSaleOperation(op)) {
    return list.filter(i => Math.abs(Number(i.qty || 0)) > 0)
  }
  return []
}

export function buildK03FormDoc(saleLine, pzRows, productMap, contractorMap, source = 'baza', options = {}) {
  const fifoCutoffDate = options.fifoCutoffDate || null
  const workflow = options.workflow || null
  const lotNoOverride = options.lotNo || ''
  const op = saleLine.op
  const product = productMap.get(saleLine.product_id)
  const productName = canonicalProductName(product?.name || saleLine.raw_product_name || 'Produkt')
  const productGroup = resolveProductGroup(product, productName)
  const wzNo = saleDocumentNo(op) || saleLine.document_no || `OP-${String(saleLine.operation_id || '').slice(0, 8)}`
  const wzDate = saleOperationDate(op) || saleLine.issue_date || '0000-01-01'
  const saleQty = Number(saleLine.qty || 0)
  const receiver = formatK03Receiver(contractorMap.get(op?.contractor_id)?.name || saleLine.receiver_name || '')
  const cutoffDate = String(fifoCutoffDate || wzDate || '').slice(0, 10)

  const incomingRows = (options.manualRawRows?.length ? options.manualRawRows : (pzRows || []))
    .filter(r => Number(r.qty || 0) > 0)
    .map(r => {
    const pzNo = resolveK03PzNoFromRow(r) || String(r.pz_no || '').trim()
    const supplier = formatK03Dostawca({ ...r, pz_no: pzNo || r.supplier || r.pz_no }) || String(r.supplier || '').trim()
    return {
      ...r,
      pz_no: pzNo,
      pz_no_display: pzNo || r.pz_no_display || '',
      supplier,
      source_lot_id: r.source_lot_id || null,
      source_lot_no: r.source_lot_no || '',
      isShortage: r.isShortage === true && !pzNo
    }
  })
  let excludedFuturePzRows = []
  let rawRowsBase = incomingRows
  if (options.filterPzByCutoffDate === true && cutoffDate && cutoffDate !== '0000-01-01') {
    rawRowsBase = []
    for (const r of incomingRows) {
      const pzDate = String(r.pz_date || '').slice(0, 10)
      if (pzDate && pzDate !== '0000-01-01' && pzDate > cutoffDate) {
        excludedFuturePzRows.push(r)
      } else {
        rawRowsBase.push(r)
      }
    }
  }

  rawRowsBase = rawRowsBase.sort((a, b) =>
    String(a.pz_date || '').localeCompare(String(b.pz_date || '')) ||
    String(a.pz_no || '').localeCompare(String(b.pz_no || ''))
  ).map(r => ({
    ...r,
    source_lot_id: r.source_lot_id || null,
    source_lot_no: r.source_lot_no || ''
  }))

  const excludedFuturePz = excludedFuturePzRows.length > 0
  const excludedFuturePzQty = excludedFuturePzRows.reduce((sum, r) => sum + Number(r.qty || 0), 0)

  const allocatedTotal = rawRowsBase.reduce((sum, r) => sum + Number(r.qty || 0), 0)
  const shortage = Math.max(0, Math.round((saleQty - allocatedTotal) * 1000) / 1000)
  const cutoffLabel = cutoffDate !== '0000-01-01' ? cutoffDate : wzDate
  const manualMode = Boolean(options.manualRawRows?.length)
  const rawRows = shortage > 0 && !manualMode
    ? [...rawRowsBase, {
      pz_no: source === 'excel' ? 'Zapisz do bazy i przelicz FIFO' : 'BRAK SUROWCA',
      pz_date: cutoffLabel && cutoffLabel !== '0000-01-01' ? `≤ ${cutoffLabel}` : '',
      supplier: source === 'excel' ? '—' : `brakuje ${shortage.toLocaleString('pl-PL')} kg na stanie`,
      qty: shortage,
      source_lot_no: '',
      isShortage: true
    }]
    : manualMode && shortage > 0.0005
      ? [...rawRowsBase, {
        pz_no: '',
        pz_date: cutoffLabel && cutoffLabel !== '0000-01-01' ? cutoffLabel : '',
        supplier: '',
        qty: shortage,
        source_lot_no: '',
        isShortage: true
      }]
      : rawRowsBase

  const rawTotal = allocatedTotal
  const quantityWarningAccepted = workflow?.quantity_warning_accepted === true
  const quantitiesMatch = source === 'excel'
    ? false
    : (Math.abs(allocatedTotal - saleQty) < 0.001 && shortage <= 0) || quantityWarningAccepted
  const formId = `K03-${saleLine.key}`

  return {
    id: formId,
    synthetic: true,
    document_type: 'K03',
    document_date: wzDate,
    product_name: productName,
    product_group: productGroup,
    lot_no: lotNoOverride || '',
    supplier_name: '',
    document_no: wzNo,
    chamber_code: '',
    qty: saleQty,
    status: source === 'excel' || excludedFuturePz || shortage > 0 ? 'N' : 'P',
    data: {
      wz_no: wzNo,
      wz_date: wzDate,
      odbiorca: receiver,
      product_group: productGroup,
      rawRows,
      saleRows: [{ wz_no: wzNo, wz_date: wzDate, receiver, qty: saleQty, signed_by: '' }],
      allocatedTotal,
      rawTotal,
      saleQty,
      shortage,
      quantitiesMatch,
      invalidFuturePz: excludedFuturePz,
      excludedFuturePzQty,
      sale_operation_id: saleLine.operation_id,
      product_id: saleLine.product_id,
      k03_source: source,
      fifo_cutoff_date: cutoffDate !== '0000-01-01' ? cutoffDate : wzDate,
      k03_workflow: workflow
    },
    signed_by_operator: '',
    signed_by_admin: '',
    document_version: 'I/2024',
    created_at: wzDate
  }
}

/** Formularze K03 z wczytanego Excela (gdy baza jeszcze nie zwraca WZ). */
export function buildK03FormsFromExcelRows(excelRows) {
  const saleLines = new Map()
  for (const row of excelRows || []) {
    if (row.operation !== 'sprzedaz') continue
    if (!row.documentNo || !row.productName) continue
    const qty = Math.abs(Number(row.qty) || 0)
    if (qty <= 0) continue
    const key = `${row.documentNo}|${normalizeText(row.productName)}`
    const current = saleLines.get(key) || {
      key,
      operation_id: key,
      product_id: null,
      raw_product_name: row.productName,
      document_no: row.documentNo,
      issue_date: row.issueDate || '0000-01-01',
      receiver_name: row.contractorName || '',
      qty: 0,
      op: {
        document_no: row.documentNo,
        operation_date: row.issueDate,
        contractor_id: null
      }
    }
    current.qty += qty
    saleLines.set(key, current)
  }

  const emptyMap = new Map()
  const forms = Array.from(saleLines.values())
    .map(line => buildK03FormDoc(line, [], emptyMap, emptyMap, 'excel'))
    .sort((a, b) =>
      String(a.document_date || '').localeCompare(String(b.document_date || '')) ||
      String(a.document_no || '').localeCompare(String(b.document_no || ''))
    )
  return finalizeK03LotNumbers(forms, emptyMap)
}

/** Formularze K03 z podglądu importu (tabela operations + operation_items). */
export function buildK03FormsFromImportPreview(importOps) {
  const saleLines = new Map()
  for (const op of importOps || []) {
    if (!isSaleOperation(op)) continue
    const items = op.operation_items || []
    const picked = pickSaleItems(items, op)
    for (const item of picked) {
      const qty = Math.abs(Number(item.qty || 0))
      if (qty <= 0) continue
      const rawName = item.raw_product_name || ''
      const key = saleLineKey(op.id, item.product_id, rawName)
      const current = saleLines.get(key) || {
        key,
        operation_id: op.id,
        product_id: item.product_id || null,
        raw_product_name: rawName,
        qty: 0,
        op
      }
      current.qty += qty
      saleLines.set(key, current)
    }
  }
  const emptyMap = new Map()
  const forms = Array.from(saleLines.values())
    .map(line => buildK03FormDoc(line, [], emptyMap, emptyMap, 'import'))
  return finalizeK03LotNumbers(forms, emptyMap)
}

/**
 * Ładuje formularze K03 z Supabase.
 */
export async function loadK03Forms(client) {
  if (!client) {
    return {
      forms: [],
      diag: { wzDocs: 0, saleLines: 0, forms: 0, allocations: 0, source: 'brak-bazy' },
      message: 'Aplikacja nie łączy się z bazą danych. Jeśli wczytałeś Excel, formularze K03 pokażą się z pliku.'
    }
  }

  const { data: rozchodItems, error: rozchodErr } = await client
    .from('operation_items')
    .select('id, operation_id, product_id, qty, direction, raw_product_name')
    .eq('direction', 'rozchod')
    .limit(50000)
  if (rozchodErr) throw rozchodErr

  const rozchodOpIds = Array.from(new Set((rozchodItems || []).map(i => i.operation_id).filter(Boolean)))

  const [{ data: saleTypedOps, error: typedErr }, rozchodOps] = await Promise.all([
    client
      .from('operations')
      .select('id, operation_type, operation_date, document_no, invoice_no, contractor_id, created_at')
      .eq('operation_type', 'sprzedaz')
      .order('operation_date', { ascending: true })
      .limit(50000),
    rozchodOpIds.length
      ? fetchInChunks(client, 'operations', 'id, operation_type, operation_date, document_no, invoice_no, contractor_id, created_at', 'id', rozchodOpIds)
      : Promise.resolve([])
  ])
  if (typedErr) throw typedErr

  const opMap = new Map()
  for (const op of [...(saleTypedOps || []), ...(rozchodOps || [])]) {
    if (op?.id) opMap.set(op.id, op)
  }

  const saleOpIds = new Set()
  for (const op of opMap.values()) {
    if (isSaleOperation(op) || rozchodOpIds.includes(op.id)) saleOpIds.add(op.id)
  }

  let allItems = [...(rozchodItems || [])]
  const rozchodKeys = new Set(allItems.map(i => `${i.operation_id}|${i.product_id}|${normalizeText(i.raw_product_name || '')}`))

  if (saleOpIds.size) {
    const saleItems = await fetchInChunks(
      client,
      'operation_items',
      'id, operation_id, product_id, qty, direction, raw_product_name',
      'operation_id',
      Array.from(saleOpIds)
    )
    for (const item of saleItems) {
      if (item.direction === 'rozchod') continue
      const k = `${item.operation_id}|${item.product_id}|${normalizeText(item.raw_product_name || '')}`
      if (rozchodKeys.has(k)) continue
      if (!isSaleOperation(opMap.get(item.operation_id))) continue
      allItems.push(item)
    }
  }

  const itemsByOp = new Map()
  for (const item of allItems) {
    if (!item.operation_id || !saleOpIds.has(item.operation_id)) continue
    if (!itemsByOp.has(item.operation_id)) itemsByOp.set(item.operation_id, [])
    itemsByOp.get(item.operation_id).push(item)
  }

  const [{ data: products, error: prodErr }, allocResult] = await Promise.all([
    client.from('products').select('id, name, code, product_group').limit(10000),
    client.from('fifo_allocations').select('id, qty, source_lot_id, product_id, operation_id, created_at').order('created_at', { ascending: true }).limit(50000)
  ])
  if (prodErr) throw prodErr

  const allocations = allocResult.error ? [] : (allocResult.data || [])
  const productMap = new Map((products || []).map(p => [p.id, p]))

  const saleLines = new Map()
  for (const opId of saleOpIds) {
    const op = opMap.get(opId)
    const items = pickSaleItems(itemsByOp.get(opId), op)
    for (const item of items) {
      const qty = Math.abs(Number(item.qty || 0))
      if (qty <= 0) continue
      const product = productMap.get(item.product_id)
      const rawName = item.raw_product_name || product?.name || ''
      const key = saleLineKey(opId, item.product_id, rawName)
      const current = saleLines.get(key) || {
        key,
        operation_id: opId,
        product_id: item.product_id || null,
        raw_product_name: rawName,
        qty: 0,
        op
      }
      current.qty += qty
      saleLines.set(key, current)
    }
  }

  const contractorIds = Array.from(new Set(
    Array.from(saleOpIds).map(id => opMap.get(id)?.contractor_id).filter(Boolean)
  ))
  const contractors = contractorIds.length
    ? await fetchInChunks(client, 'contractors', 'id, name', 'id', contractorIds)
    : []
  const contractorMap = new Map(contractors.map(c => [c.id, c]))

  const saleOpIdList = Array.from(saleOpIds)
  const outputLots = saleOpIdList.length
    ? await fetchInChunks(client, 'lots', 'id, lot_no, product_id, source_operation_id', 'source_operation_id', saleOpIdList)
    : []
  const outputLotByKey = new Map()
  for (const lot of outputLots) {
    if (!lot?.lot_no) continue
    outputLotByKey.set(`${lot.source_operation_id}|${lot.product_id || 'null'}`, lot.lot_no)
  }

  const forms = finalizeK03LotNumbers(
    Array.from(saleLines.values())
      .map(line => buildK03FormDoc(line, [], productMap, contractorMap, 'baza'))
      .sort((a, b) =>
        String(a.document_date || '').localeCompare(String(b.document_date || '')) ||
        String(a.document_no || '').localeCompare(String(b.document_no || '')) ||
        String(a.product_name || '').localeCompare(String(b.product_name || ''))
      ),
    productMap,
    outputLotByKey
  )

  const diag = {
    wzDocs: saleOpIds.size,
    saleLines: saleLines.size,
    forms: forms.length,
    allocations: allocations.length,
    rozchodItems: (rozchodItems || []).length,
    source: 'baza'
  }

  let message = ''
  if (!saleOpIds.size) {
    message = 'W bazie nie ma jeszcze WZ. Jeśli wczytałeś Excel – kliknij „Zapisz do Supabase” w zakładce Importy.'
  } else if (!saleLines.size) {
    message = `W bazie jest ${saleOpIds.size} WZ, ale brak pozycji z ilością. Sprawdź kolumny Produkt i Ilość w Excelu.`
  }

  return { forms, diag, message }
}

export function applyRawRowPatches(rawRows, patches) {
  if (!patches || typeof patches !== 'object') return rawRows || []
  return (rawRows || []).map((row, i) => {
    const patch = patches[i] ?? patches[String(i)]
    if (!patch) return row
    const next = { ...row }
    if (patch.pz_no != null) {
      next.pz_no = patch.pz_no
      next.pz_no_display = patch.pz_no
      if (String(patch.pz_no).trim()) next.isShortage = false
    }
    if (patch.pz_date != null) next.pz_date = patch.pz_date
    if (patch.supplier != null) next.supplier = patch.supplier
    if (patch.qty != null) next.qty = Number(patch.qty) || 0
    if (patch.isShortage != null) next.isShortage = patch.isShortage
    return next
  })
}

export function recalcK03TotalsFromRawRows(rawRows, saleQty) {
  const rows = rawRows || []
  const rawTotal = Math.round(rows.reduce((s, r) => s + Number(r.qty || 0), 0) * 1000) / 1000
  const shortage = Math.max(0, Math.round((Number(saleQty || 0) - rawTotal) * 1000) / 1000)
  return { rawTotal, shortage }
}

export function applyK03DocEdits(doc, edits = {}) {
  if (!doc || !edits || !Object.keys(edits).length) return doc

  const wzDate = edits.wz_date ?? edits.document_date ?? doc.document_date
  const lotNo = edits.lot_no ?? doc.lot_no
  const signed = edits.signed_by_operator ?? doc.signed_by_operator ?? ''
  const rawRows = Array.isArray(edits.rawRows)
    ? edits.rawRows
    : applyRawRowPatches(doc.data?.rawRows, edits.rawRowPatches)
  const saleQty = Number(doc?.qty || 0)
  const totals = recalcK03TotalsFromRawRows(rawRows, saleQty)

  const saleRows = (doc.data?.saleRows || []).map(r => ({
    ...r,
    wz_date: wzDate,
    signed_by: signed
  }))

  return {
    ...doc,
    lot_no: lotNo,
    document_date: wzDate,
    signed_by_operator: signed,
    data: {
      ...doc.data,
      wz_date: wzDate,
      rawRows,
      saleRows,
      rawTotal: totals.rawTotal,
      shortage: totals.shortage
    }
  }
}

export function k03EditsFromSnapshot(snap) {
  if (!snap) return {}
  const stored = snap.data?.k03_edits || {}
  return {
    lot_no: stored.lot_no ?? snap.lot_no,
    wz_date: stored.wz_date ?? snap.data?.wz_date ?? snap.document_date,
    signed_by_operator: snap.signed_by_operator,
    rawRowPatches: stored.rawRowPatches,
    rawRows: stored.rawRows
  }
}

export function mergeK03Overrides(forms, overrides = {}) {
  return (forms || []).map(doc => applyK03DocEdits(doc, overrides[doc.id] || {}))
}

export async function loadK03Snapshots(client) {
  if (!client) return []
  try {
    const { data, error } = await client
      .from('haccp_documents')
      .select('id, document_type, operation_id, document_no, document_date, product_name, lot_no, qty, status, data, signed_by_operator, created_at, updated_at')
      .eq('document_type', 'K03')
      .limit(10000)
    if (error) throw error
    return data || []
  } catch {
    return []
  }
}

export function mergeK03Snapshots(forms, snapshots = []) {
  const byKey = new Map()
  for (const snap of snapshots) {
    const key = snap?.data?.k03_key || snap?.data?.form_id
    if (key) byKey.set(key, snap)
  }
  return (forms || []).map(form => {
    const snap = byKey.get(form.id)
    if (!snap) return form
    const signed = snap.signed_by_operator || form.signed_by_operator || ''
    const frozen = snap.data?.frozen === true
    const edits = k03EditsFromSnapshot(snap)

    if (frozen && Array.isArray(snap.data?.rawRows)) {
      const frozenDoc = {
        ...form,
        haccp_doc_id: snap.id,
        frozen: true,
        frozen_at: snap.data?.frozen_at || snap.updated_at,
        lot_no: snap.lot_no || form.lot_no,
        document_date: snap.document_date || form.document_date,
        signed_by_operator: signed,
        status: snap.status || form.status,
        data: {
          ...form.data,
          ...snap.data,
          rawRows: snap.data.rawRows,
          saleRows: (snap.data.saleRows || form.data?.saleRows || []).map(r => ({ ...r, signed_by: signed })),
          rawTotal: snap.data.rawTotal ?? form.data?.rawTotal,
          quantitiesMatch: snap.data.quantitiesMatch ?? form.data?.quantitiesMatch,
          shortage: snap.data.shortage ?? form.data?.shortage
        }
      }
      return applyK03DocEdits(frozenDoc, edits)
    }

    const openDoc = {
      ...form,
      haccp_doc_id: snap.id,
      signed_by_operator: signed,
      data: {
        ...form.data,
        ...snap.data,
        saleRows: (form.data?.saleRows || []).map(r => ({ ...r, signed_by: signed }))
      }
    }
    return applyK03DocEdits(openDoc, edits)
  })
}

export async function saveK03Snapshot(client, doc, { freeze = false, userRole = 'operator', unfreeze = false } = {}) {
  if (!client || !doc?.id) return null
  const wasFrozen = doc.frozen === true || doc.data?.frozen === true
  const payload = {
    document_type: 'K03',
    operation_id: doc.data?.sale_operation_id || null,
    document_date: doc.document_date,
    product_name: doc.product_name,
    lot_no: doc.lot_no,
    document_no: doc.document_no,
    qty: doc.qty,
    status: doc.status,
    signed_by_operator: doc.signed_by_operator || '',
    data: {
      ...(doc.data || {}),
      k03_key: doc.id,
      form_id: doc.id,
      k03_edits: doc.data?.k03_edits || {
        lot_no: doc.lot_no,
        wz_date: doc.data?.wz_date || doc.document_date,
        rawRowPatches: doc.data?.k03_edits?.rawRowPatches || null
      },
      k03_workflow: doc.data?.k03_workflow
        ? { ...doc.data.k03_workflow, lot_no: doc.lot_no }
        : doc.data?.k03_workflow,
      frozen: unfreeze ? false : (freeze || (wasFrozen && !unfreeze)),
      frozen_at: freeze ? new Date().toISOString() : (unfreeze ? null : (doc.data?.frozen_at || null)),
      rawRows: doc.data?.rawRows || [],
      saleRows: doc.data?.saleRows || [],
      product_group: doc.product_group || doc.data?.product_group
    },
    updated_at: new Date().toISOString()
  }
  if (unfreeze) {
    payload.data.unfrozen_at = new Date().toISOString()
    payload.data.unfreeze_reason = doc.data?.unfreeze_reason || ''
  }

  let existing = null
  const { data: byKey, error: keyErr } = await client
    .from('haccp_documents')
    .select('id, data')
    .eq('document_type', 'K03')
    .filter('data->>k03_key', 'eq', doc.id)
    .limit(1)
    .maybeSingle()
  if (!keyErr && byKey) existing = byKey
  if (!existing && doc.data?.sale_operation_id) {
    const { data: byOp, error: opErr } = await client
      .from('haccp_documents')
      .select('id, data')
      .eq('document_type', 'K03')
      .eq('operation_id', doc.data.sale_operation_id)
      .limit(5)
    if (!opErr && byOp?.length) {
      existing = byOp.find(r => r.data?.k03_key === doc.id || r.data?.form_id === doc.id) || null
    }
  }

  if (existing?.id) {
    if (existing.data?.frozen === true && !freeze && !unfreeze) {
      payload.data.frozen = true
      payload.data.frozen_at = existing.data?.frozen_at
      const manualEdits = payload.data?.k03_edits?.rawRowPatches || payload.data?.k03_edits?.lot_no || payload.data?.k03_edits?.wz_date
      if (!manualEdits) {
        payload.data.rawRows = existing.data?.rawRows || payload.data.rawRows
      }
    }
    const { error } = await client.from('haccp_documents').update(payload).eq('id', existing.id)
    if (error) throw error
    return existing.id
  }

  const { data, error } = await client
    .from('haccp_documents')
    .insert({ ...payload, created_by: userRole })
    .select('id')
    .single()
  if (error) throw error
  return data?.id
}

/** Szybkie odmrożenie – tylko flaga frozen (bez pełnego zapisu całej kartoteki). */
export async function unfreezeK03Snapshot(client, doc, reason, userRole = 'operator') {
  if (!client || !doc?.id) throw new Error('Brak dokumentu K03.')

  let haccpId = doc.haccp_doc_id || null
  if (!haccpId) {
    const { data: found, error: findErr } = await client
      .from('haccp_documents')
      .select('id')
      .eq('document_type', 'K03')
      .filter('data->>k03_key', 'eq', doc.id)
      .limit(1)
      .maybeSingle()
    if (findErr) throw findErr
    haccpId = found?.id || null
  }
  if (!haccpId) throw new Error('Nie znaleziono zapisanej kartoteki K03.')

  const { data: row, error: fetchErr } = await client
    .from('haccp_documents')
    .select('id, data')
    .eq('id', haccpId)
    .single()
  if (fetchErr) throw fetchErr
  if (row?.data?.frozen !== true) return haccpId

  const nextData = {
    ...row.data,
    frozen: false,
    frozen_at: null,
    unfrozen_at: new Date().toISOString(),
    unfreeze_reason: String(reason || '').trim()
  }
  const { error: updErr } = await client
    .from('haccp_documents')
    .update({ data: nextData, updated_at: new Date().toISOString() })
    .eq('id', haccpId)
  if (updErr) throw updErr
  return haccpId
}

export function parseK03LotNo(lotNo) {
  const m = String(lotNo || '').trim().match(/^([A-Za-z]{1,8})\/(\d{1,5})\/(\d{2,4})$/)
  if (!m) return null
  const year = m[3].length === 2 ? `20${m[3]}` : m[3]
  return { code: m[1], seq: Number(m[2]) || 0, year }
}

/** Kolejność przerobu K03 (nie data WZ) – do ustalania, która karta była pierwsza. */
export function k03ProcessingOrderKey(doc) {
  const wf = doc?.data?.k03_workflow || {}
  return String(
    wf.created_at ||
    wf.updated_at ||
    doc?.updated_at ||
    doc?.created_at ||
    wf.przerob_date ||
    doc?.document_date ||
    ''
  )
}

/**
 * Usuwa duplikaty numerów partii (ten sam lot_no na 2+ kartach).
 * Pierwsza karta wg momentu przerobu zostaje; pozostałe dostają kolejny wolny numer.
 */
export async function repairK03DuplicateLotNumbers(client, { onProgress } = {}) {
  if (!client) throw new Error('Brak połączenia z bazą')

  const { data: docs, error } = await client
    .from('haccp_documents')
    .select('id, document_no, document_date, product_name, lot_no, data, created_at, updated_at')
    .eq('document_type', 'K03')
  if (error) throw error

  const withLot = (docs || []).filter(d => parseK03LotNo(d.lot_no))
  const byLot = new Map()
  for (const doc of withLot) {
    const k = String(doc.lot_no || '').trim().toLowerCase()
    if (!byLot.has(k)) byLot.set(k, [])
    byLot.get(k).push(doc)
  }

  const updates = []
  for (const group of byLot.values()) {
    if (group.length <= 1) continue
    group.sort((a, b) => k03ProcessingOrderKey(a).localeCompare(k03ProcessingOrderKey(b)))
    for (let i = 1; i < group.length; i++) updates.push(group[i])
  }

  if (!updates.length) {
    await syncK03LotSequences(client).catch(() => {})
    return { changed: 0, duplicatesBefore: 0 }
  }

  let changed = 0
  for (let i = 0; i < updates.length; i++) {
    const doc = updates[i]
    const parsed = parseK03LotNo(doc.lot_no)
    onProgress?.(`Nowy numer dla duplikatu ${i + 1}/${updates.length}: ${doc.lot_no}`)
    let newLot = null
    try {
      newLot = await allocateK03LotNoRpc(client, parsed.code, Number(parsed.year))
    } catch { /* v49 */ }
    if (!newLot) {
      const seq = nextK03LotSequence(withLot, parsed.code, parsed.year)
      newLot = formatK03LotNo(parsed.code, seq, parsed.year)
    }
    const nextData = {
      ...(doc.data || {}),
      k03_workflow: doc.data?.k03_workflow
        ? { ...doc.data.k03_workflow, lot_no: newLot }
        : doc.data?.k03_workflow,
      k03_edits: { ...(doc.data?.k03_edits || {}), lot_no: newLot }
    }
    const { error: updErr } = await client
      .from('haccp_documents')
      .update({ lot_no: newLot, data: nextData, updated_at: new Date().toISOString() })
      .eq('id', doc.id)
    if (updErr) throw updErr
    changed += 1
  }

  await syncK03LotSequences(client).catch(() => {})
  return { changed, duplicatesBefore: updates.length }
}
