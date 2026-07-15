/**
 * FIFO – przeliczanie przyrostowe (braki) i pełne z ochroną zamrożonych K03.
 */
import { isSaleOperation, resolveFifoProductGroup, resolveFifoMatchSpec, buildFifoMatchSpecFromSourceKeys, fifoLotMatchesMatchSpec, sameFifoPool, normalizeFifoProductKey } from './k03Engine'

function saleLineKey(operationId, productId) {
  return `${operationId}|${productId || 'null'}`
}

/** Data przyjęcia PZ widoczna w K03 – operation_date dokumentu źródłowego lub production_date partii. */
export function lotReceiptDate(lot, opMap) {
  const opDate = opMap?.get?.(lot?.source_operation_id)?.operation_date
  const prodDate = lot?.production_date
  return String(opDate || prodDate || '').slice(0, 10)
}

function isIncomingLotOperation(op) {
  if (!op) return true
  if (op.operation_type === 'przyjecie') return true
  const no = String(op.document_no || '').toUpperCase()
  return no.startsWith('PZ') || no.startsWith('MM')
}

function resolveProductGroup(product, productName = '', lotGroup = '') {
  return resolveFifoProductGroup(product, productName, lotGroup)
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

let fifoBaseCache = null

export function invalidateFifoBaseCache() {
  fifoBaseCache = null
}

async function loadFifoBaseData(client, options = {}) {
  if (!options.forceReload && fifoBaseCache) {
    return fifoBaseCache
  }
  const [{ data: products, error: productsErr }, { data: lotsRaw, error: lotsErr }, { data: operations, error: opsErr }, { data: saleItemsRaw, error: itemsErr }, { data: allocationsRaw, error: allocErr }, { data: k03Docs, error: k03Err }] = await Promise.all([
    client.from('products').select('id, name, code, product_group'),
    client.from('lots').select('id, lot_no, product_id, product_group, production_date, created_at, initial_qty, remaining_qty, source_operation_id, status'),
    client.from('operations').select('id, operation_type, operation_date, document_no, created_at'),
    client.from('operation_items').select('id, operation_id, product_id, qty, direction, raw_product_name').eq('direction', 'rozchod'),
    client.from('fifo_allocations').select('id, operation_id, source_lot_id, product_id, qty'),
    client.from('haccp_documents').select('operation_id, data').eq('document_type', 'K03')
  ])
  if (productsErr) throw productsErr
  if (lotsErr) throw lotsErr
  if (opsErr) throw opsErr
  if (itemsErr) throw itemsErr
  if (allocErr) throw allocErr
  if (k03Err) throw k03Err

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
    const rawName = String(item.raw_product_name || product?.name || '').trim()
    const key = saleLineKey(item.operation_id, item.product_id)
    const current = saleGroups.get(key) || {
      key,
      operation_id: item.operation_id,
      product_id: item.product_id,
      product_name: rawName || product?.name || '',
      sale_group: resolveProductGroup(product, rawName),
      matchSpec: resolveFifoMatchSpec(product, rawName),
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

  const saleByKey = new Map(sortedSales.map(s => [s.key, s]))
  const workflowBySaleKey = buildK03WorkflowBySaleKey(k03Docs || [])

  fifoBaseCache = {
    productMap,
    opMap,
    saleOpIds,
    sortedSales,
    saleByKey,
    allocationsBySaleKey,
    lotState,
    lotsRaw,
    allocationsRaw: allocationsRaw || [],
    workflowBySaleKey
  }
  return fifoBaseCache
}

function candidateLots(lotState, productMap, matchSpec, cutoffDate, opMap) {
  const cutoff = String(cutoffDate || '9999-12-31').slice(0, 10)
  return Array.from(lotState.values())
    .filter(lot => {
      const receiptDate = lotReceiptDate(lot, opMap)
      return fifoLotMatchesMatchSpec(lot, productMap, matchSpec) &&
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
}

async function persistLot(client, lot) {
  const { error } = await client.from('lots').update({
    remaining_qty: Number(lot.remaining_qty || 0),
    status: Number(lot.remaining_qty || 0) <= 0.0005 ? 'zuzyta' : 'aktywna'
  }).eq('id', lot.id)
  if (error) throw error
}

async function persistLotsBatch(client, lotState, lotIds) {
  const ids = Array.from(new Set((lotIds || []).filter(Boolean)))
  if (!ids.length) return
  await Promise.all(ids.map(id => {
    const lot = lotState.get(id)
    return lot ? persistLot(client, lot) : Promise.resolve()
  }))
}

function saleMatchSpecWithOptions(sale, options = {}) {
  const keys = options.fifoSourceKeys || options.fifo_source_keys
  if (!keys?.length) return sale.matchSpec
  const variantKey = sale.matchSpec?.variantKey || normalizeFifoProductKey(sale.product_name)
  return buildFifoMatchSpecFromSourceKeys(variantKey, keys) || sale.matchSpec
}

function saleFifoCutoffDate(sale, workflow = null) {
  const wzDate = String(sale?.sale_date || '').slice(0, 10)
  const mode = workflow?.mode || 'bez_przerobu'
  const przerobDate = String(workflow?.przerob_date || workflow?.fifo_cutoff_date || '').slice(0, 10)
  if (mode === 'przerob' && przerobDate && przerobDate !== '0000-01-01') return przerobDate
  return wzDate || '9999-12-31'
}

function effectiveSaleMatchSpec(sale, workflow = null) {
  const keys = workflow?.fifo_source_keys
  if (keys?.length) {
    const variantKey = sale.matchSpec?.variantKey || normalizeFifoProductKey(sale.product_name)
    return buildFifoMatchSpecFromSourceKeys(variantKey, keys) || sale.matchSpec
  }
  return sale.matchSpec
}

function buildK03WorkflowBySaleKey(k03Docs = []) {
  const map = new Map()
  for (const snap of k03Docs) {
    const wf = snap.data?.k03_workflow
    const k03Key = snap.data?.k03_key || snap.data?.form_id
    if (k03Key?.startsWith('K03-')) {
      map.set(k03Key.replace(/^K03-/, ''), wf || {})
      continue
    }
    const opId = snap.data?.sale_operation_id || snap.operation_id
    const productId = snap.data?.product_id
    if (!opId || !productId) continue
    map.set(saleLineKey(opId, productId), wf || {})
  }
  return map
}

async function loadK03WorkflowBySaleKey(client, options = {}) {
  if (!options.forceReload && fifoBaseCache?.workflowBySaleKey) {
    return fifoBaseCache.workflowBySaleKey
  }
  const { data, error } = await client
    .from('haccp_documents')
    .select('operation_id, data')
    .eq('document_type', 'K03')
  if (error) throw error
  return buildK03WorkflowBySaleKey(data || [])
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

function deductAllocationsFromLots(allocations, lotState) {
  for (const alloc of allocations || []) {
    const lot = lotState.get(alloc.source_lot_id)
    if (!lot) continue
    lot.remaining_qty = Math.max(0, Number(lot.remaining_qty || 0) - Number(alloc.qty || 0))
    lotState.set(lot.id, lot)
  }
}

/** Przy podglądzie K03 – stany PZ od initial_qty, tylko w puli produktu (szybciej niż cały magazyn). */
function resetIncomingLotsInPool(lotState, productMap, matchSpec, opMap) {
  for (const lot of lotState.values()) {
    if (!fifoLotMatchesMatchSpec(lot, productMap, matchSpec)) continue
    const op = opMap.get(lot.source_operation_id)
    if (!isIncomingLotOperation(op)) continue
    lot.remaining_qty = Number(lot.initial_qty || 0)
    lot.status = lot.remaining_qty > 0.0005 ? 'aktywna' : lot.status
    lotState.set(lot.id, lot)
  }
}

async function allocateSale(client, sale, lotState, productMap, opMap, options = {}) {
  let remaining = Number(sale.sale_qty || 0)
  let allocated = 0
  let allocationCount = 0
  const cutoff = String(sale.sale_date || '9999-12-31').slice(0, 10)
  const matchSpec = options.matchSpec || sale.matchSpec
  const lots = candidateLots(lotState, productMap, matchSpec, cutoff, opMap)
  const touchedLotIds = options.touchedLotIds || null
  const deferPersist = Boolean(options.deferPersist)
  const allocRows = []

  for (const lot of lots) {
    if (remaining <= 0) break
    const available = Number(lot.remaining_qty || 0)
    const take = Math.min(available, remaining)
    if (take <= 0) continue

    const newRemaining = available - take
    lot.remaining_qty = newRemaining
    lot.status = newRemaining <= 0.0005 ? 'zuzyta' : 'aktywna'
    lotState.set(lot.id, lot)
    if (touchedLotIds) touchedLotIds.add(lot.id)
    allocRows.push({
      operation_id: sale.operation_id,
      source_lot_id: lot.id,
      product_id: sale.product_id,
      qty: take
    })

    allocationCount += 1
    remaining -= take
    allocated += take
  }

  if (!deferPersist && touchedLotIds) {
    await persistLotsBatch(client, lotState, [...touchedLotIds])
  } else if (!deferPersist) {
    const uniqueIds = [...new Set(allocRows.map(r => r.source_lot_id))]
    await persistLotsBatch(client, lotState, uniqueIds)
  }
  if (allocRows.length) {
    const { error: allocErr } = await client.from('fifo_allocations').insert(allocRows)
    if (allocErr) throw allocErr
  }

  return {
    allocationCount,
    allocated,
    shortage: remaining > 0.0005 ? remaining : 0,
    allocRows,
    touchedLotIds: touchedLotIds ? [...touchedLotIds] : [...new Set(allocRows.map(r => r.source_lot_id))]
  }
}

function simulateAllocation(sale, lotState, productMap, cutoffDate, opMap) {
  let remaining = Number(sale.sale_qty || 0)
  let allocated = 0
  const allocationRows = []
  const lots = candidateLots(lotState, productMap, sale.matchSpec, cutoffDate, opMap)

  for (const lot of lots) {
    if (remaining <= 0.0005) break
    const available = Number(lot.remaining_qty || 0)
    const take = Math.min(available, remaining)
    if (take <= 0) continue

    lot.remaining_qty = available - take
    lotState.set(lot.id, lot)
    allocationRows.push({ source_lot_id: lot.id, product_id: sale.product_id, qty: take })
    remaining -= take
    allocated += take
  }

  return {
    allocationRows,
    allocated,
    shortage: remaining > 0.0005 ? remaining : 0
  }
}

/** Odejmuje z partii rozliczenia FIFO innych WZ (także „późniejszych” w sortowaniu). */
function applyOtherSalesAllocations(base, lotState, excludeSaleKey, matchSpec, workflowBySaleKey = null) {
  const wfMap = workflowBySaleKey || base.workflowBySaleKey || new Map()
  for (const alloc of base.allocationsRaw || []) {
    const saleKey = saleLineKey(alloc.operation_id, alloc.product_id)
    if (saleKey === excludeSaleKey) continue
    const sale = base.saleByKey?.get(saleKey)
    if (!sale) continue
    const saleSpec = effectiveSaleMatchSpec(sale, wfMap.get(saleKey) || null)
    if (!sameFifoPool(saleSpec, matchSpec)) continue
    const lot = lotState.get(alloc.source_lot_id)
    if (!lot) continue
    lot.remaining_qty = Math.max(0, Number(lot.remaining_qty || 0) - Number(alloc.qty || 0))
    lotState.set(lot.id, lot)
  }
}

/** Rezerwuje FIFO dla wcześniejszych WZ bez pełnego rozliczenia (kolejność chronologiczna). */
function reservePriorUnallocatedSales(base, lotState, targetSaleKey, targetMatchSpec = null, workflowBySaleKey = null) {
  const targetIdx = base.sortedSales.findIndex(s => s.key === targetSaleKey)
  if (targetIdx <= 0) return { priorUnallocatedQty: 0, priorUnallocatedCount: 0 }

  const poolSpec = targetMatchSpec || base.sortedSales[targetIdx]?.matchSpec
  let priorUnallocatedQty = 0
  let priorUnallocatedCount = 0

  for (let i = 0; i < targetIdx; i += 1) {
    const sale = base.sortedSales[i]
    const priorWorkflow = workflowBySaleKey?.get(sale.key) || null
    const priorSpec = effectiveSaleMatchSpec(sale, priorWorkflow)
    if (!sameFifoPool(priorSpec, poolSpec)) continue

    const existing = base.allocationsBySaleKey.get(sale.key) || []
    const saleQty = Number(sale.sale_qty || 0)
    const allocatedQty = existing.reduce((s, a) => s + Number(a.qty || 0), 0)
    const missing = saleQty - allocatedQty
    if (missing <= 0.001) continue

    priorUnallocatedQty += missing
    priorUnallocatedCount += 1
  }

  return { priorUnallocatedQty, priorUnallocatedCount }
}

function simulateFullPoolFifo(base, matchSpec, workflowBySaleKey, options = {}) {
  const targetSaleKey = options.targetSaleKey
  const targetCutoff = String(options.targetCutoff || '').slice(0, 10)
  const targetSpec = options.targetMatchSpec || matchSpec
  const frozenKeys = options.frozenKeys || new Set()
  const wfMap = workflowBySaleKey || base.workflowBySaleKey || new Map()

  const lotState = new Map(Array.from(base.lotState.entries()).map(([k, v]) => [k, { ...v }]))
  resetIncomingLotsInPool(lotState, base.productMap, matchSpec, base.opMap)

  const results = new Map()
  let lotStateBeforeTarget = null
  let allocatedBeforeTargetKg = 0

  for (const sale of base.sortedSales) {
    const wf = wfMap.get(sale.key) || null
    const saleSpec = effectiveSaleMatchSpec(sale, wf)
    if (!sameFifoPool(saleSpec, matchSpec)) continue

    if (sale.key === targetSaleKey) {
      lotStateBeforeTarget = new Map(Array.from(lotState.entries()).map(([k, v]) => [k, { ...v }]))
    }

    if (frozenKeys.has(sale.key)) {
      const existing = base.allocationsBySaleKey.get(sale.key) || []
      const allocated = existing.reduce((s, a) => s + Number(a.qty || 0), 0)
      deductAllocationsFromLots(existing, lotState)
      results.set(sale.key, {
        allocationRows: existing.map(a => ({
          operation_id: sale.operation_id,
          source_lot_id: a.source_lot_id,
          product_id: a.product_id,
          qty: a.qty
        })),
        allocated,
        shortage: Math.max(0, Number(sale.sale_qty || 0) - allocated)
      })
      if (sale.key !== targetSaleKey) allocatedBeforeTargetKg += allocated
      continue
    }

    const specForSale = sale.key === targetSaleKey
      ? targetSpec
      : saleMatchSpecWithOptions(sale, { fifoSourceKeys: wf?.fifo_source_keys, fifo_source_keys: wf?.fifo_source_keys })
    const cutoff = sale.key === targetSaleKey
      ? (targetCutoff || saleFifoCutoffDate(sale, wf))
      : saleFifoCutoffDate(sale, wf)

    const sim = simulateAllocation(
      { ...sale, matchSpec: specForSale },
      lotState,
      base.productMap,
      cutoff,
      base.opMap
    )
    const rows = sim.allocationRows.map(r => ({
      operation_id: sale.operation_id,
      source_lot_id: r.source_lot_id,
      product_id: r.product_id,
      qty: r.qty
    }))
    results.set(sale.key, { ...sim, allocationRows: rows })
    if (sale.key !== targetSaleKey) allocatedBeforeTargetKg += sim.allocated
  }

  return { lotState, results, lotStateBeforeTarget, allocatedBeforeTargetKg }
}

async function persistPoolFifoSimulation(client, base, matchSpec, simulation, frozenKeys = new Set()) {
  const { lotState, results } = simulation
  const wfMap = base.workflowBySaleKey || new Map()

  const allocIdsToDelete = []
  for (const sale of base.sortedSales) {
    const saleSpec = effectiveSaleMatchSpec(sale, wfMap.get(sale.key) || null)
    if (!sameFifoPool(saleSpec, matchSpec)) continue
    if (frozenKeys.has(sale.key)) continue
    for (const a of base.allocationsBySaleKey.get(sale.key) || []) {
      if (a.id) allocIdsToDelete.push(a.id)
    }
  }
  if (allocIdsToDelete.length) await deleteAllocations(client, allocIdsToDelete)

  const insertRows = []
  for (const [sk, sim] of results) {
    if (frozenKeys.has(sk)) continue
    insertRows.push(...(sim.allocationRows || []))
  }
  for (let i = 0; i < insertRows.length; i += 200) {
    const chunk = insertRows.slice(i, i + 200)
    if (!chunk.length) continue
    const { error } = await client.from('fifo_allocations').insert(chunk)
    if (error) throw error
  }

  const poolLotIds = poolIncomingLotIds(base.lotState, base.productMap, matchSpec, base.opMap)
  for (const lotId of poolLotIds) {
    const simLot = lotState.get(lotId)
    const baseLot = base.lotState.get(lotId)
    if (!simLot || !baseLot) continue
    baseLot.remaining_qty = simLot.remaining_qty
    baseLot.status = simLot.status
  }
  if (poolLotIds.length) await persistLotsBatch(client, base.lotState, poolLotIds)
}

function initialPoolInventory(base, matchSpec, cutoff) {
  const lotState = new Map(Array.from(base.lotState.entries()).map(([k, v]) => [k, { ...v }]))
  resetIncomingLotsInPool(lotState, base.productMap, matchSpec, base.opMap)
  return summarizeGroupInventory(lotState, base.productMap, matchSpec, cutoff, base.opMap)
}

function poolIncomingLotIds(lotState, productMap, matchSpec, opMap) {
  const ids = []
  for (const lot of lotState.values()) {
    if (!fifoLotMatchesMatchSpec(lot, productMap, matchSpec)) continue
    if (!isIncomingLotOperation(opMap.get(lot.source_operation_id))) continue
    ids.push(lot.id)
  }
  return ids
}

/** remaining_qty = initial_qty − suma fifo_allocations (faktyczne kg w bazie). */
async function syncPoolLotRemainingFromAllocations(client, base, matchSpec) {
  const poolLotIds = poolIncomingLotIds(base.lotState, base.productMap, matchSpec, base.opMap)
  if (!poolLotIds.length) return 0

  const { data: allocs, error } = await client
    .from('fifo_allocations')
    .select('source_lot_id, qty')
    .in('source_lot_id', poolLotIds)
  if (error) throw error

  const usedByLot = new Map()
  for (const a of allocs || []) {
    usedByLot.set(a.source_lot_id, (usedByLot.get(a.source_lot_id) || 0) + Number(a.qty || 0))
  }

  for (const lotId of poolLotIds) {
    const lot = base.lotState.get(lotId)
    if (!lot) continue
    const initial = Number(lot.initial_qty || 0)
    const used = usedByLot.get(lotId) || 0
    lot.remaining_qty = Math.max(0, Math.round((initial - used) * 1000) / 1000)
    lot.status = lot.remaining_qty <= 0.0005 ? 'zuzyta' : 'aktywna'
    base.lotState.set(lotId, lot)
  }
  await persistLotsBatch(client, base.lotState, poolLotIds)
  return poolLotIds.length
}

/** Naprawia remaining_qty partii PZ wg fifo_allocations (po błędnym zapisie K03). */
export async function repairAllIncomingLotRemainingFromAllocations(client, { onProgress } = {}) {
  if (!client) throw new Error('Brak Supabase.')
  onProgress?.('Synchronizacja kg partii PZ z FIFO…')
  const base = await loadFifoBaseData(client, { forceReload: true })
  const incomingIds = []
  for (const lot of base.lotState.values()) {
    if (!isIncomingLotOperation(base.opMap.get(lot.source_operation_id))) continue
    incomingIds.push(lot.id)
  }
  if (!incomingIds.length) return { lots_synced: 0 }

  const { data: allocs, error } = await client
    .from('fifo_allocations')
    .select('source_lot_id, qty')
    .in('source_lot_id', incomingIds)
  if (error) throw error

  const usedByLot = new Map()
  for (const a of allocs || []) {
    usedByLot.set(a.source_lot_id, (usedByLot.get(a.source_lot_id) || 0) + Number(a.qty || 0))
  }

  for (const lotId of incomingIds) {
    const lot = base.lotState.get(lotId)
    if (!lot) continue
    const initial = Number(lot.initial_qty || 0)
    const used = usedByLot.get(lotId) || 0
    lot.remaining_qty = Math.max(0, Math.round((initial - used) * 1000) / 1000)
    lot.status = lot.remaining_qty <= 0.0005 ? 'zuzyta' : 'aktywna'
    base.lotState.set(lotId, lot)
  }
  await persistLotsBatch(client, base.lotState, incomingIds)
  invalidateFifoBaseCache()
  return { lots_synced: incomingIds.length }
}

function summarizeGroupInventory(lotState, productMap, matchSpec, cutoff, opMap) {
  let remainingWithinCutoff = 0
  let remainingAfterCutoff = 0
  let purchasedTotal = 0
  let purchasedWithinCutoff = 0
  let lotsMissingDateKg = 0
  let lotCount = 0
  let lotCountWithinCutoff = 0

  for (const lot of lotState.values()) {
    if (!fifoLotMatchesMatchSpec(lot, productMap, matchSpec)) continue
    lotCount += 1
    const initial = Number(lot.initial_qty || 0)
    const remaining = Number(lot.remaining_qty || 0)
    purchasedTotal += initial
    const receiptDate = lotReceiptDate(lot, opMap)
    if (!receiptDate || receiptDate === '0000-01-01') {
      lotsMissingDateKg += remaining
      continue
    }
    if (receiptDate <= cutoff) {
      purchasedWithinCutoff += initial
      remainingWithinCutoff += remaining
      lotCountWithinCutoff += 1
    } else {
      remainingAfterCutoff += remaining
    }
  }

  return {
    remainingWithinCutoff,
    remainingAfterCutoff,
    purchasedTotal,
    purchasedWithinCutoff,
    lotsMissingDateKg,
    lotCount,
    lotCountWithinCutoff
  }
}

function summarizeGroupSales(base, matchSpec, targetSaleKey) {
  let soldTotal = 0
  let soldBeforeTarget = 0
  const targetIdx = base.sortedSales.findIndex(s => s.key === targetSaleKey)

  for (let i = 0; i < base.sortedSales.length; i += 1) {
    const sale = base.sortedSales[i]
    if (!sameFifoPool(sale.matchSpec, matchSpec)) continue
    const qty = Number(sale.sale_qty || 0)
    soldTotal += qty
    if (targetIdx >= 0 && i < targetIdx) soldBeforeTarget += qty
  }

  return { soldTotal, soldBeforeTarget }
}

function enrichAllocationRowsLocal(allocationRows, lotState, opMap) {
  return (allocationRows || []).map(row => {
    const lot = lotState.get(row.source_lot_id) || {}
    const pzOp = opMap.get(lot.source_operation_id) || {}
    return {
      pz_no: pzOp.document_no || lot.lot_no || '',
      pz_date: String(pzOp.operation_date || lot.production_date || '').slice(0, 10),
      supplier: '',
      qty: row.qty,
      source_lot_no: lot.lot_no || '',
      source_lot_id: row.source_lot_id
    }
  })
}

async function enrichAllocationRows(client, allocationRows) {
  if (!allocationRows.length) return []
  const lotIds = Array.from(new Set(allocationRows.map(a => a.source_lot_id).filter(Boolean)))
  const lots = await fetchInChunks(client, 'lots', 'id, lot_no, production_date, source_operation_id, product_id', 'id', lotIds)
  const lotMap = new Map(lots.map(l => [l.id, l]))
  const opIds = Array.from(new Set(lots.map(l => l.source_operation_id).filter(Boolean)))
  const ops = opIds.length
    ? await fetchInChunks(client, 'operations', 'id, operation_date, document_no, contractor_id', 'id', opIds)
    : []
  const opMap = new Map(ops.map(o => [o.id, o]))

  return allocationRows.map(row => {
    const lot = lotMap.get(row.source_lot_id) || {}
    const pzOp = opMap.get(lot.source_operation_id) || {}
    return {
      pz_no: pzOp.document_no || lot.lot_no || '',
      pz_date: String(pzOp.operation_date || lot.production_date || '').slice(0, 10),
      supplier: '',
      qty: row.qty,
      source_lot_no: lot.lot_no || '',
      source_lot_id: row.source_lot_id
    }
  })
}

/** Podgląd FIFO dla jednej pozycji WZ z datą graniczną (przerób lub WZ). */
export async function previewFifoForSale(client, operationId, productId, cutoffDate, options = {}) {
  const base = await loadFifoBaseData(client)
  const workflowBySaleKey = base.workflowBySaleKey || new Map()
  const saleKey = saleLineKey(operationId, productId)
  const sale = base.saleByKey?.get(saleKey) || base.sortedSales.find(s => s.key === saleKey)
  if (!sale) {
    return { ok: false, error: 'Nie znaleziono pozycji WZ w danych FIFO.', pzRows: [], allocated: 0, shortage: 0, saleQty: 0 }
  }

  const matchSpec = saleMatchSpecWithOptions(sale, options)
  const cutoff = String(cutoffDate || sale.sale_date || '9999-12-31').slice(0, 10)
  const frozenKeys = options.frozenKeys || new Set()

  const purchasedInventory = initialPoolInventory(base, matchSpec, cutoff)
  const salesSummary = summarizeGroupSales(base, matchSpec, saleKey)
  const priorReserve = reservePriorUnallocatedSales(base, new Map(), saleKey, matchSpec, workflowBySaleKey)

  const simulation = simulateFullPoolFifo(base, matchSpec, workflowBySaleKey, {
    targetSaleKey: saleKey,
    targetCutoff: cutoff,
    targetMatchSpec: matchSpec,
    frozenKeys
  })

  const current = simulation.results.get(saleKey) || { allocationRows: [], allocated: 0, shortage: Number(sale.sale_qty || 0) }
  const inventoryForSale = simulation.lotStateBeforeTarget
    ? summarizeGroupInventory(simulation.lotStateBeforeTarget, base.productMap, matchSpec, cutoff, base.opMap)
    : purchasedInventory

  const pzRows = enrichAllocationRowsLocal(current.allocationRows, simulation.lotState, base.opMap)
  const pzRowsValid = pzRows.filter(r => {
    const pzDate = String(r.pz_date || '').slice(0, 10)
    return !pzDate || pzDate === '0000-01-01' || pzDate <= cutoff
  })
  const excludedFuturePzQty = pzRows
    .filter(r => {
      const pzDate = String(r.pz_date || '').slice(0, 10)
      return pzDate && pzDate !== '0000-01-01' && pzDate > cutoff
    })
    .reduce((s, r) => s + Number(r.qty || 0), 0)
  const allocatedValid = pzRowsValid.reduce((s, r) => s + Number(r.qty || 0), 0)
  const shortage = Math.max(0, Math.round((Number(sale.sale_qty || 0) - allocatedValid) * 1000) / 1000)

  return {
    ok: true,
    saleKey,
    saleQty: Number(sale.sale_qty || 0),
    allocated: allocatedValid,
    shortage,
    pzRows: pzRowsValid,
    cutoffDate: cutoff,
    excludedFuturePzQty,
    diagnostics: {
      productGroup: sale.sale_group,
      fifoVariant: matchSpec?.variantKey,
      fifoSourceVariants: matchSpec?.mode === 'variant' ? [...matchSpec.sourceKeys] : undefined,
      purchasedTotalKg: purchasedInventory.purchasedTotal,
      purchasedWithinCutoffKg: purchasedInventory.purchasedWithinCutoff,
      soldTotalKg: salesSummary.soldTotal,
      soldBeforeTargetKg: salesSummary.soldBeforeTarget,
      remainingWithinCutoffKg: inventoryForSale.remainingWithinCutoff,
      remainingAfterCutoffKg: purchasedInventory.remainingAfterCutoff,
      remainingWithinCutoffAfterReserveKg: inventoryForSale.remainingWithinCutoff,
      allocatedByOtherWzKg: simulation.allocatedBeforeTargetKg,
      lotsMissingDateKg: purchasedInventory.lotsMissingDateKg,
      lotCountInGroup: purchasedInventory.lotCount,
      lotCountWithinCutoff: purchasedInventory.lotCountWithinCutoff,
      priorUnallocatedWzCount: priorReserve.priorUnallocatedCount,
      priorUnallocatedWzKg: priorReserve.priorUnallocatedQty,
      targetSaleQty: Number(sale.sale_qty || 0)
    }
  }
}

/** Zapisuje rozliczenie FIFO dla jednej pozycji WZ z datą graniczną. */
export async function persistFifoForSale(client, operationId, productId, cutoffDate, logEntry = {}) {
  const base = await loadFifoBaseData(client)
  const workflowBySaleKey = base.workflowBySaleKey || new Map()
  const saleKey = saleLineKey(operationId, productId)
  const sale = base.saleByKey?.get(saleKey) || base.sortedSales.find(s => s.key === saleKey)
  if (!sale) throw new Error('Nie znaleziono pozycji WZ w danych FIFO.')
  const matchSpec = saleMatchSpecWithOptions(sale, logEntry)
  const frozenKeys = logEntry.frozenKeys || new Set()

  const existing = base.allocationsBySaleKey.get(saleKey) || []
  const beforeData = {
    allocation_count: existing.length,
    allocated_qty: existing.reduce((s, a) => s + Number(a.qty || 0), 0)
  }

  const cutoff = String(cutoffDate || sale.sale_date || '9999-12-31').slice(0, 10)
  const simulation = simulateFullPoolFifo(base, matchSpec, workflowBySaleKey, {
    targetSaleKey: saleKey,
    targetCutoff: cutoff,
    targetMatchSpec: matchSpec,
    frozenKeys
  })
  await persistPoolFifoSimulation(client, base, matchSpec, simulation, frozenKeys)

  const current = simulation.results.get(saleKey) || { allocationRows: [], allocated: 0, shortage: 0 }
  const enrichedPzAll = enrichAllocationRowsLocal(current.allocationRows, simulation.lotState, base.opMap)
  const enrichedPz = enrichedPzAll.filter(r => {
    const pzDate = String(r.pz_date || '').slice(0, 10)
    return !pzDate || pzDate === '0000-01-01' || pzDate <= cutoff
  })
  const excludedFuturePzQty = enrichedPzAll
    .filter(r => {
      const pzDate = String(r.pz_date || '').slice(0, 10)
      return pzDate && pzDate !== '0000-01-01' && pzDate > cutoff
    })
    .reduce((s, r) => s + Number(r.qty || 0), 0)
  if (excludedFuturePzQty > 0.0005 && current.allocationRows.length) {
    const badRows = enrichedPzAll
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => {
        const pzDate = String(r.pz_date || '').slice(0, 10)
        return pzDate && pzDate !== '0000-01-01' && pzDate > cutoff
      })
    if (badRows.length) {
      const badAllocIds = []
      const { data: newAllocs, error: findErr } = await client
        .from('fifo_allocations')
        .select('id, qty, source_lot_id')
        .eq('operation_id', operationId)
        .eq('product_id', productId)
      if (findErr) throw findErr
      for (const { i } of badRows) {
        const lotId = current.allocationRows[i]?.source_lot_id
        const bad = (newAllocs || []).find(a => a.source_lot_id === lotId)
        if (bad?.id) badAllocIds.push(bad.id)
      }
      if (badAllocIds.length) await deleteAllocations(client, badAllocIds)
      await syncPoolLotRemainingFromAllocations(client, base, matchSpec)
    }
  }
  const allocatedValid = enrichedPz.reduce((s, r) => s + Number(r.qty || 0), 0)
  const shortage = Math.max(0, Math.round((Number(sale.sale_qty || 0) - allocatedValid) * 1000) / 1000)

  await logFifoChange(client, {
    wz_no: sale.sale_doc_no,
    wz_date: String(sale.sale_date || '').slice(0, 10),
    product_name: sale.product_name,
    k03_key: logEntry.k03_key || saleKey,
    change_type: logEntry.change_type || 'k03_fifo_allocated',
    before_data: beforeData,
    after_data: {
      allocated_qty: allocatedValid,
      shortage,
      cutoff_date: cutoff,
      allocation_count: enrichedPz.length,
      excluded_future_pz_qty: excludedFuturePzQty
    },
    change_reason: logEntry.change_reason || 'Rozliczenie FIFO dla K03',
    changed_by: logEntry.changed_by || 'operator'
  })

  invalidateFifoBaseCache()

  return {
    ok: true,
    allocationCount: current.allocationRows.length,
    allocated: allocatedValid,
    shortage,
    pzRows: enrichedPz,
    cutoffDate: cutoff,
    saleQty: Number(sale.sale_qty || 0),
    excludedFuturePzQty,
    allocRows: current.allocationRows
  }
}

/** Cofnięcie rozliczenia FIFO dla pozycji WZ (tylko gdy K03 nie zamrożony). */
export async function revertFifoForSale(client, operationId, productId, logEntry = {}) {
  const base = await loadFifoBaseData(client)
  const saleKey = saleLineKey(operationId, productId)
  const existing = base.allocationsBySaleKey.get(saleKey) || []
  if (!existing.length) return { ok: true, removed: 0 }

  const beforeData = {
    allocation_count: existing.length,
    allocated_qty: existing.reduce((s, a) => s + Number(a.qty || 0), 0)
  }

  restoreAllocationsToLots(existing, base.lotState)
  await deleteAllocations(client, existing.map(a => a.id))
  const restoredLotIds = [...new Set(existing.map(a => a.source_lot_id).filter(Boolean))]
  await persistLotsBatch(client, base.lotState, restoredLotIds)

  const sale = base.sortedSales.find(s => s.key === saleKey)
  await logFifoChange(client, {
    wz_no: sale?.sale_doc_no || '',
    wz_date: String(sale?.sale_date || '').slice(0, 10),
    product_name: sale?.product_name || '',
    k03_key: logEntry.k03_key || saleKey,
    change_type: logEntry.change_type || 'k03_fifo_reverted',
    before_data: beforeData,
    after_data: { allocation_count: 0 },
    change_reason: logEntry.change_reason || 'Cofnięcie rozliczenia K03/WZ',
    changed_by: logEntry.changed_by || 'operator'
  })

  invalidateFifoBaseCache()
  return { ok: true, removed: existing.length }
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
  const onProgress = options.onProgress
  const base = await loadFifoBaseData(client)
  const { sortedSales, allocationsBySaleKey, lotState, productMap, opMap } = base

  let processed = 0
  let skippedComplete = 0
  let skippedFrozen = 0
  let allocationCount = 0
  const shortages = []
  const touchedLotIds = new Set()
  const total = sortedSales.length
  onProgress?.({ phase: 'start', current: 0, total, message: `Wczytano ${total} pozycji WZ…` })

  for (let i = 0; i < sortedSales.length; i += 1) {
    const sale = sortedSales[i]
    const existing = allocationsBySaleKey.get(sale.key) || []
    const allocatedQty = existing.reduce((sum, a) => sum + Number(a.qty || 0), 0)
    const saleQty = Number(sale.sale_qty || 0)

    if (frozenKeys.has(sale.key)) {
      skippedFrozen += 1
      if (i % 25 === 0) onProgress?.({ phase: 'running', current: i + 1, total, processed, skippedComplete, skippedFrozen })
      continue
    }

    if (allocatedQty + 0.001 >= saleQty) {
      skippedComplete += 1
      if (i % 25 === 0) onProgress?.({ phase: 'running', current: i + 1, total, processed, skippedComplete, skippedFrozen })
      continue
    }

    if (existing.length) {
      restoreAllocationsToLots(existing, lotState)
      await deleteAllocations(client, existing.map(a => a.id))
      for (const id of existing.map(a => a.source_lot_id).filter(Boolean)) touchedLotIds.add(id)
    }

    const result = await allocateSale(client, sale, lotState, productMap, opMap, {
      deferPersist: true,
      touchedLotIds
    })
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

    if (i % 10 === 0 || i === sortedSales.length - 1) {
      onProgress?.({ phase: 'running', current: i + 1, total, processed, skippedComplete, skippedFrozen, allocationCount })
    }
  }

  onProgress?.({ phase: 'saving', current: total, total, message: `Zapis partii (${touchedLotIds.size})…` })
  await persistLotsBatch(client, lotState, [...touchedLotIds])
  onProgress?.({ phase: 'done', current: total, total, processed, skippedComplete, skippedFrozen, allocationCount, shortages: shortages.length })

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

    const result = await allocateSale(client, sale, lotState, productMap, opMap)
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
