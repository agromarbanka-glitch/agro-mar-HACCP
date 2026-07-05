import React, { useCallback, useEffect, useState } from 'react'
import { ShieldCheck, UserPlus, RefreshCcw, LogOut } from 'lucide-react'
import {
  listAppUsers, createAppUser, updateAppUserRole, deactivateAppUser,
  signOut, AUTH_ENGINE_VERSION, authDisplayName
} from './authEngine'

export function UsersAdminSection({ supabase, authProfile, authSession, setMessage, onLogout }) {
  const [users, setUsers] = useState([])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState('magazynier')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!supabase) return
    try {
      setUsers(await listAppUsers(supabase))
    } catch (err) {
      setMessage(`Konta: ${err.message}`)
    }
  }, [supabase, setMessage])

  useEffect(() => { load() }, [load])

  async function handleCreate(e) {
    e.preventDefault()
    setLoading(true)
    try {
      await createAppUser({ email, password, displayName, role })
      setMessage(`Utworzono konto: ${email} (${role === 'admin' ? 'Administrator' : 'Magazynier'})`)
      setEmail('')
      setPassword('')
      setDisplayName('')
      setRole('magazynier')
      await load()
    } catch (err) {
      setMessage(`Nowe konto: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  async function toggleActive(user) {
    if (!supabase) return
    const next = !user.is_active
    const msg = next ? 'aktywować' : 'dezaktywować'
    if (!window.confirm(`${msg.charAt(0).toUpperCase() + msg.slice(1)} konto ${user.email}?`)) return
    try {
      await updateAppUserRole(supabase, user.id, { is_active: next })
      await load()
      setMessage(`Konto ${user.email} – ${next ? 'aktywne' : 'dezaktywowane'}.`)
    } catch (err) {
      setMessage(err.message)
    }
  }

  async function changeRole(user, newRole) {
    if (!supabase || user.role === newRole) return
    if (!window.confirm(`Zmienić rolę ${user.email} na ${newRole}?`)) return
    try {
      await updateAppUserRole(supabase, user.id, { role: newRole })
      await load()
    } catch (err) {
      setMessage(err.message)
    }
  }

  return (
    <>
      <section className="card">
        <div className="section-title">
          <ShieldCheck />
          <div>
            <h2>Konta użytkowników</h2>
            <p>Administrator tworzy loginy dla pracowników. Auth {AUTH_ENGINE_VERSION}</p>
          </div>
        </div>
        <p className="hint">
          Zalogowany: <b>{authDisplayName(authProfile, authSession)}</b> ({authProfile?.role})
          {' · '}
          <button type="button" className="linkish" onClick={async () => { await signOut(); onLogout() }}>
            <LogOut size={14} /> Wyloguj
          </button>
        </p>
        <form className="form-grid compact" onSubmit={handleCreate}>
          <label>Email (login)<input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
          <label>Hasło startowe<input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={6} required /></label>
          <label>Imię i nazwisko<input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Jan Kowalski" /></label>
          <label>Rola
            <select value={role} onChange={e => setRole(e.target.value)}>
              <option value="magazynier">Magazynier (kartoteki, raporty, wykazy – bez usuwania)</option>
              <option value="admin">Administrator (pełny dostęp)</option>
            </select>
          </label>
          <div className="actions">
            <button type="submit" disabled={loading}><UserPlus size={16} /> {loading ? 'Tworzenie…' : 'Utwórz konto'}</button>
            <button type="button" className="secondary" onClick={load}><RefreshCcw size={16} /> Odśwież listę</button>
          </div>
        </form>
        <p className="hint">W Supabase wyłącz publiczne rejestrowanie (Authentication → Providers → Email → wyłącz „Enable sign ups” poza panelem admina). Pierwsze konto admina dodaj ręcznie po migracji SQL v36 (instrukcja w pliku migracji).</p>
      </section>

      <section className="card">
        <h3>Lista kont</h3>
        {users.length === 0 && <p className="hint">Brak kont – utwórz pierwsze konto powyżej lub dodaj admina SQL-em.</p>}
        {users.length > 0 && (
          <div className="table-wrap small">
            <table>
              <thead><tr><th>Email</th><th>Nazwa</th><th>Rola</th><th>Status</th><th>Akcje</th></tr></thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td>{u.email}</td>
                    <td>{u.display_name}</td>
                    <td>
                      <select value={u.role} onChange={e => changeRole(u, e.target.value)} disabled={u.auth_user_id === authProfile?.auth_user_id}>
                        <option value="magazynier">Magazynier</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td>{u.is_active ? 'Aktywne' : 'Wyłączone'}</td>
                    <td>
                      {u.auth_user_id !== authProfile?.auth_user_id && (
                        <button type="button" className="mini secondary" onClick={() => toggleActive(u)}>
                          {u.is_active ? 'Dezaktywuj' : 'Aktywuj'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
