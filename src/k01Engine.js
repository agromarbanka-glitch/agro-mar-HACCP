export const K01_ENGINE_VERSION = '1.0'

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
  const date = String(op.operation_date || lot.production_date || lot.created_at || '').slice(0, 10)
  const productName = lot.products?.name || lot.product_name || ''
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
  const { lots = [], operations = [] } = trace
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

  const result = []
  for (const lot of lots || []) {
    const op = opMap.get(lot.source_operation_id)
    if (!isIncomingLotOperation(op)) continue
    if (existingLotIds.has(lot.id)) continue
    if (lot.lot_no && existingLotNos.has(lot.lot_no)) continue
    result.push(buildK01DocFromLot(lot, op, options))
  }

  return result.sort((a, b) => String(a.document_date).localeCompare(String(b.document_date)))
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
