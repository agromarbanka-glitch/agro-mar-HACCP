/**
 * Raport R11 – kontrola magnesów (układ 1:1 ze wzorem Word/Excel).
 * Kartoteka miesięczna: wpisy auto z K03 (przerób malina / porzeczka czarna) – „–” w magnesach, „P” w uwagach.
 */
import { normalizePn, shouldIncludeK03InK07, k06EvaluationDateFromK03 } from './haccpFormsEngine'
import { calendarDaysInMonth, isSundayDate, formatR13PlDate } from './r13Engine'

export const R11_ENGINE_VERSION = '1.1'
export const R11_COLUMNS_STORAGE = 'agro-mar-r11-columns-v1'

export const R11_HEADER = {
  title: 'Raport R11',
  subtitle: '- Raport kontroli magnesów',
  version: 'I/2024'
}

export const R11_DEFAULT_COLUMNS = [
  {
    id: 'magnet-mill',
    label: 'Przed młynkiem do rozdrabniania (za wanną zasypową) (+/-)*'
  },
  {
    id: 'magnet-tanks',
    label: 'Przy zbiornikach na pulpę (po rozdrobnieniu) (+/-)*'
  }
]

export function loadR11Columns() {
  try {
    const raw = localStorage.getItem(R11_COLUMNS_STORAGE)
    if (!raw) return R11_DEFAULT_COLUMNS.map(c => ({ ...c }))
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.length) return R11_DEFAULT_COLUMNS.map(c => ({ ...c }))
    return parsed.map((c, i) => ({
      id: String(c.id || `magnet-${i + 1}`),
      label: String(c.label || `Magnes ${i + 1}`)
    }))
  } catch {
    return R11_DEFAULT_COLUMNS.map(c => ({ ...c }))
  }
}

export function saveR11Columns(columns) {
  localStorage.setItem(R11_COLUMNS_STORAGE, JSON.stringify(columns))
}

export function r11MakeColumn(label) {
  const trimmed = String(label || '').trim() || `Magnes ${Date.now()}`
  const base = trimmed.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'magnet'
  return { id: `${base}-${Date.now().toString(36).slice(-4)}`, label: trimmed }
}

export function defaultR11Magnets(columns, dayOff = false, przerob = false) {
  const magnets = {}
  for (const col of columns || []) {
    if (dayOff) magnets[col.id] = ''
    else magnets[col.id] = przerob ? '-' : '-'
  }
  return magnets
}

/** Dni przerobu pulpy (malina / porzeczka czarna) z kart K03. */
export function collectR11PrzerobDaysFromK03(k03Forms = []) {
  const byDate = new Map()
  for (const k03 of k03Forms || []) {
    if (!shouldIncludeK03InK07(k03)) continue
    const date = k06EvaluationDateFromK03(k03)
    if (!date || date === '0000-01-01') continue
    if (!byDate.has(date)) byDate.set(date, { k03Keys: [], products: [] })
    const entry = byDate.get(date)
    if (!entry.k03Keys.includes(k03.id)) entry.k03Keys.push(k03.id)
    const name = String(k03.product_name || '').trim()
    if (name && !entry.products.includes(name)) entry.products.push(name)
  }
  return byDate
}

export function buildR11PrzerobDayPayload(yearMonth, date, columns, meta = {}, signedBy = '') {
  const cols = (columns || loadR11Columns()).map(c => ({ ...c }))
  const sunday = isSundayDate(date)
  const sortOrder = calendarDaysInMonth(yearMonth).findIndex(d => d.date === date) + 1
  const magnets = defaultR11Magnets(cols, sunday, true)
  return {
    document_type: 'R11',
    document_date: date,
    document_no: `R11/${yearMonth}/${String(sortOrder || 99).padStart(2, '0')}`,
    product_name: `${R11_HEADER.title} ${R11_HEADER.subtitle}`,
    status: 'P',
    data: {
      month_key: yearMonth,
      sort_order: sortOrder || 99,
      is_day_off: sunday,
      magnet_columns: cols,
      magnets,
      uwagi_pn: sunday ? '' : 'P',
      auto_source: 'k03_przerob',
      k03_keys: meta.k03Keys || [],
      przerob_products: meta.products || []
    },
    signed_by_operator: sunday ? '' : (signedBy || ''),
    qty: 0,
    updated_at: new Date().toISOString()
  }
}

/** Payloady R11 do insertu – jeden wiersz na dzień przerobu z K03 (malina / porzeczka czarna). */
export function buildR11SyncPayloads(k03Forms = [], existingR11Docs = [], columns = loadR11Columns()) {
  const przerobDays = collectR11PrzerobDaysFromK03(k03Forms)
  const existingByDate = new Map(
    (existingR11Docs || [])
      .filter(d => d.document_type === 'R11')
      .map(d => [String(d.document_date || '').slice(0, 10), d])
  )
  const toInsert = []
  for (const [date, meta] of przerobDays) {
    if (existingByDate.has(date)) continue
    const yearMonth = date.slice(0, 7)
    toInsert.push(buildR11PrzerobDayPayload(yearMonth, date, columns, meta))
  }
  return toInsert
}

export function r11ColumnsFromDocs(docs, fallback = loadR11Columns()) {
  const first = sortR11Docs(docs)[0]
  const stored = first?.data?.magnet_columns
  if (Array.isArray(stored) && stored.length) {
    return stored.map((c, i) => ({
      id: String(c.id || `magnet-${i + 1}`),
      label: String(c.label || `Magnes ${i + 1}`)
    }))
  }
  return fallback.map(c => ({ ...c }))
}

export function r11MagnetsForDoc(doc, columns) {
  const raw = { ...(doc?.data?.magnets || {}) }
  const magnets = {}
  for (const col of columns || []) {
    const val = raw[col.id]
    if (val === '' || val === undefined || val === null) magnets[col.id] = ''
    else magnets[col.id] = String(val)
  }
  return magnets
}

export function r11MagnetDisplay(value) {
  if (value === '' || value === undefined || value === null) return '—'
  return String(value)
}

export function r11UwagiForDoc(doc, dayOff = false) {
  if (dayOff || doc?.data?.is_day_off) return ''
  const v = doc?.data?.uwagi_pn
  if (v === '' || v === undefined || v === null) return 'P'
  return normalizePn(v)
}

export function r11DocStatus(doc, columns) {
  const uwagi = r11UwagiForDoc(doc, doc?.data?.is_day_off)
  if (uwagi === 'N') return 'N'
  const magnets = r11MagnetsForDoc(doc, columns)
  return Object.values(magnets).some(v => v === 'N') ? 'N' : 'P'
}

export function sortR11Docs(docs) {
  return [...(docs || [])].sort((a, b) =>
    Number(a?.data?.sort_order || 0) - Number(b?.data?.sort_order || 0) ||
    String(a.document_date || '').localeCompare(String(b.document_date || '')) ||
    String(a.id || '').localeCompare(String(b.id || ''))
  )
}

export function buildR11CalendarRows(yearMonth, docs = []) {
  const docByDate = new Map((docs || []).map(d => [String(d.document_date || '').slice(0, 10), d]))
  return calendarDaysInMonth(yearMonth).map((day, i) => ({
    ...day,
    lp: i + 1,
    doc: docByDate.get(day.date) || null
  }))
}

export function buildR11MonthPayloads(yearMonth, signedBy = '', columns = loadR11Columns()) {
  const cols = columns.map(c => ({ ...c }))
  return calendarDaysInMonth(yearMonth).map((day, i) => {
    const sunday = day.isSunday
    return {
      document_type: 'R11',
      document_date: day.date,
      document_no: `R11/${yearMonth}/${String(i + 1).padStart(2, '0')}`,
      product_name: `${R11_HEADER.title} ${R11_HEADER.subtitle}`,
      status: 'P',
      data: {
        month_key: yearMonth,
        sort_order: i + 1,
        is_day_off: sunday,
        magnet_columns: cols,
        magnets: defaultR11Magnets(cols, sunday),
        uwagi_pn: sunday ? '' : 'P'
      },
      signed_by_operator: sunday ? '' : (signedBy || ''),
      qty: 0,
      updated_at: new Date().toISOString()
    }
  })
}

export function buildR11SingleDayPayload(yearMonth, date, columns, signedBy = '', isSunday = false) {
  const cols = columns.map(c => ({ ...c }))
  const sunday = isSunday || isSundayDate(date)
  const sortOrder = calendarDaysInMonth(yearMonth).findIndex(d => d.date === date) + 1
  return {
    document_type: 'R11',
    document_date: date,
    document_no: `R11/${yearMonth}/${String(sortOrder || 99).padStart(2, '0')}`,
    product_name: `${R11_HEADER.title} ${R11_HEADER.subtitle}`,
    status: 'P',
    data: {
      month_key: yearMonth,
      sort_order: sortOrder || 99,
      is_day_off: sunday,
      magnet_columns: cols,
      magnets: defaultR11Magnets(cols, sunday),
      uwagi_pn: sunday ? '' : 'P'
    },
    signed_by_operator: sunday ? '' : (signedBy || ''),
    qty: 0,
    updated_at: new Date().toISOString()
  }
}

function r11PrintHeader(period, escapeHtml) {
  const year = period.slice(0, 4)
  const month = period.slice(5, 7)
  return `<table><tbody><tr>
  <td class="left" style="width:30%"><b>AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.<br/>24-335 ŁAZISKA, KOLONIA ŁAZISKA 30<br/>NIP: 7171839598</b></td>
  <td class="title" style="width:44%"><b>${escapeHtml(R11_HEADER.title)}</b><br/>${escapeHtml(R11_HEADER.subtitle)}</td>
  <td class="meta" style="width:26%"><b>Rok:</b> ${escapeHtml(year)}<br/><b>Miesiąc:</b> ${escapeHtml(month)}<br/><b>Str.</b> 1 z 1<br/><b>Wersja</b> ${escapeHtml(R11_HEADER.version)}</td>
</tr></tbody></table>`
}

export function buildR11PrintHtml(group, escapeHtml) {
  const docs = sortR11Docs(group.docs || [])
  const period = String(group.period || '')
  const columns = group.columns || r11ColumnsFromDocs(docs)
  const calendar = buildR11CalendarRows(period, docs)
  const colSpan = Math.max(columns.length, 1)
  const subHeaders = columns.map(c => `<th>${escapeHtml(c.label)}</th>`).join('')

  const rows = calendar.map(row => {
    const doc = row.doc
    const dayOff = row.isSunday || doc?.data?.is_day_off
    const offCls = dayOff ? 'day-off' : ''
    if (!doc) {
      const emptyCells = columns.map(() => '<td>—</td>').join('')
      return `<tr class="${offCls}"><td>${row.lp}</td><td>${escapeHtml(formatR13PlDate(row.date))}</td>${emptyCells}<td></td><td>—</td></tr>`
    }
    const magnets = r11MagnetsForDoc(doc, columns)
    const magnetCells = columns.map(col => {
      const val = r11MagnetDisplay(magnets[col.id])
      return `<td>${escapeHtml(val)}</td>`
    }).join('')
    const uwagi = r11UwagiForDoc(doc, dayOff)
    return `<tr class="${offCls}">
      <td>${row.lp}</td>
      <td>${escapeHtml(formatR13PlDate(doc.document_date))}</td>
      ${magnetCells}
      <td>${escapeHtml(doc.signed_by_operator || '')}</td>
      <td>${escapeHtml(uwagi || '—')}</td>
    </tr>`
  }).join('')

  return `<!doctype html><html><head><meta charset="utf-8"><title>R11 ${escapeHtml(period)}</title>
<style>
@page{size:A4 landscape;margin:8mm}body{font-family:"Times New Roman",serif;color:#111;margin:0;font-size:10pt}
table{width:100%;border-collapse:collapse;table-layout:fixed}td,th{border:1px solid #111;padding:3px 4px;text-align:center;vertical-align:middle;font-size:9pt;line-height:1.2}
.left{text-align:left}.title{font-weight:bold;text-align:center}.meta{text-align:left;font-size:10pt}
.day-off td{background:#ffe8e8!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.legend{margin-top:10px;font-size:9pt;line-height:1.45;text-align:left}
@media print{button{display:none}}
</style></head><body>
${r11PrintHeader(period, escapeHtml)}
<table style="margin-top:8px"><thead>
  <tr>
    <th rowspan="2" style="width:4%">Lp.</th>
    <th rowspan="2" style="width:8%">Data</th>
    <th colspan="${colSpan}">Miejsce magnesów (*P/N)/</th>
    <th rowspan="2" style="width:12%">Podpis</th>
    <th rowspan="2" style="width:14%">Uwagi (skuteczność)<br/>(magnesy czyste) (P/N)*</th>
  </tr>
  <tr>${subHeaders}</tr>
</thead><tbody>${rows}</tbody></table>
<div class="legend">
  * <b>+</b> – wykryto metal; <b>–</b> – brak wykrycia metalu.<br/>
  ** <b>P</b> – prawidłowo (magnesy czyste, skuteczne); <b>N</b> – nieprawidłowo.<br/>
  Dni wolne od pracy (niedziele) oznaczone jasnoczerwonym – domyślnie puste, uzupełniane ręcznie w razie pracy.
</div>
<script>window.onload=function(){setTimeout(function(){window.focus();window.print()},700)}</script>
</body></html>`
}

export function buildR11ExcelRows(group) {
  const docs = sortR11Docs(group.docs || [])
  const period = String(group.period || '')
  const columns = group.columns || r11ColumnsFromDocs(docs)
  const calendar = buildR11CalendarRows(period, docs)
  const header = ['Lp.', 'Data', ...columns.map(c => c.label), 'Podpis', 'Uwagi (skuteczność) (magnesy czyste) (P/N)*']
  const rows = [
    ['AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.'],
    [`${R11_HEADER.title} ${R11_HEADER.subtitle}`, '', '', '', `Okres: ${period}`, `Wersja ${R11_HEADER.version}`],
    header
  ]
  calendar.forEach(row => {
    const doc = row.doc
    if (!doc) {
      rows.push([row.lp, formatR13PlDate(row.date), ...columns.map(() => '—'), '', ''])
      return
    }
    const dayOff = row.isSunday || doc.data?.is_day_off
    const magnets = r11MagnetsForDoc(doc, columns)
    rows.push([
      row.lp,
      formatR13PlDate(doc.document_date) + (dayOff ? ' (dzień wolny)' : ''),
      ...columns.map(col => r11MagnetDisplay(magnets[col.id])),
      doc.signed_by_operator || '',
      r11UwagiForDoc(doc, dayOff) || '—'
    ])
  })
  return rows
}
