/**
 * FIFO – przeliczanie przyrostowe (braki) i pełne z ochroną zamrożonych K03.
 */
import { isSaleOperation } from './k03Engine'

function saleLineKey(operationId, productId) {
  return `${operationId}|${productId || 'null'}`
}

function isIncomingLotOperation(op) {
  if (!op) return true
  if (op.operation_type === 'przyjecie') return true
  const no = String(op.document_no || '').toUpperCase()
  return no.startsWith('PZ') || no.startsWith('MM')
}

function resolveProductGroup(product, productName = '') {
  return product?.product_group || productGroupForName(product?.name || productName)
}

function productGroupForName(productName) {
  const text = String(productName || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
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

export function frozenKeysFromSnapshots(snapshots = []) {
  const keys = new Set()
  for (const snap of snapshots) {
    if (snap?.data?.frozen !== true) continue
    const key = snap.data?.k03_key || snap.data?.form_id
    if (key) keys.add(key)
  }
  return keys
}

export function frozenOperationIdsFromSnapshots(snapshots = []) {
  const ids = new Set()
  for (const snap of snapshots) {
    if (snap?.data?.frozen !== true) continue
    if (snap.operation_id) ids.add(snap.operation_id)
    if (snap.data?.sale_operation_id) ids.add(snap.data.sale_operation_id)
  }
  return ids
}

async function loadFifoBaseData(client) {
  const [{ data: products, error: productsErr }, { data: lotsRaw, error: lotsErr }, { data: operations, error: opsErr }, { data: saleItemsRaw, error: itemsErr }, { data: allocationsRaw, error: allocErr }] = await Promise.all([
    client.from('products').select('id, name, code, product_group'),
    client.from('lots').select('id, lot_no, product_id, product_group, production_date, created_at, initial_qty, remaining_qty, source_operation_id, status'),
    client.from('operations').select('id, operation_type, operation_date, document_no, created_at'),
    client.from('operation_items').select('id, operation_id, product_id, qty, direction').eq('direction', 'rozchod'),
    client.from('fifo_allocations').select('id, operation_id, source_lot_id, product_id, qty')
  ])
  if (productsErr) throw productsErr
  if (lotsErr) throw lotsErr
  if (opsErr) throw opsErr
  if (itemsErr) throw itemsErr
  if (allocErr) throw allocErr

  const productMap = new Map((products || []).map(p => [p.id, p]))
  const opMap = new Map((operations || []).map(o => [o.id, o]))
  const saleOpIds = new Set((operations || []).filter(isSaleOperation).map(o => o.id))
  for (const item of saleItemsRaw || []) {
    if (item.operation_id) saleOpIds.add(item.operation_id)
  }

  const saleLines = []
  const saleGroups = new Map()
  for (const item of saleItemsRaw || []) {
    const op = opMap.get(item.operation_id)
    if (!item.operation_id || !item.product_id) continue
    const qty = Math.abs(Number(item.qty || 0))
    if (qty <= 0) continue
    const product = productMap.get(item.product_id)
    const key = saleLineKey(item.operation_id, item.product_id)
    const current = saleGroups.get(key) || {
      key,
      operation_id: item.operation_id,
      product_id: item.product_id,
      product_name: product?.name || '',
      sale_group: resolveProductGroup(product),
      sale_date: op?.operation_date,
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

  const allocationsBySaleKey = new Map()
  for (const alloc of allocationsRaw || []) {
    if (!saleOpIds.has(alloc.operation_id)) continue
    const key = saleLineKey(alloc.operation_id, alloc.product_id)
    if (!allocationsBySaleKey.has(key)) allocationsBySaleKey.set(key, [])
    allocationsBySaleKey.get(key).push(alloc)
  }

  const lotState = new Map()
  for (const lot of lotsRaw || []) {
    lotState.set(lot.id, { ...lot, remaining_qty: Number(lot.remaining_qty || 0) })
  }

  return {
    productMap,
    opMap,
    saleOpIds,
    sortedSales,
    allocationsBySaleKey,
    lotState,
    lotsRaw,
    allocationsRaw: allocationsRaw || []
  }
}

function candidateLots(lotState, productMap, saleGroup, saleDate) {
  const date = String(saleDate || '9999-12-31').slice(0, 10)
  return Array.from(lotState.values())
    .filter(lot => {
      const srcOp = lot.source_operation_id
      const group = lot.product_group || resolveProductGroup(productMap.get(lot.product_id))
      return group === saleGroup &&
        Number(lot.remaining_qty || 0) > 0 &&
        lot.production_date &&
        String(lot.production_date).slice(0, 10) <= date
    })
    .sort((a, b) =>
      String(a.production_date || '').localeCompare(String(b.production_date || '')) ||
      String(a.created_at || '').localeCompare(String(b.created_at || '')) ||
      String(a.lot_no || '').localeCompare(String(b.lot_no || ''))
    )
}

async function persistLot(client, lot) {
  const { error } = await client.from('lots').update({
    remaining_qty: Number(lot.remaining_qty || 0),
    status: Number(lot.remaining_qty || 0) <= 0.0005 ? 'zuzyta' : 'aktywna'
  }).eq('id', lot.id)
  if (error) throw error
}

async function deleteAllocations(client, ids) {
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    if (!chunk.length) continue
    const { error } = await client.from('fifo_allocations').delete().in('id', chunk)
    if (error) throw error
  }
}

function restoreAllocationsToLots(allocations, lotState) {
  for (const alloc of allocations || []) {
    const lot = lotState.get(alloc.source_lot_id)
    if (!lot) continue
    lot.remaining_qty = Number(lot.remaining_qty || 0) + Number(alloc.qty || 0)
    lot.status = lot.remaining_qty > 0.0005 ? 'aktywna' : lot.status
    lotState.set(lot.id, lot)
  }
}

async function allocateSale(client, sale, lotState, productMap) {
  let remaining = Number(sale.sale_qty || 0)
  let allocated = 0
  let allocationCount = 0
  const saleDate = String(sale.sale_date || '9999-12-31').slice(0, 10)
  const lots = candidateLots(lotState, productMap, sale.sale_group, saleDate)

  for (const lot of lots) {
    if (remaining <= 0) break
    const available = Number(lot.remaining_qty || 0)
    const take = Math.min(available, remaining)
    if (take <= 0) continue

    const newRemaining = available - take
    lot.remaining_qty = newRemaining
    lot.status = newRemaining <= 0.0005 ? 'zuzyta' : 'aktywna'
    lotState.set(lot.id, lot)
    await persistLot(client, lot)

    const { error: allocErr } = await client.from('fifo_allocations').insert({
      operation_id: sale.operation_id,
      source_lot_id: lot.id,
      product_id: sale.product_id,
      qty: take
    })
    if (allocErr) throw allocErr

    allocationCount += 1
    remaining -= take
    allocated += take
  }

  return {
    allocationCount,
    allocated,
    shortage: remaining > 0.0005 ? remaining : 0
  }
}

async function logFifoChange(client, entry) {
  try {
    await client.from('fifo_allocation_change_log').insert(entry)
  } catch {
    // Tabela może nie istnieć przed migracją v34 – nie blokujemy FIFO.
  }
}

/**
 * Uzupełnia tylko braki: pomija kompletne i zamrożone WZ.
 */
export async function recalculateFifoIncremental(client, options = {}) {
  const frozenKeys = options.frozenKeys || new Set()
  const base = await loadFifoBaseData(client)
  const { sortedSales, allocationsBySaleKey, lotState, productMap } = base

  let processed = 0
  let skippedComplete = 0
  let skippedFrozen = 0
  let allocationCount = 0
  const shortages = []

  for (const sale of sortedSales) {
    const existing = allocationsBySaleKey.get(sale.key) || []
    const allocatedQty = existing.reduce((sum, a) => sum + Number(a.qty || 0), 0)
    const saleQty = Number(sale.sale_qty || 0)

    if (frozenKeys.has(sale.key)) {
      skippedFrozen += 1
      continue
    }

    if (allocatedQty + 0.001 >= saleQty) {
      skippedComplete += 1
      continue
    }

    if (existing.length) {
      restoreAllocationsToLots(existing, lotState)
      await deleteAllocations(client, existing.map(a => a.id))
      for (const lot of lotState.values()) {
        await persistLot(client, lot)
      }
    }

    const result = await allocateSale(client, sale, lotState, productMap)
    processed += 1
    allocationCount += result.allocationCount

    if (result.shortage > 0.0005) {
      shortages.push({
        wz_no: sale.sale_doc_no,
        wz_date: String(sale.sale_date || '').slice(0, 10),
        product_group: sale.sale_group,
        product_name: sale.product_name,
        wz_qty: saleQty,
        allocated_qty: result.allocated,
        shortage: result.shortage
      })
    }
  }

  return {
    ok: true,
    mode: 'incremental',
    processed,
    skippedComplete,
    skippedFrozen,
    allocationCount,
    shortages
  }
}

/**
 * Pełne przeliczenie z ochroną zamrożonych WZ (nie rusza ich rozliczeń).
 */
export async function recalculateFifoFullProtected(client, options = {}) {
  const frozenKeys = options.frozenKeys || new Set()
  const frozenOpIds = options.frozenOperationIds || new Set()
  const changedBy = options.changedBy || 'admin'
  const reason = options.reason || 'Pełne przeliczenie FIFO (z ochroną zamrożonych K03)'

  const base = await loadFifoBaseData(client)
  const { sortedSales, lotState, productMap, allocationsRaw, lotsRaw, opMap } = base

  const toDelete = allocationsRaw
    .filter(a => !frozenOpIds.has(a.operation_id))
    .map(a => a.id)

  const frozenAllocations = allocationsRaw.filter(a => frozenOpIds.has(a.operation_id))

  await deleteAllocations(client, toDelete)

  for (const lot of lotsRaw || []) {
    const srcOp = opMap.get(lot.source_operation_id)
    const isIncoming = !lot.source_operation_id || isIncomingLotOperation(srcOp)
    if (!isIncoming || Number(lot.initial_qty || 0) <= 0) continue

    const usedByFrozen = frozenAllocations
      .filter(a => a.source_lot_id === lot.id)
      .reduce((sum, a) => sum + Number(a.qty || 0), 0)
    const remaining = Math.max(0, Number(lot.initial_qty || 0) - usedByFrozen)
    const state = lotState.get(lot.id) || { ...lot }
    state.remaining_qty = remaining
    state.status = remaining <= 0.0005 ? 'zuzyta' : 'aktywna'
    lotState.set(lot.id, state)
    await persistLot(client, state)
  }

  let processed = 0
  let skippedFrozen = 0
  let allocationCount = frozenAllocations.length
  const shortages = []

  for (const sale of sortedSales) {
    if (frozenKeys.has(sale.key)) {
      skippedFrozen += 1
      continue
    }

    const result = await allocateSale(client, sale, lotState, productMap)
    processed += 1
    allocationCount += result.allocationCount

    if (result.shortage > 0.0005) {
      shortages.push({
        wz_no: sale.sale_doc_no,
        wz_date: String(sale.sale_date || '').slice(0, 10),
        product_group: sale.sale_group,
        product_name: sale.product_name,
        wz_qty: Number(sale.sale_qty || 0),
        allocated_qty: result.allocated,
        shortage: result.shortage
      })
    }
  }

  await logFifoChange(client, {
    change_type: 'full_recalc_protected',
    change_reason: reason,
    changed_by: changedBy,
    before_data: { frozen_count: frozenKeys.size, deleted_allocations: toDelete.length },
    after_data: { processed, skipped_frozen: skippedFrozen, allocation_count: allocationCount, shortages }
  })

  return {
    ok: true,
    mode: 'full_protected',
    processed,
    skippedFrozen,
    allocationCount,
    shortages,
    frozenProtected: frozenKeys.size
  }
}

/** Podgląd: ile zamrożonych formularzy zostałoby dotkniętych pełnym przeliczeniem bez ochrony. */
export async function countIncompleteSales(client, frozenKeys = new Set()) {
  const base = await loadFifoBaseData(client)
  let incomplete = 0
  let complete = 0
  let frozen = 0
  for (const sale of base.sortedSales) {
    if (frozenKeys.has(sale.key)) {
      frozen += 1
      continue
    }
    const allocated = (base.allocationsBySaleKey.get(sale.key) || []).reduce((s, a) => s + Number(a.qty || 0), 0)
    if (allocated + 0.001 >= Number(sale.sale_qty || 0)) complete += 1
    else incomplete += 1
  }
  return { incomplete, complete, frozen, total: base.sortedSales.length }
}

/** Stare pełne przeliczenie (reset wszystkiego) – tylko gdy brak zamrożonych lub admin wymusza. */
export async function recalculateFifoLegacyFull(client) {
  const { error } = await client.rpc('recalculate_fifo_strict_by_group_date')
  if (!error) {
    const { count } = await client.from('fifo_allocations').select('*', { count: 'exact', head: true })
    return { ok: true, mode: 'rpc_legacy', shortages: [], allocationCount: count || 0 }
  }
  throw new Error(error.message || 'RPC niedostępne – uruchom migrację v33 lub użyj przeliczania chronionego.')
}
