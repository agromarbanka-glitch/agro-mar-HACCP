/**
 * Ustawienia aplikacji – prefiksy partii K03, widoczność zakładek (zapis w Supabase app_settings).
 */

export const APP_SETTINGS_VERSION = '1.0'

export const DEFAULT_K03_LOT_PREFIX_RULES = {
  porzeczka_czarna_bez_przerobu: 'Pcz',
  porzeczka_czarna_przerob: 'Pczp',
  porzeczka_kolorowa_bez_przerobu: 'Pk',
  porzeczka_kolorowa_przerob: 'Pkp',
  malina_przerob: 'Mp',
  malina_bez_przerobu: 'M1',
  malina_pw: 'Mpw',
  malina_klasa_i: 'M1',
  malina_extra: 'Mex',
  malina_pulpa: 'Mp',
  defaults: {
    'malina pulpa': 'Mp',
    'porzeczka czarna': 'Pcz',
    'porzeczka czarna pulpa': 'Pczp',
    'porzeczka kolorowa': 'Pk',
    'porzeczka kolorowa pulpa': 'Pkp',
    'porzeczka czerwona': 'Pk',
    'porzeczka czerwona pulpa': 'Pkp',
    truskawka: 'T',
    aronia: 'A'
  }
}

export const DEFAULT_MAGAZYNIER_TABS = ['kartoteki', 'archiwum-pdf']

export const MAGAZYNIER_TAB_OPTIONS = [
  { key: 'kartoteki', label: 'Dokumentacja HACCP' },
  { key: 'archiwum-pdf', label: 'Archiwum PDF' },
  { key: 'dashboard', label: 'Start' },
  { key: 'stany', label: 'Stany magazynu' },
  { key: 'raporty', label: 'Wartość magazynu' }
]

let cachedSettings = {
  k03_lot_prefix_rules: { ...DEFAULT_K03_LOT_PREFIX_RULES, defaults: { ...DEFAULT_K03_LOT_PREFIX_RULES.defaults } },
  magazynier_visible_tabs: [...DEFAULT_MAGAZYNIER_TABS]
}

export function getAppSettings() {
  return cachedSettings
}

export function getK03PrefixRules() {
  return cachedSettings.k03_lot_prefix_rules || DEFAULT_K03_LOT_PREFIX_RULES
}

export function setCachedAppSettings(partial = {}) {
  cachedSettings = {
    ...cachedSettings,
    ...partial,
    k03_lot_prefix_rules: {
      ...DEFAULT_K03_LOT_PREFIX_RULES,
      ...(partial.k03_lot_prefix_rules || cachedSettings.k03_lot_prefix_rules || {}),
      defaults: {
        ...DEFAULT_K03_LOT_PREFIX_RULES.defaults,
        ...(partial.k03_lot_prefix_rules?.defaults || cachedSettings.k03_lot_prefix_rules?.defaults || {})
      }
    }
  }
  return cachedSettings
}

export async function loadAppSettings(supabase) {
  if (!supabase) return cachedSettings
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value')
    if (error) throw error
    const map = Object.fromEntries((data || []).map(r => [r.key, r.value]))
    setCachedAppSettings({
      k03_lot_prefix_rules: map.k03_lot_prefix_rules || DEFAULT_K03_LOT_PREFIX_RULES,
      magazynier_visible_tabs: map.magazynier_visible_tabs || DEFAULT_MAGAZYNIER_TABS
    })
  } catch {
    setCachedAppSettings({})
  }
  return cachedSettings
}

export async function saveAppSetting(supabase, key, value, updatedBy = null) {
  if (!supabase) throw new Error('Brak połączenia z bazą')
  const payload = {
    key,
    value,
    updated_at: new Date().toISOString(),
    updated_by: updatedBy || null
  }
  const { error } = await supabase.from('app_settings').upsert(payload, { onConflict: 'key' })
  if (error) throw error
  if (key === 'k03_lot_prefix_rules') {
    setCachedAppSettings({ k03_lot_prefix_rules: value })
  }
  if (key === 'magazynier_visible_tabs') {
    setCachedAppSettings({ magazynier_visible_tabs: value })
  }
  return value
}

export async function syncK03LotSequences(supabase) {
  if (!supabase) return 0
  const { data, error } = await supabase.rpc('sync_k03_lot_sequences_from_documents')
  if (error) throw error
  return Number(data) || 0
}

export async function allocateK03LotNoRpc(supabase, code, year) {
  if (!supabase) return null
  const { data, error } = await supabase.rpc('allocate_k03_lot_no', {
    p_code: String(code || '').trim(),
    p_year: Number(year)
  })
  if (error) throw error
  return String(data || '').trim() || null
}

export async function fetchK03LotSequences(supabase, year = null) {
  if (!supabase) return []
  let q = supabase.from('k03_lot_sequences').select('lot_code, year, next_number, updated_at').order('year', { ascending: false }).order('lot_code')
  if (year) q = q.eq('year', year)
  const { data, error } = await q
  if (error) throw error
  return data || []
}
