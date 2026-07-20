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
    defaultGodzina: '8:00',
    header: {
      title: 'Raport R00 – Raport dopuszczenia pracowników do pracy',
      version: 'I/2024'
    },
    defaultColumns: Array.from({ length: 8 }, (_, i) => ({
      id: `emp-${i + 1}`,
      label: ''
    })),
    columnLabel: 'Pracownicy',
    addColumnLabel: 'Dodaj pracownika',
    createHint: 'Cały miesiąc – pracownicy jako kolumny u góry (jak we wzorze Word). Opcja „Z K01” dodaje pracowników z kartoteki przyjęć i ustawia P w dniach, gdy przyjmowali surowiec.',
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
      { id: 'veh-1', label: 'Samochód (nr rej.)' }
    ],
    columnLabel: 'Samochód',
    addColumnLabel: 'Dodaj pojazd',
    createHint: 'W jednym miesiącu może być wiele kartotek – każda dla innego samochodu. Podaj nr rejestracyjny i kierowcę, potem utwórz kartotekę.',
    signLabel: 'Kierowca (podpis)'
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
    layout: 'r11-magnets',
    periodMode: 'month',
    storageKey: 'agro-mar-r11-columns-v1',
    header: {
      title: 'Raport R11 - Raport kontroli magnesów',
      version: 'I/2024'
    },
    defaultColumns: [
      { id: 'magnet-mill', label: 'Przed młynkiem do rozdrabniania (za wanną zasypową) (+/-)*' },
      { id: 'magnet-tanks', label: 'Przy zbiornikach na pulpę (po rozdrobnieniu) (+/-)*' }
    ],
    columnLabel: 'Miejsca kontroli magnesów',
    addColumnLabel: 'Dodaj miejsce magnesu',
    createHint: 'Wpisy powstają automatycznie w dni przerobu pulpy (malina, porzeczka czarna – decyzja w K03): w magnesach „–”, uwagi „P”. Osobna kartoteka na każdy miesiąc. Pozostałe dni dodaj ręcznie.',
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
