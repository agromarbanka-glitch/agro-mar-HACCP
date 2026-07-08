/**
 * Silnik kartotek miesięcznych/kwartalnych dla raportów R00, R03–R09, R11.
 */
import { normalizePn } from './haccpFormsEngine'
import { calendarDaysInMonth, isSundayDate } from './r13Engine'
import { k01DocsByDay } from './k02Engine'
import {
  buildR11MonthPayloads, buildR11SingleDayPayload, buildR11PrintHtml, buildR11ExcelRows,
  r11ColumnsFromDocs
} from './r11Engine'
import { getRMonthlyConfig, rMonthlyStorageKey } from './rMonthlyConfigs'

export { isSundayDate }

export const R_MONTHLY_ENGINE_VERSION = '1.2'

export const R00_DEFAULT_GODZINA = '8:00'

export function defaultR00Columns(count = 8) {
  return Array.from({ length: count }, (_, i) => ({
    id: `emp-${i + 1}`,
    label: ''
  }))
}

export function r00MakeEmployeeColumn(name, existing = []) {
  const trimmed = String(name || '').trim()
  const label = trimmed || `Nr ${existing.length + 1}`
  const base = trimmed.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pracownik'
  return { id: `${base}-${Date.now().toString(36).slice(-4)}`, label }
}

/** Kolumny pracowników – z danych kartoteki lub legacy employees[]. */
export function r00ResolveColumns(docs, fallback) {
  const fromDocs = columnsFromDocs('R00', docs, fallback)
  if (fromDocs.length && fromDocs.some(c => String(c.label || '').trim())) return fromDocs
  const first = sortRMonthlyDocs(docs)[0]
  const legacy = first?.data?.employees
  if (Array.isArray(legacy) && legacy.length) {
    return legacy.map((e, i) => ({
      id: String(e.slot ? `emp-${e.slot}` : `emp-${i + 1}`),
      label: String(e.name || '').trim()
    }))
  }
  return fromDocs.length ? fromDocs : defaultR00Columns(8)
}

export function r00ClothingMap(doc, columns, { sunday = false } = {}) {
  const map = { ...(doc?.data?.clothing || {}) }
  const legacy = doc?.data?.employees
  if (Array.isArray(legacy) && legacy.length && !Object.keys(map).length) {
    columns.forEach((col, i) => {
      const leg = legacy[i]
      if (leg?.clothing) map[col.id] = leg.clothing
    })
  }
  const out = {}
  for (const col of columns) {
    const val = map[col.id]
    const isOff = sunday || doc?.data?.is_day_off
    if (isOff) {
      out[col.id] = val ?? ''
    } else if (Object.prototype.hasOwnProperty.call(map, col.id)) {
      out[col.id] = val ?? ''
    } else {
      out[col.id] = 'P'
    }
  }
  return out
}

/** Stan wypełnienia odzieży w kolumnie pracownika (dni robocze): 'P', '' lub '__mixed__'. */
export function r00ColumnBulkClothing(colId, docs, columns) {
  const workDays = (docs || []).filter(d => !d.data?.is_day_off && !isSundayDate(d.document_date))
  if (!workDays.length) return ''
  const values = workDays.map(d => r00ClothingMap(d, columns, { sunday: false })[colId] ?? '')
  const unique = [...new Set(values)]
  if (unique.length === 1) return unique[0]
  return '__mixed__'
}

export function defaultR00DayData(columns, sunday) {
  const cols = (columns || defaultR00Columns(8)).map(c => ({ ...c }))
  return {
    godzina: sunday ? '' : R00_DEFAULT_GODZINA,
    clothing: Object.fromEntries(cols.map(c => [c.id, sunday ? '' : 'P'])),
    columns: cols
  }
}

/** Podpis przyjmującego z kartoteki K01. */
export function k01SignatoryName(doc) {
  return String(doc?.signed_by_operator || doc?.data?.podpis_przyjmujacego || '').trim()
}

/**
 * Przygotowanie kolumn i odzieży R00 na podstawie K01 w danym miesiącu.
 * P tylko w dniach, gdy pracownik widnieje jako przyjmujący surowiec.
 */
export function buildR00K01Context(k01Docs, yearMonth) {
  const monthK01 = (k01Docs || []).filter(d =>
    d.document_type === 'K01' && String(d.document_date || '').slice(0, 7) === yearMonth
  )
  const byDay = k01DocsByDay(monthK01)
  const nameToColId = new Map()
  const columns = []
  const sorted = [...monthK01].sort((a, b) =>
    String(a.document_date || '').localeCompare(String(b.document_date || ''))
    || k01SignatoryName(a).localeCompare(k01SignatoryName(b), 'pl')
  )
  for (const doc of sorted) {
    const name = k01SignatoryName(doc)
    if (!name) continue
    const key = name.toLowerCase()
    if (!nameToColId.has(key)) {
      const col = r00MakeEmployeeColumn(name, columns)
      nameToColId.set(key, col.id)
      columns.push(col)
    }
  }
  const clothingByDay = new Map()
  for (const [day, docs] of byDay.entries()) {
    const dayClothing = {}
    for (const d of docs) {
      const name = k01SignatoryName(d)
      const colId = nameToColId.get(name.toLowerCase())
      if (colId) dayClothing[colId] = 'P'
    }
    clothingByDay.set(day, dayClothing)
  }
  return {
    columns,
    clothingByDay,
    k01Count: monthK01.length,
    employeeCount: columns.length,
    receiptDays: clothingByDay.size
  }
}

export function defaultR00DayDataFromK01(columns, sunday, date, clothingByDay) {
  const cols = (columns || []).map(c => ({ ...c }))
  const dayClothing = clothingByDay?.get?.(date) || {}
  const clothing = Object.fromEntries(cols.map(c => {
    if (sunday) return [c.id, '']
    return [c.id, dayClothing[c.id] === 'P' ? 'P' : '']
  }))
  return {
    godzina: sunday ? '' : R00_DEFAULT_GODZINA,
    clothing,
    columns: cols
  }
}

export function makeR03RegisterKey(vehicleReg) {
  const slug = String(vehicleReg || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pojazd'
  return `r03-${slug}-${Date.now().toString(36)}`
}

export function buildR03VehicleColumn(vehicleReg) {
  const label = String(vehicleReg || '').trim() || 'Samochód'
  return { id: `veh-${Date.now().toString(36).slice(-6)}`, label }
}

export function r03RegisterKeyFromDoc(doc) {
  return doc?.data?.register_key || 'legacy'
}

export function formatRMonthlyPlDate(iso) {
  if (!iso) return ''
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return iso
  return `${m[3]}.${m[2]}.${m[1]}`
}

export function normalizeMcd(value) {
  const v = String(value ?? '').trim().toUpperCase()
  if (!v) return ''
  return v.replace(/\s+/g, '').replace(/[^MCD/]/g, '')
}

export function loadRMonthlyColumns(code) {
  const cfg = getRMonthlyConfig(code)
  if (!cfg) return []
  const fallback = cfg.defaultColumns || cfg.defaultStations || cfg.defaultChambers
    || (cfg.layout === 'r04-control' ? defaultR04Stations() : [])
  if (!cfg.storageKey) return fallback.map(c => ({ ...c }))
  try {
    const raw = localStorage.getItem(cfg.storageKey)
    if (!raw) return fallback.map(c => ({ ...c }))
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.length) return fallback.map(c => ({ ...c }))
    return parsed.map((c, i) => ({
      id: String(c.id || `col-${i + 1}`),
      label: String(c.label || `Kolumna ${i + 1}`),
      kind: String(c.kind || ''),
      auto_m: Boolean(c.auto_m)
    }))
  } catch {
    return fallback.map(c => ({ ...c }))
  }
}

export function saveRMonthlyColumns(code, columns) {
  const key = rMonthlyStorageKey(code)
  if (key) localStorage.setItem(key, JSON.stringify(columns))
}

export function rMonthlyMakeColumn(label, prefix = 'col') {
  const trimmed = String(label || '').trim() || `Kolumna ${Date.now()}`
  const base = trimmed.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || prefix
  return { id: `${base}-${Date.now().toString(36).slice(-4)}`, label: trimmed }
}

export function sortRMonthlyDocs(docs) {
  return [...(docs || [])].sort((a, b) =>
    Number(a?.data?.sort_order || 0) - Number(b?.data?.sort_order || 0) ||
    String(a.document_date || '').localeCompare(String(b.document_date || '')) ||
    String(a.id || '').localeCompare(String(b.id || ''))
  )
}

export function columnsFromDocs(code, docs, fallback) {
  const cfg = getRMonthlyConfig(code)
  const first = sortRMonthlyDocs(docs)[0]
  const key = cfg?.layout === 'r04-control' ? 'stations'
    : cfg?.layout === 'station-matrix' ? 'stations'
    : cfg?.layout === 'daily-calibration' ? 'chamber_columns'
    : cfg?.layout === 'r11-magnets' ? 'magnet_columns'
    : 'columns'
  const stored = first?.data?.[key] || first?.data?.machine_columns || first?.data?.room_columns || first?.data?.columns
  if (Array.isArray(stored) && stored.length) {
    return stored.map((c, i) => ({
      id: String(c.id || `col-${i + 1}`),
      label: String(c.label || `Kolumna ${i + 1}`),
      kind: String(c.kind || ''),
      auto_m: Boolean(c.auto_m)
    }))
  }
  return (fallback || loadRMonthlyColumns(code)).map(c => ({ ...c }))
}

export function r08MakeChamber(kind, existing = []) {
  const cfg = getRMonthlyConfig('R08')
  const type = (cfg?.chamberTypes || []).find(t => t.kind === kind)
  if (!type) return null
  const n = existing.filter(c => c.kind === kind).length + 1
  const label = String(type.labelTemplate || '{n}').replace('{n}', String(n))
  const id = `${kind}-${n}-${Date.now().toString(36).slice(-4)}`
  return { id, kind, label }
}

export function defaultR04Stations() {
  const cfg = getRMonthlyConfig('R04')
  const deratN = cfg?.deratCount || 20
  const trapN = cfg?.trapCount || 6
  const stations = []
  for (let i = 1; i <= deratN; i++) stations.push({ id: `derat-${i}`, kind: 'derat', label: String(i) })
  for (let i = 1; i <= trapN; i++) stations.push({ id: `trap-${i}`, kind: 'trap', label: `PŻ ${i}` })
  return stations
}

export function defaultR04Reading(cfg = getRMonthlyConfig('R04')) {
  return {
    bait: '',
    rodents: cfg?.defaultRodents || 'brak gryzoni',
    state: cfg?.defaultState || 'nienaruszona',
    notes: ''
  }
}

export function defaultR04ReadingsForStations(stations, cfg) {
  const readings = {}
  for (const st of stations || []) readings[st.id] = defaultR04Reading(cfg)
  return readings
}

function previousMonthKey(yearMonth) {
  const [y, m] = String(yearMonth).split('-').map(Number)
  const d = new Date(y, (m || 1) - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function findPreviousR04Control(allDocs, yearMonth) {
  const prevKey = previousMonthKey(yearMonth)
  const prevDocs = sortRMonthlyDocs((allDocs || []).filter(d =>
    d.document_type === 'R04'
    && (d.data?.month_key === prevKey || String(d.document_date || '').slice(0, 7) === prevKey)
    && !d.data?.is_shell
    && Array.isArray(d.data?.stations)
  ))
  return prevDocs[prevDocs.length - 1] || null
}

export function findPreviousR04Stations(allDocs, yearMonth) {
  const prev = findPreviousR04Control(allDocs, yearMonth)
  if (prev?.data?.stations?.length) return prev.data.stations.map(s => ({ ...s }))
  return []
}

export function r04ReadingsFromPrevious(stations, prevDoc, cfg = getRMonthlyConfig('R04')) {
  const prevReadings = prevDoc?.data?.readings || {}
  const prevStations = prevDoc?.data?.stations || []
  const readings = {}
  for (const st of stations || []) {
    let prev = prevReadings[st.id]
    if (!prev) {
      const match = prevStations.find(ps => ps.label === st.label && (ps.kind || 'derat') === (st.kind || 'derat'))
      if (match) prev = prevReadings[match.id]
    }
    if (!prev) {
      const kindIdx = stations.filter(s => s.kind === st.kind).indexOf(st)
      const prevSameKind = prevStations.filter(s => s.kind === st.kind)
      if (kindIdx >= 0 && prevSameKind[kindIdx]) prev = prevReadings[prevSameKind[kindIdx].id]
    }
    readings[st.id] = prev
      ? {
        bait: prev.bait ?? '',
        rodents: prev.rodents ?? cfg?.defaultRodents ?? 'brak gryzoni',
        state: prev.state ?? cfg?.defaultState ?? 'nienaruszona',
        notes: prev.notes ?? ''
      }
      : defaultR04Reading(cfg)
  }
  return readings
}

export function resolveR04Stations(allDocs, yearMonth, columnDefs) {
  const fromPrev = findPreviousR04Stations(allDocs, yearMonth)
  if (fromPrev.length) return fromPrev
  if (columnDefs?.length) return columnDefs.map(s => ({ ...s }))
  const stored = loadRMonthlyColumns('R04')
  if (stored.length) return stored.map(s => ({ ...s }))
  return defaultR04Stations()
}

export function r04MakeStation(kind, existing = []) {
  if (kind === 'derat') {
    const n = existing.filter(s => s.kind === 'derat').length + 1
    return { id: `derat-${n}-${Date.now().toString(36).slice(-3)}`, kind: 'derat', label: String(n) }
  }
  const n = existing.filter(s => s.kind === 'trap').length + 1
  return { id: `trap-${n}-${Date.now().toString(36).slice(-3)}`, kind: 'trap', label: `PŻ ${n}` }
}

export function buildR04ControlPayload(yearMonth, controlDate, stations, signedBy = '', documentNo = '', copyFromDoc = null) {
  const cfg = getRMonthlyConfig('R04')
  const st = (stations || defaultR04Stations()).map(s => ({ ...s }))
  const date = controlDate || `${yearMonth}-01`
  const readings = copyFromDoc
    ? r04ReadingsFromPrevious(st, copyFromDoc, cfg)
    : defaultR04ReadingsForStations(st, cfg)
  return {
    document_type: 'R04',
    document_date: date,
    document_no: documentNo || `R04/${yearMonth}/${date}`,
    product_name: cfg?.header?.title || 'R04',
    status: 'P',
    data: {
      month_key: yearMonth,
      control_date: date,
      document_no: '',
      stations: st,
      readings
    },
    signed_by_operator: signedBy || '',
    qty: 0,
    updated_at: new Date().toISOString()
  }
}

/** Wszystkie wpisy kartoteki miesięcznej do usunięcia (z pełnej listy, nie tylko z filtrowanego widoku). */
export function resolveRMonthlyGroupDeleteDocs(code, allDocs, group) {
  if (!group?.period || !code) return []
  const cfg = getRMonthlyConfig(code)
  const targetPeriod = String(group.period)
  return (allDocs || []).filter(d => {
    if (d.document_type !== code) return false
    if (code === 'R03') {
      const docPeriod = d.data?.month_key || String(d.document_date || '').slice(0, 7)
      if (docPeriod !== targetPeriod) return false
      const docReg = r03RegisterKeyFromDoc(d)
      const groupReg = group.registerKey || r03RegisterKeyFromDoc(group.docs?.[0])
      return docReg === groupReg
    }
    let period = d.data?.month_key || String(d.document_date || '').slice(0, 7)
    if (cfg?.periodMode === 'quarter' && d.data?.quarter_key) period = d.data.quarter_key
    else if (cfg?.periodMode === 'quarter') {
      const [y, m] = period.split('-').map(Number)
      period = `${y}-Q${Math.ceil((m || 1) / 3)}`
    }
    return period === targetPeriod
  })
}

export function buildRMonthlyPeriodGroups(code, docs) {
  const cfg = getRMonthlyConfig(code)
  if (!cfg) return []
  const map = new Map()
  for (const doc of docs || []) {
    let period = doc?.data?.month_key || String(doc.document_date || '').slice(0, 7) || 'brak-daty'
    if (cfg.periodMode === 'quarter' && doc?.data?.quarter_key) period = doc.data.quarter_key
    else if (cfg.periodMode === 'quarter') {
      const [y, m] = period.split('-').map(Number)
      const q = Math.ceil((m || 1) / 3)
      period = `${y}-Q${q}`
    }
    const registerKey = code === 'R03' ? r03RegisterKeyFromDoc(doc) : ''
    const key = code === 'R03' ? `${code}|${period}|${registerKey}` : `${code}|${period}`
    if (!map.has(key)) map.set(key, { key, type: code, period, registerKey: registerKey || undefined, docs: [] })
    map.get(key).docs.push(doc)
  }
  return Array.from(map.values())
    .map(g => {
      const allDocs = sortRMonthlyDocs(g.docs)
      const rows = allDocs.filter(d => !d.data?.is_shell)
      const keepAll = ['register-rows', 'station-matrix', 'r04-control', 'single-month', 'quarter-trend'].includes(cfg.layout)
      const columns = code === 'R00' ? r00ResolveColumns(rows.length ? rows : allDocs, loadRMonthlyColumns(code)) : columnsFromDocs(code, rows.length ? rows : allDocs)
      let docsForGroup = keepAll ? allDocs : (rows.length ? rows : allDocs.filter(d => !d.data?.is_shell))
      if (cfg.layout === 'r04-control') {
        docsForGroup = allDocs.filter(d => !d.data?.is_shell && (d.data?.stations || d.data?.readings))
      }
      const vehicleRegNo = code === 'R03'
        ? (rows[0]?.data?.vehicle_reg_no || columns[0]?.label || '')
        : ''
      const driver = code === 'R03'
        ? (rows.find(d => !d.data?.is_day_off)?.signed_by_operator || rows[0]?.data?.driver || rows[0]?.signed_by_operator || '')
        : ''
      const displayLabel = code === 'R03'
        ? `${g.period} – ${vehicleRegNo || 'samochód'}${driver ? ` (${driver})` : ''}`
        : g.period
      return {
        ...g,
        docs: docsForGroup,
        columns,
        config: cfg,
        vehicleRegNo,
        driver,
        displayLabel
      }
    })
    .sort((a, b) => String(b.period).localeCompare(String(a.period)) || String(a.vehicleRegNo || '').localeCompare(String(b.vehicleRegNo || ''), 'pl'))
}

export function buildCalendarRows(yearMonth, docs = []) {
  const docByDate = new Map((docs || []).map(d => [String(d.document_date || '').slice(0, 10), d]))
  return calendarDaysInMonth(yearMonth).map((day, i) => ({
    ...day,
    lp: i + 1,
    doc: docByDate.get(day.date) || null
  }))
}

function defaultDayCells(columns, sunday, layout) {
  if (layout === 'grid-mcd-agent') {
    const cells = {}
    for (const col of columns) {
      cells[col.id] = { mcd: sunday ? '' : (col.auto_m ? 'M' : ''), agent: '' }
    }
    return cells
  }
  if (layout === 'grid-mcd' || layout === 'grid-mcd-agent') {
    const cells = {}
    for (const col of columns) {
      cells[col.id] = sunday ? '' : (col.auto_m ? 'M' : '')
    }
    return cells
  }
  return {}
}

function defaultCalibration(sunday, chamberDefs = []) {
  const chambers = {}
  for (const ch of chamberDefs) {
    chambers[ch.id] = sunday
      ? { ref: '', reading: '', action: '' }
      : { ref: '', reading: '', action: 'P' }
  }
  return {
    scale_reference: '',
    scale_tolerance: '',
    temp_tolerance: '',
    scale_reading: '',
    scale_action: sunday ? '' : 'P',
    chambers
  }
}

function defaultStationReadings(stations) {
  const readings = {}
  for (const st of stations || []) {
    readings[st.id] = { bait: '', rodents: false, state: '', notes: '' }
  }
  return readings
}

export function buildRMonthlyMonthPayloads(code, yearMonth, signedBy = '', columnDefs = loadRMonthlyColumns(code), allDocs = [], options = {}) {
  const cfg = getRMonthlyConfig(code)
  if (!cfg) return []

  if (code === 'R03' && options.vehicleRegNo) {
    const vehicleRegNo = String(options.vehicleRegNo).trim()
    const registerKey = options.registerKey || makeR03RegisterKey(vehicleRegNo)
    const cols = [buildR03VehicleColumn(vehicleRegNo)]
    const regSuffix = registerKey.slice(-8)
    return calendarDaysInMonth(yearMonth).map((day, i) => {
      const sunday = day.isSunday
      const data = {
        month_key: yearMonth,
        register_key: registerKey,
        vehicle_reg_no: vehicleRegNo,
        driver: signedBy || '',
        sort_order: i + 1,
        is_day_off: sunday,
        columns: cols,
        stations: cols,
        cells: defaultDayCells(cols, sunday, cfg.layout)
      }
      return {
        document_type: code,
        document_date: day.date,
        document_no: `${code}/${yearMonth}/${regSuffix}/${String(i + 1).padStart(2, '0')}`,
        product_name: cfg.header.title,
        status: 'P',
        data,
        signed_by_operator: sunday ? '' : (signedBy || ''),
        qty: 0,
        updated_at: new Date().toISOString()
      }
    })
  }

  if (cfg.layout === 'single-month') {
    return [{
      document_type: code,
      document_date: `${yearMonth}-01`,
      document_no: `${code}/${yearMonth}`,
      product_name: cfg.header.title,
      status: 'P',
      data: {
        month_key: yearMonth,
        document_no: '',
        observations: '',
        fields: {}
      },
      signed_by_operator: signedBy || '',
      qty: 0,
      updated_at: new Date().toISOString()
    }]
  }

  if (cfg.layout === 'register-rows') {
    return [{
      document_type: code,
      document_date: `${yearMonth}-01`,
      document_no: `${code}/${yearMonth}/00`,
      product_name: cfg.header.title,
      status: 'P',
      data: { month_key: yearMonth, is_shell: true, summary: '' },
      signed_by_operator: signedBy || '',
      qty: 0,
      updated_at: new Date().toISOString()
    }]
  }

  if (cfg.layout === 'quarter-trend') {
    const [y, m] = yearMonth.split('-').map(Number)
    const q = Math.ceil((m || 1) / 3)
    const quarterKey = `${y}-Q${q}`
    const months = []
    for (let i = 0; i < 3; i++) {
      const mm = (q - 1) * 3 + i + 1
      months.push({
        month: mm,
        derat_count: '', derat_tech: '', derat_bait: '', derat_rodents: '',
        trap_count: '', trap_rodents: '', trend: ''
      })
    }
    return [{
      document_type: code,
      document_date: `${y}-${String((q - 1) * 3 + 1).padStart(2, '0')}-01`,
      document_no: `${code}/${quarterKey}`,
      product_name: cfg.header.title,
      status: 'P',
      data: { quarter_key: quarterKey, month_key: quarterKey, months, notes: '' },
      signed_by_operator: signedBy || '',
      qty: 0,
      updated_at: new Date().toISOString()
    }]
  }

  if (cfg.layout === 'r04-control') {
    const prevDoc = findPreviousR04Control(allDocs, yearMonth)
    const stations = resolveR04Stations(allDocs, yearMonth, columnDefs)
    saveRMonthlyColumns(code, stations)
    return [buildR04ControlPayload(yearMonth, `${yearMonth}-01`, stations, signedBy, '', prevDoc)]
  }

  if (cfg.layout === 'r11-magnets') {
    const cols = (columnDefs?.length ? columnDefs : loadRMonthlyColumns(code)).map(c => ({ ...c }))
    saveRMonthlyColumns(code, cols)
    return buildR11MonthPayloads(yearMonth, signedBy, cols)
  }

  if (cfg.layout === 'station-matrix') {
    return [{
      document_type: code,
      document_date: `${yearMonth}-01`,
      document_no: `${code}/${yearMonth}/00`,
      product_name: cfg.header.title,
      status: 'P',
      data: {
        month_key: yearMonth,
        is_shell: true,
        stations: columnDefs.map(c => ({ ...c })),
        controls: []
      },
      signed_by_operator: signedBy || '',
      qty: 0,
      updated_at: new Date().toISOString()
    }]
  }

  let cols = (columnDefs || []).map(c => ({ ...c }))
  const r00K01Ctx = (cfg.layout === 'daily-employees' && options.fillFromK01)
    ? buildR00K01Context(allDocs, yearMonth)
    : null
  if (r00K01Ctx?.columns?.length) cols = r00K01Ctx.columns.map(c => ({ ...c }))
  if (!cols.length && cfg.layout === 'daily-employees') cols = defaultR00Columns(8)
  if (cfg.layout === 'daily-employees') saveRMonthlyColumns(code, cols)
  return calendarDaysInMonth(yearMonth).map((day, i) => {
    const sunday = day.isSunday
    const base = {
      month_key: yearMonth,
      sort_order: i + 1,
      is_day_off: sunday,
      columns: cols,
      stations: cols
    }
    let data = { ...base }
    if (cfg.layout === 'daily-employees') {
      data = r00K01Ctx?.columns?.length
        ? { ...base, ...defaultR00DayDataFromK01(cols, sunday, day.date, r00K01Ctx.clothingByDay), auto_source: 'k01' }
        : { ...base, ...defaultR00DayData(cols, sunday) }
    } else if (cfg.layout === 'grid-mcd-agent') {
      data = { ...base, cells: defaultDayCells(cols, sunday, cfg.layout) }
    } else if (cfg.layout === 'daily-calibration') {
      data = { ...base, chamber_columns: cols, calibration: defaultCalibration(sunday, cols) }
    }
    return {
      document_type: code,
      document_date: day.date,
      document_no: `${code}/${yearMonth}/${String(i + 1).padStart(2, '0')}`,
      product_name: cfg.header.title,
      status: 'P',
      data,
      signed_by_operator: sunday ? '' : (signedBy || ''),
      qty: 0,
      updated_at: new Date().toISOString()
    }
  })
}

export function buildRMonthlySingleDayPayload(code, yearMonth, date, columnDefs, signedBy = '', sunday = false, meta = {}) {
  const cfg = getRMonthlyConfig(code)
  if (cfg?.layout === 'r11-magnets') {
    const cols = (columnDefs?.length ? columnDefs : loadRMonthlyColumns(code)).map(c => ({ ...c }))
    return buildR11SingleDayPayload(yearMonth, date, cols, signedBy, sunday)
  }
  let cols = (columnDefs || []).map(c => ({ ...c }))
  if (!cols.length && cfg?.layout === 'daily-employees') cols = defaultR00Columns(8)
  const isSunday = sunday || isSundayDate(date)
  const sortOrder = calendarDaysInMonth(yearMonth).findIndex(d => d.date === date) + 1
  const base = {
    month_key: yearMonth,
    sort_order: sortOrder || 99,
    is_day_off: isSunday,
    columns: cols,
    stations: cols,
    ...(meta.register_key ? { register_key: meta.register_key } : {}),
    ...(meta.vehicle_reg_no ? { vehicle_reg_no: meta.vehicle_reg_no } : {}),
    ...(meta.driver ? { driver: meta.driver } : {})
  }
  let data = { ...base }
  if (cfg?.layout === 'daily-employees') data = { ...base, ...defaultR00DayData(cols, isSunday) }
  else if (cfg?.layout === 'grid-mcd-agent') data = { ...base, cells: defaultDayCells(cols, isSunday, cfg.layout) }
  else if (cfg?.layout === 'daily-calibration') data = { ...base, chamber_columns: cols, calibration: defaultCalibration(isSunday, cols) }
  const regSuffix = meta.register_key ? `/${String(meta.register_key).slice(-8)}` : ''
  return {
    document_type: code,
    document_date: date,
    document_no: `${code}/${yearMonth}${regSuffix}/${String(sortOrder || 99).padStart(2, '0')}`,
    product_name: cfg?.header?.title || code,
    status: 'P',
    data,
    signed_by_operator: isSunday ? '' : (signedBy || ''),
    qty: 0,
    updated_at: new Date().toISOString()
  }
}

export function buildRegisterRowPayload(code, yearMonth, rowData, sortOrder, signedBy = '') {
  const cfg = getRMonthlyConfig(code)
  return {
    document_type: code,
    document_date: rowData.document_date || rowData.detected_date || `${yearMonth}-01`,
    document_no: `${code}/${yearMonth}/${String(sortOrder).padStart(2, '0')}`,
    product_name: cfg?.header?.title || code,
    status: normalizePn(rowData.result || rowData.health_ok || 'P'),
    data: { month_key: yearMonth, sort_order: sortOrder, ...rowData },
    signed_by_operator: signedBy || '',
    qty: 0,
    updated_at: new Date().toISOString()
  }
}

export function buildStationControlPayload(code, yearMonth, controlDate, stations, readings, signedBy = '') {
  const cfg = getRMonthlyConfig(code)
  const sortOrder = (readings?.length || 0) + 1
  return {
    document_type: code,
    document_date: controlDate,
    document_no: `${code}/${yearMonth}/${String(sortOrder).padStart(2, '0')}`,
    product_name: cfg?.header?.title || code,
    status: 'P',
    data: {
      month_key: yearMonth,
      sort_order: sortOrder,
      control_date: controlDate,
      stations: stations.map(c => ({ ...c })),
      readings: { ...readings }
    },
    signed_by_operator: signedBy || '',
    qty: 0,
    updated_at: new Date().toISOString()
  }
}

function printHeader(cfg, period, escapeHtml) {
  const year = period.includes('Q') ? period.slice(0, 4) : period.slice(0, 4)
  const month = period.includes('Q') ? period.slice(5) : period.slice(5, 7)
  const periodLine = cfg.periodMode === 'quarter'
    ? `<b>Rok:</b> ${escapeHtml(year)}<br/><b>Kwartał:</b> ${escapeHtml(month)}`
    : `<b>Rok:</b> ${escapeHtml(year)}<br/><b>Miesiąc:</b> ${escapeHtml(month)}`
  return `<table><tbody><tr>
  <td class="left" style="width:30%"><b>AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.<br/>24-335 ŁAZISKA, KOLONIA ŁAZISKA 30<br/>NIP: 7171839598</b></td>
  <td class="title" style="width:44%"><b>${escapeHtml(cfg.header.title)}</b></td>
  <td class="meta" style="width:26%">${periodLine}<br/><b>Str.</b> 1 z 1<br/><b>Wersja</b> ${escapeHtml(cfg.header.version)}</td>
</tr></tbody></table>`
}

export function buildRMonthlyPrintHtml(code, group, escapeHtml) {
  const cfg = getRMonthlyConfig(code) || group.config
  if (!cfg) return '<!doctype html><html><body>Brak konfiguracji</body></html>'
  const period = String(group.period || '')
  const docs = sortRMonthlyDocs(group.docs || [])
  let body = ''

  if (cfg.layout === 'single-month') {
    const doc = docs[0]
    body = `<p><b>Numer bieżący dokumentu:</b> ${escapeHtml(doc?.data?.document_no || '')}</p>
<p style="white-space:pre-wrap">${escapeHtml(doc?.data?.observations || '')}</p>
<p><b>Podpis:</b> ${escapeHtml(doc?.signed_by_operator || '')}</p>`
  } else if (cfg.layout === 'register-rows') {
    const rows = docs.filter(d => !d.data?.is_shell)
    body = `<table><thead><tr>${cfg.rowFields.map(f => `<th>${escapeHtml(f.label)}</th>`).join('')}<th>${escapeHtml(cfg.signLabel)}</th></tr></thead><tbody>
${rows.map((doc, i) => `<tr><td>${i + 1}</td>${cfg.rowFields.map(f => `<td>${escapeHtml(String(doc.data?.[f.key] || doc.document_date || ''))}</td>`).join('')}<td>${escapeHtml(doc.signed_by_operator || '')}</td></tr>`).join('')}
</tbody></table>`
  } else if (cfg.layout === 'grid-mcd-agent') {
    const columns = group.columns || columnsFromDocs(code, docs)
    const vehicleLine = code === 'R03' && group.vehicleRegNo
      ? `<p><b>Samochód (nr rej.):</b> ${escapeHtml(group.vehicleRegNo)}${group.driver ? ` &nbsp; <b>Kierowca:</b> ${escapeHtml(group.driver)}` : ''}</p>`
      : ''
    const calendar = buildCalendarRows(period, docs)
    const colH = columns.map(c => `<th>${escapeHtml(c.label)}<br/><small>M/C + środek</small></th>`).join('')
    const rows = calendar.map(row => {
      const doc = row.doc
      const off = row.isSunday || doc?.data?.is_day_off ? 'day-off' : ''
      if (!doc) return `<tr class="${off}"><td>${row.lp}</td><td>${formatRMonthlyPlDate(row.date)}</td>${columns.map(() => '<td>—</td>').join('')}<td></td></tr>`
      const cells = columns.map(col => {
        const cell = doc.data?.cells?.[col.id] || {}
        const val = [cell.mcd, cell.agent].filter(Boolean).join(' / ')
        return `<td>${escapeHtml(val || '—')}</td>`
      }).join('')
      return `<tr class="${off}"><td>${row.lp}</td><td>${formatRMonthlyPlDate(doc.document_date)}</td>${cells}<td>${escapeHtml(doc.signed_by_operator || '')}</td></tr>`
    }).join('')
    body = `${vehicleLine}<table><thead><tr><th>Lp.</th><th>Dzień</th>${colH}<th>${escapeHtml(cfg.signLabel)}</th></tr></thead><tbody>${rows}</tbody></table>`
  } else if (cfg.layout === 'daily-employees') {
    const columns = r00ResolveColumns(docs, group.columns || loadRMonthlyColumns(code))
    const calendar = buildCalendarRows(period, docs)
    const empHead = columns.map((c, i) => `<th>${escapeHtml(c.label || `Nr ${i + 1}`)}</th>`).join('')
    const pnHead = columns.map(() => '<th><small>Stan odzieży roboczej (P/N)*</small></th>').join('')
    const rows = calendar.map(row => {
      const doc = row.doc
      const off = row.isSunday || doc?.data?.is_day_off ? 'day-off' : ''
      if (!doc) return `<tr class="${off}"><td>${formatRMonthlyPlDate(row.date)}</td><td colspan="${columns.length + 2}">—</td></tr>`
      const clothing = r00ClothingMap(doc, columns, { sunday: row.isSunday || doc.data?.is_day_off })
      const cells = columns.map(col => `<td>${escapeHtml(clothing[col.id] || '—')}</td>`).join('')
      return `<tr class="${off}"><td>${formatRMonthlyPlDate(doc.document_date)}</td><td>${escapeHtml(doc.data?.godzina || R00_DEFAULT_GODZINA)}</td>${cells}<td>${escapeHtml(doc.signed_by_operator || '')}</td></tr>`
    }).join('')
    body = `<table><thead>
      <tr><th rowspan="2">Data</th><th rowspan="2">Godzina</th><th colspan="${columns.length}">Dane pracowników (imię i nazwisko)</th><th rowspan="2">${escapeHtml(cfg.signLabel)}</th></tr>
      <tr>${empHead}</tr>
      <tr><th></th><th></th>${pnHead}<th></th></tr>
    </thead><tbody>${rows}</tbody></table>
    <p>* P – prawidłowo, N – nieprawidłowo (odzież robocza)</p>`
  } else if (cfg.layout === 'daily-calibration') {
    const chambers = group.columns || columnsFromDocs(code, docs)
    const thermoSpan = Math.max(chambers.length * 3, 1)
    const meta = docs[0]?.data?.calibration || {}
    const subHead = chambers.map(ch => `<th colspan="3">${escapeHtml(ch.label)}</th>`).join('')
    const subSub = chambers.flatMap(() => [
      '<th>Wskazania urządzenia wzorcowego</th>',
      '<th>Wskazania w chłodni</th>',
      '<th>Podjęte działania (P/W)*</th>'
    ]).join('')
    const calendar = buildCalendarRows(period, docs)
    const rows = calendar.map(row => {
      const doc = row.doc
      const off = row.isSunday || doc?.data?.is_day_off ? 'day-off' : ''
      const cal = doc?.data?.calibration || {}
      if (!doc) return `<tr class="${off}"><td>${formatRMonthlyPlDate(row.date)}</td><td colspan="${2 + thermoSpan}">—</td><td></td></tr>`
      const thermoCells = chambers.flatMap(ch => {
        const c = cal.chambers?.[ch.id] || {}
        return [
          `<td>${escapeHtml(c.ref || '—')}</td>`,
          `<td>${escapeHtml(c.reading || '—')}</td>`,
          `<td>${escapeHtml(c.action || '—')}</td>`
        ]
      }).join('')
      return `<tr class="${off}"><td>${formatRMonthlyPlDate(doc.document_date)}</td>
        <td>${escapeHtml(cal.scale_reading || '—')}</td>
        <td>${escapeHtml(cal.scale_action || '—')}</td>
        ${thermoCells}
        <td>${escapeHtml(doc.signed_by_operator || '')}</td></tr>`
    }).join('')
    body = `<table><thead>
      <tr><th rowspan="4">Data</th><th colspan="2">Waga 1</th><th colspan="${thermoSpan}">Termometry</th><th rowspan="4">Podpis</th></tr>
      <tr><th>Wzorzec -</th><th>Tolerancja -</th><th colspan="${thermoSpan}">Tolerancja temperatury - ${escapeHtml(meta.temp_tolerance || '')}</th></tr>
      <tr><th>${escapeHtml(meta.scale_reference || '')}</th><th>${escapeHtml(meta.scale_tolerance || '')}</th>${subHead}</tr>
      <tr><th>Wskazania urządzenia w pom. prod.</th><th>Podjęte działania (P/W)*</th>${subSub}</tr>
    </thead><tbody>${rows}</tbody></table>
    <p>${escapeHtml(cfg.pwLegend || '')}</p>`
  } else if (cfg.layout === 'quarter-trend') {
    const doc = docs[0]
    const months = doc?.data?.months || []
    body = `<table><thead><tr><th>Lp.</th><th>Miesiąc</th><th>I. Stacje deratyzacyjne</th><th>II. Pułapki żywołowne</th><th>Trend</th></tr></thead><tbody>
${months.map((m, i) => `<tr><td>${i + 1}</td><td>${m.month || ''}</td><td>Szt.: ${escapeHtml(m.derat_count || '—')} / ${escapeHtml(m.derat_rodents || '—')}</td><td>Szt.: ${escapeHtml(m.trap_count || '—')} / ${escapeHtml(m.trap_rodents || '—')}</td><td>${escapeHtml(m.trend || '—')}</td></tr>`).join('')}
</tbody></table><p>${escapeHtml(doc?.data?.notes || '')}</p>`
  } else if (cfg.layout === 'r04-control') {
    const controls = sortRMonthlyDocs(docs.filter(d => d.data?.readings || d.data?.stations))
    body = controls.map(doc => {
      const stations = doc.data?.stations || group.columns || []
      const rd = doc.data?.readings || {}
      const stationRows = stations.map(st => {
        const r = rd[st.id] || defaultR04Reading(cfg)
        const kindLabel = st.kind === 'trap' ? 'Pułapka' : 'Stacja'
        return `<tr>
          <td>${escapeHtml(st.label)}<br/><small>${kindLabel}</small></td>
          <td>${escapeHtml(r.bait || '—')}</td>
          <td>${escapeHtml(r.rodents || '—')}</td>
          <td>${escapeHtml(r.state || '—')}</td>
          <td>${escapeHtml(r.notes || '')}</td>
        </tr>`
      }).join('')
      return `<div style="margin-bottom:20px">
        <p><b>Nr bieżący dokumentu:</b> ${escapeHtml(doc.data?.document_no || '')} &nbsp; <b>Data kontroli:</b> ${formatRMonthlyPlDate(doc.data?.control_date || doc.document_date)}</p>
        <table><thead><tr>
          <th>Nr stacji deratyzacyjnej/<br/>pułapki żywołownej</th>
          <th>Ubytek trutki *</th>
          <th>Obecność gryzoni **</th>
          <th>Stan stacji ***</th>
          <th>UWAGI</th>
        </tr></thead><tbody>${stationRows}</tbody></table>
        <p><b>${escapeHtml(cfg.signLabel)}:</b> ${escapeHtml(doc.signed_by_operator || '')}</p>
      </div>`
    }).join('') || '<p>Brak kontroli w tym miesiącu.</p>'
    body += `<p style="font-size:9pt">${escapeHtml(cfg.legend || '')}</p>`
  } else if (cfg.layout === 'r11-magnets') {
    return buildR11PrintHtml({ ...group, columns: group.columns || r11ColumnsFromDocs(docs) }, escapeHtml)
  } else if (cfg.layout === 'station-matrix') {
    const controls = docs.filter(d => d.data?.readings)
    body = controls.map(doc => {
      const stations = doc.data?.stations || group.columns || []
      const r = doc.data?.readings || {}
      const stationRows = stations.map(st => {
        const rd = r[st.id] || {}
        return `<tr><td>${escapeHtml(st.label)}</td><td>${escapeHtml(rd.bait || '—')}</td><td>${rd.rodents ? '+' : '—'}</td><td>${escapeHtml(rd.state || '—')}</td><td>${escapeHtml(rd.notes || '')}</td></tr>`
      }).join('')
      return `<h4>Kontrola: ${formatRMonthlyPlDate(doc.document_date || doc.data?.control_date)}</h4>
<table><thead><tr><th>Stacja</th><th>Ubytek trutki</th><th>Gryzonie</th><th>Stan</th><th>Uwagi</th></tr></thead><tbody>${stationRows}</tbody></table>`
    }).join('') || '<p>Brak kontroli w tym miesiącu.</p>'
  }

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(code)} ${escapeHtml(period)}</title>
<style>@page{size:A4 landscape;margin:8mm}body{font-family:"Times New Roman",serif;font-size:10pt}
table{width:100%;border-collapse:collapse}td,th{border:1px solid #111;padding:3px 4px;text-align:center;font-size:9pt}
.left{text-align:left}.title{font-weight:bold;text-align:center}.meta{text-align:left}
.day-off td{background:#ffe8e8!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
</style></head><body>${printHeader(cfg, period, escapeHtml)}<div style="margin-top:8px">${body}</div>
<script>window.onload=function(){setTimeout(function(){window.focus();window.print()},700)}</script></body></html>`
}

export function buildRMonthlyExcelRows(code, group) {
  const cfg = getRMonthlyConfig(code) || group.config
  if (cfg?.layout === 'r11-magnets') {
    return buildR11ExcelRows({ ...group, columns: group.columns || r11ColumnsFromDocs(group.docs) })
  }
  const period = String(group.period || '')
  const docs = sortRMonthlyDocs(group.docs || [])
  const rows = [['AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.'], [cfg?.header?.title || code, '', `Okres: ${period}`]]
  if (cfg?.layout === 'register-rows') {
    rows.push(['Lp.', ...cfg.rowFields.map(f => f.label), cfg.signLabel])
    docs.filter(d => !d.data?.is_shell).forEach((doc, i) => {
      rows.push([i + 1, ...cfg.rowFields.map(f => doc.data?.[f.key] || ''), doc.signed_by_operator || ''])
    })
  } else if (cfg?.layout === 'single-month') {
    const doc = docs[0]
    rows.push(['Numer dokumentu', doc?.data?.document_no || ''])
    rows.push(['Obserwacje', doc?.data?.observations || ''])
    rows.push(['Podpis', doc?.signed_by_operator || ''])
  } else if (cfg?.layout === 'grid-mcd-agent') {
    const columns = group.columns || columnsFromDocs(code, docs)
    rows.push(['Lp.', 'Dzień', ...columns.flatMap(c => [`${c.label} M/C`, `${c.label} środek`]), cfg.signLabel])
    buildCalendarRows(period, docs).forEach(row => {
      const doc = row.doc
      if (!doc) { rows.push([row.lp, formatRMonthlyPlDate(row.date), ...columns.flatMap(() => ['', '']), '']); return }
      rows.push([row.lp, formatRMonthlyPlDate(doc.document_date), ...columns.flatMap(col => {
        const cell = doc.data?.cells?.[col.id] || {}
        return [cell.mcd || '—', cell.agent || '']
      }), doc.signed_by_operator || ''])
    })
  } else if (cfg?.layout === 'daily-employees') {
    const columns = r00ResolveColumns(docs, group.columns || loadRMonthlyColumns(code))
    rows.push(['Data', 'Godzina', ...columns.map((c, i) => c.label || `Nr ${i + 1}`), cfg.signLabel])
    rows.push(['', '', ...columns.map(() => 'Stan odzieży P/N'), ''])
    buildCalendarRows(period, docs).forEach(row => {
      const doc = row.doc
      if (!doc) { rows.push([formatRMonthlyPlDate(row.date), '', ...columns.map(() => ''), '']); return }
      const clothing = r00ClothingMap(doc, columns, { sunday: row.isSunday || doc.data?.is_day_off })
      rows.push([
        formatRMonthlyPlDate(doc.document_date),
        doc.data?.godzina || R00_DEFAULT_GODZINA,
        ...columns.map(col => clothing[col.id] || ''),
        doc.signed_by_operator || ''
      ])
    })
  } else if (cfg?.layout === 'daily-calibration') {
    const chambers = group.columns || columnsFromDocs(code, docs)
    const meta = docs[0]?.data?.calibration || {}
    rows.push(['Wzorzec', meta.scale_reference || ''])
    rows.push(['Tolerancja wagi', meta.scale_tolerance || ''])
    rows.push(['Tolerancja temperatury', meta.temp_tolerance || ''])
    rows.push([
      'Data',
      'Waga – wskazania w pom. prod.',
      'Waga – działania P/W',
      ...chambers.flatMap(ch => [`${ch.label} wzorcowe`, `${ch.label} w chłodni`, `${ch.label} P/W`]),
      cfg.signLabel
    ])
    buildCalendarRows(period, docs).forEach(row => {
      const doc = row.doc
      const cal = doc?.data?.calibration || {}
      if (!doc) {
        rows.push([formatRMonthlyPlDate(row.date), ...Array(2 + chambers.length * 3).fill(''), ''])
        return
      }
      rows.push([
        formatRMonthlyPlDate(doc.document_date),
        cal.scale_reading || '',
        cal.scale_action || '',
        ...chambers.flatMap(ch => {
          const c = cal.chambers?.[ch.id] || {}
          return [c.ref || '', c.reading || '', c.action || '']
        }),
        doc.signed_by_operator || ''
      ])
    })
  } else if (cfg?.layout === 'quarter-trend') {
    const doc = docs[0]
    rows.push(['Lp.', 'Miesiąc', 'Stacje deratyzacyjne', 'Pułapki żywołowne', 'Trend'])
    ;(doc?.data?.months || []).forEach((m, i) => {
      rows.push([i + 1, m.month || '', m.derat_summary || '', m.trap_summary || '', m.trend || ''])
    })
  } else if (cfg?.layout === 'r04-control') {
    const controls = sortRMonthlyDocs(docs.filter(d => d.data?.stations))
    controls.forEach(doc => {
      const stations = doc.data?.stations || group.columns || []
      rows.push([`Kontrola ${formatRMonthlyPlDate(doc.data?.control_date || doc.document_date)}`, doc.data?.document_no || ''])
      rows.push(['Nr stacji', 'Ubytek trutki', 'Obecność gryzoni', 'Stan stacji', 'Uwagi'])
      stations.forEach(st => {
        const r = doc.data?.readings?.[st.id] || {}
        rows.push([st.label, r.bait || '', r.rodents || '', r.state || '', r.notes || ''])
      })
      rows.push(['Podpis', doc.signed_by_operator || ''])
      rows.push([])
    })
  } else if (cfg?.layout === 'station-matrix') {
    docs.filter(d => d.data?.readings).forEach(doc => {
      rows.push([`Kontrola ${formatRMonthlyPlDate(doc.document_date)}`])
      rows.push(['Stacja', 'Ubytek trutki', 'Gryzonie', 'Stan', 'Uwagi'])
      const stations = doc.data?.stations || group.columns || []
      stations.forEach(st => {
        const rd = doc.data?.readings?.[st.id] || {}
        rows.push([st.label, rd.bait || '', rd.rodents ? '+' : '', rd.state || '', rd.notes || ''])
      })
      rows.push([])
    })
  }
  return rows
}
