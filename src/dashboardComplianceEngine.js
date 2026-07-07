/**
 * Status uzupełnienia formularzy HACCP na zakładce Start (wg rozpiski użytkownika).
 */
import { calendarDaysInMonth, isSundayDate } from './r13Engine'
import { isDirectToSaleProduct, productGroupForName } from './haccpFormsEngine'
import { r01CleaningForDoc, r01ColumnsFromDocs, R01_DEFAULT_COLUMNS } from './r01Engine'
import { w06DedupeKey } from './w06Engine'

export const DASHBOARD_COMPLIANCE_VERSION = '1.0'

export const W05_LAB_CATEGORIES = [
  { id: 'truskawka', label: 'Truskawka', match: /truskaw/i },
  { id: 'malina', label: 'Malina', match: /malin/i },
  { id: 'porzeczka', label: 'Porzeczka', match: /porzeczk/i },
  { id: 'jablko', label: 'Jabłko', match: /jabl|jabł/i },
  { id: 'wisnia', label: 'Wiśnia', match: /wisn|wiśn/i },
  { id: 'woda', label: 'Woda', match: /wod/i },
  { id: 'powierzchni', label: 'Z powierzchni', match: /powierzchn|środowisk|swab/i },
  { id: 'rece', label: 'Z rąk pracownika', match: /r[aą]k|d[lł]oni|higien/i }
]

const HALA_PULPY_COL = 'hala-pulpy'

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
}

function docsOfType(docs, type) {
  return (docs || []).filter(d => d.document_type === type)
}

function inMonth(dateStr, yearMonth) {
  return String(dateStr || '').slice(0, 7) === yearMonth
}

function inYear(dateStr, year) {
  return String(dateStr || '').slice(0, 4) === String(year)
}

function workingDaysInMonth(yearMonth) {
  return calendarDaysInMonth(yearMonth).filter(d => !d.isSunday)
}

function halfYearKey(yearMonth) {
  const m = Number(String(yearMonth).slice(5, 7))
  const y = String(yearMonth).slice(0, 4)
  return m <= 6 ? `${y}-H1` : `${y}-H2`
}

function isDocSigned(doc) {
  return Boolean(String(doc?.signed_by_operator || doc?.data?.podpis_kontrolujacego || doc?.data?.podpis || '').trim())
}

function mcdFilled(value) {
  const v = String(value ?? '').trim().toUpperCase()
  return Boolean(v && v !== '-')
}

function item(code, name, rule, status, summary, gaps = [], extra = {}) {
  return { code, name, rule, status, summary, gaps: gaps.filter(Boolean).slice(0, 6), ...extra }
}

function ratioStatus(done, required) {
  if (!required) return 'na'
  if (done >= required) return 'ok'
  if (done > 0) return 'warn'
  return 'missing'
}

const REPORT_NAMES = {
  R00: 'Dopuszczenie do pracy',
  R02: 'Mycie maszyn',
  R11: 'Kontrola magnesów',
  R13: 'Elementy szklane'
}

function checkDailyCalendarDocs(docs, yearMonth, code, validateDoc) {
  const name = REPORT_NAMES[code] || code
  const expected = workingDaysInMonth(yearMonth)
  const monthDocs = docs.filter(d => inMonth(d.document_date, yearMonth))
  if (!monthDocs.length) {
    return item(code, name, 'Każdy dzień roboczy', 'missing', `0 / ${expected.length} dni`, [`Brak kartoteki za ${yearMonth}`])
  }
  const byDate = new Map(monthDocs.map(d => [String(d.document_date).slice(0, 10), d]))
  const gaps = []
  let done = 0
  for (const day of expected) {
    const doc = byDate.get(day.date)
    if (!doc) {
      gaps.push(`Brak wpisu: ${day.date}`)
      continue
    }
    if (validateDoc && !validateDoc(doc, day.date)) {
      gaps.push(`Niekompletny wpis: ${day.date}`)
      continue
    }
    done += 1
  }
  const unsigned = monthDocs.filter(d => !isDocSigned(d)).length
  if (unsigned) gaps.push(`${unsigned} wpisów bez podpisu`)
  return item(code, name, 'Każdy dzień roboczy', ratioStatus(done, expected.length), `${done} / ${expected.length} dni roboczych`, gaps)
}

function checkK01(ctx) {
  const { haccpDocs, yearMonth } = ctx
  const k01 = docsOfType(haccpDocs, 'K01').filter(d => inMonth(d.document_date, yearMonth))
  const pzOps = (ctx.operations || []).filter(o => {
    const t = normalizeText(o.operation_type)
    return (t === 'przyjecie' || t === 'pz') && inMonth(o.operation_date, yearMonth)
  })
  const required = Math.max(k01.length, pzOps.length, pzOps.length ? pzOps.length : 0)
  const unsigned = k01.filter(d => !isDocSigned(d)).length
  const statusN = k01.filter(d => d.status === 'N').length
  const gaps = []
  if (!k01.length && pzOps.length) gaps.push(`${pzOps.length} przyjęć PZ bez kart K01`)
  if (unsigned) gaps.push(`${unsigned} brak podpisu`)
  if (statusN) gaps.push(`${statusN} wpisów ze statusem N`)
  const done = k01.length && !unsigned ? k01.length : Math.max(0, k01.length - unsigned)
  const status = !pzOps.length && !k01.length ? 'na' : ratioStatus(k01.length >= (pzOps.length || 1) && !unsigned ? k01.length : done, Math.max(k01.length, pzOps.length, 1))
  return item('K01', 'Przyjęcie surowca', 'Wszystkie przyjęcia towarów', status,
    k01.length ? `${k01.length} przyjęć w ${yearMonth}` : (pzOps.length ? `${pzOps.length} PZ – brak K01` : 'Brak przyjęć w okresie'), gaps)
}

function checkK011(ctx) {
  const { year, auxCount = 0 } = ctx
  const ok = auxCount > 0
  return item('K01.1', 'Materiały pomocnicze', 'Raz do roku', ok ? 'ok' : 'missing',
    ok ? `${auxCount} wpisów w ${year}` : `Brak wpisów K01.1 w ${year}`,
    ok ? [] : ['Dodaj kartotekę półroczną / wpisy materiałów pomocniczych'])
}

function checkK02(ctx) {
  const { haccpDocs, syntheticK02Docs, yearMonth } = ctx
  const k01Days = new Set(
    docsOfType(haccpDocs, 'K01')
      .filter(d => inMonth(d.document_date, yearMonth))
      .map(d => String(d.document_date).slice(0, 10))
  )
  if (!k01Days.size) {
    return item('K02', 'Magazynowanie surowca', 'Gdy magazynujesz surowiec w CP2', 'na', 'Brak przyjęć – K02 nie wymagane', [])
  }
  const k02Days = new Set(
    (syntheticK02Docs || [])
      .filter(d => inMonth(d.document_date, yearMonth))
      .map(d => String(d.document_date).slice(0, 10))
  )
  const missing = [...k01Days].filter(d => !k02Days.has(d))
  const gaps = missing.slice(0, 5).map(d => `Brak K02 na ${d}`)
  if (missing.length > 5) gaps.push(`… i ${missing.length - 5} dni`)
  return item('K02', 'Magazynowanie surowca', 'Gdy magazynujesz surowiec w CP2',
    ratioStatus(k02Days.size, k01Days.size), `${k02Days.size} / ${k01Days.size} dni z przyjęciem`, gaps)
}

function checkK03(ctx) {
  const { wzQueueLines, yearMonth } = ctx
  const lines = (wzQueueLines || []).filter(l => inMonth(l.wz_date, yearMonth))
  if (!lines.length) {
    return item('K03', 'Identyfikacja partii', 'Sprzedane = zakupione (FIFO)', 'na', 'Brak WZ w okresie', [])
  }
  const pending = lines.filter(l => l.status === 'pending')
  const unsigned = lines.filter(l => l.k03Form && !l.k03Form.signed_by_operator && l.status !== 'pending')
  const gaps = []
  if (pending.length) gaps.push(`${pending.length} WZ oczekuje (przerób / bez przerobu)`)
  if (unsigned.length) gaps.push(`${unsigned.length} K03 bez podpisu`)
  const done = lines.length - pending.length
  return item('K03', 'Identyfikacja partii', 'Sprzedane = zakupione (FIFO)',
    pending.length ? 'warn' : (unsigned.length ? 'warn' : 'ok'),
    `${done} / ${lines.length} WZ rozliczonych`, gaps)
}

function checkK04(ctx) {
  const { syntheticK04Docs, stockRows, yearMonth } = ctx
  const cp3Lots = (stockRows || []).filter(l => {
    const ch = l.chamber?.control_point || l.chamber?.code || ''
    const name = l.products?.name || l.product_name || ''
    const group = l.product_group || productGroupForName(name)
    return /cp3|ccp1/i.test(String(ch)) && !isDirectToSaleProduct(name, group)
  })
  if (!cp3Lots.length && !(syntheticK04Docs || []).some(d => inMonth(d.document_date, yearMonth))) {
    return item('K04', 'Magazynowanie produktu gotowego', 'Partie w CP3 / CCP1', 'na', 'Brak partii gotowych w magazynie', [])
  }
  const k04 = (syntheticK04Docs || []).filter(d => inMonth(d.document_date, yearMonth))
  const unsigned = k04.filter(d => !isDocSigned(d)).length
  const gaps = unsigned ? [`${unsigned} dni bez podpisu`] : []
  if (!k04.length && cp3Lots.length) gaps.unshift('Brak wpisów K04 – odśwież magazyn partii')
  return item('K04', 'Magazynowanie produktu gotowego', 'Partie w CP3 / CCP1',
    k04.length ? (unsigned ? 'warn' : 'ok') : 'missing',
    k04.length ? `${k04.length} wpisów dziennych` : 'Brak kartoteki K04', gaps)
}

function checkK06(ctx) {
  const { mergedK06Docs, wzQueueLines, yearMonth } = ctx
  const k06 = (mergedK06Docs || []).filter(d => inMonth(d.document_date, yearMonth))
  const bezPrzerobu = (wzQueueLines || []).filter(l =>
    inMonth(l.wz_date, yearMonth) && (l.workflow?.mode === 'bez_przerobu' || l.data?.workflow?.mode === 'bez_przerobu')
  )
  const prodOps = (ctx.operations || []).filter(o =>
    normalizeText(o.operation_type) === 'produkcja' && inMonth(o.operation_date, yearMonth)
  )
  const expected = prodOps.length + bezPrzerobu.length
  const gaps = []
  if (bezPrzerobu.length && k06.length < bezPrzerobu.length) {
    gaps.push(`${bezPrzerobu.length} sprzedaży „bez przerobu” – sprawdź K06`)
  }
  const unsigned = k06.filter(d => !isDocSigned(d)).length
  if (unsigned) gaps.push(`${unsigned} bez podpisu`)
  const status = !expected && !k06.length ? 'na' : ratioStatus(k06.length, Math.max(expected, k06.length || 1))
  return item('K06', 'Ocena produktu gotowego', 'Produkt gotowy + sprzedaż bez przerobu', status,
    k06.length ? `${k06.length} ocen` : (expected ? 'Brak wpisów K06' : 'Brak produkcji / bez przerobu'), gaps)
}

function r01HalaCleanedDays(haccpDocs, yearMonth) {
  const cols = r01ColumnsFromDocs(docsOfType(haccpDocs, 'R01'), R01_DEFAULT_COLUMNS)
  return docsOfType(haccpDocs, 'R01')
    .filter(d => inMonth(d.document_date, yearMonth) && !d.data?.is_day_off && !isSundayDate(d.document_date))
    .filter(d => mcdFilled(r01CleaningForDoc(d, cols)[HALA_PULPY_COL]))
    .map(d => String(d.document_date).slice(0, 10))
}

function checkK07(ctx) {
  const { mergedK07Docs, operations, haccpDocs, yearMonth } = ctx
  const k07 = (mergedK07Docs || []).filter(d => inMonth(d.document_date, yearMonth))
  const prodOps = (operations || []).filter(o =>
    normalizeText(o.operation_type) === 'produkcja' && inMonth(o.operation_date, yearMonth)
  )
  const gaps = []
  const opIds = new Set(k07.map(d => d.data?.operation_id || d.operation_id).filter(Boolean))
  const missingOps = prodOps.filter(o => !opIds.has(o.id))
  if (missingOps.length) gaps.push(`${missingOps.length} przerobów bez K07`)

  const halaDays = r01HalaCleanedDays(haccpDocs, yearMonth)
  for (const day of halaDays.slice(0, 3)) {
    const times = k07.filter(d => String(d.document_date).slice(0, 10) === day).map(d => String(d.data?.godzina || '').slice(0, 5))
    if (!times.includes('09:00')) gaps.push(`Brak K07 09:00 (${day}) – hala pulpy myta w R01`)
    if (!times.includes('14:00')) gaps.push(`Brak K07 14:00 (${day}) – hala pulpy myta w R01`)
  }
  if (halaDays.length > 3 && gaps.length) gaps.push(`… sprawdź ${halaDays.length} dni z myciem hali w R01`)

  const unsigned = k07.filter(d => !isDocSigned(d)).length
  if (unsigned) gaps.push(`${unsigned} bez podpisu`)

  const required = prodOps.length + halaDays.length * 2
  const status = !prodOps.length && !halaDays.length && !k07.length
    ? 'na'
    : (missingOps.length || gaps.some(g => g.includes('09:00') || g.includes('14:00')) ? 'warn' : (k07.length ? 'ok' : 'missing'))
  return item('K07', 'Kontrola sita CCP1', 'Przerób + 2× dziennie gdy hala myta (R01)', status,
    k07.length ? `${k07.length} kontroli` : 'Brak wpisów K07', gaps)
}

function checkMonthlyOnce(docs, type, name, rule, yearMonth) {
  const monthDocs = docs.filter(d => inMonth(d.document_date, yearMonth) || d.data?.month_key === yearMonth)
  if (!monthDocs.length) {
    return item(type, name, rule, 'missing', `Brak kartoteki za ${yearMonth}`, [`Utwórz kartotekę ${type} za ${yearMonth}`])
  }
  const unsigned = monthDocs.filter(d => !isDocSigned(d)).length
  return item(type, name, rule, unsigned ? 'warn' : 'ok',
    `Kartoteka ${yearMonth} (${monthDocs.length} wpisów)`, unsigned ? [`${unsigned} bez podpisu`] : [])
}

function checkR01(ctx) {
  const { haccpDocs, operations, yearMonth } = ctx
  const prodDays = new Set(
    (operations || [])
      .filter(o => normalizeText(o.operation_type) === 'produkcja' && inMonth(o.operation_date, yearMonth))
      .map(o => String(o.operation_date).slice(0, 10))
  )
  if (!prodDays.size) {
    return item('R01', 'Mycie pomieszczeń', 'Gdy jest przerób', 'na', 'Brak przerobu w okresie', [])
  }
  const r01 = docsOfType(haccpDocs, 'R01').filter(d => inMonth(d.document_date, yearMonth))
  if (!r01.length) {
    return item('R01', 'Mycie pomieszczeń', 'Gdy jest przerób', 'missing', 'Brak kartoteki R01', ['Utwórz kartotekę R01 za miesiąc'])
  }
  const cols = r01ColumnsFromDocs(r01, R01_DEFAULT_COLUMNS)
  const covered = [...prodDays].filter(day => {
    const doc = r01.find(d => String(d.document_date).slice(0, 10) === day)
    if (!doc) return false
    const cleaning = r01CleaningForDoc(doc, cols)
    return Object.values(cleaning).some(mcdFilled)
  })
  const gaps = []
  if (covered.length < prodDays.size) gaps.push(`${prodDays.size - covered.length} dni przerobu bez wpisu R01`)
  return item('R01', 'Mycie pomieszczeń', 'Gdy jest przerób',
    ratioStatus(covered.length, prodDays.size), `${covered.length} / ${prodDays.size} dni przerobu`, gaps)
}

function checkR09(ctx) {
  const { haccpDocs, yearMonth } = ctx
  const half = halfYearKey(yearMonth)
  const r09 = docsOfType(haccpDocs, 'R09').filter(d => {
    const mk = d.data?.month_key || String(d.document_date || '').slice(0, 7)
    const y = String(mk).slice(0, 4)
    const m = Number(String(mk).slice(5, 7))
    const h = m <= 6 ? `${y}-H1` : `${y}-H2`
    return h === half
  })
  if (!r09.length) {
    return item('R09', 'Trend szkodników', 'Raz na pół roku', 'missing', `Brak R09 (${half})`, [`Utwórz raport R09 za ${half}`])
  }
  return item('R09', 'Trend szkodników', 'Raz na pół roku', 'ok', `Raport ${half}`, [])
}

function checkYearRegister(docs, type, name, rule, year) {
  const yearDocs = docs.filter(d => inYear(d.document_date, year))
  if (!yearDocs.length) {
    return item(type, name, rule, 'missing', `Brak wpisów w ${year}`, [`Uzupełnij wykaz ${type}`])
  }
  return item(type, name, rule, 'ok', `${yearDocs.length} wpisów w ${year}`, [])
}

function checkW05(ctx) {
  const { haccpDocs, year } = ctx
  const w05 = docsOfType(haccpDocs, 'W05').filter(d => inYear(d.document_date, year))
  const gaps = []
  for (const cat of W05_LAB_CATEGORIES) {
    const hit = w05.some(d => {
      const blob = `${d.product_name || ''} ${d.data?.product_group || ''} ${d.data?.parameter || ''} ${d.data?.notes || ''}`
      return cat.match.test(blob)
    })
    if (!hit) gaps.push(`Brak badania: ${cat.label}`)
  }
  const status = !gaps.length ? 'ok' : (gaps.length >= W05_LAB_CATEGORIES.length ? 'missing' : 'warn')
  return item('W05', 'Badania laboratoryjne', 'Harmonogram badań (8 kategorii)', status,
    w05.length ? `${w05.length} wpisów W05` : 'Brak wpisów W05', gaps)
}

function checkW06(ctx) {
  const { haccpDocs, haccpDocsK01, year } = ctx
  const w06 = docsOfType(haccpDocs, 'W06')
  const suppliers = new Set()
  for (const d of (haccpDocsK01 || docsOfType(haccpDocs, 'K01')).filter(x => inYear(x.document_date, year))) {
    const name = String(d.supplier_name || d.data?.supplier_name || '').trim()
    if (name) suppliers.add(normalizeText(name))
  }
  if (!suppliers.size) {
    return item('W06', 'Dostawcy kwalifikowani', 'Dostawcy z importu Excel w roku', 'na', `Brak dostawców PZ w ${year}`, [])
  }
  const w06Keys = new Set(w06.map(d => w06DedupeKey({
    party_type: d.data?.party_type || 'supplier',
    company_name: d.data?.company_name || d.data?.supplier_name || d.supplier_name,
    nip: d.data?.nip,
    item_name: d.data?.item_name || d.product_name
  })))
  const w06Names = new Set(w06.filter(d => (d.data?.party_type || 'supplier') === 'supplier')
    .map(d => normalizeText(d.data?.company_name || d.data?.supplier_name || d.supplier_name || ''))
    .filter(Boolean))
  let missing = 0
  const gaps = []
  for (const s of suppliers) {
    if (!w06Names.has(s)) {
      missing += 1
      if (gaps.length < 4) gaps.push(`Brak w W06: ${s}`)
    }
  }
  if (missing > 4) gaps.push(`… i ${missing - 4} dostawców`)
  return item('W06', 'Dostawcy kwalifikowani', 'Dostawcy z importu Excel w roku',
    missing ? 'warn' : 'ok', `${suppliers.size - missing} / ${suppliers.size} dostawców w W06`, gaps, { w06Keys: w06Keys.size })
}

/**
 * @param {object} ctx
 * @returns {{ period: string, year: string, items: object[], summary: object }}
 */
export function computeDashboardCompliance(ctx = {}) {
  const yearMonth = ctx.yearMonth || new Date().toISOString().slice(0, 7)
  const year = String(yearMonth).slice(0, 4)
  const haccpDocs = ctx.haccpDocs || []
  const base = { haccpDocs, yearMonth, year, ...ctx }

  const items = [
    checkK01(base),
    checkK011(base),
    checkK02(base),
    checkK03(base),
    checkK04(base),
    checkK06(base),
    checkK07(base),
    checkDailyCalendarDocs(docsOfType(haccpDocs, 'R00'), yearMonth, 'R00', d => {
      if (d.data?.is_day_off) return true
      const clothing = d.data?.clothing
      if (clothing && Object.keys(clothing).length) return Object.values(clothing).some(v => v === 'P' || v === 'N')
      const emps = d.data?.employees
      if (Array.isArray(emps)) return emps.some(e => e.clothing === 'P' || e.clothing === 'N' || String(e.name || '').trim())
      return isDocSigned(d)
    }),
    checkR01(base),
    checkDailyCalendarDocs(docsOfType(haccpDocs, 'R02'), yearMonth, 'R02', d => {
      const cleaning = d.data?.cleaning || {}
      return Object.values(cleaning).some(mcdFilled)
    }),
    checkMonthlyOnce(docsOfType(haccpDocs, 'R04'), 'R04', 'Stacje deratyzacyjne', 'Raz w miesiącu', yearMonth),
    checkMonthlyOnce(docsOfType(haccpDocs, 'R08'), 'R08', 'Wzorcowanie urządzeń', 'Raz w miesiącu', yearMonth),
    checkR09(base),
    checkDailyCalendarDocs(docsOfType(haccpDocs, 'R11'), yearMonth, 'R11', d => isDocSigned(d) || mcdFilled(d.data?.result)),
    checkDailyCalendarDocs(docsOfType(haccpDocs, 'R13'), yearMonth, 'R13', d => {
      const checks = d.data?.checks || {}
      return Object.values(checks).some(v => v === 'P' || v === 'N')
    }),
    checkYearRegister(docsOfType(haccpDocs, 'W01'), 'W01', 'Orzeczenia lekarskie', 'Raz do roku', year),
    checkYearRegister(docsOfType(haccpDocs, 'W02'), 'W02', 'Szkolenia pracowników', 'Raz do roku', year),
    checkYearRegister(docsOfType(haccpDocs, 'W04'), 'W04', 'Środki czystości', 'Raz do roku', year),
    checkW05(base),
    checkW06(base)
  ].map(row => ({
    ...row,
    name: row.name || row.code,
    group: row.code.startsWith('K') ? 'Kartoteki' : row.code.startsWith('R') ? 'Raporty' : 'Wykazy'
  }))

  const summary = {
    ok: items.filter(i => i.status === 'ok').length,
    warn: items.filter(i => i.status === 'warn').length,
    missing: items.filter(i => i.status === 'missing').length,
    na: items.filter(i => i.status === 'na').length
  }

  return { period: yearMonth, year, items, summary }
}

export function complianceStatusLabel(status) {
  if (status === 'ok') return 'Uzupełnione'
  if (status === 'warn') return 'Do uzupełnienia'
  if (status === 'missing') return 'Brakuje'
  return 'Nie dotyczy'
}

export function complianceStatusClass(status) {
  if (status === 'ok') return 'status-green'
  if (status === 'warn') return 'status-yellow'
  if (status === 'missing') return 'status-red'
  return 'status-gray'
}
