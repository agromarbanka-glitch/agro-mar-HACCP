import React from 'react'
import { getKartotekaPrintInfo, formatKartotekaPrintDate } from './kartotekaPrintEngine'

export function KartotekaPrintBadge({ group, localPrints = {} }) {
  const info = getKartotekaPrintInfo(group, localPrints)
  if (!info.printed) return null
  const title = `Wydrukowano: ${formatKartotekaPrintDate(info.printedAt)}${info.printedBy ? ` · ${info.printedBy}` : ''}`
  return <span className="kartoteka-print-badge" title={title} aria-label={title} />
}
