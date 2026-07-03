/**
 * Wspólne helpery dla kartotek / wykazów / formularzy / protokołów / specyfikacji.
 */
import { buildManualMonthlyHtml, buildManualExcelRows } from './haccpFormsEngine'

export function col(key, label, value) {
  return { key, label, value }
}

export function dval(doc, key, fallback = '') {
  return doc?.data?.[key] ?? fallback
}

export function buildPeriodGroups(docs, type, cfg) {
  const sorted = [...(docs || [])].sort((a, b) =>
    String(a.document_date || '').localeCompare(String(b.document_date || '')) ||
    String(a.id || '').localeCompare(String(b.id || ''))
  )
  const mode = cfg?.periodMode || 'register'
  if (mode === 'register') {
    if (!sorted.length) return []
    return [{ key: `${type}|register`, type, period: 'register', label: 'Rejestr bieżący', docs: sorted }]
  }
  if (mode === 'single') {
    if (!sorted.length) return []
    return [{ key: `${type}|single`, type, period: 'single', label: 'Dokument', docs: sorted }]
  }
  const map = new Map()
  for (const doc of sorted) {
    const period = mode === 'year'
      ? String(doc.document_date || '').slice(0, 4) || 'brak-roku'
      : String(doc.document_date || '').slice(0, 7) || 'brak-daty'
    const key = `${type}|${period}`
    if (!map.has(key)) map.set(key, { key, type, period, docs: [] })
    map.get(key).docs.push(doc)
  }
  return Array.from(map.values()).sort((a, b) => String(b.period).localeCompare(String(a.period)))
}

export function periodLabel(group, cfg) {
  if (!group) return '—'
  if (cfg?.periodMode === 'register') return 'Rejestr bieżący'
  if (cfg?.periodMode === 'single') return 'Dokumenty'
  if (cfg?.periodMode === 'year') return String(group.period || '').slice(0, 4) || group.period
  const p = String(group.period || '')
  if (p.length >= 7) return `${p.slice(0, 4)}-${p.slice(5, 7)}`
  return p || '—'
}

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function buildDocumentHtml(doc, cfg) {
  const d = doc?.data || {}
  const date = doc?.document_date || ''
  const year = String(date).slice(0, 4)
  const month = String(date).slice(5, 7) || '—'
  const fields = (cfg.documentFields || cfg.fields || []).filter(f => f.key !== 'signed_by' && f.key !== 'document_date')
  const blocks = fields.map(f => {
    const val = f.data !== false ? (d[f.key] ?? '') : (doc?.[f.key] ?? '')
    if (f.type === 'checkboxes') {
      const opts = f.options || []
      const selected = String(val || '').split(',').map(s => s.trim()).filter(Boolean)
      const line = opts.map(o => `${selected.includes(o) ? '☑' : '☐'} ${o}`).join(' &nbsp; ')
      return `<tr><td class="lbl">${escapeHtml(f.label)}</td><td class="val">${line}</td></tr>`
    }
    if (f.type === 'tri') {
      const v = String(val || '—')
      return `<tr><td class="lbl">${escapeHtml(f.label)}</td><td class="val tri">${escapeHtml(v)}</td></tr>`
    }
    return `<tr><td class="lbl">${escapeHtml(f.label)}</td><td class="val">${escapeHtml(String(val || '')).replace(/\n/g, '<br/>')}</td></tr>`
  }).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(cfg.code)} ${escapeHtml(date)}</title>
<style>@page{size:A4;margin:12mm}body{font-family:"Times New Roman",serif;color:#111;margin:0;font-size:11pt}
.hdr{width:100%;border-collapse:collapse;margin-bottom:10px}.hdr td{border:1px solid #111;padding:6px;vertical-align:top}
.company{width:32%;font-weight:bold}.title{width:48%;font-weight:bold;text-align:center}.meta{width:20%}
.body{width:100%;border-collapse:collapse}.body td{border:1px solid #111;padding:6px;vertical-align:top}
.lbl{width:34%;font-weight:bold;background:#fafafa}.val{white-space:pre-wrap}.sig{margin-top:16px}
@media print{button{display:none}}</style></head><body>
<table class="hdr"><tr>
<td class="company">AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.<br/>24-335 ŁAZISKA, KOLONIA ŁAZISKA 30<br/>NIP: 7171839598</td>
<td class="title">${escapeHtml(cfg.title)}<br/><small>Wersja I/2024</small></td>
<td class="meta"><b>Rok:</b> ${escapeHtml(year)}<br/><b>Miesiąc:</b> ${escapeHtml(month)}<br/><b>Data:</b> ${escapeHtml(date)}</td>
</tr></table>
<table class="body">${blocks}</table>
<p class="sig"><b>Podpis:</b> ${escapeHtml(doc?.signed_by_operator || '')}</p>
<script>window.onload=function(){setTimeout(function(){window.focus();window.print()},700)}</script></body></html>`
}

export { buildManualMonthlyHtml, buildManualExcelRows }
