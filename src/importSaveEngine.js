/**
 * Zapis importu Excel do Supabase – batch + retry (mniej zapytań, odporność na NetworkError).
 */

import { normalizeDocumentNo } from './excelImport.js'

const OP_CHUNK = 100
const ITEM_CHUNK = 150
const NAME_CHUNK = 100
const LOT_RPC_CHUNK = 500
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
    if (!details.has(key)) {
      details.set(key, {
        documentNo: op.document_no,
        operationType: op.operation_type,
        importFilename: imp?.filename || null,
        importDeleted: Boolean(imp?.deleted_at),
        createdAt: op.created_at,
        importedFileId: op.imported_file_id
      })
    }
  }

  for (let i = 0; i < documentNos.length; i += 200) {
    const chunk = documentNos.slice(i, i + 200)
    const queryNos = [...new Set(chunk.flatMap(documentNoQueryVariants))]
    let data
    let error
    ;({ data, error } = await withImportRetry(() =>
      client.from('operations')
        .select('id, operation_type, document_no, imported_file_id, created_at, imported_files(filename, deleted_at, status)')
        .in('document_no', queryNos)
    ))
    if (error) {
      ;({ data, error } = await withImportRetry(() =>
        client.from('operations').select('id, operation_type, document_no, imported_file_id, created_at').in('document_no', queryNos)
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

async function purgeStaleInProgressImportsClient(client, filename) {
  if (!filename) return { removed: 0 }
  const { data: stale, error } = await withImportRetry(() =>
    client.from('imported_files')
      .select('id')
      .is('deleted_at', null)
      .eq('status', 'w_trakcie')
      .ilike('filename', filename)
  )
  if (error) throw error
  let removed = 0
  for (const row of stale || []) {
    await purgeImportDataClientSide(client, row.id)
    await withImportRetry(() => client.from('imported_files').delete().eq('id', row.id))
    removed += 1
  }
  return { removed }
}

/** Przed zapisem: usuwa pozostałości usuniętych importów i przerwane importy tego samego pliku. */
export async function prepareImportExcelSave(client, filename) {
  const { data, error } = await withImportRetry(() =>
    client.rpc('prepare_import_excel_save', { p_filename: filename || null })
  )
  if (!error) return data || {}

  if (!/function.*does not exist/i.test(String(error.message || ''))) throw error

  const cleanup = await cleanupOrphanedDeletedImports(client)
  const stale = await purgeStaleInProgressImportsClient(client, filename)
  return {
    needsMigration: true,
    deleted_imports_cleaned: cleanup?.imports_purged || 0,
    stale_in_progress_removed: stale.removed,
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
  const unique = [...new Set(productNames.map(n => n || 'Produkt do dopasowania'))]
  const { normalizeText, baseCodeForProduct, productGroupForName } = deps
  const map = new Map()

  const existing = await fetchNamesInChunks(client, 'products', 'name', unique, 'id, name, code')
  for (const p of existing) map.set(normalizeText(p.name), p.id)

  const missing = unique.filter(name => !map.has(normalizeText(name)))
  if (!missing.length) return map

  const { data: catalog, error: catalogErr } = await withImportRetry(() =>
    client.from('products').select('id, name, code')
  )
  if (catalogErr) throw catalogErr

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
  const unique = [...new Set(contractorNames.filter(Boolean))]
  const map = new Map()
  if (!unique.length) return map

  const existing = await fetchNamesInChunks(client, 'contractors', 'name', unique, 'id, name')
  for (const c of existing) map.set(c.name, c.id)

  const missing = unique.filter(name => !map.has(name))
  if (missing.length) {
    const rows = missing.map(name => ({ name, contractor_type: 'oba' }))
    const inserted = await insertInChunks(client, 'contractors', rows, 'id, name', 50)
    for (const c of inserted) map.set(c.name, c.id)
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
      storage_chamber_id: null
    }).select('id').single()
  )
  if (lotErr) throw lotErr
  return lot.id
}

async function createIncomingLotsBatchRpc(client, incomingItems, deps, notify) {
  let total = 0
  const chunkCount = Math.ceil(incomingItems.length / LOT_RPC_CHUNK)
  for (let i = 0; i < incomingItems.length; i += LOT_RPC_CHUNK) {
    const slice = incomingItems.slice(i, i + LOT_RPC_CHUNK)
    if (chunkCount === 1) {
      notify(`Tworzenie ${incomingItems.length} partii…`)
    } else {
      notify(`Tworzenie partii ${Math.min(i + slice.length, incomingItems.length)} / ${incomingItems.length}…`)
    }
    const payload = slice.map(meta => ({
      item_id: meta.itemId,
      product_id: meta.productId,
      operation_id: meta.opId,
      operation_date: meta.group.issueDate,
      qty: meta.itemQty,
      product_group: deps.productGroupForName(meta.row.productName)
    }))
    const { data, error } = await withImportRetry(() =>
      client.rpc('create_incoming_lots_batch', { p_items: payload })
    )
    if (error) throw error
    total += Number(data || 0)
  }
  return total
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

  let importedOperations = 0
  let importedItems = 0
  let createdLots = 0
  let rozchodItems = 0

  notify(`Zapis ${groupsToImport.length} dokumentów…`)
  const allOpRows = groupsToImport.map(group => ({
    operation_type: group.operation,
    operation_date: group.issueDate,
    document_no: group.documentNo,
    invoice_no: group.invoiceNo,
    contractor_id: group.contractorName ? contractorMap.get(group.contractorName) : null,
    imported_file_id: imported.id,
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
    importedOperations += 1
  }

  notify('Zapis pozycji…')
  const allItemRows = []
  const allItemMeta = []

  for (const group of groupsToImport) {
    const opId = opKeyToId.get(operationImportKey(group))
    if (!opId) continue

    for (const row of group.items) {
      const productId = productMap.get(deps.normalizeText(row.productName || 'Produkt do dopasowania'))
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
      if (!/lots_lot_no_key|duplicate key.*lot/i.test(String(lotErr?.message || ''))) throw lotErr
      notify('Pozostałości partii w bazie – automatyczne sprzątanie…')
      await prepareImportExcelSave(client, fileName)
      createdLots = await attachLotsToIncomingItems(client, allIncomingItems, deps, notify)
    }
  }

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

export function formatImportNetworkError(err) {
  const msg = String(err?.message || err || '')
  if (/lots_lot_no_key|duplicate key.*lot/i.test(msg)) {
    return (
      'Błąd: numer partii już istnieje w bazie (pozostałość po wcześniejszym imporcie). ' +
      'Spróbuj ponownie – przed zapisem system automatycznie czyści pozostałości. ' +
      'Jeśli błąd się powtarza: usuń stary import z rejestru lub uruchom w Supabase SQL: 2026-v40 + 2026-v42.'
    )
  }
  if (isTransientNetworkError(err)) {
    return (
      'Błąd połączenia z Supabase (NetworkError). Sprawdź internet i czy projekt Supabase nie jest wstrzymany. ' +
      'Możesz spróbować ponownie – już zapisane dokumenty zostaną pominięte jako duplikaty.'
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
