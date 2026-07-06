/** Wspólne pola SELECT dla listy kartotek (load + batch insert). */
export const HACCP_DOC_LIST_SELECT =
  'id, document_type, lot_id, document_date, product_name, lot_no, supplier_name, document_no, chamber_code, qty, status, data, signed_by_operator, signed_by_admin, document_version, created_at'

/** Maks. liczba kartotek wczytywanych do przeglądarki (kilka sezonów). */
export const HACCP_DOCS_LOAD_MAX = 50000

/** Rozmiar paczki przy pobieraniu (domyślny limit Supabase to 1000/wywołanie – działa bez zmian w panelu). */
export const HACCP_DOCS_PAGE_SIZE = 1000

/** Pobiera kartoteki stronicowane – omija stary limit 5000 w jednym zapytaniu. */
export async function fetchAllHaccpDocuments(client, { maxRows = HACCP_DOCS_LOAD_MAX, pageSize = HACCP_DOCS_PAGE_SIZE } = {}) {
  if (!client) return []
  const rows = []
  let offset = 0
  while (rows.length < maxRows) {
    const end = Math.min(offset + pageSize - 1, offset + maxRows - rows.length - 1)
    const { data, error } = await client
      .from('haccp_documents')
      .select(HACCP_DOC_LIST_SELECT)
      .order('document_date', { ascending: false })
      .range(offset, end)
    if (error) throw error
    const chunk = data || []
    rows.push(...chunk)
    if (chunk.length < pageSize) break
    offset += pageSize
  }
  return rows.slice(0, maxRows)
}

export function mergeHaccpDocs(existing, incoming) {
  const map = new Map((existing || []).map(d => [d.id, d]))
  for (const row of incoming || []) map.set(row.id, row)
  return Array.from(map.values()).sort((a, b) =>
    String(b.document_date || '').localeCompare(String(a.document_date || ''))
  )
}

export function patchHaccpDocInList(list, id, patch) {
  const arr = list || []
  const idx = arr.findIndex(d => d.id === id)
  if (idx < 0) return arr
  const d = arr[idx]
  const next = {
    ...d,
    ...patch,
    data: patch.data !== undefined ? { ...(d.data || {}), ...patch.data } : d.data
  }
  const out = arr.slice()
  out[idx] = next
  return out
}

/** Wstawia wiele wpisów naraz (chunki po 50) zamiast osobnego requestu na każdy dzień. */
export async function batchInsertHaccpDocuments(client, payloads, { chunkSize = 50 } = {}) {
  if (!client || !payloads?.length) return { added: 0, rows: [] }
  const rows = []
  for (let i = 0; i < payloads.length; i += chunkSize) {
    const chunk = payloads.slice(i, i + chunkSize)
    const { data, error } = await client.from('haccp_documents').insert(chunk).select(HACCP_DOC_LIST_SELECT)
    if (error) throw error
    rows.push(...(data || []))
  }
  return { added: rows.length, rows }
}
