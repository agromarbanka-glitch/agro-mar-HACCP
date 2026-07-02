/**
 * K03 – identyfikacja partii produktu (WZ ↔ PZ wg FIFO).
 * Jeden formularz = jedna pozycja WZ (operacja + produkt).
 */

export const K03_ENGINE_VERSION = '3.1'

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/\s+/g, ' ')
}

export function productGroupForName(productName) {
  const text = normalizeText(productName)
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

function resolveProductGroup(product, productName = '') {
  return product?.product_group || productGroupForName(product?.name || productName)
}

export function isSaleOperation(op) {
  if (!op) return false
  const raw = String(op.document_no || op.invoice_no || '').trim()
  const no = raw.toUpperCase()
  if (/^(WZ|FV|FS)[\s./\-]?/i.test(raw)) return true
  if (/\b(WZ|FV|FS)\b/.test(no)) return true
  if (no.includes('/WZ') || no.includes('WZ/')) return true
  return op.operation_type === 'sprzedaz' || op.operation_type === 'sprzedaz_bez_produkcji'
}

function saleDocumentNo(op) {
  return String(op?.document_no || op?.invoice_no || '').trim()
}

function saleOperationDate(op) {
  const d = String(op?.operation_date || '').slice(0, 10)
  if (d) return d
  return String(op?.created_at || '').slice(0, 10) || '0000-01-01'
}

function saleLineKey(operationId, productId, productName = '') {
  const pid = productId || `raw:${normalizeText(productName || 'produkt')}`
  return `${operationId}|${pid}`
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

function pickSaleItems(items, op) {
  const list = items || []
  const rozchod = list.filter(i => i.direction === 'rozchod' && Math.abs(Number(i.qty || 0)) > 0)
  if (rozchod.length) return rozchod
  if (isSaleOperation(op)) {
    return list.filter(i => Math.abs(Number(i.qty || 0)) > 0)
  }
  return []
}

function buildFormDoc(saleLine, pzRows, productMap, contractorMap, source = 'baza') {
  const op = saleLine.op
  const product = productMap.get(saleLine.product_id)
  const productName = product?.name || saleLine.raw_product_name || 'Produkt'
  const productGroup = resolveProductGroup(product, productName)
  const wzNo = saleDocumentNo(op) || saleLine.document_no || `OP-${String(saleLine.operation_id || '').slice(0, 8)}`
  const wzDate = saleOperationDate(op) || saleLine.issue_date || '0000-01-01'
  const saleQty = Number(saleLine.qty || 0)
  const receiver = contractorMap.get(op?.contractor_id)?.name || saleLine.receiver_name || ''

  const rawRowsBase = (pzRows || [])
    .filter(r => Number(r.qty || 0) > 0)
    .sort((a, b) =>
      String(a.pz_date || '').localeCompare(String(b.pz_date || '')) ||
      String(a.pz_no || '').localeCompare(String(b.pz_no || ''))
    )

  let invalidFuturePz = false
  for (const r of rawRowsBase) {
    const pzDate = String(r.pz_date || '').slice(0, 10)
    if (pzDate && wzDate && wzDate !== '0000-01-01' && pzDate > wzDate) invalidFuturePz = true
  }

  const allocatedTotal = rawRowsBase.reduce((sum, r) => sum + Number(r.qty || 0), 0)
  const shortage = Math.max(0, Math.round((saleQty - allocatedTotal) * 1000) / 1000)
  const rawRows = shortage > 0
    ? [...rawRowsBase, {
      pz_no: source === 'excel' ? 'Zapisz do bazy i przelicz FIFO' : 'BRAK SUROWCA NA DZIEŃ WZ',
      pz_date: wzDate !== '0000-01-01' ? `≤ ${wzDate}` : '',
      supplier: source === 'excel' ? '—' : 'uzupełnij PZ lub przelicz FIFO',
      qty: shortage,
      source_lot_no: '',
      isShortage: true
    }]
    : rawRowsBase

  const rawTotal = rawRows.reduce((sum, r) => sum + Number(r.qty || 0), 0)
  const quantitiesMatch = source === 'excel' ? false : (Math.abs(rawTotal - saleQty) < 0.001 && shortage <= 0)
  const formId = `K03-${saleLine.key}`

  return {
    id: formId,
    synthetic: true,
    document_type: 'K03',
    document_date: wzDate,
    product_name: productName,
    product_group: productGroup,
    lot_no: wzNo,
    supplier_name: '',
    document_no: wzNo,
    chamber_code: '',
    qty: saleQty,
    status: source === 'excel' || invalidFuturePz || shortage > 0 ? 'N' : 'P',
    data: {
      wz_no: wzNo,
      wz_date: wzDate,
      odbiorca: receiver,
      product_group: productGroup,
      rawRows,
      saleRows: [{ wz_no: wzNo, wz_date: wzDate, receiver, qty: saleQty, signed_by: '' }],
      allocatedTotal,
      rawTotal,
      saleQty,
      shortage,
      quantitiesMatch,
      invalidFuturePz,
      sale_operation_id: saleLine.operation_id,
      product_id: saleLine.product_id,
      k03_source: source
    },
    signed_by_operator: '',
    signed_by_admin: '',
    document_version: 'I/2024',
    created_at: wzDate
  }
}

/** Formularze K03 z wczytanego Excela (gdy baza jeszcze nie zwraca WZ). */
export function buildK03FormsFromExcelRows(excelRows) {
  const saleLines = new Map()
  for (const row of excelRows || []) {
    if (row.operation !== 'sprzedaz') continue
    if (!row.documentNo || !row.productName) continue
    const qty = Math.abs(Number(row.qty) || 0)
    if (qty <= 0) continue
    const key = `${row.documentNo}|${normalizeText(row.productName)}`
    const current = saleLines.get(key) || {
      key,
      operation_id: key,
      product_id: null,
      raw_product_name: row.productName,
      document_no: row.documentNo,
      issue_date: row.issueDate || '0000-01-01',
      receiver_name: row.contractorName || '',
      qty: 0,
      op: {
        document_no: row.documentNo,
        operation_date: row.issueDate,
        contractor_id: null
      }
    }
    current.qty += qty
    saleLines.set(key, current)
  }

  const emptyMap = new Map()
  return Array.from(saleLines.values())
    .map(line => buildFormDoc(line, [], emptyMap, emptyMap, 'excel'))
    .sort((a, b) =>
      String(a.document_date || '').localeCompare(String(b.document_date || '')) ||
      String(a.document_no || '').localeCompare(String(b.document_no || ''))
    )
}

/** Formularze K03 z podglądu importu (tabela operations + operation_items). */
export function buildK03FormsFromImportPreview(importOps) {
  const saleLines = new Map()
  for (const op of importOps || []) {
    if (!isSaleOperation(op)) continue
    const items = op.operation_items || []
    const picked = pickSaleItems(items, op)
    for (const item of picked) {
      const qty = Math.abs(Number(item.qty || 0))
      if (qty <= 0) continue
      const rawName = item.raw_product_name || ''
      const key = saleLineKey(op.id, item.product_id, rawName)
      const current = saleLines.get(key) || {
        key,
        operation_id: op.id,
        product_id: item.product_id || null,
        raw_product_name: rawName,
        qty: 0,
        op
      }
      current.qty += qty
      saleLines.set(key, current)
    }
  }
  const emptyMap = new Map()
  return Array.from(saleLines.values())
    .map(line => buildFormDoc(line, [], emptyMap, emptyMap, 'import'))
}

/**
 * Ładuje formularze K03 z Supabase.
 */
export async function loadK03Forms(client) {
  if (!client) {
    return {
      forms: [],
      diag: { wzDocs: 0, saleLines: 0, forms: 0, allocations: 0, source: 'brak-bazy' },
      message: 'Aplikacja nie łączy się z bazą danych. Jeśli wczytałeś Excel, formularze K03 pokażą się z pliku.'
    }
  }

  const { data: rozchodItems, error: rozchodErr } = await client
    .from('operation_items')
    .select('id, operation_id, product_id, qty, direction, raw_product_name')
    .eq('direction', 'rozchod')
    .limit(50000)
  if (rozchodErr) throw rozchodErr

  const rozchodOpIds = Array.from(new Set((rozchodItems || []).map(i => i.operation_id).filter(Boolean)))

  const [{ data: saleTypedOps, error: typedErr }, rozchodOps] = await Promise.all([
    client
      .from('operations')
      .select('id, operation_type, operation_date, document_no, invoice_no, contractor_id, created_at')
      .eq('operation_type', 'sprzedaz')
      .order('operation_date', { ascending: true })
      .limit(50000),
    rozchodOpIds.length
      ? fetchInChunks(client, 'operations', 'id, operation_type, operation_date, document_no, invoice_no, contractor_id, created_at', 'id', rozchodOpIds)
      : Promise.resolve([])
  ])
  if (typedErr) throw typedErr

  const opMap = new Map()
  for (const op of [...(saleTypedOps || []), ...(rozchodOps || [])]) {
    if (op?.id) opMap.set(op.id, op)
  }

  const saleOpIds = new Set()
  for (const op of opMap.values()) {
    if (isSaleOperation(op) || rozchodOpIds.includes(op.id)) saleOpIds.add(op.id)
  }

  let allItems = [...(rozchodItems || [])]
  const rozchodKeys = new Set(allItems.map(i => `${i.operation_id}|${i.product_id}|${normalizeText(i.raw_product_name || '')}`))

  if (saleOpIds.size) {
    const saleItems = await fetchInChunks(
      client,
      'operation_items',
      'id, operation_id, product_id, qty, direction, raw_product_name',
      'operation_id',
      Array.from(saleOpIds)
    )
    for (const item of saleItems) {
      if (item.direction === 'rozchod') continue
      const k = `${item.operation_id}|${item.product_id}|${normalizeText(item.raw_product_name || '')}`
      if (rozchodKeys.has(k)) continue
      if (!isSaleOperation(opMap.get(item.operation_id))) continue
      allItems.push(item)
    }
  }

  const itemsByOp = new Map()
  for (const item of allItems) {
    if (!item.operation_id || !saleOpIds.has(item.operation_id)) continue
    if (!itemsByOp.has(item.operation_id)) itemsByOp.set(item.operation_id, [])
    itemsByOp.get(item.operation_id).push(item)
  }

  const [{ data: products, error: prodErr }, allocResult] = await Promise.all([
    client.from('products').select('id, name, code, product_group').limit(10000),
    client.from('fifo_allocations').select('id, qty, source_lot_id, product_id, operation_id, created_at').order('created_at', { ascending: true }).limit(50000)
  ])
  if (prodErr) throw prodErr

  const allocations = allocResult.error ? [] : (allocResult.data || [])
  const productMap = new Map((products || []).map(p => [p.id, p]))

  const saleLines = new Map()
  for (const opId of saleOpIds) {
    const op = opMap.get(opId)
    const items = pickSaleItems(itemsByOp.get(opId), op)
    for (const item of items) {
      const qty = Math.abs(Number(item.qty || 0))
      if (qty <= 0) continue
      const product = productMap.get(item.product_id)
      const rawName = item.raw_product_name || product?.name || ''
      const key = saleLineKey(opId, item.product_id, rawName)
      const current = saleLines.get(key) || {
        key,
        operation_id: opId,
        product_id: item.product_id || null,
        raw_product_name: rawName,
        qty: 0,
        op
      }
      current.qty += qty
      saleLines.set(key, current)
    }
  }

  const sourceLotIds = Array.from(new Set(allocations.map(a => a.source_lot_id).filter(Boolean)))
  const sourceLots = sourceLotIds.length
    ? await fetchInChunks(client, 'lots', 'id, lot_no, production_date, source_operation_id, product_id', 'id', sourceLotIds)
    : []
  const sourceOpIds = Array.from(new Set(sourceLots.map(l => l.source_operation_id).filter(Boolean)))
  const sourceOps = sourceOpIds.length
    ? await fetchInChunks(client, 'operations', 'id, operation_date, document_no, invoice_no, contractor_id', 'id', sourceOpIds)
    : []
  const contractorIds = Array.from(new Set([
    ...Array.from(saleOpIds).map(id => opMap.get(id)?.contractor_id),
    ...sourceOps.map(o => o.contractor_id)
  ].filter(Boolean)))
  const contractors = contractorIds.length
    ? await fetchInChunks(client, 'contractors', 'id, name', 'id', contractorIds)
    : []

  const lotMap = new Map(sourceLots.map(l => [l.id, l]))
  const sourceOpMap = new Map(sourceOps.map(o => [o.id, o]))
  const contractorMap = new Map(contractors.map(c => [c.id, c]))

  const pzBySaleKey = new Map()
  for (const alloc of allocations) {
    if (!saleOpIds.has(alloc.operation_id)) continue
    const lot = lotMap.get(alloc.source_lot_id) || {}
    const pzOp = sourceOpMap.get(lot.source_operation_id) || {}
    const qty = Number(alloc.qty || 0)
    if (qty <= 0) continue
    const sale = Array.from(saleLines.values()).find(s =>
      s.operation_id === alloc.operation_id &&
      (s.product_id === alloc.product_id || (!s.product_id && !alloc.product_id))
    )
    const key = sale?.key || saleLineKey(alloc.operation_id, alloc.product_id)
    if (!pzBySaleKey.has(key)) pzBySaleKey.set(key, [])
    pzBySaleKey.get(key).push({
      pz_no: pzOp.document_no || lot.lot_no || '',
      pz_date: String(pzOp.operation_date || lot.production_date || '').slice(0, 10),
      supplier: contractorMap.get(pzOp.contractor_id)?.name || '',
      qty,
      source_lot_no: lot.lot_no || ''
    })
  }

  const forms = Array.from(saleLines.values())
    .map(line => buildFormDoc(line, pzBySaleKey.get(line.key) || [], productMap, contractorMap, 'baza'))
    .sort((a, b) =>
      String(a.document_date || '').localeCompare(String(b.document_date || '')) ||
      String(a.document_no || '').localeCompare(String(b.document_no || '')) ||
      String(a.product_name || '').localeCompare(String(b.product_name || ''))
    )

  const diag = {
    wzDocs: saleOpIds.size,
    saleLines: saleLines.size,
    forms: forms.length,
    allocations: allocations.length,
    rozchodItems: (rozchodItems || []).length,
    source: 'baza'
  }

  let message = ''
  if (!saleOpIds.size) {
    message = 'W bazie nie ma jeszcze WZ. Jeśli wczytałeś Excel – kliknij „Zapisz do Supabase” w zakładce Importy.'
  } else if (!saleLines.size) {
    message = `W bazie jest ${saleOpIds.size} WZ, ale brak pozycji z ilością. Sprawdź kolumny Produkt i Ilość w Excelu.`
  }

  return { forms, diag, message }
}

export function mergeK03Overrides(forms, overrides = {}) {
  return (forms || []).map(doc => {
    const ov = overrides[doc.id] || {}
    const signed = ov.signed_by_operator || doc.signed_by_operator || ''
    const saleRows = (doc.data?.saleRows || []).map(r => ({ ...r, signed_by: signed }))
    return {
      ...doc,
      signed_by_operator: signed,
      data: { ...doc.data, saleRows }
    }
  })
}
