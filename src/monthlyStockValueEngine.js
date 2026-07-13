/**
 * Raport ilościowo-wartościowy magazynu na koniec miesiąca.
 *
 * Tylko dla zakładki Raporty – nie zmienia silnika HACCP/FIFO.
 *
 * Zasady:
 * - Przyjęcia: data PZ (operation_date dokumentu PZ / data partii).
 * - Sprzedaż: data WZ (operation_date dokumentu WZ) – NIE data przerobu K03.
 *   WZ z 01.07 z przerobem w czerwcu na stanie 30.06 nadal jest na magazynie.
 * - Rozliczenie ilości: FIFO do ostatniego dnia miesiąca.
 * - Wartość netto: pozostała ilość × cena netto z linii PZ (import Excel).
 */
import {
  isSaleOperation,
  resolveFifoProductGroup,
  resolveFifoMatchSpec,
  fifoLotMatchesMatchSpec
} from './k03Engine'
import { lotReceiptDate } from './fifoEngine'
import { buildReportTitle } from './monthlyStockValueFromExcel'

export const MONTHLY_STOCK_VALUE_VERSION = '1.3'

async function loadDirectionItems(client, direction) {
  const full = 'id, operation_id, product_id, qty, direction, raw_product_name, lot_id, unit_price_net'
  const basic = 'id, operation_id, product_id, qty, direction, raw_product_name, lot_id'
  let res = await client.from('operation_items').select(full).eq('direction', direction).limit(50000)
  if (res.error && /unit_price_net|column/.test(String(res.error.message || ''))) {
    res = await client.from('operation_items').select(basic).eq('direction', direction).limit(50000)
    if (res.error) throw res.error
    return { data: res.data || [], hasPriceColumn: false }
  }
  if (res.error) throw res.error
  return { data: res.data || [], hasPriceColumn: true }
}

async function loadReportData(client) {
  const selectLotsFull = 'id, lot_no, product_id, product_group, production_date, created_at, initial_qty, remaining_qty, source_operation_id, status, unit_price_net'
  const selectLotsBasic = 'id, lot_no, product_id, product_group, production_date, created_at, initial_qty, remaining_qty, source_operation_id, status'

  let lotsRes = await client.from('lots').select(selectLotsFull).limit(50000)
  let lotsHasPrice = true
  if (lotsRes.error && /unit_price_net|column/.test(String(lotsRes.error.message || ''))) {
    lotsHasPrice = false
    lotsRes = await client.from('lots').select(selectLotsBasic).limit(50000)
  }
  if (lotsRes.error) throw lotsRes.error

  const [productsRes, opsRes, rozchodRes, przychodRes] = await Promise.all([
    client.from('products').select('id, name, code, product_group').limit(10000),
    client.from('operations').select('id, operation_type, operation_date, document_no, contractor_id, created_at').limit(50000),
    loadDirectionItems(client, 'rozchod'),
    loadDirectionItems(client, 'przychod')
  ])
  if (productsRes.error) throw productsRes.error
  if (opsRes.error) throw opsRes.error

  return {
    products: productsRes.data || [],
    lotsRaw: lotsRes.data || [],
    operations: opsRes.data || [],
    rozchodItems: rozchodRes.data || [],
    przychodItems: przychodRes.data || [],
    hasPriceColumn: lotsHasPrice && rozchodRes.hasPriceColumn && przychodRes.hasPriceColumn
  }
}

function isIncomingLotOperation(op) {
  if (!op) return false
  if (op.operation_type === 'przyjecie') return true
  return String(op.document_no || '').toUpperCase().startsWith('PZ')
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

function roundKg(n) {
  return Math.round(Number(n || 0) * 1000) / 1000
}

function roundMoney(n) {
  return Math.round(Number(n || 0) * 100) / 100
}

function normalizeKey(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function displayName(name) {
  return String(name || '').trim() || 'Produkt'
}

function opDate(op) {
  return String(op?.operation_date || '').slice(0, 10)
}

function opInMonth(op, monthStart, monthEnd) {
  const d = opDate(op)
  return d && d >= monthStart && d <= monthEnd
}

function lotUnitPrice(lot, itemByLotId, itemByOpProduct) {
  const fromLot = Number(lot.unit_price_net)
  if (Number.isFinite(fromLot) && fromLot > 0) return fromLot
  const fromItem = itemByLotId.get(lot.id)
  const itemPrice = Number(fromItem?.unit_price_net)
  if (Number.isFinite(itemPrice) && itemPrice > 0) return itemPrice
  const fromOp = itemByOpProduct.get(`${lot.source_operation_id}|${lot.product_id}`)
  if (fromOp != null && fromOp > 0) return fromOp
  return null
}

/** FIFO do dnia cutoff – sprzedaż wyłącznie po dacie WZ (sale_date). */
function simulateFifoToDate({ cutoff, lotState, sortedSales, productMap, opMap }) {
  for (const sale of sortedSales) {
    let remaining = Number(sale.sale_qty || 0)
    const lots = Array.from(lotState.values())
      .filter(lot => {
        const receiptDate = lotReceiptDate(lot, opMap)
        return fifoLotMatchesMatchSpec(lot, productMap, sale.matchSpec) &&
          Number(lot.remaining_qty || 0) > 0 &&
          receiptDate &&
          receiptDate !== '0000-01-01' &&
          receiptDate <= cutoff
      })
      .sort((a, b) =>
        lotReceiptDate(a, opMap).localeCompare(lotReceiptDate(b, opMap)) ||
        String(a.created_at || '').localeCompare(String(b.created_at || '')) ||
        String(a.lot_no || '').localeCompare(String(b.lot_no || ''))
      )

    for (const lot of lots) {
      if (remaining <= 0.0005) break
      const available = Number(lot.remaining_qty || 0)
      const take = Math.min(available, remaining)
      if (take <= 0) continue
      lot.remaining_qty = available - take
      lotState.set(lot.id, lot)
      remaining -= take
    }
  }
}

function ensureRow(map, key, label, productId, productMap) {
  if (!map.has(key)) {
    const product = productMap.get(productId)
    map.set(key, {
      product_key: key,
      product_id: productId,
      product_name: label,
      product_group: resolveFifoProductGroup(product, label),
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
 * @returns {{ yearMonth, monthStart, monthEnd, rows, totals, missingPriceLines, hasPriceColumn, diagnostics, message }}
 */
export async function computeMonthlyStockValueReport(client, yearMonth) {
  const empty = (msg, extra = {}) => ({
    yearMonth: yearMonth || '',
    monthStart: '',
    monthEnd: '',
    rows: [],
    totals: {
      purchased_kg: 0, sold_kg: 0, remaining_kg: 0,
      purchased_value: 0, remaining_value: 0
    },
    missingPriceLines: 0,
    hasPriceColumn: true,
    diagnostics: {},
    message: msg,
    ...extra
  })

  const bounds = monthBounds(yearMonth)
  if (!client) return empty('Brak połączenia z bazą.')
  if (!bounds) return empty('Wybierz poprawny miesiąc (RRRR-MM).')

  const { monthStart, monthEnd } = bounds
  const {
    products,
    lotsRaw,
    operations,
    rozchodItems,
    przychodItems,
    hasPriceColumn
  } = await loadReportData(client)

  const productMap = new Map(products.map(p => [p.id, p]))
  const opMap = new Map(operations.map(o => [o.id, o]))

  const itemByLotId = new Map()
  const itemByOpProduct = new Map()
  for (const item of przychodItems) {
    if (item.lot_id) itemByLotId.set(item.lot_id, item)
    if (item.operation_id && item.product_id) {
      const p = Number(item.unit_price_net)
      if (p > 0) itemByOpProduct.set(`${item.operation_id}|${item.product_id}`, p)
    }
  }

  // --- Statystyki okresu (przybyło / ubyło w miesiącu) per nazwa z importu ---
  const periodMap = new Map()
  let pzInMonth = 0
  let wzInMonth = 0

  for (const item of przychodItems) {
    const op = opMap.get(item.operation_id)
    if (!op || !isIncomingLotOperation(op) || !opInMonth(op, monthStart, monthEnd)) continue
    const qty = Math.abs(Number(item.qty || 0))
    if (qty <= 0) continue
    pzInMonth += 1
    const raw = displayName(item.raw_product_name || productMap.get(item.product_id)?.name)
    const key = normalizeKey(raw)
    const row = ensureRow(periodMap, key, raw, item.product_id, productMap)
    row.purchased_kg += qty
    const price = Number(item.unit_price_net)
    if (price > 0) row.purchased_value += qty * price
    else row.purchased_missing_price_kg += qty
  }

  const saleOpIds = new Set(operations.filter(isSaleOperation).map(o => o.id))
  for (const item of rozchodItems) {
    if (item.operation_id) saleOpIds.add(item.operation_id)
  }

  for (const item of rozchodItems) {
    const op = opMap.get(item.operation_id)
    if (!op || !saleOpIds.has(item.operation_id) || !opInMonth(op, monthStart, monthEnd)) continue
    const qty = Math.abs(Number(item.qty || 0))
    if (qty <= 0) continue
    wzInMonth += 1
    const raw = displayName(item.raw_product_name || productMap.get(item.product_id)?.name)
    const key = normalizeKey(raw)
    ensureRow(periodMap, key, raw, item.product_id, productMap).sold_kg += qty
  }

  // --- FIFO na koniec miesiąca (data WZ, nie przerób) ---
  const lotState = new Map()
  let lotsInScope = 0

  for (const lot of lotsRaw) {
    const srcOp = opMap.get(lot.source_operation_id)
    if (!isIncomingLotOperation(srcOp)) continue
    const receiptDate = lotReceiptDate(lot, opMap)
    if (!receiptDate || receiptDate === '0000-01-01' || receiptDate > monthEnd) continue
    const initial = Number(lot.initial_qty || 0)
    if (initial <= 0) continue
    lotsInScope += 1

    const srcItem = itemByLotId.get(lot.id)
    const raw = displayName(srcItem?.raw_product_name || productMap.get(lot.product_id)?.name)
    const unitPrice = lotUnitPrice(lot, itemByLotId, itemByOpProduct)

    lotState.set(lot.id, {
      ...lot,
      remaining_qty: initial,
      _raw_key: normalizeKey(raw),
      _raw_name: raw,
      _receipt_date: receiptDate,
      _pz_no: srcOp?.document_no || lot.lot_no || '',
      _unit_price_net: unitPrice,
      _purchased_in_month: receiptDate >= monthStart && receiptDate <= monthEnd
    })
  }

  const saleGroups = new Map()
  for (const item of rozchodItems) {
    const op = opMap.get(item.operation_id)
    if (!item.operation_id || !item.product_id || !saleOpIds.has(item.operation_id)) continue
    const saleDate = opDate(op)
    if (!saleDate || saleDate > monthEnd) continue
    const qty = Math.abs(Number(item.qty || 0))
    if (qty <= 0) continue
    const product = productMap.get(item.product_id)
    const rawName = displayName(item.raw_product_name || product?.name)
    const key = `${item.operation_id}|${item.product_id}`
    const current = saleGroups.get(key) || {
      operation_id: item.operation_id,
      product_id: item.product_id,
      product_name: rawName,
      matchSpec: resolveFifoMatchSpec(product, rawName),
      sale_date: saleDate,
      sale_doc_no: op?.document_no || '',
      sale_created_at: op?.created_at,
      sale_qty: 0
    }
    current.sale_qty += qty
    saleGroups.set(key, current)
  }

  const sortedSales = Array.from(saleGroups.values()).sort((a, b) =>
    String(a.sale_date || '').localeCompare(String(b.sale_date || '')) ||
    String(a.sale_created_at || '').localeCompare(String(b.sale_created_at || '')) ||
    String(a.sale_doc_no || '').localeCompare(String(b.sale_doc_no || '')) ||
    String(a.product_id || '').localeCompare(String(b.product_id || ''))
  )

  simulateFifoToDate({ cutoff: monthEnd, lotState, sortedSales, productMap, opMap })

  const resultMap = new Map(periodMap)

  let missingPriceLines = 0
  let wzAfterMonthEnd = 0
  for (const item of rozchodItems) {
    const op = opMap.get(item.operation_id)
    if (!op || !saleOpIds.has(item.operation_id)) continue
    const d = opDate(op)
    if (d && d > monthEnd) wzAfterMonthEnd += 1
  }

  for (const lot of lotState.values()) {
    const remaining = roundKg(lot.remaining_qty)
    if (remaining <= 0.0005) continue

    const key = lot._raw_key
    const row = ensureRow(resultMap, key, lot._raw_name, lot.product_id, productMap)
    const unitPrice = lot._unit_price_net
    const lineValue = unitPrice != null ? roundMoney(remaining * unitPrice) : null
    if (unitPrice == null) {
      missingPriceLines += 1
      row.remaining_missing_price_kg += remaining
    }

    row.remaining_kg += remaining
    if (lineValue != null) row.remaining_value += lineValue

    row.lot_lines.push({
      lot_id: lot.id,
      lot_no: lot.lot_no,
      pz_no: lot._pz_no,
      pz_date: lot._receipt_date,
      remaining_kg: remaining,
      unit_price_net: unitPrice,
      line_value: lineValue,
      purchased_in_month: lot._purchased_in_month
    })
  }

  const rows = Array.from(resultMap.values())
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
    ? `Stan magazynu na ${monthEnd} (FIFO, data WZ): ${totals.remaining_kg.toLocaleString('pl-PL')} kg · ${totals.remaining_value.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł netto.`
    : lotsInScope > 0
      ? `Na ${monthEnd} po FIFO nie ma pozostałości (${lotsInScope} partii PZ w zakresie).`
      : `Brak partii PZ do ${monthEnd}.`

  if (wzAfterMonthEnd > 0) {
    message += ` Pominięto ${wzAfterMonthEnd} poz. WZ z datą po ${monthEnd} (np. sprzedaż 01.07 – na stanie czerwca nadal w magazynie).`
  }

  if (!hasPriceColumn) {
    message += ' Uruchom migrację v44 i uzupełnij ceny z Excel.'
  } else if (missingPriceLines > 0 || (totals.remaining_kg > 0 && totals.remaining_value === 0)) {
    message += ` Brak ceny na ${missingPriceLines} partiach – wskaż pliki Excel z kolumną „Cena netto”.`
  }

  return {
    yearMonth: bounds.yearMonth,
    monthStart,
    monthEnd,
    rows,
    totals,
    missingPriceLines,
    hasPriceColumn,
    diagnostics: { lotsInScope, pzInMonth, wzInMonth, wzAfterMonthEnd, salesToFifo: sortedSales.length },
    message
  }
}

export function formatPlMoney(value) {
  return Number(value || 0).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function buildR14PrintHtml(report, escapeHtml) {
  const esc = escapeHtml || (s => String(s ?? ''))
  const rows = report.rows || []
  const title = report.reportTitle || buildReportTitle(report)
  const bodyRows = rows.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${esc(r.product_name)}</td>
      <td class="num">${Number(r.purchased_kg || 0).toLocaleString('pl-PL')}</td>
      <td class="num">${Number(r.sold_kg || 0).toLocaleString('pl-PL')}</td>
      <td class="num">${Number(r.remaining_kg || 0).toLocaleString('pl-PL')}</td>
      <td class="num">${formatPlMoney(r.purchased_value)}</td>
      <td class="num">${formatPlMoney(r.remaining_value)}</td>
    </tr>
  `).join('')

  return `<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8"/><title>${esc(title)}</title>
<style>
body{font-family:Arial,sans-serif;font-size:11pt;margin:24px}
h1{font-size:13pt;margin:0 0 16px;line-height:1.35;font-weight:700;text-align:center}
.meta{margin-bottom:16px;color:#333;font-size:10pt;text-align:center}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid #333;padding:6px 8px;text-align:left}
th{background:#eee}
.num{text-align:right;white-space:nowrap}
tfoot td{font-weight:bold}
</style></head><body>
<h1>${esc(title)}</h1>
<p class="meta">FIFO · sprzedaż wg daty WZ · wartość netto = ilość × cena netto z PZ</p>
<table>
<thead><tr>
  <th>Lp.</th><th>Produkt</th>
  <th>Przybyło kg</th><th>Ubyło kg</th><th>Ilość końcowa</th>
  <th>Wartość zakupu netto</th><th>Wartość końcowa netto</th>
</tr></thead>
<tbody>${bodyRows || '<tr><td colspan="7">Brak danych</td></tr>'}</tbody>
<tfoot><tr>
  <td colspan="2">Razem</td>
  <td class="num">${Number(report.totals?.purchased_kg || 0).toLocaleString('pl-PL')}</td>
  <td class="num">${Number(report.totals?.sold_kg || 0).toLocaleString('pl-PL')}</td>
  <td class="num">${Number(report.totals?.remaining_kg || 0).toLocaleString('pl-PL')}</td>
  <td class="num">${formatPlMoney(report.totals?.purchased_value)}</td>
  <td class="num">${formatPlMoney(report.totals?.remaining_value)}</td>
</tr></tfoot>
</table>
</body></html>`
}

export function buildR14ExcelRows(report) {
  const title = report.reportTitle || buildReportTitle(report)
  const header = [
    [title],
    [],
    ['Lp.', 'Produkt', 'Grupa', 'Przybyło kg', 'Ubyło kg', 'Ilość końcowa', 'Wartość zakupu netto', 'Wartość końcowa netto']
  ]
  const data = (report.rows || []).map((r, i) => [
    i + 1, r.product_name, r.product_group || '',
    r.purchased_kg, r.sold_kg, r.remaining_kg, r.purchased_value, r.remaining_value
  ])
  const footer = [[
    '', 'Razem', '',
    report.totals?.purchased_kg || 0, report.totals?.sold_kg || 0,
    report.totals?.remaining_kg || 0, report.totals?.purchased_value || 0,
    report.totals?.remaining_value || 0
  ]]
  return [...header, ...data, [], ...footer]
}
