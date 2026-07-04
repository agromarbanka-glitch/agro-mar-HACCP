/**
 * Rejestr wszystkich konfiguracji dokumentów HACCP (K, R, W, F, PR, S).
 */
import { MANUAL_HACCP_FORMS } from './haccpFormsEngine'
import { RAPORTY_FORMS } from './raportyEngine'
import { WYKAZY_FORMS } from './wykazyEngine'
import { FORMULARZE_FORMS } from './formularzeEngine'
import { PROTOKOLY_FORMS } from './protokolyEngine'
import { SPECYFIKACJE_FORMS } from './specyfikacjeEngine'
import { buildPeriodGroups, periodLabel, buildDocumentHtml } from './haccpDocShared'

export function getHaccpDocForm(type) {
  return MANUAL_HACCP_FORMS[type]
    || RAPORTY_FORMS[type]
    || WYKAZY_FORMS[type]
    || FORMULARZE_FORMS[type]
    || PROTOKOLY_FORMS[type]
    || SPECYFIKACJE_FORMS[type]
    || null
}

export function isManualHubType(type) {
  const cfg = getHaccpDocForm(type)
  return Boolean(cfg && !MANUAL_HACCP_FORMS[type])
}

export function buildHubDocGroups(docs, type, cfg) {
  return buildPeriodGroups(docs, type, cfg)
}

export function hubPeriodLabel(group, cfg) {
  return periodLabel(group, cfg)
}

export { buildDocumentHtml, buildPeriodGroups, periodLabel }
