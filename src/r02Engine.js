/**
 * Raport R02 – mycie/czyszczenie maszyn i urządzeń (kolumny = maszyny, wiersze = dni miesiąca).
 * Układ 1:1 ze wzorem Word; niedziele puste (czerwone), edytowalne ręcznie.
 */
import { calendarDaysInMonth, isSundayDate } from './r13Engine'

export const R02_ENGINE_VERSION = '1.0'
export const R02_COLUMNS_STORAGE = 'agro-mar-r02-columns-v1'

export const R02_HEADER = {
  title: 'Raport R02 - Raport mycia /czyszczenia maszyn i urządzeń',
  version: 'I/2024'
}

export const R02_MCD_OPTIONS = ['', 'M', 'C', 'D', 'M/C', 'C/M', 'M/D', 'C/D', 'M/C/D']

/** Kolumny maszyn/urządzeń ze wzoru Word R02 (I/2024). */
export const R02_DEFAULT_COLUMNS = [
  { id: 'rozladunek-wodny', label: 'Urządzenie do rozładunku wodnego' },
  { id: 'suszenie-surowcow', label: 'Urządzenie do suszenia surowców' },
  { id: 'sortownica-gsv', label: 'Sortownica Green Sort Vision' },
  { id: 'wozki-widlakowe', label: 'Wózki widłowe' },
  { id: 'wanna-zasypowa', label: 'Wanna zasypowa (przed przerobem na pulpę)' },
  { id: 'mlynek', label: 'Młynek' },
  { id: 'waga', label: 'Waga' }
]

export function loadR02Columns() {
  try {
    const raw = localStorage.getItem(R02_COLUMNS_STORAGE)
    if (!raw) return R02_DEFAULT_COLUMNS.map(c => ({ ...c }))
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.length) return R02_DEFAULT_COLUMNS.map(c => ({ ...c }))
    return parsed.map((c, i) => ({
      id: String(c.id || `maszyna-${i + 1}`),
      label: String(c.label || `Maszyna ${i + 1}`),
      auto_m: Boolean(c.auto_m)
    }))
  } catch {
    return R02_DEFAULT_COLUMNS.map(c => ({ ...c }))
  }
}

export function saveR02Columns(columns) {
  localStorage.setItem(R02_COLUMNS_STORAGE, JSON.stringify(columns))
}

export function formatR02PlDate(iso) {
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

export function defaultR02Cleaning(columns, sunday = false) {
  const cleaning = {}
  for (const col of columns || []) {
    if (sunday) cleaning[col.id] = ''
    else if (col.auto_m) cleaning[col.id] = 'M'
    else cleaning[col.id] = ''
  }
  return cleaning
}

export function sortR02Docs(docs) {
  return [...(docs || [])].sort((a, b) =>
    Number(a?.data?.sort_order || 0) - Number(b?.data?.sort_order || 0) ||
    String(a.document_date || '').localeCompare(String(b.document_date || '')) ||
    String(a.id || '').localeCompare(String(b.id || ''))
  )
}

export function r02ColumnsFromDocs(docs, fallback = loadR02Columns()) {
  const first = sortR02Docs(docs)[0]
  const stored = first?.data?.machine_columns || first?.data?.room_columns
  if (Array.isArray(stored) && stored.length) {
    return stored.map((c, i) => ({
      id: String(c.id || `maszyna-${i + 1}`),
      label: String(c.label || `Maszyna ${i + 1}`),
      auto_m: Boolean(c.auto_m)
    }))
  }
  return fallback.map(c => ({ ...c }))
}

export function r02CleaningForDoc(doc, columns) {
  const raw = { ...(doc?.data?.cleaning || {}) }
  if (!Object.keys(raw).length && doc?.data?.cleaning_agent) {
    const cols = columns || []
    const cleaning = defaultR02Cleaning(cols, doc?.data?.is_day_off)
    if (cols[0]) cleaning[cols[0].id] = normalizeMcd(doc.data.cleaning_agent)
    return cleaning
  }
  const cleaning = {}
  for (const col of columns || []) {
    cleaning[col.id] = normalizeMcd(raw[col.id])
  }
  return cleaning
}

export function r02McdDisplay(value) {
  const v = normalizeMcd(value)
  return v || '—'
}

export function buildR02CalendarRows(yearMonth, docs = []) {
  const docByDate = new Map((docs || []).map(d => [String(d.document_date || '').slice(0, 10), d]))
  return calendarDaysInMonth(yearMonth).map((day, i) => ({
    ...day,
    lp: i + 1,
    doc: docByDate.get(day.date) || null
  }))
}

export function buildR02MonthPayloads(yearMonth, signedBy = '', columns = loadR02Columns()) {
  const cols = columns.map(c => ({ ...c }))
  return calendarDaysInMonth(yearMonth).map((day, i) => {
    const sunday = day.isSunday
    const cleaning = defaultR02Cleaning(cols, sunday)
    return {
      document_type: 'R02',
      document_date: day.date,
      document_no: `R02/${yearMonth}/${String(i + 1).padStart(2, '0')}`,
      product_name: 'Raport mycia maszyn i urządzeń',
      status: 'P',
      data: {
        month_key: yearMonth,
        sort_order: i + 1,
        is_day_off: sunday,
        machine_columns: cols,
        cleaning,
        notes: ''
      },
      signed_by_operator: sunday ? '' : (signedBy || ''),
      qty: 0,
      updated_at: new Date().toISOString()
    }
  })
}

export function buildR02SingleDayPayload(yearMonth, date, columns, signedBy = '', isSunday = false) {
  const cols = columns.map(c => ({ ...c }))
  const sunday = isSunday || isSundayDate(date)
  const cleaning = defaultR02Cleaning(cols, sunday)
  const sortOrder = calendarDaysInMonth(yearMonth).findIndex(d => d.date === date) + 1
  return {
    document_type: 'R02',
    document_date: date,
    document_no: `R02/${yearMonth}/${String(sortOrder || 99).padStart(2, '0')}`,
    product_name: 'Raport mycia maszyn i urządzeń',
    status: 'P',
    data: {
      month_key: yearMonth,
      sort_order: sortOrder || 99,
      is_day_off: sunday,
      machine_columns: cols,
      cleaning,
      notes: ''
    },
    signed_by_operator: sunday ? '' : (signedBy || ''),
    qty: 0,
    updated_at: new Date().toISOString()
  }
}

export function buildR02PeriodGroups(docs) {
  const map = new Map()
  for (const doc of docs || []) {
    const period = doc?.data?.month_key || String(doc.document_date || '').slice(0, 7) || 'brak-daty'
    const key = `R02|${period}`
    if (!map.has(key)) map.set(key, { key, type: 'R02', period, docs: [] })
    map.get(key).docs.push(doc)
  }
  return Array.from(map.values())
    .map(g => {
      const sorted = sortR02Docs(g.docs)
      const columns = r02ColumnsFromDocs(sorted)
      return { ...g, docs: sorted, columns }
    })
    .sort((a, b) => String(b.period).localeCompare(String(a.period)))
}

export function r02MakeColumn(label) {
  const trimmed = String(label || '').trim() || `Maszyna ${Date.now()}`
  const base = trimmed.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'maszyna'
  return { id: `${base}-${Date.now().toString(36).slice(-4)}`, label: trimmed, auto_m: false }
}

export function buildR02PrintHtml(group, escapeHtml) {
  const docs = sortR02Docs(group.docs || [])
  const period = String(group.period || '')
  const year = period.slice(0, 4)
  const month = period.slice(5, 7)
  const columns = group.columns || r02ColumnsFromDocs(docs)
  const calendar = buildR02CalendarRows(period, docs)
  const colHeaders = columns.map(c =>
    `<th>${escapeHtml(c.label)}<br/><small>(M/C/D*)</small></th>`
  ).join('')

  const rows = calendar.map(row => {
    const doc = row.doc
    const dayOff = row.isSunday || doc?.data?.is_day_off
    const offCls = dayOff ? 'day-off' : ''
    if (!doc) {
      const emptyCells = columns.map(() => '<td>—</td>').join('')
      return `<tr class="${offCls}"><td>${row.lp}</td><td>${escapeHtml(formatR02PlDate(row.date))}</td>${emptyCells}<td>—</td></tr>`
    }
    const cleaning = r02CleaningForDoc(doc, columns)
    const cells = columns.map(col => `<td>${escapeHtml(r02McdDisplay(cleaning[col.id]))}</td>`).join('')
    return `<tr class="${offCls}">
      <td>${row.lp}</td>
      <td>${escapeHtml(formatR02PlDate(doc.document_date))}${dayOff ? '<br/><small>dzień wolny</small>' : ''}</td>
      ${cells}
      <td>${escapeHtml(doc.signed_by_operator || '')}</td>
    </tr>`
  }).join('')

  return `<!doctype html><html><head><meta charset="utf-8"><title>R02 ${escapeHtml(period)}</title>
<style>
@page{size:A4 landscape;margin:8mm}body{font-family:"Times New Roman",serif;color:#111;margin:0;font-size:10pt}
table{width:100%;border-collapse:collapse;table-layout:fixed}td,th{border:1px solid #111;padding:3px 4px;text-align:center;vertical-align:middle;font-size:9pt}
.left{text-align:left}.title{font-weight:bold;text-align:center}.meta{text-align:left;font-size:10pt}
.day-off td{background:#ffe8e8!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.legend{margin-top:10px;font-size:9pt;line-height:1.45;text-align:left}
@media print{button{display:none}}
</style></head><body>
<table><tbody><tr>
  <td class="left" style="width:30%"><b>AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.<br/>24-335 ŁAZISKA, KOLONIA ŁAZISKA 30<br/>NIP: 7171839598</b></td>
  <td class="title" style="width:44%"><b>${escapeHtml(R02_HEADER.title)}</b></td>
  <td class="meta" style="width:26%"><b>Rok:</b> ${escapeHtml(year)}<br/><b>Miesiąc:</b> ${escapeHtml(month)}<br/><b>Str.</b> 1 z 1<br/><b>Wersja</b> ${escapeHtml(R02_HEADER.version)}</td>
</tr></tbody></table>
<table style="margin-top:8px"><thead><tr>
  <th style="width:4%">Lp.</th>
  <th style="width:9%">Dzień w miesiącu</th>
  ${colHeaders}
  <th style="width:12%">Podpis osoby uzupełniającej wpisy</th>
</tr></thead><tbody>${rows}</tbody></table>
<div class="legend">
  * <b>M</b> – Mycie; <b>C</b> – Czyszczenie; <b>D</b> – Dezynfekcja (można łączyć, np. M/C, C/D).<br/>
  Dni wolne (niedziele) oznaczone różowo – domyślnie puste, uzupełniane ręcznie w razie pracy.
</div>
<script>window.onload=function(){setTimeout(function(){window.focus();window.print()},700)}</script>
</body></html>`
}

export function buildR02ExcelRows(group) {
  const docs = sortR02Docs(group.docs || [])
  const period = String(group.period || '')
  const columns = group.columns || r02ColumnsFromDocs(docs)
  const calendar = buildR02CalendarRows(period, docs)
  const header = ['Lp.', 'Dzień w miesiącu', ...columns.map(c => `${c.label} (M/C/D)`), 'Podpis osoby uzupełniającej wpisy']
  const rows = [
    ['AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.'],
    [R02_HEADER.title, '', '', '', `Okres: ${period}`, `Wersja ${R02_HEADER.version}`],
    header
  ]
  calendar.forEach(row => {
    const doc = row.doc
    if (!doc) {
      rows.push([row.lp, formatR02PlDate(row.date), ...columns.map(() => '—'), ''])
      return
    }
    const cleaning = r02CleaningForDoc(doc, columns)
    rows.push([
      row.lp,
      formatR02PlDate(doc.document_date) + (row.isSunday ? ' (dzień wolny)' : ''),
      ...columns.map(col => r02McdDisplay(cleaning[col.id])),
      doc.signed_by_operator || ''
    ])
  })
  rows.push([])
  rows.push(['* M – Mycie; C – Czyszczenie; D – Dezynfekcja'])
  return rows
}
