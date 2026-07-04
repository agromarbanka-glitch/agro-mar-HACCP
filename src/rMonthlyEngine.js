/**
 * Silnik kartotek miesięcznych/kwartalnych dla raportów R00, R03–R09, R11.
 */
import { normalizePn } from './haccpFormsEngine'
import { calendarDaysInMonth, isSundayDate } from './r13Engine'
import { getRMonthlyConfig, rMonthlyStorageKey } from './rMonthlyConfigs'

export const R_MONTHLY_ENGINE_VERSION = '1.0'

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
  const fallback = cfg.defaultColumns || cfg.defaultStations || []
  if (!cfg.storageKey) return fallback.map(c => ({ ...c }))
  try {
    const raw = localStorage.getItem(cfg.storageKey)
    if (!raw) return fallback.map(c => ({ ...c }))
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.length) return fallback.map(c => ({ ...c }))
    return parsed.map((c, i) => ({
      id: String(c.id || `col-${i + 1}`),
      label: String(c.label || `Kolumna ${i + 1}`),
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
  const key = cfg?.layout === 'station-matrix' ? 'stations' : 'columns'
  const stored = first?.data?.[key] || first?.data?.machine_columns || first?.data?.room_columns
  if (Array.isArray(stored) && stored.length) {
    return stored.map((c, i) => ({
      id: String(c.id || `col-${i + 1}`),
      label: String(c.label || `Kolumna ${i + 1}`),
      auto_m: Boolean(c.auto_m)
    }))
  }
  return (fallback || loadRMonthlyColumns(code)).map(c => ({ ...c }))
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
    const key = `${code}|${period}`
    if (!map.has(key)) map.set(key, { key, type: code, period, docs: [] })
    map.get(key).docs.push(doc)
  }
  return Array.from(map.values())
    .map(g => {
      const allDocs = sortRMonthlyDocs(g.docs)
      const rows = allDocs.filter(d => !d.data?.is_shell)
      const keepAll = ['register-rows', 'station-matrix', 'single-month', 'quarter-trend'].includes(cfg.layout)
      const columns = columnsFromDocs(code, rows.length ? rows : allDocs)
      return {
        ...g,
        docs: keepAll ? allDocs : (rows.length ? rows : allDocs.filter(d => !d.data?.is_shell)),
        columns,
        config: cfg
      }
    })
    .sort((a, b) => String(b.period).localeCompare(String(a.period)))
}

export function buildCalendarRows(yearMonth, docs = []) {
  const docByDate = new Map((docs || []).map(d => [String(d.document_date || '').slice(0, 10), d]))
  return calendarDaysInMonth(yearMonth).map((day, i) => ({
    ...day,
    lp: i + 1,
    doc: docByDate.get(day.date) || null
  }))
}

function emptyEmployees(count = 12) {
  return Array.from({ length: count }, (_, i) => ({ slot: i + 1, name: '', clothing: '' }))
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

function defaultCalibration(sunday) {
  if (sunday) return { scale_tolerance: '', scale_reading: '', chambers: {} }
  return {
    scale_tolerance: '',
    scale_reading: '',
    chambers: {
      prod: { ref: '', reading: '', action: '' },
      'raw-1': { ref: '', reading: '', action: '' },
      'raw-2': { ref: '', reading: '', action: '' },
      'fg-1': { ref: '', reading: '', action: '' },
      'fg-2': { ref: '', reading: '', action: '' }
    }
  }
}

function defaultStationReadings(stations) {
  const readings = {}
  for (const st of stations || []) {
    readings[st.id] = { bait: '', rodents: false, state: '', notes: '' }
  }
  return readings
}

export function buildRMonthlyMonthPayloads(code, yearMonth, signedBy = '', columnDefs = loadRMonthlyColumns(code)) {
  const cfg = getRMonthlyConfig(code)
  if (!cfg) return []

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

  const cols = columnDefs.map(c => ({ ...c }))
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
      data = { ...base, godzina: '', employees: emptyEmployees(cfg.employeeSlots || 12) }
    } else if (cfg.layout === 'grid-mcd-agent') {
      data = { ...base, cells: defaultDayCells(cols, sunday, cfg.layout) }
    } else if (cfg.layout === 'daily-calibration') {
      data = { ...base, calibration: defaultCalibration(sunday) }
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

export function buildRMonthlySingleDayPayload(code, yearMonth, date, columnDefs, signedBy = '', sunday = false) {
  const cfg = getRMonthlyConfig(code)
  const cols = columnDefs.map(c => ({ ...c }))
  const isSunday = sunday || isSundayDate(date)
  const sortOrder = calendarDaysInMonth(yearMonth).findIndex(d => d.date === date) + 1
  const base = { month_key: yearMonth, sort_order: sortOrder || 99, is_day_off: isSunday, columns: cols, stations: cols }
  let data = { ...base }
  if (cfg?.layout === 'daily-employees') data = { ...base, godzina: '', employees: emptyEmployees(cfg.employeeSlots || 12) }
  else if (cfg?.layout === 'grid-mcd-agent') data = { ...base, cells: defaultDayCells(cols, isSunday, cfg.layout) }
  else if (cfg?.layout === 'daily-calibration') data = { ...base, calibration: defaultCalibration(isSunday) }
  return {
    document_type: code,
    document_date: date,
    document_no: `${code}/${yearMonth}/${String(sortOrder || 99).padStart(2, '0')}`,
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
    body = `<table><thead><tr><th>Lp.</th><th>Dzień</th>${colH}<th>${escapeHtml(cfg.signLabel)}</th></tr></thead><tbody>${rows}</tbody></table>`
  } else if (cfg.layout === 'daily-employees') {
    const calendar = buildCalendarRows(period, docs)
    const slots = cfg.employeeSlots || 12
    const rows = calendar.map(row => {
      const doc = row.doc
      const off = row.isSunday || doc?.data?.is_day_off ? 'day-off' : ''
      if (!doc) return `<tr class="${off}"><td>${formatRMonthlyPlDate(row.date)}</td><td colspan="${slots + 2}">—</td></tr>`
      const emps = doc.data?.employees || emptyEmployees(slots)
      const cells = emps.slice(0, 4).map(e => `<td>${escapeHtml(e.name || '—')}<br/>${escapeHtml(e.clothing || '—')}</td>`).join('')
      return `<tr class="${off}"><td>${formatRMonthlyPlDate(doc.document_date)}<br/>${escapeHtml(doc.data?.godzina || '')}</td>${cells}<td>${escapeHtml(doc.signed_by_operator || '')}</td></tr>`
    }).join('')
    body = `<table><thead><tr><th>Data / godz.</th><th>Nr 1–4 (nazwisko / P/N)*</th><th colspan="3"></th><th>Podpis</th></tr></thead><tbody>${rows}</tbody></table>
<p>* P – prawidłowo, N – nieprawidłowo (odzież)</p>`
  } else if (cfg.layout === 'daily-calibration') {
    const calendar = buildCalendarRows(period, docs)
    const rows = calendar.map(row => {
      const doc = row.doc
      const off = row.isSunday || doc?.data?.is_day_off ? 'day-off' : ''
      const cal = doc?.data?.calibration || {}
      if (!doc) return `<tr class="${off}"><td>${formatRMonthlyPlDate(row.date)}</td><td colspan="6">—</td></tr>`
      return `<tr class="${off}"><td>${formatRMonthlyPlDate(doc.document_date)}</td><td>${escapeHtml(cal.scale_reading || '—')}</td><td>${escapeHtml(cal.chambers?.['raw-1']?.reading || '—')}</td><td>${escapeHtml(cal.chambers?.['raw-2']?.reading || '—')}</td><td>${escapeHtml(cal.chambers?.['fg-1']?.reading || '—')}</td><td>${escapeHtml(cal.chambers?.['fg-2']?.reading || '—')}</td><td>${escapeHtml(doc.signed_by_operator || '')}</td></tr>`
    }).join('')
    body = `<table><thead><tr><th>Data</th><th>Waga 1</th><th>Chł. surowca 1</th><th>Chł. surowca 2</th><th>Chł. gotowe 1</th><th>Chł. gotowe 2</th><th>Podpis</th></tr></thead><tbody>${rows}</tbody></table>`
  } else if (cfg.layout === 'quarter-trend') {
    const doc = docs[0]
    const months = doc?.data?.months || []
    body = `<table><thead><tr><th>Lp.</th><th>Miesiąc</th><th>I. Stacje deratyzacyjne</th><th>II. Pułapki żywołowne</th><th>Trend</th></tr></thead><tbody>
${months.map((m, i) => `<tr><td>${i + 1}</td><td>${m.month || ''}</td><td>Szt.: ${escapeHtml(m.derat_count || '—')} / ${escapeHtml(m.derat_rodents || '—')}</td><td>Szt.: ${escapeHtml(m.trap_count || '—')} / ${escapeHtml(m.trap_rodents || '—')}</td><td>${escapeHtml(m.trend || '—')}</td></tr>`).join('')}
</tbody></table><p>${escapeHtml(doc?.data?.notes || '')}</p>`
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
    rows.push(['Data', 'Godzina', 'Pracownicy 1-4 (nazwisko / P/N)', '', '', '', '', cfg.signLabel])
    buildCalendarRows(period, docs).forEach(row => {
      const doc = row.doc
      if (!doc) { rows.push([formatRMonthlyPlDate(row.date), '', '', '', '', '', '']); return }
      const emps = doc.data?.employees || []
      rows.push([
        formatRMonthlyPlDate(doc.document_date),
        doc.data?.godzina || '',
        ...emps.slice(0, 4).flatMap(e => [e.name || '', e.clothing || '']),
        doc.signed_by_operator || ''
      ])
    })
  } else if (cfg?.layout === 'daily-calibration') {
    const chambers = cfg.chambers || []
    rows.push(['Data', 'Waga', ...chambers.slice(1).map(ch => ch.label), cfg.signLabel])
    buildCalendarRows(period, docs).forEach(row => {
      const doc = row.doc
      const cal = doc?.data?.calibration || {}
      if (!doc) { rows.push([formatRMonthlyPlDate(row.date), ...chambers.slice(1).map(() => ''), '']); return }
      rows.push([
        formatRMonthlyPlDate(doc.document_date),
        cal.scale_reading || '',
        ...chambers.slice(1).map(ch => {
          const c = cal.chambers?.[ch.id] || {}
          return [c.reading || '', c.action || ''].filter(Boolean).join(' ')
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
