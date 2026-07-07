import React from 'react'
import {
  getKartotekaPrintInfo,
  formatKartotekaPrintDate,
  PRINT_STATUS_NEEDS_REPRINT
} from './kartotekaPrintEngine'

export function KartotekaPrintBadge({ group, localPrints = {}, onToggle }) {
  const info = getKartotekaPrintInfo(group, localPrints)
  if (!info.printed) return null

  const needsReprint = info.status === PRINT_STATUS_NEEDS_REPRINT
  const when = formatKartotekaPrintDate(info.printedAt)
  const who = info.printedBy ? ` · ${info.printedBy}` : ''

  const title = needsReprint
    ? `Do ponownego wydruku (ostatni: ${when}${who}). Kliknij, aby oznaczyć jako wydrukowane.`
    : `Wydrukowano: ${when}${who}. Kliknij, aby oznaczyć „do ponownego wydruku”.`

  return (
    <button
      type="button"
      className={`kartoteka-print-badge no-print${needsReprint ? ' needs-reprint' : ' printed'}`}
      title={title}
      aria-label={title}
      onClick={e => {
        e.preventDefault()
        e.stopPropagation()
        onToggle?.(group)
      }}
    />
  )
}
