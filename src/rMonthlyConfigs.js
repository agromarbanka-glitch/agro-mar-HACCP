/**
 * Konfiguracje raportów miesięcznych/kwartalnych R00, R03–R09, R11 (układ 1:1 ze wzorami Word).
 * R01, R02, R13 mają dedykowane silniki – pozostałe obsługuje rMonthlyEngine.
 */

export const R_MONTHLY_CONFIGS = {
  R00: {
    code: 'R00',
    layout: 'daily-employees',
    periodMode: 'month',
    storageKey: 'agro-mar-r00-slots-v1',
    header: {
      title: 'Raport R00 – Raport dopuszczenia pracowników do pracy',
      version: 'I/2024'
    },
    employeeSlots: 12,
    slotLabel: n => `Nr ${n}`,
    createHint: 'Cały miesiąc – dni robocze z 12 miejscami na pracowników (P/N odzieży), niedziele puste (czerwone).',
    signLabel: 'Podpis kontrolującego'
  },
  R03: {
    code: 'R03',
    layout: 'grid-mcd-agent',
    periodMode: 'month',
    storageKey: 'agro-mar-r03-vehicles-v1',
    header: {
      title: 'R03 - Raport czyszczenia środków transportu',
      version: 'I/2024'
    },
    mcdOptions: ['', 'M', 'C', 'M/C'],
    mcdLegend: '* M – mycie, C – czyszczenie, M/C – mycie i czyszczenie',
    defaultColumns: [
      { id: 'veh-1', label: 'Samochód 1 (nr rej.)' },
      { id: 'veh-2', label: 'Samochód 2 (nr rej.)' }
    ],
    columnLabel: 'Samochód',
    addColumnLabel: 'Dodaj pojazd',
    createHint: 'Cały miesiąc – wpis M/C i nazwa środka czyszczącego przy każdym pojeździe.',
    signLabel: 'Podpis'
  },
  R04: {
    code: 'R04',
    layout: 'r04-control',
    periodMode: 'month',
    storageKey: 'agro-mar-r04-stations-v2',
    header: {
      title: 'Raport R04 - Raport wewnętrznej kontroli stacji deratyzacyjnych i pułapek żywołownych',
      version: 'I/2024',
      approvalDate: '02.09.2024'
    },
    deratCount: 20,
    trapCount: 6,
    defaultRodents: 'brak gryzoni',
    defaultState: 'nienaruszona',
    stationTypes: [
      { kind: 'derat', label: 'Stacja deratyzacyjna (kolejna)' },
      { kind: 'trap', label: 'Pułapka żywołowna (kolejna)' }
    ],
    columnLabel: 'Stacje i pułapki',
    addColumnLabel: 'Dodaj stację',
    createHint: 'Kartoteka miesięczna – 20 stacji + 6 pułapek; nowy miesiąc kopiuje listę stacji i wartości z ostatniej kontroli poprzedniego miesiąca.',
    signLabel: 'Kontrolę przeprowadził',
    legend: '* ubytek trutki (wpisz np. 25%) · ** obecność gryzoni · *** stan stacji (nienaruszona / uszkodzona / zniszczona)'
  },
  R05: {
    code: 'R05',
    layout: 'register-rows',
    periodMode: 'month',
    header: {
      title: 'Raport R05 Raport niezgodności i wycofania wyrobu',
      version: 'I/2024'
    },
    rowFields: [
      { key: 'detected_date', label: 'Data wykrycia niezgodności', type: 'date' },
      { key: 'description', label: 'Opis wykrytej niezgodności', type: 'textarea' },
      { key: 'action_date', label: 'Data działań korekcyjnych / wycofania', type: 'date' },
      { key: 'corrective_action', label: 'Przeprowadzone działanie', type: 'textarea' }
    ],
    summaryField: { key: 'summary', label: 'Podsumowanie wykrytych niezgodności/wycofań' },
    createHint: 'Utwórz kartotekę za miesiąc – potem dodawaj wiersze niezgodności.',
    signLabel: 'Podpis członka zespołu ds. HACCP'
  },
  R06: {
    code: 'R06',
    layout: 'single-month',
    periodMode: 'month',
    header: {
      title: 'Raport R06 - Raport miesięcznego przeglądu CCP i CP',
      version: 'I/2024'
    },
    fields: [
      { key: 'document_no', label: 'Numer bieżący dokumentu', type: 'text' },
      { key: 'observations', label: 'Obserwacje z analizy zapisów CCP1 i CP1', type: 'textarea', rows: 12 }
    ],
    createHint: 'Jeden dokument za miesiąc – wpisz obserwacje z przeglądu CCP i CP.',
    signLabel: 'Data i podpis'
  },
  R07: {
    code: 'R07',
    layout: 'register-rows',
    periodMode: 'month',
    header: {
      title: 'Raport R07 - Rejestr reklamacji',
      version: 'I/2024'
    },
    rowFields: [
      { key: 'document_date', label: 'Data zgłoszenia', type: 'date' },
      { key: 'reporter', label: 'Dane firmy zgłaszającej / AGRO-MAR', type: 'text' },
      { key: 'product_qty', label: 'Nazwa produktu/surowca i ilość/masa', type: 'text' },
      { key: 'reason', label: 'Przyczyna reklamacji', type: 'textarea' },
      { key: 'notes', label: 'Uwagi', type: 'text' }
    ],
    createHint: 'Utwórz kartotekę za miesiąc – potem dodawaj wpisy reklamacji.',
    signLabel: 'Podpis osoby uzupełniającej wpisy'
  },
  R08: {
    code: 'R08',
    layout: 'daily-calibration',
    periodMode: 'month',
    storageKey: 'agro-mar-r08-chambers-v1',
    header: {
      title: 'Raport R08 – Raport wzorcowania urządzeń kontrolno-pomiarowych',
      version: 'I/2024'
    },
    chamberTypes: [
      { kind: 'raw', labelTemplate: 'Chłodnia surowców nr {n}' },
      { kind: 'fg', labelTemplate: 'Chłodnia produktów gotowych nr {n}' }
    ],
    defaultChambers: [
      { id: 'raw-1', kind: 'raw', label: 'Chłodnia surowców nr 1' },
      { id: 'raw-2', kind: 'raw', label: 'Chłodnia surowców nr 2' },
      { id: 'fg-1', kind: 'fg', label: 'Chłodnia produktów gotowych nr 1' },
      { id: 'fg-2', kind: 'fg', label: 'Chłodnia produktów gotowych nr 2' }
    ],
    columnLabel: 'Termometry (chłodnie)',
    addColumnLabel: 'Dodaj chłodnię',
    pwOptions: ['', 'P', 'W'],
    pwLegend: '* P – dalsze użytkowanie; W – wymiana/naprawa',
    createHint: 'Cały miesiąc – waga i termometry wg wzoru; domyślnie P we wszystkich działaniach (dni robocze).',
    signLabel: 'Podpis'
  },
  R11: {
    code: 'R11',
    layout: 'register-rows',
    periodMode: 'month',
    header: {
      title: 'Raport R11 – Raport kontroli magnesów',
      version: 'I/2024'
    },
    rowFields: [
      { key: 'document_date', label: 'Data kontroli', type: 'date' },
      { key: 'location', label: 'Lokalizacja magnesu / separatora', type: 'text' },
      { key: 'magnet_strength', label: 'Siła pola / stan techniczny', type: 'text' },
      { key: 'metal_found', label: 'Wychwycone ciała obce', type: 'text' },
      { key: 'result', label: 'Wynik kontroli (P/N)', type: 'pn' }
    ],
    createHint: 'Kartoteka miesięczna – dodawaj wpisy kontroli magnesów.',
    signLabel: 'Podpis'
  }
}

export function getRMonthlyConfig(code) {
  return R_MONTHLY_CONFIGS[code] || null
}

export function isRMonthlyReport(code) {
  return Boolean(getRMonthlyConfig(code))
}

export function rMonthlyStorageKey(code) {
  return getRMonthlyConfig(code)?.storageKey || `agro-mar-${String(code).toLowerCase()}-cfg-v1`
}
