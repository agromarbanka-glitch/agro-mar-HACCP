import React, { useCallback, useEffect, useState } from 'react'
import { RefreshCcw, RotateCcw, History } from 'lucide-react'
import {
  loadAuditLog, loadLegacyDocHistory, restoreAuditEntry, auditActionLabel, auditActor, AUDIT_ENGINE_VERSION
} from './auditEngine'

export function HistorySection({ supabase, authProfile, authSession, setMessage, onRestored }) {
  const [entries, setEntries] = useState([])
  const [legacy, setLegacy] = useState([])
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    try {
      const [audit, leg] = await Promise.all([
        loadAuditLog(supabase, { limit: 250, action: filter }),
        loadLegacyDocHistory(supabase, 80)
      ])
      setEntries(audit)
      setLegacy(leg)
    } catch (err) {
      setMessage(`Historia: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [supabase, filter, setMessage])

  useEffect(() => { load() }, [load])

  async function handleRestore(entry) {
    if (!supabase) return
    if (!window.confirm(`Przywrócić usunięty wpis?\n\n${entry.summary || entry.entity_type}`)) return
    try {
      await restoreAuditEntry(supabase, entry, auditActor(authProfile, authSession))
      setMessage('Przywrócono wpis z historii.')
      await load()
      onRestored?.()
    } catch (err) {
      setMessage(`Przywracanie: ${err.message}`)
    }
  }

  return (
    <>
      <section className="card">
        <div className="section-title">
          <History />
          <div>
            <h2>Historia zmian i usunięć</h2>
            <p>Tylko administrator. Usunięte dokumenty można przywrócić. Silnik: {AUDIT_ENGINE_VERSION}</p>
          </div>
        </div>
        <div className="k03-bulk-row">
          <label>Filtr akcji
            <select value={filter} onChange={e => setFilter(e.target.value)}>
              <option value="all">Wszystkie</option>
              <option value="delete">Usunięcia</option>
              <option value="update">Edycje</option>
              <option value="restore">Przywrócenia</option>
            </select>
          </label>
          <button type="button" className="secondary" onClick={load} disabled={loading}>
            <RefreshCcw size={16} /> Odśwież
          </button>
        </div>
        {entries.length === 0 && !loading && <p className="hint">Brak wpisów w historii audytu.</p>}
        {entries.length > 0 && (
          <div className="table-wrap docs-table-wrap">
            <table className="docs-table compact">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Akcja</th>
                  <th>Typ</th>
                  <th>Opis</th>
                  <th>Kto</th>
                  <th>Akcje</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(e => (
                  <tr key={e.id} className={e.action === 'delete' && !e.restored_at ? 'audit-delete-row' : ''}>
                    <td>{e.created_at ? new Date(e.created_at).toLocaleString('pl-PL') : '—'}</td>
                    <td><span className={`pill audit-pill-${e.action}`}>{auditActionLabel(e.action)}</span></td>
                    <td>{e.entity_type}</td>
                    <td className="left">{e.summary || e.entity_id || '—'}{e.restored_at ? ' (przywrócono)' : ''}</td>
                    <td>{e.changed_by || '—'}</td>
                    <td className="row-actions">
                      {e.can_restore && e.action === 'delete' && !e.restored_at && (
                        <button type="button" className="mini secondary" onClick={() => handleRestore(e)}>
                          <RotateCcw size={14} /> Przywróć
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

      {legacy.length > 0 && (
        <section className="card">
          <h3>Starsze wpisy edycji pól (haccp_document_history)</h3>
          <p className="hint">Edycje pojedynczych pól sprzed pełnej historii audytu.</p>
          <div className="table-wrap docs-table-wrap">
            <table className="docs-table compact">
              <thead>
                <tr><th>Data</th><th>Dokument</th><th>Pole</th><th>Było</th><th>Jest</th><th>Kto</th></tr>
              </thead>
              <tbody>
                {legacy.map(h => (
                  <tr key={h.id}>
                    <td>{h.created_at ? new Date(h.created_at).toLocaleString('pl-PL') : '—'}</td>
                    <td>{h.haccp_documents?.document_type || '—'} {h.haccp_documents?.document_date || ''}</td>
                    <td>{h.field_name || h.action || '—'}</td>
                    <td>{h.old_value ?? '—'}</td>
                    <td>{h.new_value ?? '—'}</td>
                    <td>{h.changed_by || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  )
}
