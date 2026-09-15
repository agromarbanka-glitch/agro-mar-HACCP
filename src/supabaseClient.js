import { createClient } from '@supabase/supabase-js'

const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || '').trim()
const supabaseAnonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim()

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

/** Skrócony identyfikator projektu (do komunikatów na ekranie logowania). */
export function getSupabaseProjectHint() {
  if (!supabaseUrl) return ''
  try {
    const host = new URL(supabaseUrl).hostname
    const ref = host.replace(/\.supabase\.co$/i, '')
    return ref && ref !== host ? ref : host
  } catch {
    return 'nieprawidłowy VITE_SUPABASE_URL'
  }
}

/** Szybki test sieci — auth/v1/health (bez logowania). */
export async function probeSupabaseReachable(timeoutMs = 8000) {
  if (!supabaseUrl) {
    return { ok: false, message: 'Brak VITE_SUPABASE_URL w buildzie (Vercel → Environment Variables → Redeploy).' }
  }
  const base = supabaseUrl.replace(/\/+$/, '')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${base}/auth/v1/health`, {
      method: 'GET',
      headers: supabaseAnonKey ? { apikey: supabaseAnonKey } : {},
      signal: ctrl.signal
    })
    if (res.ok) return { ok: true, project: getSupabaseProjectHint() }
    return {
      ok: false,
      message: `Supabase odpowiedział HTTP ${res.status}. Sprawdź URL projektu i czy projekt nie jest wstrzymany (Paused) w panelu Supabase.`
    }
  } catch (err) {
    const aborted = err?.name === 'AbortError'
    return {
      ok: false,
      message: aborted
        ? 'Timeout połączenia z Supabase — projekt może być wstrzymany (Paused), zły URL albo blokada sieci (VPN, firewall).'
        : String(err?.message || err)
    }
  } finally {
    clearTimeout(timer)
  }
}
