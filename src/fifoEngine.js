/**
 * FIFO – przeliczanie przyrostowe (braki) i pełne z ochroną zamrożonych K03.
 */
import { isSaleOperation, resolveFifoProductGroup, resolveFifoMatchSpec, buildFifoMatchSpecFromSourceKeys, fifoLotMatchesMatchSpec, sameFifoPool, normalizeFifoProductKey, resolveFifoSourcePzNo } from './k03Engine'

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

/** Pobiera całą tabelę stronicowaniem (Supabase domyślnie zwraca max 1000 wierszy). */
async function fetchAllPaginated(client, table, select, options = {}) {
  const pageSize = options.pageSize || 2000
  const orderCol = options.orderBy || 'id'
  const filters = options.filters || []
  const all = []
  let offset = 0
  while (true) {
    let query = client.from(table).select(select).order(orderCol, { ascending: true }).range(offset, offset + pageSize - 1)
    for (const f of filters) {
      if (f.type === 'eq') query = query.eq(f.column, f.value)
    }
    const { data, error } = await query
    if (error) throw error
    if (!data?.length) break
    all.push(...data)
    if (data.length < pageSize) break
    offset += pageSize
  }
  return all
}

export function frozenKeysFromSnapshots(snapshots = []) {
  const keys = new Set()
  for (const snap of snapshots) {
    if (snap?.data?.frozen !== true) continue
    const k03Key = snap.data?.k03_key || snap.data?.form_id
    if (k03Key) {
      keys.add(k03Key)
      if (k03Key.startsWith('K03-')) keys.add(k03Key.replace(/^K03-/, ''))
    }
    const opId = snap.data?.sale_operation_id || snap.operation_id
    const productId = snap.data?.product_id
    if (opId && productId) keys.add(saleLineKey(opId, productId))
  }
  return keys
}

function isFrozenSaleKey(saleKey, frozenKeys) {
  if (!saleKey || !frozenKeys?.size) return false
  if (frozenKeys.has(saleKey)) return true
  if (frozenKeys.has(`K03-${saleKey}`)) return true
  return false
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
  const [products, lotsRaw, operations, saleItemsRaw, allocationsRaw, k03Docs] = await Promise.all([
    fetchAllPaginated(client, 'products', 'id, name, code, product_group'),
    fetchAllPaginated(client, 'lots', 'id, lot_no, product_id, product_group, production_date, created_at, initial_qty, remaining_qty, source_operation_id, status'),
    fetchAllPaginated(client, 'operations', 'id, operation_type, operation_date, document_no, created_at'),
    fetchAllPaginated(client, 'operation_items', 'id, operation_id, product_id, qty, direction, raw_product_name', {
      filters: [{ type: 'eq', column: 'direction', value: 'rozchod' }]
    }),
    fetchAllPaginated(client, 'fifo_allocations', 'id, operation_id, source_lot_id, product_id, qty'),
    fetchAllPaginated(client, 'haccp_documents', 'operation_id, data', {
      filters: [{ type: 'eq', column: 'document_type', value: 'K03' }]
    })
  ])
  const productsErr = null
  const lotsErr = null
  const opsErr = null
  const itemsErr = null
  const allocErr = null
  const k03Err = null
  if (productsErr) throw productsErr
  if (lotsErr) throw lotsErr
  if (opsErr) throw opsErr
  if (itemsErr) throw itemsErr
  if (allocErr) throw allocErr
  if (k03Err) throw k03Err

  const productMap = new Map((products || []).map(p => [p.id, p]))
  const opMap = new Map((operations || []).map(o => [o.id, o]))
  const lotSourceOpIds = [...new Set((lotsRaw || []).map(l => l.source_operation_id).filter(Boolean))]
  const missingOpIds = lotSourceOpIds.filter(id => !opMap.has(id))
  if (missingOpIds.length) {
    const extraOps = await fetchInChunks(
      client,
      'operations',
      'id, operation_type, operation_date, document_no, created_at',
      'id',
      missingOpIds
    )
    for (const o of extraOps) opMap.set(o.id, o)
  }
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
  const frozenAllocationsBySaleKey = buildFrozenAllocationsBySaleKey(k03Docs || [], lotState, opMap)

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
    workflowBySaleKey,
    frozenAllocationsBySaleKey,
    k03Docs: k03Docs || []
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

function normalizePzDocKey(docNo) {
  return String(docNo || '').trim().toUpperCase().replace(/\s+/g, '')
}

function findLotIdForK03RawRow(row, lotState, opMap) {
  if (row?.isShortage) return null
  if (row?.source_lot_id && lotState.has(row.source_lot_id)) return row.source_lot_id

  const lotNo = String(row?.source_lot_no || '').trim()
  if (lotNo) {
    for (const lot of lotState.values()) {
      if (String(lot.lot_no || '') === lotNo) return lot.id
    }
  }

  const pzCandidates = new Set()
  for (const field of [row?.pz_no, row?.pz_no_display, row?.supplier]) {
    const text = String(field || '').trim()
    if (!text || text === '—') continue
    pzCandidates.add(normalizePzDocKey(text))
    const pzMatch = text.match(/PZ[\s./,-]*[\d/]+(?:\/\d{4})?/i)
    if (pzMatch) pzCandidates.add(normalizePzDocKey(pzMatch[0]))
  }
  if (!pzCandidates.size) return null

  const pzDate = String(row?.pz_date || '').slice(0, 10)
  const rowQty = Number(row?.qty || 0)

  const matches = []
  for (const lot of lotState.values()) {
    const docNo = normalizePzDocKey(opMap.get(lot.source_operation_id)?.document_no)
    if (!docNo) continue
    const docHit = [...pzCandidates].some(c => c === docNo || docNo.startsWith(c) || c.startsWith(docNo))
    if (!docHit) continue
    const lotDate = lotReceiptDate(lot, opMap)
    matches.push({ lot, lotDate, qtyDiff: Math.abs(Number(lot.initial_qty || 0) - rowQty) })
  }

  if (!matches.length) return null
  matches.sort((a, b) => {
    if (pzDate && a.lotDate !== b.lotDate) {
      if (a.lotDate === pzDate) return -1
      if (b.lotDate === pzDate) return 1
    }
    return a.qtyDiff - b.qtyDiff
  })
  return matches[0].lot.id
}

/** Rozliczenia z zamrożonego K03 (rawRows) – gdy fifo_allocations w bazie nieaktualne. */
function buildFrozenAllocationsBySaleKey(k03Docs, lotState, opMap) {
  const map = new Map()
  for (const snap of k03Docs || []) {
    if (snap?.data?.frozen !== true) continue
    const opId = snap.data?.sale_operation_id || snap.operation_id
    const productId = snap.data?.product_id
    if (!opId) continue
    const key = saleLineKey(opId, productId)
    const sale = { operation_id: opId, product_id: productId, sale_qty: Number(snap.qty || snap.data?.saleQty || 0) }
    const rows = snap.data?.rawRows || []
    const allocs = []
    for (const row of rows) {
      const qty = Number(row?.qty || 0)
      if (qty <= 0.001 || row?.isShortage) continue
      const lotId = findLotIdForK03RawRow(row, lotState, opMap)
      if (!lotId) continue
      allocs.push({
        operation_id: opId,
        source_lot_id: lotId,
        product_id: productId,
        qty
      })
    }
    if (allocs.length) map.set(key, allocs)
  }
  return map
}

function allocationTotal(allocs) {
  return (allocs || []).reduce((s, a) => s + Number(a.qty || 0), 0)
}

function toAllocationRows(sale, allocs) {
  return (allocs || []).map(a => ({
    operation_id: sale.operation_id,
    source_lot_id: a.source_lot_id,
    product_id: a.product_id ?? sale.product_id,
    qty: a.qty
  }))
}

/**
 * Zamrożone K03 i wcześniejsze WZ z zapisanym FIFO – używają zapisanych przypisań,
 * nie świeżej symulacji (unika podwójnego pobierania tych samych PZ).
 */
function resolveSaleLockedAllocations(sale, base, frozenKeys, targetIdx, saleIndex) {
  const isFrozen = isFrozenSaleKey(sale.key, frozenKeys)
  const dbAllocs = base.allocationsBySaleKey.get(sale.key) || []
  const snapAllocs = base.frozenAllocationsBySaleKey?.get(sale.key) || []
  const dbQty = allocationTotal(dbAllocs)
  const snapQty = allocationTotal(snapAllocs)
  const hasWorkflow = Boolean(base.workflowBySaleKey?.get(sale.key))
  const isPriorCommitted = saleIndex < targetIdx && (hasWorkflow || dbQty > 0.001)

  if (isFrozen) {
    if (snapQty >= dbQty - 0.001 && snapQty > 0.001) return snapAllocs
    if (dbQty > 0.001) return dbAllocs
    if (snapQty > 0.001) return snapAllocs
    return []
  }

  if (isPriorCommitted && dbQty > 0.001) return dbAllocs
  return null
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
  const cutoff = String(options.cutoffDate || sale.sale_date || '9999-12-31').slice(0, 10)
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

function simulateAllocation(sale, lotState, productMap, cutoffDate, opMap, matchSpec = null) {
  let remaining = Number(sale.sale_qty || 0)
  let allocated = 0
  const allocationRows = []
  const spec = matchSpec || sale.matchSpec
  const lots = candidateLots(lotState, productMap, spec, cutoffDate, opMap)

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

/**
 * FIFO wg klasy produktu:
 * 1. WZ w kolejności daty sprzedaży (operation_date)
 * 2. Ta sama klasa PZ (np. truskawka ≠ truskawka z szypułką)
 * 3. PZ z datą przyjęcia ≤ data WZ (bez przerobu) lub ≤ data przerobu
 * 4. Partie PZ w kolejności daty przyjęcia (najstarsze pierwsze)
 */
function runClassFifoSimulation(base, matchSpec, workflowBySaleKey, options = {}) {
  const targetSaleKey = options.targetSaleKey || null
  const targetCutoff = String(options.targetCutoff || '').slice(0, 10)
  const targetSpec = options.targetMatchSpec || matchSpec
  const frozenKeys = options.frozenKeys || new Set()
  const wfMap = workflowBySaleKey || base.workflowBySaleKey || new Map()
  const processAll = !targetSaleKey
  const targetIdx = processAll ? Infinity : base.sortedSales.findIndex(s => s.key === targetSaleKey)

  const lotState = new Map(Array.from(base.lotState.entries()).map(([k, v]) => [k, { ...v }]))
  resetIncomingLotsInPool(lotState, base.productMap, matchSpec, base.opMap)

  const results = new Map()
  let lotStateBeforeTarget = null
  let allocatedBeforeTargetKg = 0

  if (!processAll && targetIdx < 0) {
    return { lotState, results, lotStateBeforeTarget: null, allocatedBeforeTargetKg: 0 }
  }

  for (let i = 0; i < base.sortedSales.length; i += 1) {
    if (!processAll && i > targetIdx) break

    const sale = base.sortedSales[i]
    const wf = wfMap.get(sale.key) || null
    const saleSpec = effectiveSaleMatchSpec(sale, wf)
    if (!sameFifoPool(saleSpec, matchSpec)) continue

    if (sale.key === targetSaleKey) {
      lotStateBeforeTarget = new Map(Array.from(lotState.entries()).map(([k, v]) => [k, { ...v }]))
    }

    const locked = resolveSaleLockedAllocations(sale, base, frozenKeys, targetIdx, i)
    if (locked !== null) {
      deductAllocationsFromLots(locked, lotState)
      const allocated = allocationTotal(locked)
      const rows = toAllocationRows(sale, locked)
      results.set(sale.key, {
        allocationRows: rows,
        allocated,
        shortage: Math.max(0, Math.round((Number(sale.sale_qty || 0) - allocated) * 1000) / 1000)
      })
      if (sale.key !== targetSaleKey) allocatedBeforeTargetKg += allocated
      continue
    }

    let specForSale = saleSpec
    if (sale.key === targetSaleKey) specForSale = targetSpec
    else if (options.pendingTarget?.saleKey === sale.key) {
      specForSale = options.pendingTarget.matchSpec || matchSpec
    }
    let cutoff = sale.key === targetSaleKey
      ? (targetCutoff || saleFifoCutoffDate(sale, wf))
      : saleFifoCutoffDate(sale, wf)

    const pending = options.pendingTarget
    if (pending && sale.key === pending.saleKey) {
      cutoff = String(pending.cutoff || cutoff).slice(0, 10)
    }

    const sim = simulateAllocation(
      { ...sale, matchSpec: specForSale },
      lotState,
      base.productMap,
      cutoff,
      base.opMap,
      specForSale
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

  const allocIdsToDelete = []
  for (const sk of results.keys()) {
    if (isFrozenSaleKey(sk, frozenKeys)) continue
    for (const a of base.allocationsBySaleKey.get(sk) || []) {
      if (a.id) allocIdsToDelete.push(a.id)
    }
  }
  if (allocIdsToDelete.length) await deleteAllocations(client, allocIdsToDelete)

  const insertRows = []
  for (const [sk, sim] of results) {
    if (isFrozenSaleKey(sk, frozenKeys)) continue
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

function summarizeGroupInventory(lotState, productMap, matchSpec, cutoff, opMap, options = {}) {
  const incomingOnly = options.incomingOnly !== false
  let remainingWithinCutoff = 0
  let remainingAfterCutoff = 0
  let purchasedTotal = 0
  let purchasedWithinCutoff = 0
  let lotsMissingDateKg = 0
  let lotCount = 0
  let lotCountWithinCutoff = 0

  for (const lot of lotState.values()) {
    if (!fifoLotMatchesMatchSpec(lot, productMap, matchSpec)) continue
    const isIncoming = isIncomingLotOperation(opMap?.get(lot.source_operation_id))
    if (incomingOnly && !isIncoming) continue

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

/** Audyt: ile kg PZ w innych klasach tej samej rodziny (np. szypułka obok truskawki). */
function auditSiblingClassInventory(base, matchSpec, cutoff) {
  const variant = matchSpec?.variantKey
  if (!variant) return null
  const siblings = []
  if (variant === 'truskawka') {
    siblings.push(buildFifoMatchSpecFromSourceKeys('truskawka z szypulka', ['truskawka z szypulka']))
  } else if (variant === 'truskawka z szypulka') {
    siblings.push(buildFifoMatchSpecFromSourceKeys('truskawka', ['truskawka']))
  }
  if (!siblings.length) return null

  const lotState = new Map(Array.from(base.lotState.entries()).map(([k, v]) => [k, { ...v }]))
  const out = []
  for (const spec of siblings) {
    if (!spec) continue
    resetIncomingLotsInPool(lotState, base.productMap, spec, base.opMap)
    const inv = summarizeGroupInventory(lotState, base.productMap, spec, cutoff, base.opMap)
    out.push({
      classLabel: [...spec.sourceKeys].join(', '),
      purchasedWithinCutoffKg: inv.purchasedWithinCutoff,
      purchasedTotalKg: inv.purchasedTotal,
      lotCount: inv.lotCount
    })
  }
  return out
}

function summarizeGroupSales(base, matchSpec, targetSaleKey) {
  let soldTotal = 0
  let soldBeforeTarget = 0
  const targetIdx = base.sortedSales.findIndex(s => s.key === targetSaleKey)
  const wfMap = base.workflowBySaleKey || new Map()

  for (let i = 0; i < base.sortedSales.length; i += 1) {
    const sale = base.sortedSales[i]
    const saleSpec = effectiveSaleMatchSpec(sale, wfMap.get(sale.key) || null)
    if (!sameFifoPool(saleSpec, matchSpec)) continue
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
    const fullDoc = String(pzOp.document_no || '').trim()
    const pzNo = resolveFifoSourcePzNo(lot, opMap) || (fullDoc && !/^[A-Za-z]{1,8}\/\d{1,5}\//.test(fullDoc) ? fullDoc : '')
    return {
      pz_no: pzNo,
      pz_date: String(pzOp.operation_date || lot.production_date || '').slice(0, 10),
      supplier: pzNo || fullDoc,
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
    const pzNo = resolveFifoSourcePzNo(lot, opMap)
    return {
      pz_no: pzNo,
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
  const base = await loadFifoBaseData(client, { forceReload: true })
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
  const siblingAudit = auditSiblingClassInventory(base, matchSpec, cutoff)
  const salesSummary = summarizeGroupSales(base, matchSpec, saleKey)
  const priorReserve = reservePriorUnallocatedSales(base, new Map(), saleKey, matchSpec, workflowBySaleKey)

  const simulation = runClassFifoSimulation(base, matchSpec, workflowBySaleKey, {
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
      fifoClassLabel: matchSpec?.mode === 'variant' ? [...matchSpec.sourceKeys].join(', ') : matchSpec?.variantKey,
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
      lotsTotalLoaded: base.lotState?.size || 0,
      priorUnallocatedWzCount: priorReserve.priorUnallocatedCount,
      priorUnallocatedWzKg: priorReserve.priorUnallocatedQty,
      targetSaleQty: Number(sale.sale_qty || 0),
      siblingClasses: siblingAudit
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
  const fullSimulation = runClassFifoSimulation(base, matchSpec, workflowBySaleKey, {
    frozenKeys,
    targetSaleKey: saleKey,
    targetCutoff: cutoff,
    targetMatchSpec: matchSpec
  })
  await persistPoolFifoSimulation(client, base, matchSpec, fullSimulation, frozenKeys)

  const current = fullSimulation.results.get(saleKey) || { allocationRows: [], allocated: 0, shortage: 0 }
  const enrichedPzAll = enrichAllocationRowsLocal(current.allocationRows, fullSimulation.lotState, base.opMap)
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
  const { sortedSales, allocationsBySaleKey, lotState, productMap, opMap, workflowBySaleKey } = base
  const wfMap = workflowBySaleKey || new Map()

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

    if (isFrozenSaleKey(sale.key, frozenKeys)) {
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

    const wf = wfMap.get(sale.key) || null
    const matchSpec = effectiveSaleMatchSpec(sale, wf)
    const cutoff = saleFifoCutoffDate(sale, wf)

    const result = await allocateSale(client, sale, lotState, productMap, opMap, {
      deferPersist: true,
      touchedLotIds,
      matchSpec,
      cutoffDate: cutoff
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
  const { sortedSales, lotState, productMap, allocationsRaw, lotsRaw, opMap, workflowBySaleKey } = base
  const wfMap = workflowBySaleKey || new Map()

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
    if (isFrozenSaleKey(sale.key, frozenKeys)) {
      skippedFrozen += 1
      continue
    }

    const wf = wfMap.get(sale.key) || null
    const matchSpec = effectiveSaleMatchSpec(sale, wf)
    const cutoff = saleFifoCutoffDate(sale, wf)

    const result = await allocateSale(client, sale, lotState, productMap, opMap, {
      matchSpec,
      cutoffDate: cutoff
    })
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
    if (isFrozenSaleKey(sale.key, frozenKeys)) {
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
