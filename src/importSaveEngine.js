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

import { normalizeDocumentNo, inferDateFromDocumentNo, documentNoHasExplicitDate, documentNoHasMonthYear, isWzMonthYearDocument } from './excelImport.js'
import { k01LineDedupeKey } from './k01Engine.js'

const OP_CHUNK = 250
const ITEM_CHUNK = 500
const NAME_CHUNK = 100
const LOT_RPC_CHUNK = 600
const LOT_CONCURRENCY = 24
const ITEM_LOT_UPDATE_CHUNK = 80
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

  /** Warianty nr dokumentu (ze spacją po prefiksie) – stare wpisy w bazie mogły mieć „PZ / …”. */
  function documentNoQueryVariants(normalized) {
    const out = new Set([normalized])
    const m = String(normalized || '').match(/^(PZ|WZ|MM|RR|FV|FS)(\/.*)$/i)
    if (m) out.add(`${m[1]} ${m[2]}`)
    return [...out]
  }

  function registerExistingOperation(op, importMeta) {
    const imp = importMeta ?? op.imported_files
    if (imp?.deleted_at) {
      orphanCount += 1
      return
    }
    const key = operationImportKey({ operation: op.operation_type, documentNo: op.document_no })
    keys.add(key)
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
    const existing = details.get(key)
    if (!existing || String(candidate.createdAt || '') > String(existing.createdAt || '')) {
      details.set(key, candidate)
    }
  }

  for (let i = 0; i < documentNos.length; i += 200) {
    const chunk = documentNos.slice(i, i + 200)
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
      continue
    }
    for (const op of data || []) {
      registerExistingOperation(op)
    }
  }
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

/** Dzieli grupy dokumentów na już w bazie (duplikaty) i nowe. */
export function splitImportGroupsByExisting(groups, existingKeys) {
  const duplicates = []
  const fresh = []
  for (const g of groups || []) {
    if (existingKeys.has(operationImportKey(g))) duplicates.push(g)
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

  const opIds = existingGroups
    .map(g => details.get(operationImportKey(g))?.operationId)
    .filter(Boolean)
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
    const meta = details.get(operationImportKey(group))
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

    if (!diff.newItems.length) {
      if (!diff.hasContentChanges) unchangedDocuments += 1
      continue
    }

    mergedDocuments += 1
    mergedOpIds.add(opId)
    for (const row of diff.newItems) {
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
export async function repairMissingIncomingLots(client, deps, { onProgress } = {}) {
  const notify = msg => onProgress?.(msg)
  if (!client) return 0

  notify('Sprawdzanie pozycji PZ bez partii…')
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

export function formatMergeResult(merge) {
  if (!merge?.importedItems && !merge?.createdLots) return ''
  const docs = merge.mergedDocuments ? ` (${merge.mergedDocuments} dokumentów)` : ''
  return `Doklejono ${merge.importedItems} brakujących pozycji z Excela${docs}, utworzono ${merge.createdLots || 0} partii.`
}

/** Pobiera zapis operacji + pozycje — do wykrywania zmian na rozpisanych PZ/WZ. */
export async function loadStoredImportOperations(client, groups, details) {
  const opIds = (groups || [])
    .map(g => details.get(operationImportKey(g))?.operationId)
    .filter(Boolean)
  const itemsByOp = await fetchOperationItemsByOpIds(client, opIds)
  const out = new Map()
  for (const group of groups || []) {
    const key = operationImportKey(group)
    const meta = details.get(key)
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

async function insertOperationsForGroups(client, groups, importedFileId, contractorMap) {
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
    insertedOps = await insertInChunks(client, 'operations', allOpRows, 'id, operation_type, document_no', OP_CHUNK)
  } catch (err) {
    if (!String(err?.message || '').includes('duplicate')) throw err
    insertedOps = []
    for (const row of allOpRows) {
      try {
        const { data: one, error: oneErr } = await withImportRetry(() =>
          client.from('operations').insert(row).select('id, operation_type, document_no').single()
        )
        if (oneErr) {
          if (String(oneErr.message || '').includes('duplicate')) continue
          throw oneErr
        }
        insertedOps.push(one)
      } catch (inner) {
        if (String(inner?.message || '').includes('duplicate')) continue
        throw inner
      }
    }
  }

  const opKeyToId = new Map()
  for (const op of insertedOps) {
    opKeyToId.set(operationImportKey({ operation: op.operation_type, documentNo: op.document_no }), op.id)
  }
  return { opKeyToId, importedOperations: insertedOps.length }
}

async function insertItemsAndLotsForGroups(client, groups, opKeyToId, productMap, deps, notify, fileName, importedFileId) {
  let importedItems = 0
  let rozchodItems = 0
  let createdLots = 0
  const allItemRows = []
  const allItemMeta = []

  for (const group of groups) {
    const opId = opKeyToId.get(operationImportKey(group))
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
    client, groupsToImport, imported.id, contractorMap
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

/** Szacuje ile linii doklejenie doda (bez zapisu do bazy). */
export async function estimateMergeNewItems(client, existingGroups, details, deps) {
  if (!client || !existingGroups?.length) return 0
  const opIds = existingGroups.map(g => details.get(operationImportKey(g))?.operationId).filter(Boolean)
  const itemsByOp = await fetchOperationItemsByOpIds(client, opIds)
  let total = 0
  for (const group of existingGroups) {
    const key = operationImportKey(group)
    const meta = details.get(key)
    const opId = meta?.operationId
    if (!opId) continue
    const diff = diffImportGroupAgainstStored(group, meta, itemsByOp.get(opId) || [], deps)
    total += diff.newItems.length
  }
  return total
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
      if (!documentNoHasExplicitDate(op.document_no)) continue
      const correct = inferDateFromDocumentNo(op.document_no)
      const current = String(op.operation_date || '').slice(0, 10)
      if (!correct || correct === current) continue

      await withImportRetry(() =>
        client.from('operations').update({ operation_date: correct }).eq('id', op.id)
      )
      await withImportRetry(() =>
        client.from('lots').update({ production_date: correct }).eq('source_operation_id', op.id)
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
  const dateRepair = await repairDatesForImportFile(client, importedFileId, { onProgress })
  onProgress?.('Sprawdzanie zduplikowanych kart K01…')
  const k01Removed = await removeDuplicateK01Documents(client, { onProgress })
  return {
    dates_fixed: dateRepair.dates_fixed || 0,
    wz_dates_fixed: wzRepair.wz_dates_fixed || 0,
    k01_removed: k01Removed,
    items_removed: 0,
    lots_removed: 0
  }
}

/**
 * Poprawia daty operacji/partii/K01 wg numeru PZ (np. 07/07/2026 zamiast błędnego forward-fill 06.07).
 */
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
      if (!documentNoHasExplicitDate(op.document_no)) continue
      const correct = inferDateFromDocumentNo(op.document_no)
      const current = String(op.operation_date || '').slice(0, 10)
      if (!correct || correct === current) continue

      await withImportRetry(() =>
        client.from('operations').update({ operation_date: correct }).eq('id', op.id)
      )
      await withImportRetry(() =>
        client.from('lots').update({ production_date: correct }).eq('source_operation_id', op.id)
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

    if (ops.length < pageSize) break
    offset += pageSize
  }
  return { dates_fixed: fixed }
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
  const dateRepair = importedFileId
    ? await repairDatesForImportFile(client, importedFileId, { onProgress })
    : await repairDatesFromDocumentNumbers(client, { onProgress })
  notify('Czyszczenie duplikatów magazynu (FIFO)…')

  let result = {
    items_removed: 0,
    lots_removed: 0,
    k01_removed: 0,
    dates_fixed: dateRepair.dates_fixed || 0,
    wz_dates_fixed: wzRepair.wz_dates_fixed || 0,
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

export function formatPurgeAllImportsResult(result) {
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
