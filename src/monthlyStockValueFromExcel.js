/**
 * Raport magazynowy liczony wyłącznie z pliku Excel (bez bazy).
 * FIFO · data PZ / data WZ · wartość = ilość × ostatnia kolumna „Cena netto”.
 *
 * WZ rozlicza PZ wg wariantu produktu (jak magazyn K03/HACCP):
 * np. WZ „Truskawka” może brać z PZ „Truskawka z szypułką”, ale nie odwrotnie.
 */
import {
  classifyOperation,
  resolveDocumentIssueDate,
  normalizeDocumentNo,
  isMmDocument
} from './excelImport'
import { resolveFifoProductGroup, normalizeFifoProductKey, FIFO_SALE_SOURCE_KEYS } from './k03Engine'

export const EXCEL_REPORT_VERSION = '2.6'

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

const FIFO_DISPLAY_LABELS = {
  truskawka: 'Truskawka',
  'truskawka z szypulka': 'Truskawka z szypułką',
  'malina pw': 'Malina świeża PW',
  'malina klasa i': 'Malina klasa I',
  'malina extra': 'Malina extra',
  'malina pulpa': 'Malina pulpa',
  'porzeczka czarna': 'Porzeczka czarna',
  'porzeczka czerwona': 'Porzeczka kolorowa',
  'porzeczka czarna pulpa': 'Porzeczka czarna pulpa',
  'porzeczka czerwona pulpa': 'Porzeczka kolorowa pulpa',
  wisnia: 'Wiśnia',
  aronia: 'Aronia',
  sliwka: 'Śliwka',
  'jablko obierka': 'Jabłko na obierkę',
  'jablko przemyslowe': 'Jabłko przemysłowe'
}

function fifoRowLabel(productKey, rawName) {
  return FIFO_DISPLAY_LABELS[productKey] || displayName(rawName)
}

function fifoSaleSourceKeys(productKey) {
  return FIFO_SALE_SOURCE_KEYS[productKey] || [productKey]
}

function inPeriod(date, periodStart, periodEnd) {
  return date && date >= periodStart && date <= periodEnd
}

function simulateFifoWithSources({ cutoffDate, lots, sales }) {
  const sortedSales = [...sales].sort((a, b) =>
    a.issueDate.localeCompare(b.issueDate) ||
    a.documentNo.localeCompare(b.documentNo)
  )

  for (const sale of sortedSales) {
    let left = sale.qty
    const allowedSources = new Set(fifoSaleSourceKeys(sale.productKey))
    const pool = lots
      .filter(l => allowedSources.has(l.productKey) && l.remaining_qty > 0 && l.issueDate <= cutoffDate)
      .sort((a, b) =>
        a.issueDate.localeCompare(b.issueDate) ||
        a.documentNo.localeCompare(b.documentNo) ||
        a.lineId.localeCompare(b.lineId)
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
    out.push({
      operation,
      documentNo,
      issueDate,
      productName: fifoRowLabel(normalizeFifoProductKey(row.productName), row.productName),
      productKey: normalizeFifoProductKey(row.productName),
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
      product_name: fifoRowLabel(key, label),
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
 * @param {Array} excelRows – wynik readAgromarExcel().rows
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
  const lines = normalizeExcelRows(excelRows)

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
    const { operation, issueDate, productName, productKey, qty, unitPriceNet, documentNo } = line

    if (operation === 'przyjecie') {
      pzLines += 1
      if (unitPriceNet != null) linesWithPrice += 1

      if (inPeriod(issueDate, monthStart, periodEnd)) {
        const row = ensureRow(periodMap, productKey, productName)
        row.purchased_kg += qty
        if (unitPriceNet != null) row.purchased_value += qty * unitPriceNet
        else row.purchased_missing_price_kg += qty
      }

      if (issueDate <= cutoffDate) {
        lots.push({
          lineId: `pz-${idx}`,
          productKey,
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
        ensureRow(periodMap, productKey, productName).sold_kg += qty
      }
      if (issueDate <= cutoffDate) {
        salesForFifo.push({ ...line, qty })
      } else {
        wzAfterCutoff += 1
      }
    }
  })

  simulateFifoWithSources({ cutoffDate, lots, sales: salesForFifo })

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
