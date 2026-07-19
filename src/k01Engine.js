import { inferDateFromDocumentNo, resolveDocumentIssueDate } from './excelImport.js'
import { canonicalProductName, isPulpaProductName } from './k03Engine.js'

export const K01_ENGINE_VERSION = '1.3'

/** Nazwa surowca na K01 (przyjęcie PZ) — pulpa tylko gdy jest w PZ/Excelu, nie z katalogu produktów. */
export function intakeProductDisplayName(productName = '') {
  const raw = String(productName || '').trim()
  if (!raw) return raw
  const canonical = canonicalProductName(raw)
  if (isPulpaProductName(canonical) && !isPulpaProductName(raw)) {
    const lower = raw.toLowerCase()
    if (/porzeczka/.test(lower)) {
      if (/czerwona/.test(lower)) return 'Porzeczka czerwona'
      if (/czarna/.test(lower)) return 'Porzeczka czarna'
      return 'Porzeczka kolorowa'
    }
    if (/malina/.test(lower)) return canonicalProductName(raw) || raw
    return canonical.replace(/\s+pulpa/gi, '').trim() || raw
  }
  return canonical || raw
}

/** Klucz logicznej linii K01 (FIFO: jeden wpis na PZ + data + kg). */
export function k01LineDedupeKey(doc) {
  const qty = Math.round(Number(doc?.qty || 0) * 1000) / 1000
  const no = String(doc?.document_no || '').trim()
  const dateFromNo = inferDateFromDocumentNo(no)
  const date = dateFromNo || String(doc?.document_date || '').slice(0, 10)
  if (/^PZ\//i.test(no)) {
    return `${no}|${date}|${qty}`
  }
  const prod = String(doc?.product_name || '').trim().toLowerCase()
  return `${no}|${date}|${prod}|${qty}`
}

export function isIncomingLotOperation(op) {
  if (!op) return false
  if (op.operation_type === 'przyjecie') return true
  const no = String(op.document_no || '').toUpperCase()
  return no.startsWith('PZ') || no.startsWith('MM')
}

export function normalizeK01Data(data = {}, signedBy = '') {
  const d = data || {}
  const signature = signedBy || d.podpis_przyjmujacego || ''
  return {
    stan_higieniczny_pojazdu: d.stan_higieniczny_pojazdu === 'N' ? 'N' : 'P',
    wybarwienie_zapach_brak_uszkodzen: d.wybarwienie_zapach_brak_uszkodzen === 'N' ? 'N' : 'P',
    brak_zgnilizny_zaplesnienia_zagrzybienia: d.brak_zgnilizny_zaplesnienia_zagrzybienia === 'N' ? 'N' : 'P',
    podpis_przyjmujacego: signature,
    auto_source: d.auto_source || 'przyjecie'
  }
}

export function buildK01DocFromLot(lot, operation, options = {}) {
  const op = operation || {}
  const date = resolveDocumentIssueDate(
    op.operation_date || lot.production_date || lot.created_at || '',
    op.document_no || ''
  ) || String(lot.production_date || lot.created_at || '').slice(0, 10)
  const rawName = options.rawProductName || lot.raw_product_name || ''
  const catalogName = lot.products?.name || lot.product_name || ''
  const productName = intakeProductDisplayName(rawName || catalogName)
  const signature = options.defaultSignature || ''
  return {
    id: `K01-syn-${lot.id}`,
    synthetic: true,
    document_type: 'K01',
    lot_id: lot.id,
    operation_id: lot.source_operation_id || op.id || null,
    document_date: date,
    product_name: productName,
    lot_no: lot.lot_no || '',
    supplier_name: options.supplierName || null,
    document_no: op.document_no || `K01/${lot.lot_no || lot.id}`,
    chamber_code: lot.chamber?.code || '',
    qty: Number(lot.initial_qty || lot.remaining_qty || 0),
    status: 'P',
    data: normalizeK01Data({}, signature),
    signed_by_operator: signature || null,
    document_version: 'I/2024',
    created_at: lot.created_at || date
  }
}

/**
 * Tworzy brakujące K01 dla partii z operacji przyjęcia (PZ/MM).
 */
export function buildSyntheticK01DocsFromTrace(trace = {}, haccpDocs = [], options = {}) {
  const { lots = [], operations = [], itemsByLotId = null } = trace
  const opMap = new Map((operations || []).map(o => [o.id, o]))
  const existingLotIds = new Set(
    (haccpDocs || [])
      .filter(d => d.document_type === 'K01' && d.lot_id)
      .map(d => d.lot_id)
  )
  const existingLotNos = new Set(
    (haccpDocs || [])
      .filter(d => d.document_type === 'K01' && d.lot_no)
      .map(d => d.lot_no)
  )
  const existingLineKeys = new Set(
    (haccpDocs || [])
      .filter(d => d.document_type === 'K01')
      .map(k01LineDedupeKey)
  )

  const result = []
  const pendingLineKeys = new Set()
  for (const lot of lots || []) {
    const op = opMap.get(lot.source_operation_id)
    if (!isIncomingLotOperation(op)) continue
    if (existingLotIds.has(lot.id)) continue
    if (lot.lot_no && existingLotNos.has(lot.lot_no)) continue
    const draft = buildK01DocFromLot(lot, op, {
      ...options,
      rawProductName: itemsByLotId?.get?.(lot.id) || options.rawProductName || null
    })
    const lineKey = k01LineDedupeKey(draft)
    if (existingLineKeys.has(lineKey) || pendingLineKeys.has(lineKey)) continue
    pendingLineKeys.add(lineKey)
    result.push(draft)
  }

  return result.sort((a, b) => String(a.document_date).localeCompare(String(b.document_date)))
}

/** Poprawia K01 przyjęć: usuwa „pulpa” gdy w PZ/Excelu była tylko porzeczka/malina świeża. */
export async function repairK01IntakeProductNames(client, { lotIds = null, onProgress } = {}) {
  if (!client) return 0
  onProgress?.('Sprawdzanie nazw surowca na K01…')
  let query = client
    .from('haccp_documents')
    .select('id, product_name, lot_id')
    .eq('document_type', 'K01')
    .ilike('product_name', '%pulpa%')
  if (lotIds?.length) query = query.in('lot_id', lotIds)
  const { data: docs, error } = await query.limit(5000)
  if (error) throw error
  if (!docs?.length) return 0

  const ids = docs.map(d => d.lot_id).filter(Boolean)
  const rawByLot = new Map()
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    const { data: items, error: itemErr } = await client
      .from('operation_items')
      .select('lot_id, raw_product_name')
      .in('lot_id', chunk)
    if (itemErr) throw itemErr
    for (const item of items || []) {
      if (item.lot_id && item.raw_product_name) rawByLot.set(item.lot_id, item.raw_product_name)
    }
  }

  let fixed = 0
  for (const doc of docs) {
    const raw = rawByLot.get(doc.lot_id)
    if (!raw || isPulpaProductName(raw)) continue
    const nextName = intakeProductDisplayName(raw)
    if (!nextName || nextName === doc.product_name) continue
    const { error: updErr } = await client.from('haccp_documents').update({ product_name: nextName }).eq('id', doc.id)
    if (updErr) throw updErr
    fixed += 1
  }
  return fixed
}

export function buildK01InsertPayload(doc) {
  const signature = doc.signed_by_operator || doc.data?.podpis_przyjmujacego || null
  return {
    document_type: 'K01',
    lot_id: doc.lot_id || null,
    operation_id: doc.operation_id || null,
    document_date: doc.document_date,
    product_name: doc.product_name,
    lot_no: doc.lot_no,
    supplier_name: doc.supplier_name || null,
    document_no: doc.document_no || null,
    chamber_code: doc.chamber_code || null,
    qty: doc.qty || 0,
    status: doc.status || 'P',
    data: normalizeK01Data(doc.data || {}, signature || ''),
    signed_by_operator: signature,
    document_version: doc.document_version || 'I/2024'
  }
}

export function buildK01FromReceipt({
  lotId,
  operationId,
  documentDate,
  productName,
  lotNo,
  supplierName,
  documentNo,
  chamberCode,
  qty,
  signedBy = ''
}) {
  return buildK01InsertPayload({
    lot_id: lotId,
    operation_id: operationId,
    document_date: documentDate,
    product_name: productName,
    lot_no: lotNo,
    supplier_name: supplierName,
    document_no: documentNo,
    chamber_code: chamberCode || '',
    qty,
    status: 'P',
    signed_by_operator: signedBy || null,
    data: normalizeK01Data({ auto_source: 'import' }, signedBy || '')
  })
}
