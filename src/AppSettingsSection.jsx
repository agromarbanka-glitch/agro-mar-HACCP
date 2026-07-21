import React, { useEffect, useState } from 'react'
import { ShieldCheck, Save, RefreshCw, Wrench } from 'lucide-react'
import {
  DEFAULT_K03_LOT_PREFIX_RULES,
  DEFAULT_MAGAZYNIER_TABS,
  MAGAZYNIER_TAB_OPTIONS,
  loadAppSettings,
  saveAppSetting,
  fetchK03LotSequences,
  syncK03LotSequences,
  getK03PrefixRules,
  getAppSettings
} from './appSettingsEngine'

const PREFIX_FIELDS = [
  { key: 'porzeczka_czarna_bez_przerobu', label: 'Porzeczka czarna – bez przerobu', example: 'Pcz/001/2026' },
  { key: 'porzeczka_czarna_przerob', label: 'Porzeczka czarna – przerób (pulpa)', example: 'Pczp/001/2026' },
  { key: 'porzeczka_kolorowa_bez_przerobu', label: 'Porzeczka kolorowa – bez przerobu', example: 'Pk/001/2026' },
  { key: 'porzeczka_kolorowa_przerob', label: 'Porzeczka kolorowa – przerób', example: 'Pkp/001/2026' },
  { key: 'malina_przerob', label: 'Malina – przerób (pulpa i inne)', example: 'Mp/001/2026' },
  { key: 'malina_bez_przerobu', label: 'Malina – bez przerobu (M1, extra, mix)', example: 'M1/001/2026' },
]

export function AppSettingsSection({
  supabase, employees, addEmployee, deleteEmployee, updateEmployee,
  newEmployeeName, setNewEmployeeName, setMessage, authProfile,
  onRepairK03Lots, docsCatalog = []
}) {
  const [prefixRules, setPrefixRules] = useState(() => ({ ...getK03PrefixRules() }))
  const [magTabs, setMagTabs] = useState(() => [...(getAppSettings().magazynier_visible_tabs || DEFAULT_MAGAZYNIER_TABS)])
  const [sequences, setSequences] = useState([])
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [repairing, setRepairing] = useState(false)
  const year = String(new Date().getFullYear())

  useEffect(() => {
    void (async () => {
      await loadAppSettings(supabase)
      setPrefixRules({ ...getK03PrefixRules() })
      setMagTabs([...(getAppSettings().magazynier_visible_tabs || DEFAULT_MAGAZYNIER_TABS)])
      if (supabase) {
        try {
          setSequences(await fetchK03LotSequences(supabase, Number(year)))
        } catch { /* v49 migration may be missing */ }
      }
    })()
  }, [supabase, year])

  async function savePrefixRules() {
    if (!supabase) return
    setSaving(true)
    try {
      await saveAppSetting(supabase, 'k03_lot_prefix_rules', prefixRules, authProfile?.id)
      setMessage('Zapisano reguły numeracji partii K03 – obowiązują od razu, bez deploy.')
    } catch (err) {
      setMessage(`Ustawienia: ${err.message}. Uruchom migrację supabase/2026-v49-k03-lot-sequences-app-settings.sql`)
    } finally {
      setSaving(false)
    }
  }

  async function saveMagTabs() {
    if (!supabase) return
    if (!magTabs.length) {
      setMessage('Magazynier musi mieć co najmniej jedną widoczną zakładkę.')
      return
    }
    setSaving(true)
    try {
      await saveAppSetting(supabase, 'magazynier_visible_tabs', magTabs, authProfile?.id)
      setMessage('Zapisano widoczne zakładki magazyniera – odśwież stronę u użytkownika magazynu.')
    } catch (err) {
      setMessage(`Zakładki magazyniera: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  async function syncSequences() {
    if (!supabase) return
    setSyncing(true)
    try {
      await syncK03LotSequences(supabase)
      setSequences(await fetchK03LotSequences(supabase, Number(year)))
      setMessage('Zsynchronizowano sekwencje partii K03 z kartoteki.')
    } catch (err) {
      setMessage(`Sync sekwencji: ${err.message}`)
    } finally {
      setSyncing(false)
    }
  }

  async function repairLots() {
    if (!onRepairK03Lots) return
    if (!window.confirm(
      'Przepisać numery partii we wszystkich zapisanych kartach K03?\n\nPoprawi prefiks (Pcz/Pczp), duplikaty i kolejność wg przerobu.\n\nKontynuować?'
    )) return
    setRepairing(true)
    try {
      await onRepairK03Lots()
    } finally {
      setRepairing(false)
    }
  }

  function resetPrefixRules() {
    setPrefixRules({ ...DEFAULT_K03_LOT_PREFIX_RULES, defaults: { ...DEFAULT_K03_LOT_PREFIX_RULES.defaults } })
  }

  function toggleMagTab(key) {
    setMagTabs(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }

  return (
    <>
      <section className="card">
        <div className="section-title">
          <ShieldCheck />
          <div>
            <h2>Numeracja partii K03 (wyroby gotowe)</h2>
            <p>Jeden numer partii = jedna zapisana K03. Numer nadaje się dopiero przy przerobie (nie wcześniej dla WZ w kolejce). Kto pierwszy przerabia w roku, dostaje /001/, kolejny przerób /002/ itd. – niezależnie od daty WZ.</p>
          </div>
        </div>
        <div className="form-grid compact">
          {PREFIX_FIELDS.map(f => (
            <label key={f.key}>
              {f.label}
              <input
                value={prefixRules[f.key] || ''}
                onChange={e => setPrefixRules(prev => ({ ...prev, [f.key]: e.target.value.trim() }))}
                placeholder={f.example.split('/')[0]}
              />
              <small className="hint">{f.example}</small>
            </label>
          ))}
        </div>
        <div className="actions" style={{ marginTop: 12, flexWrap: 'wrap', gap: 8 }}>
          <button type="button" className="primary" disabled={saving} onClick={() => void savePrefixRules()}>
            <Save size={16} /> Zapisz reguły numeracji
          </button>
          <button type="button" className="secondary" onClick={resetPrefixRules}>Przywróć domyślne</button>
          <button type="button" className="secondary" disabled={syncing} onClick={() => void syncSequences()}>
            <RefreshCw size={16} /> Sync sekwencji z kart K03
          </button>
          <button type="button" className="secondary" disabled={repairing} onClick={() => void repairLots()}>
            <Wrench size={16} /> {repairing ? 'Przepisywanie…' : 'Przepisz numery partii K03 (wszystkie)'}
          </button>
        </div>
        {sequences.length > 0 && (
          <div className="table-wrap small" style={{ marginTop: 16 }}>
            <p className="hint">Następny numer w {year} (po sync):</p>
            <table>
              <thead><tr><th>Kod</th><th>Rok</th><th>Następny nr</th></tr></thead>
              <tbody>
                {sequences.filter(s => String(s.year) === year).map(s => (
                  <tr key={`${s.lot_code}-${s.year}`}>
                    <td><b>{s.lot_code}</b></td>
                    <td>{s.year}</td>
                    <td>{String(s.next_number).padStart(3, '0')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="section-title">
          <ShieldCheck />
          <div>
            <h2>Zakładki magazyniera</h2>
            <p>Wybierz, które zakładki widzi rola „magazynier” po zalogowaniu. Zapis w bazie – bez deploy.</p>
          </div>
        </div>
        <div className="chips" style={{ flexWrap: 'wrap', gap: 8 }}>
          {MAGAZYNIER_TAB_OPTIONS.map(opt => (
            <label key={opt.key} className="chip" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={magTabs.includes(opt.key)}
                onChange={() => toggleMagTab(opt.key)}
                style={{ marginRight: 6 }}
              />
              {opt.label}
            </label>
          ))}
        </div>
        <div className="actions" style={{ marginTop: 12 }}>
          <button type="button" className="primary" disabled={saving} onClick={() => void saveMagTabs()}>
            <Save size={16} /> Zapisz zakładki magazyniera
          </button>
        </div>
      </section>

      {docsCatalog.length > 0 && (
        <section className="card">
          <h2>Katalog dokumentów HACCP</h2>
          <p className="hint">Lista kartotek i raportów w systemie (informacyjnie).</p>
          {docsCatalog.map(d => (
            <div className="doc" key={d[0]}><b>{d[0]}</b><span>{d[1]}</span><small>{d[2]}</small></div>
          ))}
        </section>
      )}

      <section className="card">
        <div className="section-title">
          <ShieldCheck />
          <div>
            <h2>Pracownicy do podpisów</h2>
            <p>Lista osób w polach „Podpis” w kartotekach HACCP. Zapis od razu w bazie.</p>
          </div>
        </div>
        <div className="form-grid compact">
          <label>Imię i nazwisko pracownika
            <input value={newEmployeeName} onChange={e => setNewEmployeeName(e.target.value)} placeholder="np. Jan Kowalski" />
          </label>
          <div className="actions employee-actions">
            <button type="button" className="secondary" onClick={addEmployee}>Dodaj pracownika</button>
          </div>
        </div>
        {employees.length === 0 && <p className="hint">Brak pracowników.</p>}
        {employees.length > 0 && (
          <div className="table-wrap small">
            <table>
              <thead><tr><th>Pracownik</th><th>Rola</th><th>Akcje</th></tr></thead>
              <tbody>
                {employees.map(emp => (
                  <tr key={emp.id}>
                    <td>
                      <input
                        className="cell-input wide"
                        defaultValue={emp.full_name}
                        onBlur={e => {
                          const v = e.target.value.trim()
                          if (v && v !== emp.full_name && updateEmployee) void updateEmployee(emp, { full_name: v })
                        }}
                      />
                    </td>
                    <td>
                      <input
                        className="cell-input"
                        defaultValue={emp.role_name || 'przyjmujący'}
                        onBlur={e => {
                          const v = e.target.value.trim()
                          if (v !== (emp.role_name || '') && updateEmployee) void updateEmployee(emp, { role_name: v })
                        }}
                      />
                    </td>
                    <td>
                      <button type="button" className="mini danger" onClick={() => deleteEmployee(emp)}>Usuń</button>
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
