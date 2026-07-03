/**
 * Wykazy W01–W10 – konfiguracja kartotek 1:1 wg wzorów Word.
 */
import { normalizePn } from './haccpFormsEngine'
import { col, dval, buildPeriodGroups, periodLabel, buildManualMonthlyHtml, buildManualExcelRows } from './haccpDocShared'

export const WYKAZY_ENGINE_VERSION = '1.3'

export const WYKAZY_CARDS = [
  ['W01', 'W01 – Orzeczenia lekarskie', 'Wykaz pracowniczych orzeczeń lekarskich (san.-epid.)', 'year'],
  ['W02', 'W02 – Szkolenia pracowników', 'Wykaz szkoleń pracowniczych', 'year'],
  ['W03', 'W03 – Mycie i czyszczenie', 'Harmonogram mycia pomieszczeń i urządzeń (M/C/D)', 'register'],
  ['W04', 'W04 – Środki czystości', 'Wykaz środków czyszczących i dezynfekujących', 'register'],
  ['W05', 'W05 – Badania laboratoryjne', 'Harmonogram zaplanowanych badań laboratoryjnych', 'register'],
  ['W06', 'W06 – Dostawcy kwalifikowani', 'Wykaz kwalifikowanych dostawców surowca i materiałów', 'register'],
  ['W07', 'W07 – Audyty higieny', 'Wykaz auditów higieny', 'register'],
  ['W08', 'W08 – Urządzenia pomiarowe', 'Rejestr wzorcowań urządzeń kontrolno-pomiarowych', 'register'],
  ['W09', 'W09 – Procedury IFS/HACCP', 'Spis procedur i instrukcji wdrożonych w zakładzie', 'register'],
  ['W10', 'W10 – Plan audytów wewn.', 'Roczny plan audytów wewnętrznych', 'year']
]

export const WYKAZY_FORMS = {
  W01: {
    code: 'W01',
    layout: 'table',
    periodMode: 'year',
    title: 'Wykaz W01 – Wykaz pracowniczych orzeczeń lekarskich (do celów sanitarno-epidemiologicznych)',
    columns: [
      col('lp', 'Lp.', (_, i) => i + 1),
      col('employee', 'Nazwisko i imię', d => dval(d, 'employee_name') || d.product_name || ''),
      col('position', 'Funkcja / stanowisko', d => dval(d, 'position')),
      col('exam_date', 'Data badania', d => dval(d, 'exam_date') || d.document_date || ''),
      col('next_exam', 'Data kolejnego badania', d => dval(d, 'next_exam_date')),
      col('recorder_sign', 'Podpis uzupełniającego wpisy', d => dval(d, 'recorder_sign') || d.signed_by_operator || '')
    ],
    fields: [
      { key: 'document_date', label: 'Data wpisu', type: 'date', required: true },
      { key: 'employee_name', label: 'Nazwisko i imię', type: 'text', data: true, required: true },
      { key: 'position', label: 'Funkcja / stanowisko', type: 'text', data: true, required: true },
      { key: 'exam_date', label: 'Data badania', type: 'date', data: true, required: true },
      { key: 'next_exam_date', label: 'Data kolejnego badania', type: 'date', data: true, required: true },
      { key: 'recorder_sign', label: 'Podpis uzupełniającego wpisy', type: 'text', data: true },
      { key: 'signed_by', label: 'Podpis', type: 'employee' }
    ]
  },
  W02: {
    code: 'W02',
    layout: 'table',
    periodMode: 'year',
    title: 'W02 – Wykaz szkoleń pracowniczych',
    columns: [
      col('lp', 'Lp.', (_, i) => i + 1),
      col('employee', 'Pracownik', d => dval(d, 'employee_name') || ''),
      col('date', 'Data szkolenia', d => d.document_date || ''),
      col('topic', 'Temat', d => dval(d, 'topic')),
      col('trainer', 'Prowadzący', d => dval(d, 'trainer')),
      col('valid_until', 'Ważne do', d => dval(d, 'valid_until')),
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
    layout: 'table',
    periodMode: 'register',
    title: 'Wykaz W03 – Wykaz mycia/czyszczenia maszyn i pomieszczeń',
    columns: [
      col('lp', 'L.p.', (_, i) => i + 1),
      col('object', 'OBIEKT', d => dval(d, 'object_name') || d.product_name || ''),
      col('freq_after_use', 'Każdorazowo po użyciu/dostawie', d => dval(d, 'freq_after_use') || ''),
      col('freq_daily', '1 raz dziennie', d => dval(d, 'freq_daily') || ''),
      col('freq_weekly', '1 raz w tygodniu', d => dval(d, 'freq_weekly') || ''),
      col('freq_monthly', '1 raz w miesiącu', d => dval(d, 'freq_monthly') || ''),
      col('freq_bimonthly', '2 razy w miesiącu', d => dval(d, 'freq_bimonthly') || '')
    ],
    fields: [
      { key: 'document_date', label: 'Data wpisu', type: 'date', required: true },
      { key: 'object_name', label: 'Obiekt (pomieszczenie / urządzenie)', type: 'text', data: true, required: true },
      { key: 'freq_after_use', label: 'Każdorazowo po użyciu/dostawie (M/C/D)', type: 'text', data: true },
      { key: 'freq_daily', label: '1 raz dziennie (M/C/D)', type: 'text', data: true },
      { key: 'freq_weekly', label: '1 raz w tygodniu (M/C/D)', type: 'text', data: true },
      { key: 'freq_monthly', label: '1 raz w miesiącu (M/C/D)', type: 'text', data: true },
      { key: 'freq_bimonthly', label: '2 razy w miesiącu (M/C/D)', type: 'text', data: true },
      { key: 'signed_by', label: 'Podpis (zatwierdził)', type: 'employee' }
    ]
  },
  W04: {
    code: 'W04',
    layout: 'table',
    periodMode: 'register',
    title: 'W04 – Wykaz środków czyszczących i dezynfekujących',
    columns: [
      col('lp', 'Lp.', (_, i) => i + 1),
      col('name', 'Nazwa środka', d => dval(d, 'item_name') || d.product_name || ''),
      col('producer', 'Producent / dostawca', d => dval(d, 'producer') || d.supplier_name || ''),
      col('purpose', 'Przeznaczenie', d => dval(d, 'purpose')),
      col('approval', 'Dopuszczenie (P/N)', d => normalizePn(dval(d, 'approval', 'P'))),
      col('valid_until', 'Ważne do', d => dval(d, 'valid_until')),
      col('notes', 'Uwagi', d => dval(d, 'notes'))
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
    layout: 'table',
    periodMode: 'register',
    title: 'Wykaz W05 – Harmonogram zaplanowanych badań laboratoryjnych',
    columns: [
      col('lp', 'Lp.', (_, i) => i + 1),
      col('group', 'Grupa produktu / obszar', d => dval(d, 'product_group') || d.product_name || ''),
      col('parameter', 'Parametr badań', d => dval(d, 'parameter')),
      col('frequency', 'Częstotliwość', d => dval(d, 'frequency')),
      col('notes', 'Uwagi', d => dval(d, 'notes'))
    ],
    fields: [
      { key: 'document_date', label: 'Data wpisu', type: 'date', required: true },
      { key: 'product_group', label: 'Grupa produktu / obszar (np. Jabłka, Badania środowiskowe)', type: 'text', data: true, required: true },
      { key: 'parameter', label: 'Parametr badań', type: 'text', data: true, required: true },
      { key: 'frequency', label: 'Częstotliwość', type: 'text', data: true, required: true },
      { key: 'notes', label: 'Uwagi', type: 'text', data: true },
      { key: 'signed_by', label: 'Podpis', type: 'employee' }
    ]
  },
  W06: {
    code: 'W06',
    layout: 'table',
    periodMode: 'register',
    title: 'Wykaz W06 – Wykaz kwalifikowanych dostawców i odbiorców',
    columns: [
      col('lp', 'Lp.', (_, i) => i + 1),
      col('party', 'Typ', d => dval(d, 'party_type') === 'recipient' ? 'Odbiorca' : 'Dostawca'),
      col('kind', 'Kategoria', d => {
        const k = dval(d, 'supplier_kind')
        if (k === 'aux') return 'Materiały pomocnicze'
        if (k === 'recipient') return 'Odbiorca (klient)'
        return 'Surowiec'
      }),
      col('supplier', 'Dane firmy', d => dval(d, 'supplier_name') || d.supplier_name || dval(d, 'company_name') || ''),
      col('nip', 'NIP', d => dval(d, 'nip')),
      col('item', 'Nazwa surowca / towaru', d => dval(d, 'item_name') || d.product_name || ''),
      col('source', 'Źródło', d => dval(d, 'source_doc_kind') || '')
    ],
    fields: [
      { key: 'document_date', label: 'Data wpisu', type: 'date', required: true },
      { key: 'party_type', label: 'Typ', type: 'select', data: true, required: true, options: [
        { value: 'supplier', label: 'Dostawca (PZ)' },
        { value: 'recipient', label: 'Odbiorca (WZ)' }
      ]},
      { key: 'supplier_kind', label: 'Kategoria', type: 'select', data: true, required: true, options: [
        { value: 'raw', label: 'Dostawca surowca' },
        { value: 'aux', label: 'Materiały pomocnicze / opakowania' },
        { value: 'recipient', label: 'Odbiorca (klient)' }
      ]},
      { key: 'company_name', label: 'Nazwa firmy', type: 'text', data: true, required: true },
      { key: 'supplier_name', label: 'Dane firmy (pełne)', type: 'text', data: true },
      { key: 'nip', label: 'NIP', type: 'text', data: true },
      { key: 'item_name', label: 'Nazwa surowca / towaru (przykład)', type: 'text', data: true },
      { key: 'signed_by', label: 'Podpis', type: 'employee' }
    ]
  },
  W07: {
    code: 'W07',
    layout: 'table',
    periodMode: 'register',
    title: 'Wykaz W07 – Wykaz auditów higieny',
    columns: [
      col('lp', 'L.p.', (_, i) => i + 1),
      col('date', 'Data auditu higieny', d => d.document_date || ''),
      col('auditors', 'Osoby przeprowadzające audit', d => dval(d, 'auditors')),
      col('protocol_no', 'Nr protokołu z auditu', d => dval(d, 'protocol_no') || d.document_no || '')
    ],
    fields: [
      { key: 'document_date', label: 'Data auditu higieny', type: 'date', required: true },
      { key: 'auditors', label: 'Osoby przeprowadzające audit', type: 'text', data: true, required: true },
      { key: 'protocol_no', label: 'Nr protokołu z auditu', type: 'text', data: true, required: true },
      { key: 'signed_by', label: 'Podpis (zatwierdził)', type: 'employee' }
    ]
  },
  W08: {
    code: 'W08',
    layout: 'table',
    periodMode: 'register',
    title: 'W08 – Wykaz urządzeń kontrolno-pomiarowych',
    columns: [
      col('lp', 'Lp.', (_, i) => i + 1),
      col('device', 'Urządzenie', d => dval(d, 'device_name') || d.product_name || ''),
      col('serial', 'Nr seryjny / ident.', d => dval(d, 'serial_no') || d.lot_no || ''),
      col('calibrated', 'Data wzorcowania', d => dval(d, 'calibration_date') || d.document_date || ''),
      col('valid_until', 'Ważne do', d => dval(d, 'valid_until')),
      col('lab', 'Laboratorium wzorcujące', d => dval(d, 'laboratory')),
      col('status', 'Status (P/N)', d => normalizePn(dval(d, 'status', 'P')))
    ],
    fields: [
      { key: 'document_date', label: 'Data wpisu', type: 'date', required: true },
      { key: 'device_name', label: 'Urządzenie', type: 'text', data: true, required: true },
      { key: 'serial_no', label: 'Nr seryjny / ident.', type: 'text', data: true },
      { key: 'calibration_date', label: 'Data wzorcowania', type: 'date', data: true },
      { key: 'valid_until', label: 'Ważne do', type: 'date', data: true, required: true },
      { key: 'laboratory', label: 'Laboratorium wzorcujące', type: 'text', data: true },
      { key: 'status', label: 'Status', type: 'pn', data: true },
      { key: 'signed_by', label: 'Podpis', type: 'employee' }
    ]
  },
  W09: {
    code: 'W09',
    layout: 'table',
    periodMode: 'register',
    title: 'W09 – Spis procedur i instrukcji wdrożonych w zakładzie (IFS v8)',
    columns: [
      col('lp', 'Lp.', (_, i) => i + 1),
      col('doc_kind', 'Rodzaj', d => dval(d, 'doc_kind') || '—'),
      col('code', 'Symbol', d => dval(d, 'procedure_code') || d.document_no || ''),
      col('title', 'Tytuł procedury / instrukcji', d => dval(d, 'procedure_title') || d.product_name || ''),
      col('category', 'Kategoria (IFS/GMP/PP/PZ/PI…)', d => dval(d, 'category')),
      col('approved', 'Data zatwierdzenia', d => d.document_date || ''),
      col('active', 'Aktywna (P/N)', d => normalizePn(dval(d, 'active', 'P')))
    ],
    fields: [
      { key: 'document_date', label: 'Data zatwierdzenia', type: 'date', required: true },
      { key: 'doc_kind', label: 'Rodzaj (Procedura / Instrukcja / Karta / Raport…)', type: 'text', data: true, required: true },
      { key: 'procedure_code', label: 'Symbol dokumentu', type: 'text', data: true, required: true },
      { key: 'procedure_title', label: 'Tytuł', type: 'text', data: true, required: true },
      { key: 'category', label: 'Kategoria (IFS/GMP/PP/PZ/PI…)', type: 'text', data: true },
      { key: 'active', label: 'Aktywna', type: 'pn', data: true },
      { key: 'signed_by', label: 'Podpis', type: 'employee' }
    ]
  },
  W10: {
    code: 'W10',
    layout: 'table',
    periodMode: 'year',
    title: 'W10 – Roczny plan audytów wewnętrznych',
    columns: [
      col('lp', 'Lp.', (_, i) => i + 1),
      col('planned', 'Planowany termin', d => d.document_date || ''),
      col('scope', 'Zakres audytu', d => dval(d, 'scope')),
      col('auditor', 'Audytor', d => dval(d, 'auditor')),
      col('done', 'Wykonano (data)', d => dval(d, 'done_date') || '—'),
      col('status', 'Status (P/N)', d => normalizePn(dval(d, 'status', 'P'))),
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
  return periodLabel(group, cfg)
}

export function buildWykazGroups(docs, type, cfg) {
  return buildPeriodGroups(docs, type, cfg)
}

export { buildManualMonthlyHtml, buildManualExcelRows }
