import React, { useState } from 'react'
import { ShieldCheck, LogIn } from 'lucide-react'
import { signIn } from './authEngine'

export function LoginScreen({ onSuccess, supabaseConfigured }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const result = await signIn(email, password)
      onSuccess(result)
    } catch (err) {
      setError(err.message || 'Błąd logowania')
    } finally {
      setLoading(false)
    }
  }

  if (!supabaseConfigured) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <h1>AGRO-MAR HACCP</h1>
          <p className="hint danger-text">Brak konfiguracji Supabase. Uzupełnij plik <b>.env</b> (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY).</p>
        </div>
      </div>
    )
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-brand">
          <ShieldCheck size={40} />
          <div>
            <h1>AGRO-MAR HACCP</h1>
            <p>System dokumentacji i magazynu</p>
          </div>
        </div>
        <label>Email
          <input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} placeholder="np. jan@agro-mar.pl" required />
        </label>
        <label>Hasło
          <input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
        </label>
        {error && <p className="hint danger-text">{error}</p>}
        <button type="submit" disabled={loading}><LogIn size={16} /> {loading ? 'Logowanie…' : 'Zaloguj się'}</button>
        <p className="hint login-foot">Dostęp tylko dla kont utworzonych przez administratora. Po pierwszym wdrożeniu uruchom migrację SQL v36 i dodaj konto admina w Supabase.</p>
      </form>
    </div>
  )
}
