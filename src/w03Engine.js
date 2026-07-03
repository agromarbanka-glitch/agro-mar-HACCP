/**
 * Wykaz W03 – harmonogram mycia/czyszczenia (układ 1:1 ze wzoru papierowego).
 */
export const W03_ENGINE_VERSION = '1.0'

export const W03_META_STORAGE = 'agro-mar-w03-meta'

export const W03_HEADER = {
  companyLines: [
    'AGRO-MAR Bańka Mariusz',
    'Kol. Łaziska 30',
    '24-335 Łaziska',
    'NIP 717-165-86-26',
    'Regon 060367952'
  ],
  title: 'Wykaz W03 – Wykaz mycia/czyszczenia maszyn i pomieszczeń',
  version: 'I/2020',
  issueDate: '2020-06-02',
  issueDateLabel: '02.06.2020'
}

export const W03_FREQ_KEYS = [
  ['freq_after_use', 'Każdorazowo po użyciu/dostawie'],
  ['freq_daily', '1 raz dziennie'],
  ['freq_weekly', '1 raz w tygodniu'],
  ['freq_monthly', '1 raz w miesiącu'],
  ['freq_bimonthly', '2 razy w miesiącu']
]

/** Domyślne 7 obiektów ze wzoru W03 (2020). */
export const W03_DEFAULT_ROWS = [
  { object_name: 'Chłodnie - podłogi', freq_after_use: '', freq_daily: 'C/M', freq_weekly: '', freq_monthly: '', freq_bimonthly: '' },
  { object_name: 'Waga', freq_after_use: '', freq_daily: 'C/M', freq_weekly: '', freq_monthly: '', freq_bimonthly: '' },
  { object_name: 'Pojemniki na odpady', freq_after_use: '', freq_daily: '', freq_weekly: '', freq_monthly: 'M/D', freq_bimonthly: '' },
  { object_name: 'Plac przyzakładowy', freq_after_use: '', freq_daily: '', freq_weekly: 'C', freq_monthly: '', freq_bimonthly: '' },
  { object_name: 'Wózki widłowe', freq_after_use: '', freq_daily: 'C/D', freq_weekly: '', freq_monthly: '', freq_bimonthly: '' },
  { object_name: 'Pomieszczenie produkcyjne - podłogi', freq_after_use: '', freq_daily: 'C/M', freq_weekly: '', freq_monthly: '', freq_bimonthly: '' },
  { object_name: 'Linia technologiczna', freq_after_use: 'M/C', freq_daily: '', freq_weekly: '', freq_monthly: '', freq_bimonthly: '' }
]

export function getDefaultW03Meta() {
  return {
    version: W03_HEADER.version,
    issueDate: W03_HEADER.issueDate,
    approvalDate: '2020-06-10',
    approvedBy: ''
  }
}

export function loadW03Meta() {
  try {
    const raw = localStorage.getItem(W03_META_STORAGE)
    if (!raw) return getDefaultW03Meta()
    return { ...getDefaultW03Meta(), ...JSON.parse(raw) }
  } catch {
    return getDefaultW03Meta()
  }
}

export function saveW03Meta(meta) {
  localStorage.setItem(W03_META_STORAGE, JSON.stringify(meta))
}

export function w03Freq(doc, key) {
  return String(doc?.data?.[key] ?? '').trim()
}

export function sortW03Docs(docs) {
  return [...(docs || [])].sort((a, b) => {
    const sa = Number(a?.data?.sort_order)
    const sb = Number(b?.data?.sort_order)
    if (sa && sb && sa !== sb) return sa - sb
    if (sa && !sb) return -1
    if (!sa && sb) return 1
    return String(a?.id || '').localeCompare(String(b?.id || ''))
  })
}

export function buildW03InsertPayload(row, sortOrder) {
  const data = {
    object_name: row.object_name,
    freq_after_use: row.freq_after_use || '',
    freq_daily: row.freq_daily || '',
    freq_weekly: row.freq_weekly || '',
    freq_monthly: row.freq_monthly || '',
    freq_bimonthly: row.freq_bimonthly || '',
    sort_order: sortOrder
  }
  return {
    document_type: 'W03',
    document_date: W03_HEADER.issueDate,
    product_name: row.object_name,
    document_no: `W03/${String(sortOrder).padStart(2, '0')}`,
    status: 'P',
    data,
    document_version: W03_HEADER.version,
    qty: 0,
    updated_at: new Date().toISOString()
  }
}

export function buildW03SeedPayloads() {
  return W03_DEFAULT_ROWS.map((row, i) => buildW03InsertPayload(row, i + 1))
}

function formatPlDate(iso) {
  if (!iso) return ''
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return iso
  return `${m[3]}.${m[2]}.${m[1]}`
}

export function buildW03PrintHtml(docs, meta, escapeHtml) {
  const sorted = sortW03Docs(docs)
  const m = meta || getDefaultW03Meta()
  const company = W03_HEADER.companyLines.map(l => escapeHtml(l)).join('<br/>')
  const rows = sorted.map((doc, i) => {
    const cells = W03_FREQ_KEYS.map(([key]) => `<td>${escapeHtml(w03Freq(doc, key))}</td>`).join('')
    return `<tr><td>${i + 1}</td><td class="left">${escapeHtml(doc.data?.object_name || doc.product_name || '')}</td>${cells}</tr>`
  }).join('')
  const freqHead = W03_FREQ_KEYS.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>W03 – Wykaz mycia i czyszczenia</title>
<style>
@page{size:A4 landscape;margin:10mm}
body{font-family:"Times New Roman",Times,serif;color:#111;margin:0;font-size:11pt}
table{width:100%;border-collapse:collapse;table-layout:fixed}
td,th{border:1px solid #111;padding:5px 4px;text-align:center;vertical-align:middle;font-size:10pt;line-height:1.25}
.w03-head td{vertical-align:top}
.w03-company{width:28%;text-align:left;font-weight:bold}
.w03-title{width:52%;text-align:center;font-weight:bold;font-size:12pt}
.w03-meta{width:20%;text-align:left;font-size:10pt}
.w03-table .left{text-align:left}
.w03-legend{margin:10px 0 16px;font-size:10.5pt}
.w03-footer{display:flex;justify-content:space-between;margin-top:20px;font-size:11pt}
@media print{button{display:none}}
</style></head><body>
<table class="w03-head"><tr>
<td class="w03-company">${company}</td>
<td class="w03-title">${escapeHtml(W03_HEADER.title)}</td>
<td class="w03-meta"><b>Wersja</b> ${escapeHtml(m.version || W03_HEADER.version)}<br/><b>Data wydania:</b> ${escapeHtml(formatPlDate(m.issueDate || W03_HEADER.issueDate))}<br/><b>Strona:</b> 1 z 1</td>
</tr></table>
<table class="w03-table"><thead>
<tr><th rowspan="2" style="width:4%">L.p.</th><th rowspan="2" style="width:22%">OBIEKT</th><th colspan="5">CZĘSTOTLIWOŚĆ WYKONYWANIA PROCESU</th></tr>
<tr>${freqHead}</tr>
</thead><tbody>${rows}</tbody></table>
<p class="w03-legend"><b>M</b> – mycie, <b>C</b> – czyszczenie, <b>D</b> – dezynfekcja</p>
<div class="w03-footer">
<span><b>Zatwierdził:</b> ${escapeHtml(m.approvedBy || '')}</span>
<span><b>Data i podpis:</b> ${escapeHtml(formatPlDate(m.approvalDate))}</span>
</div>
<script>window.onload=function(){setTimeout(function(){window.focus();window.print()},700)}</script>
</body></html>`
}

export function buildW03ExcelRows(docs, meta) {
  const sorted = sortW03Docs(docs)
  const m = meta || getDefaultW03Meta()
  const rows = [
    W03_HEADER.companyLines,
    [W03_HEADER.title],
    [`Wersja ${m.version || W03_HEADER.version}`, '', '', `Data wydania: ${formatPlDate(m.issueDate)}`],
    [],
    ['L.p.', 'OBIEKT', ...W03_FREQ_KEYS.map(([, l]) => l)],
    ...sorted.map((doc, i) => [
      i + 1,
      doc.data?.object_name || doc.product_name || '',
      ...W03_FREQ_KEYS.map(([key]) => w03Freq(doc, key))
    ]),
    [],
    ['M – mycie, C – czyszczenie, D – dezynfekcja'],
    [`Zatwierdził: ${m.approvedBy || ''}`, `Data i podpis: ${formatPlDate(m.approvalDate)}`]
  ]
  return rows
}
