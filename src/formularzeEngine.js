/**
 * Formularze F01–F03 (+ F02.1) – układ 1:1 wg wzorów Word.
 */
import { normalizePn } from './haccpFormsEngine'
import { col, dval, buildPeriodGroups, periodLabel, buildManualMonthlyHtml, buildManualExcelRows } from './haccpDocShared'

export const FORMULARZE_ENGINE_VERSION = '1.0'

export const FORMULARZE_CARDS = [
  ['F01', 'F01 – Przeglądy i konserwacje', 'Tabela przeglądów maszyn, konserwacji i remontów pomieszczeń', 'year'],
  ['F02.1', 'F02.1 – Plan szkoleń', 'Roczny plan szkoleń pracowniczych', 'year'],
  ['F02', 'F02 – Wykaz uczestników szkolenia', 'Lista pracowników biorących udział w szkoleniu', 'register'],
  ['F03', 'F03 – Kryteria oceny dostawców', 'Kryteria i ocena dostawców surowca / materiałów', 'register']
]

export const FORMULARZE_FORMS = {
  F01: {
    code: 'F01',
    layout: 'table',
    periodMode: 'year',
    title: 'Formularz F01 – Tabela przeglądów i konserwacji maszyn i urządzeń oraz remontów',
    columns: [
      col('lp', 'Lp.', (_, i) => i + 1),
      col('row_kind', 'Sekcja', d => d.data?.row_kind === 'remont' ? 'Remont pomieszczenia' : 'Przegląd / konserwacja'),
      col('device', 'Nazwa urządzenia / pomieszczenia', d => d.data?.device_name || d.data?.room_name || d.product_name || ''),
      col('review_date', 'Data przeglądu', d => d.data?.review_date || (d.data?.row_kind !== 'remont' ? d.document_date : '') || ''),
      col('review_notes', 'Uwagi (przegląd)', d => d.data?.review_notes || ''),
      col('review_sign', 'Podpis (przegląd)', d => d.data?.review_sign || ''),
      col('service_date', 'Data konserwacji / remontu', d => d.data?.service_date || d.data?.repair_date || (d.data?.row_kind === 'remont' ? d.document_date : '') || ''),
      col('service_notes', 'Uwagi (konserwacja/remont)', d => d.data?.service_notes || d.data?.repair_notes || ''),
      col('service_sign', 'Podpis (konserwacja/remont)', d => d.data?.service_sign || d.data?.repair_sign || d.signed_by_operator || '')
    ],
    fields: [
      { key: 'document_date', label: 'Data wpisu', type: 'date', required: true },
      { key: 'row_kind', label: 'Sekcja', type: 'select', data: true, required: true, options: [
        { value: 'przeglad', label: 'Przegląd / konserwacja maszyny' },
        { value: 'remont', label: 'Remont pomieszczenia' }
      ]},
      { key: 'device_name', label: 'Nazwa urządzenia (sekcja maszyn)', type: 'text', data: true },
      { key: 'room_name', label: 'Nazwa pomieszczenia (sekcja remontów)', type: 'text', data: true },
      { key: 'review_date', label: 'Data przeglądu', type: 'date', data: true },
      { key: 'review_notes', label: 'Uwagi – przegląd', type: 'text', data: true },
      { key: 'review_sign', label: 'Podpis – przegląd', type: 'text', data: true },
      { key: 'service_date', label: 'Data konserwacji', type: 'date', data: true },
      { key: 'service_notes', label: 'Uwagi – konserwacja', type: 'text', data: true },
      { key: 'service_sign', label: 'Podpis – konserwacja', type: 'text', data: true },
      { key: 'repair_date', label: 'Data remontu', type: 'date', data: true },
      { key: 'repair_notes', label: 'Uwagi – remont', type: 'text', data: true },
      { key: 'repair_sign', label: 'Podpis – remont', type: 'text', data: true },
      { key: 'signed_by', label: 'Podpis końcowy', type: 'employee' }
    ]
  },
  'F02.1': {
    code: 'F02.1',
    layout: 'table',
    periodMode: 'year',
    title: 'Formularz F02.1 – Plan szkoleń pracowniczych',
    columns: [
      col('lp', 'Lp.', (_, i) => i + 1),
      col('planned_date', 'Planowana data', d => d.document_date || ''),
      col('topic', 'Temat szkolenia', d => dval(d, 'topic')),
      col('participants', 'Grupa / uczestnicy', d => dval(d, 'participants')),
      col('trainer', 'Prowadzący', d => dval(d, 'trainer')),
      col('duration', 'Czas trwania', d => dval(d, 'duration')),
      col('done', 'Wykonano', d => dval(d, 'done_date') || '—'),
      col('podpis', 'Podpis', d => d.signed_by_operator || '')
    ],
    fields: [
      { key: 'document_date', label: 'Planowana data', type: 'date', required: true },
      { key: 'topic', label: 'Temat szkolenia', type: 'text', data: true, required: true },
      { key: 'participants', label: 'Grupa / uczestnicy', type: 'text', data: true },
      { key: 'trainer', label: 'Prowadzący', type: 'text', data: true },
      { key: 'duration', label: 'Czas trwania', type: 'text', data: true },
      { key: 'done_date', label: 'Data wykonania', type: 'date', data: true },
      { key: 'signed_by', label: 'Podpis', type: 'employee' }
    ]
  },
  F02: {
    code: 'F02',
    layout: 'table',
    periodMode: 'register',
    title: 'Formularz F02 – Wykaz pracowników biorących udział w szkoleniu',
    columns: [
      col('lp', 'Lp.', (_, i) => i + 1),
      col('training_date', 'Data szkolenia', d => dval(d, 'training_date') || d.document_date || ''),
      col('topic', 'Temat szkolenia', d => dval(d, 'topic')),
      col('employee', 'Nazwisko i imię', d => dval(d, 'employee_name') || d.product_name || ''),
      col('position', 'Stanowisko', d => dval(d, 'position')),
      col('podpis', 'Podpis pracownika', d => dval(d, 'employee_sign') || d.signed_by_operator || '')
    ],
    fields: [
      { key: 'document_date', label: 'Data wpisu', type: 'date', required: true },
      { key: 'training_date', label: 'Data szkolenia', type: 'date', data: true, required: true },
      { key: 'topic', label: 'Temat szkolenia', type: 'text', data: true, required: true },
      { key: 'employee_name', label: 'Nazwisko i imię', type: 'text', data: true, required: true },
      { key: 'position', label: 'Stanowisko', type: 'text', data: true },
      { key: 'employee_sign', label: 'Podpis pracownika', type: 'text', data: true },
      { key: 'signed_by', label: 'Podpis prowadzącego', type: 'employee' }
    ]
  },
  F03: {
    code: 'F03',
    layout: 'table',
    periodMode: 'register',
    title: 'Formularz F03 – Kryteria oceny dostawców',
    columns: [
      col('lp', 'Lp.', (_, i) => i + 1),
      col('supplier', 'Nazwa dostawcy', d => dval(d, 'supplier_name') || d.supplier_name || ''),
      col('raw', 'Oceniany surowiec / towar', d => dval(d, 'raw_material') || d.product_name || ''),
      col('part1', 'Część 1 – Komunikacja [pkt]', d => dval(d, 'score_communication')),
      col('part2', 'Część 2 – Terminowość [pkt]', d => dval(d, 'score_timeliness')),
      col('part3', 'Część 3 – Jakość dostaw [pkt]', d => dval(d, 'score_quality')),
      col('part4', 'Część 4 – Certyfikaty [pkt]', d => dval(d, 'score_certificates')),
      col('part5', 'Część 5 – Zgodność ze spec. [pkt]', d => dval(d, 'score_spec')),
      col('total', 'Suma punktów', d => dval(d, 'total_score')),
      col('percent', 'Wynik %', d => dval(d, 'percent_score')),
      col('qualified', 'Dostawca zakwalifikowany', d => normalizePn(dval(d, 'qualified', 'P'))),
      col('risk', 'Ryzyko', d => dval(d, 'risk_level'))
    ],
    fields: [
      { key: 'document_date', label: 'Data oceny', type: 'date', required: true },
      { key: 'supplier_name', label: 'Nazwa dostawcy', type: 'text', data: true, required: true },
      { key: 'raw_material', label: 'Oceniany surowiec / towar', type: 'text', data: true, required: true },
      { key: 'score_communication', label: 'Część 1 – Komunikacja z dostawcą (pkt)', type: 'number', data: true },
      { key: 'score_timeliness', label: 'Część 2 – Terminowość dostaw (pkt)', type: 'number', data: true },
      { key: 'score_quality', label: 'Część 3 – Jakość dostaw (pkt)', type: 'number', data: true },
      { key: 'score_certificates', label: 'Część 4 – Certyfikaty dostawcy (pkt)', type: 'number', data: true },
      { key: 'score_spec', label: 'Część 5 – Zgodność ze specyfikacją (pkt)', type: 'number', data: true },
      { key: 'total_score', label: 'Suma punktów', type: 'number', data: true },
      { key: 'percent_score', label: 'Wynik %', type: 'text', data: true },
      { key: 'qualified', label: 'Dostawca zakwalifikowany', type: 'pn', data: true },
      { key: 'risk_level', label: 'Ryzyko (wysokie/średnie/niskie)', type: 'text', data: true },
      { key: 'signed_by', label: 'Podpis', type: 'employee' }
    ]
  }
}

export function buildFormularzGroups(docs, type, cfg) {
  return buildPeriodGroups(docs, type, cfg)
}

export function formularzPeriodLabel(group, cfg) {
  return periodLabel(group, cfg)
}

export { buildManualMonthlyHtml, buildManualExcelRows }
