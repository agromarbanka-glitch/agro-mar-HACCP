/**
 * Raporty R00–R13 – układ 1:1 wg wzorów Word (docs/wzory/Raport R*.docx).
 */
import { normalizePn } from './haccpFormsEngine'
import { col, dval, buildPeriodGroups, periodLabel, buildManualMonthlyHtml, buildManualExcelRows } from './haccpDocShared'

export const RAPORTY_ENGINE_VERSION = '1.3'

export const RAPORTY_CARDS = [
  ['R00', 'R00 – Dopuszczenie do pracy', 'Raport dopuszczenia pracowników do pracy', 'register'],
  ['R01', 'R01 – Mycie pomieszczeń', 'Raport mycia i czyszczenia pomieszczeń – kartoteka miesięczna', 'month'],
  ['R02', 'R02 – Mycie maszyn', 'Raport mycia/czyszczenia maszyn i urządzeń – kartoteka miesięczna', 'month'],
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
    layout: 'monthly',
    periodMode: 'month',
    title: 'Raport R00 – Raport dopuszczenia pracowników do pracy',
    columns: [],
    fields: []
  },
  R01: {
    code: 'R01',
    layout: 'r01',
    periodMode: 'month',
    title: 'Raport R01 – Raport mycia i czyszczenia pomieszczeń',
    columns: [],
    fields: []
  },
  R02: {
    code: 'R02',
    layout: 'r02',
    periodMode: 'month',
    title: 'Raport R02 – Raport mycia/czyszczenia maszyn i urządzeń',
    columns: [],
    fields: []
  },
  R03: {
    code: 'R03',
    layout: 'monthly',
    periodMode: 'month',
    title: 'Raport R03 – Raport czyszczenia środków transportu',
    columns: [],
    fields: []
  },
  R04: {
    code: 'R04',
    layout: 'monthly',
    periodMode: 'month',
    title: 'Raport R04 – Raport wewnętrznej kontroli stacji deratyzacyjnych',
    columns: [],
    fields: []
  },
  R05: {
    code: 'R05',
    layout: 'monthly',
    periodMode: 'month',
    title: 'Raport R05 – Raport niezgodności i wycofania wyrobu',
    columns: [],
    fields: []
  },
  R06: {
    code: 'R06',
    layout: 'monthly',
    periodMode: 'month',
    title: 'Raport R06 – Raport miesięcznego przeglądu CCP',
    columns: [],
    fields: []
  },
  R07: {
    code: 'R07',
    layout: 'monthly',
    periodMode: 'month',
    title: 'Raport R07 – Rejestr reklamacji',
    columns: [],
    fields: []
  },
  R08: {
    code: 'R08',
    layout: 'monthly',
    periodMode: 'month',
    title: 'Raport R08 – Raport wzorcowania urządzeń kontrolno-pomiarowych',
    columns: [],
    fields: []
  },
  R09: {
    code: 'R09',
    layout: 'monthly',
    periodMode: 'quarter',
    title: 'Raport R09 – Trend aktywności szkodników',
    columns: [],
    fields: []
  },
  R11: {
    code: 'R11',
    layout: 'monthly',
    periodMode: 'month',
    title: 'Raport R11 – Raport kontroli magnesów',
    columns: [],
    fields: []
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
