/** Łączenie wielu kartotek HACCP w jeden wydruk PDF (Zapisz jako PDF). */

export const HACCP_BULK_PDF_VERSION = '1.0'

export const BULK_PRINT_EXTRA_CSS = `
@page { size: A4 landscape; margin: 7mm; }
.bulk-assortment-section { margin: 0; }
.bulk-assortment-heading {
  page-break-before: always;
  font-family: "Times New Roman", serif;
  font-size: 13pt;
  font-weight: bold;
  margin: 0 0 6px;
  padding: 6px 8px;
  background: #eee;
  border: 1px solid #111;
  text-align: left;
}
.bulk-assortment-section:first-child .bulk-assortment-heading { page-break-before: auto; }
.bulk-print-page { page-break-after: always; }
.bulk-assortment-section:last-child .bulk-print-page:last-child { page-break-after: auto; }
.bulk-meta { font-family: "Times New Roman", serif; font-size: 10pt; margin-bottom: 8px; color: #333; }
`

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]))
}

/** Wyciąga style i treść body z gotowego HTML wydruku (bez skryptów auto-print). */
export function extractPrintDocumentParts(html) {
  const raw = String(html || '')
  const styleMatch = raw.match(/<style[^>]*>([\s\S]*?)<\/style>/i)
  const bodyMatch = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  let body = bodyMatch ? bodyMatch[1] : raw
  body = body.replace(/<script[\s\S]*?<\/script>/gi, '').trim()
  return {
    styles: styleMatch ? styleMatch[1].trim() : '',
    body
  }
}

/**
 * @param {{ title: string, subtitle?: string, styleBlocks?: string[], sections: { heading?: string, pages: string[] }[] }} opts
 */
export function buildCombinedLandscapePrintHtml(opts) {
  const title = escapeHtml(opts.title || 'Kartoteki HACCP')
  const subtitle = opts.subtitle ? escapeHtml(opts.subtitle) : ''
  const styleBlocks = [...(opts.styleBlocks || []), BULK_PRINT_EXTRA_CSS]
  const uniqueStyles = [...new Set(styleBlocks.filter(Boolean))].join('\n')

  const sectionsHtml = (opts.sections || []).map(sec => {
    const heading = sec.heading
      ? `<div class="bulk-assortment-heading">${escapeHtml(sec.heading)}</div>`
      : ''
    const pages = (sec.pages || []).map(body => `<div class="bulk-print-page">${body}</div>`).join('')
    return `<section class="bulk-assortment-section">${heading}${pages}</section>`
  }).join('')

  const meta = subtitle ? `<p class="bulk-meta">${subtitle}</p>` : ''

  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${uniqueStyles}</style></head><body>${meta}${sectionsHtml}<script>window.onload=function(){setTimeout(function(){window.focus();window.print()},700)}</script></body></html>`
}
