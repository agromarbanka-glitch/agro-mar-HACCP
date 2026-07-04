/**
 * Raport R13 – kontrola elementów szklanych (kolumny: Szyba 1, Szyba 2, …).
 * Jedna kartoteka = miesiąc; wiersze = wszystkie dni; niedziele puste (czerwone), edytowalne ręcznie.
 */
import { normalizePn } from './haccpFormsEngine'

export const R13_ENGINE_VERSION = '1.2'
export const R13_COLUMNS_STORAGE = 'agro-mar-r13-columns-v1'

export const R13_HEADER = {
  title: 'Raport R13 - Raport kontroli elementów szklanych',
  version: 'I/2024'
}

export const R13_DEFAULT_COLUMNS = [
  { id: 'szyba-1', label: 'Szyba 1' },
  { id: 'szyba-2', label: 'Szyba 2' }
]

export function loadR13Columns() {
  try {
    const raw = localStorage.getItem(R13_COLUMNS_STORAGE)
    if (!raw) return [...R13_DEFAULT_COLUMNS]
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.length) return [...R13_DEFAULT_COLUMNS]
    return parsed.map((c, i) => ({
      id: String(c.id || `szyba-${i + 1}`),
      label: String(c.label || `Szyba ${i + 1}`)
    }))
  } catch {
    return [...R13_DEFAULT_COLUMNS]
  }
}

export function saveR13Columns(columns) {
  localStorage.setItem(R13_COLUMNS_STORAGE, JSON.stringify(columns))
}

export function formatR13PlDate(iso) {
  if (!iso) return ''
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return iso
  return `${m[3]}.${m[2]}.${m[1]}`
}

export function isSundayDate(iso) {
  if (!iso) return false
  return new Date(`${String(iso).slice(0, 10)}T12:00:00`).getDay() === 0
}

/** Wszystkie dni miesiąca (z flagą niedzieli). */
export function calendarDaysInMonth(yearMonth) {
  const [y, m] = String(yearMonth || '').split('-').map(Number)
  if (!y || !m) return []
  const days = []
  const cursor = new Date(y, m - 1, 1, 12, 0, 0)
  const last = new Date(y, m, 0, 12, 0, 0)
  while (cursor <= last) {
    const yy = cursor.getFullYear()
    const mm = String(cursor.getMonth() + 1).padStart(2, '0')
    const dd = String(cursor.getDate()).padStart(2, '0')
    const iso = `${yy}-${mm}-${dd}`
    days.push({ date: iso, day: cursor.getDate(), isSunday: cursor.getDay() === 0 })
    cursor.setDate(cursor.getDate() + 1)
  }
  return days
}

export function defaultR13Checks(columns, value = '') {
  const checks = {}
  for (const col of columns || []) {
    checks[col.id] = value ? normalizePn(value) : ''
  }
  return checks
}

/** Kolumny zapisane w kartotece lub domyślne z ustawień programu. */
export function r13ColumnsFromDocs(docs, fallback = loadR13Columns()) {
  const first = sortR13Docs(docs)[0]
  const stored = first?.data?.glass_columns
  if (Array.isArray(stored) && stored.length) {
    return stored.map((c, i) => ({
      id: String(c.id || `szyba-${i + 1}`),
      label: String(c.label || `Szyba ${i + 1}`)
    }))
  }
  return fallback.map(c => ({ ...c }))
}

export function r13ChecksForDoc(doc, columns) {
  const raw = { ...(doc?.data?.checks || {}) }
  // migracja ze starego formatu elements (1–23)
  if (!Object.keys(raw).length && doc?.data?.elements) {
    const cols = columns || []
    const allP = !Object.values(doc.data.elements).some(v => normalizePn(v) === 'N')
    return defaultR13Checks(cols, allP ? 'P' : '')
  }
  const checks = {}
  for (const col of columns || []) {
    const val = raw[col.id]
    checks[col.id] = val === '' || val === undefined || val === null ? '' : normalizePn(val)
  }
  return checks
}

export function r13CheckDisplay(value) {
  if (value === '' || value === undefined || value === null) return '—'
  return normalizePn(value)
}

export function r13DocStatus(doc, columns) {
  const cols = columns || r13ColumnsFromDocs([doc])
  const checks = r13ChecksForDoc(doc, cols)
  return Object.values(checks).some(v => v === 'N') ? 'N' : 'P'
}

export function sortR13Docs(docs) {
  return [...(docs || [])].sort((a, b) =>
    Number(a?.data?.sort_order || 0) - Number(b?.data?.sort_order || 0) ||
    String(a.document_date || '').localeCompare(String(b.document_date || '')) ||
    String(a.id || '').localeCompare(String(b.id || ''))
  )
}

export function buildR13CalendarRows(yearMonth, docs = []) {
  const docByDate = new Map((docs || []).map(d => [String(d.document_date || '').slice(0, 10), d]))
  return calendarDaysInMonth(yearMonth).map((day, i) => ({
    ...day,
    lp: i + 1,
    doc: docByDate.get(day.date) || null
  }))
}

export function buildR13MonthPayloads(yearMonth, signedBy = '', columns = loadR13Columns()) {
  const cols = columns.map(c => ({ ...c }))
  return calendarDaysInMonth(yearMonth).map((day, i) => {
    const sunday = day.isSunday
    const checks = defaultR13Checks(cols, sunday ? '' : 'P')
    return {
      document_type: 'R13',
      document_date: day.date,
      document_no: `R13/${yearMonth}/${String(i + 1).padStart(2, '0')}`,
      product_name: 'Kontrola elementów szklanych',
      status: sunday ? 'P' : 'P',
      data: {
        month_key: yearMonth,
        sort_order: i + 1,
        is_day_off: sunday,
        glass_columns: cols,
        checks,
        corrective: '',
        notes_tn: ''
      },
      signed_by_operator: sunday ? '' : (signedBy || ''),
      qty: 0,
      updated_at: new Date().toISOString()
    }
  })
}

export function buildR13PeriodGroups(docs) {
  const map = new Map()
  for (const doc of docs || []) {
    const period = doc?.data?.month_key || String(doc.document_date || '').slice(0, 7) || 'brak-daty'
    const key = `R13|${period}`
    if (!map.has(key)) map.set(key, { key, type: 'R13', period, docs: [] })
    map.get(key).docs.push(doc)
  }
  return Array.from(map.values())
    .map(g => {
      const sorted = sortR13Docs(g.docs)
      const columns = r13ColumnsFromDocs(sorted)
      return { ...g, docs: sorted, columns }
    })
    .sort((a, b) => String(b.period).localeCompare(String(a.period)))
}

export function buildR13SingleDayPayload(yearMonth, date, columns, signedBy = '', isSunday = false) {
  const cols = columns.map(c => ({ ...c }))
  const sunday = isSunday || isSundayDate(date)
  const checks = defaultR13Checks(cols, sunday ? '' : 'P')
  const sortOrder = calendarDaysInMonth(yearMonth).findIndex(d => d.date === date) + 1
  return {
    document_type: 'R13',
    document_date: date,
    document_no: `R13/${yearMonth}/${String(sortOrder || 99).padStart(2, '0')}`,
    product_name: 'Kontrola elementów szklanych',
    status: 'P',
    data: {
      month_key: yearMonth,
      sort_order: sortOrder || 99,
      is_day_off: sunday,
      glass_columns: cols,
      checks,
      corrective: '',
      notes_tn: ''
    },
    signed_by_operator: sunday ? '' : (signedBy || ''),
    qty: 0,
    updated_at: new Date().toISOString()
  }
}

function r13RowCells(doc, columns, escapeHtml, forPrint = true) {
  const checks = r13ChecksForDoc(doc, columns)
  return columns.map(col => {
    const val = r13CheckDisplay(checks[col.id])
    const cls = val === 'N' ? 'pn-n' : ''
    if (forPrint) return `<td class="${cls}">${escapeHtml(val)}</td>`
    return val
  })
}

export function buildR13PrintHtml(group, escapeHtml) {
  const docs = sortR13Docs(group.docs || [])
  const period = String(group.period || '')
  const year = period.slice(0, 4)
  const month = period.slice(5, 7)
  const columns = group.columns || r13ColumnsFromDocs(docs)
  const calendar = buildR13CalendarRows(period, docs)
  const colHeaders = columns.map(c => `<th>${escapeHtml(c.label)}<br/><small>(*P/N)</small></th>`).join('')

  const rows = calendar.map(row => {
    const doc = row.doc
    const dayOff = row.isSunday || doc?.data?.is_day_off
    const offCls = dayOff ? 'day-off' : ''
    if (!doc) {
      const emptyCells = columns.map(() => '<td>—</td>').join('')
      return `<tr class="${offCls}"><td>${row.lp}</td><td>${escapeHtml(formatR13PlDate(row.date))}</td>${emptyCells}<td>—</td><td>—</td></tr>`
    }
    const glassCells = columns.map(col => {
      const checks = r13ChecksForDoc(doc, columns)
      const val = r13CheckDisplay(checks[col.id])
      return `<td class="${val === 'N' ? 'pn-n' : ''}">${escapeHtml(val)}</td>`
    }).join('')
    const corrective = String(doc.data?.corrective || doc.data?.notes_tn || '').trim()
    return `<tr class="${offCls}">
      <td>${row.lp}</td>
      <td>${escapeHtml(formatR13PlDate(doc.document_date))}${dayOff ? '<br/><small>dzień wolny</small>' : ''}</td>
      ${glassCells}
      <td>${escapeHtml(doc.signed_by_operator || '')}</td>
      <td>${escapeHtml(corrective || '—')}</td>
    </tr>`
  }).join('')

  return `<!doctype html><html><head><meta charset="utf-8"><title>R13 ${escapeHtml(period)}</title>
<style>
@page{size:A4 landscape;margin:8mm}body{font-family:"Times New Roman",serif;color:#111;margin:0;font-size:10pt}
table{width:100%;border-collapse:collapse;table-layout:fixed}td,th{border:1px solid #111;padding:3px 4px;text-align:center;vertical-align:middle;font-size:9.5pt}
.left{text-align:left}.title{font-weight:bold;text-align:center}.meta{text-align:left;font-size:10pt}
.pn-n{font-weight:bold}.day-off td{background:#ffe8e8!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.legend{margin-top:10px;font-size:9pt;line-height:1.45;text-align:left}
@media print{button{display:none}}
</style></head><body>
<table><tbody><tr>
  <td class="left" style="width:30%"><b>AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.<br/>24-335 ŁAZISKA, KOLONIA ŁAZISKA 30<br/>NIP: 7171839598</b></td>
  <td class="title" style="width:44%"><b>${escapeHtml(R13_HEADER.title)}</b></td>
  <td class="meta" style="width:26%"><b>Rok:</b> ${escapeHtml(year)}<br/><b>Miesiąc:</b> ${escapeHtml(month)}<br/><b>Str.</b> 1 z 1<br/><b>Wersja</b> ${escapeHtml(R13_HEADER.version)}</td>
</tr></tbody></table>
<table style="margin-top:8px"><thead><tr>
  <th style="width:4%">Lp.</th>
  <th style="width:9%">Data</th>
  ${colHeaders}
  <th style="width:12%">Podpis kontrolującego</th>
  <th style="width:10%">Uwagi **T/N</th>
</tr></thead><tbody>${rows}</tbody></table>
<div class="legend">
  * <b>P</b> – prawidłowo, element cały nieuszkodzony; <b>N</b> – nieprawidłowo, element uszkodzony/zbity/wyszczerbiony.<br/>
  ** <b>T</b> – podjęto działania naprawcze/korekcyjne; <b>N</b> – nie podjęto działań naprawczych.<br/>
  Dni wolne (niedziele) oznaczone różowo – domyślnie puste, uzupełniane ręcznie w razie pracy.
</div>
<script>window.onload=function(){setTimeout(function(){window.focus();window.print()},700)}</script>
</body></html>`
}

export function buildR13ExcelRows(group) {
  const docs = sortR13Docs(group.docs || [])
  const period = String(group.period || '')
  const columns = group.columns || r13ColumnsFromDocs(docs)
  const calendar = buildR13CalendarRows(period, docs)
  const header = ['Lp.', 'Data', ...columns.map(c => `${c.label} (P/N)`), 'Podpis kontrolującego', 'Uwagi **T/N']
  const rows = [
    ['AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.'],
    [R13_HEADER.title, '', '', '', `Okres: ${period}`, `Wersja ${R13_HEADER.version}`],
    header
  ]
  calendar.forEach(row => {
    const doc = row.doc
    if (!doc) {
      rows.push([row.lp, formatR13PlDate(row.date), ...columns.map(() => '—'), '', ''])
      return
    }
    const checks = r13ChecksForDoc(doc, columns)
    rows.push([
      row.lp,
      formatR13PlDate(doc.document_date) + (row.isSunday ? ' (dzień wolny)' : ''),
      ...columns.map(col => r13CheckDisplay(checks[col.id])),
      doc.signed_by_operator || '',
      doc.data?.corrective || doc.data?.notes_tn || ''
    ])
  })
  rows.push([])
  rows.push(['* P – prawidłowo; N – uszkodzenie elementu'])
  rows.push(['** T – podjęto działania naprawcze; N – nie podjęto'])
  return rows
}

/** Dodaje kolumnę do listy (unikalne id). */
export function r13MakeColumn(label) {
  const trimmed = String(label || '').trim() || `Szyba ${Date.now()}`
  const base = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'szyba'
  return { id: `${base}-${Date.now().toString(36).slice(-4)}`, label: trimmed }
}
