/**
 * Raporty R00–R13 – układ 1:1 wg wzorów Word (docs/wzory/Raport R*.docx).
 */
import { normalizePn } from './haccpFormsEngine'
import { col, dval, buildPeriodGroups, periodLabel, buildManualMonthlyHtml, buildManualExcelRows } from './haccpDocShared'

export const RAPORTY_ENGINE_VERSION = '1.1'

export const RAPORTY_CARDS = [
  ['R00', 'R00 – Dopuszczenie do pracy', 'Raport dopuszczenia pracowników do pracy', 'register'],
  ['R01', 'R01 – Mycie pomieszczeń', 'Raport mycia i czyszczenia pomieszczeń', 'month'],
  ['R02', 'R02 – Mycie maszyn', 'Raport mycia/czyszczenia maszyn i urządzeń', 'month'],
  ['R03', 'R03 – Czyszczenie transportu', 'Raport czyszczenia środków transportu', 'month'],
  ['R04', 'R04 – Stacje deratyzacyjne', 'Raport wewnętrznej kontroli stacji deratyzacyjnych', 'month'],
  ['R05', 'R05 – Niezgodność / wycofanie', 'Raport niezgodności i wycofania wyrobu', 'register'],
  ['R06', 'R06 – Przegląd CCP', 'Raport miesięcznego przeglądu CCP', 'month'],
  ['R07', 'R07 – Rejestr reklamacji', 'Rejestr reklamacji', 'register'],
  ['R08', 'R08 – Wzorcowanie urządzeń', 'Raport wzorcowania urządzeń kontrolno-pomiarowych', 'register'],
  ['R09', 'R09 – Trend szkodników', 'Trend aktywności szkodników', 'month'],
  ['R11', 'R11 – Kontrola magnesów', 'Raport kontroli magnesów', 'month'],
  ['R13', 'R13 – Elementy szklane', 'Raport kontroli elementów szklanych – kartoteka miesięczna (dni robocze)', 'month']
]

function cleaningFields(objectLabel) {
  return [
    { key: 'document_date', label: 'Data kontroli', type: 'date', required: true },
    { key: 'object_name', label: objectLabel, type: 'text', data: true, required: true },
    { key: 'cleaning_agent', label: 'Środek / metoda (M/C/D)', type: 'text', data: true },
    { key: 'result', label: 'Wynik kontroli', type: 'pn', data: true },
    { key: 'notes', label: 'Uwagi', type: 'text', data: true },
    { key: 'signed_by', label: 'Podpis', type: 'employee' }
  ]
}

function cleaningColumns(objectLabel) {
  return [
    col('lp', 'Lp.', (_, i) => i + 1),
    col('object', objectLabel, d => dval(d, 'object_name') || d.product_name || ''),
    col('date', 'Data', d => d.document_date || ''),
    col('agent', 'M/C/D', d => dval(d, 'cleaning_agent')),
    col('result', 'Wynik', d => normalizePn(dval(d, 'result', 'P'))),
    col('sign', 'Podpis', d => d.signed_by_operator || '')
  ]
}

export const RAPORTY_FORMS = {
  R00: {
    code: 'R00',
    layout: 'table',
    periodMode: 'register',
    title: 'Raport R00 – Raport dopuszczenia pracowników do pracy',
    columns: [
      col('lp', 'Lp.', (_, i) => i + 1),
      col('employee', 'Pracownik', d => dval(d, 'employee_name') || d.product_name || ''),
      col('date', 'Data dopuszczenia', d => d.document_date || ''),
      col('shift', 'Zmiana / stanowisko', d => dval(d, 'shift_or_position')),
      col('health', 'Stan zdrowia / higiena', d => normalizePn(dval(d, 'health_ok', 'P'))),
      col('sign', 'Podpis', d => d.signed_by_operator || '')
    ],
    fields: [
      { key: 'document_date', label: 'Data dopuszczenia', type: 'date', required: true },
      { key: 'employee_name', label: 'Nazwisko i imię', type: 'text', data: true, required: true },
      { key: 'shift_or_position', label: 'Zmiana / stanowisko', type: 'text', data: true },
      { key: 'health_ok', label: 'Dopuszczenie (P/N)', type: 'pn', data: true },
      { key: 'notes', label: 'Uwagi', type: 'text', data: true },
      { key: 'signed_by', label: 'Podpis', type: 'employee' }
    ]
  },
  R01: {
    code: 'R01',
    layout: 'table',
    periodMode: 'month',
    title: 'Raport R01 – Raport mycia i czyszczenia pomieszczeń',
    columns: cleaningColumns('Pomieszczenie'),
    fields: cleaningFields('Pomieszczenie')
  },
  R02: {
    code: 'R02',
    layout: 'table',
    periodMode: 'month',
    title: 'Raport R02 – Raport mycia/czyszczenia maszyn i urządzeń',
    columns: cleaningColumns('Maszyna / urządzenie'),
    fields: cleaningFields('Maszyna / urządzenie')
  },
  R03: {
    code: 'R03',
    layout: 'table',
    periodMode: 'month',
    title: 'Raport R03 – Raport czyszczenia środków transportu',
    columns: [
      col('lp', 'Lp.', (_, i) => i + 1),
      col('vehicle', 'Środek transportu', d => dval(d, 'vehicle') || d.product_name || ''),
      col('date', 'Data', d => d.document_date || ''),
      col('agent', 'M/C/D', d => dval(d, 'cleaning_agent')),
      col('result', 'Wynik', d => normalizePn(dval(d, 'result', 'P'))),
      col('sign', 'Podpis', d => d.signed_by_operator || '')
    ],
    fields: [
      { key: 'document_date', label: 'Data czyszczenia', type: 'date', required: true },
      { key: 'vehicle', label: 'Środek transportu (nr rej. / opis)', type: 'text', data: true, required: true },
      { key: 'cleaning_agent', label: 'Środek / metoda (M/C/D)', type: 'text', data: true },
      { key: 'result', label: 'Wynik kontroli', type: 'pn', data: true },
      { key: 'notes', label: 'Uwagi', type: 'text', data: true },
      { key: 'signed_by', label: 'Podpis', type: 'employee' }
    ]
  },
  R04: {
    code: 'R04',
    layout: 'table',
    periodMode: 'month',
    title: 'Raport R04 – Raport wewnętrznej kontroli stacji deratyzacyjnych',
    columns: [
      col('lp', 'Lp.', (_, i) => i + 1),
      col('station', 'Nr stacji', d => dval(d, 'station_no') || ''),
      col('location', 'Lokalizacja', d => dval(d, 'location')),
      col('date', 'Data kontroli', d => d.document_date || ''),
      col('bait', 'Stan przynęty', d => dval(d, 'bait_status')),
      col('result', 'Wynik', d => normalizePn(dval(d, 'result', 'P'))),
      col('sign', 'Podpis', d => d.signed_by_operator || '')
    ],
    fields: [
      { key: 'document_date', label: 'Data kontroli', type: 'date', required: true },
      { key: 'station_no', label: 'Nr stacji deratyzacyjnej', type: 'text', data: true, required: true },
      { key: 'location', label: 'Lokalizacja', type: 'text', data: true },
      { key: 'bait_status', label: 'Stan przynęty / zużycie', type: 'text', data: true },
      { key: 'result', label: 'Wynik kontroli', type: 'pn', data: true },
      { key: 'notes', label: 'Uwagi', type: 'text', data: true },
      { key: 'signed_by', label: 'Podpis', type: 'employee' }
    ]
  },
  R05: {
    code: 'R05',
    layout: 'table',
    periodMode: 'register',
    title: 'Raport R05 – Raport niezgodności i wycofania wyrobu',
    columns: [
      col('lp', 'Lp.', (_, i) => i + 1),
      col('product', 'Produkt / partia', d => `${d.product_name || ''}${d.lot_no ? ` (${d.lot_no})` : ''}`),
      col('date', 'Data', d => d.document_date || ''),
      col('reason', 'Przyczyna niezgodności', d => dval(d, 'reason')),
      col('action', 'Działanie / wycofanie', d => dval(d, 'corrective_action')),
      col('sign', 'Podpis', d => d.signed_by_operator || '')
    ],
    fields: [
      { key: 'document_date', label: 'Data zgłoszenia', type: 'date', required: true },
      { key: 'product_name', label: 'Nazwa produktu', type: 'text', data: false, required: true },
      { key: 'lot_no', label: 'Nr partii', type: 'text', data: false },
      { key: 'reason', label: 'Opis niezgodności', type: 'textarea', data: true, required: true },
      { key: 'corrective_action', label: 'Działanie korygujące / wycofanie', type: 'textarea', data: true },
      { key: 'quantity', label: 'Ilość [kg / szt.]', type: 'text', data: true },
      { key: 'signed_by', label: 'Podpis', type: 'employee' }
    ]
  },
  R06: {
    code: 'R06',
    layout: 'table',
    periodMode: 'month',
    title: 'Raport R06 – Raport miesięcznego przeglądu CCP',
    columns: [
      col('lp', 'Lp.', (_, i) => i + 1),
      col('ccp', 'Punkt CCP / obszar', d => dval(d, 'ccp_point') || d.product_name || ''),
      col('date', 'Data przeglądu', d => d.document_date || ''),
      col('monitoring', 'Monitoring – zgodność', d => normalizePn(dval(d, 'monitoring_ok', 'P'))),
      col('records', 'Zapisy – kompletność', d => normalizePn(dval(d, 'records_ok', 'P'))),
      col('sign', 'Podpis', d => d.signed_by_operator || '')
    ],
    fields: [
      { key: 'document_date', label: 'Data przeglądu', type: 'date', required: true },
      { key: 'ccp_point', label: 'Punkt CCP / obszar kontroli', type: 'text', data: true, required: true },
      { key: 'monitoring_ok', label: 'Monitoring zgodny (P/N)', type: 'pn', data: true },
      { key: 'records_ok', label: 'Zapisy kompletne (P/N)', type: 'pn', data: true },
      { key: 'deviations', label: 'Odchylenia / uwagi', type: 'textarea', data: true },
      { key: 'corrective', label: 'Działania korygujące', type: 'textarea', data: true },
      { key: 'signed_by', label: 'Podpis', type: 'employee' }
    ]
  },
  R07: {
    code: 'R07',
    layout: 'table',
    periodMode: 'register',
    title: 'Raport R07 – Rejestr reklamacji',
    columns: [
      col('lp', 'Lp.', (_, i) => i + 1),
      col('date', 'Data zgłoszenia', d => d.document_date || ''),
      col('customer', 'Zgłaszający', d => dval(d, 'reporter') || d.supplier_name || ''),
      col('product', 'Produkt', d => d.product_name || ''),
      col('subject', 'Przedmiot reklamacji', d => dval(d, 'subject')),
      col('status', 'Status', d => dval(d, 'status_text')),
      col('sign', 'Podpis', d => d.signed_by_operator || '')
    ],
    fields: [
      { key: 'document_date', label: 'Data zgłoszenia', type: 'date', required: true },
      { key: 'reporter', label: 'Zgłaszający (klient / dostawca)', type: 'text', data: true, required: true },
      { key: 'product_name', label: 'Produkt / partia', type: 'text', data: false },
      { key: 'subject', label: 'Przedmiot reklamacji', type: 'textarea', data: true, required: true },
      { key: 'status_text', label: 'Status / rozstrzygnięcie', type: 'text', data: true },
      { key: 'response_date', label: 'Data odpowiedzi', type: 'date', data: true },
      { key: 'signed_by', label: 'Podpis', type: 'employee' }
    ]
  },
  R08: {
    code: 'R08',
    layout: 'table',
    periodMode: 'register',
    title: 'Raport R08 – Raport wzorcowania urządzeń kontrolno-pomiarowych',
    columns: [
      col('lp', 'Lp.', (_, i) => i + 1),
      col('device', 'Urządzenie', d => dval(d, 'device_name') || d.product_name || ''),
      col('date', 'Data wzorcowania', d => d.document_date || ''),
      col('cert', 'Nr świadectwa', d => dval(d, 'cert_no')),
      col('valid', 'Ważne do', d => dval(d, 'valid_until')),
      col('result', 'Wynik', d => normalizePn(dval(d, 'result', 'P'))),
      col('sign', 'Podpis', d => d.signed_by_operator || '')
    ],
    fields: [
      { key: 'document_date', label: 'Data wzorcowania', type: 'date', required: true },
      { key: 'device_name', label: 'Nazwa urządzenia', type: 'text', data: true, required: true },
      { key: 'serial_no', label: 'Nr seryjny / identyfikator', type: 'text', data: true },
      { key: 'cert_no', label: 'Nr świadectwa wzorcowania', type: 'text', data: true },
      { key: 'valid_until', label: 'Ważne do', type: 'date', data: true },
      { key: 'result', label: 'Wynik (P/N)', type: 'pn', data: true },
      { key: 'lab_name', label: 'Laboratorium / wykonawca', type: 'text', data: true },
      { key: 'signed_by', label: 'Podpis', type: 'employee' }
    ]
  },
  R09: {
    code: 'R09',
    layout: 'table',
    periodMode: 'month',
    title: 'Raport R09 – Trend aktywności szkodników',
    columns: [
      col('lp', 'Lp.', (_, i) => i + 1),
      col('area', 'Obszar / stacja', d => dval(d, 'area') || d.product_name || ''),
      col('date', 'Data obserwacji', d => d.document_date || ''),
      col('pest', 'Rodzaj aktywności', d => dval(d, 'pest_activity')),
      col('trend', 'Trend', d => dval(d, 'trend')),
      col('sign', 'Podpis', d => d.signed_by_operator || '')
    ],
    fields: [
      { key: 'document_date', label: 'Data obserwacji', type: 'date', required: true },
      { key: 'area', label: 'Obszar / stacja monitoringu', type: 'text', data: true, required: true },
      { key: 'pest_activity', label: 'Rodzaj / poziom aktywności', type: 'text', data: true },
      { key: 'trend', label: 'Trend (wzrost / spadek / bez zmian)', type: 'text', data: true },
      { key: 'actions', label: 'Działania prewencyjne', type: 'textarea', data: true },
      { key: 'signed_by', label: 'Podpis', type: 'employee' }
    ]
  },
  R11: {
    code: 'R11',
    layout: 'table',
    periodMode: 'month',
    title: 'Raport R11 – Raport kontroli magnesów',
    columns: [
      col('lp', 'Lp.', (_, i) => i + 1),
      col('location', 'Lokalizacja magnesu', d => dval(d, 'location') || d.product_name || ''),
      col('date', 'Data kontroli', d => d.document_date || ''),
      col('strength', 'Siła / stan', d => dval(d, 'magnet_strength')),
      col('metal', 'Wychwycone metal', d => dval(d, 'metal_found') || '—'),
      col('result', 'Wynik', d => normalizePn(dval(d, 'result', 'P'))),
      col('sign', 'Podpis', d => d.signed_by_operator || '')
    ],
    fields: [
      { key: 'document_date', label: 'Data kontroli', type: 'date', required: true },
      { key: 'location', label: 'Lokalizacja magnesu / separatora', type: 'text', data: true, required: true },
      { key: 'magnet_strength', label: 'Siła pola / stan techniczny', type: 'text', data: true },
      { key: 'metal_found', label: 'Wychwycone ciała obce', type: 'text', data: true },
      { key: 'result', label: 'Wynik kontroli (P/N)', type: 'pn', data: true },
      { key: 'notes', label: 'Uwagi', type: 'text', data: true },
      { key: 'signed_by', label: 'Podpis', type: 'employee' }
    ]
  },
  R13: {
    code: 'R13',
    layout: 'r13',
    periodMode: 'month',
    title: 'Raport R13 – Raport kontroli elementów szklanych',
    columns: [],
    fields: []
  }
}

export { buildPeriodGroups, periodLabel, buildManualMonthlyHtml, buildManualExcelRows }
