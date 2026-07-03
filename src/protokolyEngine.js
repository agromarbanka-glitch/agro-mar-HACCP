/**
 * Protokoły PR01–PR08 – układ 1:1 wg wzorów Word.
 */
import { normalizePn } from './haccpFormsEngine'
import { col, dval, buildPeriodGroups, periodLabel, buildManualMonthlyHtml, buildManualExcelRows, buildDocumentHtml } from './haccpDocShared'

export const PROTOKOLY_ENGINE_VERSION = '1.0'

export const PROTOKOLY_CARDS = [
  ['PR01', 'PR01 – Weryfikacja HACCP', 'Protokół weryfikacji systemu HACCP wg IFS Food v8', 'month'],
  ['PR02', 'PR02 – Reklamacja', 'Protokół reklamacji', 'register'],
  ['PR03', 'PR03 – Audyt higieny', 'Protokół z auditu higieny', 'month'],
  ['PR04', 'PR04 – Przegląd zarządzania', 'Protokół z przeglądu zarządzania', 'month'],
  ['PR05', 'PR05 – Sytuacje kryzysowe', 'Protokół reagowania na sytuacje kryzysowe', 'register'],
  ['PR06', 'PR06 – Audyt wewnętrzny', 'Protokół auditu wewnętrznego', 'register'],
  ['PR07', 'PR07 – Ocena dostawcy (F03)', 'Ocena dostawcy według kryteriów F03', 'register'],
  ['PR08', 'PR08 – Program auditu', 'Program auditu wewnętrznego', 'register']
]

const PR01_SECTIONS = [
  ['Opis produktu', [
    'Czy powołano zespół ds. HACCP?',
    'Czy wybrano przewodniczącego zespołu?',
    'Czy istnieje opis produktów?',
    'Czy istnieją schematy technologii produkcji?',
    'Czy w schematach zostały ujęte wszystkie etapy produkcji?',
    'Czy schematy zostały poddane weryfikacji?'
  ]],
  ['Analiza zagrożeń', [
    'Czy przeprowadzono analizę zagrożeń wszystkich etapów?',
    'Czy w analizie uwzględniono możliwie wszystkie istotne zagrożenia?',
    'Czy określono środki zapobiegawcze dla wszystkich wymienionych zagrożeń?'
  ]],
  ['Identyfikacja punktów CCP', [
    'W jaki sposób przeprowadzono identyfikacje CCP?',
    'Czy zidentyfikowano wszystkie CCP?',
    'Czy zapisano sposób dochodzenia do CCP?'
  ]],
  ['Wartości krytyczne', [
    'Czy zostały określone poziomy docelowe do środków kontrolnych związanych z CCP?',
    'Czy zostały określone granice krytyczne dla środków kontrolnych związanych z CCP?'
  ]],
  ['Monitoring', [
    'Czy ustalono dla wszystkich CCP sposób monitorowania?',
    'Czy we wszystkich CCP są stosowne arkusze monitorowania CCP?',
    'Czy arkusze monitorowania są wypełniane prawidłowo?',
    'Czy jednoznacznie określono odpowiedzialność za monitorowanie poszczególnych CCP?',
    'Czy istnieją procedury/instrukcje monitorowania CCP?'
  ]],
  ['Działania korygujące', [
    'Czy dla wszystkich CCP ustalono działania korygujące?',
    'Czy są napisane procedury/instrukcje wykonywania działań korygujących?',
    'Czy istnieją jakiekolwiek zapisy z przeprowadzonych działań korygujących?',
    'Czy określono postępowanie z produktem po przekroczeniu limitów krytycznych?'
  ]],
  ['Weryfikacja i dokumentacja', [
    'Czy istnieje opis struktury dokumentacji HACCP?',
    'Jeżeli tak to czy są w niej ujęte wszystkie elementy systemu?',
    'Czy wszystkie dokumenty są odpowiednio oznakowane?',
    'Czy wszystkie dokumenty w audytowanym dziale są aktualne?',
    'Czy istnieje plan weryfikacji?',
    'Czy istnieje procedura weryfikacji systemu?'
  ]]
]

function pr01Fields() {
  const fields = [
    { key: 'document_date', label: 'Data protokołu', type: 'date', required: true },
    { key: 'protocol_no', label: 'Nr protokołu', type: 'text', data: true, required: true }
  ]
  PR01_SECTIONS.forEach(([section, questions], si) => {
    questions.forEach((q, qi) => {
      const key = `q_${si + 1}_${qi + 1}`
      fields.push({ key, label: `${section} – ${q}`, type: 'tri', data: true, section, question: q })
    })
  })
  fields.push(
    { key: 'plant_assessment_notes', label: 'II. Ocena zakładu – uwagi ogólne', type: 'textarea', data: true },
    { key: 'signed_by', label: 'Podpis', type: 'employee' }
  )
  return fields
}

const PR03_TOPICS = [
  ['I. Ocena higieny dostawy', ['Ocena ogólna higieny dostawy / infrastruktura', 'Ocena czystości powierzchni załadunku', 'Ocena czystości wózka widłowego', 'Ułożenie surowca, odstępy inspekcyjne']],
  ['II. Ocena higieny produkcji', ['Higiena produkcji', 'Kontrola odpadów poprodukcyjnych', 'Nadzór nad zanieczyszczeniami fizycznymi']],
  ['III. Ocena higieny magazynowania', ['Teren zakładu wolny od śmieci', 'Magazyn – ogólny porządek', 'Ułożenie surowca', 'Kontrola DDD / stacje deratyzacyjne']],
  ['IV. Ocena higieny pracowników', ['Higiena pracowników (ubrania robocze)', 'Nakrycia głowy']],
  ['V. Dokumentacja higieny', [
    'Procedura utrzymania higieny w zakładzie',
    'Instrukcja mycia i dezynfekcji rąk',
    'Instrukcje mycia maszyn i urządzeń',
    'Instrukcje higieny osobistej pracowników',
    'Instrukcje kontroli stanowiska pracy',
    'Instrukcje przyjęcia osób z poza zakładu',
    'Instrukcja prania odzieży pracowniczej',
    'Kontrola czystości maszyn i bezpieczeństwa',
    'Rejestrowanie procesów czyszczenia'
  ]]
]

function pr03Fields() {
  const fields = [
    { key: 'document_date', label: 'Data auditu', type: 'date', required: true },
    { key: 'report_no', label: 'Nr raportu', type: 'text', data: true, required: true },
    { key: 'audit_date', label: 'Data przeprowadzenia auditu', type: 'date', data: true },
    { key: 'participants', label: 'Uczestnicy auditu', type: 'textarea', data: true }
  ]
  PR03_TOPICS.forEach(([section, items], si) => {
    items.forEach((item, ii) => {
      fields.push(
        { key: `score_${si + 1}_${ii + 1}`, label: `${section} – ${item} [pkt 0–5]`, type: 'number', data: true },
        { key: `notes_${si + 1}_${ii + 1}`, label: `${item} – uwagi`, type: 'text', data: true }
      )
    })
  })
  fields.push(
    { key: 'summary', label: 'Podsumowanie auditu', type: 'textarea', data: true },
    { key: 'signed_by', label: 'Podpis (zatwierdził)', type: 'employee' }
  )
  return fields
}

export const PROTOKOLY_FORMS = {
  PR01: {
    code: 'PR01',
    layout: 'document',
    periodMode: 'month',
    title: 'Protokół PR01 – Protokół weryfikacji systemu zarządzania bezpieczeństwem żywności wg IFS Food v8',
    documentFields: pr01Fields(),
    fields: pr01Fields(),
    columns: [
      col('lp', 'Lp.', (_, i) => i + 1),
      col('date', 'Data', d => d.document_date || ''),
      col('no', 'Nr protokołu', d => dval(d, 'protocol_no') || d.document_no || ''),
      col('podpis', 'Podpis', d => d.signed_by_operator || '')
    ]
  },
  PR02: {
    code: 'PR02',
    layout: 'document',
    periodMode: 'register',
    title: 'Protokół PR02 – Protokół reklamacji',
    documentFields: [
      { key: 'document_date', label: 'Data zgłoszenia reklamacji', type: 'date', required: true },
      { key: 'protocol_no', label: 'Nr protokołu', type: 'text', data: true, required: true },
      { key: 'approval_date', label: 'Data zatwierdzenia', type: 'date', data: true },
      { key: 'place', label: 'Miejsce sporządzenia protokołu', type: 'text', data: true },
      { key: 'report_channel', label: 'Forma zgłoszenia', type: 'checkboxes', data: true, options: ['Telefon', 'Fax', 'List', 'E-mail', 'Osobiście'] },
      { key: 'product_name', label: 'Nazwa towaru, którego dotyczy reklamacja', type: 'text', data: false, required: true },
      { key: 'qty', label: 'Ilość / masa', type: 'text', data: true },
      { key: 'claimant_company', label: 'Dane firmy, do której zgłaszana jest reklamacja', type: 'textarea', data: true },
      { key: 'subject', label: 'Przedmiot / przyczyna reklamacji i opis zastrzeżeń', type: 'textarea', data: true, required: true },
      { key: 'corrective_actions', label: 'Wymagane działania korygujące', type: 'textarea', data: true },
      { key: 'signed_by', label: 'Podpis', type: 'employee' }
    ],
    fields: [
      { key: 'document_date', label: 'Data zgłoszenia reklamacji', type: 'date', required: true },
      { key: 'protocol_no', label: 'Nr protokołu', type: 'text', data: true, required: true },
      { key: 'approval_date', label: 'Data zatwierdzenia', type: 'date', data: true },
      { key: 'place', label: 'Miejsce sporządzenia protokołu', type: 'text', data: true },
      { key: 'report_channel', label: 'Forma zgłoszenia (Telefon, Fax, List, E-mail, Osobiście – oddziel przecinkami)', type: 'text', data: true },
      { key: 'product_name', label: 'Nazwa towaru', type: 'text', required: true },
      { key: 'qty', label: 'Ilość / masa', type: 'text', data: true },
      { key: 'claimant_company', label: 'Dane firmy zgłaszającej reklamację', type: 'textarea', data: true },
      { key: 'subject', label: 'Przedmiot / przyczyna reklamacji', type: 'textarea', data: true, required: true },
      { key: 'corrective_actions', label: 'Wymagane działania korygujące', type: 'textarea', data: true },
      { key: 'signed_by', label: 'Podpis', type: 'employee' }
    ],
    columns: [
      col('lp', 'Lp.', (_, i) => i + 1),
      col('date', 'Data zgłoszenia', d => d.document_date || ''),
      col('no', 'Nr', d => dval(d, 'protocol_no') || d.document_no || ''),
      col('product', 'Towar', d => d.product_name || ''),
      col('podpis', 'Podpis', d => d.signed_by_operator || '')
    ]
  },
  PR03: {
    code: 'PR03',
    layout: 'document',
    periodMode: 'month',
    title: 'Protokół PR03 – Protokół z auditu higieny',
    documentFields: pr03Fields(),
    fields: pr03Fields(),
    columns: [
      col('lp', 'Lp.', (_, i) => i + 1),
      col('date', 'Data auditu', d => dval(d, 'audit_date') || d.document_date || ''),
      col('no', 'Nr raportu', d => dval(d, 'report_no') || ''),
      col('podpis', 'Podpis', d => d.signed_by_operator || '')
    ]
  },
  PR04: {
    code: 'PR04',
    layout: 'document',
    periodMode: 'month',
    title: 'Protokół PR04 – Protokół z przeglądu zarządzania',
    documentFields: [
      { key: 'document_date', label: 'Data przeglądu', type: 'date', required: true },
      { key: 'document_no', label: 'Numer bieżący dokumentu', type: 'text', data: false, required: true },
      { key: 'sec_01', label: '1. Przegląd celów i polityki', type: 'textarea', data: true },
      { key: 'sec_02', label: '2. Wyniki auditów wewnętrznych', type: 'textarea', data: true },
      { key: 'sec_03', label: '3. Opinie klientów – reklamacje, skargi organów', type: 'textarea', data: true },
      { key: 'sec_04', label: '4. Ocena usługi DDD', type: 'textarea', data: true },
      { key: 'sec_05', label: '5. Badania laboratoryjne', type: 'textarea', data: true },
      { key: 'sec_06', label: '6. Usługa transportowa (certyfikaty)', type: 'textarea', data: true },
      { key: 'sec_07', label: '7. Wyniki działań korekcyjnych i korygujących', type: 'textarea', data: true },
      { key: 'sec_08', label: '8. Weryfikacja systemu HACCP', type: 'textarea', data: true },
      { key: 'sec_09', label: '9. Zgodność procesu', type: 'textarea', data: true },
      { key: 'sec_10', label: '10. Działania z poprzednich przeglądów', type: 'textarea', data: true },
      { key: 'sec_11', label: '11. Szkolenia wewnątrzzakładowe', type: 'textarea', data: true },
      { key: 'sec_12', label: '12. Podsumowanie – działania doskonalące', type: 'textarea', data: true },
      { key: 'signed_by', label: 'Podpis', type: 'employee' }
    ],
    fields: [
      { key: 'document_date', label: 'Data przeglądu', type: 'date', required: true },
      { key: 'document_no', label: 'Numer bieżący dokumentu', type: 'text', required: true },
      { key: 'sec_01', label: '1. Przegląd celów i polityki', type: 'textarea', data: true },
      { key: 'sec_02', label: '2. Wyniki auditów wewnętrznych', type: 'textarea', data: true },
      { key: 'sec_03', label: '3. Opinie klientów – reklamacje, skargi organów', type: 'textarea', data: true },
      { key: 'sec_04', label: '4. Ocena usługi DDD', type: 'textarea', data: true },
      { key: 'sec_05', label: '5. Badania laboratoryjne', type: 'textarea', data: true },
      { key: 'sec_06', label: '6. Usługa transportowa (certyfikaty)', type: 'textarea', data: true },
      { key: 'sec_07', label: '7. Wyniki działań korekcyjnych i korygujących', type: 'textarea', data: true },
      { key: 'sec_08', label: '8. Weryfikacja systemu HACCP', type: 'textarea', data: true },
      { key: 'sec_09', label: '9. Zgodność procesu', type: 'textarea', data: true },
      { key: 'sec_10', label: '10. Działania z poprzednich przeglądów', type: 'textarea', data: true },
      { key: 'sec_11', label: '11. Szkolenia wewnątrzzakładowe', type: 'textarea', data: true },
      { key: 'sec_12', label: '12. Podsumowanie – działania doskonalące', type: 'textarea', data: true },
      { key: 'signed_by', label: 'Podpis', type: 'employee' }
    ],
    columns: [
      col('lp', 'Lp.', (_, i) => i + 1),
      col('date', 'Data', d => d.document_date || ''),
      col('no', 'Nr dokumentu', d => d.document_no || ''),
      col('podpis', 'Podpis', d => d.signed_by_operator || '')
    ]
  },
  PR05: {
    code: 'PR05',
    layout: 'document',
    periodMode: 'register',
    title: 'Protokół PR05 – Protokół reagowania na sytuacje kryzysowe',
    documentFields: [
      { key: 'document_date', label: 'Data protokołu', type: 'date', required: true },
      { key: 'document_no', label: 'Numer bieżący dokumentu', type: 'text', data: true, required: true },
      { key: 'crisis_situation', label: 'Zaistniałe sytuacje kryzysowe', type: 'textarea', data: true, required: true },
      { key: 'actions_taken', label: 'Działania podjęte w wyniku sytuacji kryzysowych', type: 'textarea', data: true, required: true },
      { key: 'signed_by', label: 'Data i podpis', type: 'employee' }
    ],
    fields: [
      { key: 'document_date', label: 'Data protokołu', type: 'date', required: true },
      { key: 'document_no', label: 'Numer bieżący dokumentu', type: 'text', data: true, required: true },
      { key: 'crisis_situation', label: 'Zaistniałe sytuacje kryzysowe', type: 'textarea', data: true, required: true },
      { key: 'actions_taken', label: 'Działania podjęte w wyniku sytuacji kryzysowych', type: 'textarea', data: true, required: true },
      { key: 'signed_by', label: 'Podpis', type: 'employee' }
    ],
    columns: [
      col('lp', 'Lp.', (_, i) => i + 1),
      col('date', 'Data', d => d.document_date || ''),
      col('no', 'Nr', d => dval(d, 'document_no') || d.document_no || ''),
      col('podpis', 'Podpis', d => d.signed_by_operator || '')
    ]
  },
  PR06: {
    code: 'PR06',
    layout: 'document',
    periodMode: 'register',
    title: 'Protokół PR06 – Audyt wewnętrzny',
    documentFields: [
      { key: 'document_date', label: 'Data auditu', type: 'date', required: true },
      { key: 'audit_no', label: 'Nr auditu', type: 'text', data: true, required: true },
      { key: 'audit_scope', label: 'Zakres auditu', type: 'textarea', data: true },
      { key: 'audit_team', label: 'Zespół audytujący', type: 'textarea', data: true },
      { key: 'haccp_verification', label: '1. Weryfikacja wdrożenia HACCP', type: 'textarea', data: true },
      { key: 'plant_assessment', label: '2. Ocena zakładu', type: 'textarea', data: true },
      { key: 'documentation_review', label: '3. Ocena dokumentacji zakładowej', type: 'textarea', data: true },
      { key: 'summary', label: '4. Podsumowanie auditu', type: 'textarea', data: true },
      { key: 'previous_findings', label: 'Realizacja ustaleń z poprzedniego auditu', type: 'textarea', data: true },
      { key: 'recommendations', label: 'Zalecenia do następnego auditu', type: 'textarea', data: true },
      { key: 'next_audit_date', label: 'Data kolejnego auditu', type: 'date', data: true },
      { key: 'nonconformities', label: 'Załącznik – arkusz niezgodności', type: 'textarea', data: true },
      { key: 'signed_by', label: 'Podpis', type: 'employee' }
    ],
    fields: [
      { key: 'document_date', label: 'Data auditu', type: 'date', required: true },
      { key: 'audit_no', label: 'Nr auditu', type: 'text', data: true, required: true },
      { key: 'audit_scope', label: 'Zakres auditu', type: 'textarea', data: true },
      { key: 'audit_team', label: 'Zespół audytujący', type: 'textarea', data: true },
      { key: 'haccp_verification', label: '1. Weryfikacja wdrożenia HACCP', type: 'textarea', data: true },
      { key: 'plant_assessment', label: '2. Ocena zakładu', type: 'textarea', data: true },
      { key: 'documentation_review', label: '3. Ocena dokumentacji zakładowej', type: 'textarea', data: true },
      { key: 'summary', label: '4. Podsumowanie auditu', type: 'textarea', data: true },
      { key: 'previous_findings', label: 'Realizacja ustaleń z poprzedniego auditu', type: 'textarea', data: true },
      { key: 'recommendations', label: 'Zalecenia do następnego auditu', type: 'textarea', data: true },
      { key: 'next_audit_date', label: 'Data kolejnego auditu', type: 'date', data: true },
      { key: 'nonconformities', label: 'Załącznik – arkusz niezgodności', type: 'textarea', data: true },
      { key: 'signed_by', label: 'Podpis', type: 'employee' }
    ],
    columns: [
      col('lp', 'Lp.', (_, i) => i + 1),
      col('date', 'Data auditu', d => d.document_date || ''),
      col('no', 'Nr auditu', d => dval(d, 'audit_no') || ''),
      col('podpis', 'Podpis', d => d.signed_by_operator || '')
    ]
  },
  PR07: {
    code: 'PR07',
    layout: 'document',
    periodMode: 'register',
    title: 'Protokół PR07 – Ocena dostawcy według F03 – Kryteria oceny dostawców',
    documentFields: [
      { key: 'document_date', label: 'Data oceny', type: 'date', required: true },
      { key: 'raw_material', label: 'Oceniany surowiec', type: 'text', data: true, required: true },
      { key: 'supplier_1', label: 'Dostawca 1 – nazwa', type: 'text', data: true },
      { key: 'supplier_1_score', label: 'Dostawca 1 – suma punktów / % / ryzyko', type: 'textarea', data: true },
      { key: 'supplier_2', label: 'Dostawca 2 – nazwa', type: 'text', data: true },
      { key: 'supplier_2_score', label: 'Dostawca 2 – suma punktów / % / ryzyko', type: 'textarea', data: true },
      { key: 'supplier_3', label: 'Dostawca 3 – nazwa', type: 'text', data: true },
      { key: 'supplier_3_score', label: 'Dostawca 3 – suma punktów / % / ryzyko', type: 'textarea', data: true },
      { key: 'summary', label: 'Podsumowanie – dostawca zakwalifikowany', type: 'textarea', data: true },
      { key: 'signed_by', label: 'Podpis', type: 'employee' }
    ],
    fields: [
      { key: 'document_date', label: 'Data oceny', type: 'date', required: true },
      { key: 'raw_material', label: 'Oceniany surowiec', type: 'text', data: true, required: true },
      { key: 'supplier_1', label: 'Dostawca 1 – nazwa', type: 'text', data: true },
      { key: 'supplier_1_score', label: 'Dostawca 1 – wynik (pkt / % / ryzyko)', type: 'textarea', data: true },
      { key: 'supplier_2', label: 'Dostawca 2 – nazwa', type: 'text', data: true },
      { key: 'supplier_2_score', label: 'Dostawca 2 – wynik (pkt / % / ryzyko)', type: 'textarea', data: true },
      { key: 'supplier_3', label: 'Dostawca 3 – nazwa', type: 'text', data: true },
      { key: 'supplier_3_score', label: 'Dostawca 3 – wynik (pkt / % / ryzyko)', type: 'textarea', data: true },
      { key: 'summary', label: 'Podsumowanie kwalifikacji', type: 'textarea', data: true },
      { key: 'signed_by', label: 'Podpis', type: 'employee' }
    ],
    columns: [
      col('lp', 'Lp.', (_, i) => i + 1),
      col('date', 'Data', d => d.document_date || ''),
      col('raw', 'Surowiec', d => dval(d, 'raw_material') || d.product_name || ''),
      col('podpis', 'Podpis', d => d.signed_by_operator || '')
    ]
  },
  PR08: {
    code: 'PR08',
    layout: 'document',
    periodMode: 'register',
    title: 'Protokół PR08 – Program auditu',
    documentFields: [
      { key: 'document_date', label: 'Data programu / planowana data auditu', type: 'date', required: true },
      { key: 'document_no', label: 'Numer bieżący dokumentu', type: 'text', data: true, required: true },
      { key: 'audit_no', label: 'Dotyczy auditu oznaczonego jako audit nr', type: 'text', data: true, required: true },
      { key: 'scope_haccp', label: '1. Weryfikacja wdrożenia systemu HACCP', type: 'textarea', data: true },
      { key: 'scope_plant', label: '2. Ocena zakładu', type: 'textarea', data: true },
      { key: 'scope_docs', label: '3. Ocena dokumentacji zakładowej', type: 'textarea', data: true },
      { key: 'scope_summary', label: '4. Podsumowanie auditu (plan działań)', type: 'textarea', data: true },
      { key: 'signed_by', label: 'Data i podpis', type: 'employee' }
    ],
    fields: [
      { key: 'document_date', label: 'Planowana data auditu', type: 'date', required: true },
      { key: 'document_no', label: 'Numer bieżący dokumentu', type: 'text', data: true, required: true },
      { key: 'audit_no', label: 'Nr auditu', type: 'text', data: true, required: true },
      { key: 'scope_haccp', label: '1. Weryfikacja HACCP – zakres', type: 'textarea', data: true },
      { key: 'scope_plant', label: '2. Ocena zakładu – zakres', type: 'textarea', data: true },
      { key: 'scope_docs', label: '3. Ocena dokumentacji – zakres', type: 'textarea', data: true },
      { key: 'scope_summary', label: '4. Podsumowanie – plan', type: 'textarea', data: true },
      { key: 'signed_by', label: 'Podpis', type: 'employee' }
    ],
    columns: [
      col('lp', 'Lp.', (_, i) => i + 1),
      col('date', 'Planowana data', d => d.document_date || ''),
      col('no', 'Nr auditu', d => dval(d, 'audit_no') || ''),
      col('podpis', 'Podpis', d => d.signed_by_operator || '')
    ]
  }
}

export function buildProtokolGroups(docs, type, cfg) {
  return buildPeriodGroups(docs, type, cfg)
}

export function protokolPeriodLabel(group, cfg) {
  return periodLabel(group, cfg)
}

export { buildManualMonthlyHtml, buildManualExcelRows, buildDocumentHtml }
