/**
 * K03 – identyfikacja partii produktu (WZ ↔ PZ wg FIFO).
 * Jeden formularz = jedna pozycja WZ (operacja + produkt).
 */

export const K03_ENGINE_VERSION = '3.7'

const PRODUCT_CODES = new Map([
  ['malina pulpa', 'Mp'], ['porzeczka czarna', 'Pcz'], ['porzeczka czarna pulpa', 'Pczp'],
  ['porzeczka czerwona', 'Pk'], ['porzeczka czerwona pulpa', 'Pkp'], ['truskawka', 'T'],
  ['truskawka z szypulka', 'Tsz'], ['aronia', 'A'], ['sliwka', 'S'], ['wisnia', 'W'],
  ['malina klasa i', 'M1'], ['malina extra', 'Mex'], ['jablko obierka', 'Jabobier'],
  ['jablko na obierke', 'Jabobier'], ['jablko przemyslowe', 'Jab'], ['jablko', 'Jab']
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
  const text = String(productName || 'Produkt')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-zA-Z0-9]/g, '')
  return (text.slice(0, 8) || 'X')
}

export function formatK03PzNo(row) {
  const raw = String(row?.pz_no_display ?? row?.pz_no ?? row?.source_lot_no ?? '').trim()
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
  if (/^[a-z]\d+\/\d{3}\/\d{4}$/i.test(text)) return ''
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

function assignFinishedLotNumbers(forms, productMap) {
  const counters = new Map()
  const sorted = [...(forms || [])].sort((a, b) =>
    String(a.document_date || '').localeCompare(String(b.document_date || '')) ||
    String(a.document_no || '').localeCompare(String(b.document_no || '')) ||
    String(a.product_name || '').localeCompare(String(b.product_name || ''))
  )
  const lotById = new Map()
  for (const form of sorted) {
    const product = productMap?.get?.(form.data?.product_id)
    const year = String(form.document_date || '').slice(0, 4) || String(new Date().getFullYear())
    const productKey = form.data?.product_id || normalizeText(form.product_name || 'produkt')
    const counterKey = `${productKey}|${year}`
    const seq = (counters.get(counterKey) || 0) + 1
    counters.set(counterKey, seq)
    const code = inferProductCode(form.product_name, product)
    lotById.set(form.id, `${code}/${String(seq).padStart(3, '0')}/${year}`)
  }
  return (forms || []).map(form => lotById.has(form.id) ? { ...form, lot_no: lotById.get(form.id) } : form)
}

function finalizeK03LotNumbers(forms, productMap, outputLotByKey = new Map()) {
  const toAssign = []
  const withDbLot = (forms || []).map(form => {
    const dbKey = `${form.data?.sale_operation_id}|${form.data?.product_id || 'null'}`
    const fromDb = outputLotByKey.get(dbKey)
    if (fromDb) return { ...form, lot_no: fromDb }
    toAssign.push(form)
    return form
  })
  if (!toAssign.length) return withDbLot
  const assigned = assignFinishedLotNumbers(toAssign, productMap)
  const assignedMap = new Map(assigned.map(f => [f.id, f.lot_no]))
  return withDbLot.map(form => assignedMap.has(form.id) ? { ...form, lot_no: assignedMap.get(form.id) } : form)
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
    const pzNo = formatK03PzNo(r) || (r.isShortage ? (r.pz_no || '') : '')
    return {
      lp: i + 1,
      pzNo,
      pzDate: r.pz_date || '',
      dostawca: pzNo,
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

export function productGroupForName(productName) {
  const text = normalizeText(productName)
  if (text.includes('malin')) return 'malina'
  if (text.includes('wisn')) return 'wisnia'
  if (text.includes('porzeczka czarna')) return 'porzeczka_czarna'
  if (text.includes('porzeczka czerwona')) return 'porzeczka_czerwona'
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

/** Grupa FIFO/K03 – zawsze po nazwie produktu, nie po kodzie (T, M1…) w product_group. */
export function resolveFifoProductGroup(product, productName = '', lotGroup = '') {
  const byName = productGroupForName(product?.name || productName || '')
  if (CANONICAL_PRODUCT_GROUPS.has(byName) && byName !== 'inna') return byName
  const stored = String(product?.product_group || lotGroup || '').trim()
  if (CANONICAL_PRODUCT_GROUPS.has(stored)) return stored
  const byStored = productGroupForName(stored)
  if (CANONICAL_PRODUCT_GROUPS.has(byStored) && byStored !== 'inna') return byStored
  return byName || stored || 'inna'
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
  const productName = product?.name || saleLine.raw_product_name || 'Produkt'
  const productGroup = resolveProductGroup(product, productName)
  const wzNo = saleDocumentNo(op) || saleLine.document_no || `OP-${String(saleLine.operation_id || '').slice(0, 8)}`
  const wzDate = saleOperationDate(op) || saleLine.issue_date || '0000-01-01'
  const saleQty = Number(saleLine.qty || 0)
  const receiver = formatK03Receiver(contractorMap.get(op?.contractor_id)?.name || saleLine.receiver_name || '')
  const cutoffDate = String(fifoCutoffDate || wzDate || '').slice(0, 10)

  const incomingRows = (pzRows || []).filter(r => Number(r.qty || 0) > 0)
  let excludedFuturePzRows = []
  let rawRowsBase = incomingRows
  if (cutoffDate && cutoffDate !== '0000-01-01') {
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
  )

  const excludedFuturePz = excludedFuturePzRows.length > 0
  const excludedFuturePzQty = excludedFuturePzRows.reduce((sum, r) => sum + Number(r.qty || 0), 0)

  const allocatedTotal = rawRowsBase.reduce((sum, r) => sum + Number(r.qty || 0), 0)
  const shortage = Math.max(0, Math.round((saleQty - allocatedTotal) * 1000) / 1000)
  const cutoffLabel = cutoffDate !== '0000-01-01' ? cutoffDate : wzDate
  const rawRows = shortage > 0
    ? [...rawRowsBase, {
      pz_no: source === 'excel' ? 'Zapisz do bazy i przelicz FIFO' : 'BRAK SUROWCA',
      pz_date: cutoffLabel && cutoffLabel !== '0000-01-01' ? `≤ ${cutoffLabel}` : '',
      supplier: source === 'excel' ? '—' : `brakuje ${shortage.toLocaleString('pl-PL')} kg na stanie`,
      qty: shortage,
      source_lot_no: '',
      isShortage: true
    }]
    : rawRowsBase

  const rawTotal = rawRows.reduce((sum, r) => sum + Number(r.qty || 0), 0)
  const quantityWarningAccepted = workflow?.quantity_warning_accepted === true
  const quantitiesMatch = source === 'excel'
    ? false
    : (Math.abs(rawTotal - saleQty) < 0.001 && shortage <= 0) || quantityWarningAccepted
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

  const sourceLotIds = Array.from(new Set(allocations.map(a => a.source_lot_id).filter(Boolean)))
  const sourceLots = sourceLotIds.length
    ? await fetchInChunks(client, 'lots', 'id, lot_no, production_date, source_operation_id, product_id', 'id', sourceLotIds)
    : []
  const sourceOpIds = Array.from(new Set(sourceLots.map(l => l.source_operation_id).filter(Boolean)))
  const sourceOps = sourceOpIds.length
    ? await fetchInChunks(client, 'operations', 'id, operation_date, document_no, invoice_no, contractor_id', 'id', sourceOpIds)
    : []
  const contractorIds = Array.from(new Set([
    ...Array.from(saleOpIds).map(id => opMap.get(id)?.contractor_id),
    ...sourceOps.map(o => o.contractor_id)
  ].filter(Boolean)))
  const contractors = contractorIds.length
    ? await fetchInChunks(client, 'contractors', 'id, name', 'id', contractorIds)
    : []

  const lotMap = new Map(sourceLots.map(l => [l.id, l]))
  const sourceOpMap = new Map(sourceOps.map(o => [o.id, o]))
  const contractorMap = new Map(contractors.map(c => [c.id, c]))

  const pzBySaleKey = new Map()
  for (const alloc of allocations) {
    if (!saleOpIds.has(alloc.operation_id)) continue
    const lot = lotMap.get(alloc.source_lot_id) || {}
    const pzOp = sourceOpMap.get(lot.source_operation_id) || {}
    const qty = Number(alloc.qty || 0)
    if (qty <= 0) continue
    const sale = Array.from(saleLines.values()).find(s =>
      s.operation_id === alloc.operation_id &&
      (s.product_id === alloc.product_id || (!s.product_id && !alloc.product_id))
    )
    const key = sale?.key || saleLineKey(alloc.operation_id, alloc.product_id)
    const wzDate = String(sale?.op?.operation_date || '').slice(0, 10)
    const pzDate = String(pzOp.operation_date || lot.production_date || '').slice(0, 10)
    if (wzDate && wzDate !== '0000-01-01' && pzDate && pzDate !== '0000-01-01' && pzDate > wzDate) continue
    if (!pzBySaleKey.has(key)) pzBySaleKey.set(key, [])
    pzBySaleKey.get(key).push({
      pz_no: pzOp.document_no || lot.lot_no || '',
      pz_date: pzDate,
      supplier: '',
      qty,
      source_lot_no: lot.lot_no || ''
    })
  }

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
      .map(line => buildK03FormDoc(line, pzBySaleKey.get(line.key) || [], productMap, contractorMap, 'baza'))
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
    }
    if (patch.pz_date != null) next.pz_date = patch.pz_date
    if (patch.supplier != null) next.supplier = patch.supplier
    return next
  })
}

export function applyK03DocEdits(doc, edits = {}) {
  if (!doc || !edits || !Object.keys(edits).length) return doc

  const wzDate = edits.wz_date ?? edits.document_date ?? doc.document_date
  const lotNo = edits.lot_no ?? doc.lot_no
  const signed = edits.signed_by_operator ?? doc.signed_by_operator ?? ''
  const rawRows = Array.isArray(edits.rawRows)
    ? edits.rawRows
    : applyRawRowPatches(doc.data?.rawRows, edits.rawRowPatches)

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
      saleRows
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

  const { data: existingRows, error: findErr } = await client
    .from('haccp_documents')
    .select('id, data')
    .eq('document_type', 'K03')
    .limit(10000)
  if (findErr) throw findErr
  const existing = (existingRows || []).find(r => r.data?.k03_key === doc.id)

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
