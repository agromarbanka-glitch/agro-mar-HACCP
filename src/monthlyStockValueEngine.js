/**
 * R14 – zestawienie ilościowo-wartościowe pozostałości magazynowych na koniec miesiąca.
 * Wartość netto = ilość × cena netto z importu (ostatnia kolumna „Cena netto”, nie „Wartość netto”).
 */
import { isSaleOperation, resolveFifoProductGroup, resolveFifoMatchSpec, fifoLotMatchesMatchSpec } from './k03Engine'
import { lotReceiptDate } from './fifoEngine'

export const MONTHLY_STOCK_VALUE_VERSION = '1.0'

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

function isIncomingLotOperation(op) {
  if (!op) return true
  if (op.operation_type === 'przyjecie') return true
  const no = String(op.document_no || '').toUpperCase()
  return no.startsWith('PZ') || no.startsWith('MM')
}

function resolveGroup(product, productName = '', lotGroup = '') {
  return resolveFifoProductGroup(product, productName, lotGroup)
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

function lotUnitPrice(lot, itemPriceByLotId) {
  const fromLot = Number(lot.unit_price_net)
  if (Number.isFinite(fromLot) && fromLot > 0) return fromLot
  const fromItem = Number(itemPriceByLotId.get(lot.id))
  if (Number.isFinite(fromItem) && fromItem > 0) return fromItem
  return null
}

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

/**
 * @returns {{
 *   yearMonth, monthStart, monthEnd,
 *   rows, totals, missingPriceLines, message
 * }}
 */
export async function computeMonthlyStockValueReport(client, yearMonth) {
  const bounds = monthBounds(yearMonth)
  if (!client) {
    return {
      yearMonth: yearMonth || '',
      monthStart: '',
      monthEnd: '',
      rows: [],
      totals: { purchased_kg: 0, purchased_value: 0, remaining_kg: 0, remaining_value: 0 },
      missingPriceLines: 0,
      message: 'Brak połączenia z bazą.'
    }
  }
  if (!bounds) {
    return {
      yearMonth: yearMonth || '',
      monthStart: '',
      monthEnd: '',
      rows: [],
      totals: { purchased_kg: 0, purchased_value: 0, remaining_kg: 0, remaining_value: 0 },
      missingPriceLines: 0,
      message: 'Wybierz poprawny miesiąc (RRRR-MM).'
    }
  }

  const { monthStart, monthEnd } = bounds

  const [
    { data: products, error: productsErr },
    { data: lotsRaw, error: lotsErr },
    { data: operations, error: opsErr },
    { data: rozchodItems, error: rozchodErr },
    { data: przychodItems, error: przychodErr }
  ] = await Promise.all([
    client.from('products').select('id, name, code, product_group').limit(10000),
    client.from('lots').select('id, lot_no, product_id, product_group, production_date, created_at, initial_qty, remaining_qty, source_operation_id, status, unit_price_net').limit(50000),
    client.from('operations').select('id, operation_type, operation_date, document_no, contractor_id, created_at').limit(50000),
    client.from('operation_items').select('id, operation_id, product_id, qty, direction, raw_product_name, lot_id, unit_price_net').eq('direction', 'rozchod').limit(50000),
    client.from('operation_items').select('id, operation_id, product_id, qty, direction, raw_product_name, lot_id, unit_price_net').eq('direction', 'przychod').limit(50000)
  ])
  if (productsErr) throw productsErr
  if (lotsErr) throw lotsErr
  if (opsErr) throw opsErr
  if (rozchodErr) throw rozchodErr
  if (przychodErr) throw przychodErr

  const productMap = new Map((products || []).map(p => [p.id, p]))
  const opMap = new Map((operations || []).map(o => [o.id, o]))
  const itemPriceByLotId = new Map()
  for (const item of przychodItems || []) {
    if (!item.lot_id) continue
    const price = Number(item.unit_price_net)
    if (Number.isFinite(price) && price > 0) itemPriceByLotId.set(item.lot_id, price)
  }

  const purchasedInMonth = new Map()
  for (const item of przychodItems || []) {
    const op = opMap.get(item.operation_id)
    if (!op || !isIncomingLotOperation(op)) continue
    const opDate = String(op.operation_date || '').slice(0, 10)
    if (!opDate || opDate < monthStart || opDate > monthEnd) continue
    const qty = Math.abs(Number(item.qty || 0))
    if (qty <= 0) continue
    const product = productMap.get(item.product_id)
    const productName = String(item.raw_product_name || product?.name || '').trim() || product?.name || 'Produkt'
    const pid = item.product_id || productName
    const unitPrice = Number(item.unit_price_net) > 0 ? Number(item.unit_price_net) : null
    const row = purchasedInMonth.get(pid) || {
      product_id: item.product_id,
      product_name: productName,
      product_group: resolveGroup(product, productName),
      purchased_kg: 0,
      purchased_value: 0,
      purchased_missing_price_kg: 0
    }
    row.purchased_kg += qty
    if (unitPrice != null) row.purchased_value += qty * unitPrice
    else row.purchased_missing_price_kg += qty
    purchasedInMonth.set(pid, row)
  }

  const lotState = new Map()
  for (const lot of lotsRaw || []) {
    const srcOp = opMap.get(lot.source_operation_id)
    if (!isIncomingLotOperation(srcOp)) continue
    const receiptDate = lotReceiptDate(lot, opMap)
    if (!receiptDate || receiptDate === '0000-01-01' || receiptDate > monthEnd) continue
    const initial = Number(lot.initial_qty || 0)
    if (initial <= 0) continue
    const unitPrice = lotUnitPrice(lot, itemPriceByLotId)
    lotState.set(lot.id, {
      ...lot,
      remaining_qty: initial,
      _receipt_date: receiptDate,
      _pz_no: srcOp?.document_no || lot.lot_no || '',
      _unit_price_net: unitPrice,
      _purchased_in_month: receiptDate >= monthStart && receiptDate <= monthEnd
    })
  }

  const saleOpIds = new Set((operations || []).filter(isSaleOperation).map(o => o.id))
  for (const item of rozchodItems || []) {
    if (item.operation_id) saleOpIds.add(item.operation_id)
  }

  const saleGroups = new Map()
  for (const item of rozchodItems || []) {
    const op = opMap.get(item.operation_id)
    if (!item.operation_id || !item.product_id || !saleOpIds.has(item.operation_id)) continue
    const saleDate = String(op?.operation_date || '').slice(0, 10)
    if (!saleDate || saleDate > monthEnd) continue
    const qty = Math.abs(Number(item.qty || 0))
    if (qty <= 0) continue
    const product = productMap.get(item.product_id)
    const rawName = String(item.raw_product_name || product?.name || '').trim()
    const key = `${item.operation_id}|${item.product_id}`
    const current = saleGroups.get(key) || {
      operation_id: item.operation_id,
      product_id: item.product_id,
      product_name: rawName || product?.name || '',
      sale_group: resolveGroup(product, rawName),
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

  const byProduct = new Map()
  let missingPriceLines = 0

  for (const lot of lotState.values()) {
    const remaining = roundKg(lot.remaining_qty)
    if (remaining <= 0.0005) continue
    const product = productMap.get(lot.product_id)
    const productName = product?.name || 'Produkt'
    const pid = lot.product_id || productName
    const unitPrice = lot._unit_price_net
    const lineValue = unitPrice != null ? roundMoney(remaining * unitPrice) : null
    if (unitPrice == null) missingPriceLines += 1

    const row = byProduct.get(pid) || {
      product_id: lot.product_id,
      product_name: productName,
      product_group: resolveGroup(product, productName, lot.product_group),
      purchased_kg: 0,
      purchased_value: 0,
      purchased_missing_price_kg: 0,
      remaining_kg: 0,
      remaining_value: 0,
      remaining_missing_price_kg: 0,
      remaining_from_month_kg: 0,
      remaining_from_month_value: 0,
      lot_lines: []
    }

    const purchaseRow = purchasedInMonth.get(pid)
    if (purchaseRow) {
      row.purchased_kg = purchaseRow.purchased_kg
      row.purchased_value = purchaseRow.purchased_value
      row.purchased_missing_price_kg = purchaseRow.purchased_missing_price_kg
    }

    row.remaining_kg += remaining
    if (lineValue != null) row.remaining_value += lineValue
    else row.remaining_missing_price_kg += remaining

    if (lot._purchased_in_month) {
      row.remaining_from_month_kg += remaining
      if (lineValue != null) row.remaining_from_month_value += lineValue
    }

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
    byProduct.set(pid, row)
  }

  for (const [pid, purchaseRow] of purchasedInMonth) {
    if (byProduct.has(pid)) continue
    byProduct.set(pid, {
      product_id: purchaseRow.product_id,
      product_name: purchaseRow.product_name,
      product_group: purchaseRow.product_group,
      purchased_kg: purchaseRow.purchased_kg,
      purchased_value: roundMoney(purchaseRow.purchased_value),
      purchased_missing_price_kg: purchaseRow.purchased_missing_price_kg,
      remaining_kg: 0,
      remaining_value: 0,
      remaining_missing_price_kg: 0,
      remaining_from_month_kg: 0,
      remaining_from_month_value: 0,
      lot_lines: []
    })
  }

  const rows = Array.from(byProduct.values())
    .map(row => ({
      ...row,
      purchased_kg: roundKg(row.purchased_kg),
      purchased_value: roundMoney(row.purchased_value),
      purchased_missing_price_kg: roundKg(row.purchased_missing_price_kg),
      remaining_kg: roundKg(row.remaining_kg),
      remaining_value: roundMoney(row.remaining_value),
      remaining_missing_price_kg: roundKg(row.remaining_missing_price_kg),
      remaining_from_month_kg: roundKg(row.remaining_from_month_kg),
      remaining_from_month_value: roundMoney(row.remaining_from_month_value),
      lot_lines: (row.lot_lines || []).sort((a, b) =>
        String(a.pz_date || '').localeCompare(String(b.pz_date || '')) ||
        String(a.pz_no || '').localeCompare(String(b.pz_no || ''))
      )
    }))
    .filter(row => row.purchased_kg > 0.0005 || row.remaining_kg > 0.0005)
    .sort((a, b) =>
      String(a.product_group || '').localeCompare(String(b.product_group || '')) ||
      String(a.product_name || '').localeCompare(String(b.product_name || ''))
    )

  const totals = {
    purchased_kg: roundKg(rows.reduce((s, r) => s + r.purchased_kg, 0)),
    purchased_value: roundMoney(rows.reduce((s, r) => s + r.purchased_value, 0)),
    remaining_kg: roundKg(rows.reduce((s, r) => s + r.remaining_kg, 0)),
    remaining_value: roundMoney(rows.reduce((s, r) => s + r.remaining_value, 0))
  }

  const monthLabel = bounds.yearMonth
  let message = rows.length
    ? `R14 za ${monthLabel}: na ${monthEnd} pozostało ${totals.remaining_kg.toLocaleString('pl-PL')} kg (wartość netto ${totals.remaining_value.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł).`
    : `R14 za ${monthLabel}: brak pozycji magazynowych do raportu.`

  if (missingPriceLines > 0) {
    message += ` Uwaga: ${missingPriceLines} partii bez ceny netto (stary import) – wartość częściowo niedostępna.`
  }

  return {
    yearMonth: bounds.yearMonth,
    monthStart,
    monthEnd,
    rows,
    totals,
    missingPriceLines,
    message
  }
}

export function formatPlMoney(value) {
  return Number(value || 0).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function buildR14PrintHtml(report, escapeHtml) {
  const esc = escapeHtml || (s => String(s ?? ''))
  const rows = report.rows || []
  const bodyRows = rows.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${esc(r.product_name)}</td>
      <td class="num">${Number(r.purchased_kg || 0).toLocaleString('pl-PL')}</td>
      <td class="num">${formatPlMoney(r.purchased_value)}</td>
      <td class="num">${Number(r.remaining_kg || 0).toLocaleString('pl-PL')}</td>
      <td class="num">${formatPlMoney(r.remaining_value)}</td>
    </tr>
  `).join('')

  return `<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8"/><title>R14 ${esc(report.yearMonth)}</title>
<style>
body{font-family:Arial,sans-serif;font-size:11pt;margin:24px}
h1{font-size:14pt;margin:0 0 8px}
.meta{margin-bottom:16px;color:#333}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid #333;padding:6px 8px;text-align:left}
th{background:#eee}
.num{text-align:right;white-space:nowrap}
tfoot td{font-weight:bold}
</style></head><body>
<h1>R14 – Zestawienie ilościowo-wartościowe pozostałości magazynowych</h1>
<p class="meta">Miesiąc: <b>${esc(report.yearMonth)}</b> · Stan na koniec: <b>${esc(report.monthEnd)}</b> · Wartość netto = ilość × cena netto z PZ (import Excel)</p>
<table>
<thead><tr>
  <th>Lp.</th><th>Produkt</th>
  <th>Zakupiono kg (miesiąc)</th><th>Wartość zakupu netto</th>
  <th>Pozostało kg</th><th>Wartość pozostała netto</th>
</tr></thead>
<tbody>${bodyRows || '<tr><td colspan="6">Brak danych</td></tr>'}</tbody>
<tfoot><tr>
  <td colspan="2">Razem</td>
  <td class="num">${Number(report.totals?.purchased_kg || 0).toLocaleString('pl-PL')}</td>
  <td class="num">${formatPlMoney(report.totals?.purchased_value)}</td>
  <td class="num">${Number(report.totals?.remaining_kg || 0).toLocaleString('pl-PL')}</td>
  <td class="num">${formatPlMoney(report.totals?.remaining_value)}</td>
</tr></tfoot>
</table>
</body></html>`
}

export function buildR14ExcelRows(report) {
  const header = [
    ['R14 – Zestawienie ilościowo-wartościowe', report.yearMonth || ''],
    ['Stan na koniec miesiąca', report.monthEnd || ''],
    [],
    ['Lp.', 'Produkt', 'Grupa', 'Zakupiono kg', 'Wartość zakupu netto', 'Pozostało kg', 'Wartość pozostała netto']
  ]
  const data = (report.rows || []).map((r, i) => [
    i + 1,
    r.product_name,
    r.product_group || '',
    r.purchased_kg,
    r.purchased_value,
    r.remaining_kg,
    r.remaining_value
  ])
  const footer = [[
    '', 'Razem', '',
    report.totals?.purchased_kg || 0,
    report.totals?.purchased_value || 0,
    report.totals?.remaining_kg || 0,
    report.totals?.remaining_value || 0
  ]]
  return [...header, ...data, [], ...footer]
}
