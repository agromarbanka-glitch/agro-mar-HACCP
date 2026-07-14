/**
 * Trwałe przechowywanie wierszy Excel dla raportu magazynowego.
 * IndexedDB (duże pliki) + fallback localStorage.
 * Łączenie partii, deduplikacja operacji, ręczne usuwanie.
 */
import {
  classifyOperation,
  resolveDocumentIssueDate,
  normalizeDocumentNo,
  isMmDocument
} from './excelImport'
import { normalizeFifoProductKey } from './k03Engine'

export const REPORT_EXCEL_STORE_VERSION = 2
const LS_KEY = 'agro-mar-report-excel-v1'
const IDB_NAME = 'agro-mar-report'
const IDB_STORE = 'excel-batches'
const IDB_KEY = 'main'

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

/** Ta sama normalizacja co w raporcie + bez polskich znaków (szypułką = szypulka). */
export function normalizeProductKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/\s+/g, ' ')
}

function rowOperation(row) {
  if (!row?.productName || !Number(row.qty)) return null
  if (isMmDocument(row.documentType, row.documentNo)) return null
  const documentNo = normalizeDocumentNo(row.documentNo)
  if (!documentNo) return null
  const operation = classifyOperation(row.documentType, documentNo)
  if (operation === 'pominiete_mm') return null
  return { operation, documentNo, product: normalizeProductKey(row.productName), qty: roundQty(row.qty) }
}

/**
 * Klucz deduplikacji — bez daty (ta sama operacja w dwóch eksportach Excel
 * często ma inną datę w kolumnie vs. datę z numeru dokumentu).
 * operation | nr dokumentu | produkt | ilość
 */
export function excelRowDedupKey(row) {
  const op = rowOperation(row)
  if (!op) return null
  return `${op.operation}|${op.documentNo}|${op.product}|${op.qty}`
}

/** Klucz ścisły (z datą) — do wykrywania duplikatów w pamięci. */
export function excelRowDedupKeyStrict(row) {
  const op = rowOperation(row)
  if (!op) return null
  const issueDate = resolveDocumentIssueDate(row.issueDate, op.documentNo)
  if (!issueDate) return null
  return `${op.operation}|${op.documentNo}|${op.product}|${op.qty}|${issueDate}`
}

/**
 * Klucz zapisu w Supabase (magazyn wartości): data + nr wiersza Excel.
 * Nie scala wielu linii tego samego WZ/PZ (ten sam dok.+produkt+ilość) — to psuło FIFO.
 * Przy ponownym imporcie tego samego pliku duplikat i tak się nie wklei (ten sam rowNo).
 */
export function warehouseValueDedupKey(row) {
  const strict = excelRowDedupKeyStrict(row)
  if (!strict) return null
  return `${strict}|r${row.rowNo ?? ''}`
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

function openIdb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexedDB unavailable'))
      return
    }
    const req = indexedDB.open(IDB_NAME, 1)
    req.onerror = () => reject(req.error)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE)
    }
    req.onsuccess = () => resolve(req.result)
  })
}

async function idbGet() {
  const db = await openIdb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly')
    const req = tx.objectStore(IDB_STORE).get(IDB_KEY)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result || null)
    tx.oncomplete = () => db.close()
  })
}

async function idbSet(store) {
  const db = await openIdb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).put(store, IDB_KEY)
    tx.oncomplete = () => { db.close(); resolve(true) }
    tx.onerror = () => reject(tx.error)
  })
}

export function loadReportExcelStore() {
  try {
    const raw = localStorage.getItem(LS_KEY)
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

/** Wczytaj z IndexedDB (preferowane) lub localStorage; usuń duplikaty. */
export async function loadReportExcelStoreAsync() {
  let store = emptyReportExcelStore()
  try {
    const fromIdb = await idbGet()
    if (fromIdb?.rows?.length) store = fromIdb
  } catch (_) {}

  if (!store.rows?.length) {
    const fromLs = loadReportExcelStore()
    if (fromLs.rows?.length) store = fromLs
  }

  const { store: cleaned, removed } = sanitizeStoreDuplicates(store)
  if (removed > 0) await saveReportExcelStoreAsync(cleaned)
  return cleaned
}

export function saveReportExcelStore(store) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(store))
    return true
  } catch (err) {
    console.error('reportExcelStore localStorage save failed', err)
    return false
  }
}

export async function saveReportExcelStoreAsync(store) {
  const payload = { ...store, version: REPORT_EXCEL_STORE_VERSION }
  try {
    await idbSet(payload)
    try { localStorage.removeItem(LS_KEY) } catch (_) {}
    return { ok: true, backend: 'indexeddb' }
  } catch (err) {
    console.warn('IndexedDB save failed, fallback localStorage', err)
    const ok = saveReportExcelStore(payload)
    return { ok, backend: ok ? 'localStorage' : null, error: ok ? null : err }
  }
}

/** Usuwa duplikaty wg klucza bez daty (zostawia pierwszą kopię). */
export function sanitizeStoreDuplicates(store) {
  const seen = new Set()
  const rows = []
  let removed = 0
  for (const stored of store?.rows || []) {
    const key = excelRowDedupKey(toExcelRow(stored))
    if (!key) continue
    if (seen.has(key)) { removed += 1; continue }
    seen.add(key)
    rows.push(stored)
  }
  if (!removed) return { store, removed: 0 }

  const batchCounts = new Map()
  for (const r of rows) batchCounts.set(r.batchId, (batchCounts.get(r.batchId) || 0) + 1)

  const batches = (store.batches || [])
    .map(b => ({ ...b, rowCount: batchCounts.get(b.id) || 0 }))
    .filter(b => b.rowCount > 0)

  return {
    store: { version: REPORT_EXCEL_STORE_VERSION, batches, rows },
    removed
  }
}

export function getStoredExcelRows(store) {
  return (store?.rows || []).map(toExcelRow)
}

export function getStoredFileNames(store) {
  return (store?.batches || []).map(b => b.fileName).filter(Boolean)
}

export function replaceExcelRowsInStore(parsedFiles) {
  const empty = emptyReportExcelStore()
  return appendExcelRowsToStore(empty, parsedFiles)
}

/**
 * Dodaje wiersze z nowego wgrywania; pomija duplikaty względem istniejących danych.
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
      next.rows.push(compactRow(row, batchId, newLineId()))
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
        return { ...b, rowCount: nextRows.filter(r => r.batchId === b.id).length }
      })
    : store.batches.filter(b => b.id !== removed.batchId)

  return { ...store, batches: nextBatches, rows: nextRows }
}

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
  const issueDate = resolveDocumentIssueDate(row.issueDate, row.documentNo) || row.issueDate || '—'
  return `${opLabel} ${docNo} · ${row.productName || '—'} · ${roundQty(row.qty)} kg · ${issueDate}`
}

export async function clearReportExcelStore() {
  try { localStorage.removeItem(LS_KEY) } catch (_) {}
  try {
    const db = await openIdb()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).delete(IDB_KEY)
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => reject(tx.error)
    })
  } catch (_) {}
  return emptyReportExcelStore()
}

export function storeStats(store) {
  const rows = store?.rows || []
  let pz = 0
  let wz = 0
  for (const stored of rows) {
    const row = toExcelRow(stored)
    const op = classifyOperation(row.documentType, row.documentNo)
    if (op === 'przyjecie') pz += 1
    else if (op === 'sprzedaz') wz += 1
  }
  return { totalRows: rows.length, batchCount: store?.batches?.length || 0, pz, wz }
}
