/**
 * Zapis importu Excel do Supabase – batch + retry (mniej zapytań, odporność na NetworkError).
 */

import { normalizeDocumentNo } from './excelImport.js'

const OP_CHUNK = 40
const ITEM_CHUNK = 80
const NAME_CHUNK = 80
const LOT_CONCURRENCY = 12
const ITEM_LOT_UPDATE_CHUNK = 40
const RETRY_ATTEMPTS = 4
const RETRY_BASE_MS = 700

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

  for (let i = 0; i < documentNos.length; i += 100) {
    const chunk = documentNos.slice(i, i + 100)
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

async function fetchNamesInChunks(client, table, column, names) {
  const out = []
  for (let i = 0; i < names.length; i += NAME_CHUNK) {
    const chunk = names.slice(i, i + NAME_CHUNK)
    const { data, error } = await withImportRetry(() => client.from(table).select('*').in(column, chunk))
    if (error) throw error
    out.push(...(data || []))
  }
  return out
}

async function ensureProductIds(client, productNames, deps) {
  const unique = [...new Set(productNames.map(n => n || 'Produkt do dopasowania'))]
  const { normalizeText, baseCodeForProduct, productGroupForName } = deps
  const map = new Map()

  const existing = await fetchNamesInChunks(client, 'products', 'name', unique)
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

  const existing = await fetchNamesInChunks(client, 'contractors', 'name', unique)
  for (const c of existing) map.set(c.name, c.id)

  for (const name of unique) {
    if (map.has(name)) continue
    const { data: inserted, error } = await withImportRetry(() =>
      client.from('contractors').insert({ name, contractor_type: 'oba' }).select('id').single()
    )
    if (error) throw error
    map.set(name, inserted.id)
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

async function attachLotsToIncomingItems(client, incomingItems, deps, notify) {
  if (!incomingItems.length) return 0

  let createdLots = 0
  notify(`Tworzenie partii 0 / ${incomingItems.length}…`)

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

  createdLots = lotIds.length

  for (let i = 0; i < incomingItems.length; i += ITEM_LOT_UPDATE_CHUNK) {
    const slice = incomingItems.slice(i, i + ITEM_LOT_UPDATE_CHUNK)
    await Promise.all(slice.map((meta, j) =>
      withImportRetry(() =>
        client.from('operation_items').update({ lot_id: lotIds[i + j] }).eq('id', meta.itemId)
      )
    ))
  }

  return createdLots
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

  const opKeyToId = new Map()

  for (let i = 0; i < groupsToImport.length; i += OP_CHUNK) {
    const chunk = groupsToImport.slice(i, i + OP_CHUNK)
    notify(`Zapis dokumentów ${Math.min(i + OP_CHUNK, groupsToImport.length)} / ${groupsToImport.length}…`)

    const opRows = chunk.map(group => ({
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
      insertedOps = await insertInChunks(client, 'operations', opRows, 'id, operation_type, document_no', OP_CHUNK)
    } catch (err) {
      if (!String(err?.message || '').includes('duplicate')) throw err
      insertedOps = []
      for (const row of opRows) {
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

    for (const op of insertedOps) {
      opKeyToId.set(operationImportKey({ operation: op.operation_type, documentNo: op.document_no }), op.id)
      importedOperations += 1
    }

    const itemRows = []
    const itemMeta = []

    for (const group of chunk) {
      const opId = opKeyToId.get(operationImportKey(group))
      if (!opId) continue

      for (const row of group.items) {
        const productId = productMap.get(deps.normalizeText(row.productName || 'Produkt do dopasowania'))
        const direction = group.operation === 'przyjecie' ? 'przychod' : 'rozchod'
        const itemQty = Math.abs(Number(row.qty) || 0)
        if (itemQty <= 0 || !productId) continue

        itemRows.push({
          operation_id: opId,
          product_id: productId,
          qty: itemQty,
          unit: 'kg',
          direction,
          raw_product_name: row.productName
        })
        itemMeta.push({ direction, group, row, productId, itemQty, opId })
      }
    }

    if (!itemRows.length) continue

    notify(`Zapis pozycji (${itemRows.length} w tej partii)…`)
    const insertedItems = await insertInChunks(client, 'operation_items', itemRows, 'id', ITEM_CHUNK)

    const incomingItems = []
    for (let j = 0; j < insertedItems.length; j += 1) {
      const item = insertedItems[j]
      const meta = itemMeta[j]
      if (!item?.id || !meta) continue
      importedItems += 1

      if (meta.direction === 'rozchod') {
        rozchodItems += 1
        continue
      }

      incomingItems.push({ ...meta, itemId: item.id })
    }

    if (incomingItems.length) {
      createdLots += await attachLotsToIncomingItems(client, incomingItems, deps, notify)
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
  if (isTransientNetworkError(err)) {
    return (
      'Błąd połączenia z Supabase (NetworkError). Sprawdź internet i czy projekt Supabase nie jest wstrzymany. ' +
      'Możesz spróbować ponownie – już zapisane dokumenty zostaną pominięte jako duplikaty.'
    )
  }
  return `Błąd zapisu do Supabase: ${msg}`
}
