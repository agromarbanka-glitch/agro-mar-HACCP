/**
 * Raport magazynowy liczony wyłącznie z pliku Excel (bez bazy HACCP).
 * FIFO · data PZ / data WZ · wartość = ilość × ostatnia kolumna „Cena netto”.
 *
 * Silnik v2.11.3: ilość i wartość końcowa = symulacja FIFO (WZ schodzą z najstarszego PZ).
 * Dedup raportu: ta sama operacja (nr PZ/WZ · produkt · kg) z wielu importów — tylko raz.
 * WZK: pary WZ+WZK 1:1 pomijane; WZK ujemne = przyjęcie, dodatnie = rozchód.
 * Stan początkowy miesiąca = FIFO na dzień przed 1. dniem miesiąca (np. 30.06).
 * Wartość końcowa = suma (pozostałe kg na partii PZ × cena netto tej PZ).
 * Wiersze z Supabase: bez ponownego forward-fill (sortowanie po dacie psuło daty).
 * WZ WZ/NNN/MM/RRRR: ruch w miesiącu MM z numeru (data Excel poza MM → koniec MM).
 */
import {
  classifyOperation,
  resolveDocumentIssueDate,
  normalizeDocumentNo,
  isMmDocument,
  isWzkDocument,
  isWzMonthYearDocument,
  monthYearFromDocumentNo,
  forwardFillExcelRows
} from './excelImport'
import { resolveFifoProductGroup, canonicalProductName, normalizeFifoProductKey } from './k03Engine'
import { excelRowDedupKey, normalizeProductKey, warehouseValueDedupKey } from './reportExcelStore'

export const EXCEL_REPORT_VERSION = '2.11.4'

/** Produkty porównywane z Comarch — zawsze w tabeli raportu (nawet przy saldzie 0). */
export const WATCH_REPORT_PRODUCTS = ['Jabłko przemysłowe', 'Malina świeża PW']

export function formatReportTitleDate(isoDate) {
  const d = String(isoDate || '').slice(0, 10)
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return ''
  return `${m[3]}.${m[2]}.${m[1]}r.`
}

export function buildReportTitle(report) {
  const dayLabel = formatReportTitleDate(report?.asOfDate || report?.monthEnd)
  return `Zestawienie ilościowo-wartościowe magazynu w firmie AGRO-MAR Mariusz Bańka Sp. z o.o. na dzień ${dayLabel}`
}

function monthBounds(yearMonth) {
  const m = String(yearMonth || '').match(/^(\d{4})-(\d{2})$/)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  if (month < 1 || month > 12) return null
  const lastDay = new Date(year, month, 0).getDate()
  return {
    yearMonth: `${year}-${String(month).padStart(2, '0')}`,
    monthStart: `${year}-${String(month).padStart(2, '0')}-01`,
    monthEnd: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  }
}

/** RRRR-MM-DD lub RRRR-MM (wtedy ostatni dzień miesiąca). */
export function parseAsOfDate(input) {
  const raw = String(input || '').trim()
  const full = raw.slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(full)) {
    const [y, m, d] = full.split('-').map(Number)
    const last = new Date(y, m, 0).getDate()
    if (d < 1 || d > last || m < 1 || m > 12) return null
    const monthStart = `${y}-${String(m).padStart(2, '0')}-01`
    return {
      asOfDate: full,
      monthStart,
      periodEnd: full,
      yearMonth: `${y}-${String(m).padStart(2, '0')}`
    }
  }
  const mb = monthBounds(raw.slice(0, 7))
  if (!mb) return null
  return {
    asOfDate: mb.monthEnd,
    monthStart: mb.monthStart,
    periodEnd: mb.monthEnd,
    yearMonth: mb.yearMonth
  }
}

function roundKg(n) {
  return Math.round(Number(n || 0) * 1000) / 1000
}

function roundMoney(n) {
  return Math.round(Number(n || 0) * 100) / 100
}

/** W raporcie Comarch truskawka ze szypułką wchodzi w jedną linię „Truskawka”. */
const STOCK_VALUE_MERGE_FIFO = {
  'truskawka z szypulka': 'truskawka'
}

/** Etykiety jak w Comarch (zestawienie ilościowo-wartościowe). */
const STOCK_VALUE_LABEL_BY_FIFO = {
  'malina extra': 'Malina Extra',
  'malina klasa i': 'Malina świeża 1',
  'malina pw': 'Malina świeża PW',
  'porzeczka czarna': 'Porzeczka czarna',
  'porzeczka kolorowa': 'Porzeczka kolorowa',
  truskawka: 'Truskawka',
  'wisnia klasa i': 'Wiśnia I',
  'wisnia pw': 'Wiśnia Pw'
}

function stockValueFifoKey(productName) {
  const canonical = canonicalProductName(productName)
  const fifoKey = normalizeFifoProductKey(canonical)
  return STOCK_VALUE_MERGE_FIFO[fifoKey] || fifoKey
}

export function stockValueReportProductName(productName) {
  const fifoKey = stockValueFifoKey(productName)
  return STOCK_VALUE_LABEL_BY_FIFO[fifoKey] || canonicalProductName(productName) || 'Produkt'
}

function stockValueProductKey(productName) {
  return normalizeProductKey(stockValueReportProductName(productName))
}

function displayName(name) {
  return stockValueReportProductName(name)
}

/**
 * Data ruchu dla raportu magazynowego (nie zmienia importu HACCP).
 * WZ z numerem WZ/NNN/07/2026 i datą wystawienia w sierpniu → lipiec (koniec MM z numeru).
 */
export function resolveStockValueMovementDate(issueDate, documentNo, operation) {
  const resolved = resolveDocumentIssueDate(issueDate, documentNo) || String(issueDate || '').slice(0, 10)
  if (operation !== 'sprzedaz') return resolved

  const my = monthYearFromDocumentNo(documentNo)
  if (!my || !isWzMonthYearDocument(documentNo)) return resolved

  const docYm = `${my.year}-${String(my.month).padStart(2, '0')}`
  const lastDay = new Date(my.year, my.month, 0).getDate()
  const docMonthEnd = `${docYm}-${String(lastDay).padStart(2, '0')}`

  if (!resolved) return docMonthEnd
  if (resolved.slice(0, 7) > docYm) return docMonthEnd
  return resolved
}

/** Forward-fill tylko dla świeżego Excela — wiersze z Supabase mają już issue_date. */
function prepareReportRows(excelRows) {
  const rows = excelRows || []
  if (rows.length && rows.every(r => r._lineId)) return rows
  return forwardFillExcelRows(rows)
}

function inPeriod(date, periodStart, periodEnd) {
  return date && date >= periodStart && date <= periodEnd
}

/** Dzień przed datą RRRR-MM-DD (np. 2024-07-01 → 2024-06-30). */
function dayBefore(isoDate) {
  const s = String(isoDate || '').slice(0, 10)
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return ''
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function clampStockKg(n) {
  const v = roundKg(n)
  return v < 0 ? 0 : v
}

function compareMovementLine(a, b) {
  return (
    String(a.issueDate || '').localeCompare(String(b.issueDate || '')) ||
    String(a.documentNo || '').localeCompare(String(b.documentNo || '')) ||
    (Number(a.rowNo) || 0) - (Number(b.rowNo) || 0) ||
    String(a.lineId || '').localeCompare(String(b.lineId || ''))
  )
}

/**
 * FIFO (niezmienna zasada): WZ w kolejności chronologicznej schodzą z najstarszych partii PZ.
 * @returns stan po cutoff — tylko partie PZ z faktycznym saldem > 0
 */
export function runStockValueFifoSimulation(pzLines, wzLines, cutoffDate) {
  const cutoff = String(cutoffDate || '').slice(0, 10)
  const lots = (pzLines || [])
    .filter(p => p.issueDate && p.issueDate <= cutoff)
    .sort(compareMovementLine)
    .map(p => ({
      pz_no: p.documentNo,
      pz_date: p.issueDate,
      unit_price_net: p.unitPriceNet,
      qty: roundKg(p.qty),
      remaining_kg: roundKg(p.qty)
    }))

  const wzSorted = (wzLines || [])
    .filter(w => w.issueDate && w.issueDate <= cutoff)
    .sort(compareMovementLine)

  let wzUnallocatedKg = 0
  for (const w of wzSorted) {
    let need = roundKg(w.qty)
    if (need <= 0) continue
    for (const lot of lots) {
      if (need <= 0.0005) break
      if (lot.remaining_kg <= 0.0005) continue
      const take = Math.min(lot.remaining_kg, need)
      lot.remaining_kg = roundKg(lot.remaining_kg - take)
      need = roundKg(need - take)
    }
    if (need > 0.0005) wzUnallocatedKg += need
  }

  let remainingKg = 0
  let remainingValue = 0
  let missingPriceKg = 0
  const lot_lines = []

  for (const lot of lots) {
    const rem = roundKg(lot.remaining_kg)
    if (rem <= 0.0005) continue
    remainingKg += rem
    const lineValue = lot.unit_price_net != null ? roundMoney(rem * lot.unit_price_net) : null
    if (lineValue != null) remainingValue += lineValue
    else missingPriceKg += rem
    lot_lines.push({
      pz_no: lot.pz_no,
      pz_date: lot.pz_date,
      qty: lot.qty,
      remaining_kg: rem,
      unit_price_net: lot.unit_price_net,
      line_value: lineValue
    })
  }

  return {
    remainingKg: roundKg(remainingKg),
    remainingValue: roundMoney(remainingValue),
    missingPriceKg: roundKg(missingPriceKg),
    lot_lines,
    wzUnallocatedKg: roundKg(wzUnallocatedKg)
  }
}

function rowMovementDateRaw(row, operation, documentNo) {
  return (
    resolveStockValueMovementDate(row.issueDate, documentNo, operation)
    || resolveDocumentIssueDate(row.issueDate, documentNo)
    || String(row.issueDate || '').slice(0, 10)
  )
}

/** Ten sam dokument·produkt·kg w kilku partiach importu (nakładka YTD) — do FIFO tylko pierwszy wpis. */
function dedupeCrossBatchReportRows(rows) {
  const sorted = [...(rows || [])].sort((a, b) => String(a._lineId || '').localeCompare(String(b._lineId || '')))
  const seen = new Set()
  const out = []
  let removed = 0
  for (const row of sorted) {
    const key = excelRowDedupKey(row)
    if (key) {
      if (seen.has(key)) {
        removed += 1
        continue
      }
      seen.add(key)
    }
    out.push(row)
  }
  return { rows: out, removed }
}

/** WZ + WZK (korekta) przy tym samym produkcie·miesiącu·kg → pary 1:1 pomijane w FIFO. */
function applyWzWzkPairwiseCancellation(rows) {
  const groups = new Map()
  for (const row of rows || []) {
    if (!row?.productName || !Number(row.qty)) continue
    const documentNo = normalizeDocumentNo(row.documentNo)
    if (!documentNo || isMmDocument(row.documentType, row.documentNo)) continue
    const isWzk = isWzkDocument(row.documentType, documentNo)
    const qty = roundKg(Math.abs(Number(row.qty)))
    const issueDate = rowMovementDateRaw(
      row,
      isWzk ? 'sprzedaz' : classifyOperation(row.documentType, documentNo),
      documentNo
    )
    if (!issueDate) continue
    const bucket = `${stockValueProductKey(row.productName)}|${issueDate.slice(0, 7)}|${qty}`
    if (!groups.has(bucket)) groups.set(bucket, { wz: [], wzk: [] })
    const g = groups.get(bucket)
    if (isWzk) g.wzk.push(row)
    else if (classifyOperation(row.documentType, documentNo) === 'sprzedaz') g.wz.push(row)
  }

  const skip = new Set()
  let cancelled = 0
  for (const g of groups.values()) {
    if (!g.wz.length || !g.wzk.length) continue
    const wzSorted = [...g.wz].sort((a, b) => String(a._lineId || '').localeCompare(String(b._lineId || '')))
    const wzkSorted = [...g.wzk].sort((a, b) => String(a._lineId || '').localeCompare(String(b._lineId || '')))
    const pairs = Math.min(wzSorted.length, wzkSorted.length)
    for (let i = 0; i < pairs; i++) {
      skip.add(wzSorted[i])
      skip.add(wzkSorted[i])
      cancelled += 2
    }
  }
  return {
    rows: (rows || []).filter(r => !skip.has(r)),
    cancelled
  }
}

function prepareStockValueMovementRows(excelRows) {
  let filled = prepareReportRows(excelRows || [])
  const deduped = dedupeCrossBatchReportRows(filled)
  const cancelled = applyWzWzkPairwiseCancellation(deduped.rows)
  return {
    rows: cancelled.rows,
    crossBatchDuplicatesRemoved: deduped.removed,
    wzkCancelledRows: cancelled.cancelled
  }
}

function normalizeExcelRows(rows) {
  const out = []
  for (const row of rows || []) {
    const rawQty = Number(row.qty)
    if (!row.productName || !rawQty) continue
    if (isMmDocument(row.documentType, row.documentNo)) continue
    const documentNo = normalizeDocumentNo(row.documentNo)
    if (!documentNo) continue
    const isWzk = isWzkDocument(row.documentType, documentNo)
    let operation = classifyOperation(row.documentType, documentNo)
    if (operation === 'pominiete_mm') continue
    if (isWzk) operation = rawQty < 0 ? 'przyjecie' : 'sprzedaz'
    const qty = Math.abs(rawQty)
    const rawIssueDate = resolveDocumentIssueDate(row.issueDate, documentNo) || String(row.issueDate || '').slice(0, 10)
    const issueDate = resolveStockValueMovementDate(row.issueDate, documentNo, operation)
    if (!issueDate) continue
    const unitPrice = Number(row.unitNetPrice)
    const label = displayName(row.productName)
    out.push({
      operation,
      documentNo,
      issueDate,
      rawIssueDate,
      productName: label,
      productKey: stockValueProductKey(row.productName),
      qty,
      unitPriceNet: unitPrice > 0 ? unitPrice : null,
      rowNo: row.rowNo ?? null,
      lineId: row._lineId || `x-${out.length}`
    })
  }
  return out
}

function ensureRow(map, key, label) {
  if (!map.has(key)) {
    map.set(key, {
      product_key: key,
      product_name: label,
      product_group: resolveFifoProductGroup(null, label),
      opening_kg: 0,
      purchased_kg: 0,
      sold_kg: 0,
      remaining_kg: 0,
      purchased_value: 0,
      remaining_value: 0,
      purchased_missing_price_kg: 0,
      remaining_missing_price_kg: 0,
      lot_lines: [],
      _pz: [],
      _wz: []
    })
  }
  return map.get(key)
}

/**
 * @param {Array} excelRows – wynik readAgromarExcel().rows lub odczyt z Supabase
 * @param {string} asOfDate – RRRR-MM-DD (lub RRRR-MM → ostatni dzień miesiąca)
 */
export function computeMonthlyStockValueReportFromExcel(excelRows, asOfDate, { fileNames = [] } = {}) {
  const bounds = parseAsOfDate(asOfDate)
  if (!bounds) {
    return {
      source: 'excel',
      asOfDate: asOfDate || '',
      rows: [],
      totals: { purchased_kg: 0, sold_kg: 0, remaining_kg: 0, purchased_value: 0, remaining_value: 0 },
      reportTitle: '',
      message: 'Wybierz poprawną datę (RRRR-MM-DD).'
    }
  }

  const { monthStart, periodEnd, yearMonth } = bounds
  const cutoffDate = bounds.asOfDate
  const openingCutoff = dayBefore(monthStart)
  const prepared = prepareStockValueMovementRows(excelRows)
  const lines = normalizeExcelRows(prepared.rows)

  if (!lines.length) {
    return {
      source: 'excel',
      asOfDate: cutoffDate,
      yearMonth,
      monthStart,
      monthEnd: cutoffDate,
      periodEnd,
      fileNames,
      rows: [],
      totals: { purchased_kg: 0, sold_kg: 0, remaining_kg: 0, purchased_value: 0, remaining_value: 0 },
      message: fileNames.length
        ? 'W pliku nie znaleziono pozycji PZ/WZ z produktem i ilością.'
        : 'Wgraj plik Excel z operacjami magazynowymi (PZ/WZ) i kliknij „Przelicz”.'
    }
  }

  const periodMap = new Map()
  let pzLines = 0
  let wzLines = 0
  let wzAfterCutoff = 0
  let wzClampedToDocMonth = 0
  let linesWithPrice = 0
  let fifoWzUnallocatedKg = 0
  let productsFifoOversell = 0

  lines.forEach((line) => {
    const { operation, issueDate, productName, productKey, qty, unitPriceNet, documentNo } = line
    const row = ensureRow(periodMap, productKey, productName)

    if (operation === 'przyjecie') {
      pzLines += 1
      if (unitPriceNet != null) linesWithPrice += 1
      row._pz.push(line)
      if (inPeriod(issueDate, monthStart, periodEnd)) {
        row.purchased_kg += qty
        if (unitPriceNet != null) row.purchased_value += qty * unitPriceNet
        else row.purchased_missing_price_kg += qty
      }
    } else if (operation === 'sprzedaz') {
      wzLines += 1
      const rawDate = line.rawIssueDate || issueDate
      if (
        rawDate && issueDate !== rawDate
        && isWzMonthYearDocument(documentNo)
        && issueDate.slice(0, 7) < rawDate.slice(0, 7)
      ) {
        wzClampedToDocMonth += 1
      }
      if (issueDate > cutoffDate) wzAfterCutoff += 1
      else row._wz.push(line)
      if (inPeriod(issueDate, monthStart, periodEnd)) row.sold_kg += qty
    }
  })

  let missingPriceLines = 0

  for (const row of periodMap.values()) {
    const openingFifo = openingCutoff
      ? runStockValueFifoSimulation(row._pz, row._wz, openingCutoff)
      : { remainingKg: 0, remainingValue: 0, missingPriceKg: 0, lot_lines: [], wzUnallocatedKg: 0 }
    const closingFifo = runStockValueFifoSimulation(row._pz, row._wz, cutoffDate)

    if (closingFifo.wzUnallocatedKg > 0.0005) {
      productsFifoOversell += 1
      fifoWzUnallocatedKg += closingFifo.wzUnallocatedKg
    }

    row.opening_kg = clampStockKg(openingFifo.remainingKg)
    row.remaining_kg = clampStockKg(closingFifo.remainingKg)
    row.remaining_value = closingFifo.remainingValue
    row.remaining_missing_price_kg = closingFifo.missingPriceKg
    row.lot_lines = closingFifo.lot_lines

    if (row.remaining_kg > 0 && closingFifo.missingPriceKg > 0.0005) {
      missingPriceLines += 1
    }
  }

  const rows = Array.from(periodMap.values())
    .map(row => ({
      product_key: row.product_key,
      product_name: row.product_name,
      product_group: row.product_group,
      opening_kg: roundKg(row.opening_kg),
      purchased_kg: roundKg(row.purchased_kg),
      sold_kg: roundKg(row.sold_kg),
      remaining_kg: roundKg(row.remaining_kg),
      purchased_value: roundMoney(row.purchased_value),
      remaining_value: roundMoney(row.remaining_value),
      purchased_missing_price_kg: roundKg(row.purchased_missing_price_kg),
      remaining_missing_price_kg: roundKg(row.remaining_missing_price_kg),
      lot_lines: row.lot_lines || []
    }))
    .filter(r =>
      r.opening_kg > 0.0005
      || r.purchased_kg > 0.0005
      || r.sold_kg > 0.0005
      || r.remaining_kg > 0.0005
      || WATCH_REPORT_PRODUCTS.includes(r.product_name)
    )
    .sort((a, b) =>
      String(a.product_group || '').localeCompare(String(b.product_group || '')) ||
      String(a.product_name || '').localeCompare(String(b.product_name || ''))
    )

  for (const watchName of WATCH_REPORT_PRODUCTS) {
    if (rows.some(r => r.product_name === watchName)) continue
    const key = stockValueProductKey(watchName)
    const src = periodMap.get(key)
    if (!src) continue
    rows.push({
      product_key: src.product_key,
      product_name: src.product_name,
      product_group: src.product_group,
      opening_kg: roundKg(src.opening_kg),
      purchased_kg: roundKg(src.purchased_kg),
      sold_kg: roundKg(src.sold_kg),
      remaining_kg: roundKg(src.remaining_kg),
      purchased_value: roundMoney(src.purchased_value),
      remaining_value: roundMoney(src.remaining_value),
      purchased_missing_price_kg: roundKg(src.purchased_missing_price_kg),
      remaining_missing_price_kg: roundKg(src.remaining_missing_price_kg),
      lot_lines: src.lot_lines || []
    })
    rows.sort((a, b) =>
      String(a.product_group || '').localeCompare(String(b.product_group || '')) ||
      String(a.product_name || '').localeCompare(String(b.product_name || ''))
    )
  }

  const watchDiag = WATCH_REPORT_PRODUCTS.map(name => {
    const key = stockValueProductKey(name)
    const src = periodMap.get(key)
    const row = rows.find(r => r.product_name === name)
    const pzKg = roundKg((src?._pz || []).reduce((s, l) => s + l.qty, 0))
    const wzKg = roundKg((src?._wz || []).reduce((s, l) => s + l.qty, 0))
    return {
      product_name: name,
      remaining_kg: row?.remaining_kg ?? 0,
      net_sigma_kg: roundKg(pzKg - wzKg),
      pz_kg: pzKg,
      wz_kg: wzKg,
      comarch_target_kg: name === 'Malina świeża PW' ? 53410.5 : name === 'Jabłko przemysłowe' ? 11378 : null
    }
  })

  const totals = {
    opening_kg: roundKg(rows.reduce((s, r) => s + r.opening_kg, 0)),
    purchased_kg: roundKg(rows.reduce((s, r) => s + r.purchased_kg, 0)),
    sold_kg: roundKg(rows.reduce((s, r) => s + r.sold_kg, 0)),
    remaining_kg: roundKg(rows.reduce((s, r) => s + r.remaining_kg, 0)),
    purchased_value: roundMoney(rows.reduce((s, r) => s + r.purchased_value, 0)),
    remaining_value: roundMoney(rows.reduce((s, r) => s + r.remaining_value, 0))
  }

  let message = rows.length
    ? `Przeliczono: stan na ${formatReportTitleDate(cutoffDate)} = ${totals.remaining_kg.toLocaleString('pl-PL')} kg (FIFO — WZ z najstarszego PZ). Stan początkowy ${formatReportTitleDate(openingCutoff)}: ${totals.opening_kg.toLocaleString('pl-PL')} kg.`
    : `Brak danych do ${formatReportTitleDate(cutoffDate)} w wczytanym pliku.`

  if (linesWithPrice === 0 && pzLines > 0) {
    message += ' W pliku brak cen w ostatniej kolumnie „Cena netto” – użyj eksportu szczegółowego PZ/WZ (nie zestawienia zbiorczego).'
  } else if (missingPriceLines > 0) {
    message += ` ${missingPriceLines} linii PZ bez ceny – sprawdź ostatnią kolumnę „Cena netto”.`
  }

  if (wzAfterCutoff > 0) {
    message += ` Pominięto ${wzAfterCutoff} WZ z datą po ${formatReportTitleDate(cutoffDate)} (nie obniżają stanu na ten dzień).`
  }
  if (wzClampedToDocMonth > 0) {
    message += ` ${wzClampedToDocMonth} WZ z numerem lipca/sierpnia przypisano do miesiąca z numeru dokumentu (zgodnie z Comarch).`
  }
  if (fifoWzUnallocatedKg > 0.0005) {
    message += ` Uwaga FIFO: ${productsFifoOversell} produkt(ów) ma WZ bez pokrycia w PZ (łącznie ${fifoWzUnallocatedKg.toLocaleString('pl-PL')} kg) — sprawdź import lub podwójne WZ.`
  }
  if (prepared.crossBatchDuplicatesRemoved > 0) {
    message += ` Pominięto ${prepared.crossBatchDuplicatesRemoved} powtórnych operacji (ten sam nr PZ/WZ·produkt·kg z kolejnego importu).`
  }
  if (prepared.wzkCancelledRows > 0) {
    message += ` Anulowano ${prepared.wzkCancelledRows} linii w parach WZ+WZK.`
  }
  for (const w of watchDiag) {
    if (w.comarch_target_kg == null) continue
    const delta = roundKg(w.remaining_kg - w.comarch_target_kg)
    if (Math.abs(delta) > 50) {
      message += ` ${w.product_name}: FIFO ${w.remaining_kg.toLocaleString('pl-PL')} kg (cel Comarch ${w.comarch_target_kg.toLocaleString('pl-PL')}) · w bazie Σ PZ−WZ=${w.net_sigma_kg.toLocaleString('pl-PL')} kg.`
    }
  }

  const reportPayload = {
    source: 'excel',
    asOfDate: cutoffDate,
    asOfDatePl: formatReportTitleDate(cutoffDate),
    yearMonth,
    monthStart,
    monthEnd: cutoffDate,
    periodEnd,
    fileNames,
    rows,
    totals,
    missingPriceLines,
    hasPriceColumn: true,
    diagnostics: {
      inputRows: (excelRows || []).length,
      filledRows: prepared.rows.length,
      crossBatchDuplicatesRemoved: prepared.crossBatchDuplicatesRemoved,
      wzkCancelledRows: prepared.wzkCancelledRows,
      watchDiag,
      excelLines: lines.length,
      pzLines,
      wzLines,
      linesWithPrice,
      wzAfterCutoff,
      wzClampedToDocMonth,
      openingCutoff,
      fifoWzUnallocatedKg,
      productsFifoOversell,
      engine: 'fifo_pz_consumption_v211'
    },
    message
  }
  reportPayload.reportTitle = buildReportTitle(reportPayload)
  return reportPayload
}

/** Porównanie raportu z pliku vs z bazy — weryfikacja po imporcie. */
export function compareStockValueReports(a, b) {
  const fields = ['remaining_kg', 'remaining_value', 'purchased_kg', 'sold_kg']
  const diffs = []
  const mapB = new Map((b?.rows || []).map(r => [r.product_key || r.product_name, r]))
  for (const row of a?.rows || []) {
    const key = row.product_key || row.product_name
    const other = mapB.get(key)
    if (!other) {
      diffs.push({ product: row.product_name, issue: 'brak w porównaniu' })
      continue
    }
    for (const f of fields) {
      const d = Math.abs(Number(row[f] || 0) - Number(other[f] || 0))
      if (d > 0.01) {
        diffs.push({ product: row.product_name, field: f, a: row[f], b: other[f] })
      }
    }
  }
  return {
    ok: diffs.length === 0,
    diffs,
    totalsA: a?.totals,
    totalsB: b?.totals
  }
}

export async function parseExcelFilesForReport(files) {
  const { readAgromarExcel } = await import('./excelImport')
  const list = [...(files || [])].filter(Boolean)
  const allRows = []
  const fileNames = []
  let skippedMm = 0

  for (const file of list) {
    const { rows, skippedMmCount } = await readAgromarExcel(file, { includeUnitPrice: true })
    allRows.push(...(rows || []))
    fileNames.push(file.name)
    skippedMm += skippedMmCount || 0
  }

  return { rows: allRows, fileNames, skippedMm }
}

function lineContentKey(line) {
  return `${line.operation}|${line.documentNo}|${line.productKey}|${line.qty}|${line.issueDate}`
}

/** Klucz dedup identyczny jak przy zapisie do Supabase. */
function dedupKeyFromRawRow(row, sourceFile = '') {
  if (!row?.productName || !Number(row.qty)) return null
  const documentNo = normalizeDocumentNo(row.documentNo)
  if (!documentNo) return null
  const operation = classifyOperation(row.documentType, documentNo)
  if (operation === 'pominiete_mm') return null
  const opKind = operation === 'sprzedaz' ? 'sprzedaz' : 'przyjecie'
  const issueDate = resolveStockValueMovementDate(row.issueDate, documentNo, opKind)
    || resolveDocumentIssueDate(row.issueDate, documentNo)
    || String(row.issueDate || '').slice(0, 10)
  if (!issueDate || issueDate === '0000-01-01') return null
  return warehouseValueDedupKey({ ...row, documentNo, issueDate }, { sourceFile })
}

/** Statystyki PZ/WZ wg miesiąca ruchu (do audytu importu). */
export function computeWarehouseValueMonthStats(excelRows) {
  const filled = prepareStockValueMovementRows(excelRows).rows
  const lines = normalizeExcelRows(filled)
  const byMonth = new Map()
  for (const line of lines) {
    const ym = String(line.issueDate || '').slice(0, 7)
    if (!ym) continue
    if (!byMonth.has(ym)) {
      byMonth.set(ym, { yearMonth: ym, pzLines: 0, wzLines: 0, pzKg: 0, wzKg: 0 })
    }
    const bucket = byMonth.get(ym)
    if (line.operation === 'przyjecie') {
      bucket.pzLines += 1
      bucket.pzKg += line.qty
    } else if (line.operation === 'sprzedaz') {
      bucket.wzLines += 1
      bucket.wzKg += line.qty
    }
  }
  return [...byMonth.values()]
    .map(m => ({
      ...m,
      pzKg: roundKg(m.pzKg),
      wzKg: roundKg(m.wzKg)
    }))
    .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth))
}

/**
 * Porównanie wierszy Excel (po forward-fill) z danymi w Supabase.
 * Wykrywa brakujące linie w bazie i wiersze pominięte przy imporcie (brak daty).
 */
export function auditWarehouseValueImport(excelRows, dbRows, { yearMonth = '', parsedFiles = [] } = {}) {
  const dbLines = normalizeExcelRows(prepareReportRows(dbRows || []))

  const excelDedup = new Map()
  let excelLines = []

  const fileParts = (parsedFiles || []).length
    ? parsedFiles
    : [{ fileName: '', rows: excelRows || [] }]

  for (const { fileName, rows } of fileParts) {
    const filled = prepareReportRows(rows || [])
    excelLines = excelLines.concat(normalizeExcelRows(filled))
    for (const row of filled) {
      const key = dedupKeyFromRawRow(row, fileName)
      if (!key || excelDedup.has(key)) continue
      const norm = normalizeExcelRows([row])[0]
      if (norm) excelDedup.set(key, { ...norm, _dedupKey: key, _raw: row })
    }
  }

  const dbDedup = new Set()
  for (const row of dbRows || []) {
    const key = dedupKeyFromRawRow(row, row._batchSourceFile || '')
    if (key) dbDedup.add(key)
  }

  const missingInDb = []
  for (const [key, line] of excelDedup) {
    if (!dbDedup.has(key)) missingInDb.push(line)
  }

  const extraInDb = []
  for (const row of dbRows || []) {
    const key = dedupKeyFromRawRow(row, row._batchSourceFile || '')
    if (key && !excelDedup.has(key)) {
      const norm = normalizeExcelRows([row])[0]
      if (norm) extraInDb.push(norm)
    }
  }

  const dedupMissingCount = missingInDb.length
  const alreadyInDbCount = excelDedup.size - dedupMissingCount

  const filterMonth = (lines) => {
    if (!yearMonth) return lines
    return lines.filter(l => String(l.issueDate || '').startsWith(yearMonth))
  }

  const missingMonth = filterMonth(missingInDb)
  const missingMonthKg = {
    pz: roundKg(missingMonth.filter(l => l.operation === 'przyjecie').reduce((s, l) => s + l.qty, 0)),
    wz: roundKg(missingMonth.filter(l => l.operation === 'sprzedaz').reduce((s, l) => s + l.qty, 0))
  }

  const skippedNoDate = []
  for (const { fileName, rows } of fileParts) {
    const filledPart = prepareReportRows(rows || [])
    for (const row of filledPart) {
    if (!row.productName || !Number(row.qty)) continue
    if (isMmDocument(row.documentType, row.documentNo)) continue
    const documentNo = normalizeDocumentNo(row.documentNo)
    if (!documentNo) continue
    const operation = classifyOperation(row.documentType, documentNo)
    if (operation === 'pominiete_mm') continue
    const rawDate = resolveDocumentIssueDate(row.issueDate, documentNo)
    const moveDate = resolveStockValueMovementDate(row.issueDate, documentNo, operation)
    if (!moveDate) {
      skippedNoDate.push({ documentNo, productName: row.productName, qty: row.qty, operation, fileName })
    } else if (!rawDate && operation === 'sprzedaz') {
      skippedNoDate.push({
        documentNo,
        productName: row.productName,
        qty: row.qty,
        operation,
        inferredDate: moveDate,
        fileName
      })
    }
    }
  }

  const excelStats = computeWarehouseValueMonthStats(excelRows)
  const dbStats = computeWarehouseValueMonthStats(dbRows)
  const dbByMonth = new Map(dbStats.map(m => [m.yearMonth, m]))
  const monthGaps = excelStats.map(ex => {
    const db = dbByMonth.get(ex.yearMonth) || { pzLines: 0, wzLines: 0, pzKg: 0, wzKg: 0 }
    return {
      yearMonth: ex.yearMonth,
      excel: ex,
      db,
      missingPzKg: roundKg(ex.pzKg - db.pzKg),
      missingWzKg: roundKg(ex.wzKg - db.wzKg),
      missingPzLines: ex.pzLines - db.pzLines,
      missingWzLines: ex.wzLines - db.wzLines
    }
  }).filter(g => Math.abs(g.missingPzKg) > 0.01 || Math.abs(g.missingWzKg) > 0.01
    || g.missingPzLines !== 0 || g.missingWzLines !== 0)

  let summary = `Excel: ${excelLines.length} linii (${excelDedup.size} unikalnych kluczy) · baza: ${dbLines.length} linii`
  if (dedupMissingCount) summary += ` · brakuje w bazie: ${dedupMissingCount} (wg klucza importu)`
  else if (alreadyInDbCount > 0 && excelDedup.size > dbLines.length) {
    summary += ` · w Excelu więcej wierszy niż w bazie, ale klucze importu się pokrywają — użyj tych samych plików co w liście importów`
  }
  if (missingMonth.length && yearMonth) {
    summary += ` · brakuje w ${yearMonth}: ${missingMonth.length} linii (${missingMonthKg.wz.toLocaleString('pl-PL')} kg WZ, ${missingMonthKg.pz.toLocaleString('pl-PL')} kg PZ)`
  }

  return {
    ok: dedupMissingCount === 0 && skippedNoDate.length === 0,
    summary,
    excelLineCount: excelLines.length,
    excelDedupCount: excelDedup.size,
    dbLineCount: dbLines.length,
    missingInDbCount: dedupMissingCount,
    alreadyInDbCount,
    missingInDb: missingInDb.slice(0, 40),
    missingMonth,
    missingMonthKg,
    extraInDbCount: extraInDb.length,
    skippedNoDate,
    monthGaps,
    excelStats,
    dbStats
  }
}
