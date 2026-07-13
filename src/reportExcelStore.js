/**
 * Trwałe przechowywanie wierszy Excel dla raportu magazynowego (localStorage).
 * Łączenie partii wgrywania, deduplikacja operacji, ręczne usuwanie.
 */
import {
  classifyOperation,
  resolveDocumentIssueDate,
  normalizeDocumentNo,
  isMmDocument
} from './excelImport'

export const REPORT_EXCEL_STORE_VERSION = 1
const STORAGE_KEY = 'agro-mar-report-excel-v1'

function newLineId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `line-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function newBatchId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `batch-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function roundQty(qty) {
  return Math.round(Math.abs(Number(qty) || 0) * 1000) / 1000
}

function normalizeProduct(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Klucz deduplikacji: ta sama operacja + produkt + ilość + data. */
export function excelRowDedupKey(row) {
  if (!row?.productName || !Number(row.qty)) return null
  if (isMmDocument(row.documentType, row.documentNo)) return null
  const documentNo = normalizeDocumentNo(row.documentNo)
  if (!documentNo) return null
  const operation = classifyOperation(row.documentType, documentNo)
  if (operation === 'pominiete_mm') return null
  const issueDate = resolveDocumentIssueDate(row.issueDate, documentNo)
  if (!issueDate) return null
  const product = normalizeProduct(row.productName)
  const qty = roundQty(row.qty)
  return `${operation}|${documentNo}|${product}|${qty}|${issueDate}`
}

function compactRow(row, batchId, lineId) {
  return {
    lineId,
    batchId,
    rowNo: row.rowNo ?? null,
    documentType: row.documentType,
    documentNo: row.documentNo,
    issueDate: row.issueDate,
    qty: row.qty,
    unitNetPrice: row.unitNetPrice ?? null,
    productName: row.productName
  }
}

function toExcelRow(stored) {
  return {
    rowNo: stored.rowNo,
    documentType: stored.documentType,
    documentNo: stored.documentNo,
    issueDate: stored.issueDate,
    qty: stored.qty,
    unitNetPrice: stored.unitNetPrice,
    productName: stored.productName,
    _lineId: stored.lineId,
    _batchId: stored.batchId
  }
}

export function emptyReportExcelStore() {
  return { version: REPORT_EXCEL_STORE_VERSION, batches: [], rows: [] }
}

export function loadReportExcelStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyReportExcelStore()
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.batches) || !Array.isArray(parsed.rows)) {
      return emptyReportExcelStore()
    }
    return {
      version: parsed.version || REPORT_EXCEL_STORE_VERSION,
      batches: parsed.batches,
      rows: parsed.rows
    }
  } catch {
    return emptyReportExcelStore()
  }
}

export function saveReportExcelStore(store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
    return true
  } catch (err) {
    console.error('reportExcelStore save failed', err)
    return false
  }
}

export function getStoredExcelRows(store) {
  return (store?.rows || []).map(toExcelRow)
}

export function getStoredFileNames(store) {
  return (store?.batches || []).map(b => b.fileName).filter(Boolean)
}

/**
 * Dodaje wiersze z nowego wgrywania; pomija duplikaty względem istniejących danych.
 * @returns {{ store, results: Array<{ fileName, added, duplicates, batchId|null }> }}
 */
export function appendExcelRowsToStore(store, parsedFiles) {
  const next = {
    version: REPORT_EXCEL_STORE_VERSION,
    batches: [...(store?.batches || [])],
    rows: [...(store?.rows || [])]
  }
  const existingKeys = new Set(
    next.rows.map(r => excelRowDedupKey(toExcelRow(r))).filter(Boolean)
  )
  const results = []

  for (const { fileName, rows } of parsedFiles || []) {
    const batchId = newBatchId()
    let added = 0
    let duplicates = 0
    const batchKeys = new Set()

    for (const row of rows || []) {
      const key = excelRowDedupKey(row)
      if (!key) continue
      if (existingKeys.has(key) || batchKeys.has(key)) {
        duplicates += 1
        continue
      }
      batchKeys.add(key)
      existingKeys.add(key)
      const lineId = newLineId()
      next.rows.push(compactRow(row, batchId, lineId))
      added += 1
    }

    if (added > 0) {
      next.batches.push({
        id: batchId,
        fileName: fileName || 'plik.xlsx',
        uploadedAt: new Date().toISOString(),
        rowCount: added,
        duplicateCount: duplicates
      })
    }

    results.push({ fileName: fileName || 'plik.xlsx', added, duplicates, batchId: added > 0 ? batchId : null })
  }

  return { store: next, results }
}

export function removeBatchFromStore(store, batchId) {
  const id = String(batchId || '')
  if (!id) return store
  return {
    ...store,
    batches: (store.batches || []).filter(b => b.id !== id),
    rows: (store.rows || []).filter(r => r.batchId !== id)
  }
}

export function removeLineFromStore(store, lineId) {
  const id = String(lineId || '')
  if (!id) return store
  const removed = (store.rows || []).find(r => r.lineId === id)
  if (!removed) return store

  const nextRows = store.rows.filter(r => r.lineId !== id)
  const batchStillHasRows = nextRows.some(r => r.batchId === removed.batchId)
  const nextBatches = batchStillHasRows
    ? store.batches.map(b => {
        if (b.id !== removed.batchId) return b
        const count = nextRows.filter(r => r.batchId === b.id).length
        return { ...b, rowCount: count }
      })
    : store.batches.filter(b => b.id !== removed.batchId)

  return { ...store, batches: nextBatches, rows: nextRows }
}

/** Grupy wierszy o tym samym kluczu operacji (potencjalne duplikaty w magazynie danych). */
export function findDuplicateGroups(store) {
  const byKey = new Map()
  for (const stored of store?.rows || []) {
    const row = toExcelRow(stored)
    const key = excelRowDedupKey(row)
    if (!key) continue
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key).push(row)
  }
  return [...byKey.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([key, rows]) => ({ key, rows }))
    .sort((a, b) => String(a.rows[0]?.issueDate || '').localeCompare(String(b.rows[0]?.issueDate || '')))
}

export function formatRowSummary(row) {
  const docNo = normalizeDocumentNo(row.documentNo) || row.documentNo || '—'
  const op = classifyOperation(row.documentType, row.documentNo)
  const opLabel = op === 'sprzedaz' ? 'WZ' : op === 'przyjecie' ? 'PZ' : String(row.documentType || '')
  const qty = roundQty(row.qty)
  return `${opLabel} ${docNo} · ${row.productName || '—'} · ${qty} kg · ${row.issueDate || '—'}`
}

export function clearReportExcelStore() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch (_) {}
  return emptyReportExcelStore()
}
