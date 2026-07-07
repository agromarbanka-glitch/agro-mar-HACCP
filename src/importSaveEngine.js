/**
 * Zapis importu Excel do Supabase – batch + retry (mniej zapytań, odporność na NetworkError).
 */

const OP_CHUNK = 40
const ITEM_CHUNK = 80
const NAME_CHUNK = 80
const RETRY_ATTEMPTS = 4
const RETRY_BASE_MS = 700

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

export async function getExistingOperationKeys(client, groups) {
  const keys = new Set()
  const documentNos = [...new Set(groups.map(g => g.documentNo).filter(Boolean))]

  for (let i = 0; i < documentNos.length; i += 100) {
    const chunk = documentNos.slice(i, i + 100)
    const { data, error } = await withImportRetry(() =>
      client.from('operations').select('operation_type, document_no').in('document_no', chunk)
    )
    if (error) throw error
    for (const op of data || []) {
      keys.add(`${op.operation_type}|${op.document_no}`)
    }
  }
  return keys
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

  for (const name of unique) {
    const key = normalizeText(name)
    if (map.has(key)) continue

    let code = baseCodeForProduct(name)
    let suffix = 2
    while (true) {
      const { data: byCode, error: codeErr } = await withImportRetry(() =>
        client.from('products').select('id, name').eq('code', code).maybeSingle()
      )
      if (codeErr) throw codeErr
      if (!byCode) break
      if (normalizeText(byCode.name) === key) {
        map.set(key, byCode.id)
        break
      }
      code = `${baseCodeForProduct(name)}${suffix}`
      suffix += 1
    }
    if (map.has(key)) continue

    const { data: inserted, error: insertErr } = await withImportRetry(() =>
      client.from('products').insert({
        name,
        code,
        product_type: 'surowiec_lub_produkt',
        product_group: productGroupForName(name)
      }).select('id').single()
    )
    if (insertErr) throw insertErr
    map.set(key, inserted.id)
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
      status: duplicateCount ? `pominieto_duplikaty_${duplicateCount}` : 'wczytany'
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
      opKeyToId.set(`${op.operation_type}|${op.document_no}`, op.id)
      importedOperations += 1
    }

    const itemRows = []
    const itemMeta = []

    for (const group of chunk) {
      const opId = opKeyToId.get(`${group.operation}|${group.documentNo}`)
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

    for (let j = 0; j < insertedItems.length; j += 1) {
      const item = insertedItems[j]
      const meta = itemMeta[j]
      if (!item?.id || !meta) continue
      importedItems += 1

      if (meta.direction === 'rozchod') {
        rozchodItems += 1
        continue
      }

      const lotId = await createIncomingLot(client, {
        productId: meta.productId,
        operationId: meta.opId,
        operationDate: meta.group.issueDate,
        qty: meta.itemQty,
        productName: meta.row.productName,
        deps
      })
      createdLots += 1

      const { error: itemLotErr } = await withImportRetry(() =>
        client.from('operation_items').update({ lot_id: lotId }).eq('id', item.id)
      )
      if (itemLotErr) throw itemLotErr
    }
  }

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
