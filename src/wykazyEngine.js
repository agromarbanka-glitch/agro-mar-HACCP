/**
 * Wykazy W01–W10 – konfiguracja kartotek i wpisów ręcznych.
 */
import { normalizePn, buildManualMonthlyHtml, buildManualExcelRows } from './haccpFormsEngine'

export const WYKAZY_ENGINE_VERSION = '1.0'

export const WYKAZY_CARDS = [
  ['W01', 'W01 – Orzeczenia lekarskie', 'Wykaz badań lekarskich pracowników', 'year'],
  ['W02', 'W02 – Szkolenia pracowników', 'Szkolenia BHP, HACCP i stanowiskowe', 'year'],
  ['W03', 'W03 – Mycie i czyszczenie', 'Harmonogram mycia pomieszczeń i urządzeń', 'month'],
  ['W04', 'W04 – Środki czystości', 'Środki czyszczące i dezynfekujące', 'register'],
  ['W05', 'W05 – Badania laboratoryjne', 'Harmonogram badań lab. produktu / środowiska', 'year'],
  ['W06', 'W06 – Dostawcy kwalifikowani', 'Lista zatwierdzonych dostawców surowca i materiałów', 'register'],
  ['W07', 'W07 – Audyty higieny', 'Przeprowadzone audyty higieny', 'register'],
  ['W08', 'W08 – Urządzenia pomiarowe', 'Rejestr wzorcowań i kontroli urządzeń', 'register'],
  ['W09', 'W09 – Procedury IFS/HACCP', 'Wdrożone procedury i instrukcje', 'register'],
  ['W10', 'W10 – Plan audytów wewn.', 'Roczny plan audytów wewnętrznych', 'year']
]

function col(key, label, value) {
  return { key, label, value }
}

export const WYKAZY_FORMS = {
  W01: {
    code: 'W01',
    periodMode: 'year',
    title: 'W01 – Wykaz pracowniczych orzeczeń lekarskich',
    columns: [
      col('lp', 'Lp.', (_, i) => i + 1),
      col('employee', 'Pracownik', d => d.data?.employee_name || d.product_name || ''),
      col('exam_date', 'Data badania', d => d.document_date || ''),
      col('valid_until', 'Ważne do', d => d.data?.valid_until || ''),
      col('center', 'Placówka / lekarz', d => d.data?.medical_center || ''),
      col('notes', 'Uwagi', d => d.data?.notes || ''),
      col('podpis', 'Podpis', d => d.signed_by_operator || '')
    ],
    fields: [
      { key: 'document_date', label: 'Data badania', type: 'date', required: true },
      { key: 'employee_name', label: 'Pracownik', type: 'text', data: true, required: true },
      { key: 'valid_until', label: 'Ważne do', type: 'date', data: true, required: true },
      { key: 'medical_center', label: 'Placówka / lekarz', type: 'text', data: true },
      { key: 'notes', label: 'Uwagi', type: 'text', data: true },
      { key: 'signed_by', label: 'Podpis', type: 'employee' }
    ]
  },
  W02: {
    code: 'W02',
    periodMode: 'year',
    title: 'W02 – Wykaz szkoleń pracowniczych',
    columns: [
      col('lp', 'Lp.', (_, i) => i + 1),
      col('employee', 'Pracownik', d => d.data?.employee_name || ''),
      col('date', 'Data szkolenia', d => d.document_date || ''),
      col('topic', 'Temat', d => d.data?.topic || ''),
      col('trainer', 'Prowadzący', d => d.data?.trainer || ''),
      col('valid_until', 'Ważne do', d => d.data?.valid_until || ''),
      col('podpis', 'Podpis', d => d.signed_by_operator || '')
    ],
    fields: [
      { key: 'document_date', label: 'Data szkolenia', type: 'date', required: true },
      { key: 'employee_name', label: 'Pracownik', type: 'text', data: true, required: true },
      { key: 'topic', label: 'Temat szkolenia', type: 'text', data: true, required: true },
      { key: 'trainer', label: 'Prowadzący', type: 'text', data: true },
      { key: 'valid_until', label: 'Ważne do (opcjonalnie)', type: 'date', data: true },
      { key: 'signed_by', label: 'Podpis', type: 'employee' }
    ]
  },
  W03: {
    code: 'W03',
    periodMode: 'month',
    title: 'W03 – Wykaz mycia i czyszczenia',
    columns: [
      col('lp', 'Lp.', (_, i) => i + 1),
      col('date', 'Data', d => d.document_date || ''),
      col('area', 'Obszar / pomieszczenie', d => d.data?.area || ''),
      col('task', 'Czynność', d => d.data?.task || ''),
      col('frequency', 'Częstotliwość', d => d.data?.frequency || ''),
      col('responsible', 'Odpowiedzialny', d => d.data?.responsible || ''),
      col('status', 'Wykonano (P/N)', d => normalizePn(d.data?.status || d.status || 'P')),
      col('podpis', 'Podpis', d => d.signed_by_operator || '')
    ],
    fields: [
      { key: 'document_date', label: 'Data', type: 'date', required: true },
      { key: 'area', label: 'Obszar / pomieszczenie', type: 'text', data: true, required: true },
      { key: 'task', label: 'Czynność', type: 'text', data: true, required: true },
      { key: 'frequency', label: 'Częstotliwość', type: 'text', data: true },
      { key: 'responsible', label: 'Odpowiedzialny', type: 'text', data: true },
      { key: 'status', label: 'Wykonano', type: 'pn', data: true },
      { key: 'signed_by', label: 'Podpis', type: 'employee' }
    ]
  },
  W04: {
    code: 'W04',
    periodMode: 'register',
    title: 'W04 – Wykaz środków czyszczących i dezynfekujących',
    columns: [
      col('lp', 'Lp.', (_, i) => i + 1),
      col('name', 'Nazwa środka', d => d.data?.item_name || d.product_name || ''),
      col('producer', 'Producent / dostawca', d => d.data?.producer || d.supplier_name || ''),
      col('purpose', 'Przeznaczenie', d => d.data?.purpose || ''),
      col('approval', 'Dopuszczenie (P/N)', d => normalizePn(d.data?.approval || 'P')),
      col('valid_until', 'Ważne do', d => d.data?.valid_until || ''),
      col('notes', 'Uwagi', d => d.data?.notes || '')
    ],
    fields: [
      { key: 'document_date', label: 'Data wpisu', type: 'date', required: true },
      { key: 'item_name', label: 'Nazwa środka', type: 'text', data: true, required: true },
      { key: 'producer', label: 'Producent / dostawca', type: 'text', data: true },
      { key: 'purpose', label: 'Przeznaczenie', type: 'text', data: true },
      { key: 'approval', label: 'Dopuszczenie', type: 'pn', data: true },
      { key: 'valid_until', label: 'Ważne do', type: 'date', data: true },
      { key: 'notes', label: 'Uwagi', type: 'text', data: true },
      { key: 'signed_by', label: 'Podpis', type: 'employee' }
    ]
  },
  W05: {
    code: 'W05',
    periodMode: 'year',
    title: 'W05 – Harmonogram zaplanowanych badań laboratoryjnych',
    columns: [
      col('lp', 'Lp.', (_, i) => i + 1),
      col('planned', 'Planowana data', d => d.document_date || ''),
      col('sample', 'Rodzaj próbki / obszar', d => d.data?.sample_type || ''),
      col('parameter', 'Badany parametr', d => d.data?.parameter || ''),
      col('lab', 'Laboratorium', d => d.data?.laboratory || ''),
      col('done', 'Wykonano', d => d.data?.done_date || '—'),
      col('result', 'Wynik (P/N)', d => normalizePn(d.data?.result || 'P')),
      col('podpis', 'Podpis', d => d.signed_by_operator || '')
    ],
    fields: [
      { key: 'document_date', label: 'Planowana data', type: 'date', required: true },
      { key: 'sample_type', label: 'Rodzaj próbki / obszar', type: 'text', data: true, required: true },
      { key: 'parameter', label: 'Badany parametr', type: 'text', data: true, required: true },
      { key: 'laboratory', label: 'Laboratorium', type: 'text', data: true },
      { key: 'done_date', label: 'Data wykonania', type: 'date', data: true },
      { key: 'result', label: 'Wynik', type: 'pn', data: true },
      { key: 'signed_by', label: 'Podpis', type: 'employee' }
    ]
  },
  W06: {
    code: 'W06',
    periodMode: 'register',
    title: 'W06 – Wykaz kwalifikowanych dostawców',
    columns: [
      col('lp', 'Lp.', (_, i) => i + 1),
      col('supplier', 'Dostawca', d => d.data?.supplier_name || d.supplier_name || ''),
      col('product', 'Asortyment', d => d.data?.assortment || d.product_name || ''),
      col('approved', 'Data kwalifikacji', d => d.document_date || ''),
      col('valid_until', 'Ważne do', d => d.data?.valid_until || ''),
      col('rating', 'Ocena (P/N)', d => normalizePn(d.data?.rating || 'P')),
      col('notes', 'Uwagi', d => d.data?.notes || '')
    ],
    fields: [
      { key: 'document_date', label: 'Data kwalifikacji', type: 'date', required: true },
      { key: 'supplier_name', label: 'Dostawca', type: 'text', data: true, required: true },
      { key: 'assortment', label: 'Asortyment', type: 'text', data: true, required: true },
      { key: 'valid_until', label: 'Ważne do', type: 'date', data: true },
      { key: 'rating', label: 'Ocena', type: 'pn', data: true },
      { key: 'notes', label: 'Uwagi', type: 'text', data: true },
      { key: 'signed_by', label: 'Podpis', type: 'employee' }
    ]
  },
  W07: {
    code: 'W07',
    periodMode: 'register',
    title: 'W07 – Wykaz auditów higieny',
    columns: [
      col('lp', 'Lp.', (_, i) => i + 1),
      col('date', 'Data audytu', d => d.document_date || ''),
      col('area', 'Obszar', d => d.data?.area || ''),
      col('auditor', 'Audytor', d => d.data?.auditor || ''),
      col('findings', 'Ustalenia', d => d.data?.findings || ''),
      col('status', 'Status (P/N)', d => normalizePn(d.data?.status || d.status || 'P')),
      col('podpis', 'Podpis', d => d.signed_by_operator || '')
    ],
    fields: [
      { key: 'document_date', label: 'Data audytu', type: 'date', required: true },
      { key: 'area', label: 'Obszar', type: 'text', data: true, required: true },
      { key: 'auditor', label: 'Audytor', type: 'text', data: true },
      { key: 'findings', label: 'Ustalenia / działania', type: 'text', data: true },
      { key: 'status', label: 'Status', type: 'pn', data: true },
      { key: 'signed_by', label: 'Podpis', type: 'employee' }
    ]
  },
  W08: {
    code: 'W08',
    periodMode: 'register',
    title: 'W08 – Wykaz urządzeń kontrolno-pomiarowych',
    columns: [
      col('lp', 'Lp.', (_, i) => i + 1),
      col('device', 'Urządzenie', d => d.data?.device_name || d.product_name || ''),
      col('serial', 'Nr seryjny / ident.', d => d.data?.serial_no || d.lot_no || ''),
      col('calibrated', 'Data wzorcowania', d => d.document_date || ''),
      col('valid_until', 'Ważne do', d => d.data?.valid_until || ''),
      col('lab', 'Laboratorium', d => d.data?.laboratory || ''),
      col('status', 'Status (P/N)', d => normalizePn(d.data?.status || 'P'))
    ],
    fields: [
      { key: 'document_date', label: 'Data wzorcowania', type: 'date', required: true },
      { key: 'device_name', label: 'Urządzenie', type: 'text', data: true, required: true },
      { key: 'serial_no', label: 'Nr seryjny / ident.', type: 'text', data: true },
      { key: 'valid_until', label: 'Ważne do', type: 'date', data: true, required: true },
      { key: 'laboratory', label: 'Laboratorium wzorcujące', type: 'text', data: true },
      { key: 'status', label: 'Status', type: 'pn', data: true },
      { key: 'signed_by', label: 'Podpis', type: 'employee' }
    ]
  },
  W09: {
    code: 'W09',
    periodMode: 'register',
    title: 'W09 – Wykaz procedur i instrukcji wdrożonych w zakładzie',
    columns: [
      col('lp', 'Lp.', (_, i) => i + 1),
      col('code', 'Symbol', d => d.data?.procedure_code || d.document_no || ''),
      col('title', 'Tytuł', d => d.data?.procedure_title || d.product_name || ''),
      col('version', 'Wersja', d => d.data?.version || d.document_version || ''),
      col('approved', 'Data zatwierdzenia', d => d.document_date || ''),
      col('owner', 'Odpowiedzialny', d => d.data?.owner || ''),
      col('status', 'Aktywna (P/N)', d => normalizePn(d.data?.active || 'P'))
    ],
    fields: [
      { key: 'document_date', label: 'Data zatwierdzenia', type: 'date', required: true },
      { key: 'procedure_code', label: 'Symbol dokumentu', type: 'text', data: true, required: true },
      { key: 'procedure_title', label: 'Tytuł', type: 'text', data: true, required: true },
      { key: 'version', label: 'Wersja', type: 'text', data: true },
      { key: 'owner', label: 'Odpowiedzialny', type: 'text', data: true },
      { key: 'active', label: 'Aktywna', type: 'pn', data: true },
      { key: 'signed_by', label: 'Podpis', type: 'employee' }
    ]
  },
  W10: {
    code: 'W10',
    periodMode: 'year',
    title: 'W10 – Roczny plan audytów wewnętrznych',
    columns: [
      col('lp', 'Lp.', (_, i) => i + 1),
      col('planned', 'Planowany termin', d => d.document_date || ''),
      col('scope', 'Zakres audytu', d => d.data?.scope || ''),
      col('auditor', 'Audytor', d => d.data?.auditor || ''),
      col('done', 'Wykonano', d => d.data?.done_date || '—'),
      col('status', 'Status (P/N)', d => normalizePn(d.data?.status || 'P')),
      col('podpis', 'Podpis', d => d.signed_by_operator || '')
    ],
    fields: [
      { key: 'document_date', label: 'Planowany termin', type: 'date', required: true },
      { key: 'scope', label: 'Zakres audytu', type: 'text', data: true, required: true },
      { key: 'auditor', label: 'Audytor', type: 'text', data: true },
      { key: 'done_date', label: 'Data wykonania', type: 'date', data: true },
      { key: 'status', label: 'Status', type: 'pn', data: true },
      { key: 'signed_by', label: 'Podpis', type: 'employee' }
    ]
  }
}

export function getWykazForm(type) {
  return WYKAZY_FORMS[type] || null
}

export function wykazPeriodLabel(group, cfg) {
  if (!group) return '—'
  if (cfg?.periodMode === 'register') return 'Rejestr bieżący'
  if (cfg?.periodMode === 'year') return String(group.period || '').slice(0, 4) || group.period
  const p = String(group.period || '')
  if (p.length >= 7) return `${p.slice(0, 4)}-${p.slice(5, 7)}`
  return p || '—'
}

export function buildWykazGroups(docs, type, cfg) {
  const sorted = [...(docs || [])].sort((a, b) =>
    String(a.document_date || '').localeCompare(String(b.document_date || '')) ||
    String(a.id || '').localeCompare(String(b.id || ''))
  )
  const mode = cfg?.periodMode || 'register'
  if (mode === 'register') {
    if (!sorted.length) return []
    return [{ key: `${type}|register`, type, period: 'register', label: 'Rejestr bieżący', docs: sorted }]
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

export { buildManualMonthlyHtml, buildManualExcelRows }
