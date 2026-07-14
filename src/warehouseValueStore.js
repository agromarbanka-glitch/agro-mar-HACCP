/**
 * Magazyn wartości (raport Excel FIFO) — trwały zapis w Supabase.
 * Osobne od HACCP: operations, lots, fifo_allocations.
 */
import { excelRowDedupKey } from './reportExcelStore'
import {
  classifyOperation,
  resolveDocumentIssueDate,
  normalizeDocumentNo,
  isMmDocument
} from './excelImport'
import { EXCEL_REPORT_VERSION } from './monthlyStockValueFromExcel'

export const WAREHOUSE_VALUE_STORE_VERSION = '1.0'
const INSERT_CHUNK = 400

function lineToExcelRow(stored) {
  return {
    rowNo: stored.row_no,
    documentType: stored.document_type,
    documentNo: stored.document_no,
    issueDate: stored.issue_date,
    qty: stored.qty,
    unitNetPrice: stored.unit_net_price,
    productName: stored.product_name,
    _lineId: stored.id,
    _batchId: stored.batch_id
  }
}

function excelRowToInsert(row, batchId) {
  const dedupKey = excelRowDedupKey(row)
  if (!dedupKey) return null
  const documentNo = normalizeDocumentNo(row.documentNo) || row.documentNo
  const issueDate = resolveDocumentIssueDate(row.issueDate, documentNo) || String(row.issueDate || '').slice(0, 10)
  if (!issueDate || issueDate === '0000-01-01') return null
  const price = Number(row.unitNetPrice)
  return {
    batch_id: batchId,
    dedup_key: dedupKey,
    document_type: row.documentType || null,
    document_no: documentNo,
    issue_date: issueDate,
    qty: Math.abs(Number(row.qty) || 0),
    unit_net_price: price > 0 ? price : null,
    product_name: String(row.productName || '').trim(),
    row_no: row.rowNo ?? null
  }
}

export async function fetchAllWarehouseValueLines(client) {
  if (!client) return []
  const all = []
  let from = 0
  const pageSize = 2000
  while (true) {
    const { data, error } = await client
      .from('warehouse_value_lines')
      .select('id, batch_id, document_type, document_no, issue_date, qty, unit_net_price, product_name, row_no')
      .order('issue_date', { ascending: true })
      .order('document_no', { ascending: true })
      .range(from, from + pageSize - 1)
    if (error) throw error
    if (!data?.length) break
    all.push(...data)
    if (data.length < pageSize) break
    from += pageSize
  }
  return all.map(lineToExcelRow)
}

export async function fetchWarehouseValueBatches(client) {
  if (!client) return []
  const { data, error } = await client
    .from('warehouse_value_batches')
    .select('id, file_name, uploaded_at, uploaded_by, row_count, duplicate_count, engine_version, notes')
    .order('uploaded_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function fetchWarehouseValueStats(client) {
  const [batches, lineCountRes] = await Promise.all([
    fetchWarehouseValueBatches(client),
    client.from('warehouse_value_lines').select('id', { count: 'exact', head: true })
  ])
  if (lineCountRes.error) throw lineCountRes.error
  return {
    batchCount: batches.length,
    lineCount: lineCountRes.count || 0,
    batches
  }
}

/**
 * Dokleja wiersze z pliku(ów) Excel; pomija duplikaty wg dedup_key.
 * @returns {{ added: number, duplicates: number, batchId: string|null, fileName: string }}
 */
export async function appendWarehouseValueFromParsedFiles(client, parsedFiles, { uploadedBy = '' } = {}) {
  if (!client) throw new Error('Brak połączenia z Supabase.')
  const results = []

  for (const { fileName, rows } of parsedFiles || []) {
    const name = fileName || 'import.xlsx'
    const { data: batch, error: batchErr } = await client
      .from('warehouse_value_batches')
      .insert({
        file_name: name,
        uploaded_by: uploadedBy || null,
        row_count: 0,
        duplicate_count: 0,
        engine_version: EXCEL_REPORT_VERSION,
        notes: 'Import Excel — magazyn wartości (osobno od HACCP)'
      })
      .select('id')
      .single()
    if (batchErr) throw batchErr

    const batchId = batch.id
    const payloads = (rows || []).map(r => excelRowToInsert(r, batchId)).filter(Boolean)
    let added = 0
    let duplicates = 0

    for (let i = 0; i < payloads.length; i += INSERT_CHUNK) {
      const chunk = payloads.slice(i, i + INSERT_CHUNK)
      const { data: inserted, error } = await client
        .from('warehouse_value_lines')
        .upsert(chunk, { onConflict: 'dedup_key', ignoreDuplicates: true })
        .select('id')
      if (error) throw error
      const chunkAdded = inserted?.length || 0
      added += chunkAdded
      duplicates += chunk.length - chunkAdded
    }

    await client
      .from('warehouse_value_batches')
      .update({ row_count: added, duplicate_count: duplicates })
      .eq('id', batchId)

    if (added === 0) {
      await client.from('warehouse_value_batches').delete().eq('id', batchId)
    }

    results.push({ fileName: name, added, duplicates, batchId: added > 0 ? batchId : null })
  }

  const totalAdded = results.reduce((s, r) => s + r.added, 0)
  const totalDup = results.reduce((s, r) => s + r.duplicates, 0)
  return { results, totalAdded, totalDuplicates: totalDup }
}

export async function deleteWarehouseValueBatch(client, batchId) {
  if (!client || !batchId) return
  const { error } = await client.from('warehouse_value_batches').delete().eq('id', batchId)
  if (error) throw error
}

export async function clearAllWarehouseValueData(client) {
  if (!client) throw new Error('Brak połączenia z Supabase.')
  await client.from('warehouse_value_snapshots').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await client.from('warehouse_value_batches').delete().neq('id', '00000000-0000-0000-0000-000000000000')
}

export async function saveWarehouseValueSnapshot(client, report, { savedBy = '' } = {}) {
  if (!client) throw new Error('Brak połączenia z Supabase.')
  if (!report?.asOfDate) throw new Error('Brak daty stanu do zapisu snapshotu.')

  const payload = {
    as_of_date: String(report.asOfDate).slice(0, 10),
    year_month: report.yearMonth || String(report.asOfDate).slice(0, 7),
    engine_version: EXCEL_REPORT_VERSION,
    report_title: report.reportTitle || '',
    totals: report.totals || {},
    rows: report.rows || [],
    diagnostics: report.diagnostics || {},
    saved_by: savedBy || null,
    saved_at: new Date().toISOString()
  }

  const { data, error } = await client
    .from('warehouse_value_snapshots')
    .upsert(payload, { onConflict: 'as_of_date' })
    .select('id, as_of_date, saved_at')
    .single()
  if (error) throw error
  return data
}

export async function fetchWarehouseValueSnapshots(client, limit = 24) {
  if (!client) return []
  const { data, error } = await client
    .from('warehouse_value_snapshots')
    .select('id, as_of_date, year_month, report_title, totals, saved_at, saved_by')
    .order('as_of_date', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}

export async function deleteWarehouseValueSnapshot(client, snapshotId) {
  if (!client || !snapshotId) return
  const { error } = await client.from('warehouse_value_snapshots').delete().eq('id', snapshotId)
  if (error) throw error
}

/** Podsumowanie wiersza do listy partii (bez ujawniania dedup_key). */
export function summarizeBatchRow(batch) {
  const at = batch.uploaded_at ? new Date(batch.uploaded_at).toLocaleString('pl-PL') : '—'
  return `${batch.file_name} · ${batch.row_count} wierszy${batch.duplicate_count ? ` (${batch.duplicate_count} duplikatów pominięto)` : ''} · ${at}`
}
