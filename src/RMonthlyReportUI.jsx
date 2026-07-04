import React, { useState } from 'react'
import { Eye, Printer, Trash2 } from 'lucide-react'
import { normalizePn as formNormalizePn } from './haccpFormsEngine'
import {
  R_MONTHLY_ENGINE_VERSION, loadRMonthlyColumns, saveRMonthlyColumns, rMonthlyMakeColumn,
  buildRMonthlyMonthPayloads, buildRMonthlySingleDayPayload, buildRegisterRowPayload,
  buildStationControlPayload, sortRMonthlyDocs, buildCalendarRows, formatRMonthlyPlDate,
  columnsFromDocs, isSundayDate
} from './rMonthlyEngine'
import { getRMonthlyConfig, isRMonthlyReport } from './rMonthlyConfigs'

export { isRMonthlyReport, getRMonthlyConfig }

function defaultNewRow(cfg) {
  const today = new Date().toISOString().slice(0, 10)
  const row = { document_date: today }
  for (const f of cfg.rowFields || []) {
    if (f.type === 'date') row[f.key] = today
    else if (f.type === 'pn') row[f.key] = 'P'
    else row[f.key] = ''
  }
  return row
}

export function RMonthlyReportSection({
  code, supabase, employees, haccpDocs, hubManualGroups, loadHaccpDocs, setMessage,
  setSelectedHaccpDoc, printHaccpGroup, exportHaccpGroupExcel
}) {
  const cfg = getRMonthlyConfig(code)
  const [newMonth, setNewMonth] = useState(new Date().toISOString().slice(0, 7))
  const [columnDefs, setColumnDefs] = useState(() => loadRMonthlyColumns(code))
  const [newColumnLabel, setNewColumnLabel] = useState('')
  const [defaultEmployee, setDefaultEmployee] = useState('')
  const [newRow, setNewRow] = useState(() => defaultNewRow(cfg))
  const [newControlDate, setNewControlDate] = useState(new Date().toISOString().slice(0, 10))

  if (!cfg) return null

  function shiftMonth(delta) {
    const [y, m] = newMonth.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setNewMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  async function createMonth() {
    if (!supabase) { setMessage(`${code}: brak połączenia z bazą.`); return }
    const period = cfg.periodMode === 'quarter'
      ? (() => { const [y, m] = newMonth.split('-').map(Number); return `${y}-Q${Math.ceil(m / 3)}` })()
      : newMonth
    const existing = (haccpDocs || []).filter(d => d.document_type === code && (
      d.data?.month_key === newMonth || d.data?.quarter_key === period || d.data?.month_key === period
    ))
    if (existing.length && !window.confirm(`Kartoteka ${code} za ${period} już istnieje. Utworzyć ponownie?`)) return
    try {
      if (existing.length) {
        for (const doc of existing) {
          const { error } = await supabase.from('haccp_documents').delete().eq('id', doc.id)
          if (error) throw error
        }
      }
      let added = 0
      const payloads = buildRMonthlyMonthPayloads(code, newMonth, defaultEmployee, columnDefs)
      for (const payload of payloads) {
        if (cfg.layout !== 'single-month' && cfg.layout !== 'register-rows' && cfg.layout !== 'quarter-trend' && cfg.layout !== 'station-matrix') {
          const dup = (haccpDocs || []).some(d => d.document_type === code && d.document_date === payload.document_date)
          if (dup) continue
        }
        const { error } = await supabase.from('haccp_documents').insert(payload)
        if (error) throw error
        added++
      }
      await loadHaccpDocs()
      setMessage(`${code}: utworzono kartotekę (${added} wpisów)${defaultEmployee ? `, podpis: ${defaultEmployee}` : ''}.`)
    } catch (err) {
      setMessage(`${code}: ${err.message}`)
    }
  }

  async function deleteMonth(group) {
    if (!supabase || !group?.docs?.length) return
    if (!window.confirm(`Usunąć całą kartotekę ${code} za ${group.period}? (${group.docs.length} wpisów)`)) return
    try {
      for (const doc of group.docs) {
        const { error } = await supabase.from('haccp_documents').delete().eq('id', doc.id)
        if (error) throw error
      }
      await loadHaccpDocs()
      setSelectedHaccpDoc?.(null)
      setMessage(`${code}: usunięto kartotekę.`)
    } catch (err) {
      setMessage(`${code}: ${err.message}`)
    }
  }

  async function addRegisterRow(group) {
    if (!supabase) return
    const rows = sortRMonthlyDocs(group.docs.filter(d => !d.data?.is_shell))
    const payload = buildRegisterRowPayload(code, group.period, {
      ...newRow,
      document_date: newRow.document_date || newRow.detected_date || new Date().toISOString().slice(0, 10)
    }, rows.length + 1, defaultEmployee)
    try {
      const { error } = await supabase.from('haccp_documents').insert(payload)
      if (error) throw error
      await loadHaccpDocs()
      setNewRow(defaultNewRow(cfg))
      setMessage(`${code}: dodano wpis.`)
    } catch (err) {
      setMessage(`${code}: ${err.message}`)
    }
  }

  function addDefaultColumn() {
    const col = rMonthlyMakeColumn(newColumnLabel, code.toLowerCase())
    const next = [...columnDefs, col]
    saveRMonthlyColumns(code, next)
    setColumnDefs(next)
    setNewColumnLabel('')
    setMessage(`${code}: dodano kolumnę „${col.label}".`)
  }

  const periodLabel = cfg.periodMode === 'quarter' ? 'Kwartał (wybierz miesiąc)' : 'Rok i miesiąc'
  const colPanel = (cfg.defaultColumns || cfg.defaultStations) && cfg.storageKey ? (
    <div className="r13-columns-panel">
      <b>{cfg.columnLabel || 'Stacje'} (domyślne):</b>
      <div className="r13-columns-list">
        {columnDefs.map(col => (
          <span key={col.id} className="r13-column-chip">{col.label}
            {columnDefs.length > 1 && <button type="button" className="mini danger" onClick={() => {
              const next = columnDefs.filter(c => c.id !== col.id)
              saveRMonthlyColumns(code, next)
              setColumnDefs(next)
            }}>×</button>}
          </span>
        ))}
      </div>
      <div className="r13-add-column-row">
        <input value={newColumnLabel} onChange={e => setNewColumnLabel(e.target.value)} placeholder="Dodaj…" />
        <button type="button" className="secondary" onClick={addDefaultColumn} disabled={!newColumnLabel.trim()}>{cfg.addColumnLabel || 'Dodaj'}</button>
      </div>
    </div>
  ) : null

  const registerAdd = cfg.layout === 'register-rows' ? (
    <div className="card inner-card no-print" style={{ marginTop: 12 }}>
      <h4>Dodaj wpis do bieżącej kartoteki</h4>
      <p className="hint">Najpierw utwórz kartotekę za miesiąc, potem dodawaj wiersze.</p>
      <div className="form-grid compact">
        {cfg.rowFields.map(f => (
          <label key={f.key} className={f.type === 'textarea' ? 'full-width' : ''}>{f.label}
            {f.type === 'date' ? <input type="date" value={newRow[f.key] || newRow.document_date || ''} onChange={e => setNewRow(p => ({ ...p, [f.key]: e.target.value, document_date: f.key === 'detected_date' ? e.target.value : p.document_date }))} />
              : f.type === 'pn' ? <select value={newRow[f.key] || 'P'} onChange={e => setNewRow(p => ({ ...p, [f.key]: e.target.value }))}><option value="P">P</option><option value="N">N</option></select>
              : f.type === 'textarea' ? <textarea rows={2} value={newRow[f.key] || ''} onChange={e => setNewRow(p => ({ ...p, [f.key]: e.target.value }))} />
              : <input value={newRow[f.key] || ''} onChange={e => setNewRow(p => ({ ...p, [f.key]: e.target.value }))} />}
          </label>
        ))}
      </div>
      {hubManualGroups[0] && <button style={{ marginTop: 8 }} onClick={() => addRegisterRow(hubManualGroups[0])}>Dodaj wpis do {hubManualGroups[0].period}</button>}
    </div>
  ) : null

  return <>
    <div className="card inner-card no-print r13-add-panel">
      <h3>Utwórz kartotekę {code} {cfg.periodMode === 'quarter' ? 'za kwartał' : 'za miesiąc'}</h3>
      <p className="hint">{cfg.createHint}</p>
      {colPanel}
      <div className="k03-bulk-row">
        <label>{periodLabel}
          <div className="r13-month-picker">
            <button type="button" className="mini secondary" onClick={() => shiftMonth(-1)}>◀</button>
            <input type="month" value={newMonth} onChange={e => setNewMonth(e.target.value)} />
            <button type="button" className="mini secondary" onClick={() => shiftMonth(1)}>▶</button>
          </div>
        </label>
        <label>{cfg.signLabel}
          <select value={defaultEmployee} onChange={e => setDefaultEmployee(e.target.value)}>
            <option value="">Wybierz pracownika</option>
            {employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}
          </select>
        </label>
        <button onClick={createMonth}>Utwórz kartotekę</button>
      </div>
      <p className="hint">Silnik kartotek: {R_MONTHLY_ENGINE_VERSION}</p>
    </div>
    {registerAdd}
    {hubManualGroups.length === 0 && <p className="hint">Brak kartotek {code} – utwórz powyżej.</p>}
    {hubManualGroups.length > 0 && <>
      <h3>Lista kartotek {code}</h3>
      <div className="table-wrap docs-table-wrap"><table className="docs-table">
        <thead><tr><th>Okres</th><th>Wpisy</th><th>Akcje</th></tr></thead>
        <tbody>{hubManualGroups.map(g => (
          <tr key={g.key}>
            <td><b>{g.period}</b></td>
            <td>{g.docs.filter(d => !d.data?.is_shell).length || g.docs.length}</td>
            <td className="row-actions">
              <button className="mini secondary" onClick={() => setSelectedHaccpDoc({ groupPreview: true, group: g })}><Eye size={14}/> Otwórz</button>
              <button className="mini secondary" onClick={() => printHaccpGroup(g)}><Printer size={14}/></button>
              <button className="mini secondary" onClick={() => exportHaccpGroupExcel(g)}>XLS</button>
              <button className="mini danger" onClick={() => deleteMonth(g)}><Trash2 size={14}/> Usuń</button>
            </td>
          </tr>
        ))}</tbody>
      </table></div>
    </>}
  </>
}

async function saveDoc(supabase, doc, patch, signedBy, loadHaccpDocs, setMessage, code) {
  if (!supabase || !doc?.id) return
  const nextData = { ...(doc.data || {}), ...patch }
  if (patch.nested && typeof patch.nested === 'object') {
    Object.assign(nextData, patch.nested)
    delete nextData.nested
  }
  const payload = { data: nextData, updated_at: new Date().toISOString() }
  if (signedBy !== undefined) payload.signed_by_operator = signedBy
  if (patch.status !== undefined) payload.status = patch.status
  try {
    const { error } = await supabase.from('haccp_documents').update(payload).eq('id', doc.id)
    if (error) throw error
    await loadHaccpDocs()
  } catch (err) {
    setMessage(`${code}: ${err.message}`)
  }
}

export function RMonthlyReportPreview({
  group, supabase, employees, loadHaccpDocs, setMessage, defaultEmployee
}) {
  const code = group.type
  const cfg = getRMonthlyConfig(code) || group.config
  if (!cfg) return <div>Brak konfiguracji {code}</div>

  const period = String(group.period || '')
  const year = period.slice(0, 4)
  const month = period.includes('Q') ? period.slice(5) : period.slice(5, 7)
  const docs = sortRMonthlyDocs(group.docs || [])
  const columns = group.columns || columnsFromDocs(code, docs)

  async function deleteMonth() {
    if (!supabase || !group?.docs?.length) return
    if (!window.confirm(`Usunąć kartotekę ${code} za ${group.period}?`)) return
    for (const doc of group.docs) {
      await supabase.from('haccp_documents').delete().eq('id', doc.id)
    }
    await loadHaccpDocs()
    setMessage(`${code}: usunięto.`)
  }

  async function addMissingDay(date) {
    const payload = buildRMonthlySingleDayPayload(code, period.replace(/-Q\d$/, '') || period.slice(0, 7), date, columns, defaultEmployee, isSundayDate(date))
    await supabase.from('haccp_documents').insert(payload)
    await loadHaccpDocs()
  }

  async function addControl(date) {
    const stations = columns
    const readings = {}
    stations.forEach(st => { readings[st.id] = { bait: '', rodents: false, state: '', notes: '' } })
    const payload = buildStationControlPayload(code, period, date, stations, readings, defaultEmployee)
    await supabase.from('haccp_documents').insert(payload)
    await loadHaccpDocs()
  }

  const head = (
    <table className="r13-head"><tbody><tr>
      <td className="r13-company"><b>AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.<br/>24-335 ŁAZISKA, KOLONIA ŁAZISKA 30<br/>NIP: 7171839598</b></td>
      <td className="r13-title"><b>{cfg.header.title}</b></td>
      <td className="r13-meta"><b>Rok:</b> {year}<br/><b>{cfg.periodMode === 'quarter' ? 'Kwartał' : 'Miesiąc'}:</b> {month}<br/><b>Wersja</b> {cfg.header.version}</td>
    </tr></tbody></table>
  )

  const toolbar = (
    <div className="no-print employee-signature-row" style={{ marginBottom: 10 }}>
      <span className="hint">{cfg.createHint}</span>
      <button className="secondary danger" onClick={deleteMonth}>Usuń kartotekę</button>
    </div>
  )

  if (cfg.layout === 'single-month') {
    const doc = docs[0]
    return <div className="monthly-paper r13-paper">{toolbar}{head}
      <label>Numer bieżący dokumentu<input className="cell-input" defaultValue={doc?.data?.document_no || ''} onBlur={e => saveDoc(supabase, doc, { document_no: e.target.value, nested: { document_no: e.target.value } }, undefined, loadHaccpDocs, setMessage, code)} /></label>
      <label>Obserwacje<textarea className="cell-input" rows={14} defaultValue={doc?.data?.observations || ''} onBlur={e => saveDoc(supabase, doc, { observations: e.target.value }, undefined, loadHaccpDocs, setMessage, code)} /></label>
      <label>{cfg.signLabel}<select className="mini-select" value={doc?.signed_by_operator || ''} onChange={e => saveDoc(supabase, doc, {}, e.target.value, loadHaccpDocs, setMessage, code)}>
        <option value="">Wybierz</option>{employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}
      </select></label>
    </div>
  }

  if (cfg.layout === 'register-rows') {
    const rows = docs.filter(d => !d.data?.is_shell)
    return <div className="monthly-paper r13-paper">{toolbar}{head}
      <table className="r13-table"><thead><tr><th>Lp.</th>{cfg.rowFields.map(f => <th key={f.key}>{f.label}</th>)}<th>{cfg.signLabel}</th></tr></thead>
        <tbody>{rows.map((doc, i) => (
          <tr key={doc.id}>
            <td>{i + 1}</td>
            {cfg.rowFields.map(f => (
              <td key={f.key}>
                {f.type === 'pn' ? (
                  <select className="mini-select no-print" value={formNormalizePn(doc.data?.[f.key] || 'P')} onChange={e => saveDoc(supabase, doc, { [f.key]: e.target.value, status: e.target.value }, undefined, loadHaccpDocs, setMessage, code)}>
                    <option value="P">P</option><option value="N">N</option>
                  </select>
                ) : f.type === 'date' ? (
                  <input type="date" className="cell-input no-print" defaultValue={doc.data?.[f.key] || doc.document_date} onBlur={e => saveDoc(supabase, doc, { [f.key]: e.target.value }, undefined, loadHaccpDocs, setMessage, code)} />
                ) : (
                  <input className="cell-input no-print" defaultValue={doc.data?.[f.key] || ''} onBlur={e => saveDoc(supabase, doc, { [f.key]: e.target.value }, undefined, loadHaccpDocs, setMessage, code)} />
                )}
                <span className="print-only">{doc.data?.[f.key] || ''}</span>
              </td>
            ))}
            <td>
              <select className="mini-select no-print" value={doc.signed_by_operator || ''} onChange={e => saveDoc(supabase, doc, {}, e.target.value, loadHaccpDocs, setMessage, code)}>
                <option value="">Wybierz</option>{employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}
              </select>
              <span className="print-only">{doc.signed_by_operator || ''}</span>
            </td>
          </tr>
        ))}</tbody></table>
      {cfg.summaryField && docs.find(d => d.data?.is_shell) && (
        <label>{cfg.summaryField.label}<textarea className="cell-input" rows={3} defaultValue={docs.find(d => d.data?.is_shell)?.data?.summary || ''} onBlur={e => saveDoc(supabase, docs.find(d => d.data?.is_shell), { summary: e.target.value }, undefined, loadHaccpDocs, setMessage, code)} /></label>
      )}
    </div>
  }

  if (cfg.layout === 'quarter-trend') {
    const doc = docs[0]
    const months = doc?.data?.months || []
    return <div className="monthly-paper r13-paper">{toolbar}{head}
      <table className="r13-table"><thead><tr><th>Lp.</th><th>Miesiąc</th><th>I. Stacje deratyzacyjne</th><th>II. Pułapki żywołowne</th><th>Trend I/II</th></tr></thead>
        <tbody>{months.map((m, i) => (
          <tr key={i}>
            <td>{i + 1}</td>
            <td><input className="cell-input" type="number" min={1} max={12} defaultValue={m.month || ''} onBlur={e => {
              const next = [...months]; next[i] = { ...next[i], month: e.target.value }
              saveDoc(supabase, doc, { months: next }, undefined, loadHaccpDocs, setMessage, code)
            }} /></td>
            <td><input className="cell-input" placeholder="Sztuk / stan / preparat / gryzonie" defaultValue={[m.derat_count, m.derat_tech, m.derat_bait, m.derat_rodents].filter(Boolean).join(' / ')} onBlur={e => {
              const next = [...months]; next[i] = { ...next[i], derat_summary: e.target.value }; saveDoc(supabase, doc, { months: next }, undefined, loadHaccpDocs, setMessage, code)
            }} /></td>
            <td><input className="cell-input" placeholder="Sztuk / gryzonie" defaultValue={[m.trap_count, m.trap_rodents].filter(Boolean).join(' / ')} onBlur={e => {
              const next = [...months]; next[i] = { ...next[i], trap_summary: e.target.value }; saveDoc(supabase, doc, { months: next }, undefined, loadHaccpDocs, setMessage, code)
            }} /></td>
            <td><input className="cell-input" defaultValue={m.trend || ''} onBlur={e => {
              const next = [...months]; next[i] = { ...next[i], trend: e.target.value }; saveDoc(supabase, doc, { months: next }, undefined, loadHaccpDocs, setMessage, code)
            }} /></td>
          </tr>
        ))}</tbody></table>
      <label>Uwagi<textarea className="cell-input" rows={2} defaultValue={doc?.data?.notes || ''} onBlur={e => saveDoc(supabase, doc, { notes: e.target.value }, undefined, loadHaccpDocs, setMessage, code)} /></label>
    </div>
  }

  if (cfg.layout === 'station-matrix') {
    const controls = docs.filter(d => d.data?.readings)
    return <div className="monthly-paper r13-paper">{toolbar}{head}
      <div className="no-print k03-bulk-row">
        <label>Data kontroli<input type="date" defaultValue={new Date().toISOString().slice(0, 10)} id={`${code}-ctrl-date`} /></label>
        <button type="button" onClick={() => {
          const el = document.getElementById(`${code}-ctrl-date`)
          if (el?.value) addControl(el.value)
        }}>Dodaj kontrolę</button>
      </div>
      {controls.map(doc => (
        <div key={doc.id} style={{ marginBottom: 16 }}>
          <h4>Kontrola: {formatRMonthlyPlDate(doc.document_date || doc.data?.control_date)}</h4>
          <table className="r13-table"><thead><tr><th>Nr stacji</th><th>Ubytek trutki *</th><th>Gryzonie **</th><th>Stan ***</th><th>Uwagi</th></tr></thead>
            <tbody>{columns.map(st => {
              const rd = doc.data?.readings?.[st.id] || {}
              return <tr key={st.id}>
                <td>{st.label}</td>
                <td><select className="mini-select" value={rd.bait || ''} onChange={e => {
                  const readings = { ...(doc.data?.readings || {}), [st.id]: { ...rd, bait: e.target.value } }
                  saveDoc(supabase, doc, { readings }, undefined, loadHaccpDocs, setMessage, code)
                }}><option value="">—</option>{cfg.baitOptions.filter(Boolean).map(o => <option key={o} value={o}>{o}%</option>)}</select></td>
                <td><input type="checkbox" checked={!!rd.rodents} onChange={e => {
                  const readings = { ...(doc.data?.readings || {}), [st.id]: { ...rd, rodents: e.target.checked } }
                  saveDoc(supabase, doc, { readings }, undefined, loadHaccpDocs, setMessage, code)
                }} /></td>
                <td><select className="mini-select" value={rd.state || ''} onChange={e => {
                  const readings = { ...(doc.data?.readings || {}), [st.id]: { ...rd, state: e.target.value } }
                  saveDoc(supabase, doc, { readings }, undefined, loadHaccpDocs, setMessage, code)
                }}><option value="">—</option>{cfg.stateOptions.filter(Boolean).map(o => <option key={o} value={o}>{o}</option>)}</select></td>
                <td><input className="cell-input" defaultValue={rd.notes || ''} onBlur={e => {
                  const readings = { ...(doc.data?.readings || {}), [st.id]: { ...rd, notes: e.target.value } }
                  saveDoc(supabase, doc, { readings }, undefined, loadHaccpDocs, setMessage, code)
                }} /></td>
              </tr>
            })}</tbody></table>
        </div>
      ))}
      {!controls.length && <p className="hint">Brak kontroli – dodaj datę kontroli powyżej.</p>}
    </div>
  }

  if (cfg.layout === 'grid-mcd-agent') {
    const calendar = buildCalendarRows(period.length === 7 ? period : `${period}-01`.slice(0, 7), docs)
    const monthKey = period.length === 7 ? period : period.slice(0, 7)
    return <div className="monthly-paper r02-paper r13-paper">{toolbar}{head}
      <table className="r13-table"><thead><tr><th>Lp.</th><th>Dzień</th>
        {columns.map(col => <th key={col.id}>{col.label}<br/><small>M/C + środek</small></th>)}
        <th>{cfg.signLabel}</th></tr></thead>
        <tbody>{calendar.map(row => {
          const doc = row.doc
          const off = row.isSunday
          if (!doc) return <tr key={row.date} className={`${off ? 'r13-day-off' : ''} r13-missing no-print`}><td>{row.lp}</td><td>{formatRMonthlyPlDate(row.date)}</td>
            {columns.map(col => <td key={col.id}>—</td>)}<td><button type="button" className="mini secondary" onClick={() => addMissingDay(row.date)}>Dodaj</button></td></tr>
          const isOff = off || doc.data?.is_day_off
          return <tr key={doc.id} className={isOff ? 'r13-day-off' : ''}><td>{row.lp}</td>
            <td><span className="print-only">{formatRMonthlyPlDate(doc.document_date)}</span>
              <input className="cell-input no-print" type="date" defaultValue={doc.document_date} readOnly /></td>
            {columns.map(col => {
              const cell = doc.data?.cells?.[col.id] || {}
              return <td key={col.id}>
                <select className="mini-select no-print" value={cell.mcd || ''} onChange={e => {
                  const cells = { ...(doc.data?.cells || {}), [col.id]: { ...cell, mcd: e.target.value } }
                  saveDoc(supabase, doc, { cells }, undefined, loadHaccpDocs, setMessage, code)
                }}>{cfg.mcdOptions.map(o => <option key={o || 'e'} value={o}>{o || '—'}</option>)}</select>
                <input className="cell-input no-print" placeholder="Środek" defaultValue={cell.agent || ''} onBlur={e => {
                  const cells = { ...(doc.data?.cells || {}), [col.id]: { ...cell, agent: e.target.value } }
                  saveDoc(supabase, doc, { cells }, undefined, loadHaccpDocs, setMessage, code)
                }} />
              </td>
            })}
            <td><select className="mini-select no-print" value={doc.signed_by_operator || ''} onChange={e => saveDoc(supabase, doc, {}, e.target.value, loadHaccpDocs, setMessage, code)}>
              <option value="">Wybierz</option>{employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}</select></td>
          </tr>
        })}</tbody></table>
      <div className="r13-legend">{cfg.mcdLegend}</div>
    </div>
  }

  if (cfg.layout === 'daily-employees') {
    const calendar = buildCalendarRows(period, docs)
    const slots = cfg.employeeSlots || 12
    return <div className="monthly-paper r13-paper">{toolbar}{head}
      <p className="hint no-print">Edycja pierwszych 4 miejsc na ekranie; pełna lista 12 w danych. * P/N odzieży roboczej.</p>
      <table className="r13-table"><thead><tr><th>Data</th><th>Godzina</th>
        {[1, 2, 3, 4].map(n => <th key={n} colSpan={2}>Nr {n} (nazwisko / P/N)</th>)}
        <th>{cfg.signLabel}</th></tr></thead>
        <tbody>{calendar.map(row => {
          const doc = row.doc
          const off = row.isSunday
          if (!doc) return <tr key={row.date} className={`${off ? 'r13-day-off' : ''} no-print`}><td>{formatRMonthlyPlDate(row.date)}</td><td colSpan={9}><button type="button" className="mini secondary" onClick={() => addMissingDay(row.date)}>Dodaj dzień</button></td></tr>
          const emps = doc.data?.employees || []
          const isOff = off || doc.data?.is_day_off
          return <tr key={doc.id} className={isOff ? 'r13-day-off' : ''}>
            <td>{formatRMonthlyPlDate(doc.document_date)}</td>
            <td><input className="cell-input no-print" defaultValue={doc.data?.godzina || ''} onBlur={e => saveDoc(supabase, doc, { godzina: e.target.value }, undefined, loadHaccpDocs, setMessage, code)} /></td>
            {[0, 1, 2, 3].map(idx => {
              const e = emps[idx] || { name: '', clothing: '' }
              return <React.Fragment key={idx}>
                <td><input className="cell-input no-print" defaultValue={e.name || ''} onBlur={ev => {
                  const employees = [...emps]; while (employees.length < slots) employees.push({ slot: employees.length + 1, name: '', clothing: '' })
                  employees[idx] = { ...employees[idx], name: ev.target.value }
                  saveDoc(supabase, doc, { employees }, undefined, loadHaccpDocs, setMessage, code)
                }} /></td>
                <td><select className="mini-select no-print" value={e.clothing || ''} onChange={ev => {
                  const employees = [...emps]; while (employees.length < slots) employees.push({ slot: employees.length + 1, name: '', clothing: '' })
                  employees[idx] = { ...employees[idx], clothing: ev.target.value }
                  saveDoc(supabase, doc, { employees }, undefined, loadHaccpDocs, setMessage, code)
                }}><option value="">—</option><option value="P">P</option><option value="N">N</option></select></td>
              </React.Fragment>
            })}
            <td><select className="mini-select no-print" value={doc.signed_by_operator || ''} onChange={e => saveDoc(supabase, doc, {}, e.target.value, loadHaccpDocs, setMessage, code)}>
              <option value="">Wybierz</option>{employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}</select></td>
          </tr>
        })}</tbody></table>
    </div>
  }

  if (cfg.layout === 'daily-calibration') {
    const calendar = buildCalendarRows(period, docs)
    const chambers = cfg.chambers || []
    return <div className="monthly-paper r13-paper">{toolbar}{head}
      <table className="r13-table"><thead><tr><th>Data</th><th>Waga (odczyt)</th>
        {chambers.slice(1).map(ch => <th key={ch.id}>{ch.label}<br/><small>w chłodni / P-W</small></th>)}
        <th>{cfg.signLabel}</th></tr></thead>
        <tbody>{calendar.map(row => {
          const doc = row.doc
          const off = row.isSunday
          if (!doc) return <tr key={row.date} className={`${off ? 'r13-day-off' : ''} no-print`}><td>{formatRMonthlyPlDate(row.date)}</td><td colSpan={6}><button type="button" className="mini secondary" onClick={() => addMissingDay(row.date)}>Dodaj</button></td></tr>
          const cal = doc.data?.calibration || {}
          const isOff = off || doc.data?.is_day_off
          return <tr key={doc.id} className={isOff ? 'r13-day-off' : ''}>
            <td>{formatRMonthlyPlDate(doc.document_date)}</td>
            <td><input className="cell-input" defaultValue={cal.scale_reading || ''} onBlur={e => saveDoc(supabase, doc, { calibration: { ...cal, scale_reading: e.target.value } }, undefined, loadHaccpDocs, setMessage, code)} /></td>
            {chambers.slice(1).map(ch => {
              const c = cal.chambers?.[ch.id] || {}
              return <td key={ch.id}>
                <input className="cell-input" placeholder="Wskazanie" defaultValue={c.reading || ''} onBlur={e => {
                  const chambersData = { ...(cal.chambers || {}), [ch.id]: { ...c, reading: e.target.value } }
                  saveDoc(supabase, doc, { calibration: { ...cal, chambers: chambersData } }, undefined, loadHaccpDocs, setMessage, code)
                }} />
                <select className="mini-select" value={c.action || ''} onChange={e => {
                  const chambersData = { ...(cal.chambers || {}), [ch.id]: { ...c, action: e.target.value } }
                  saveDoc(supabase, doc, { calibration: { ...cal, chambers: chambersData } }, undefined, loadHaccpDocs, setMessage, code)
                }}>{cfg.pwOptions.map(o => <option key={o || 'e'} value={o}>{o || '—'}</option>)}</select>
              </td>
            })}
            <td><select className="mini-select" value={doc.signed_by_operator || ''} onChange={e => saveDoc(supabase, doc, {}, e.target.value, loadHaccpDocs, setMessage, code)}>
              <option value="">Wybierz</option>{employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}</select></td>
          </tr>
        })}</tbody></table>
      <p className="r13-legend">* P – dalsze użytkowanie; W – wymiana/naprawa</p>
    </div>
  }

  return <div>Brak podglądu dla układu {cfg.layout}</div>
}
