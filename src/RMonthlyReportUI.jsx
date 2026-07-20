import React, { useEffect, useState } from 'react'
import { Eye, Printer, Trash2 } from 'lucide-react'
import { normalizePn as formNormalizePn } from './haccpFormsEngine'
import { isSundayDate, calendarDaysInMonth } from './r13Engine'
import {
  R_MONTHLY_ENGINE_VERSION,
  loadRMonthlyColumns,
  saveRMonthlyColumns,
  rMonthlyMakeColumn,
  buildRMonthlyMonthPayloads,
  buildRMonthlySingleDayPayload,
  buildRegisterRowPayload,
  sortRMonthlyDocs,
  buildCalendarRows,
  formatRMonthlyPlDate,
  columnsFromDocs,
  makeR03RegisterKey,
  buildR03VehicleColumn,
  r08MakeChamber,
  r04MakeStation,
  buildR04ControlPayload,
  defaultR04Reading,
  resolveR04Stations,
  findPreviousR04Control,
  r00MakeEmployeeColumn,
  r00ResolveColumns,
  r00ClothingMap,
  r00ColumnBulkClothing,
  buildR00K01Context,
  resolveRMonthlyGroupDeleteDocs,
  R00_DEFAULT_GODZINA
} from './rMonthlyEngine'
import { getRMonthlyConfig, isRMonthlyReport } from './rMonthlyConfigs'
import {
  buildR11CalendarRows, r11MagnetsForDoc, r11UwagiForDoc,
  r11MakeColumn, R11_HEADER, resolveR11Columns, buildR11SparseDisplayRows,
  buildR11ManualRowPayload
} from './r11Engine'
import { confirmDelete } from './authEngine'
import { batchInsertHaccpDocuments } from './haccpLoadHelpers'
import { KartotekaPrintBadge } from './KartotekaPrintBadge'

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

async function deleteRMonthlyMonthGroup({
  code, group, haccpDocs, supabase, allowDelete, onAuditDelete,
  mergeHaccpDocsBatch, loadHaccpDocs, setMessage, setSelectedHaccpDoc
}) {
  if (!supabase || !group?.period) return
  if (!allowDelete) {
    setMessage('Tylko administrator może usuwać kartoteki.')
    return
  }
  const docsToDelete = resolveRMonthlyGroupDeleteDocs(code, haccpDocs, group)
  if (!docsToDelete.length) {
    setMessage(`${code}: brak wpisów do usunięcia. Odśwież listę i spróbuj ponownie.`)
    return
  }
  const label = group.displayLabel || group.period
  if (!confirmDelete(`Całą kartotekę ${code} za ${label} (${docsToDelete.length} wpisów).\n\nWpis trafi do historii.`)) return
  try {
    if (onAuditDelete) await onAuditDelete(docsToDelete, `${code} ${group.period}`)
    else {
      for (const doc of docsToDelete) {
        const { error } = await supabase.from('haccp_documents').delete().eq('id', doc.id)
        if (error) throw error
      }
    }
    const removedIds = docsToDelete.map(d => d.id)
    if (mergeHaccpDocsBatch) mergeHaccpDocsBatch([], removedIds)
    setSelectedHaccpDoc?.(null)
    setMessage(`${code}: usunięto kartotekę (${docsToDelete.length} wpisów).`)
    loadHaccpDocs({ force: true }).catch(() => {})
  } catch (err) {
    setMessage(`${code}: ${err.message}`)
  }
}

export function RMonthlyReportSection({
  code, supabase, employees, haccpDocs, hubManualGroups, loadHaccpDocs, mergeHaccpDoc, mergeHaccpDocsBatch, setMessage,
  setSelectedHaccpDoc, printHaccpGroup, exportHaccpGroupExcel,
  allowDelete = false, onAuditDelete, kartotekaLocalPrints = {}, onTogglePrintStatus
}) {
  const cfg = getRMonthlyConfig(code)
  const [newMonth, setNewMonth] = useState(new Date().toISOString().slice(0, 7))
  const [creating, setCreating] = useState(false)
  const [columnDefs, setColumnDefs] = useState(() => loadRMonthlyColumns(code))
  const [newColumnLabel, setNewColumnLabel] = useState('')
  const [newChamberKind, setNewChamberKind] = useState('raw')
  const [newStationKind, setNewStationKind] = useState('derat')
  const [defaultEmployee, setDefaultEmployee] = useState('')
  const [newRow, setNewRow] = useState(() => defaultNewRow(cfg))
  const [newControlDate, setNewControlDate] = useState(new Date().toISOString().slice(0, 10))
  const [newVehicleReg, setNewVehicleReg] = useState('')
  const [r00PickEmployee, setR00PickEmployee] = useState('')
  const [r00FillFromK01, setR00FillFromK01] = useState(true)

  if (!cfg) return null

  const isR03MultiVehicle = code === 'R03'

  function shiftMonth(delta) {
    const [y, m] = newMonth.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setNewMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  async function createMonth() {
    if (creating) return
    if (!supabase) { setMessage(`${code}: brak połączenia z bazą.`); return }
    const period = cfg.periodMode === 'quarter'
      ? (() => { const [y, m] = newMonth.split('-').map(Number); return `${y}-Q${Math.ceil(m / 3)}` })()
      : newMonth

    if (isR03MultiVehicle) {
      const vehicleReg = String(newVehicleReg || '').trim()
      if (!vehicleReg) { setMessage('R03: podaj numer rejestracyjny samochodu.'); return }
      if (!defaultEmployee) { setMessage('R03: wybierz kierowcę z listy.'); return }
      const dup = (haccpDocs || []).some(d =>
        d.document_type === 'R03'
        && (d.data?.month_key === newMonth || String(d.document_date || '').slice(0, 7) === newMonth)
        && String(d.data?.vehicle_reg_no || '').trim().toLowerCase() === vehicleReg.toLowerCase()
      )
      if (dup) { setMessage(`R03: kartoteka dla ${vehicleReg} w ${newMonth} już istnieje.`); return }
    }

    const existing = isR03MultiVehicle ? [] : (haccpDocs || []).filter(d => d.document_type === code && (
      d.data?.month_key === newMonth || d.data?.quarter_key === period || d.data?.month_key === period
    ))
    if (existing.length) {
      if (!allowDelete) { setMessage('Tylko administrator może nadpisać istniejącą kartotekę.'); return }
      if (!confirmDelete(`Kartotekę ${code} za ${period} (${existing.length} wpisów) przed utworzeniem nowej.`)) return
    }
    setCreating(true)
    try {
      const removedIds = []
      if (existing.length) {
        for (const doc of existing) {
          const { error } = await supabase.from('haccp_documents').delete().eq('id', doc.id)
          if (error) throw error
          removedIds.push(doc.id)
        }
      }
      const r03Options = isR03MultiVehicle
        ? { vehicleRegNo: String(newVehicleReg || '').trim(), registerKey: makeR03RegisterKey(newVehicleReg) }
        : (code === 'R00' && r00FillFromK01 ? { fillFromK01: true } : {})
      const r03Columns = isR03MultiVehicle ? [buildR03VehicleColumn(newVehicleReg)] : columnDefs
      const r00K01Ctx = code === 'R00' && r00FillFromK01 ? buildR00K01Context(haccpDocs, newMonth) : null
      const payloads = buildRMonthlyMonthPayloads(code, newMonth, defaultEmployee, r03Columns, haccpDocs, r03Options)
      const skipDupCheck = ['single-month', 'register-rows', 'quarter-trend', 'station-matrix', 'r04-control'].includes(cfg.layout) || isR03MultiVehicle
      const registerKey = r03Options.registerKey
      const existingDates = new Set(
        skipDupCheck ? [] : (haccpDocs || []).filter(d => {
          if (d.document_type !== code) return false
          if (isR03MultiVehicle) return d.data?.register_key === registerKey
          return true
        }).map(d => d.document_date)
      )
      const toInsert = skipDupCheck
        ? payloads
        : payloads.filter(p => !existingDates.has(p.document_date))
      if (!toInsert.length && !removedIds.length) {
        setMessage(`${code}: brak nowych wpisów do utworzenia.`)
        return
      }
      const { rows } = toInsert.length ? await batchInsertHaccpDocuments(supabase, toInsert) : { rows: [] }
      if (mergeHaccpDocsBatch) {
        mergeHaccpDocsBatch(rows, removedIds)
      } else {
        await loadHaccpDocs()
      }
      if (isR03MultiVehicle) setNewVehicleReg('')
      if (code === 'R00' && r00K01Ctx?.columns?.length) setColumnDefs(r00K01Ctx.columns.map(c => ({ ...c })))
      let extra = ''
      if (code === 'R00' && r00FillFromK01) {
        if (r00K01Ctx?.employeeCount) {
          extra = ` — z K01: ${r00K01Ctx.employeeCount} pracowników, P w ${r00K01Ctx.receiptDays} dniach przyjęć (${r00K01Ctx.k01Count} wpisów K01).`
        } else {
          extra = ' — brak podpisów przyjmujących w K01 za ten miesiąc (utworzono domyślny układ).'
        }
      }
      setMessage(`${code}: utworzono kartotekę (${rows.length} wpisów)${isR03MultiVehicle ? ` – ${r03Options.vehicleRegNo}, kierowca: ${defaultEmployee}` : defaultEmployee ? `, podpis: ${defaultEmployee}` : ''}${extra}.`)
    } catch (err) {
      setMessage(`${code}: ${err.message}`)
    } finally {
      setCreating(false)
    }
  }

  async function deleteMonth(group) {
    await deleteRMonthlyMonthGroup({
      code, group, haccpDocs, supabase, allowDelete, onAuditDelete,
      mergeHaccpDocsBatch, loadHaccpDocs, setMessage, setSelectedHaccpDoc
    })
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
    if (code !== 'R00' && !allowDelete) { setMessage('Tylko administrator może zmieniać strukturę kartoteki.'); return }
    if (code === 'R08') {
      addR08Chamber(newChamberKind)
      return
    }
    if (code === 'R04') {
      addR04Station(newStationKind)
      return
    }
    if (code === 'R11') {
      const col = r11MakeColumn(newColumnLabel)
      const next = [...columnDefs, col]
      saveRMonthlyColumns(code, next)
      setColumnDefs(next)
      setNewColumnLabel('')
      setMessage(`${code}: dodano kolumnę „${col.label}”.`)
      return
    }
    if (code === 'R00') {
      const name = String(newColumnLabel || r00PickEmployee || '').trim()
      if (!name) { setMessage('R00: wybierz pracownika z listy lub wpisz imię i nazwisko.'); return }
      const col = r00MakeEmployeeColumn(name, columnDefs)
      const next = [...columnDefs, col]
      saveRMonthlyColumns(code, next)
      setColumnDefs(next)
      setNewColumnLabel('')
      setR00PickEmployee('')
      setMessage(`R00: dodano pracownika „${col.label}".`)
      return
    }
    const col = rMonthlyMakeColumn(newColumnLabel, code.toLowerCase())
    const next = [...columnDefs, col]
    saveRMonthlyColumns(code, next)
    setColumnDefs(next)
    setNewColumnLabel('')
    setMessage(`${code}: dodano kolumnę "${col.label}".`)
  }

  function addR08Chamber(kind) {
    const col = r08MakeChamber(kind, columnDefs)
    if (!col) return
    const next = [...columnDefs, col]
    saveRMonthlyColumns(code, next)
    setColumnDefs(next)
    setMessage(`${code}: dodano ${col.label}.`)
  }

  function addR04Station(kind) {
    const col = r04MakeStation(kind, columnDefs)
    if (!col) return
    const next = [...columnDefs, col]
    saveRMonthlyColumns(code, next)
    setColumnDefs(next)
    setMessage(`${code}: dodano ${col.label}.`)
  }

  const colPanel = (cfg.layout === 'daily-employees' || (allowDelete && !isR03MultiVehicle && (cfg.defaultColumns || cfg.defaultStations || cfg.defaultChambers || cfg.layout === 'r04-control' || cfg.layout === 'r11-magnets') && cfg.storageKey)) ? (
    <div className="r13-columns-panel">
      <b>{code === 'R00' ? 'Pracownicy (kolumny u góry tabeli – jak we wzorze Word):' : `${cfg.columnLabel || 'Stacje'}:`}</b>
      <div className="r13-columns-list">
        {columnDefs.map((col, i) => (
          <span key={col.id} className="r13-column-chip">{col.label || (code === 'R00' ? `Nr ${i + 1}` : col.label)}
            {(allowDelete || code === 'R00') && columnDefs.length > 1 && allowDelete && <button type="button" className="mini danger" onClick={() => {
              if (!confirmDelete(`„${col.label || `Nr ${i + 1}`}" z domyślnych kolumn ${code}.`)) return
              const next = columnDefs.filter(c => c.id !== col.id)
              saveRMonthlyColumns(code, next)
              setColumnDefs(next)
            }}>×</button>}
          </span>
        ))}
      </div>
      {code === 'R00' ? (
        <div className="r13-add-column-row r00-add-employee-row">
          <label>Z listy pracowników
            <select value={r00PickEmployee} onChange={e => { setR00PickEmployee(e.target.value); if (e.target.value) setNewColumnLabel('') }}>
              <option value="">— wybierz —</option>
              {employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}
            </select>
          </label>
          <label>Lub wpisz ręcznie
            <input value={newColumnLabel} onChange={e => { setNewColumnLabel(e.target.value); setR00PickEmployee('') }} placeholder="Imię i nazwisko" />
          </label>
          <button type="button" className="secondary" onClick={addDefaultColumn}>Dodaj pracownika</button>
          <p className="hint">Domyślnie 8 kolumn; możesz dodać dowolnie wiele. Dni robocze: godz. {R00_DEFAULT_GODZINA}. Przy tworzeniu kartoteki zaznacz „Z K01”, aby dodać pracowników z przyjęć i ustawić P w dniach przyjęcia surowca.</p>
        </div>
      ) : code === 'R08' ? (
        <div className="r13-add-column-row">
          <label>Typ chłodni
            <select value={newChamberKind} onChange={e => setNewChamberKind(e.target.value)}>
              {(cfg.chamberTypes || []).map(t => (
                <option key={t.kind} value={t.kind}>
                  {t.kind === 'raw' ? 'Chłodnia surowców (kolejna)' : 'Chłodnia produktów gotowych (kolejna)'}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="secondary" onClick={addDefaultColumn}>{cfg.addColumnLabel || 'Dodaj chłodnię'}</button>
        </div>
      ) : code === 'R04' ? (
        <div className="r13-add-column-row">
          <label>Typ stacji
            <select value={newStationKind} onChange={e => setNewStationKind(e.target.value)}>
              {(cfg.stationTypes || []).map(t => (
                <option key={t.kind} value={t.kind}>{t.label}</option>
              ))}
            </select>
          </label>
          <button type="button" className="secondary" onClick={addDefaultColumn}>{cfg.addColumnLabel || 'Dodaj stację'}</button>
          <p className="hint">Domyślnie 20 stacji deratyzacyjnych + 6 pułapek żywołownych. Nowy miesiąc kopiuje listę z poprzedniego.</p>
        </div>
      ) : (
        <div className="r13-add-column-row">
          <input value={newColumnLabel} onChange={e => setNewColumnLabel(e.target.value)} placeholder="Dodaj…" />
          <button type="button" className="secondary" onClick={addDefaultColumn} disabled={!newColumnLabel.trim()}>{cfg.addColumnLabel || 'Dodaj'}</button>
        </div>
      )}
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

  const periodLabel = cfg.periodMode === 'quarter' ? 'Kwartał (wybierz miesiąc)' : 'Rok i miesiąc'

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
        {isR03MultiVehicle && (
          <label>Nr rejestracyjny samochodu
            <input value={newVehicleReg} onChange={e => setNewVehicleReg(e.target.value)} placeholder="np. WGM 12345" />
          </label>
        )}
        <label>{isR03MultiVehicle ? 'Kierowca' : cfg.signLabel}
          <select value={defaultEmployee} onChange={e => setDefaultEmployee(e.target.value)}>
            <option value="">Wybierz pracownika</option>
            {employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}
          </select>
        </label>
        {code === 'R00' && (
          <label className="r00-k01-fill-toggle">
            <input type="checkbox" checked={r00FillFromK01} onChange={e => setR00FillFromK01(e.target.checked)} />
            Uzupełnij pracowników i dni przyjęć z K01
          </label>
        )}
        <button onClick={createMonth} disabled={creating}>{creating ? 'Tworzenie…' : isR03MultiVehicle ? 'Utwórz kartotekę samochodu' : 'Utwórz kartotekę'}</button>
      </div>
      <p className="hint">Silnik kartotek: {R_MONTHLY_ENGINE_VERSION}</p>
    </div>
    {registerAdd}
    {hubManualGroups.length === 0 && <p className="hint">Brak kartotek {code} – utwórz powyżej.</p>}
    {hubManualGroups.length > 0 && <>
      <h3>Lista kartotek {code}</h3>
      <div className="table-wrap docs-table-wrap"><table className="docs-table">
        <thead><tr>
          <th>Okres</th>
          {isR03MultiVehicle && <th>Samochód</th>}
          {isR03MultiVehicle && <th>Kierowca</th>}
          <th>Wpisy</th><th>Akcje</th>
        </tr></thead>
        <tbody>{hubManualGroups.map(g => (
          <tr key={g.key}>
            <td><b>{g.displayLabel || g.period}</b><KartotekaPrintBadge group={g} localPrints={kartotekaLocalPrints} onToggle={onTogglePrintStatus} /></td>
            {isR03MultiVehicle && <td>{g.vehicleRegNo || '—'}</td>}
            {isR03MultiVehicle && <td>{g.driver || '—'}</td>}
            <td>{g.docs.filter(d => !d.data?.is_shell).length || g.docs.length}</td>
            <td className="row-actions">
              <button className="mini secondary" onClick={() => setSelectedHaccpDoc({ groupPreview: true, group: g })}><Eye size={14}/> Otwórz</button>
              <button className="mini secondary" onClick={() => printHaccpGroup(g)}><Printer size={14}/></button>
              <button className="mini secondary" onClick={() => exportHaccpGroupExcel(g)}>XLS</button>
              {allowDelete && <button className="mini danger" onClick={() => deleteMonth(g)}><Trash2 size={14}/> Usuń</button>}
            </td>
          </tr>
        ))}</tbody>
      </table></div>
    </>}
  </>
}

async function saveDoc(supabase, doc, patch, signedBy, loadHaccpDocs, setMessage, code, mergeHaccpDoc) {
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
    if (mergeHaccpDoc) mergeHaccpDoc(doc.id, payload)
    else await loadHaccpDocs()
  } catch (err) {
    setMessage(`${code}: ${err.message}`)
  }
}

export function RMonthlyReportPreview({
  group, supabase, employees, haccpDocs, loadHaccpDocs, mergeHaccpDoc, mergeHaccpDocsBatch, setMessage, defaultEmployee,
  allowDelete = false, onAuditDelete, setSelectedHaccpDoc
}) {
  const code = group.type
  const cfg = getRMonthlyConfig(code) || group.config
  const docs = sortRMonthlyDocs(group.docs || [])
  const singleDoc = cfg?.layout === 'single-month' ? docs[0] : null
  const [singleForm, setSingleForm] = useState(() => {
    const init = {}
    for (const f of cfg?.fields || []) init[f.key] = singleDoc?.data?.[f.key] || ''
    if (!init.document_no && singleDoc?.data?.document_no) init.document_no = singleDoc.data.document_no
    if (!init.observations && singleDoc?.data?.observations) init.observations = singleDoc.data.observations
    return init
  })
  const [previewChamberKind, setPreviewChamberKind] = useState('raw')
  const [previewStationKind, setPreviewStationKind] = useState('derat')
  const [newColumnLabel, setNewColumnLabel] = useState('')
  const [newControlDate, setNewControlDate] = useState(new Date().toISOString().slice(0, 10))
  const [r00PickEmployee, setR00PickEmployee] = useState('')

  useEffect(() => {
    if (cfg?.layout !== 'single-month' || !singleDoc) return
    const next = {}
    for (const f of cfg.fields || []) next[f.key] = singleDoc.data?.[f.key] || ''
    setSingleForm(next)
  }, [cfg?.layout, singleDoc?.id, singleDoc?.updated_at])

  if (!cfg) return <div>Brak konfiguracji {code}</div>

  const period = String(group.period || '')
  const year = period.slice(0, 4)
  const month = period.includes('Q') ? period.slice(5) : period.slice(5, 7)
  const columns = code === 'R00'
    ? r00ResolveColumns(docs, group.columns || columnsFromDocs(code, docs))
    : (group.columns || columnsFromDocs(code, docs))

  async function syncR00ColumnsToGroup(nextCols) {
    if (!supabase || code !== 'R00') return
    saveRMonthlyColumns(code, nextCols)
    try {
      for (const doc of docs) {
        const clothing = { ...(doc.data?.clothing || {}) }
        for (const col of nextCols) {
          if (clothing[col.id] === undefined && !doc.data?.is_day_off) clothing[col.id] = 'P'
        }
        for (const key of Object.keys(clothing)) {
          if (!nextCols.some(c => c.id === key)) delete clothing[key]
        }
        const payload = {
          data: { ...(doc.data || {}), columns: nextCols.map(c => ({ ...c })), clothing },
          updated_at: new Date().toISOString()
        }
        const { error } = await supabase.from('haccp_documents').update(payload).eq('id', doc.id)
        if (error) throw error
        if (mergeHaccpDoc) mergeHaccpDoc(doc.id, payload)
      }
      if (!mergeHaccpDoc) await loadHaccpDocs()
    } catch (err) {
      setMessage(`R00: ${err.message}`)
    }
  }

  async function updateR00ColumnLabel(colId, label) {
    const nextCols = columns.map(c => c.id === colId ? { ...c, label: String(label || '').trim() } : c)
    await syncR00ColumnsToGroup(nextCols)
  }

  async function addR00ColumnToGroup(name) {
    const trimmed = String(name || '').trim()
    if (!trimmed) { setMessage('R00: wybierz z listy lub wpisz imię i nazwisko.'); return }
    const col = r00MakeEmployeeColumn(trimmed, columns)
    await syncR00ColumnsToGroup([...columns, col])
    setNewColumnLabel('')
    setR00PickEmployee('')
    setMessage(`R00: dodano pracownika „${col.label}”.`)
  }

  async function removeR00Column(colId) {
    if (columns.length <= 1) { setMessage('R00: musi zostać co najmniej jeden pracownik.'); return }
    if (!confirmDelete('Kolumnę pracownika z tej kartoteki.')) return
    await syncR00ColumnsToGroup(columns.filter(c => c.id !== colId))
  }

  async function applyR00ColumnClothing(colId, clothingValue, colLabel) {
    if (!supabase) return
    const dayDocs = docs.filter(d => !d.data?.is_day_off && !isSundayDate(d.document_date))
    if (!dayDocs.length) {
      setMessage('R00: brak dni roboczych do uzupełnienia.')
      return
    }
    const label = clothingValue === 'P' ? 'P' : '—'
    try {
      for (const doc of dayDocs) {
        const clothing = { ...(doc.data?.clothing || {}), [colId]: clothingValue }
        const payload = { data: { ...(doc.data || {}), clothing }, updated_at: new Date().toISOString() }
        const { error } = await supabase.from('haccp_documents').update(payload).eq('id', doc.id)
        if (error) throw error
        if (mergeHaccpDoc) mergeHaccpDoc(doc.id, payload)
      }
      if (!mergeHaccpDoc) await loadHaccpDocs()
      setMessage(`R00: kolumna „${colLabel || 'pracownik'}” — wszędzie ${label} (${dayDocs.length} dni roboczych). Pojedyncze komórki możesz zmienić ręcznie.`)
    } catch (err) {
      setMessage(`R00: ${err.message}`)
    }
  }

  async function applyColumnMcd(colId, mcdValue, colLabel) {
    if (!supabase || !mcdValue) return
    const dayDocs = docs.filter(d => d.data?.cells && !d.data?.is_day_off)
    if (!dayDocs.length) { setMessage(`${code}: brak dni roboczych do uzupełnienia.`); return }
    if (!window.confirm(`Ustawić „${mcdValue}" we wszystkich dniach roboczych kolumny „${colLabel}"? (${dayDocs.length} dni)`)) return
    try {
      for (const doc of dayDocs) {
        const cells = { ...(doc.data?.cells || {}) }
        cells[colId] = { ...(cells[colId] || {}), mcd: mcdValue }
        const payload = { data: { ...(doc.data || {}), cells }, updated_at: new Date().toISOString() }
        const { error } = await supabase.from('haccp_documents').update(payload).eq('id', doc.id)
        if (error) throw error
        if (mergeHaccpDoc) mergeHaccpDoc(doc.id, payload)
      }
      setMessage(`${code}: ustawiono ${mcdValue} w kolumnie „${colLabel}" (${dayDocs.length} dni). Możesz zmienić pojedyncze komórki ręcznie.`)
    } catch (err) {
      setMessage(`${code}: ${err.message}`)
    }
  }

  async function saveSingleField(doc, key, value) {
    if (!doc) return
    const patch = { [key]: value }
    if (key === 'document_no') patch.nested = { document_no: value }
    await saveDoc(supabase, doc, patch, undefined, loadHaccpDocs, setMessage, code, mergeHaccpDoc)
  }

  async function deleteMonth() {
    await deleteRMonthlyMonthGroup({
      code, group, haccpDocs, supabase, allowDelete, onAuditDelete,
      mergeHaccpDocsBatch, loadHaccpDocs, setMessage, setSelectedHaccpDoc
    })
  }

  async function addMissingDay(date) {
    const monthKey = period.replace(/-Q\d$/, '') || period.slice(0, 7)
    const meta = docs[0]?.data || {}
    const payload = buildRMonthlySingleDayPayload(code, monthKey, date, columns, defaultEmployee, isSundayDate(date), {
      register_key: meta.register_key,
      vehicle_reg_no: meta.vehicle_reg_no,
      driver: meta.driver
    })
    await supabase.from('haccp_documents').insert(payload)
    await loadHaccpDocs()
  }

  async function addControl(date) {
    if (!supabase) return
    const existing = sortRMonthlyDocs(docs.filter(d => !d.data?.is_shell && d.data?.stations))
    const stations = existing.length
      ? (existing[existing.length - 1].data?.stations || columns).map(s => ({ ...s }))
      : (columns.length ? columns : resolveR04Stations([], period, [])).map(s => ({ ...s }))
    const copyFrom = existing.length
      ? existing[existing.length - 1]
      : findPreviousR04Control(haccpDocs, period)
    const payload = buildR04ControlPayload(period, date, stations, defaultEmployee, '', copyFrom)
    const { error } = await supabase.from('haccp_documents').insert(payload)
    if (error) { setMessage(`${code}: ${error.message}`); return }
    await loadHaccpDocs()
    setMessage(`${code}: dodano kontrolę na ${formatRMonthlyPlDate(date)} (${stations.length} stacji).`)
  }

  async function saveR04ControlDate(doc, date) {
    if (!supabase || !doc?.id) return
    const { error } = await supabase.from('haccp_documents').update({
      document_date: date,
      data: { ...(doc.data || {}), control_date: date },
      updated_at: new Date().toISOString()
    }).eq('id', doc.id)
    if (error) setMessage(`${code}: ${error.message}`)
    else await loadHaccpDocs()
  }

  async function deleteControl(doc) {
    if (!supabase || !doc?.id) return
    if (!allowDelete) { setMessage('Tylko administrator może usuwać.'); return }
    if (!confirmDelete(`Kontrolę z dnia ${formatRMonthlyPlDate(doc.data?.control_date || doc.document_date)}.`)) return
    if (onAuditDelete) await onAuditDelete([doc], `${code} kontrola`)
    else await supabase.from('haccp_documents').delete().eq('id', doc.id)
    await loadHaccpDocs()
    setMessage(`${code}: usunięto kontrolę.`)
  }

  function saveR04Reading(doc, stId, patch) {
    const readings = { ...(doc.data?.readings || {}), [stId]: { ...(doc.data?.readings?.[stId] || defaultR04Reading(cfg)), ...patch } }
    saveDoc(supabase, doc, { readings }, undefined, loadHaccpDocs, setMessage, code, mergeHaccpDoc)
  }

  async function addR04StationToDoc(doc, kind) {
    if (!supabase || !doc) return
    const stations = [...(doc.data?.stations || columns)]
    const col = r04MakeStation(kind, stations)
    if (!col) return
    const next = [...stations, col]
    const readings = { ...(doc.data?.readings || {}), [col.id]: defaultR04Reading(cfg) }
    saveRMonthlyColumns(code, next)
    const { error } = await supabase.from('haccp_documents').update({
      data: { ...(doc.data || {}), stations: next, readings },
      updated_at: new Date().toISOString()
    }).eq('id', doc.id)
    if (error) { setMessage(`${code}: ${error.message}`); return }
    await loadHaccpDocs()
    setMessage(`${code}: dodano ${col.label}.`)
  }

  async function removeR04Station(doc, stId) {
    if (!allowDelete) { setMessage('Tylko administrator może usuwać.'); return }
    if (!supabase || !doc || !confirmDelete('Tę stację z kontroli deratyzacji.')) return
    const stations = (doc.data?.stations || []).filter(s => s.id !== stId)
    const readings = { ...(doc.data?.readings || {}) }
    delete readings[stId]
    saveRMonthlyColumns(code, stations)
    const { error } = await supabase.from('haccp_documents').update({
      data: { ...(doc.data || {}), stations, readings },
      updated_at: new Date().toISOString()
    }).eq('id', doc.id)
    if (error) { setMessage(`${code}: ${error.message}`); return }
    await loadHaccpDocs()
  }

  const headR04 = (docNo = '') => (
    <table className="r04-head"><tbody><tr>
      <td className="r04-company"><b>AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.<br/>24-335 ŁAZISKA, KOLONIA ŁAZISKA 30<br/>NIP: 7171839598</b></td>
      <td className="r04-title"><b>{cfg.header.title}</b></td>
      <td className="r04-meta"><b>Wersja</b> {cfg.header.version}<br/><b>Data zatwierdzenia:</b> {cfg.header.approvalDate || '—'}<br/><b>Rok:</b> {year}<br/><b>Miesiąc:</b> {month}</td>
    </tr></tbody></table>
  )

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
      {allowDelete && <button className="secondary danger" onClick={deleteMonth}>Usuń kartotekę</button>}
    </div>
  )

  if (cfg.layout === 'single-month') {
    const doc = docs[0]
    const fields = cfg.fields?.length ? cfg.fields : [
      { key: 'document_no', label: 'Numer bieżący dokumentu', type: 'text' },
      { key: 'observations', label: 'Obserwacje', type: 'textarea', rows: 16 }
    ]
    return <div className="monthly-paper r13-paper r06-paper">{toolbar}{head}
      <div className="r06-form no-print">
        {fields.map(f => (
          <label key={f.key} className={f.type === 'textarea' ? 'r06-field-full' : 'r06-field'}>
            <span className="r06-field-label">{f.label}</span>
            {f.type === 'textarea' ? (
              <textarea
                className="cell-input r06-textarea"
                rows={f.rows || 16}
                value={singleForm[f.key] ?? ''}
                placeholder="Wpisz opis ręcznie…"
                onChange={e => setSingleForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                onBlur={e => saveSingleField(doc, f.key, e.target.value)}
              />
            ) : (
              <input
                className="cell-input"
                value={singleForm[f.key] ?? ''}
                onChange={e => setSingleForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                onBlur={e => saveSingleField(doc, f.key, e.target.value)}
              />
            )}
          </label>
        ))}
        <label className="r06-field">{cfg.signLabel}
          <select className="mini-select" value={doc?.signed_by_operator || ''} onChange={e => saveDoc(supabase, doc, {}, e.target.value, loadHaccpDocs, setMessage, code, mergeHaccpDoc)}>
            <option value="">Wybierz</option>{employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}
          </select>
        </label>
      </div>
      <div className="print-only r06-print-body">
        {fields.map(f => (
          <div key={f.key} className="r06-print-block">
            <b>{f.label}:</b>
            <p style={{ whiteSpace: 'pre-wrap' }}>{singleForm[f.key] || '—'}</p>
          </div>
        ))}
        <p><b>{cfg.signLabel}:</b> {doc?.signed_by_operator || '—'}</p>
      </div>
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
                  <select className="mini-select no-print" value={formNormalizePn(doc.data?.[f.key] || 'P')} onChange={e => saveDoc(supabase, doc, { [f.key]: e.target.value, status: e.target.value }, undefined, loadHaccpDocs, setMessage, code, mergeHaccpDoc)}>
                    <option value="P">P</option><option value="N">N</option>
                  </select>
                ) : f.type === 'date' ? (
                  <input type="date" className="cell-input no-print" defaultValue={doc.data?.[f.key] || doc.document_date} onBlur={e => saveDoc(supabase, doc, { [f.key]: e.target.value }, undefined, loadHaccpDocs, setMessage, code, mergeHaccpDoc)} />
                ) : (
                  <input className="cell-input no-print" defaultValue={doc.data?.[f.key] || ''} onBlur={e => saveDoc(supabase, doc, { [f.key]: e.target.value }, undefined, loadHaccpDocs, setMessage, code, mergeHaccpDoc)} />
                )}
                <span className="print-only">{doc.data?.[f.key] || ''}</span>
              </td>
            ))}
            <td>
              <select className="mini-select no-print" value={doc.signed_by_operator || ''} onChange={e => saveDoc(supabase, doc, {}, e.target.value, loadHaccpDocs, setMessage, code, mergeHaccpDoc)}>
                <option value="">Wybierz</option>{employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}
              </select>
              <span className="print-only">{doc.signed_by_operator || ''}</span>
            </td>
          </tr>
        ))}</tbody></table>
      {cfg.summaryField && docs.find(d => d.data?.is_shell) && (
        <label>{cfg.summaryField.label}<textarea className="cell-input" rows={3} defaultValue={docs.find(d => d.data?.is_shell)?.data?.summary || ''} onBlur={e => saveDoc(supabase, docs.find(d => d.data?.is_shell), { summary: e.target.value }, undefined, loadHaccpDocs, setMessage, code, mergeHaccpDoc)} /></label>
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
              saveDoc(supabase, doc, { months: next }, undefined, loadHaccpDocs, setMessage, code, mergeHaccpDoc)
            }} /></td>
            <td><input className="cell-input" placeholder="Sztuk / stan / preparat / gryzonie" defaultValue={[m.derat_count, m.derat_tech, m.derat_bait, m.derat_rodents].filter(Boolean).join(' / ')} onBlur={e => {
              const next = [...months]; next[i] = { ...next[i], derat_summary: e.target.value }; saveDoc(supabase, doc, { months: next }, undefined, loadHaccpDocs, setMessage, code, mergeHaccpDoc)
            }} /></td>
            <td><input className="cell-input" placeholder="Sztuk / gryzonie" defaultValue={[m.trap_count, m.trap_rodents].filter(Boolean).join(' / ')} onBlur={e => {
              const next = [...months]; next[i] = { ...next[i], trap_summary: e.target.value }; saveDoc(supabase, doc, { months: next }, undefined, loadHaccpDocs, setMessage, code, mergeHaccpDoc)
            }} /></td>
            <td><input className="cell-input" defaultValue={m.trend || ''} onBlur={e => {
              const next = [...months]; next[i] = { ...next[i], trend: e.target.value }; saveDoc(supabase, doc, { months: next }, undefined, loadHaccpDocs, setMessage, code, mergeHaccpDoc)
            }} /></td>
          </tr>
        ))}</tbody></table>
      <label>Uwagi<textarea className="cell-input" rows={2} defaultValue={doc?.data?.notes || ''} onBlur={e => saveDoc(supabase, doc, { notes: e.target.value }, undefined, loadHaccpDocs, setMessage, code, mergeHaccpDoc)} /></label>
    </div>
  }

  if (cfg.layout === 'r04-control') {
    const controls = sortRMonthlyDocs(docs.filter(d => !d.data?.is_shell && (d.data?.stations || d.data?.readings)))
    const stationsFromFirst = controls[0]?.data?.stations || columns

    return <div className="monthly-paper r04-paper">{toolbar}
      <div className="no-print card inner-card" style={{ marginBottom: 12 }}>
        <b>Dodaj kontrolę w tym miesiącu:</b>
        <div className="k03-bulk-row" style={{ marginTop: 8 }}>
          <label>Data kontroli
            <input type="date" value={newControlDate} onChange={e => setNewControlDate(e.target.value)} />
          </label>
          <button type="button" onClick={() => addControl(newControlDate)}>Dodaj kontrolę</button>
        </div>
        <p className="hint">Każda kontrola to osobny arkusz ze wszystkimi stacjami. Lista stacji jak w poprzednim miesiącu lub domyślnie 20+6.</p>
      </div>
      {controls.length === 0 && <p className="hint">Brak kontroli – utwórz kartotekę lub dodaj kontrolę powyżej.</p>}
      {controls.map(doc => {
        const stations = doc.data?.stations || stationsFromFirst
        return (
          <div key={doc.id} className="r04-sheet" style={{ marginBottom: 24 }}>
            {headR04(doc.data?.document_no)}
            <div className="r04-meta-row no-print">
              <label>Nr bieżący dokumentu
                <input className="cell-input" defaultValue={doc.data?.document_no || ''} onBlur={e => saveDoc(supabase, doc, { document_no: e.target.value }, undefined, loadHaccpDocs, setMessage, code, mergeHaccpDoc)} />
              </label>
              <label>Data kontroli
                <input type="date" className="cell-input" defaultValue={(doc.data?.control_date || doc.document_date || '').slice(0, 10)}
                  onBlur={e => saveR04ControlDate(doc, e.target.value)} />
              </label>
              <label>{cfg.signLabel}
                <select className="mini-select" value={doc.signed_by_operator || ''} onChange={e => saveDoc(supabase, doc, {}, e.target.value, loadHaccpDocs, setMessage, code, mergeHaccpDoc)}>
                  <option value="">Wybierz</option>{employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}
                </select>
              </label>
              {allowDelete && <button type="button" className="mini danger no-print" onClick={() => deleteControl(doc)}>Usuń kontrolę</button>}
            </div>
            <div className="print-only r04-meta-print">
              <p><b>Nr bieżący dokumentu:</b> {doc.data?.document_no || '—'} &nbsp; <b>Data kontroli:</b> {formatRMonthlyPlDate(doc.data?.control_date || doc.document_date)}</p>
            </div>
            <div className="no-print k03-bulk-row" style={{ margin: '8px 0' }}>
              <label>Dodaj stację
                <select value={previewStationKind} onChange={e => setPreviewStationKind(e.target.value)}>
                  {(cfg.stationTypes || []).map(t => <option key={t.kind} value={t.kind}>{t.label}</option>)}
                </select>
              </label>
              <button type="button" className="secondary mini" onClick={() => addR04StationToDoc(doc, previewStationKind)}>Dodaj</button>
            </div>
            <div className="table-wrap r04-table-wrap">
              <table className="r04-table">
                <thead>
                  <tr>
                    <th rowSpan={2}>Nr stacji deratyzacyjnej/<br/>pułapki żywołownej</th>
                    <th colSpan={1}>Ubytek trutki *</th>
                    <th rowSpan={2}>Obecność gryzoni<br/>w stacji **</th>
                    <th colSpan={1}>Stan stacji deratyzacyjnej/<br/>pułapki żywołownej ***</th>
                    <th rowSpan={2}>UWAGI</th>
                    <th rowSpan={2} className="no-print"> </th>
                  </tr>
                  <tr>
                    <th><small>wpisz np. 0–50%, 75%, 100% lub 25%</small></th>
                    <th><small>nienaruszona / uszkodzona / zniszczona</small></th>
                  </tr>
                </thead>
                <tbody>
                  {stations.map(st => {
                    const rd = doc.data?.readings?.[st.id] || defaultR04Reading(cfg)
                    const kindHint = st.kind === 'trap' ? 'Pułapka żywołowna' : 'Stacja deratyzacyjna'
                    return (
                      <tr key={st.id}>
                        <td className="r04-station-label"><b>{st.label}</b><br/><small>{kindHint}</small></td>
                        <td>
                          <input className="cell-input no-print" placeholder="np. 25%" defaultValue={rd.bait || ''} onBlur={e => saveR04Reading(doc, st.id, { bait: e.target.value })} />
                          <span className="print-only">{rd.bait || ''}</span>
                        </td>
                        <td>
                          <input className="cell-input no-print" defaultValue={rd.rodents || cfg.defaultRodents} onBlur={e => saveR04Reading(doc, st.id, { rodents: e.target.value })} />
                          <span className="print-only">{rd.rodents || cfg.defaultRodents}</span>
                        </td>
                        <td>
                          <input className="cell-input no-print" defaultValue={rd.state || cfg.defaultState} onBlur={e => saveR04Reading(doc, st.id, { state: e.target.value })} />
                          <span className="print-only">{rd.state || cfg.defaultState}</span>
                        </td>
                        <td>
                          <input className="cell-input no-print" defaultValue={rd.notes || ''} onBlur={e => saveR04Reading(doc, st.id, { notes: e.target.value })} />
                          <span className="print-only">{rd.notes || ''}</span>
                        </td>
                        <td className="no-print">
                          {allowDelete && stations.length > 1 && <button type="button" className="mini danger" onClick={() => removeR04Station(doc, st.id)}>×</button>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="r04-legend">{cfg.legend}</p>
          </div>
        )
      })}
    </div>
  }

  if (cfg.layout === 'grid-mcd-agent') {
    const calendar = buildCalendarRows(period.length === 7 ? period : `${period}-01`.slice(0, 7), docs)
    const mcdBulkOptions = (cfg.mcdOptions || ['', 'M', 'C']).filter(o => o)
    return <div className="monthly-paper r02-paper r13-paper">{toolbar}{head}
      {code === 'R03' && group.vehicleRegNo && (
        <p className="r03-vehicle-meta"><b>Samochód:</b> {group.vehicleRegNo}{group.driver ? <> &nbsp; <b>Kierowca:</b> {group.driver}</> : null}</p>
      )}
      {code === 'R03' && (
        <div className="no-print r03-column-bulk card inner-card" style={{ marginBottom: 12 }}>
          <b>Zastosuj M / C / M/C do całej kolumny (dni robocze):</b>
          <div className="k03-bulk-row" style={{ marginTop: 8 }}>
            {columns.map(col => (
              <label key={col.id}>
                {col.label}
                <select defaultValue="" onChange={e => {
                  const val = e.target.value
                  if (val) applyColumnMcd(col.id, val, col.label)
                  e.target.value = ''
                }}>
                  <option value="">Wybierz…</option>
                  {mcdBulkOptions.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
            ))}
          </div>
          <p className="hint">Po zastosowaniu możesz nadal edytować pojedyncze dni w tabeli poniżej (np. nazwa środka czyszczącego).</p>
        </div>
      )}
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
                  saveDoc(supabase, doc, { cells }, undefined, loadHaccpDocs, setMessage, code, mergeHaccpDoc)
                }}>{cfg.mcdOptions.map(o => <option key={o || 'e'} value={o}>{o || '—'}</option>)}</select>
                <input className="cell-input no-print" placeholder="Środek" defaultValue={cell.agent || ''} onBlur={e => {
                  const cells = { ...(doc.data?.cells || {}), [col.id]: { ...cell, agent: e.target.value } }
                  saveDoc(supabase, doc, { cells }, undefined, loadHaccpDocs, setMessage, code, mergeHaccpDoc)
                }} />
              </td>
            })}
            <td><select className="mini-select no-print" value={doc.signed_by_operator || ''} onChange={e => saveDoc(supabase, doc, {}, e.target.value, loadHaccpDocs, setMessage, code, mergeHaccpDoc)}>
              <option value="">Wybierz</option>{employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}</select></td>
          </tr>
        })}</tbody></table>
      <div className="r13-legend">{cfg.mcdLegend}</div>
    </div>
  }

  if (cfg.layout === 'daily-employees') {
    const calendar = buildCalendarRows(period, docs)
    const empCols = columns
    return <div className="monthly-paper r13-paper r00-paper">{toolbar}{head}
      <div className="no-print r00-employee-toolbar">
        <p className="hint">Pracownicy u góry tabeli (jak we wzorze). Dni robocze: godz. {R00_DEFAULT_GODZINA}, odzież <b>P</b>. Niedziele puste. Nad każdym pracownikiem wybierz <b>P wszędzie</b> lub <b>— wszędzie</b>; możesz to zmienić w dowolnym momencie. Pojedyncze dni edytujesz ręcznie w tabeli.</p>
        <div className="r00-add-employee-row">
          <label>Z listy
            <select value={r00PickEmployee} onChange={e => { setR00PickEmployee(e.target.value); if (e.target.value) setNewColumnLabel('') }}>
              <option value="">—</option>
              {employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}
            </select>
          </label>
          <label>Lub ręcznie
            <input value={newColumnLabel} onChange={e => { setNewColumnLabel(e.target.value); setR00PickEmployee('') }} placeholder="Imię i nazwisko" />
          </label>
          <button type="button" className="secondary mini" onClick={() => addR00ColumnToGroup(newColumnLabel || r00PickEmployee)}>+ Dodaj pracownika</button>
        </div>
      </div>
      <div className="table-wrap r00-table-wrap">
      <table className="r13-table r00-table"><thead>
        <tr>
          <th rowSpan={2}>Data</th>
          <th rowSpan={2}>Godzina</th>
          <th colSpan={empCols.length}>Dane pracowników (imię i nazwisko)</th>
          <th rowSpan={2}>{cfg.signLabel}</th>
        </tr>
        <tr>{empCols.map((col, i) => {
          const bulk = r00ColumnBulkClothing(col.id, docs, empCols)
          const bulkSelectValue = bulk === '__mixed__' ? '__mixed__' : (bulk === 'P' ? 'P' : 'dash')
          return (
          <th key={col.id} className="r00-emp-head">
            <span className="print-only">{col.label || `Nr ${i + 1}`}</span>
            <span className="no-print r00-emp-head-edit">
              <label className="r00-bulk-clothing">
                <small>Odzież (cała kolumna)</small>
                <select
                  className="mini-select"
                  value={bulkSelectValue}
                  onChange={e => {
                    const val = e.target.value
                    if (val === '__mixed__') return
                    applyR00ColumnClothing(col.id, val === 'dash' ? '' : val, col.label)
                  }}
                >
                  {bulk === '__mixed__' && <option value="__mixed__">Mieszane…</option>}
                  <option value="P">P — wszędzie</option>
                  <option value="dash">— wszędzie</option>
                </select>
              </label>
              <small>Nr {i + 1}</small>
              <select className="mini-select" value="" onChange={e => { if (e.target.value) updateR00ColumnLabel(col.id, e.target.value) }}>
                <option value="">Lista…</option>
                {employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}
              </select>
              <input className="cell-input" defaultValue={col.label || ''} key={`${col.id}-${col.label}`} placeholder="Imię i nazwisko" onBlur={e => updateR00ColumnLabel(col.id, e.target.value)} />
              {allowDelete && empCols.length > 1 && (
                <button type="button" className="mini danger" onClick={() => removeR00Column(col.id)} title="Usuń kolumnę">×</button>
              )}
            </span>
          </th>
        )})}</tr>
        <tr>
          <th></th><th></th>
          {empCols.map(col => <th key={`pn-${col.id}`}><small>Stan odzieży (P/N)*</small></th>)}
          <th></th>
        </tr>
      </thead>
        <tbody>{calendar.map(row => {
          const doc = row.doc
          const off = row.isSunday
          if (!doc) return <tr key={row.date} className={`${off ? 'r13-day-off' : ''} no-print`}><td>{formatRMonthlyPlDate(row.date)}</td><td colSpan={empCols.length + 2}><button type="button" className="mini secondary" onClick={() => addMissingDay(row.date)}>Dodaj dzień</button></td></tr>
          const isOff = off || doc.data?.is_day_off
          const clothing = r00ClothingMap(doc, empCols, { sunday: isOff })
          return <tr key={doc.id} className={isOff ? 'r13-day-off' : ''}>
            <td>{formatRMonthlyPlDate(doc.document_date)}</td>
            <td>
              <input className="cell-input no-print" defaultValue={doc.data?.godzina || R00_DEFAULT_GODZINA} key={`t-${doc.id}-${doc.data?.godzina}`} onBlur={e => saveDoc(supabase, doc, { godzina: e.target.value }, undefined, loadHaccpDocs, setMessage, code, mergeHaccpDoc)} />
              <span className="print-only">{doc.data?.godzina || R00_DEFAULT_GODZINA}</span>
            </td>
            {empCols.map(col => (
              <td key={col.id}>
                <select className="mini-select no-print" value={clothing[col.id] || ''} onChange={e => {
                  const next = { ...(doc.data?.clothing || {}), [col.id]: e.target.value }
                  saveDoc(supabase, doc, { clothing: next }, undefined, loadHaccpDocs, setMessage, code, mergeHaccpDoc)
                }}>
                  <option value="">—</option><option value="P">P</option><option value="N">N</option>
                </select>
                <span className="print-only">{clothing[col.id] || '—'}</span>
              </td>
            ))}
            <td>
              <select className="mini-select no-print" value={doc.signed_by_operator || ''} onChange={e => saveDoc(supabase, doc, {}, e.target.value, loadHaccpDocs, setMessage, code, mergeHaccpDoc)}>
                <option value="">Wybierz</option>{employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}
              </select>
              <span className="print-only">{doc.signed_by_operator || ''}</span>
            </td>
          </tr>
        })}</tbody></table>
      </div>
      <p className="hint">* P – prawidłowo, N – nieprawidłowo (odzież robocza)</p>
    </div>
  }

  if (cfg.layout === 'daily-calibration') {
    const calendar = buildCalendarRows(period, docs)
    const chambers = columns.length ? columns : (cfg.defaultChambers || [])
    const thermoSpan = Math.max(chambers.length * 3, 1)
    const meta = docs[0]?.data?.calibration || {}

    async function saveR08Meta(field, value) {
      if (!supabase) return
      try {
        for (const doc of docs) {
          const cal = { ...(doc.data?.calibration || {}), [field]: value }
          const { error } = await supabase.from('haccp_documents').update({
            data: { ...(doc.data || {}), calibration: cal },
            updated_at: new Date().toISOString()
          }).eq('id', doc.id)
          if (error) throw error
        }
        await loadHaccpDocs()
      } catch (err) {
        setMessage(`${code}: ${err.message}`)
      }
    }

    async function addR08ChamberToGroup(kind) {
      if (!supabase) return
      const newCol = r08MakeChamber(kind, chambers)
      if (!newCol) return
      const nextCols = [...chambers, newCol]
      saveRMonthlyColumns(code, nextCols)
      try {
        for (const doc of docs) {
          const cal = doc.data?.calibration || {}
          const chData = { ...(cal.chambers || {}), [newCol.id]: { ref: '', reading: '', action: doc.data?.is_day_off ? '' : 'P' } }
          const { error } = await supabase.from('haccp_documents').update({
            data: { ...(doc.data || {}), chamber_columns: nextCols, calibration: { ...cal, chambers: chData } },
            updated_at: new Date().toISOString()
          }).eq('id', doc.id)
          if (error) throw error
        }
        await loadHaccpDocs()
        setMessage(`${code}: dodano ${newCol.label} do kartoteki.`)
      } catch (err) {
        setMessage(`${code}: ${err.message}`)
      }
    }

    function saveCal(doc, calPatch) {
      const cal = { ...(doc.data?.calibration || {}), ...calPatch }
      saveDoc(supabase, doc, { calibration: cal }, undefined, loadHaccpDocs, setMessage, code, mergeHaccpDoc)
    }

    function saveChamber(doc, chId, patch) {
      const cal = doc.data?.calibration || {}
      const chambersData = { ...(cal.chambers || {}), [chId]: { ...(cal.chambers?.[chId] || {}), ...patch } }
      saveDoc(supabase, doc, { calibration: { ...cal, chambers: chambersData } }, undefined, loadHaccpDocs, setMessage, code, mergeHaccpDoc)
    }

    const pwOpts = (cfg.pwOptions || ['', 'P', 'W']).filter(o => o !== undefined)

    return <div className="monthly-paper r08-paper r13-paper">{toolbar}{head}
      {allowDelete && <div className="no-print r08-chamber-add card inner-card" style={{ marginBottom: 10 }}>
        <b>Dodaj chłodnię do tej kartoteki:</b>
        <div className="k03-bulk-row" style={{ marginTop: 8 }}>
          <label>Typ
            <select value={previewChamberKind} onChange={e => setPreviewChamberKind(e.target.value)}>
              {(cfg.chamberTypes || []).map(t => (
                <option key={t.kind} value={t.kind}>
                  {t.kind === 'raw' ? 'Chłodnia surowców (kolejna)' : 'Chłodnia produktów gotowych (kolejna)'}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="secondary" onClick={() => addR08ChamberToGroup(previewChamberKind)}>Dodaj chłodnię</button>
        </div>
      </div>}
      <div className="table-wrap r08-table-wrap">
        <table className="r08-table">
          <thead>
            <tr>
              <th rowSpan={4} className="r08-date-col">Data</th>
              <th colSpan={2}>Waga 1</th>
              <th colSpan={thermoSpan}>Termometry</th>
              <th rowSpan={4}>{cfg.signLabel}</th>
            </tr>
            <tr>
              <th>Wzorzec -</th>
              <th>Tolerancja -</th>
              <th colSpan={thermoSpan}>
                Tolerancja temperatury -
                <input className="cell-input no-print r08-meta-input" defaultValue={meta.temp_tolerance || ''} onBlur={e => saveR08Meta('temp_tolerance', e.target.value)} />
                <span className="print-only">{meta.temp_tolerance || ''}</span>
              </th>
            </tr>
            <tr>
              <th>
                <input className="cell-input no-print r08-meta-input" placeholder="Wzorzec" defaultValue={meta.scale_reference || ''} onBlur={e => saveR08Meta('scale_reference', e.target.value)} />
                <span className="print-only">{meta.scale_reference || ''}</span>
              </th>
              <th>
                <input className="cell-input no-print r08-meta-input" placeholder="Tolerancja" defaultValue={meta.scale_tolerance || ''} onBlur={e => saveR08Meta('scale_tolerance', e.target.value)} />
                <span className="print-only">{meta.scale_tolerance || ''}</span>
              </th>
              {chambers.map(ch => <th key={ch.id} colSpan={3}>{ch.label}</th>)}
            </tr>
            <tr>
              <th>Wskazania urządzenia<br/>w pom. prod.</th>
              <th>Podjęte działania<br/>(P/W)*</th>
              {chambers.flatMap(ch => [
                <th key={`${ch.id}-ref`}>Wskazania urządzenia wzorcowego</th>,
                <th key={`${ch.id}-read`}>Wskazania w chłodni</th>,
                <th key={`${ch.id}-act`}>Podjęte działania (P/W)*</th>
              ])}
            </tr>
          </thead>
          <tbody>
            {calendar.map(row => {
              const doc = row.doc
              const off = row.isSunday
              if (!doc) return (
                <tr key={row.date} className={`${off ? 'r13-day-off' : ''} no-print`}>
                  <td>{formatRMonthlyPlDate(row.date)}</td>
                  <td colSpan={2 + thermoSpan}><button type="button" className="mini secondary" onClick={() => addMissingDay(row.date)}>Dodaj dzień</button></td>
                  <td></td>
                </tr>
              )
              const cal = doc.data?.calibration || {}
              const isOff = off || doc.data?.is_day_off
              return (
                <tr key={doc.id} className={isOff ? 'r13-day-off' : ''}>
                  <td>{formatRMonthlyPlDate(doc.document_date)}</td>
                  <td>
                    <input className="cell-input no-print" defaultValue={cal.scale_reading || ''} onBlur={e => saveCal(doc, { scale_reading: e.target.value })} />
                    <span className="print-only">{cal.scale_reading || ''}</span>
                  </td>
                  <td>
                    <select className="mini-select no-print" value={cal.scale_action || (isOff ? '' : 'P')} onChange={e => saveCal(doc, { scale_action: e.target.value })}>
                      {pwOpts.map(o => <option key={o || 'e'} value={o}>{o || '—'}</option>)}
                    </select>
                    <span className="print-only">{cal.scale_action || (isOff ? '' : 'P')}</span>
                  </td>
                  {chambers.flatMap(ch => {
                    const c = cal.chambers?.[ch.id] || {}
                    const defPw = isOff ? '' : 'P'
                    return [
                      <td key={`${doc.id}-${ch.id}-ref`}>
                        <input className="cell-input no-print" defaultValue={c.ref || ''} onBlur={e => saveChamber(doc, ch.id, { ref: e.target.value })} />
                        <span className="print-only">{c.ref || ''}</span>
                      </td>,
                      <td key={`${doc.id}-${ch.id}-read`}>
                        <input className="cell-input no-print" defaultValue={c.reading || ''} onBlur={e => saveChamber(doc, ch.id, { reading: e.target.value })} />
                        <span className="print-only">{c.reading || ''}</span>
                      </td>,
                      <td key={`${doc.id}-${ch.id}-act`}>
                        <select className="mini-select no-print" value={c.action || defPw} onChange={e => saveChamber(doc, ch.id, { action: e.target.value })}>
                          {pwOpts.map(o => <option key={o || 'e'} value={o}>{o || '—'}</option>)}
                        </select>
                        <span className="print-only">{c.action || defPw}</span>
                      </td>
                    ]
                  })}
                  <td>
                    <select className="mini-select no-print" value={doc.signed_by_operator || ''} onChange={e => saveDoc(supabase, doc, {}, e.target.value, loadHaccpDocs, setMessage, code, mergeHaccpDoc)}>
                      <option value="">Wybierz</option>{employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}
                    </select>
                    <span className="print-only">{doc.signed_by_operator || ''}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="r13-legend">{cfg.pwLegend || '* P – dalsze użytkowanie; W – wymiana/naprawa'}</p>
    </div>
  }

  if (cfg.layout === 'r11-magnets') {
    const magnetCols = resolveR11Columns(docs, group.columns)
    const displayRows = buildR11SparseDisplayRows(docs, 9)
    const colSpan = Math.max(magnetCols.length, 1)

    async function addR11ColumnToGroup(label) {
      if (!allowDelete) { setMessage('Tylko administrator może zmieniać strukturę kartoteki.'); return }
      if (!supabase) return
      const col = r11MakeColumn(label)
      const nextCols = [...magnetCols, col]
      saveRMonthlyColumns(code, nextCols)
      try {
        for (const doc of docs) {
          const dayOff = doc.data?.is_day_off
          const magnets = { ...r11MagnetsForDoc(doc, magnetCols), [col.id]: dayOff ? '' : '+' }
          const { error } = await supabase.from('haccp_documents').update({
            data: { ...(doc.data || {}), magnet_columns: nextCols, magnets },
            updated_at: new Date().toISOString()
          }).eq('id', doc.id)
          if (error) throw error
        }
        await loadHaccpDocs()
        setMessage(`${code}: dodano kolumnę „${col.label}” do kartoteki.`)
      } catch (err) {
        setMessage(`${code}: ${err.message}`)
      }
    }

    function saveMagnet(doc, colId, value) {
      const magnets = { ...r11MagnetsForDoc(doc, magnetCols), [colId]: value }
      const patch = { magnets, auto_source: doc.data?.auto_source === 'k03_przerob' ? 'k03_przerob_edited' : doc.data?.auto_source }
      saveDoc(supabase, doc, patch, undefined, loadHaccpDocs, setMessage, code, mergeHaccpDoc)
    }

    function saveUwagi(doc, value) {
      const v = value === '' ? '' : formNormalizePn(value)
      const patch = { uwagi_pn: v, status: v === 'N' ? 'N' : 'P' }
      if (doc.data?.auto_source === 'k03_przerob') patch.auto_source = 'k03_przerob_edited'
      saveDoc(supabase, doc, patch, undefined, loadHaccpDocs, setMessage, code, mergeHaccpDoc)
    }

    async function saveR11Date(doc, date) {
      if (!supabase || !doc?.id || !date) return
      const monthKey = String(date).slice(0, 7)
      const sortOrder = calendarDaysInMonth(monthKey).findIndex(d => d.date === date) + 1
      const { error } = await supabase.from('haccp_documents').update({
        document_date: date,
        data: {
          ...(doc.data || {}),
          month_key: monthKey,
          sort_order: sortOrder || doc.data?.sort_order || 99
        },
        updated_at: new Date().toISOString()
      }).eq('id', doc.id)
      if (error) setMessage(`R11: ${error.message}`)
      else await loadHaccpDocs()
    }

    async function addR11ManualRow(dateStr) {
      if (!supabase) return
      const date = dateStr || `${period}-01`
      const payload = buildR11ManualRowPayload(period, date, magnetCols, {}, defaultEmployee)
      try {
        const { error } = await supabase.from('haccp_documents').insert(payload)
        if (error) throw error
        await loadHaccpDocs()
        setMessage('R11: dodano wiersz – uzupełnij kolumny.')
      } catch (err) {
        setMessage(`R11: ${err.message}`)
      }
    }

    async function deleteR11Row(doc) {
      if (!supabase || !doc?.id) return
      if (!allowDelete) { setMessage('Tylko administrator może usuwać.'); return }
      if (!confirmDelete(`Wpis R11 z dnia ${formatRMonthlyPlDate(doc.document_date)}.`)) return
      if (onAuditDelete) await onAuditDelete([doc], 'R11 wiersz')
      else await supabase.from('haccp_documents').delete().eq('id', doc.id)
      await loadHaccpDocs()
      setMessage('R11: usunięto wiersz.')
    }

    const headR11 = (
      <table className="r13-head"><tbody><tr>
        <td className="r13-company"><b>AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.<br/>24-335 ŁAZISKA, KOLONIA ŁAZISKA 30<br/>NIP: 7171839598</b></td>
        <td className="r13-title"><b>{R11_HEADER.title}</b><br/>{R11_HEADER.subtitle}</td>
        <td className="r13-meta"><b>Rok:</b> {year}<br/><b>Miesiąc:</b> {month}<br/><b>Str.</b> 1 z 1<br/><b>Wersja</b> {cfg.header.version}</td>
      </tr></tbody></table>
    )

    return <div className="monthly-paper r13-paper r11-paper">{toolbar}{headR11}
      <div className="no-print employee-signature-row" style={{ marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <button type="button" className="mini secondary" onClick={() => addR11ManualRow(`${period}-01`)}>+ Dodaj wiersz</button>
        <span className="hint">Wpisy z przerobu maliny/porzeczki (K03) uzupełniają się automatycznie. Każda kolumna edytowalna.</span>
      </div>
      {allowDelete && <div className="no-print card inner-card" style={{ marginBottom: 12 }}>
        <b>Dodaj miejsce kontroli magnesu do tej kartoteki:</b>
        <div className="r13-add-column-row" style={{ marginTop: 8 }}>
          <input value={newColumnLabel} onChange={e => setNewColumnLabel(e.target.value)} placeholder="np. Przy separatorze metalu" />
          <button type="button" className="secondary" disabled={!newColumnLabel.trim()} onClick={() => { addR11ColumnToGroup(newColumnLabel); setNewColumnLabel('') }}>{cfg.addColumnLabel || 'Dodaj miejsce magnesu'}</button>
        </div>
      </div>}
      <table className="r13-table r11-table"><thead>
        <tr>
          <th rowSpan={2}>Lp.</th>
          <th rowSpan={2}>Data</th>
          <th colSpan={colSpan}>Miejsce magnesów (*P/N)/</th>
          <th rowSpan={2}>{cfg.signLabel}</th>
          <th rowSpan={2}>Uwagi (skuteczność)<br/>(magnesy czyste) (P/N)*</th>
          <th rowSpan={2} className="no-print">Akcje</th>
        </tr>
        <tr>{magnetCols.map(col => <th key={col.id}>{col.label}</th>)}</tr>
      </thead><tbody>
        {displayRows.map(row => {
          if (row.blank) {
            return <tr key={row.key} className="blank-row editable-blank">
              <td>{row.lp}</td>
              <td>
                <input type="date" className="cell-input no-print" defaultValue="" onBlur={e => { if (e.target.value) void addR11ManualRow(e.target.value) }} />
              </td>
              {magnetCols.map(col => <td key={col.id}></td>)}
              <td></td><td></td><td className="no-print"></td>
            </tr>
          }
          const doc = row.doc
          const isOff = doc.data?.is_day_off
          const isPrzerob = doc.data?.auto_source === 'k03_przerob' || doc.data?.auto_source === 'k03_przerob_edited' || doc.data?.auto_source === 'manual'
          const magnets = r11MagnetsForDoc(doc, magnetCols)
          const uwagi = r11UwagiForDoc(doc, isOff)
          const przerobHint = doc.data?.przerob_products?.length
            ? doc.data.przerob_products.join(', ')
            : ''
          return <tr key={doc.id} className={`${isOff ? 'r13-day-off' : ''}${isPrzerob ? ' r11-przerob-row' : ''}`}>
            <td>{row.lp}</td>
            <td>
              <input type="date" className="cell-input no-print" value={String(doc.document_date || '').slice(0, 10)} onChange={e => saveR11Date(doc, e.target.value)} />
              <span className="print-only">{formatRMonthlyPlDate(doc.document_date)}{przerobHint ? ` (${przerobHint})` : ''}</span>
            </td>
            {magnetCols.map(col => {
              const val = magnets[col.id] ?? (isOff ? '' : '+')
              return <td key={col.id}>
                <input className="cell-input no-print mini" list={`r11-mag-${col.id}`} value={val} onChange={e => saveMagnet(doc, col.id, e.target.value)} />
                <datalist id={`r11-mag-${col.id}`}><option value="+"/><option value="-"/></datalist>
                <span className="print-only">{val || ''}</span>
              </td>
            })}
            <td>
              <select className="mini-select no-print" value={doc.signed_by_operator || ''} onChange={e => saveDoc(supabase, doc, {}, e.target.value, loadHaccpDocs, setMessage, code, mergeHaccpDoc)}>
                <option value="">Wybierz</option>{employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}
              </select>
              <span className="print-only">{doc.signed_by_operator || ''}</span>
            </td>
            <td>
              <select className="mini-select no-print" value={isOff ? (doc.data?.uwagi_pn || '') : (doc.data?.uwagi_pn ?? 'P')} onChange={e => saveUwagi(doc, e.target.value)}>
                <option value="">—</option><option value="P">P</option><option value="N">N</option>
              </select>
              <span className="print-only">{uwagi || ''}</span>
            </td>
            <td className="no-print col-actions">
              {allowDelete && <button type="button" className="mini danger" onClick={() => void deleteR11Row(doc)}>Usuń</button>}
            </td>
          </tr>
        })}
      </tbody></table>
      <div className="r13-legend">
        Wpisy powstają automatycznie w dni przerobu pulpy (malina, porzeczka czarna – K03): w obu miejscach magnesów „+”, uwagi „P”.<br/>
        * <b>+</b> – kontrola / brak zastrzeżeń w miejscu kontroli; <b>–</b> – brak wykrycia metalu (wg wzoru).<br/>
        ** <b>P</b> – prawidłowo (magnesy czyste, skuteczne); <b>N</b> – nieprawidłowo.<br/>
        Każda kolumna jest edytowalna ręcznie. Puste wiersze u dołu – wpisz datę, aby dodać wpis.
      </div>
    </div>
  }

  return <div>Brak podglądu dla układu {cfg.layout}</div>
}
