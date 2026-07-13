/**
 * Raport ilościowo-wartościowy na koniec miesiąca – logika jak Fakturownia:
 * przybyło (PZ w miesiącu) − ubyło (WZ w miesiącu) = ilość końcowa, per nazwa produktu z importu.
 * Wartość netto = ilość × cena netto z PZ (ostatnia kolumna „Cena netto”).
 */
import { isSaleOperation, resolveFifoProductGroup } from './k03Engine'

export const MONTHLY_STOCK_VALUE_VERSION = '1.2'

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
  const [productsRes, opsRes, rozchodRes, przychodRes] = await Promise.all([
    client.from('products').select('id, name, code, product_group').limit(10000),
    client.from('operations').select('id, operation_type, operation_date, document_no, created_at').limit(50000),
    loadDirectionItems(client, 'rozchod'),
    loadDirectionItems(client, 'przychod')
  ])
  if (productsRes.error) throw productsRes.error
  if (opsRes.error) throw opsRes.error
  return {
    products: productsRes.data || [],
    operations: opsRes.data || [],
    rozchodItems: rozchodRes.data || [],
    przychodItems: przychodRes.data || [],
    hasPriceColumn: rozchodRes.hasPriceColumn && przychodRes.hasPriceColumn
  }
}

function isIncomingLotOperation(op) {
  if (!op) return false
  if (op.operation_type === 'przyjecie') return true
  const no = String(op.document_no || '').toUpperCase()
  return no.startsWith('PZ')
}

function isSaleOp(op, saleOpIds) {
  if (!op) return false
  return saleOpIds.has(op.id) || isSaleOperation(op)
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

function itemProductKey(item, productMap) {
  const raw = String(item.raw_product_name || '').trim()
  if (raw) return normalizeKey(raw)
  const p = productMap.get(item.product_id)
  return normalizeKey(p?.name || item.product_id || 'produkt')
}

function itemDisplayName(item, productMap) {
  const raw = String(item.raw_product_name || '').trim()
  if (raw) return raw
  return productMap.get(item.product_id)?.name || 'Produkt'
}

function opInMonth(op, monthStart, monthEnd) {
  const d = String(op?.operation_date || '').slice(0, 10)
  return d && d >= monthStart && d <= monthEnd
}

/** Rozliczenie wartości: FIFO w obrębie PZ z miesiąca (linia po linii). */
function allocateRemainingValue(purchaseLines, soldKg) {
  let soldLeft = soldKg
  let remainingValue = 0
  let remainingKg = 0
  let missingPriceKg = 0
  let missingPriceLines = 0

  const sorted = [...purchaseLines].sort((a, b) =>
    String(a.pz_date || '').localeCompare(String(b.pz_date || '')) ||
    String(a.pz_no || '').localeCompare(String(b.pz_no || ''))
  )

  for (const line of sorted) {
    const qty = Number(line.qty || 0)
    if (qty <= 0) continue
    const consumed = Math.min(qty, soldLeft)
    const left = qty - consumed
    soldLeft -= consumed
    remainingKg += left
    if (left <= 0.0005) continue
    const price = line.unit_price_net
    if (price != null && price > 0) {
      remainingValue += left * price
    } else {
      missingPriceKg += left
      missingPriceLines += 1
    }
  }

  return {
    remaining_kg: roundKg(remainingKg),
    remaining_value: roundMoney(remainingValue),
    remaining_missing_price_kg: roundKg(missingPriceKg),
    missing_price_lines: missingPriceLines
  }
}

/**
 * @returns {{ yearMonth, monthStart, monthEnd, rows, totals, missingPriceLines, hasPriceColumn, diagnostics, message }}
 */
export async function computeMonthlyStockValueReport(client, yearMonth) {
  const empty = (msg) => ({
    yearMonth: yearMonth || '',
    monthStart: '',
    monthEnd: '',
    rows: [],
    totals: {
      purchased_kg: 0, sold_kg: 0, remaining_kg: 0,
      purchased_value: 0, sold_value: 0, remaining_value: 0
    },
    missingPriceLines: 0,
    hasPriceColumn: true,
    diagnostics: {},
    message: msg
  })

  const bounds = monthBounds(yearMonth)
  if (!client) return empty('Brak połączenia z bazą.')
  if (!bounds) return empty('Wybierz poprawny miesiąc (RRRR-MM).')

  const { monthStart, monthEnd } = bounds
  const { products, operations, rozchodItems, przychodItems, hasPriceColumn } = await loadReportData(client)

  const productMap = new Map(products.map(p => [p.id, p]))
  const opMap = new Map(operations.map(o => [o.id, o]))

  const saleOpIds = new Set(operations.filter(isSaleOperation).map(o => o.id))
  for (const item of rozchodItems) {
    if (item.operation_id) saleOpIds.add(item.operation_id)
  }

  const rowsMap = new Map()

  function ensureRow(key, displayName, productId) {
    if (!rowsMap.has(key)) {
      const product = productMap.get(productId)
      rowsMap.set(key, {
        product_key: key,
        product_id: productId,
        product_name: displayName,
        product_group: resolveFifoProductGroup(product, displayName),
        purchased_kg: 0,
        sold_kg: 0,
        remaining_kg: 0,
        purchased_value: 0,
        sold_value: 0,
        remaining_value: 0,
        purchased_missing_price_kg: 0,
        remaining_missing_price_kg: 0,
        purchase_lines: [],
        pz_lines: []
      })
    }
    return rowsMap.get(key)
  }

  let pzInMonth = 0
  let wzInMonth = 0

  for (const item of przychodItems) {
    const op = opMap.get(item.operation_id)
    if (!op || !isIncomingLotOperation(op) || !opInMonth(op, monthStart, monthEnd)) continue
    const qty = Math.abs(Number(item.qty || 0))
    if (qty <= 0) continue
    pzInMonth += 1

    const key = itemProductKey(item, productMap)
    const displayName = itemDisplayName(item, productMap)
    const row = ensureRow(key, displayName, item.product_id)
    const unitPrice = Number(item.unit_price_net) > 0 ? Number(item.unit_price_net) : null

    row.purchased_kg += qty
    if (unitPrice != null) row.purchased_value += qty * unitPrice
    else row.purchased_missing_price_kg += qty

    const line = {
      item_id: item.id,
      pz_no: op.document_no || '',
      pz_date: String(op.operation_date || '').slice(0, 10),
      qty,
      unit_price_net: unitPrice
    }
    row.purchase_lines.push(line)
    row.pz_lines.push({ ...line, line_value: unitPrice != null ? roundMoney(qty * unitPrice) : null })
  }

  for (const item of rozchodItems) {
    const op = opMap.get(item.operation_id)
    if (!op || !isSaleOp(op, saleOpIds) || !opInMonth(op, monthStart, monthEnd)) continue
    const qty = Math.abs(Number(item.qty || 0))
    if (qty <= 0) continue
    wzInMonth += 1

    const key = itemProductKey(item, productMap)
    const displayName = itemDisplayName(item, productMap)
    const row = ensureRow(key, displayName, item.product_id)
    row.sold_kg += qty
  }

  let missingPriceLines = 0

  for (const row of rowsMap.values()) {
    row.purchased_kg = roundKg(row.purchased_kg)
    row.sold_kg = roundKg(row.sold_kg)
    row.purchased_value = roundMoney(row.purchased_value)
    row.purchased_missing_price_kg = roundKg(row.purchased_missing_price_kg)

    row.remaining_kg = roundKg(Math.max(0, row.purchased_kg - row.sold_kg))

    const pricedKg = row.purchased_kg - row.purchased_missing_price_kg
    if (pricedKg > 0 && row.sold_kg > 0) {
      row.sold_value = roundMoney(row.sold_kg * (row.purchased_value / pricedKg))
    }

    const alloc = allocateRemainingValue(row.purchase_lines, row.sold_kg)
    row.remaining_value = alloc.remaining_value
    row.remaining_missing_price_kg = alloc.remaining_missing_price_kg
    missingPriceLines += alloc.missing_price_lines

    if (row.remaining_kg <= 0.0005) {
      row.remaining_value = 0
      row.remaining_missing_price_kg = 0
    }
  }

  const rows = Array.from(rowsMap.values())
    .filter(r => r.purchased_kg > 0.0005 || r.sold_kg > 0.0005 || r.remaining_kg > 0.0005)
    .map(r => ({
      ...r,
      purchase_lines: undefined,
      pz_lines: (r.pz_lines || []).sort((a, b) =>
        String(a.pz_date || '').localeCompare(String(b.pz_date || '')) ||
        String(a.pz_no || '').localeCompare(String(b.pz_no || ''))
      )
    }))
    .sort((a, b) =>
      String(a.product_group || '').localeCompare(String(b.product_group || '')) ||
      String(a.product_name || '').localeCompare(String(b.product_name || ''))
    )

  const totals = {
    purchased_kg: roundKg(rows.reduce((s, r) => s + r.purchased_kg, 0)),
    sold_kg: roundKg(rows.reduce((s, r) => s + r.sold_kg, 0)),
    remaining_kg: roundKg(rows.reduce((s, r) => s + r.remaining_kg, 0)),
    purchased_value: roundMoney(rows.reduce((s, r) => s + r.purchased_value, 0)),
    sold_value: roundMoney(rows.reduce((s, r) => s + r.sold_value, 0)),
    remaining_value: roundMoney(rows.reduce((s, r) => s + r.remaining_value, 0))
  }

  let message = rows.length
    ? `Raport za ${bounds.yearMonth} (${monthStart} – ${monthEnd}): ilość końcowa ${totals.remaining_kg.toLocaleString('pl-PL')} kg · wartość ${totals.remaining_value.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł netto.`
    : pzInMonth > 0 || wzInMonth > 0
      ? `Raport za ${bounds.yearMonth}: brak wierszy po agregacji (${pzInMonth} poz. PZ, ${wzInMonth} poz. WZ w miesiącu).`
      : `Raport za ${bounds.yearMonth}: brak dokumentów PZ/WZ w tym miesiącu.`

  if (!hasPriceColumn) {
    message += ' Uruchom migrację supabase/2026-v44-unit-price-net.sql, potem uzupełnij ceny z Excel.'
  } else if (missingPriceLines > 0 || totals.purchased_value === 0 && totals.purchased_kg > 0) {
    message += ` Brak ceny na ${missingPriceLines} liniach PZ – użyj „Uzupełnij ceny z Excel”.`
  }

  return {
    yearMonth: bounds.yearMonth,
    monthStart,
    monthEnd,
    rows,
    totals,
    missingPriceLines,
    hasPriceColumn,
    diagnostics: { pzInMonth, wzInMonth },
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
      <td class="num">${Number(r.sold_kg || 0).toLocaleString('pl-PL')}</td>
      <td class="num">${Number(r.remaining_kg || 0).toLocaleString('pl-PL')}</td>
      <td class="num">${formatPlMoney(r.purchased_value)}</td>
      <td class="num">${formatPlMoney(r.remaining_value)}</td>
    </tr>
  `).join('')

  return `<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8"/><title>Raport ${esc(report.yearMonth)}</title>
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
<h1>Zestawienie ilościowo-wartościowe magazynu</h1>
<p class="meta">Okres: <b>${esc(report.monthStart)} – ${esc(report.monthEnd)}</b> · Ilość końcowa = przybyło − ubyło · Wartość = ilość × cena netto z PZ</p>
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
  const header = [
    ['Zestawienie ilościowo-wartościowe', report.yearMonth || ''],
    ['Okres', `${report.monthStart || ''} – ${report.monthEnd || ''}`],
    [],
    ['Lp.', 'Produkt', 'Grupa', 'Przybyło kg', 'Ubyło kg', 'Ilość końcowa', 'Wartość zakupu netto', 'Wartość końcowa netto']
  ]
  const data = (report.rows || []).map((r, i) => [
    i + 1,
    r.product_name,
    r.product_group || '',
    r.purchased_kg,
    r.sold_kg,
    r.remaining_kg,
    r.purchased_value,
    r.remaining_value
  ])
  const footer = [[
    '', 'Razem', '',
    report.totals?.purchased_kg || 0,
    report.totals?.sold_kg || 0,
    report.totals?.remaining_kg || 0,
    report.totals?.purchased_value || 0,
    report.totals?.remaining_value || 0
  ]]
  return [...header, ...data, [], ...footer]
}
