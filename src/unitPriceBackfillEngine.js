/**
 * Uzupełnianie ceny netto (unit_price_net) w już zapisanych importach
 * na podstawie ponownie wskazanego pliku Excel (bez duplikowania operacji).
 */
import { readAgromarExcel, normalizeDocumentNo, resolveDocumentIssueDate, classifyOperation } from './excelImport'

export const UNIT_PRICE_BACKFILL_VERSION = '1.0'

function roundQty(qty) {
  return Math.round(Number(qty || 0) * 1000) / 1000
}

function normalizeName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function monthFromDate(dateStr) {
  const d = String(dateStr || '').slice(0, 10)
  return d.length >= 7 ? d.slice(0, 7) : ''
}

function buildExcelPriceIndex(rows, { yearMonth, canonicalProductName } = {}) {
  const index = new Map()
  let skipped = 0
  for (const row of rows || []) {
    if (classifyOperation(row.documentType, row.documentNo) !== 'przyjecie') continue
    const docNo = normalizeDocumentNo(row.documentNo)
    const qty = roundQty(row.qty)
    const price = Number(row.unitNetPrice)
    if (!docNo || qty <= 0 || !(price > 0)) {
      skipped += 1
      continue
    }
    const issueDate = resolveDocumentIssueDate(row.issueDate, docNo)
    if (yearMonth && monthFromDate(issueDate) !== yearMonth) continue
    const productName = canonicalProductName?.(row.productName) || row.productName || ''
    const key = `${docNo}|${normalizeName(productName)}|${qty}`
    index.set(key, { price, productName: row.productName, docNo, qty, issueDate })
  }
  return { index, skipped }
}

async function loadIncomingItemsWithOps(client) {
  const selectFull = 'id, operation_id, product_id, qty, lot_id, raw_product_name, unit_price_net, operations(id, document_no, operation_date, operation_type)'
  const selectBasic = 'id, operation_id, product_id, qty, lot_id, raw_product_name, operations(id, document_no, operation_date, operation_type)'

  let res = await client
    .from('operation_items')
    .select(selectFull)
    .eq('direction', 'przychod')
    .limit(50000)

  let hasPriceColumn = true
  if (res.error && /unit_price_net|column/.test(String(res.error.message || ''))) {
    hasPriceColumn = false
    res = await client
      .from('operation_items')
      .select(selectBasic)
      .eq('direction', 'przychod')
      .limit(50000)
  }
  if (res.error) throw res.error
  return { items: res.data || [], hasPriceColumn }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 * @param {File} file
 * @param {{ yearMonth?: string, canonicalProductName?: Function, overwrite?: boolean }} opts
 */
export async function backfillUnitPricesFromExcelFile(client, file, opts = {}) {
  if (!client || !file) {
    return { updatedItems: 0, updatedLots: 0, matched: 0, skippedExcel: 0, message: 'Brak pliku lub bazy.' }
  }

  const { rows } = await readAgromarExcel(file)
  const { index, skipped: skippedExcel } = buildExcelPriceIndex(rows, opts)
  if (!index.size) {
    return {
      updatedItems: 0,
      updatedLots: 0,
      matched: 0,
      skippedExcel,
      message: opts.yearMonth
        ? `W pliku nie znaleziono pozycji PZ z ceną netto za ${opts.yearMonth}.`
        : 'W pliku nie znaleziono pozycji PZ z ceną netto.'
    }
  }

  const { items, hasPriceColumn } = await loadIncomingItemsWithOps(client)
  if (!hasPriceColumn) {
    return {
      updatedItems: 0,
      updatedLots: 0,
      matched: 0,
      skippedExcel,
      needsMigration: true,
      message: 'Brak kolumny unit_price_net w bazie – uruchom migrację supabase/2026-v44-unit-price-net.sql w Supabase SQL Editor.'
    }
  }

  const updates = []
  const lotUpdates = new Map()
  let matched = 0

  for (const item of items) {
    const op = item.operations
    if (!op) continue
    const docNo = normalizeDocumentNo(op.document_no)
    const qty = roundQty(item.qty)
    const rawName = item.raw_product_name || ''
    const canonical = opts.canonicalProductName?.(rawName) || rawName
    const key = `${docNo}|${normalizeName(canonical)}|${qty}`
    let hit = index.get(key)
    if (!hit && rawName !== canonical) {
      hit = index.get(`${docNo}|${normalizeName(rawName)}|${qty}`)
    }
    if (!hit) continue
    if (opts.yearMonth && monthFromDate(op.operation_date) !== opts.yearMonth) continue
    if (!opts.overwrite && Number(item.unit_price_net) > 0) continue

    matched += 1
    updates.push({ id: item.id, unit_price_net: hit.price, lot_id: item.lot_id })
    if (item.lot_id) lotUpdates.set(item.lot_id, hit.price)
  }

  let updatedItems = 0
  let updatedLots = 0

  for (let i = 0; i < updates.length; i += 50) {
    const chunk = updates.slice(i, i + 50)
    await Promise.all(chunk.map(u =>
      client.from('operation_items').update({ unit_price_net: u.unit_price_net }).eq('id', u.id)
    ))
    updatedItems += chunk.length
  }

  const lotIds = [...lotUpdates.keys()]
  for (let i = 0; i < lotIds.length; i += 50) {
    const chunk = lotIds.slice(i, i + 50)
    await Promise.all(chunk.map(lotId =>
      client.from('lots').update({ unit_price_net: lotUpdates.get(lotId) }).eq('id', lotId)
    ))
    updatedLots += chunk.length
  }

  return {
    updatedItems,
    updatedLots,
    matched,
    skippedExcel,
    excelLines: index.size,
    message: matched
      ? `Z pliku „${file.name}”: dopasowano ${matched} pozycji, zaktualizowano ${updatedItems} wpisów i ${updatedLots} partii.`
      : `Plik „${file.name}” wczytany (${index.size} pozycji z ceną), ale brak dopasowania do zapisanych PZ${opts.yearMonth ? ` za ${opts.yearMonth}` : ''}. Sprawdź nr dokumentu / produkt / ilość.`
  }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 * @param {File[]} files
 */
export async function backfillUnitPricesFromExcelFiles(client, files, opts = {}) {
  const list = (files || []).filter(Boolean)
  if (!list.length) return { updatedItems: 0, updatedLots: 0, matched: 0, message: 'Nie wybrano plików.' }

  let updatedItems = 0
  let updatedLots = 0
  let matched = 0
  const messages = []

  for (const file of list) {
    const r = await backfillUnitPricesFromExcelFile(client, file, opts)
    updatedItems += r.updatedItems || 0
    updatedLots += r.updatedLots || 0
    matched += r.matched || 0
    if (r.needsMigration) return r
    messages.push(r.message)
  }

  return {
    updatedItems,
    updatedLots,
    matched,
    message: messages.join(' ')
  }
}

/**
 * Lista zapisanych importów (do podpowiedzi użytkownikowi).
 */
export async function listImportedFilesForMonth(client, yearMonth) {
  if (!client) return []
  const { data, error } = await client
    .from('imported_files')
    .select('id, filename, created_at, status, rows_count, row_count')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw error

  const all = data || []
  const matched = all.filter(row => {
    if (!yearMonth) return true
    const created = String(row.created_at || '').slice(0, 7)
    const name = String(row.filename || row.file_name || '').toLowerCase()
    return created === yearMonth || name.includes(yearMonth.replace('-', '')) || name.includes(yearMonth) || name.includes(yearMonth.slice(5, 7))
  })
  return matched.length ? matched : all.slice(0, 15)
}
