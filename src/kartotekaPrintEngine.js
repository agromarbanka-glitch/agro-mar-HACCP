/**
 * Informacyjne oznaczenie wydruku kartoteki (zielona kropka w liście).
 * Zapis w data.kartoteka_printed_at + localStorage dla wpisów syntetycznych.
 */

export const KARTOTEKA_PRINT_ENGINE_VERSION = '1.1'
export const KARTOTEKA_PRINT_DATA_KEY = 'kartoteka_printed_at'
export const KARTOTEKA_PRINT_BY_KEY = 'kartoteka_printed_by'
export const KARTOTEKA_PRINT_STATUS_KEY = 'kartoteka_print_status'
export const PRINT_STATUS_OK = 'ok'
export const PRINT_STATUS_NEEDS_REPRINT = 'needs_reprint'
export const LOCAL_PRINTS_STORAGE_KEY = 'agro-mar-kartoteka-prints-v1'

export function isPersistedHaccpDocId(doc) {
  if (!doc?.id || doc.synthetic) return false
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(doc.id))
}

export function kartotekaGroupFromDoc(doc) {
  if (!doc) return null
  return {
    key: `${doc.document_type}|doc|${doc.id}`,
    type: doc.document_type,
    docs: [doc]
  }
}

export function loadLocalKartotekaPrints() {
  try {
    const raw = localStorage.getItem(LOCAL_PRINTS_STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export function saveLocalKartotekaPrint(groupKey, info) {
  if (!groupKey) return loadLocalKartotekaPrints()
  const all = loadLocalKartotekaPrints()
  const prev = all[groupKey] || {}
  all[groupKey] = {
    at: info.at ?? prev.at ?? null,
    by: info.by ?? prev.by ?? null,
    status: info.status ?? prev.status ?? PRINT_STATUS_OK
  }
  try {
    localStorage.setItem(LOCAL_PRINTS_STORAGE_KEY, JSON.stringify(all))
  } catch (_) {}
  return all
}

export function getKartotekaPrintInfo(group, localPrints = {}) {
  const docs = group?.docs || []
  let printedAt = null
  let printedBy = null
  let status = PRINT_STATUS_OK
  for (const doc of docs) {
    const at = doc.data?.[KARTOTEKA_PRINT_DATA_KEY]
    if (at && (!printedAt || String(at) > String(printedAt))) {
      printedAt = at
      printedBy = doc.data?.[KARTOTEKA_PRINT_BY_KEY] || printedBy
    }
    if (doc.data?.[KARTOTEKA_PRINT_STATUS_KEY] === PRINT_STATUS_NEEDS_REPRINT) {
      status = PRINT_STATUS_NEEDS_REPRINT
    }
  }
  const local = group?.key ? localPrints[group.key] : null
  if (local?.at && (!printedAt || String(local.at) > String(printedAt))) {
    printedAt = local.at
    printedBy = local.by || printedBy
  }
  if (local?.status === PRINT_STATUS_NEEDS_REPRINT) status = PRINT_STATUS_NEEDS_REPRINT
  if (!printedAt) return { printed: false, status: 'none', printedAt: null, printedBy: null }
  return { printed: true, status, printedAt, printedBy }
}

export function formatKartotekaPrintDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return String(iso)
  }
}

export async function markKartotekaPrinted(client, group, { printedBy = '', onMergeDoc, onLocalUpdate } = {}) {
  if (!group) return null
  const at = new Date().toISOString()
  const by = printedBy || null
  const patch = {
    [KARTOTEKA_PRINT_DATA_KEY]: at,
    [KARTOTEKA_PRINT_BY_KEY]: by,
    [KARTOTEKA_PRINT_STATUS_KEY]: PRINT_STATUS_OK
  }
  const docs = group.docs || []
  const persisted = docs.filter(isPersistedHaccpDocId)

  if (group.key) {
    const all = saveLocalKartotekaPrint(group.key, { at, by, status: PRINT_STATUS_OK })
    onLocalUpdate?.(all)
  }

  if (!client || !persisted.length) return { at, by, status: PRINT_STATUS_OK }

  for (const doc of persisted) {
    const nextData = { ...(doc.data || {}), ...patch }
    const payload = { data: nextData, updated_at: at }
    const { error } = await client.from('haccp_documents').update(payload).eq('id', doc.id)
    if (error) throw error
    onMergeDoc?.(doc.id, payload)
  }
  return { at, by, status: PRINT_STATUS_OK }
}

/** Przełączenie: zielona (ok) ↔ szara (do ponownego wydruku). */
export async function setKartotekaPrintStatus(client, group, status, { onMergeDoc, onLocalUpdate } = {}) {
  if (!group) return null
  const normalized = status === PRINT_STATUS_NEEDS_REPRINT ? PRINT_STATUS_NEEDS_REPRINT : PRINT_STATUS_OK
  const info = getKartotekaPrintInfo(group, loadLocalKartotekaPrints())
  if (!info.printed && normalized === PRINT_STATUS_NEEDS_REPRINT) return null

  const patch = { [KARTOTEKA_PRINT_STATUS_KEY]: normalized }
  const docs = group.docs || []
  const persisted = docs.filter(isPersistedHaccpDocId)
  const at = info.printedAt || new Date().toISOString()

  if (group.key) {
    const all = saveLocalKartotekaPrint(group.key, {
      at,
      by: info.printedBy,
      status: normalized
    })
    onLocalUpdate?.(all)
  }

  if (!client || !persisted.length) return { status: normalized }

  const updatedAt = new Date().toISOString()
  for (const doc of persisted) {
    const nextData = { ...(doc.data || {}), ...patch }
    if (!nextData[KARTOTEKA_PRINT_DATA_KEY]) nextData[KARTOTEKA_PRINT_DATA_KEY] = at
    const payload = { data: nextData, updated_at: updatedAt }
    const { error } = await client.from('haccp_documents').update(payload).eq('id', doc.id)
    if (error) throw error
    onMergeDoc?.(doc.id, payload)
  }
  return { status: normalized }
}
