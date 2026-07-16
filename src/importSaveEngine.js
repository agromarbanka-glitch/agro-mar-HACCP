/**
 * Zapis importu Excel do Supabase – batch + retry (mniej zapytań, odporność na NetworkError).
 *
 * IMPORT SAVE v2.0 (zatwierdzony wzorzec — nie zmieniaj bez zgłoszenia problemu z importem):
 * - HACCP/magazyn osobno od wartości magazynu (bez ceny netto)
 * - jeden przebieg zapisu + create_incoming_lots_batch v48
 * - K01 i lekki repair po zapisie w tle (main.jsx)
 * - duplikaty PZ/WZ po numerze dokumentu → pomijane (FIFO)
 * - brakujące pozycje w istniejących PZ → doklejane z Excela (append)
 * - WZ: data z Excela (Data wystawienia), nie ostatni dzień miesiąca z numeru
 */
export const IMPORT_SAVE_ENGINE_VERSION = '2.2'

import { normalizeDocumentNo, inferDateFromDocumentNo, documentNoHasExplicitDate, documentNoHasMonthYear, isWzMonthYearDocument, resolveDocumentIssueDate, documentNoImportAliases, monthYearFromDocumentNo } from './excelImport.js'
import { repairPorzeczkaProductGroups, canonicalProductName } from './k03Engine.js'
import { invalidateFifoBaseCache } from './fifoEngine.js'
import { k01LineDedupeKey } from './k01Engine.js'

const OP_CHUNK = 400
const ITEM_CHUNK = 800
const NAME_CHUNK = 150
const LOT_RPC_CHUNK = 1000
const LOT_CONCURRENCY = 32
const ITEM_LOT_UPDATE_CHUNK = 120
const RETRY_ATTEMPTS = 3
const RETRY_BASE_MS = 400

async function runWithConcurrency(tasks, concurrency, onTick) {
  if (!tasks.length) return []
  const results = new Array(tasks.length)
  let next = 0
  let done = 0
  async function worker() {
    while (next < tasks.length) {
      const index = next++
      results[index] = await tasks[index]()
      done += 1
      onTick?.(done, tasks.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker))
  return results
}

function isTransientNetworkError(err) {
  const msg = String(err?.message || err || '')
  return /networkerror|failed to fetch|load failed|network request failed|fetch/i.test(msg)
}

export async function withImportRetry(fn) {
  let lastErr
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (!isTransientNetworkError(err) || attempt === RETRY_ATTEMPTS - 1) throw err
      await new Promise(r => setTimeout(r, RETRY_BASE_MS * (attempt + 1)))
    }
  }
  throw lastErr
}

export async function getExistingOperationsForImport(client, groups) {
  const keys = new Set()
  const details = new Map()
  let orphanCount = 0
  const documentNos = [...new Set(groups.map(g => normalizeDocumentNo(g.documentNo)).filter(Boolean))]

  /** Warianty nr dokumentu (ze spacją po prefiksie, bez sufiksu lokalizacji). */
  function documentNoQueryVariants(normalized) {
    return documentNoImportAliases(normalized)
  }

  function registerExistingOperation(op, importMeta) {
    const imp = importMeta ?? op.imported_files
    if (imp?.deleted_at) {
      orphanCount += 1
      return
    }
    const candidate = {
      documentNo: op.document_no,
      operationType: op.operation_type,
      operationId: op.id,
      operationDate: op.operation_date || null,
      importFilename: imp?.filename || null,
      importDeleted: Boolean(imp?.deleted_at),
      createdAt: op.created_at,
      importedFileId: op.imported_file_id
    }
    const exactNorm = normalizeDocumentNo(op.document_no)
    const exactKey = `${op.operation_type}|${exactNorm}`
    keys.add(exactKey)
    const existingExact = details.get(exactKey)
    if (!existingExact || String(candidate.createdAt || '') > String(existingExact.createdAt || '')) {
      details.set(exactKey, candidate)
    }
    // Aliasy tylko do wyszukiwania meta — NIE do klucza duplikatu (Kolonia ≠ inny PZ).
    for (const alias of documentNoImportAliases(op.document_no)) {
      if (alias === exactNorm) continue
      const aliasKey = `${op.operation_type}|${alias}`
      if (!details.has(aliasKey)) details.set(aliasKey, candidate)
    }
  }

  const docChunks = []
  for (let i = 0; i < documentNos.length; i += 200) {
    docChunks.push(documentNos.slice(i, i + 200))
  }

  await Promise.all(docChunks.map(async (chunk) => {
    const queryNos = [...new Set(chunk.flatMap(documentNoQueryVariants))]
    let data
    let error
    ;({ data, error } = await withImportRetry(() =>
      client.from('operations')
        .select('id, operation_type, document_no, operation_date, imported_file_id, created_at, imported_files(filename, deleted_at, status)')
        .in('document_no', queryNos)
    ))
    if (error) {
      ;({ data, error } = await withImportRetry(() =>
        client.from('operations').select('id, operation_type, document_no, operation_date, imported_file_id, created_at').in('document_no', queryNos)
      ))
      if (error) throw error
      const fileIds = [...new Set((data || []).map(o => o.imported_file_id).filter(Boolean))]
      const importMetaById = new Map()
      if (fileIds.length) {
        const { data: files, error: filesErr } = await withImportRetry(() =>
          client.from('imported_files').select('id, filename, deleted_at, status').in('id', fileIds)
        )
        if (filesErr) throw filesErr
        for (const f of files || []) importMetaById.set(f.id, f)
      }
      for (const op of data || []) {
        registerExistingOperation(op, importMetaById.get(op.imported_file_id))
      }
      return
    }
    for (const op of data || []) {
      registerExistingOperation(op)
    }
  }))

  return { keys, details, orphanCount }
}

/** @deprecated użyj getExistingOperationsForImport */
export async function getExistingOperationKeys(client, groups) {
  const { keys } = await getExistingOperationsForImport(client, groups)
  return keys
}

export function operationImportKey(group) {
  return `${group.operation}|${normalizeDocumentNo(group.documentNo)}`
}

/** Szuka metadanych operacji w bazie (dopasowanie także bez sufiksu /Kolonia itd.). */
export function resolveOperationImportMeta(group, details) {
  if (!group || !details) return null
  const op = group.operation
  for (const alias of documentNoImportAliases(group.documentNo)) {
    const meta = details.get(`${op}|${alias}`)
    if (meta?.operationId) return meta
  }
  return details.get(operationImportKey(group)) || null
}

function groupExistsInImportKeys(group, existingKeys) {
  const op = group.operation
  const doc = normalizeDocumentNo(group.documentNo)
  if (existingKeys.has(`${op}|${doc}`)) return true
  const m = doc.match(/^(PZ|WZ)(\/.*)$/i)
  if (m && existingKeys.has(`${op}|${m[1]} ${m[2]}`)) return true
  // Excel z /Kolonia — dopasuj bazę bez sufiksu (legacy), ale nie odwrotnie.
  const base = doc.replace(/^((?:PZ|WZ)\/\d+\/\d{1,2}\/\d{1,2}\/\d{4})\/[^/\d][^/]*$/iu, '$1')
  if (base !== doc && existingKeys.has(`${op}|${base}`)) return true
  return false
}

/** Dzieli grupy dokumentów na już w bazie (duplikaty) i nowe. */
export function splitImportGroupsByExisting(groups, existingKeys) {
  const duplicates = []
  const fresh = []
  for (const g of groups || []) {
    if (groupExistsInImportKeys(g, existingKeys)) duplicates.push(g)
    else fresh.push(g)
  }
  return { duplicates, fresh }
}

function defaultNormalizeText(value) {
  return String(value || '').trim().toLowerCase()
}

function productFifoMatchKey(name, product, deps = {}) {
  const canon = deps.canonicalProductName || (s => s)
  const fifo = deps.normalizeFifoProductKey
  const canonical = canon(String(name || '').trim()) || String(name || '').trim()
  if (fifo) return fifo(canonical, product || { name: canonical })
  const norm = deps.normalizeText || defaultNormalizeText
  return norm(canonical)
}

/** Klucz pozycji do porównania import ↔ baza (klasa FIFO + kg). */
export function importItemMatchKey(row, deps = {}) {
  const nameKey = productFifoMatchKey(row.productName, null, deps)
  const qty = Math.round(Math.abs(Number(row.qty) || 0) * 1000) / 1000
  return `${nameKey}|${qty}`
}

function storedItemMatchKey(item, deps = {}) {
  const raw = item.raw_product_name || item.products?.name || ''
  const nameKey = productFifoMatchKey(raw, item.products, deps)
  const qty = Math.round(Math.abs(Number(item.qty) || 0) * 1000) / 1000
  return `${nameKey}|${qty}`
}

function itemKeyCounts(items, deps, kind) {
  const counts = new Map()
  for (const entry of items || []) {
    const key = kind === 'stored' ? storedItemMatchKey(entry, deps) : importItemMatchKey(entry, deps)
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return counts
}

/** Porównuje pozycje Excel z zapisem w bazie — nowe linie vs zmiany ilości/dat (multiset). */
export function diffImportGroupAgainstStored(group, storedOp, storedItems, deps = {}) {
  const storedDate = String(storedOp?.operationDate || storedOp?.operation_date || '').slice(0, 10)
  const importDate = String(group?.issueDate || '').slice(0, 10)
  const dateChanged = Boolean(storedDate && importDate && storedDate !== importDate)

  const storedCounts = itemKeyCounts(storedItems, deps, 'stored')
  const newItems = []
  for (const row of group?.items || []) {
    const key = importItemMatchKey(row, deps)
    const left = storedCounts.get(key) || 0
    if (left > 0) storedCounts.set(key, left - 1)
    else newItems.push(row)
  }

  let removedCount = 0
  for (const n of storedCounts.values()) removedCount += n
  const qtyChanged = removedCount > 0

  const changes = []
  if (dateChanged) changes.push(`data dokumentu: ${storedDate} → ${importDate}`)
  if (qtyChanged) changes.push(`zmiana pozycji (brakuje ${removedCount} linii w pliku vs baza)`)
  if (newItems.length) changes.push(`${newItems.length} nowych linii w pliku`)

  return {
    newItems,
    removedCount,
    dateChanged,
    hasContentChanges: dateChanged || qtyChanged,
    changes
  }
}

export function partitionImportGroups(groups, existingKeys) {
  const fresh = []
  const existing = []
  for (const g of groups || []) {
    if (existingKeys.has(operationImportKey(g))) existing.push(g)
    else fresh.push(g)
  }
  return { fresh, existing }
}

async function fetchOperationItemsByOpIds(client, opIds) {
  const byOp = new Map()
  const unique = [...new Set((opIds || []).filter(Boolean))]
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50)
    let offset = 0
    const pageSize = 1000
    while (true) {
      const { data, error } = await withImportRetry(() =>
        client.from('operation_items')
          .select('id, operation_id, product_id, qty, direction, raw_product_name, products(name)')
          .in('operation_id', chunk)
          .order('id', { ascending: true })
          .range(offset, offset + pageSize - 1)
      )
      if (error) throw error
      if (!data?.length) break
      for (const item of data) {
        const list = byOp.get(item.operation_id) || []
        list.push(item)
        byOp.set(item.operation_id, list)
      }
      if (data.length < pageSize) break
      offset += pageSize
    }
  }
  return byOp
}

/**
 * Dokleja nowe pozycje do dokumentów już w bazie (kontynuacja miesiąca).
 * @returns {{ importedItems, createdLots, mergedDocuments, unchangedDocuments, changedDocuments }}
 */
export async function appendNewItemsFromExistingDocuments(client, existingGroups, details, deps, { onProgress } = {}) {
  const notify = msg => onProgress?.(msg)
  if (!client || !existingGroups?.length) {
    return { importedItems: 0, createdLots: 0, mergedDocuments: 0, unchangedDocuments: 0, changedDocuments: [] }
  }

  const opIds = [...new Set(existingGroups
    .map(g => resolveOperationImportMeta(g, details)?.operationId)
    .filter(Boolean))]
  const itemsByOp = await fetchOperationItemsByOpIds(client, opIds)

  const productNames = []
  for (const group of existingGroups) {
    for (const row of group.items || []) productNames.push(row.productName)
  }
  notify('Doklejanie pozycji do istniejących dokumentów…')
  const productMap = await ensureProductIds(client, productNames, deps)

  let importedItems = 0
  let createdLots = 0
  let mergedDocuments = 0
  let unchangedDocuments = 0
  const changedDocuments = []
  const allIncomingItems = []
  const mergedOpIds = new Set()

  for (const group of existingGroups) {
    const meta = resolveOperationImportMeta(group, details)
    const opId = meta?.operationId
    if (!opId) continue

    const storedItems = itemsByOp.get(opId) || []
    const diff = diffImportGroupAgainstStored(group, meta, storedItems, deps)

    if (diff.hasContentChanges) {
      changedDocuments.push({
        operation: group.operation,
        documentNo: group.documentNo,
        operationId: opId,
        changes: diff.changes
      })
    }

    const itemsToAdd = storedItems.length === 0 && (group.items?.length || 0) > 0
      ? (group.items || [])
      : diff.newItems

    if (!itemsToAdd.length) {
      if (!diff.hasContentChanges) unchangedDocuments += 1
      continue
    }

    mergedDocuments += 1
    mergedOpIds.add(opId)
    for (const row of itemsToAdd) {
      const canonicalName = deps.canonicalProductName?.(row.productName) || row.productName || 'Produkt do dopasowania'
      const productId = productMap.get(deps.normalizeText(canonicalName))
      const itemQty = Math.abs(Number(row.qty) || 0)
      if (itemQty <= 0 || !productId) continue

      const direction = group.operation === 'przyjecie' ? 'przychod' : 'rozchod'
      const { data: inserted, error } = await withImportRetry(() =>
        client.from('operation_items').insert({
          operation_id: opId,
          product_id: productId,
          qty: itemQty,
          unit: 'kg',
          direction,
          raw_product_name: row.productName
        }).select('id').single()
      )
      if (error) throw error
      importedItems += 1

      if (direction === 'przychod') {
        allIncomingItems.push({
          direction,
          group,
          row,
          productId,
          itemQty,
          opId,
          itemId: inserted.id
        })
      }
    }
  }

  if (allIncomingItems.length) {
    notify(`Tworzenie ${allIncomingItems.length} partii (doklejone PZ)…`)
    createdLots = await attachLotsToIncomingItems(client, allIncomingItems, deps, notify)
  }

  return { importedItems, createdLots, mergedDocuments, unchangedDocuments, changedDocuments, mergedOperationIds: [...mergedOpIds] }
}

/** Pozycje przychodu (PZ) bez lot_id — np. przerwany import; tworzy partie i wiąże. */
export async function repairMissingIncomingLots(client, deps, { onProgress, importedFileId } = {}) {
  if (importedFileId) {
    return repairMissingIncomingLotsForImport(client, importedFileId, deps, { onProgress })
  }
  const notify = msg => onProgress?.(msg)
  if (!client) return 0

  notify('Sprawdzanie pozycji PZ bez partii (cała baza)…')
  const PAGE = 500
  let offset = 0
  const toFix = []

  while (true) {
    const { data, error } = await withImportRetry(() =>
      client
        .from('operation_items')
        .select('id, operation_id, product_id, qty, raw_product_name, operations!inner(id, operation_date, operation_type)')
        .eq('direction', 'przychod')
        .is('lot_id', null)
        .eq('operations.operation_type', 'przyjecie')
        .range(offset, offset + PAGE - 1)
    )
    if (error) throw error
    if (!data?.length) break
    toFix.push(...data)
    if (data.length < PAGE) break
    offset += PAGE
  }

  if (!toFix.length) return 0

  notify(`Tworzenie ${toFix.length} brakujących partii PZ…`)
  const incomingItems = toFix
    .map(item => {
      const qty = Math.abs(Number(item.qty) || 0)
      const opDate = String(item.operations?.operation_date || '').slice(0, 10)
      return {
        direction: 'przychod',
        group: { issueDate: opDate },
        row: { productName: item.raw_product_name || '' },
        productId: item.product_id,
        itemQty: qty,
        opId: item.operation_id,
        itemId: item.id
      }
    })
    .filter(i => i.itemQty > 0 && i.productId && i.opId && i.itemId)

  if (!incomingItems.length) return 0
  return attachLotsToIncomingItems(client, incomingItems, deps, notify)
}

/** Naprawa partii PZ tylko dla jednego pliku importu (szybkie po dużym imporcie). */
export async function repairMissingIncomingLotsForImport(client, importedFileId, deps, { onProgress } = {}) {
  const notify = msg => onProgress?.(msg)
  if (!client || !importedFileId) return 0

  notify('Sprawdzanie pozycji PZ bez partii (ten import)…')
  const { data: ops, error: opsErr } = await withImportRetry(() =>
    client.from('operations').select('id').eq('imported_file_id', importedFileId).eq('operation_type', 'przyjecie')
  )
  if (opsErr) throw opsErr
  const opIds = (ops || []).map(o => o.id)
  if (!opIds.length) return 0

  const toFix = []
  for (let i = 0; i < opIds.length; i += 100) {
    const chunk = opIds.slice(i, i + 100)
    const { data, error } = await withImportRetry(() =>
      client
        .from('operation_items')
        .select('id, operation_id, product_id, qty, raw_product_name, operations!inner(id, operation_date, operation_type)')
        .in('operation_id', chunk)
        .eq('direction', 'przychod')
        .is('lot_id', null)
    )
    if (error) throw error
    toFix.push(...(data || []))
  }

  if (!toFix.length) return 0

  notify(`Tworzenie ${toFix.length} brakujących partii PZ…`)
  const incomingItems = toFix
    .map(item => {
      const qty = Math.abs(Number(item.qty) || 0)
      const opDate = String(item.operations?.operation_date || '').slice(0, 10)
      return {
        direction: 'przychod',
        group: { issueDate: opDate },
        row: { productName: item.raw_product_name || '' },
        productId: item.product_id,
        itemQty: qty,
        opId: item.operation_id,
        itemId: item.id
      }
    })
    .filter(i => i.itemQty > 0 && i.productId && i.opId && i.itemId)

  if (!incomingItems.length) return 0
  return attachLotsToIncomingItems(client, incomingItems, deps, notify)
}

export function formatMergeResult(merge) {
  if (!merge?.importedItems && !merge?.createdLots) return ''
  const docs = merge.mergedDocuments ? ` (${merge.mergedDocuments} dokumentów)` : ''
  return `Doklejono ${merge.importedItems} brakujących pozycji z Excela${docs}, utworzono ${merge.createdLots || 0} partii.`
}

/** Pobiera zapis operacji + pozycje — do wykrywania zmian na rozpisanych PZ/WZ. */
export async function loadStoredImportOperations(client, groups, details) {
  const opIds = [...new Set((groups || [])
    .map(g => resolveOperationImportMeta(g, details)?.operationId)
    .filter(Boolean))]
  const itemsByOp = await fetchOperationItemsByOpIds(client, opIds)
  const out = new Map()
  for (const group of groups || []) {
    const key = operationImportKey(group)
    const meta = resolveOperationImportMeta(group, details)
    if (!meta?.operationId) continue
    out.set(key, {
      meta,
      items: itemsByOp.get(meta.operationId) || []
    })
  }
  return out
}

async function deleteRowsInChunks(client, table, column, ids, chunkSize = 80) {
  const unique = [...new Set((ids || []).filter(Boolean))]
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize)
    const { error } = await withImportRetry(() => client.from(table).delete().in(column, chunk))
    if (error) throw error
  }
}

/** Usuwa wszystkie wiersze z tabeli partiami (paginacja). */
async function deleteAllTableRows(client, table, idColumn = 'id', batchSize = 500) {
  while (true) {
    const { data, error } = await withImportRetry(() =>
      client.from(table).select(idColumn).limit(batchSize)
    )
    if (error) throw error
    if (!data?.length) break
    const ids = data.map(r => r[idColumn]).filter(Boolean)
    await deleteRowsInChunks(client, table, idColumn, ids, 100)
    if (data.length < batchSize) break
  }
}

/** Kasuje operacje, partie i FIFO jednego importu (gdy brak migracji v40/v42 w Supabase). */
export async function purgeImportDataClientSide(client, importedFileId) {
  const { data: ops, error: opsErr } = await withImportRetry(() =>
    client.from('operations').select('id, document_no').eq('imported_file_id', importedFileId)
  )
  if (opsErr) throw opsErr
  const opIds = (ops || []).map(o => o.id)
  if (!opIds.length) return { operations: 0, lots: 0 }

  const [{ data: lotsBySource }, { data: items }] = await Promise.all([
    withImportRetry(() => client.from('lots').select('id').in('source_operation_id', opIds)),
    withImportRetry(() => client.from('operation_items').select('lot_id').in('operation_id', opIds))
  ])
  const lotIds = [...new Set([
    ...(lotsBySource || []).map(l => l.id),
    ...(items || []).map(i => i.lot_id).filter(Boolean)
  ])]

  const wzNos = [...new Set((ops || []).map(o => o.document_no).filter(Boolean))]

  const { data: haccpByOp } = await withImportRetry(() =>
    client.from('haccp_documents').select('id').in('operation_id', opIds)
  )
  const { data: haccpByLot } = lotIds.length
    ? await withImportRetry(() => client.from('haccp_documents').select('id').in('lot_id', lotIds))
    : { data: [] }
  const haccpIds = [...new Set([...(haccpByOp || []).map(d => d.id), ...(haccpByLot || []).map(d => d.id)])]
  if (haccpIds.length) {
    await deleteRowsInChunks(client, 'haccp_document_history', 'document_id', haccpIds)
    await deleteRowsInChunks(client, 'haccp_documents', 'id', haccpIds)
  }

  if (wzNos.length) {
    for (let i = 0; i < wzNos.length; i += 50) {
      const chunk = wzNos.slice(i, i + 50)
      await withImportRetry(() => client.from('fifo_allocation_change_log').delete().in('wz_no', chunk))
    }
  }

  await deleteRowsInChunks(client, 'fifo_allocations', 'operation_id', opIds)
  if (lotIds.length) {
    for (const lotId of lotIds) {
      await withImportRetry(() => client.from('fifo_allocations').delete().or(`source_lot_id.eq.${lotId},output_lot_id.eq.${lotId}`))
    }
    await deleteRowsInChunks(client, 'pz_fifo_change_log', 'lot_id', lotIds)
    for (let i = 0; i < lotIds.length; i += 80) {
      const chunk = lotIds.slice(i, i + 80)
      await withImportRetry(() => client.from('operation_items').update({ lot_id: null }).in('lot_id', chunk))
    }
  }

  await deleteRowsInChunks(client, 'operation_items', 'operation_id', opIds)
  if (lotIds.length) {
    await deleteRowsInChunks(client, 'lot_location_history', 'lot_id', lotIds)
    await deleteRowsInChunks(client, 'lot_change_history', 'lot_id', lotIds)
    await deleteRowsInChunks(client, 'lots', 'id', lotIds)
  }
  await deleteRowsInChunks(client, 'operations', 'id', opIds)

  return { operations: opIds.length, lots: lotIds.length }
}

async function purgeStaleInProgressImportsClient(client, filename, excludeImportId = null) {
  if (!filename) return { removed: 0 }
  let query = client
    .from('imported_files')
    .select('id')
    .is('deleted_at', null)
    .eq('status', 'w_trakcie')
    .ilike('filename', filename)
  if (excludeImportId) query = query.neq('id', excludeImportId)
  const { data: stale, error } = await withImportRetry(() => query)
  if (error) throw error
  let removed = 0
  for (const row of stale || []) {
    await purgeImportDataClientSide(client, row.id)
    await withImportRetry(() => client.from('imported_files').delete().eq('id', row.id))
    removed += 1
  }
  return { removed }
}

async function purgeOrphanLotsRpc(client) {
  const { data, error } = await withImportRetry(() => client.rpc('purge_orphan_import_lots'))
  if (error) {
    if (/function.*does not exist/i.test(String(error.message || ''))) return 0
    throw error
  }
  return Number(data || 0)
}

async function purgeDeletedImportLotsClient(client) {
  const { data: deletedFiles, error: dfErr } = await withImportRetry(() =>
    client.from('imported_files').select('id').not('deleted_at', 'is', null)
  )
  if (dfErr) throw dfErr
  let lots = 0
  for (const f of deletedFiles || []) {
    const r = await purgeImportDataClientSide(client, f.id)
    lots += r.lots || 0
  }
  return lots
}

export async function runFullImportLotCleanup(client, filename, excludeImportId = null) {
  const prep = await prepareImportExcelSave(client, filename, excludeImportId)
  let extraLots = await purgeOrphanLotsRpc(client)
  try {
    extraLots += await purgeDeletedImportLotsClient(client)
  } catch (_) { /* brak uprawnień / stara baza */ }
  return { ...prep, orphan_lots_removed: (prep?.orphan_lots_removed || 0) + extraLots }
}

/** Przed zapisem: usuwa pozostałości usuniętych importów i przerwane importy tego samego pliku. */
export async function prepareImportExcelSave(client, filename, excludeImportId = null) {
  const { data, error } = await withImportRetry(() =>
    client.rpc('prepare_import_excel_save', {
      p_filename: filename || null,
      p_exclude_import_id: excludeImportId || null
    })
  )
  if (!error) return data || {}

  if (!/function.*does not exist/i.test(String(error.message || ''))) throw error

  const cleanup = await cleanupOrphanedDeletedImports(client)
  const stale = await purgeStaleInProgressImportsClient(client, filename, excludeImportId)
  const orphanLots = await purgeOrphanLotsRpc(client)
  return {
    needsMigration: true,
    deleted_imports_cleaned: cleanup?.imports_purged || 0,
    stale_in_progress_removed: stale.removed,
    orphan_lots_removed: orphanLots,
    fallback: true
  }
}

export function formatPrepareImportResult(prep) {
  if (!prep) return ''
  const parts = []
  if ((prep.deleted_imports_cleaned || 0) > 0 || (prep.deleted_lots_cleaned || 0) > 0) {
    parts.push(`wyczyszczono pozostałości ${prep.deleted_imports_cleaned || 0} usuniętych importów`)
  }
  if ((prep.stale_in_progress_removed || 0) > 0) {
    parts.push(`usunięto ${prep.stale_in_progress_removed} przerwanych importów (${prep.stale_lots_removed || '?'} partii)`)
  }
  if ((prep.orphan_lots_removed || 0) > 0) {
    parts.push(`usunięto ${prep.orphan_lots_removed} osieroconych partii`)
  }
  if (prep.needsMigration && prep.fallback) {
    parts.push('użyto trybu awaryjnego (uruchom migrację v40+v42 w Supabase)')
  }
  return parts.length ? `${parts.join(', ')}.` : ''
}

async function insertInChunks(client, table, rows, select, chunkSize) {
  const out = []
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize)
    const { data, error } = await withImportRetry(() => client.from(table).insert(chunk).select(select))
    if (error) throw error
    out.push(...(data || []))
  }
  return out
}

async function fetchNamesInChunks(client, table, column, names, selectCols = '*') {
  const out = []
  for (let i = 0; i < names.length; i += NAME_CHUNK) {
    const chunk = names.slice(i, i + NAME_CHUNK)
    const { data, error } = await withImportRetry(() => client.from(table).select(selectCols).in(column, chunk))
    if (error) throw error
    out.push(...(data || []))
  }
  return out
}

async function ensureProductIds(client, productNames, deps) {
  const unique = [...new Set(productNames.map(n => (deps.canonicalProductName?.(n) || n) || 'Produkt do dopasowania'))]
  const { normalizeText, baseCodeForProduct, productGroupForName, canonicalProductName } = deps
  const map = new Map()

  const { data: catalog, error: catalogErr } = await withImportRetry(() =>
    client.from('products').select('id, name, code')
  )
  if (catalogErr) throw catalogErr

  for (const p of catalog || []) {
    map.set(normalizeText(p.name), p.id)
    const canonical = canonicalProductName?.(p.name) || p.name
    map.set(normalizeText(canonical), p.id)
  }

  const missing = unique.filter(name => !map.has(normalizeText(name)))
  if (!missing.length) return map

  const codesInUse = new Set((catalog || []).map(p => p.code))
  const toInsert = []

  for (const name of missing) {
    const key = normalizeText(name)
    let code = baseCodeForProduct(name)
    let suffix = 2
    while (codesInUse.has(code)) {
      const owner = (catalog || []).find(p => p.code === code)
      if (owner && normalizeText(owner.name) === key) {
        map.set(key, owner.id)
        break
      }
      code = `${baseCodeForProduct(name)}${suffix}`
      suffix += 1
    }
    if (map.has(key)) continue
    codesInUse.add(code)
    toInsert.push({
      name,
      code,
      product_type: 'surowiec_lub_produkt',
      product_group: productGroupForName(name),
      _key: key
    })
  }

  if (toInsert.length) {
    const inserted = await insertInChunks(
      client,
      'products',
      toInsert.map(({ _key, ...row }) => row),
      'id, name',
      50
    )
    for (let i = 0; i < inserted.length; i += 1) {
      map.set(toInsert[i]._key, inserted[i].id)
    }
  }
  return map
}

async function ensureContractorIds(client, contractorNames) {
  const unique = [...new Set(contractorNames.filter(Boolean).map(n => String(n).trim()))]
  const map = new Map()
  if (!unique.length) return map

  const { data: catalog, error: catalogErr } = await withImportRetry(() =>
    client.from('contractors').select('id, name')
  )
  if (catalogErr) throw catalogErr

  const byExact = new Map()
  const byNorm = new Map()
  for (const c of catalog || []) {
    byExact.set(c.name, c.id)
    byNorm.set(String(c.name || '').trim().toLowerCase(), c.id)
  }

  for (const name of unique) {
    const id = byExact.get(name) || byNorm.get(name.toLowerCase())
    if (id) map.set(name, id)
  }

  const missing = unique.filter(name => !map.has(name))
  for (const name of missing) {
    const { data, error } = await withImportRetry(() =>
      client.from('contractors').insert({ name, contractor_type: 'oba' }).select('id, name').maybeSingle()
    )
    if (error) {
      if (/duplicate key|contractors_name_key|unique constraint/i.test(String(error.message || ''))) {
        const retry = byExact.get(name) || byNorm.get(name.toLowerCase())
        if (retry) {
          map.set(name, retry)
          continue
        }
        const { data: refetch, error: refetchErr } = await withImportRetry(() =>
          client.from('contractors').select('id, name')
        )
        if (refetchErr) throw refetchErr
        for (const c of refetch || []) {
          byExact.set(c.name, c.id)
          byNorm.set(String(c.name || '').trim().toLowerCase(), c.id)
        }
        const id2 = byExact.get(name) || byNorm.get(name.toLowerCase())
        if (id2) map.set(name, id2)
        else throw error
      } else {
        throw error
      }
    } else if (data?.id) {
      map.set(name, data.id)
      byExact.set(data.name, data.id)
      byNorm.set(String(data.name || '').trim().toLowerCase(), data.id)
    }
  }
  return map
}

/** Partie bez komory – przypisanie ręczne w zakładce Magazyn. */
async function createIncomingLot(client, { productId, operationId, operationDate, qty, productName, deps }) {
  const { productGroupForName } = deps

  const { data: lotNo, error: lotNoErr } = await withImportRetry(() =>
    client.rpc('generate_lot_no', { p_product_id: productId, p_date: operationDate })
  )
  if (lotNoErr) throw lotNoErr

  const productGroup = productGroupForName(productName)

  const { data: lot, error: lotErr } = await withImportRetry(() =>
    client.from('lots').insert({
      product_id: productId,
      lot_no: lotNo,
      source_operation_id: operationId,
      production_date: operationDate,
      initial_qty: qty,
      remaining_qty: qty,
      unit: 'kg',
      product_group: productGroup,
      storage_chamber_id: null,
      unit_price_net: null
    }).select('id').single()
  )
  if (lotErr) throw lotErr
  return lot.id
}

async function syncLotSequencesForProducts(client, productIds) {
  const ids = [...new Set((productIds || []).filter(Boolean))]
  if (!ids.length) return
  try {
    await withImportRetry(() =>
      client.rpc('sync_lot_sequences_from_lots', { p_product_ids: ids })
    )
  } catch (err) {
    if (!/function.*does not exist/i.test(String(err?.message || ''))) throw err
  }
}

async function createIncomingLotsBatchRpc(client, incomingItems, deps, notify) {
  let total = 0
  const chunkCount = Math.ceil(incomingItems.length / LOT_RPC_CHUNK)
  for (let i = 0; i < incomingItems.length; i += LOT_RPC_CHUNK) {
    const slice = incomingItems.slice(i, i + LOT_RPC_CHUNK)
    notify(`Tworzenie partii ${Math.min(i + slice.length, incomingItems.length)} / ${incomingItems.length}…`)
    const payload = slice.map(meta => ({
      item_id: meta.itemId,
      product_id: meta.productId,
      operation_id: meta.opId,
      operation_date: meta.group.issueDate,
      qty: meta.itemQty,
      product_group: deps.productGroupForName(meta.row.productName),
      unit_price_net: null
    }))

    let lastErr = null
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { data, error } = await withImportRetry(() =>
        client.rpc('create_incoming_lots_batch', { p_items: payload })
      )
      if (!error) {
        total += Number(data || 0)
        lastErr = null
        break
      }
      lastErr = error
      if (
        attempt === 0 &&
        /unikalnego numeru partii|generate_lot_no|lot_no/i.test(String(error.message || ''))
      ) {
        notify('Synchronizacja numerów partii…')
        const productIds = [...new Set(slice.map(s => s.productId).filter(Boolean))]
        await syncLotSequencesForProducts(client, productIds)
        continue
      }
      throw error
    }
    if (lastErr) throw lastErr
  }
  if (chunkCount > 1) notify(`Utworzono ${total} partii.`)
  return total
}

async function filterIncomingWithExistingOps(client, incomingItems) {
  const opIds = [...new Set(incomingItems.map(i => i.opId).filter(Boolean))]
  if (!opIds.length) return []
  const existing = new Set()
  for (let i = 0; i < opIds.length; i += 100) {
    const chunk = opIds.slice(i, i + 100)
    const { data, error } = await withImportRetry(() =>
      client.from('operations').select('id').in('id', chunk)
    )
    if (error) throw error
    for (const row of data || []) existing.add(row.id)
  }
  return incomingItems.filter(i => existing.has(i.opId))
}

async function attachLotsToIncomingItems(client, incomingItems, deps, notify) {
  if (!incomingItems.length) return 0

  try {
    return await createIncomingLotsBatchRpc(client, incomingItems, deps, notify)
  } catch (err) {
    if (!/function.*does not exist|create_incoming_lots_batch/i.test(String(err?.message || ''))) throw err
  }

  notify(`Tworzenie partii 0 / ${incomingItems.length}… (tryb równoległy)`)
  const lotIds = await runWithConcurrency(
    incomingItems.map(meta => () => createIncomingLot(client, {
      productId: meta.productId,
      operationId: meta.opId,
      operationDate: meta.group.issueDate,
      qty: meta.itemQty,
      productName: meta.row.productName,
      deps
    })),
    LOT_CONCURRENCY,
    (done, total) => {
      if (done === total || done % 25 === 0) notify(`Tworzenie partii ${done} / ${total}…`)
    }
  )

  for (let i = 0; i < incomingItems.length; i += ITEM_LOT_UPDATE_CHUNK) {
    const slice = incomingItems.slice(i, i + ITEM_LOT_UPDATE_CHUNK)
    await Promise.all(slice.map((meta, j) =>
      withImportRetry(() =>
        client.from('operation_items').update({ lot_id: lotIds[i + j] }).eq('id', meta.itemId)
      )
    ))
  }

  return lotIds.length
}

async function fetchExistingOperationRow(client, row) {
  const variants = documentNoImportAliases(row.document_no)
  for (const docNo of variants) {
    const { data, error } = await withImportRetry(() =>
      client
        .from('operations')
        .select('id, operation_type, document_no')
        .eq('operation_type', row.operation_type)
        .eq('document_no', docNo)
        .maybeSingle()
    )
    if (error) throw error
    if (data?.id) return data
  }
  return null
}

async function insertOperationsForGroups(client, groups, importedFileId, contractorMap, notify) {
  const allOpRows = groups.map(group => ({
    operation_type: group.operation,
    operation_date: group.issueDate,
    document_no: group.documentNo,
    invoice_no: group.invoiceNo,
    contractor_id: group.contractorName ? contractorMap.get(group.contractorName) : null,
    imported_file_id: importedFileId,
    notes: group.notes || null
  }))

  let insertedOps
  try {
    const total = allOpRows.length
    insertedOps = []
    for (let i = 0; i < allOpRows.length; i += OP_CHUNK) {
      const chunk = allOpRows.slice(i, i + OP_CHUNK)
      notify?.(`Zapis dokumentów ${Math.min(i + chunk.length, total)} / ${total}…`)
      const part = await insertInChunks(client, 'operations', chunk, 'id, operation_type, document_no', OP_CHUNK)
      insertedOps.push(...part)
    }
  } catch (err) {
    if (!String(err?.message || '').includes('duplicate')) throw err
    insertedOps = []
    for (const row of allOpRows) {
      try {
        const { data: one, error: oneErr } = await withImportRetry(() =>
          client.from('operations').insert(row).select('id, operation_type, document_no').single()
        )
        if (oneErr) {
          if (String(oneErr.message || '').includes('duplicate')) {
            const existing = await fetchExistingOperationRow(client, row)
            if (existing) insertedOps.push(existing)
            continue
          }
          throw oneErr
        }
        insertedOps.push(one)
      } catch (inner) {
        if (String(inner?.message || '').includes('duplicate')) {
          const existing = await fetchExistingOperationRow(client, row)
          if (existing) insertedOps.push(existing)
          continue
        }
        throw inner
      }
    }
  }

  const opKeyToId = new Map()
  for (const op of insertedOps) {
    for (const alias of documentNoImportAliases(op.document_no)) {
      opKeyToId.set(`${op.operation_type}|${alias}`, op.id)
    }
  }
  return { opKeyToId, importedOperations: insertedOps.length }
}

async function insertItemsAndLotsForGroups(client, groups, opKeyToId, productMap, deps, notify, fileName, importedFileId) {
  let importedItems = 0
  let rozchodItems = 0
  let createdLots = 0
  const allItemRows = []
  const allItemMeta = []

  notify?.(`Przygotowanie ${groups.length} dokumentów, ${groups.reduce((s, g) => s + (g.items?.length || 0), 0)} pozycji…`)
  for (const group of groups) {
    let opId = opKeyToId.get(operationImportKey(group))
    if (!opId) {
      for (const alias of documentNoImportAliases(group.documentNo)) {
        opId = opKeyToId.get(`${group.operation}|${alias}`)
        if (opId) break
      }
    }
    if (!opId) continue

    for (const row of group.items) {
      const canonicalName = deps.canonicalProductName?.(row.productName) || row.productName || 'Produkt do dopasowania'
      const productId = productMap.get(deps.normalizeText(canonicalName))
      const direction = group.operation === 'przyjecie' ? 'przychod' : 'rozchod'
      const itemQty = Math.abs(Number(row.qty) || 0)
      if (itemQty <= 0 || !productId) continue

      allItemRows.push({
        operation_id: opId,
        product_id: productId,
        qty: itemQty,
        unit: 'kg',
        direction,
        raw_product_name: row.productName
      })
      allItemMeta.push({ direction, group, row, productId, itemQty, opId })
    }
  }

  const allIncomingItems = []
  if (allItemRows.length) {
    notify?.(`Zapis ${allItemRows.length} pozycji magazynowych…`)
    const insertedItems = await insertInChunks(client, 'operation_items', allItemRows, 'id', ITEM_CHUNK)
    for (let j = 0; j < insertedItems.length; j += 1) {
      const item = insertedItems[j]
      const meta = allItemMeta[j]
      if (!item?.id || !meta) continue
      importedItems += 1
      if (meta.direction === 'rozchod') {
        rozchodItems += 1
        continue
      }
      allIncomingItems.push({ ...meta, itemId: item.id })
    }
  }

  if (allIncomingItems.length) {
    notify(`Tworzenie ${allIncomingItems.length} partii…`)
    try {
      createdLots = await attachLotsToIncomingItems(client, allIncomingItems, deps, notify)
    } catch (lotErr) {
      const lotMsg = String(lotErr?.message || '')
      if (!/lots_lot_no_key|duplicate key.*lot|lots_source_operation_id_fkey/i.test(lotMsg)) throw lotErr
      notify('Pozostałości partii w bazie – pełne sprzątanie…')
      await runFullImportLotCleanup(client, fileName, importedFileId)
      createdLots = await attachLotsToIncomingItems(client, allIncomingItems, deps, notify)
    }
  }

  return { importedItems, rozchodItems, createdLots }
}

/**
 * @returns {{ importedFileId, importedOperations, importedItems, createdLots, rozchodItems }}
 */
export async function saveImportToSupabase(client, {
  groupsToImport,
  rowsCount,
  fileName,
  duplicateCount,
  deps,
  onProgress
}) {
  const notify = msg => onProgress?.(msg)

  notify('Rejestrowanie pliku importu…')
  const { data: imported, error: fileError } = await withImportRetry(() =>
    client.from('imported_files').insert({
      filename: fileName || 'import.xlsx',
      rows_count: rowsCount,
      status: 'w_trakcie'
    }).select('id').single()
  )
  if (fileError) throw fileError

  const allProductNames = []
  const allContractorNames = []
  for (const group of groupsToImport) {
    if (group.contractorName) allContractorNames.push(group.contractorName)
    for (const row of group.items) allProductNames.push(row.productName)
  }

  notify('Przygotowanie słowników produktów i kontrahentów…')
  const [productMap, contractorMap] = await Promise.all([
    ensureProductIds(client, allProductNames, deps),
    ensureContractorIds(client, allContractorNames)
  ])

  notify(`Zapis ${groupsToImport.length} dokumentów…`)
  const { opKeyToId, importedOperations } = await insertOperationsForGroups(
    client, groupsToImport, imported.id, contractorMap, notify
  )

  notify('Zapis pozycji i partii…')
  const batchResult = await insertItemsAndLotsForGroups(
    client, groupsToImport, opKeyToId, productMap, deps, notify, fileName, imported.id
  )
  const importedItems = batchResult.importedItems
  const rozchodItems = batchResult.rozchodItems
  const createdLots = batchResult.createdLots

  const finalStatus = duplicateCount ? `pominieto_duplikaty_${duplicateCount}` : 'wczytany'
  await withImportRetry(() =>
    client.from('imported_files').update({ status: finalStatus }).eq('id', imported.id)
  )

  return {
    importedFileId: imported.id,
    importedOperations,
    importedItems,
    createdLots,
    rozchodItems
  }
}

/** Liczba pozycji PZ (przychód) w grupach importu — do weryfikacji utworzonych partii. */
export function countIncomingItemsInGroups(groups) {
  let n = 0
  for (const group of groups || []) {
    if (group.operation !== 'przyjecie') continue
    for (const row of group.items || []) {
      if (Math.abs(Number(row.qty) || 0) > 0) n += 1
    }
  }
  return n
}

/** Szybkie sprawdzenie czy w bazie są jakiekolwiek alokacje FIFO. */
export async function hasAnyFifoAllocations(client) {
  if (!client) return false
  const { count, error } = await withImportRetry(() =>
    client.from('fifo_allocations').select('id', { count: 'exact', head: true })
  )
  if (error) throw error
  return Number(count || 0) > 0
}
/** Szacuje ile linii doklejenie doda (bez zapisu do bazy). */
export async function estimateMergeNewItems(client, existingGroups, details, deps) {
  if (!client || !existingGroups?.length) return 0
  const opIds = [...new Set(existingGroups.map(g => resolveOperationImportMeta(g, details)?.operationId).filter(Boolean))]
  const itemsByOp = await fetchOperationItemsByOpIds(client, opIds)
  let total = 0
  for (const group of existingGroups) {
    const meta = resolveOperationImportMeta(group, details)
    const opId = meta?.operationId
    if (!opId) continue
    const storedItems = itemsByOp.get(opId) || []
    const diff = diffImportGroupAgainstStored(group, meta, storedItems, deps)
    if (storedItems.length === 0 && (group.items?.length || 0) > 0) {
      total += group.items.length
    } else {
      total += diff.newItems.length
    }
  }
  return total
}

/** Diagnostyka: puste PZ/WZ w bazie vs pozycje w Excelu (przy ponownym wczytaniu miesiąca). */
export async function summarizeImportDuplicateGap(client, duplicateGroups, details, deps) {
  if (!client || !duplicateGroups?.length) {
    return { itemsToMerge: 0, emptyShells: 0, emptyExamples: [] }
  }
  const opIds = [...new Set(duplicateGroups.map(g => resolveOperationImportMeta(g, details)?.operationId).filter(Boolean))]
  const itemsByOp = await fetchOperationItemsByOpIds(client, opIds)
  let itemsToMerge = 0
  let emptyShells = 0
  const emptyExamples = []
  for (const group of duplicateGroups) {
    const meta = resolveOperationImportMeta(group, details)
    const opId = meta?.operationId
    if (!opId) continue
    const storedItems = itemsByOp.get(opId) || []
    const excelCount = group.items?.length || 0
    if (storedItems.length === 0 && excelCount > 0) {
      emptyShells += 1
      itemsToMerge += excelCount
      if (emptyExamples.length < 6) emptyExamples.push(group.documentNo)
      continue
    }
    const diff = diffImportGroupAgainstStored(group, meta, storedItems, deps)
    itemsToMerge += diff.newItems.length
  }
  return { itemsToMerge, emptyShells, emptyExamples }
}

function groupExcelQtyByProduct(groups, deps) {
  const totals = new Map()
  for (const group of groups || []) {
    if (group.operation !== 'przyjecie') continue
    for (const row of group.items || []) {
      const key = productFifoMatchKey(row.productName, null, deps)
      totals.set(key, (totals.get(key) || 0) + Math.abs(Number(row.qty) || 0))
    }
  }
  return totals
}

function bumpImportProductBucket(bucket, productName, kg, docNo) {
  const name = String(productName || '—').trim() || '—'
  if (!bucket.has(name)) {
    bucket.set(name, { productName: name, kg: 0, lines: 0, docs: new Set() })
  }
  const entry = bucket.get(name)
  entry.kg += kg
  entry.lines += 1
  if (docNo) entry.docs.add(docNo)
}

function finalizeImportProductBuckets(productMap) {
  return [...productMap.values()]
    .map(v => ({
      productName: v.productName,
      kg: Math.round(v.kg * 1000) / 1000,
      lines: v.lines,
      documents: v.docs.size
    }))
    .sort((a, b) => b.kg - a.kg || String(a.productName).localeCompare(String(b.productName), 'pl'))
}

function finalizeImportMonthBuckets(monthMap) {
  return [...monthMap.entries()]
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    .map(([month, productMap]) => {
      const products = finalizeImportProductBuckets(productMap)
      const totalKg = Math.round(products.reduce((s, p) => s + p.kg, 0) * 1000) / 1000
      return { month, products, totalKg }
    })
}

/**
 * Sumuje kg z wczytanego Excela (wiersze PZ/WZ) wg asortymentu — do podglądu w Importach (nie K01).
 */
export function summarizeImportRowsByProduct(rows, deps = {}) {
  const canon = deps.canonicalProductName || canonicalProductName
  const pzMap = new Map()
  const wzMap = new Map()
  const pzMonthMap = new Map()
  const wzMonthMap = new Map()

  for (const row of rows || []) {
    const kg = Math.abs(Number(row.qty) || 0)
    if (!row.productName || kg <= 0) continue
    const name = canon(row.productName) || row.productName
    const month = String(row.issueDate || '').slice(0, 7) || '—'
    const docNo = normalizeDocumentNo(row.documentNo)

    if (row.operation === 'przyjecie') {
      bumpImportProductBucket(pzMap, name, kg, docNo)
      if (!pzMonthMap.has(month)) pzMonthMap.set(month, new Map())
      bumpImportProductBucket(pzMonthMap.get(month), name, kg, docNo)
    } else if (row.operation === 'sprzedaz') {
      bumpImportProductBucket(wzMap, name, kg, docNo)
      if (!wzMonthMap.has(month)) wzMonthMap.set(month, new Map())
      bumpImportProductBucket(wzMonthMap.get(month), name, kg, docNo)
    }
  }

  const pz = finalizeImportProductBuckets(pzMap)
  const wz = finalizeImportProductBuckets(wzMap)
  return {
    pz,
    wz,
    pzByMonth: finalizeImportMonthBuckets(pzMonthMap),
    wzByMonth: finalizeImportMonthBuckets(wzMonthMap),
    totalPzKg: Math.round(pz.reduce((s, p) => s + p.kg, 0) * 1000) / 1000,
    totalWzKg: Math.round(wz.reduce((s, p) => s + p.kg, 0) * 1000) / 1000
  }
}

/** Sumuje kg z zapisanych operacji importu (podgląd rejestru). */
export function summarizeOperationsByProduct(operations, deps = {}) {
  const rows = []
  for (const op of operations || []) {
    const operation = op.operation_type === 'przyjecie' ? 'przyjecie' : 'sprzedaz'
    for (const item of op.operation_items || []) {
      const kg = Math.abs(Number(item.qty) || 0)
      if (!item.raw_product_name || kg <= 0) continue
      rows.push({
        productName: item.raw_product_name,
        qty: kg,
        operation,
        issueDate: op.operation_date,
        documentNo: op.document_no
      })
    }
  }
  return summarizeImportRowsByProduct(rows, deps)
}

const PL_MONTH_HINTS = {
  styczen: 1, sty: 1, stycznia: 1,
  luty: 2, lut: 2, lutego: 2,
  marzec: 3, mar: 3, marca: 3,
  kwiecien: 4, kwi: 4, kwietnia: 4,
  maj: 5, maja: 5,
  czerwiec: 6, cze: 6, czerwca: 6,
  lipiec: 7, lip: 7, lipca: 7,
  sierpien: 8, sie: 8, sierpnia: 8,
  wrzesien: 9, wrz: 9, wrzesnia: 9,
  pazdziernik: 10, paz: 10, pazdziernika: 10,
  listopad: 11, lis: 11, listopada: 11,
  grudzien: 12, gru: 12, grudnia: 12
}

const PL_MONTH_LABELS = ['', 'styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień']

function monthYearKey(month, year) {
  if (!month || !year) return ''
  return `${year}-${String(month).padStart(2, '0')}`
}

function formatPlMonthYear(month, year) {
  if (!month || !year) return '—'
  const label = PL_MONTH_LABELS[month] || String(month)
  return `${label} ${year}`
}

function inferYearFromImportGroups(groups = []) {
  const counts = new Map()
  for (const g of groups) {
    const y = String(g.issueDate || '').slice(0, 4)
    if (/^\d{4}$/.test(y)) counts.set(Number(y), (counts.get(Number(y)) || 0) + 1)
  }
  let best = null
  let bestN = 0
  for (const [year, n] of counts) {
    if (n > bestN) { bestN = n; best = year }
  }
  return best || new Date().getFullYear()
}

function inferDominantMonthFromGroups(groups = []) {
  const counts = new Map()
  for (const g of groups) {
    const key = String(g.issueDate || '').slice(0, 7)
    if (key.length !== 7) continue
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  let bestKey = null
  let bestN = 0
  let total = 0
  for (const [key, n] of counts) {
    total += n
    if (n > bestN) { bestN = n; bestKey = key }
  }
  if (!bestKey || bestN < 3) return null
  if (total >= 5 && bestN / total < 0.55) return null
  const [year, month] = bestKey.split('-').map(Number)
  return { month, year, source: 'dominant_dates', share: bestN / total }
}

/** Miesiąc pliku importu — z nazwy pliku lub dominujących dat w Excelu. */
export function inferImportFileMonthHint(fileName = '', groups = []) {
  const name = String(fileName || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
  for (const [token, month] of Object.entries(PL_MONTH_HINTS)) {
    if (!name.includes(token)) continue
    const yearMatch = name.match(/20\d{2}/)
    const year = yearMatch ? Number(yearMatch[0]) : inferYearFromImportGroups(groups)
    return { month, year, source: 'filename' }
  }
  const mmyy = name.match(/(?:^|[^\d])(0?[1-9]|1[0-2])[\s._-]+(20\d{2})(?:[^\d]|$)/)
  if (mmyy) {
    return { month: Number(mmyy[1]), year: Number(mmyy[2]), source: 'filename' }
  }
  const yymm = name.match(/(?:^|[^\d])(20\d{2})[\s._-]+(0?[1-9]|1[0-2])(?:[^\d]|$)/)
  if (yymm) {
    return { month: Number(yymm[2]), year: Number(yymm[1]), source: 'filename' }
  }
  return inferDominantMonthFromGroups(groups)
}

/**
 * Ostrzeżenia gdy miesiąc w numerze dokumentu (np. /07/ lub PZ/…/09/2026)
 * nie zgadza się z datą w Excelu lub z miesiącem pliku importu.
 */
export function auditImportDocumentMonthConsistency(groups, options = {}) {
  const result = {
    fileMonthHint: options.fileMonthHint || null,
    warnings: [],
    summary: ''
  }
  if (!groups?.length) {
    result.summary = 'Brak dokumentów do sprawdzenia.'
    return result
  }

  const fileHint = result.fileMonthHint || inferImportFileMonthHint(options.fileName || '', groups)
  result.fileMonthHint = fileHint || null
  const fileMonthKey = fileHint ? monthYearKey(fileHint.month, fileHint.year) : ''
  const seen = new Set()

  for (const group of groups) {
    const docNo = normalizeDocumentNo(group.documentNo)
    const docMy = monthYearFromDocumentNo(docNo)
    if (!docMy) continue

    const issueDate = String(group.issueDate || '').slice(0, 10)
    const docMonthKey = monthYearKey(docMy.month, docMy.year)
    const excelMonthKey = issueDate.length >= 7 ? issueDate.slice(0, 7) : ''

    if (excelMonthKey && excelMonthKey !== docMonthKey) {
      const key = `${docNo}|excel`
      if (!seen.has(key)) {
        seen.add(key)
        result.warnings.push({
          type: 'doc_no_vs_excel_date',
          documentNo: docNo,
          operation: group.operation,
          issueDate,
          docMonth: docMonthKey,
          excelMonth: excelMonthKey,
          message: `Nr ${docNo}: w numerze ${formatPlMonthYear(docMy.month, docMy.year)}, w Excelu data ${issueDate} (${formatPlMonthYear(Number(excelMonthKey.slice(5)), Number(excelMonthKey.slice(0, 4)))}) — możliwa korekta faktury, zmiana daty lub błędny zapis.`
        })
      }
    }

    if (fileMonthKey && fileMonthKey !== docMonthKey) {
      const key = `${docNo}|file`
      if (!seen.has(key)) {
        seen.add(key)
        result.warnings.push({
          type: 'doc_no_vs_import_file',
          documentNo: docNo,
          operation: group.operation,
          issueDate,
          docMonth: docMonthKey,
          fileMonth: fileMonthKey,
          message: `Nr ${docNo}: miesiąc w numerze (${formatPlMonthYear(docMy.month, docMy.year)}) ≠ miesiąc importu (${formatPlMonthYear(fileHint.month, fileHint.year)}) — dokument może nie należeć do tego pliku lub pierwotny zapis był błędny.`
        })
      }
    }
  }

  if (!result.warnings.length) {
    result.summary = fileHint
      ? `Miesiące w numerach dokumentów zgadzają się z Excelem i importem (${formatPlMonthYear(fileHint.month, fileHint.year)}).`
      : 'Miesiące w numerach dokumentów zgadzają się z datami w Excelu.'
  } else {
    const excelN = result.warnings.filter(w => w.type === 'doc_no_vs_excel_date').length
    const fileN = result.warnings.filter(w => w.type === 'doc_no_vs_import_file').length
    const parts = []
    if (excelN) parts.push(`${excelN} nr vs data Excel`)
    if (fileN) parts.push(`${fileN} nr vs miesiąc pliku`)
    result.summary = `Wykryto ${result.warnings.length} możliwych nieprawidłowości (${parts.join(', ')}).`
  }
  return result
}

export function formatImportMonthWarnings(audit) {
  if (!audit) return ''
  const lines = [audit.summary]
  for (const w of (audit.warnings || []).slice(0, 12)) {
    lines.push(w.message)
  }
  if ((audit.warnings?.length || 0) > 12) {
    lines.push(`… i ${audit.warnings.length - 12} kolejnych — patrz tabelę poniżej.`)
  }
  return lines.join(' ')
}

/**
 * Pełny audyt: Excel vs baza — wykrywa brakujące PZ, puste dokumenty, rozjazdy kg.
 * @returns {{ missingDocuments, emptyDocuments, qtyMismatch, excelOnlyKg, dbOnlyKg, productGaps, summary }}
 */
export async function auditExcelImportCoverage(client, groups, details, deps) {
  const result = {
    missingDocuments: [],
    emptyDocuments: [],
    qtyMismatch: [],
    productGaps: [],
    excelOnlyKg: 0,
    dbOnlyKg: 0,
    pzChecked: 0,
    totalExcelPzKg: 0,
    totalDbPzKg: 0,
    hiddenMatches: [],
    summary: ''
  }
  if (!client || !groups?.length) return result

  const opIds = [...new Set(groups.map(g => resolveOperationImportMeta(g, details)?.operationId).filter(Boolean))]
  const itemsByOp = await fetchOperationItemsByOpIds(client, opIds)

  for (const group of groups) {
    if (group.operation !== 'przyjecie') continue
    result.pzChecked += 1
    const meta = resolveOperationImportMeta(group, details)
    const excelQty = (group.items || []).reduce((s, r) => s + Math.abs(Number(r.qty) || 0), 0)
    result.totalExcelPzKg += excelQty
    const excelItems = group.items?.length || 0

    if (!meta?.operationId) {
      result.missingDocuments.push({
        documentNo: group.documentNo,
        issueDate: group.issueDate,
        excelItems,
        excelQty
      })
      result.excelOnlyKg += excelQty
      continue
    }

    const storedItems = itemsByOp.get(meta.operationId) || []
    const dbQty = storedItems.reduce((s, i) => s + Math.abs(Number(i.qty) || 0), 0)
    if (meta?.operationId) result.totalDbPzKg += dbQty

    if (storedItems.length === 0 && excelItems > 0) {
      result.emptyDocuments.push({
        documentNo: group.documentNo,
        dbDocumentNo: meta.documentNo,
        issueDate: group.issueDate,
        excelItems,
        excelQty
      })
      result.excelOnlyKg += excelQty
      continue
    }

    const diff = Math.abs(excelQty - dbQty)
    if (meta.documentNo && normalizeDocumentNo(meta.documentNo) !== normalizeDocumentNo(group.documentNo)) {
      result.hiddenMatches.push({
        excelDocumentNo: group.documentNo,
        dbDocumentNo: meta.documentNo,
        excelQty,
        dbQty,
        importFilename: meta.importFilename || null
      })
    }
    if (diff >= 0.5) {
      result.qtyMismatch.push({
        documentNo: group.documentNo,
        dbDocumentNo: meta.documentNo,
        excelQty,
        dbQty,
        diff
      })
      if (excelQty > dbQty) result.excelOnlyKg += excelQty - dbQty
      else result.dbOnlyKg += dbQty - excelQty
    }
  }

  const excelByProduct = groupExcelQtyByProduct(groups, deps)
  const dbByProduct = new Map()
  for (const [, items] of itemsByOp) {
    for (const item of items || []) {
      const key = productFifoMatchKey(item.raw_product_name || item.products?.name, item.products, deps)
      dbByProduct.set(key, (dbByProduct.get(key) || 0) + Math.abs(Number(item.qty) || 0))
    }
  }
  const allProducts = new Set([...excelByProduct.keys(), ...dbByProduct.keys()])
  for (const key of allProducts) {
    const excelKg = excelByProduct.get(key) || 0
    const dbKg = dbByProduct.get(key) || 0
    const gap = Math.round((excelKg - dbKg) * 10) / 10
    if (Math.abs(gap) >= 0.5) {
      result.productGaps.push({ productKey: key, excelKg, dbKg, gap })
    }
  }
  result.productGaps.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))

  const parts = []
  if (result.missingDocuments.length) parts.push(`${result.missingDocuments.length} PZ brak w bazie`)
  if (result.emptyDocuments.length) parts.push(`${result.emptyDocuments.length} PZ pustych w bazie`)
  if (result.qtyMismatch.length) parts.push(`${result.qtyMismatch.length} PZ z rozjazdem kg`)
  if (result.productGaps.length) parts.push(`${result.productGaps.length} produktów z różnicą kg`)
  if (result.hiddenMatches.length) parts.push(`${result.hiddenMatches.length} PZ pod innym nr w bazie`)
  result.summary = parts.length ? parts.join(', ') : 'Excel i baza zgadzają się (PZ/kg).'

  return result
}

export function formatImportAuditReport(audit) {
  if (!audit) return ''
  const lines = [audit.summary]
  if (audit.missingDocuments?.length) {
    lines.push(`Brak w bazie: ${audit.missingDocuments.slice(0, 8).map(d => d.documentNo).join(', ')}${audit.missingDocuments.length > 8 ? '…' : ''}`)
  }
  if (audit.emptyDocuments?.length) {
    lines.push(`Puste PZ: ${audit.emptyDocuments.slice(0, 8).map(d => d.documentNo).join(', ')}${audit.emptyDocuments.length > 8 ? '…' : ''}`)
  }
  if (audit.productGaps?.length) {
    lines.push(`Różnice kg: ${audit.productGaps.slice(0, 5).map(p => `${p.productKey} (${p.gap > 0 ? '+' : ''}${p.gap.toLocaleString('pl-PL')} kg)`).join('; ')}`)
  }
  if (audit.hiddenMatches?.length) {
    lines.push(`W bazie pod innym nr: ${audit.hiddenMatches.slice(0, 5).map(h => `${h.excelDocumentNo} → ${h.dbDocumentNo} (${h.dbQty.toLocaleString('pl-PL')} kg)`).join('; ')}`)
  }
  if (audit.summary.includes('zgadzają') && audit.productGaps?.length === 0) {
    lines.push('Jeśli K03 nadal pokazuje brak towaru — sprawdź daty PZ (UTC) lub klasyfikację produktu (FIFO).')
  }
  return lines.join(' ')
}

async function deleteFifoAllocationsForLots(client, lotIds, chunkSize = 120) {
  const unique = [...new Set((lotIds || []).filter(Boolean))]
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize)
    await withImportRetry(() => client.from('fifo_allocations').delete().in('source_lot_id', chunk))
    await withImportRetry(() => client.from('fifo_allocations').delete().in('output_lot_id', chunk))
  }
}

/**
 * Poprawia daty tylko operacji z danego importu (szybkie — bez skanowania całej bazy).
 */
/** Poprawia daty WZ wg daty wystawienia z Excela (np. 01.07 zamiast błędnego 31.07). */
export async function repairWzDatesFromImportGroups(client, groups, { onProgress } = {}) {
  if (!client || !groups?.length) return { wz_dates_fixed: 0 }
  onProgress?.('Korygowanie dat WZ z Excela…')
  let fixed = 0
  const seen = new Set()

  for (const group of groups) {
    const docNo = normalizeDocumentNo(group?.documentNo)
    if (!isWzMonthYearDocument(docNo)) continue
    if (seen.has(docNo)) continue
    seen.add(docNo)

    const correct = String(group?.issueDate || '').slice(0, 10)
    if (!correct) continue

    const { data: ops, error } = await withImportRetry(() =>
      client.from('operations').select('id, operation_date').eq('document_no', docNo)
    )
    if (error) throw error

    for (const op of ops || []) {
      const current = String(op.operation_date || '').slice(0, 10)
      if (!current || current === correct) continue

      await withImportRetry(() =>
        client.from('operations').update({ operation_date: correct }).eq('id', op.id)
      )
      await withImportRetry(() =>
        client
          .from('haccp_documents')
          .update({ document_date: correct })
          .eq('operation_id', op.id)
          .eq('document_type', 'K03')
      )
      fixed += 1
    }
  }
  return { wz_dates_fixed: fixed }
}

/** Naprawia daty WZ w bazie wg dat z wczytanego Excela (WZ/NNN/MM/RRRR — dzień tylko z kolumny Data). */
export async function repairWzDatesFromExcelRows(client, rows, { onProgress } = {}) {
  if (!client || !rows?.length) return { wz_dates_fixed: 0 }
  const byDoc = new Map()
  for (const row of rows) {
    const docNo = normalizeDocumentNo(row.documentNo)
    if (!docNo || !isWzMonthYearDocument(docNo)) continue
    const issueDate = String(resolveDocumentIssueDate(row.issueDate, docNo) || '').slice(0, 10)
    if (!issueDate || issueDate === '0000-01-01') continue
    if (!byDoc.has(docNo)) {
      byDoc.set(docNo, {
        operation: row.operation || 'sprzedaz',
        documentNo: docNo,
        issueDate,
        items: [row]
      })
    } else if (issueDate !== byDoc.get(docNo).issueDate) {
      byDoc.get(docNo).issueDate = issueDate
    }
  }
  const result = await repairWzDatesFromImportGroups(client, [...byDoc.values()], { onProgress })
  if (result.wz_dates_fixed) invalidateFifoBaseCache()
  return result
}

/** Naprawia daty PZ i partii wg kolumny „Data wystawienia” z wczytanego Excela (np. błąd UTC −1 dzień). */
export async function repairPzDatesFromExcelRows(client, rows, { onProgress } = {}) {
  if (!client || !rows?.length) return { pz_dates_fixed: 0 }
  const byDoc = new Map()
  for (const row of rows) {
    const docNo = normalizeDocumentNo(row.documentNo)
    if (!docNo) continue
    const operation = row.operation || (String(docNo).toUpperCase().startsWith('PZ/') ? 'przyjecie' : '')
    if (operation !== 'przyjecie') continue
    const issueDate = String(resolveDocumentIssueDate(row.issueDate, docNo) || '').slice(0, 10)
    if (!issueDate || issueDate === '0000-01-01') continue
    if (!byDoc.has(docNo)) {
      byDoc.set(docNo, {
        operation: 'przyjecie',
        documentNo: docNo,
        issueDate,
        items: [row]
      })
    } else if (issueDate !== byDoc.get(docNo).issueDate) {
      byDoc.get(docNo).issueDate = issueDate
    }
  }
  const result = await repairPzDatesFromImportGroups(client, [...byDoc.values()], { onProgress })
  if (result.pz_dates_fixed) invalidateFifoBaseCache()
  return result
}

/** PZ + WZ — daty z kolumny Excel „Data wystawienia” (naprawa UTC i forward-fill). */
export async function repairDatesFromExcelRows(client, rows, { onProgress } = {}) {
  const pzResult = await repairPzDatesFromExcelRows(client, rows, { onProgress })
  const wzResult = await repairWzDatesFromExcelRows(client, rows, { onProgress })
  return {
    pz_dates_fixed: pzResult.pz_dates_fixed || 0,
    wz_dates_fixed: wzResult.wz_dates_fixed || 0
  }
}

/** Poprawia daty PZ i partii wg daty z Excela (kolumna „Data wystawienia”). */
export async function repairPzDatesFromImportGroups(client, groups, { onProgress } = {}) {
  if (!client || !groups?.length) return { pz_dates_fixed: 0 }
  onProgress?.('Korygowanie dat PZ z Excela…')
  let fixed = 0
  const seen = new Set()

  for (const group of groups) {
    if (group?.operation !== 'przyjecie') continue
    const docNo = normalizeDocumentNo(group?.documentNo)
    if (!docNo || seen.has(docNo)) continue
    seen.add(docNo)

    const correct = String(group?.issueDate || '').slice(0, 10)
    if (!correct || correct === '0000-01-01') continue

    const { data: ops, error } = await withImportRetry(() =>
      client.from('operations').select('id, operation_date').eq('document_no', docNo)
    )
    if (error) throw error

    for (const op of ops || []) {
      const current = String(op.operation_date || '').slice(0, 10)
      if (current !== correct) {
        await withImportRetry(() =>
          client.from('operations').update({ operation_date: correct }).eq('id', op.id)
        )
        await withImportRetry(() =>
          client
            .from('haccp_documents')
            .update({ document_date: correct })
            .eq('operation_id', op.id)
            .eq('document_type', 'K01')
        )
        fixed += 1
      }
      await withImportRetry(() =>
        client.from('lots').update({ production_date: correct }).eq('source_operation_id', op.id)
      )
    }
  }
  return { pz_dates_fixed: fixed }
}

export async function repairDatesForImportFile(client, importedFileId, { onProgress } = {}) {
  if (!client || !importedFileId) return { dates_fixed: 0 }
  onProgress?.('Korygowanie dat PZ z tego importu…')
  let fixed = 0
  let offset = 0
  const pageSize = 200
  while (true) {
    const { data: ops, error } = await withImportRetry(() =>
      client
        .from('operations')
        .select('id, document_no, operation_date')
        .eq('imported_file_id', importedFileId)
        .order('id', { ascending: true })
        .range(offset, offset + pageSize - 1)
    )
    if (error) throw error
    if (!ops?.length) break

    for (const op of ops) {
      if (isWzMonthYearDocument(op.document_no)) continue
      const correct = pzCorrectDateFromDocumentNo(op.document_no)
      if (!pzOperationDateNeedsDocRepair(op.document_no, op.operation_date, correct)) continue
      await applyPzOperationDateRepair(client, op, correct)
      fixed += 1
    }

    if (ops.length < pageSize) break
    offset += pageSize
  }
  return { dates_fixed: fixed }
}

/** Lekkie czyszczenie po zapisie importu — tylko ten plik + K01 (bez ciężkiego RPC po całej bazie). */
export async function repairAfterImportSave(client, importedFileId, { onProgress, importGroups } = {}) {
  const wzRepair = importGroups?.length
    ? await repairWzDatesFromImportGroups(client, importGroups, { onProgress })
    : { wz_dates_fixed: 0 }
  const pzRepair = importGroups?.length
    ? await repairPzDatesFromImportGroups(client, importGroups, { onProgress })
    : { pz_dates_fixed: 0 }
  const porzeczkaRepair = await repairPorzeczkaProductGroups(client, { onProgress })
  if (porzeczkaRepair.products_fixed) invalidateFifoBaseCache()
  const dateRepair = await repairDatesForImportFile(client, importedFileId, { onProgress })
  onProgress?.('Sprawdzanie zduplikowanych kart K01…')
  const k01Removed = await removeDuplicateK01Documents(client, { onProgress })
  return {
    dates_fixed: (dateRepair.dates_fixed || 0) + (pzRepair.pz_dates_fixed || 0),
    wz_dates_fixed: wzRepair.wz_dates_fixed || 0,
    pz_dates_fixed: pzRepair.pz_dates_fixed || 0,
    porzeczka_products_fixed: porzeczkaRepair.products_fixed || 0,
    k01_removed: k01Removed,
    items_removed: 0,
    lots_removed: 0
  }
}

/**
 * Poprawia daty operacji/partii/K01 wg numeru PZ (np. 07/07/2026 zamiast błędnego forward-fill 06.07).
 * Obsługuje też PZ z miesiącem/rokiem w numerze (np. PZ/001/06/2026) — gdy w bazie jest późniejszy miesiąc.
 */
function pzCorrectDateFromDocumentNo(documentNo) {
  const no = String(documentNo || '').trim()
  if (!no.toUpperCase().startsWith('PZ/')) return ''
  if (isWzMonthYearDocument(no)) return ''
  return inferDateFromDocumentNo(no)
}

function pzOperationDateNeedsDocRepair(documentNo, currentDate, correctDate) {
  if (!correctDate) return false
  const current = String(currentDate || '').slice(0, 10)
  if (!current || current === '0000-01-01' || current === correctDate) return false
  if (documentNoHasExplicitDate(documentNo)) return current !== correctDate
  if (documentNoHasMonthYear(documentNo)) {
    const docMonth = correctDate.slice(0, 7)
    const curMonth = current.slice(0, 7)
    return curMonth > docMonth
  }
  return false
}

async function applyPzOperationDateRepair(client, op, correctDate) {
  await withImportRetry(() =>
    client.from('operations').update({ operation_date: correctDate }).eq('id', op.id)
  )
  await withImportRetry(() =>
    client.from('lots').update({ production_date: correctDate }).eq('source_operation_id', op.id)
  )
  await withImportRetry(() =>
    client
      .from('haccp_documents')
      .update({ document_date: correctDate })
      .eq('operation_id', op.id)
      .eq('document_type', 'K01')
  )
}

export async function repairDatesFromDocumentNumbers(client, { onProgress } = {}) {
  if (!client) throw new Error('Brak Supabase.')
  onProgress?.('Korygowanie dat PZ z numerów dokumentów…')
  let fixed = 0
  let offset = 0
  const pageSize = 400
  while (true) {
    const { data: ops, error } = await withImportRetry(() =>
      client
        .from('operations')
        .select('id, document_no, operation_date')
        .ilike('document_no', 'PZ/%')
        .order('id', { ascending: true })
        .range(offset, offset + pageSize - 1)
    )
    if (error) throw error
    if (!ops?.length) break

    for (const op of ops) {
      const correct = pzCorrectDateFromDocumentNo(op.document_no)
      if (!pzOperationDateNeedsDocRepair(op.document_no, op.operation_date, correct)) continue
      await applyPzOperationDateRepair(client, op, correct)
      fixed += 1
    }

    if (ops.length < pageSize) break
    offset += pageSize
  }
  return { dates_fixed: fixed }
}

/**
 * Audyt: PZ, gdzie data w bazie (operation_date) ≠ data z numeru dokumentu.
 * Zwraca konkretną listę — bez domysłów.
 */
export async function auditPzDateMismatches(client, { onProgress, maxRows = 200, maxScanned = 20000 } = {}) {
  if (!client) throw new Error('Brak Supabase.')
  onProgress?.({ phase: 'start', scanned: 0, mismatches: 0 })
  const mismatches = []
  let scanned = 0
  let offset = 0
  const pageSize = 500
  while (mismatches.length < maxRows && scanned < maxScanned) {
    const { data: ops, error } = await client
      .from('operations')
      .select('id, document_no, operation_date')
      .ilike('document_no', 'PZ/%')
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)
    if (error) throw error
    if (!ops?.length) break

    for (const op of ops) {
      scanned += 1
      const correct = pzCorrectDateFromDocumentNo(op.document_no)
      if (!pzOperationDateNeedsDocRepair(op.document_no, op.operation_date, correct)) continue
      mismatches.push({
        operation_id: op.id,
        document_no: String(op.document_no || ''),
        db_date: String(op.operation_date || '').slice(0, 10),
        date_from_document_no: correct,
        fifo_uses_date: correct || String(op.operation_date || '').slice(0, 10)
      })
      if (mismatches.length >= maxRows) break
    }

    onProgress?.({ phase: 'running', scanned, mismatches: mismatches.length })
    if (ops.length < pageSize) break
    offset += pageSize
  }
  return {
    scanned,
    mismatch_count: mismatches.length,
    mismatches,
    truncated: scanned >= maxScanned && mismatches.length < maxRows
  }
}

/** Stronicowane pobieranie widoku pz_fifo_overview (Supabase max 1000 wierszy / zapytanie). */
export async function fetchAllPzFifoOverviewRows(client, { onProgress, pageSize = 1000 } = {}) {
  if (!client) throw new Error('Brak Supabase.')
  const all = []
  let offset = 0
  while (true) {
    onProgress?.({ loaded: all.length, offset })
    const { data, error } = await client
      .from('pz_fifo_overview')
      .select('*')
      .order('production_date', { ascending: true })
      .order('created_at', { ascending: true })
      .range(offset, offset + pageSize - 1)
    if (error) throw error
    if (!data?.length) break
    all.push(...data)
    if (data.length < pageSize) break
    offset += pageSize
  }
  return all
}

/** Ujednolica production_date partii PZ z datą operacji źródłowej (po ręcznej korekcie dat). */
export async function syncIncomingLotProductionDates(client, { onProgress } = {}) {
  if (!client) return { lots_synced: 0 }
  onProgress?.('Synchronizacja dat partii PZ z operacjami…')
  let synced = 0
  let offset = 0
  const pageSize = 400
  while (true) {
    const { data: ops, error } = await withImportRetry(() =>
      client
        .from('operations')
        .select('id, operation_date, operation_type, document_no')
        .eq('operation_type', 'przyjecie')
        .order('id', { ascending: true })
        .range(offset, offset + pageSize - 1)
    )
    if (error) throw error
    if (!ops?.length) break

    for (const op of ops) {
      const correct = String(op.operation_date || '').slice(0, 10)
      if (!correct || correct === '0000-01-01') continue
      const { data: lots, error: lotErr } = await withImportRetry(() =>
        client.from('lots').select('id, production_date').eq('source_operation_id', op.id)
      )
      if (lotErr) throw lotErr
      for (const lot of lots || []) {
        const current = String(lot.production_date || '').slice(0, 10)
        if (current === correct) continue
        await withImportRetry(() =>
          client.from('lots').update({ production_date: correct }).eq('id', lot.id)
        )
        synced += 1
      }
    }

    if (ops.length < pageSize) break
    offset += pageSize
  }
  if (synced) invalidateFifoBaseCache()
  return { lots_synced: synced }
}

/** Naprawa dat PZ (z numerów dokumentów) + synchronizacja partii — przed podglądem FIFO. */
export async function repairFifoPzDatesQuick(client, { onProgress, importedFileId } = {}) {
  const fromDocs = await repairDatesFromDocumentNumbers(client, { onProgress })
  const fromFile = importedFileId
    ? await repairDatesForImportFile(client, importedFileId, { onProgress })
    : { dates_fixed: 0 }
  const sync = await syncIncomingLotProductionDates(client, { onProgress })
  invalidateFifoBaseCache()
  return {
    dates_fixed: (fromDocs.dates_fixed || 0) + (fromFile.dates_fixed || 0),
    lots_synced: sync.lots_synced || 0
  }
}

/**
 * Usuwa zduplikowane K01 (FIFO: zostaw najstarszy id na linię PZ).
 * Działa z przeglądarki — nie wymaga migracji SQL.
 */
export async function removeDuplicateK01Documents(client, { onProgress } = {}) {
  if (!client) throw new Error('Brak Supabase.')
  onProgress?.('Sprawdzanie zduplikowanych kart K01…')

  const pageSize = 1000
  let offset = 0
  const toDelete = []
  const seen = new Set()

  while (true) {
    const { data, error } = await withImportRetry(() =>
      client
        .from('haccp_documents')
        .select('id, document_no, document_date, product_name, qty')
        .eq('document_type', 'K01')
        .order('id', { ascending: true })
        .range(offset, offset + pageSize - 1)
    )
    if (error) throw error
    const chunk = data || []
    for (const row of chunk) {
      const key = k01LineDedupeKey(row)
      if (seen.has(key)) toDelete.push(row.id)
      else seen.add(key)
    }
    if (chunk.length < pageSize) break
    offset += pageSize
  }

  if (!toDelete.length) return 0

  onProgress?.(`Usuwanie ${toDelete.length} zduplikowanych kart K01…`)
  await deleteRowsInChunks(client, 'haccp_document_history', 'document_id', toDelete)
  await deleteRowsInChunks(client, 'haccp_documents', 'id', toDelete)
  return toDelete.length
}

export function formatRepairWarehouseResult(result = {}) {
  const items = result.items_removed ?? 0
  const lots = result.lots_removed ?? 0
  const k01 = result.k01_removed ?? 0
  const dates = result.dates_fixed ?? 0
  const wzDates = result.wz_dates_fixed ?? 0
  if (!items && !lots && !k01 && !dates && !wzDates) return 'Duplikaty: brak do usunięcia.'
  const parts = []
  if (dates) parts.push(`${dates} dat PZ`)
  if (wzDates) parts.push(`${wzDates} dat WZ`)
  if (items) parts.push(`${items} pozycji`)
  if (lots) parts.push(`${lots} partii`)
  if (k01) parts.push(`${k01} kart K01`)
  return `Naprawiono: ${parts.join(', ')}.`
}

/**
 * Pełne czyszczenie duplikatów magazynu: pozycje PZ + K01 (FIFO).
 * RPC v46 gdy dostępne; K01 zawsze też z przeglądarki (np. ten sam PZ z wielu importów).
 */
export async function repairWarehouseImportDuplicates(client, { onProgress, importedFileId, light = false, importGroups } = {}) {
  if (!client) throw new Error('Brak Supabase.')
  if (light && importedFileId) {
    return repairAfterImportSave(client, importedFileId, { onProgress, importGroups })
  }

  const notify = msg => onProgress?.(msg)

  const wzRepair = importGroups?.length
    ? await repairWzDatesFromImportGroups(client, importGroups, { onProgress })
    : { wz_dates_fixed: 0 }
  const pzRepair = importGroups?.length
    ? await repairPzDatesFromImportGroups(client, importGroups, { onProgress })
    : { pz_dates_fixed: 0 }
  const porzeczkaRepair = await repairPorzeczkaProductGroups(client, { onProgress })
  if (porzeczkaRepair.products_fixed) invalidateFifoBaseCache()
  const dateRepair = importedFileId
    ? await repairDatesForImportFile(client, importedFileId, { onProgress })
    : await repairDatesFromDocumentNumbers(client, { onProgress })
  notify('Czyszczenie duplikatów magazynu (FIFO)…')

  let result = {
    items_removed: 0,
    lots_removed: 0,
    k01_removed: 0,
    dates_fixed: (dateRepair.dates_fixed || 0) + (pzRepair.pz_dates_fixed || 0),
    wz_dates_fixed: wzRepair.wz_dates_fixed || 0,
    pz_dates_fixed: pzRepair.pz_dates_fixed || 0,
    porzeczka_products_fixed: porzeczkaRepair.products_fixed || 0,
    mode: 'client'
  }
  try {
    const rpc = await removeDuplicateIncomingOperationItems(client, { onProgress })
    result = { ...result, ...rpc, dates_fixed: (dateRepair.dates_fixed || 0) + (rpc.dates_fixed || 0) }
    result.mode = 'rpc'
  } catch (err) {
    if (!/function.*does not exist/i.test(String(err?.message || ''))) throw err
    notify('Migracja v46 niedostępna — czyszczę duplikaty K01 z przeglądarki…')
  }

  const k01Extra = await removeDuplicateK01Documents(client, { onProgress })
  result.k01_removed = (result.k01_removed || 0) + k01Extra
  if (k01Extra > 0 && result.mode === 'rpc') result.mode = 'rpc+k01'
  return result
}

/**
 * Usuwa zduplikowane pozycje przyjęć (ta sama operacja + produkt + kg).
 * Wymaga funkcji SQL remove_duplicate_incoming_items (v46) — trwa sekundy.
 */
export async function removeDuplicateIncomingOperationItems(client, { onProgress } = {}) {
  if (!client) throw new Error('Brak Supabase.')

  const notify = msg => onProgress?.(msg)
  notify('Usuwanie duplikatów w bazie (RPC)…')

  const { data: rpcData, error: rpcErr } = await withImportRetry(() =>
    client.rpc('remove_duplicate_incoming_items')
  )
  if (!rpcErr) {
    return { ...(rpcData || { items_removed: 0, lots_removed: 0, k01_removed: 0 }), mode: 'rpc' }
  }

  if (/function.*does not exist/i.test(String(rpcErr.message || ''))) {
    throw new Error(
      'Brak funkcji remove_duplicate_incoming_items w Supabase. ' +
      'Uruchom jednorazowo w SQL Editor plik supabase/2026-v46-remove-duplicate-import-items.sql (ok. 10 s), ' +
      'potem kliknij „Usuń zduplikowane PZ” ponownie. ' +
      'Bez tego czyszczenie z przeglądarki trwa bardzo długo.'
    )
  }
  throw rpcErr
}

/**
 * Usuwa wszystkie aktywne importy Excel (PZ/WZ/partie/FIFO/K01 z importu).
 * Po resecie wgraj plik Excel od nowa — wszystkie dokumenty trafią jako nowe.
 */
export async function purgeAllActiveExcelImports(client, { onProgress, reason = 'Reset magazynu — ponowny import od zera' } = {}) {
  const notify = msg => onProgress?.(msg)
  if (!client) throw new Error('Brak Supabase.')

  notify('Pobieranie listy importów…')
  const { data: files, error: listErr } = await withImportRetry(() =>
    client.from('imported_files').select('id, filename, created_at').is('deleted_at', null).order('created_at', { ascending: true })
  )
  if (listErr) throw listErr

  const active = files || []
  let filesPurged = 0
  let operations = 0
  let lots = 0

  for (const f of active) {
    notify(`Usuwanie importu ${filesPurged + 1}/${active.length}: ${f.filename || f.id}…`)
    let result = null
    try {
      const { data, error: rpcErr } = await withImportRetry(() =>
        client.rpc('delete_import_excel_admin', {
          p_imported_file_id: f.id,
          p_reason: String(reason).trim(),
          p_user_role: 'admin'
        })
      )
      if (rpcErr) {
        if (!/function.*does not exist/i.test(String(rpcErr.message || ''))) throw rpcErr
        result = await purgeImportDataClientSide(client, f.id)
        await withImportRetry(() =>
          client.from('imported_files').update({
            deleted_at: new Date().toISOString(),
            deleted_by_role: 'admin',
            delete_reason: String(reason).trim(),
            status: 'usuniety'
          }).eq('id', f.id)
        )
      } else {
        result = data
      }
    } catch (err) {
      result = await purgeImportDataClientSide(client, f.id)
      await withImportRetry(() =>
        client.from('imported_files').update({
          deleted_at: new Date().toISOString(),
          deleted_by_role: 'admin',
          delete_reason: `${String(reason).trim()} (fallback)`,
          status: 'usuniety'
        }).eq('id', f.id)
      )
    }
    operations += Number(result?.operations || 0)
    lots += Number(result?.lots || 0) + Number(result?.orphan_lots || 0)
    filesPurged += 1
  }

  notify('Sprzątanie osieroconych partii i FIFO…')
  try {
    await cleanupOrphanedDeletedImports(client)
  } catch (_) { /* v40 */ }

  try {
    await withImportRetry(() => client.rpc('purge_orphan_import_lots'))
  } catch (_) { /* opcjonalne RPC */ }

  return { filesPurged, operations, lots, importFilesTotal: active.length }
}

/**
 * Usuwa WSZYSTKO z magazynu Excel: importy, operacje, partie, FIFO, kartoteki K03/K01.
 * Po resecie wgraj Excel od zera i twórz K03 chronologicznie (najpierw czerwiec, potem lipiec).
 */
export async function purgeCompleteWarehouseReset(client, { onProgress, reason = 'Reset kompletny — magazyn od zera' } = {}) {
  const notify = msg => onProgress?.(msg)
  if (!client) throw new Error('Brak Supabase.')

  notify('Krok 1/3 — usuwanie importów Excel…')
  const importResult = await purgeAllActiveExcelImports(client, { onProgress: notify, reason })

  notify('Krok 2/3 — usuwanie kartotek K03, K01 i pozostałości FIFO…')
  let haccpRemoved = 0
  while (true) {
    const { data: docs, error: docErr } = await withImportRetry(() =>
      client.from('haccp_documents').select('id').limit(500)
    )
    if (docErr) throw docErr
    if (!docs?.length) break
    const ids = docs.map(d => d.id)
    await deleteRowsInChunks(client, 'haccp_document_history', 'document_id', ids, 100)
    await deleteRowsInChunks(client, 'haccp_documents', 'id', ids, 100)
    haccpRemoved += ids.length
    notify(`Usunięto ${haccpRemoved} kartotek HACCP…`)
    if (docs.length < 500) break
  }

  try {
    await deleteAllTableRows(client, 'haccp_aux_materials')
  } catch (_) { /* opcjonalna tabela */ }

  await deleteAllTableRows(client, 'fifo_allocations')
  await deleteAllTableRows(client, 'fifo_allocation_change_log')
  await deleteAllTableRows(client, 'pz_fifo_change_log')

  notify('Krok 3/3 — usuwanie partii i operacji magazynowych…')
  let lotsRemoved = 0
  while (true) {
    const { data: lots, error: lotErr } = await withImportRetry(() =>
      client.from('lots').select('id').limit(500)
    )
    if (lotErr) throw lotErr
    if (!lots?.length) break
    const lotIds = lots.map(l => l.id)
    for (let i = 0; i < lotIds.length; i += 80) {
      await withImportRetry(() =>
        client.from('operation_items').update({ lot_id: null }).in('lot_id', lotIds.slice(i, i + 80))
      )
    }
    await deleteRowsInChunks(client, 'lot_location_history', 'lot_id', lotIds, 100)
    await deleteRowsInChunks(client, 'lot_change_history', 'lot_id', lotIds, 100)
    await deleteRowsInChunks(client, 'lots', 'id', lotIds, 100)
    lotsRemoved += lotIds.length
    notify(`Usunięto ${lotsRemoved} partii…`)
    if (lots.length < 500) break
  }

  await deleteAllTableRows(client, 'operation_items')
  await deleteAllTableRows(client, 'operations')

  notify('Finalizacja…')
  try {
    await cleanupOrphanedDeletedImports(client)
  } catch (_) { /* v40 */ }
  try {
    await withImportRetry(() => client.rpc('purge_orphan_import_lots'))
  } catch (_) { /* opcjonalne RPC */ }

  return {
    ...importResult,
    haccpRemoved,
    lotsRemoved,
    complete: true
  }
}

export function formatPurgeAllImportsResult(result) {
  if (result?.complete) {
    const parts = []
    if (result.filesPurged) parts.push(`${result.filesPurged} importów`)
    if (result.haccpRemoved) parts.push(`${result.haccpRemoved} kartotek (K03/K01)`)
    if (result.operations) parts.push(`${result.operations} operacji`)
    if (result.lotsRemoved || result.lots) parts.push(`${result.lotsRemoved || result.lots} partii`)
    if (!parts.length) return 'Reset kompletny: magazyn był już pusty. Wgraj Excel od nowa.'
    return `Reset kompletny: usunięto ${parts.join(', ')}. FIFO wyczyszczone. Wgraj Excel i kliknij Zapisz — potem K03 od najstarszej WZ.`
  }
  if (!result?.filesPurged) return 'Reset: brak aktywnych importów do usunięcia.'
  return `Reset magazynu: usunięto ${result.filesPurged} importów (${result.operations} operacji, ${result.lots} partii). Wgraj Excel od nowa.`
}

export function formatImportNetworkError(err) {
  const msg = String(err?.message || err || '')
  if (/contractors_name_key|duplicate key.*contractors/i.test(msg)) {
    return (
      'Błąd: kontrahent już jest w bazie (duplikat nazwy). Odśwież stronę i spróbuj ponownie — import powinien użyć istniejącego wpisu. ' +
      'Jeśli błąd się powtarza, zgłoś administratorowi.'
    )
  }
  if (/lots_lot_no_key|duplicate key.*lot/i.test(msg)) {
    return (
      'Błąd: numer partii już istnieje w bazie (pozostałość po wcześniejszym imporcie). ' +
      'Spróbuj ponownie – przed zapisem system automatycznie czyści pozostałości. ' +
      'Jeśli błąd się powtarza: usuń stary import z rejestru lub uruchom w Supabase SQL: 2026-v40 + 2026-v42.'
    )
  }
  if (/lots_source_operation_id_fkey|foreign key.*operations/i.test(msg)) {
    return (
      'Błąd spójności danych (operacja nie istnieje przy tworzeniu partii). ' +
      'Uruchom ponownie zapis – jeśli się powtarza: usuń przerwany import z rejestru (status „w_trakcie”) i spróbuj od nowa.'
    )
  }
  if (isTransientNetworkError(err)) {
    return (
      'Błąd połączenia z Supabase (NetworkError). Sprawdź internet i czy projekt Supabase nie jest wstrzymany. ' +
      'Możesz spróbować ponownie – już zapisane dokumenty zostaną pominięte jako duplikaty.'
    )
  }
  if (/unikalnego numeru partii|generate_lot_no/i.test(msg)) {
    return (
      'Błąd numeru partii magazynowej — sekwencja numerów rozjechała się z bazą (duży import). ' +
      'Uruchom w Supabase SQL: supabase/2026-v47-generate-lot-no-sync.sql, potem kliknij „Zapisz import” ponownie. ' +
      'Dokumenty już zapisane zostaną pominięte.'
    )
  }
  if (/statement timeout|57014|canceling statement due to statement timeout/i.test(msg)) {
    return (
      'Zapis trwał za długo (limit czasu Supabase). Kliknij „Zapisz import do Supabase” ponownie — ' +
      'dokumenty już zapisane zostaną pominięte, system dokończy resztę partiami. Nie zamykaj karty.'
    )
  }
  return `Błąd zapisu do Supabase: ${msg}`
}

/** Usuwa operacje/partie/FIFO powiązane z importami oznaczonymi jako usunięte. */
export async function cleanupOrphanedDeletedImports(client) {
  const { data, error } = await withImportRetry(() =>
    client.rpc('cleanup_orphaned_deleted_import_data')
  )
  if (error) {
    if (/function.*does not exist/i.test(String(error.message || ''))) {
      return { imports_purged: 0, skipped: true, needsMigration: true }
    }
    throw error
  }
  return data || { imports_purged: 0 }
}

export function formatCleanupResult(cleanup) {
  if (cleanup?.needsMigration || cleanup?.skipped) {
    return 'Brak funkcji sprzątania w bazie. Uruchom w Supabase SQL: supabase/JEDNORAZOWE-wyczysc-osierocone-importy.sql (oraz 2026-v40-import-delete-full-purge.sql).'
  }
  const ops = cleanup?.operations_removed ?? 0
  const lots = cleanup?.lots_removed ?? 0
  const imports = cleanup?.imports_purged ?? 0
  if (!imports && !lots && !ops) {
    return 'Sprzątanie: nie znaleziono pozostałości po usuniętych importach (partie mogą pochodzić z aktywnego importu — sprawdź Rejestr importów).'
  }
  return `Wyczyszczono: ${imports} import(ów), ${ops} operacji, ${lots} partii.`
}

/** Szuka PZ/WZ w całej bazie (nie tylko w podglądzie jednego importu). */
export async function lookupWarehouseDocument(client, documentNoPattern, { operationType = 'przyjecie' } = {}) {
  if (!client || !documentNoPattern) return []
  const needle = normalizeDocumentNo(documentNoPattern)
  const variants = [...new Set(documentNoImportAliases(needle))]

  const select = 'id, operation_type, operation_date, document_no, imported_file_id, created_at, imported_files(filename, deleted_at)'
  const { data: exact, error } = await withImportRetry(() =>
    client.from('operations').select(select).eq('operation_type', operationType).in('document_no', variants).limit(20)
  )
  if (error) {
    const { data: fallback, error: err2 } = await withImportRetry(() =>
      client.from('operations').select('id, operation_type, operation_date, document_no, imported_file_id, created_at').eq('operation_type', operationType).in('document_no', variants).limit(20)
    )
    if (err2) throw err2
    if (fallback?.length) return enrichLookupOperations(client, fallback)
  } else if (exact?.length) {
    return enrichLookupOperations(client, exact)
  }

  const partial = needle.match(/(?:PZ|WZ)\/(\d+\/\d{1,2}\/\d{1,2}\/\d{4})/i)
  const likePattern = partial ? `%/${partial[1]}%` : `%${needle.slice(-18)}%`
  const { data: fuzzy, error: fuzzyErr } = await withImportRetry(() =>
    client.from('operations').select('id, operation_type, operation_date, document_no, imported_file_id, created_at').eq('operation_type', operationType).ilike('document_no', likePattern).limit(20)
  )
  if (fuzzyErr) throw fuzzyErr
  return enrichLookupOperations(client, fuzzy || [])
}

async function enrichLookupOperations(client, ops) {
  if (!ops?.length) return []
  const opIds = ops.map(o => o.id)
  const itemsByOp = await fetchOperationItemsByOpIds(client, opIds)
  const lotCounts = new Map()
  for (let i = 0; i < opIds.length; i += 50) {
    const chunk = opIds.slice(i, i + 50)
    const { data: lots, error } = await withImportRetry(() =>
      client.from('lots').select('id, source_operation_id, lot_no, remaining_qty, initial_qty, product_group').in('source_operation_id', chunk)
    )
    if (error) throw error
    for (const lot of lots || []) {
      const list = lotCounts.get(lot.source_operation_id) || []
      list.push(lot)
      lotCounts.set(lot.source_operation_id, list)
    }
  }
  const k01Counts = new Map()
  for (let i = 0; i < opIds.length; i += 50) {
    const chunk = opIds.slice(i, i + 50)
    const { data: k01, error } = await withImportRetry(() =>
      client.from('haccp_documents').select('id, operation_id, document_no, qty').eq('document_type', 'K01').in('operation_id', chunk)
    )
    if (error) throw error
    for (const doc of k01 || []) {
      k01Counts.set(doc.operation_id, (k01Counts.get(doc.operation_id) || 0) + 1)
    }
  }
  return ops.map(op => ({
    ...op,
    items: itemsByOp.get(op.id) || [],
    lots: lotCounts.get(op.id) || [],
    k01Count: k01Counts.get(op.id) || 0,
    importFilename: op.imported_files?.filename || null
  }))
}

/** Gdzie w wczytanym Excelu jest dany numer PZ/WZ (wiersze + grupa). */
export function traceExcelDocumentInImport(rows, groups, documentNoPattern) {
  const re = new RegExp(String(documentNoPattern || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  const matchedRows = (rows || []).filter(r => re.test(String(r.documentNo || '')))
  const matchedGroups = (groups || []).filter(g => re.test(String(g.documentNo || '')))
  return {
    rowCount: matchedRows.length,
    groupCount: matchedGroups.length,
    rows: matchedRows.slice(0, 5),
    groups: matchedGroups.map(g => ({
      documentNo: g.documentNo,
      issueDate: g.issueDate,
      items: (g.items || []).map(i => ({ productName: i.productName, qty: i.qty }))
    }))
  }
}

async function attachOperationItemsToPreviewOps(client, allOps) {
  const itemsByOp = new Map()
  const opIds = (allOps || []).map(o => o.id).filter(Boolean)
  for (let i = 0; i < opIds.length; i += 50) {
    const chunk = opIds.slice(i, i + 50)
    let itemOffset = 0
    while (true) {
      const { data: items, error: itemsErr } = await withImportRetry(() =>
        client
          .from('operation_items')
          .select('operation_id, qty, direction, raw_product_name')
          .in('operation_id', chunk)
          .order('id', { ascending: true })
          .range(itemOffset, itemOffset + 999)
      )
      if (itemsErr) throw itemsErr
      if (!items?.length) break
      for (const item of items) {
        const list = itemsByOp.get(item.operation_id) || []
        list.push(item)
        itemsByOp.set(item.operation_id, list)
      }
      if (items.length < 1000) break
      itemOffset += 1000
    }
  }
  return (allOps || []).map(op => ({
    ...op,
    operation_items: itemsByOp.get(op.id) || []
  }))
}

async function fetchOperationsByImportedFileId(client, importedFileId) {
  const allOps = []
  const pageSize = 200
  let offset = 0
  while (true) {
    const { data, error } = await withImportRetry(() =>
      client
        .from('operations')
        .select('id, operation_type, operation_date, document_no, invoice_no, notes, imported_file_id')
        .eq('imported_file_id', importedFileId)
        .order('operation_date', { ascending: false, nullsFirst: false })
        .order('document_no', { ascending: true })
        .range(offset, offset + pageSize - 1)
    )
    if (error) throw error
    if (!data?.length) break
    allOps.push(...data)
    if (data.length < pageSize) break
    offset += pageSize
  }
  return allOps
}

/** Szuka operacji po numerach PZ/WZ (gdy brak powiązania imported_file_id — np. doklejone do starszego importu). */
export async function fetchImportPreviewByDocumentNos(client, documentNos) {
  if (!client || !documentNos?.length) return []
  const variants = [...new Set(documentNos.flatMap(d => documentNoImportAliases(d)))]
  const allOps = []
  for (let i = 0; i < variants.length; i += 150) {
    const chunk = variants.slice(i, i + 150)
    const { data, error } = await withImportRetry(() =>
      client
        .from('operations')
        .select('id, operation_type, operation_date, document_no, invoice_no, notes, imported_file_id')
        .in('document_no', chunk)
        .order('operation_date', { ascending: false, nullsFirst: false })
        .order('document_no', { ascending: true })
        .limit(500)
    )
    if (error) throw error
    allOps.push(...(data || []))
  }
  const byId = new Map()
  for (const op of allOps) byId.set(op.id, op)
  return [...byId.values()]
}

/**
 * Podgląd operacji z zapisanego importu (bez zagnieżdżonego select — omija limity PostgREST).
 * @returns {{ operations, source: 'import_file'|'document_fallback'|'empty', importMeta }}
 */
export async function fetchImportPreviewOperations(client, importedFileId, { documentNos = [] } = {}) {
  if (!client || !importedFileId) {
    return { operations: [], source: 'empty', importMeta: null }
  }

  let importMeta = null
  try {
    const { data: fileRow, error: fileErr } = await withImportRetry(() =>
      client.from('imported_files').select('id, filename, rows_count, status, created_at').eq('id', importedFileId).maybeSingle()
    )
    if (fileErr) throw fileErr
    importMeta = fileRow || null
  } catch { /* opcjonalne */ }

  let allOps = await fetchOperationsByImportedFileId(client, importedFileId)
  let source = allOps.length ? 'import_file' : 'empty'

  if (!allOps.length && documentNos?.length) {
    allOps = await fetchImportPreviewByDocumentNos(client, documentNos)
    if (allOps.length) source = 'document_fallback'
  }

  const operations = await attachOperationItemsToPreviewOps(client, allOps)
  return { operations, source, importMeta }
}

/** Ręczna korekta daty dokumentu PZ lub WZ z rejestru importu. */
export async function saveWarehouseOperationDate(client, operationId, newDate, { operationType } = {}) {
  if (!client || !operationId) throw new Error('Brak operacji do zapisu.')
  const correct = String(newDate || '').slice(0, 10)
  if (!correct || correct === '0000-01-01') throw new Error('Podaj poprawną datę.')

  const { error: opErr } = await withImportRetry(() =>
    client.from('operations').update({ operation_date: correct }).eq('id', operationId)
  )
  if (opErr) throw opErr

  const isIncoming = operationType === 'przyjecie'
  if (isIncoming) {
    await withImportRetry(() =>
      client.from('lots').update({ production_date: correct }).eq('source_operation_id', operationId)
    )
    await withImportRetry(() =>
      client
        .from('haccp_documents')
        .update({ document_date: correct })
        .eq('operation_id', operationId)
        .eq('document_type', 'K01')
    )
  } else {
    await withImportRetry(() =>
      client
        .from('haccp_documents')
        .update({ document_date: correct })
        .eq('operation_id', operationId)
        .eq('document_type', 'K03')
    )
  }

  invalidateFifoBaseCache()
  return { operation_date: correct }
}
