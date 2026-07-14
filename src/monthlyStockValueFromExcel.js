/**
 * Raport magazynowy liczony wyłącznie z pliku Excel (bez bazy HACCP).
 * FIFO · data PZ / data WZ · wartość = ilość × ostatnia kolumna „Cena netto”.
 *
 * WZ rozlicza PZ o tej samej nazwie produktu co w Excelu (po normalizacji
 * spacji i polskich znaków — ta sama co przy deduplikacji importu).
 */
import {
  classifyOperation,
  resolveDocumentIssueDate,
  normalizeDocumentNo,
  isMmDocument
} from './excelImport'
import { resolveFifoProductGroup } from './k03Engine'
import { normalizeProductKey } from './reportExcelStore'

export const EXCEL_REPORT_VERSION = '2.5'

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

function displayName(name) {
  return String(name || '').trim() || 'Produkt'
}

function productKey(name) {
  return normalizeProductKey(name)
}

/** Stabilna kolejność wierszy — ta sama przy Excelu i po odczycie z Supabase. */
export function sortExcelRowsForReport(rows) {
  return [...(rows || [])].sort((a, b) => {
    const docA = normalizeDocumentNo(a.documentNo) || ''
    const docB = normalizeDocumentNo(b.documentNo) || ''
    const dateA = resolveDocumentIssueDate(a.issueDate, docA) || ''
    const dateB = resolveDocumentIssueDate(b.issueDate, docB) || ''
    const rowA = Number(a.rowNo)
    const rowB = Number(b.rowNo)
    return (
      dateA.localeCompare(dateB) ||
      docA.localeCompare(docB) ||
      (Number.isFinite(rowA) ? rowA : 0) - (Number.isFinite(rowB) ? rowB : 0) ||
      productKey(a.productName).localeCompare(productKey(b.productName)) ||
      String(a._lineId || '').localeCompare(String(b._lineId || ''))
    )
  })
}

function inPeriod(date, periodStart, periodEnd) {
  return date && date >= periodStart && date <= periodEnd
}

function simulateFifoExactName({ cutoffDate, lots, sales }) {
  const sortedSales = [...sales].sort((a, b) =>
    a.issueDate.localeCompare(b.issueDate) ||
    a.documentNo.localeCompare(b.documentNo) ||
    String(a.lineId || '').localeCompare(String(b.lineId || ''))
  )

  for (const sale of sortedSales) {
    let left = sale.qty
    const pool = lots
      .filter(l => l.productKey === sale.productKey && l.remaining_qty > 0 && l.issueDate <= cutoffDate)
      .sort((a, b) =>
        a.issueDate.localeCompare(b.issueDate) ||
        a.documentNo.localeCompare(b.documentNo) ||
        String(a.lineId || '').localeCompare(String(b.lineId || ''))
      )

    for (const lot of pool) {
      if (left <= 0.0005) break
      const take = Math.min(lot.remaining_qty, left)
      if (take <= 0) continue
      lot.remaining_qty -= take
      left -= take
    }
  }
}

function normalizeExcelRows(rows) {
  const out = []
  for (const row of rows || []) {
    if (!row.productName || !Number(row.qty)) continue
    if (isMmDocument(row.documentType, row.documentNo)) continue
    const documentNo = normalizeDocumentNo(row.documentNo)
    if (!documentNo) continue
    const operation = classifyOperation(row.documentType, documentNo)
    if (operation === 'pominiete_mm') continue
    const issueDate = resolveDocumentIssueDate(row.issueDate, documentNo)
    if (!issueDate) continue
    const unitPrice = Number(row.unitNetPrice)
    const key = productKey(row.productName)
    out.push({
      operation,
      documentNo,
      issueDate,
      productName: displayName(row.productName),
      productKey: key,
      rowNo: row.rowNo ?? null,
      lineId: row._lineId || `${operation}|${documentNo}|${key}|${row.rowNo ?? out.length}`,
      qty: Math.abs(Number(row.qty) || 0),
      unitPriceNet: unitPrice > 0 ? unitPrice : null
    })
  }
  return out
}

function ensureRow(map, key, label) {
  if (!map.has(key)) {
    map.set(key, {
      product_key: key,
      product_name: displayName(label),
      product_group: resolveFifoProductGroup(null, label),
      purchased_kg: 0,
      sold_kg: 0,
      remaining_kg: 0,
      purchased_value: 0,
      remaining_value: 0,
      purchased_missing_price_kg: 0,
      remaining_missing_price_kg: 0,
      lot_lines: []
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
  const sortedInput = sortExcelRowsForReport(excelRows)
  const lines = normalizeExcelRows(sortedInput)

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
  const lots = []
  const salesForFifo = []
  let pzLines = 0
  let wzLines = 0
  let wzAfterCutoff = 0
  let linesWithPrice = 0

  lines.forEach((line, idx) => {
    const { operation, issueDate, productName, productKey: pKey, qty, unitPriceNet, documentNo, lineId } = line

    if (operation === 'przyjecie') {
      pzLines += 1
      if (unitPriceNet != null) linesWithPrice += 1

      if (inPeriod(issueDate, monthStart, periodEnd)) {
        const row = ensureRow(periodMap, pKey, productName)
        row.purchased_kg += qty
        if (unitPriceNet != null) row.purchased_value += qty * unitPriceNet
        else row.purchased_missing_price_kg += qty
      }

      if (issueDate <= cutoffDate) {
        lots.push({
          lineId: lineId || `pz-${idx}`,
          productKey: pKey,
          productName,
          documentNo,
          issueDate,
          initial_qty: qty,
          remaining_qty: qty,
          unit_price_net: unitPriceNet
        })
      }
    } else if (operation === 'sprzedaz') {
      wzLines += 1
      if (inPeriod(issueDate, monthStart, periodEnd)) {
        ensureRow(periodMap, pKey, productName).sold_kg += qty
      }
      if (issueDate <= cutoffDate) {
        salesForFifo.push({ ...line, qty, lineId: lineId || `wz-${idx}` })
      } else {
        wzAfterCutoff += 1
      }
    }
  })

  simulateFifoExactName({ cutoffDate, lots, sales: salesForFifo })

  let missingPriceLines = 0

  for (const lot of lots) {
    const remaining = roundKg(lot.remaining_qty)
    if (remaining <= 0.0005) continue

    const row = ensureRow(periodMap, lot.productKey, lot.productName)
    row.remaining_kg += remaining

    const lineValue = lot.unit_price_net != null ? roundMoney(remaining * lot.unit_price_net) : null
    if (lineValue != null) row.remaining_value += lineValue
    else {
      missingPriceLines += 1
      row.remaining_missing_price_kg += remaining
    }

    row.lot_lines.push({
      pz_no: lot.documentNo,
      pz_date: lot.issueDate,
      qty: lot.initial_qty,
      remaining_kg: remaining,
      unit_price_net: lot.unit_price_net,
      line_value: lineValue
    })
  }

  const rows = Array.from(periodMap.values())
    .map(row => ({
      ...row,
      purchased_kg: roundKg(row.purchased_kg),
      sold_kg: roundKg(row.sold_kg),
      remaining_kg: roundKg(row.remaining_kg),
      purchased_value: roundMoney(row.purchased_value),
      remaining_value: roundMoney(row.remaining_value),
      purchased_missing_price_kg: roundKg(row.purchased_missing_price_kg),
      remaining_missing_price_kg: roundKg(row.remaining_missing_price_kg),
      lot_lines: (row.lot_lines || []).sort((a, b) =>
        String(a.pz_date || '').localeCompare(String(b.pz_date || '')) ||
        String(a.pz_no || '').localeCompare(String(b.pz_no || ''))
      )
    }))
    .filter(r => r.purchased_kg > 0.0005 || r.sold_kg > 0.0005 || r.remaining_kg > 0.0005)
    .sort((a, b) =>
      String(a.product_group || '').localeCompare(String(b.product_group || '')) ||
      String(a.product_name || '').localeCompare(String(b.product_name || ''))
    )

  const totals = {
    purchased_kg: roundKg(rows.reduce((s, r) => s + r.purchased_kg, 0)),
    sold_kg: roundKg(rows.reduce((s, r) => s + r.sold_kg, 0)),
    remaining_kg: roundKg(rows.reduce((s, r) => s + r.remaining_kg, 0)),
    purchased_value: roundMoney(rows.reduce((s, r) => s + r.purchased_value, 0)),
    remaining_value: roundMoney(rows.reduce((s, r) => s + r.remaining_value, 0))
  }

  let message = rows.length
    ? `Przeliczono z Excela: na dzień ${formatReportTitleDate(cutoffDate)} pozostało ${totals.remaining_kg.toLocaleString('pl-PL')} kg · ${totals.remaining_value.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł netto.`
    : `Brak danych do ${formatReportTitleDate(cutoffDate)} w wczytanym pliku.`

  if (linesWithPrice === 0 && pzLines > 0) {
    message += ' W pliku brak cen w ostatniej kolumnie „Cena netto” – użyj eksportu szczegółowego PZ/WZ (nie zestawienia zbiorczego).'
  } else if (missingPriceLines > 0) {
    message += ` ${missingPriceLines} linii PZ bez ceny – sprawdź ostatnią kolumnę „Cena netto”.`
  }

  if (wzAfterCutoff > 0) {
    message += ` Pominięto ${wzAfterCutoff} WZ z datą po ${formatReportTitleDate(cutoffDate)} (nie obniżają stanu na ten dzień).`
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
      inputRows: sortedInput.length,
      excelLines: lines.length,
      pzLines,
      wzLines,
      linesWithPrice,
      wzAfterCutoff,
      lotsInScope: lots.length
    },
    message
  }
  reportPayload.reportTitle = buildReportTitle(reportPayload)
  return reportPayload
}

/** Porównanie raportu z pliku vs z bazy — do weryfikacji po imporcie. */
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
    const { rows, skippedMmCount } = await readAgromarExcel(file)
    allRows.push(...(rows || []))
    fileNames.push(file.name)
    skippedMm += skippedMmCount || 0
  }

  return { rows: allRows, fileNames, skippedMm }
}
