/**
 * Specyfikacje S01–S09 – układ 1:1 wg wzorów Word (AGRO-MAR wersja I/2024).
 */
import { col, dval, buildPeriodGroups, periodLabel, buildManualMonthlyHtml, buildManualExcelRows, buildDocumentHtml } from './haccpDocShared'

export const SPECYFIKACJE_ENGINE_VERSION = '1.0'

export const SPECYFIKACJE_CARDS = [
  ['S01', 'S01 – Jabłka', 'Specyfikacja AGRO-MAR – jabłka', 'single'],
  ['S02', 'S02 – Gruszki', 'Specyfikacja AGRO-MAR – gruszki', 'single'],
  ['S03', 'S03 – Malina pulpa', 'Specyfikacja AGRO-MAR – malina pulpa', 'single'],
  ['S04', 'S04 – Porzeczka czarna pulpa', 'Specyfikacja AGRO-MAR – porzeczka czarna pulpa', 'single'],
  ['S05', 'S05 – Maliny świeże', 'Specyfikacja AGRO-MAR – maliny świeże', 'single'],
  ['S06', 'S06 – Wiśnie', 'Specyfikacja AGRO-MAR – wiśnie', 'single'],
  ['S07', 'S07 – Aronia', 'Specyfikacja AGRO-MAR – aronia', 'single'],
  ['S08', 'S08 – Truskawka', 'Specyfikacja AGRO-MAR – truskawka', 'single'],
  ['S09', 'S09 – Opakowania', 'Specyfikacja na opakowania', 'single']
]

function productSpecFields(productLabel) {
  return [
    { key: 'document_date', label: 'Data zatwierdzenia', type: 'date', required: true },
    { key: 'version', label: 'Wersja specyfikacji', type: 'text', data: true, required: true },
    { key: 'product_name', label: 'Nazwa produktu', type: 'text', data: false, required: true },
    { key: 'description', label: 'Opis produktu / skład', type: 'textarea', data: true },
    { key: 'organoleptic', label: 'Wymagania organoleptyczne (wygląd, zapach, smak, barwa)', type: 'textarea', data: true },
    { key: 'physicochemical', label: 'Parametry fizykochemiczne', type: 'textarea', data: true },
    { key: 'microbiology', label: 'Wymagania mikrobiologiczne', type: 'textarea', data: true },
    { key: 'pesticides', label: 'Pestycydy / metale ciężkie', type: 'textarea', data: true },
    { key: 'allergens', label: 'Alergeny', type: 'textarea', data: true },
    { key: 'packaging', label: 'Opakowanie', type: 'textarea', data: true },
    { key: 'storage', label: 'Warunki przechowywania i transportu', type: 'textarea', data: true },
    { key: 'shelf_life', label: 'Termin ważności / data przydatności', type: 'text', data: true },
    { key: 'labeling', label: 'Oznakowanie / deklaracja', type: 'textarea', data: true },
    { key: 'legal_refs', label: 'Podstawa prawna / normy', type: 'textarea', data: true },
    { key: 'signed_by', label: 'Podpis (zatwierdził)', type: 'employee' }
  ]
}

function makeProductSpec(code, title, defaultProduct) {
  const fields = productSpecFields(defaultProduct)
  return {
    code,
    layout: 'document',
    periodMode: 'single',
    title,
    documentFields: fields,
    fields,
    columns: [
      col('lp', 'Lp.', (_, i) => i + 1),
      col('product', 'Produkt', d => d.product_name || defaultProduct),
      col('version', 'Wersja', d => dval(d, 'version') || d.document_version || ''),
      col('date', 'Data zatwierdzenia', d => d.document_date || ''),
      col('podpis', 'Podpis', d => d.signed_by_operator || '')
    ]
  }
}

export const SPECYFIKACJE_FORMS = {
  S01: makeProductSpec('S01', 'S01 – Specyfikacja AGRO-MAR Jabłka wersja I/2024', 'Jabłka'),
  S02: makeProductSpec('S02', 'S02 – Specyfikacja AGRO-MAR Gruszki wersja I/2024', 'Gruszki'),
  S03: makeProductSpec('S03', 'S03 – Specyfikacja AGRO-MAR Malina – pulpa wersja I/2024', 'Malina – pulpa'),
  S04: makeProductSpec('S04', 'S04 – Specyfikacja AGRO-MAR Porzeczka czarna – pulpa wersja I/2024', 'Porzeczka czarna – pulpa'),
  S05: makeProductSpec('S05', 'S05 – Specyfikacja AGRO-MAR Maliny świeże wersja I/2024', 'Maliny świeże'),
  S06: makeProductSpec('S06', 'S06 – Specyfikacja AGRO-MAR Wiśnie wersja I/2024', 'Wiśnie'),
  S07: makeProductSpec('S07', 'S07 – Specyfikacja AGRO-MAR Aronia wersja I/2024', 'Aronia'),
  S08: makeProductSpec('S08', 'S08 – Specyfikacja AGRO-MAR Truskawka wersja I/2024', 'Truskawka'),
  S09: {
    code: 'S09',
    layout: 'document',
    periodMode: 'single',
    title: 'S09 – Specyfikacja na opakowania',
    documentFields: [
      { key: 'document_date', label: 'Data zatwierdzenia', type: 'date', required: true },
      { key: 'version', label: 'Wersja specyfikacji', type: 'text', data: true, required: true },
      { key: 'packaging_name', label: 'Nazwa / typ opakowania', type: 'text', data: true, required: true },
      { key: 'material', label: 'Materiał opakowania', type: 'text', data: true },
      { key: 'dimensions', label: 'Wymiary / pojemność', type: 'text', data: true },
      { key: 'food_contact', label: 'Kontakt z żywnością – deklaracja', type: 'textarea', data: true },
      { key: 'supplier', label: 'Dostawca opakowania', type: 'text', data: true },
      { key: 'certificate', label: 'Certyfikat / atest', type: 'textarea', data: true },
      { key: 'storage', label: 'Warunki magazynowania opakowań', type: 'textarea', data: true },
      { key: 'usage', label: 'Przeznaczenie / produkty pakowane', type: 'textarea', data: true },
      { key: 'labeling', label: 'Oznakowanie opakowania', type: 'textarea', data: true },
      { key: 'signed_by', label: 'Podpis (zatwierdził)', type: 'employee' }
    ],
    fields: [
      { key: 'document_date', label: 'Data zatwierdzenia', type: 'date', required: true },
      { key: 'version', label: 'Wersja specyfikacji', type: 'text', data: true, required: true },
      { key: 'packaging_name', label: 'Nazwa / typ opakowania', type: 'text', data: true, required: true },
      { key: 'material', label: 'Materiał opakowania', type: 'text', data: true },
      { key: 'dimensions', label: 'Wymiary / pojemność', type: 'text', data: true },
      { key: 'food_contact', label: 'Kontakt z żywnością – deklaracja', type: 'textarea', data: true },
      { key: 'supplier', label: 'Dostawca opakowania', type: 'text', data: true },
      { key: 'certificate', label: 'Certyfikat / atest', type: 'textarea', data: true },
      { key: 'storage', label: 'Warunki magazynowania opakowań', type: 'textarea', data: true },
      { key: 'usage', label: 'Przeznaczenie / produkty pakowane', type: 'textarea', data: true },
      { key: 'labeling', label: 'Oznakowanie opakowania', type: 'textarea', data: true },
      { key: 'signed_by', label: 'Podpis (zatwierdził)', type: 'employee' }
    ],
    columns: [
      col('lp', 'Lp.', (_, i) => i + 1),
      col('name', 'Opakowanie', d => dval(d, 'packaging_name') || d.product_name || ''),
      col('version', 'Wersja', d => dval(d, 'version') || ''),
      col('date', 'Data', d => d.document_date || ''),
      col('podpis', 'Podpis', d => d.signed_by_operator || '')
    ]
  }
}

export function buildSpecGroups(docs, type, cfg) {
  return buildPeriodGroups(docs, type, cfg)
}

export function specPeriodLabel(group, cfg) {
  return periodLabel(group, cfg)
}

export { buildManualMonthlyHtml, buildManualExcelRows, buildDocumentHtml }
