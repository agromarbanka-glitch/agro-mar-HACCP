/**
 * R09 – trend aktywności gryzoni na podstawie kartoteki R04.
 * Układ 1:1 ze wzorem Excel (tabele + wykresy słupkowe).
 */

export const R09_ENGINE_VERSION = '1.0'
export const R09_RANGE_STORAGE = 'agro-mar-r09-range-v1'

export const R09_PL_MONTHS = [
  'styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec',
  'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'
]

export const R09_MONTH_COLORS = [
  '#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47',
  '#264478', '#9E480E', '#636363', '#997300', '#255E91', '#43682B'
]

export function formatR09PlDate(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return String(iso || '')
  return `${m[3]}.${m[2]}.${m[1]}`
}

export function formatR09Period(from, to) {
  return `${formatR09PlDate(from)} - ${formatR09PlDate(to)}r.`
}

export function formatR09PeriodFooter(from, to) {
  return `${formatR09PlDate(from)} ${formatR09PlDate(to)}r.`
}

export function parseRodentCount(value) {
  const s = String(value ?? '').trim().toLowerCase()
  if (!s || s.includes('brak')) return 0
  const num = s.match(/\d+/)
  if (num) return Number(num[0])
  if (s.includes('+') || s === 'tak' || s === 'yes' || s === 'obecne') return 1
  return 0
}

export function monthKeyFromDate(iso) {
  return String(iso || '').slice(0, 7)
}

export function monthLabelPl(monthKey) {
  const m = Number(String(monthKey).slice(5, 7))
  return R09_PL_MONTHS[m - 1] || monthKey
}

export function loadR09Range() {
  const now = new Date()
  const y = now.getFullYear()
  const fallback = { dateFrom: `${y}-01-01`, dateTo: now.toISOString().slice(0, 10) }
  try {
    const raw = localStorage.getItem(R09_RANGE_STORAGE)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    return {
      dateFrom: parsed.dateFrom || fallback.dateFrom,
      dateTo: parsed.dateTo || fallback.dateTo
    }
  } catch {
    return fallback
  }
}

export function saveR09Range(dateFrom, dateTo) {
  localStorage.setItem(R09_RANGE_STORAGE, JSON.stringify({ dateFrom, dateTo }))
}

function sortStations(stations, kind) {
  return [...stations].sort((a, b) => {
    if (kind === 'trap') {
      const na = parseInt(String(a.label).replace(/\D/g, ''), 10) || 0
      const nb = parseInt(String(b.label).replace(/\D/g, ''), 10) || 0
      return na - nb
    }
    return (parseInt(a.label, 10) || 0) - (parseInt(b.label, 10) || 0)
  })
}

function trapDisplayLabel(label) {
  const n = String(label).replace(/\D/g, '')
  return n || label
}

function monthsInRange(dateFrom, dateTo) {
  const months = []
  const from = String(dateFrom || '').slice(0, 7)
  const to = String(dateTo || '').slice(0, 7)
  if (!from || !to || from > to) return months
  let [y, m] = from.split('-').map(Number)
  const [y2, m2] = to.split('-').map(Number)
  while (y < y2 || (y === y2 && m <= m2)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`)
    m += 1
    if (m > 12) { m = 1; y += 1 }
  }
  return months
}

export function aggregateR04ForTrend(r04Docs, dateFrom, dateTo) {
  const controls = (r04Docs || []).filter(d => {
    if (d.document_type !== 'R04' || d.data?.is_shell) return false
    const dt = String(d.data?.control_date || d.document_date || '').slice(0, 10)
    return dt && dt >= dateFrom && dt <= dateTo
  })

  const deratMap = new Map()
  const trapMap = new Map()
  const values = {}

  for (const doc of controls) {
    const dt = String(doc.data?.control_date || doc.document_date || '').slice(0, 10)
    const mk = monthKeyFromDate(dt)
    for (const st of doc.data?.stations || []) {
      const kind = st.kind === 'trap' ? 'trap' : 'derat'
      const map = kind === 'trap' ? trapMap : deratMap
      if (!map.has(st.label)) map.set(st.label, { label: st.label, kind })
      const rd = doc.data?.readings?.[st.id] || {}
      const count = parseRodentCount(rd.rodents)
      const key = `${kind}|${st.label}|${mk}`
      values[key] = (values[key] || 0) + count
    }
  }

  const months = monthsInRange(dateFrom, dateTo)
  let deratStations = sortStations(Array.from(deratMap.values()), 'derat')
  let trapStations = sortStations(Array.from(trapMap.values()), 'trap')

  if (!deratStations.length) {
    deratStations = Array.from({ length: 20 }, (_, i) => ({ label: String(i + 1), kind: 'derat' }))
  }
  if (!trapStations.length) {
    trapStations = Array.from({ length: 6 }, (_, i) => ({ label: String(i + 1), kind: 'trap' }))
  }

  function getValue(kind, label, mk) {
    return values[`${kind}|${label}|${mk}`] ?? 0
  }

  function sumKind(kind) {
    return Object.entries(values)
      .filter(([k]) => k.startsWith(`${kind}|`))
      .reduce((s, [, v]) => s + v, 0)
  }

  function maxKind(kind) {
    let max = 0
    for (const [k, v] of Object.entries(values)) {
      if (k.startsWith(`${kind}|`)) max = Math.max(max, v)
    }
    return Math.max(max, 1)
  }

  return {
    dateFrom,
    dateTo,
    months,
    monthLabels: months.map(monthLabelPl),
    deratStations,
    trapStations,
    getValue,
    chartMaxDerat: Math.max(maxKind('derat'), 10),
    chartMaxTrap: Math.max(maxKind('trap'), 10),
    totalDerat: sumKind('derat'),
    totalTrap: sumKind('trap'),
    controlsCount: controls.length
  }
}

function monthColor(i) {
  return R09_MONTH_COLORS[i % R09_MONTH_COLORS.length]
}

function buildDataTable(kind, trend, escapeHtml) {
  const stations = kind === 'derat' ? trend.deratStations : trend.trapStations
  const rowHeader = kind === 'derat'
    ? 'nr stacji deratyzacyjnej'
    : 'nr pułapki żywołownej'
  const monthHeaders = trend.months.map(mk => `<th>${escapeHtml(monthLabelPl(mk))}</th>`).join('')
  const rows = stations.map(st => {
    const label = kind === 'trap' ? trapDisplayLabel(st.label) : st.label
    const cells = trend.months.map(mk => {
      const v = trend.getValue(kind, st.label, mk)
      return `<td>${v}</td>`
    }).join('')
    return `<tr><td>${escapeHtml(label)}</td>${cells}</tr>`
  }).join('')
  const colSpan = Math.max(trend.months.length, 1)
  return `<table class="r09-data-table">
    <thead>
      <tr><th rowspan="2">${escapeHtml(rowHeader)}</th><th colspan="${colSpan}">ilość gryzoni</th></tr>
      <tr>${monthHeaders || '<th>—</th>'}</tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`
}

function buildBarChart(kind, trend, escapeHtml) {
  const stations = kind === 'derat' ? trend.deratStations : trend.trapStations
  const maxY = kind === 'derat' ? trend.chartMaxDerat : trend.chartMaxTrap
  const xLabel = kind === 'derat' ? 'STACJA DERATYZACYJNA' : 'nr pułapki żywołownej'
  const title = kind === 'derat'
    ? `Statystyka aktywności gryzoni w stacjach deratyzacyjnych na terenie firmy AGRO-MAR Mariusz Bańka Sp. z o.o. za okres ${formatR09Period(trend.dateFrom, trend.dateTo)}`
    : `Statystyka aktywności gryzoni w pułapkach żywołownych na terenie firmy AGRO-MAR Mariusz Bańka Sp. z o.o. za okres ${formatR09Period(trend.dateFrom, trend.dateTo)}`
  const total = kind === 'derat' ? trend.totalDerat : trend.totalTrap
  const footerZero = kind === 'trap'
    ? `na terenie firmy AGRO-MAR Mariusz Bańka Sp. z o.o. w okresie ${formatR09PeriodFooter(trend.dateFrom, trend.dateTo)} nie odnotowano gryzoni w pułapkach żywołownych`
    : ''

  const yTicks = Array.from({ length: maxY + 1 }, (_, i) => maxY - i)
  const yGrid = yTicks.map(v => `<div class="r09-y-tick"><span>${v}</span></div>`).join('')

  const groups = stations.map(st => {
    const label = kind === 'trap' ? trapDisplayLabel(st.label) : st.label
    const bars = trend.months.map((mk, mi) => {
      const v = trend.getValue(kind, st.label, mk)
      const h = maxY ? Math.round((v / maxY) * 100) : 0
      return `<div class="r09-bar" style="height:${h}%;background:${monthColor(mi)}" title="${escapeHtml(monthLabelPl(mk))}: ${v}"></div>`
    }).join('')
    return `<div class="r09-bar-group"><div class="r09-bars">${bars || '<div class="r09-bar r09-bar-empty"></div>'}</div><div class="r09-x-label">${escapeHtml(label)}</div></div>`
  }).join('')

  const legend = trend.months.map((mk, i) =>
    `<span class="r09-legend-item"><i style="background:${monthColor(i)}"></i>${escapeHtml(monthLabelPl(mk))}</span>`
  ).join('')

  return `<div class="r09-chart-block">
    <h3 class="r09-chart-title">${escapeHtml(title)}</h3>
    <div class="r09-chart-area">
      <div class="r09-y-title">ILOŚĆ GRYZONI</div>
      <div class="r09-chart-inner">
        <div class="r09-y-axis">${yGrid}</div>
        <div class="r09-plot">${groups}</div>
      </div>
      <div class="r09-x-title">${escapeHtml(xLabel)}</div>
      <div class="r09-legend">${legend}</div>
    </div>
    ${footerZero && total === 0 ? `<p class="r09-chart-footer">${escapeHtml(footerZero)}</p>` : ''}
  </div>`
}

export function buildR09PrintHtml(trend, escapeHtml) {
  if (!trend) return '<!doctype html><html><body>Brak danych R09</body></html>'
  const tables = `<div class="r09-tables-row">${buildDataTable('derat', trend, escapeHtml)}${buildDataTable('trap', trend, escapeHtml)}</div>`
  const charts = buildBarChart('derat', trend, escapeHtml) + buildBarChart('trap', trend, escapeHtml)
  return `<!doctype html><html><head><meta charset="utf-8"><title>R09 Trend</title>
<style>
@page{size:A4 landscape;margin:10mm}body{font-family:"Times New Roman",serif;font-size:10pt;margin:0}
.r09-tables-row{display:flex;gap:16px;align-items:flex-start;margin-bottom:20px}
.r09-data-table{border-collapse:collapse;font-size:9pt}
.r09-data-table th,.r09-data-table td{border:1px solid #111;padding:4px 6px;text-align:center}
.r09-data-table th{background:#f3f3f3;font-weight:bold}
.r09-chart-block{margin:24px 0 30px;page-break-inside:avoid}
.r09-chart-title{font-size:11pt;font-weight:bold;text-align:center;margin:0 0 12px;line-height:1.35}
.r09-chart-area{position:relative;padding-left:28px}
.r09-y-title{position:absolute;left:-4px;top:40%;transform:rotate(-90deg);font-size:9pt;font-weight:bold}
.r09-chart-inner{display:flex;gap:8px;min-height:240px;border-left:1px solid #333;border-bottom:1px solid #333;padding:8px 4px 0}
.r09-y-axis{display:flex;flex-direction:column;justify-content:space-between;font-size:8pt;width:24px;margin-right:4px;height:220px}
.r09-y-tick span{display:block;text-align:right;width:100%}
.r09-plot{display:flex;align-items:flex-end;gap:6px;flex:1;min-height:220px;padding-bottom:2px}
.r09-bar-group{display:flex;flex-direction:column;align-items:center;flex:1;min-width:24px;max-width:48px}
.r09-bars{display:flex;align-items:flex-end;gap:2px;height:200px;width:100%;justify-content:center}
.r09-bar{width:8px;min-height:1px;border:1px solid rgba(0,0,0,.15)}
.r09-bar-empty{width:8px;height:1px;background:#eee}
.r09-x-label{font-size:8pt;margin-top:4px;text-align:center}
.r09-x-title{text-align:center;font-weight:bold;font-size:9pt;margin-top:8px}
.r09-legend{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:10px;font-size:9pt}
.r09-legend-item{display:inline-flex;align-items:center;gap:4px}
.r09-legend-item i{width:12px;height:12px;display:inline-block;border:1px solid #666}
.r09-chart-footer{text-align:left;font-size:9pt;margin-top:10px}
</style></head><body>${tables}${charts}
<script>window.onload=function(){setTimeout(function(){window.focus();window.print()},700)}</script></body></html>`
}

export function buildR09ExcelRows(trend) {
  if (!trend) return [['R09 – brak danych']]
  const rows = [['AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.'], ['Raport R09 - Trend aktywności szkodników', '', formatR09Period(trend.dateFrom, trend.dateTo)]]
  rows.push([])
  rows.push(['nr stacji deratyzacyjnej', 'ilość gryzoni', ...trend.monthLabels])
  for (const st of trend.deratStations) {
    rows.push([st.label, '', ...trend.months.map(mk => trend.getValue('derat', st.label, mk))])
  }
  rows.push([])
  rows.push(['nr pułapki żywołownej', 'ilość gryzoni', ...trend.monthLabels])
  for (const st of trend.trapStations) {
    rows.push([trapDisplayLabel(st.label), '', ...trend.months.map(mk => trend.getValue('trap', st.label, mk))])
  }
  return rows
}
