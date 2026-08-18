/**
 * Magazyn wartości (raport Excel FIFO) — trwały zapis w Supabase.
 * Osobne od HACCP: operations, lots, fifo_allocations.
 */
import { warehouseValueDedupKey } from './reportExcelStore'
import {
  classifyOperation,
  resolveDocumentIssueDate,
  normalizeDocumentNo,
  isMmDocument
} from './excelImport'
import { EXCEL_REPORT_VERSION, resolveStockValueMovementDate } from './monthlyStockValueFromExcel'

export const WAREHOUSE_VALUE_STORE_VERSION = '1.5'
const INSERT_CHUNK = 250
const FETCH_PAGE_SIZE = 3000
const FETCH_CONCURRENCY = 4
const LINE_SELECT =
  'id, batch_id, document_type, document_no, issue_date, qty, unit_net_price, product_name, row_no'

/** Cache sesji — unika ponownego pobierania tysięcy wierszy przy powrocie na zakładkę. */
let sessionLinesCache = null

export function invalidateWarehouseValueLinesCache() {
  sessionLinesCache = null
}

function cacheKey(lineCount, batchCount) {
  return `${lineCount}:${batchCount}`
}

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

function resolveWarehouseValueIssueDate(row, documentNo) {
  const operation = classifyOperation(row.documentType, documentNo)
  if (operation === 'pominiete_mm') return ''
  const opKind = operation === 'sprzedaz' ? 'sprzedaz' : 'przyjecie'
  return resolveStockValueMovementDate(row.issueDate, documentNo, opKind)
    || resolveDocumentIssueDate(row.issueDate, documentNo)
    || String(row.issueDate || '').slice(0, 10)
}

function excelRowToInsert(row, batchId) {
  const documentNo = normalizeDocumentNo(row.documentNo) || row.documentNo
  if (!documentNo) return { payload: null, reason: 'no_doc' }
  const operation = classifyOperation(row.documentType, documentNo)
  if (operation === 'pominiete_mm' || !row.productName || !Number(row.qty)) {
    return { payload: null, reason: 'invalid' }
  }

  const issueDate = resolveWarehouseValueIssueDate(row, documentNo)
  if (!issueDate || issueDate === '0000-01-01') return { payload: null, reason: 'no_date' }

  const rowForDedup = { ...row, documentNo, issueDate }
  const dedupKey = warehouseValueDedupKey(rowForDedup)
  if (!dedupKey) return { payload: null, reason: 'no_dedup' }

  const price = Number(row.unitNetPrice)
  return {
    payload: {
      batch_id: batchId,
      dedup_key: dedupKey,
      document_type: row.documentType || null,
      document_no: documentNo,
      issue_date: issueDate,
      qty: Math.abs(Number(row.qty) || 0),
      unit_net_price: price > 0 ? price : null,
      product_name: String(row.productName || '').trim(),
      row_no: row.rowNo ?? null
    },
    reason: null
  }
}

export async function fetchAllWarehouseValueLines(client, { onProgress, forceRefresh = false } = {}) {
  if (!client) return []

  const { count, error: countErr } = await client
    .from('warehouse_value_lines')
    .select('id', { count: 'exact', head: true })
  if (countErr) throw countErr

  const total = count || 0
  onProgress?.(0, total)
  if (total === 0) {
    sessionLinesCache = { key: '0:0', rows: [], fetchedAt: Date.now() }
    return []
  }

  const batchCountRes = await client
    .from('warehouse_value_batches')
    .select('id', { count: 'exact', head: true })
  if (batchCountRes.error) throw batchCountRes.error
  const batchCount = batchCountRes.count || 0
  const key = cacheKey(total, batchCount)

  if (
    !forceRefresh &&
    sessionLinesCache?.key === key &&
    sessionLinesCache.rows?.length === total &&
    Date.now() - sessionLinesCache.fetchedAt < 120_000
  ) {
    onProgress?.(total, total)
    return sessionLinesCache.rows
  }

  const pageCount = Math.ceil(total / FETCH_PAGE_SIZE)
  const pages = new Array(pageCount)
  let loaded = 0

  async function fetchPage(pageIndex) {
    const from = pageIndex * FETCH_PAGE_SIZE
    const to = from + FETCH_PAGE_SIZE - 1
    const { data, error } = await client
      .from('warehouse_value_lines')
      .select(LINE_SELECT)
      .order('issue_date', { ascending: true })
      .order('row_no', { ascending: true, nullsFirst: false })
      .order('document_no', { ascending: true })
      .range(from, to)
    if (error) throw error
    loaded += data?.length || 0
    onProgress?.(loaded, total)
    return { pageIndex, data: data || [] }
  }

  for (let start = 0; start < pageCount; start += FETCH_CONCURRENCY) {
    const chunk = []
    for (let p = start; p < Math.min(start + FETCH_CONCURRENCY, pageCount); p++) {
      chunk.push(fetchPage(p))
    }
    const results = await Promise.all(chunk)
    for (const { pageIndex, data } of results) {
      pages[pageIndex] = data
    }
  }

  const rows = pages.flat().map(lineToExcelRow)
  sessionLinesCache = { key, rows, fetchedAt: Date.now() }
  return rows
}

function yieldToUi() {
  return new Promise(resolve => setTimeout(resolve, 0))
}

async function insertWarehouseValueChunk(client, chunk) {
  const { data: inserted, error } = await client
    .from('warehouse_value_lines')
    .upsert(chunk, { onConflict: 'dedup_key', ignoreDuplicates: true })
    .select('id')
  if (error) throw error
  const chunkAdded = inserted?.length || 0
  return { added: chunkAdded, duplicates: chunk.length - chunkAdded }
}

/**
 * Wstawia brakujące linie z Excela (upsert — pomija istniejące dedup_key).
 * @param {Function} [opts.onProgress] — ({ phase, done, total, added, message })
 */
export async function syncMissingWarehouseValueFromParsedFiles(client, parsedFiles, { uploadedBy = '', onProgress } = {}) {
  if (!client) throw new Error('Brak połączenia z Supabase.')

  const fileList = parsedFiles || []
  const allRows = fileList.flatMap(f => f.rows || [])
  const totalRows = allRows.length
  onProgress?.({ phase: 'prepare', done: 0, total: totalRows, added: 0, message: 'Przygotowanie wierszy…' })

  const primaryName = fileList[0]?.fileName || 'sync.xlsx'
  const { data: batch, error: batchErr } = await client
    .from('warehouse_value_batches')
    .insert({
      file_name: `${primaryName} (dopisanie brakujących)`,
      uploaded_by: uploadedBy || null,
      row_count: 0,
      duplicate_count: 0,
      engine_version: EXCEL_REPORT_VERSION,
      notes: 'Synchronizacja — dopisanie linii brakujących w bazie'
    })
    .select('id')
    .single()
  if (batchErr) throw batchErr

  const batchId = batch.id
  const payloads = []
  let skippedNoDate = 0
  let skippedInvalid = 0

  for (let i = 0; i < allRows.length; i++) {
    const { payload, reason } = excelRowToInsert(allRows[i], batchId)
    if (payload) payloads.push(payload)
    else if (reason === 'no_date') skippedNoDate += 1
    else if (reason === 'invalid') skippedInvalid += 1

    if (i > 0 && i % 250 === 0) {
      onProgress?.({
        phase: 'prepare',
        done: i,
        total: totalRows,
        added: 0,
        message: `Przygotowanie ${i.toLocaleString('pl-PL')} / ${totalRows.toLocaleString('pl-PL')}…`
      })
      await yieldToUi()
    }
  }

  const chunkCount = Math.max(1, Math.ceil(payloads.length / INSERT_CHUNK))
  let totalAdded = 0
  let totalDuplicates = 0

  onProgress?.({
    phase: 'upload',
    done: 0,
    total: chunkCount,
    added: 0,
    message: `Zapis do Supabase (0 / ${chunkCount} paczek)…`
  })

  for (let i = 0; i < payloads.length; i += INSERT_CHUNK) {
    const chunk = payloads.slice(i, i + INSERT_CHUNK)
    const { added, duplicates } = await insertWarehouseValueChunk(client, chunk)
    totalAdded += added
    totalDuplicates += duplicates
    const packNo = Math.floor(i / INSERT_CHUNK) + 1
    onProgress?.({
      phase: 'upload',
      done: packNo,
      total: chunkCount,
      added: totalAdded,
      message: `Zapis paczki ${packNo}/${chunkCount} · dopisano ${totalAdded.toLocaleString('pl-PL')} wierszy`
    })
    await yieldToUi()
  }

  await client
    .from('warehouse_value_batches')
    .update({ row_count: totalAdded, duplicate_count: totalDuplicates })
    .eq('id', batchId)

  if (totalAdded === 0) {
    await client.from('warehouse_value_batches').delete().eq('id', batchId)
  } else {
    invalidateWarehouseValueLinesCache()
  }

  onProgress?.({
    phase: 'done',
    done: chunkCount,
    total: chunkCount,
    added: totalAdded,
    message: `Gotowe: +${totalAdded.toLocaleString('pl-PL')} wierszy`
  })

  return {
    results: [{
      fileName: primaryName,
      added: totalAdded,
      duplicates: totalDuplicates,
      skippedNoDate,
      skippedInvalid,
      prepared: payloads.length,
      batchId: totalAdded > 0 ? batchId : null
    }],
    totalAdded,
    totalDuplicates,
    totalSkippedNoDate: skippedNoDate,
    totalCandidates: payloads.length
  }
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

export async function fetchWarehouseValueMeta(client) {
  if (!client) {
    return { batchCount: 0, lineCount: 0, batches: [], snapshots: [] }
  }
  const [stats, snapshots] = await Promise.all([
    fetchWarehouseValueStats(client),
    fetchWarehouseValueSnapshots(client)
  ])
  return {
    batchCount: stats.batchCount,
    lineCount: stats.lineCount,
    batches: stats.batches,
    snapshots
  }
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
    let skippedNoDate = 0
    let skippedInvalid = 0
    const payloads = []
    for (const r of rows || []) {
      const { payload, reason } = excelRowToInsert(r, batchId)
      if (payload) payloads.push(payload)
      else if (reason === 'no_date') skippedNoDate += 1
      else if (reason === 'invalid' && (r.productName || r.qty)) skippedInvalid += 1
    }
    let added = 0
    let duplicates = 0

    for (let i = 0; i < payloads.length; i += INSERT_CHUNK) {
      const chunk = payloads.slice(i, i + INSERT_CHUNK)
      const { added: chunkAdded, duplicates: chunkDup } = await insertWarehouseValueChunk(client, chunk)
      added += chunkAdded
      duplicates += chunkDup
    }

    await client
      .from('warehouse_value_batches')
      .update({ row_count: added, duplicate_count: duplicates })
      .eq('id', batchId)

    if (added === 0) {
      await client.from('warehouse_value_batches').delete().eq('id', batchId)
    }

    results.push({
      fileName: name,
      added,
      duplicates,
      skippedNoDate,
      skippedInvalid,
      parsedRows: (rows || []).length,
      batchId: added > 0 ? batchId : null
    })
  }

  const totalAdded = results.reduce((s, r) => s + r.added, 0)
  const totalDup = results.reduce((s, r) => s + r.duplicates, 0)
  const totalSkippedNoDate = results.reduce((s, r) => s + (r.skippedNoDate || 0), 0)
  if (totalAdded > 0) invalidateWarehouseValueLinesCache()
  return { results, totalAdded, totalDuplicates: totalDup, totalSkippedNoDate }
}

export async function deleteWarehouseValueBatch(client, batchId) {
  if (!client || !batchId) return
  const { error } = await client.from('warehouse_value_batches').delete().eq('id', batchId)
  if (error) throw error
  invalidateWarehouseValueLinesCache()
}

export async function clearAllWarehouseValueData(client) {
  if (!client) throw new Error('Brak połączenia z Supabase.')
  await client.from('warehouse_value_snapshots').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await client.from('warehouse_value_batches').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  invalidateWarehouseValueLinesCache()
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

export async function fetchWarehouseValueSnapshotByDate(client, asOfDate) {
  if (!client || !asOfDate) return null
  const { data, error } = await client
    .from('warehouse_value_snapshots')
    .select('id, as_of_date, year_month, report_title, totals, rows, diagnostics, saved_at, saved_by')
    .eq('as_of_date', String(asOfDate).slice(0, 10))
    .maybeSingle()
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
