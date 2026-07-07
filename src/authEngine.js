/**
 * Logowanie Supabase Auth + role aplikacji (admin / magazynier).
 */
import { createClient } from '@supabase/supabase-js'
import { supabase as mainSupabase, isSupabaseConfigured } from './supabaseClient'

export const AUTH_ENGINE_VERSION = '1.0'
export const AUTH_SESSION_KEY = 'agro-mar-auth-profile-v1'

/** Klient bez trwałej sesji – do tworzenia kont przez admina bez wylogowania. */
function signupClient() {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return null
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  })
}

export function isAdmin(profile) {
  return profile?.role === 'admin' && profile?.is_active !== false
}

export function isMagazynier(profile) {
  return profile?.role === 'magazynier' && profile?.is_active !== false
}

export function canDelete(profile) {
  return isAdmin(profile)
}

/** Jednolite pytanie przed każdym usunięciem (admin i magazynier – magazynier i tak nie dojdzie do tego miejsca). */
export function confirmDelete(detail) {
  const text = String(detail || '').trim()
  return window.confirm(text ? `Czy na pewno usunąć?\n\n${text}` : 'Czy na pewno usunąć?')
}

export function canSeeHistory(profile) {
  return isAdmin(profile)
}

export function canSeeTab(profile, tabKey) {
  if (isAdmin(profile)) return true
  if (isMagazynier(profile)) return tabKey === 'kartoteki' || tabKey === 'archiwum-pdf'
  return false
}

export function canSeeDocsHubSection(profile, sectionKey) {
  if (isAdmin(profile)) return true
  if (isMagazynier(profile)) return ['kartoteki', 'raporty', 'wykazy'].includes(sectionKey)
  return false
}

export async function loadAppProfile(client, authUserId) {
  if (!client || !authUserId) return null
  const { data, error } = await client
    .from('app_users')
    .select('id, auth_user_id, email, display_name, role, is_active, created_at')
    .eq('auth_user_id', authUserId)
    .maybeSingle()
  if (error) throw error
  if (!data || data.is_active === false) return null
  return data
}

export async function signIn(email, password) {
  if (!mainSupabase) throw new Error('Brak konfiguracji Supabase (.env)')
  const { data, error } = await mainSupabase.auth.signInWithPassword({
    email: String(email || '').trim(),
    password: String(password || '')
  })
  if (error) throw error
  const profile = await loadAppProfile(mainSupabase, data.user?.id)
  if (!profile) {
    await mainSupabase.auth.signOut()
    throw new Error('Konto nie ma dostępu do systemu. Poproś administratora o aktywację.')
  }
  return { session: data.session, user: data.user, profile }
}

export async function signOut() {
  if (!mainSupabase) return
  await mainSupabase.auth.signOut()
  try { localStorage.removeItem(AUTH_SESSION_KEY) } catch { /* ignore */ }
}

export async function getCurrentSession() {
  if (!mainSupabase) return { session: null, profile: null }
  const { data: { session } } = await mainSupabase.auth.getSession()
  if (!session?.user?.id) return { session: null, profile: null }
  try {
    const profile = await loadAppProfile(mainSupabase, session.user.id)
    if (!profile) {
      await mainSupabase.auth.signOut()
      return { session: null, profile: null }
    }
    return { session, profile }
  } catch {
    return { session, profile: null }
  }
}

export async function listAppUsers(client) {
  const { data, error } = await client
    .from('app_users')
    .select('id, auth_user_id, email, display_name, role, is_active, created_at')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function createAppUser({ email, password, displayName, role = 'magazynier' }) {
  if (!mainSupabase) throw new Error('Brak Supabase')
  const trimmedEmail = String(email || '').trim().toLowerCase()
  const trimmedName = String(displayName || '').trim() || trimmedEmail
  if (!trimmedEmail || !password) throw new Error('Podaj email i hasło')

  const client = signupClient()
  if (!client) throw new Error('Brak konfiguracji Supabase')

  const { data, error } = await client.auth.signUp({
    email: trimmedEmail,
    password: String(password),
    options: { data: { display_name: trimmedName } }
  })
  if (error) throw error
  if (!data.user?.id) throw new Error('Nie udało się utworzyć konta auth')

  const { error: insErr } = await mainSupabase.from('app_users').insert({
    auth_user_id: data.user.id,
    email: trimmedEmail,
    display_name: trimmedName,
    role: role === 'admin' ? 'admin' : 'magazynier',
    is_active: true,
    updated_at: new Date().toISOString()
  })
  if (insErr) throw insErr
  return { userId: data.user.id, email: trimmedEmail }
}

export async function updateAppUserRole(client, userId, patch) {
  const { error } = await client.from('app_users').update({
    ...patch,
    updated_at: new Date().toISOString()
  }).eq('id', userId)
  if (error) throw error
}

export async function deactivateAppUser(client, userId) {
  await updateAppUserRole(client, userId, { is_active: false })
}

export function authDisplayName(profile, session) {
  return profile?.display_name || profile?.email || session?.user?.email || 'Użytkownik'
}
