/**
 * Stany – nieprzypisany surowiec z PZ na wybrany dzień (symulacja FIFO do daty).
 */
import { isSaleOperation, resolveFifoProductGroup } from './k03Engine'
import { lotReceiptDate } from './fifoEngine'

export const STOCK_STATES_VERSION = '1.0'

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

function simulateFifoToDate({ cutoff, lotState, sortedSales, productMap, opMap }) {
  for (const sale of sortedSales) {
    let remaining = Number(sale.sale_qty || 0)
    const lots = Array.from(lotState.values())
      .filter(lot => {
        const product = productMap.get(lot.product_id)
        const group = resolveGroup(product, product?.name || sale.product_name || '', lot.product_group)
        const receiptDate = lotReceiptDate(lot, opMap)
        return group === sale.sale_group &&
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
 * @returns {{ asOfDate, rows, totalUnassignedKg, lotCount, message }}
 * rows: { product_id, product_name, product_group, unassigned_kg, pz_total_kg, pz_lines: [{ lot_id, lot_no, pz_no, pz_date, qty, initial_qty }] }
 */
export async function computeUnassignedPzStock(client, asOfDate) {
  if (!client) {
    return { asOfDate: '', rows: [], totalUnassignedKg: 0, lotCount: 0, message: 'Brak połączenia z bazą.' }
  }

  const cutoff = String(asOfDate || new Date().toISOString().slice(0, 10)).slice(0, 10)

  const [
    { data: products, error: productsErr },
    { data: lotsRaw, error: lotsErr },
    { data: operations, error: opsErr },
    { data: rozchodItems, error: itemsErr }
  ] = await Promise.all([
    client.from('products').select('id, name, code, product_group').limit(10000),
    client.from('lots').select('id, lot_no, product_id, product_group, production_date, created_at, initial_qty, remaining_qty, source_operation_id, status').limit(50000),
    client.from('operations').select('id, operation_type, operation_date, document_no, contractor_id, created_at').limit(50000),
    client.from('operation_items').select('id, operation_id, product_id, qty, direction, raw_product_name').eq('direction', 'rozchod').limit(50000)
  ])
  if (productsErr) throw productsErr
  if (lotsErr) throw lotsErr
  if (opsErr) throw opsErr
  if (itemsErr) throw itemsErr

  const productMap = new Map((products || []).map(p => [p.id, p]))
  const opMap = new Map((operations || []).map(o => [o.id, o]))
  const contractorIds = Array.from(new Set((operations || []).map(o => o.contractor_id).filter(Boolean)))
  const contractors = contractorIds.length
    ? await fetchInChunks(client, 'contractors', 'id, name', 'id', contractorIds)
    : []
  const contractorMap = new Map(contractors.map(c => [c.id, c.name]))

  const lotState = new Map()
  for (const lot of lotsRaw || []) {
    const srcOp = opMap.get(lot.source_operation_id)
    if (!isIncomingLotOperation(srcOp)) continue
    const receiptDate = lotReceiptDate(lot, opMap)
    if (!receiptDate || receiptDate === '0000-01-01' || receiptDate > cutoff) continue
    const initial = Number(lot.initial_qty || 0)
    if (initial <= 0) continue
    lotState.set(lot.id, {
      ...lot,
      remaining_qty: initial,
      _receipt_date: receiptDate,
      _pz_no: srcOp?.document_no || lot.lot_no || '',
      _supplier: contractorMap.get(srcOp?.contractor_id) || ''
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
    if (!saleDate || saleDate > cutoff) continue
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

  simulateFifoToDate({ cutoff, lotState, sortedSales, productMap, opMap })

  const byProduct = new Map()
  for (const lot of lotState.values()) {
    const remaining = Math.round(Number(lot.remaining_qty || 0) * 1000) / 1000
    if (remaining <= 0.0005) continue
    const product = productMap.get(lot.product_id)
    const productName = product?.name || 'Produkt'
    const productGroup = resolveGroup(product, productName, lot.product_group)
    const pid = lot.product_id || productName
    const row = byProduct.get(pid) || {
      product_id: lot.product_id,
      product_name: productName,
      product_group: productGroup,
      unassigned_kg: 0,
      pz_total_kg: 0,
      pz_lines: []
    }
    row.unassigned_kg += remaining
    row.pz_total_kg += Number(lot.initial_qty || 0)
    row.pz_lines.push({
      lot_id: lot.id,
      lot_no: lot.lot_no,
      pz_no: lot._pz_no,
      pz_date: lot._receipt_date,
      supplier: lot._supplier,
      initial_qty: Number(lot.initial_qty || 0),
      qty: remaining
    })
    byProduct.set(pid, row)
  }

  const rows = Array.from(byProduct.values())
    .map(row => ({
      ...row,
      unassigned_kg: Math.round(row.unassigned_kg * 1000) / 1000,
      pz_total_kg: Math.round(row.pz_total_kg * 1000) / 1000,
      pz_lines: row.pz_lines.sort((a, b) =>
        String(a.pz_date || '').localeCompare(String(b.pz_date || '')) ||
        String(a.pz_no || '').localeCompare(String(b.pz_no || ''))
      )
    }))
    .filter(row => row.unassigned_kg > 0.0005)
    .sort((a, b) =>
      String(a.product_group || '').localeCompare(String(b.product_group || '')) ||
      String(a.product_name || '').localeCompare(String(b.product_name || ''))
    )

  const totalUnassignedKg = Math.round(rows.reduce((s, r) => s + r.unassigned_kg, 0) * 1000) / 1000
  const lotCount = rows.reduce((s, r) => s + r.pz_lines.length, 0)

  return {
    asOfDate: cutoff,
    rows,
    totalUnassignedKg,
    lotCount,
    message: rows.length
      ? `Stan na ${cutoff}: ${rows.length} asortymentów, ${totalUnassignedKg.toLocaleString('pl-PL')} kg nieprzypisane do WZ.`
      : `Stan na ${cutoff}: brak nieprzypisanego surowca z PZ (wszystko rozliczone lub brak PZ do tej daty).`
  }
}
