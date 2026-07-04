/**
 * Raport R13 – kontrola elementów szklanych i tworzyw sztucznych (układ 1:1 ze wzoru Word).
 * Jedna kartoteka = miesiąc; wiersze = dni robocze (pon–sob, bez niedziel); domyślnie P.
 */
import { normalizePn } from './haccpFormsEngine'

export const R13_ENGINE_VERSION = '1.0'

export const R13_HEADER = {
  title: 'Raport R13 - Raport kontroli elementów szklanych',
  version: 'I/2024'
}

/** 23 elementy szklane ze wzoru – „Szyby (wg nr)”. */
export const R13_GLASS_ELEMENTS = Array.from({ length: 23 }, (_, i) => ({
  no: i + 1,
  label: `Szyba nr ${i + 1}`
}))

export function formatR13PlDate(iso) {
  if (!iso) return ''
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return iso
  return `${m[3]}.${m[2]}.${m[1]}`
}

export function defaultR13ElementsMap(value = 'P') {
  const v = normalizePn(value)
  return Object.fromEntries(R13_GLASS_ELEMENTS.map(e => [String(e.no), v]))
}

/** Dni miesiąca bez niedziel (0 = niedziela). */
export function workDatesInMonth(yearMonth) {
  const [y, m] = String(yearMonth || '').split('-').map(Number)
  if (!y || !m) return []
  const dates = []
  const cursor = new Date(y, m - 1, 1, 12, 0, 0)
  const last = new Date(y, m, 0, 12, 0, 0)
  while (cursor <= last) {
    if (cursor.getDay() !== 0) {
      const yy = cursor.getFullYear()
      const mm = String(cursor.getMonth() + 1).padStart(2, '0')
      const dd = String(cursor.getDate()).padStart(2, '0')
      dates.push(`${yy}-${mm}-${dd}`)
    }
    cursor.setDate(cursor.getDate() + 1)
  }
  return dates
}

export function r13ElementsSummary(elements = {}) {
  const failed = Object.entries(elements)
    .filter(([, v]) => normalizePn(v) === 'N')
    .map(([k]) => k)
    .sort((a, b) => Number(a) - Number(b))
  if (!failed.length) return 'P'
  return `${failed.join(', ')} (N)`
}

export function r13DocStatus(doc) {
  const els = doc?.data?.elements || {}
  return Object.values(els).some(v => normalizePn(v) === 'N') ? 'N' : 'P'
}

export function sortR13Docs(docs) {
  return [...(docs || [])].sort((a, b) =>
    Number(a?.data?.sort_order || 0) - Number(b?.data?.sort_order || 0) ||
    String(a.document_date || '').localeCompare(String(b.document_date || '')) ||
    String(a.id || '').localeCompare(String(b.id || ''))
  )
}

export function buildR13MonthPayloads(yearMonth, signedBy = '') {
  const dates = workDatesInMonth(yearMonth)
  return dates.map((date, i) => ({
    document_type: 'R13',
    document_date: date,
    document_no: `R13/${yearMonth}/${String(i + 1).padStart(2, '0')}`,
    product_name: 'Kontrola elementów szklanych',
    status: 'P',
    data: {
      month_key: yearMonth,
      sort_order: i + 1,
      elements: defaultR13ElementsMap('P'),
      corrective: '',
      notes_tn: ''
    },
    signed_by_operator: signedBy || '',
    qty: 0,
    updated_at: new Date().toISOString()
  }))
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
    .map(g => ({ ...g, docs: sortR13Docs(g.docs) }))
    .sort((a, b) => String(b.period).localeCompare(String(a.period)))
}

export function applyR13Override(doc, ov = {}) {
  const data = { ...(doc.data || {}), ...ov }
  if (ov.elements) data.elements = { ...(doc.data?.elements || {}), ...ov.elements }
  const status = r13DocStatus({ ...doc, data })
  return {
    ...doc,
    data,
    status,
    signed_by_operator: Object.prototype.hasOwnProperty.call(ov, 'signed_by_operator')
      ? ov.signed_by_operator
      : (doc.signed_by_operator || '')
  }
}

export function getLiveR13Doc(doc, overrides = {}) {
  return applyR13Override(doc, overrides[doc?.id] || {})
}

export function buildR13PrintHtml(group, escapeHtml) {
  const docs = sortR13Docs(group.docs || [])
  const period = String(group.period || '')
  const year = period.slice(0, 4)
  const month = period.slice(5, 7)
  const rows = docs.map((doc, i) => {
    const summary = r13ElementsSummary(doc.data?.elements)
    const corrective = String(doc.data?.corrective || doc.data?.notes_tn || '').trim()
    return `<tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(formatR13PlDate(doc.document_date))}</td>
      <td class="${summary.includes('(N)') ? 'pn-n' : ''}">${escapeHtml(summary)}</td>
      <td>${escapeHtml(doc.signed_by_operator || '')}</td>
      <td>${escapeHtml(corrective || '—')}</td>
    </tr>`
  }).join('')

  const glassList = R13_GLASS_ELEMENTS.map(e => `<span class="r13-glass-no">${e.no}</span>`).join('')

  return `<!doctype html><html><head><meta charset="utf-8"><title>R13 ${escapeHtml(period)}</title>
<style>
@page{size:A4 landscape;margin:8mm}body{font-family:"Times New Roman",serif;color:#111;margin:0;font-size:11pt}
table{width:100%;border-collapse:collapse;table-layout:fixed}td,th{border:1px solid #111;padding:4px 6px;text-align:center;vertical-align:middle}
.left{text-align:left}.title{font-weight:bold;text-align:center}.meta{text-align:left;font-size:10pt}
.r13-glass-no{display:inline-block;min-width:18px;margin:0 2px}.pn-n{font-weight:bold}
.legend{margin-top:10px;font-size:9.5pt;line-height:1.45;text-align:left}
.glass-block{margin-top:12px;font-size:10pt;text-align:left}
@media print{button{display:none}}
</style></head><body>
<table><tbody><tr>
  <td class="left" style="width:34%"><b>AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.<br/>24-335 ŁAZISKA, KOLONIA ŁAZISKA 30<br/>NIP: 7171839598</b></td>
  <td class="title" style="width:42%"><b>${escapeHtml(R13_HEADER.title)}</b></td>
  <td class="meta" style="width:24%"><b>Rok:</b> ${escapeHtml(year)}<br/><b>Miesiąc:</b> ${escapeHtml(month)}<br/><b>Str.</b> 1 z 1<br/><b>Wersja</b> ${escapeHtml(R13_HEADER.version)}</td>
</tr></tbody></table>
<table style="margin-top:8px"><thead><tr>
  <th style="width:6%">Lp.</th>
  <th style="width:12%">Data</th>
  <th style="width:22%">Numer elementu szklanego (*P/N)</th>
  <th style="width:22%">Podpis kontrolującego</th>
  <th style="width:18%">Uwagi **T/N</th>
</tr></thead><tbody>${rows}</tbody></table>
<div class="glass-block"><b>Szyby (wg nr):</b> ${glassList}</div>
<div class="legend">
  * <b>P</b> – prawidłowo, element cały nieuszkodzony; <b>N</b> – nieprawidłowo, element uszkodzony/zbity/wyszczerbiony.<br/>
  ** <b>T</b> – podjęto działania naprawcze/korekcyjne; <b>N</b> – nie podjęto działań naprawczych.<br/>
  Kontrola codzienna w dni robocze (bez niedziel).
</div>
<script>window.onload=function(){setTimeout(function(){window.focus();window.print()},700)}</script>
</body></html>`
}

export function buildR13ExcelRows(group) {
  const docs = sortR13Docs(group.docs || [])
  const period = String(group.period || '')
  const rows = [
    ['AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.'],
    [R13_HEADER.title, '', '', '', `Okres: ${period}`, `Wersja ${R13_HEADER.version}`],
    ['Lp.', 'Data', 'Numer elementu szklanego (*P/N)', 'Podpis kontrolującego', 'Uwagi **T/N']
  ]
  docs.forEach((doc, i) => {
    rows.push([
      i + 1,
      formatR13PlDate(doc.document_date),
      r13ElementsSummary(doc.data?.elements),
      doc.signed_by_operator || '',
      doc.data?.corrective || doc.data?.notes_tn || ''
    ])
  })
  rows.push([])
  rows.push(['Szyby (wg nr):', ...R13_GLASS_ELEMENTS.map(e => e.no)])
  rows.push(['* P – prawidłowo; N – uszkodzenie elementu'])
  rows.push(['** T – podjęto działania naprawcze; N – nie podjęto'])
  return rows
}
