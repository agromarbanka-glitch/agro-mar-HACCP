/**
 * K04, K04.1, K05, K06, K07 – silnik kartotek HACCP (układ papierowy + wpisy z magazynu/FIFO).
 */
export const HACCP_FORMS_VERSION = '1.8'

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/\s+/g, ' ')
}

export function productGroupForName(productName) {
  const text = normalizeText(productName)
  if (text.includes('malin')) return 'malina'
  if (text.includes('wisn')) return 'wisnia'
  if (text.includes('porzeczka czarna')) return 'porzeczka_czarna'
  if (/porzeczka\s+(kolorowa|kolor|czerwona)\b/.test(text) || text === 'pk' || text === 'pkp') return 'porzeczka_czerwona'
  if (text.includes('truskawk')) return 'truskawka'
  if (text.includes('aronia')) return 'aronia'
  if (text.includes('gruszk')) return 'gruszka'
  if (text.includes('sliw')) return 'sliwka'
  if (text.includes('obier')) return 'jab_obier'
  if (text.includes('jabl')) return 'jab_przem'
  return text.split(' ')[0] || 'inna'
}

/** Temperatura docelowa CP3 wg asortymentu (°C). */
export function k04TempForProductName(productName = '') {
  const text = normalizeText(productName)
  if (text.includes('pulpa')) return '-18'
  if (text.includes('truskaw')) return '-2'
  if (text.includes('malin')) return '0'
  if (text.includes('porzeczka')) return '0'
  if (text.includes('gruszk')) return '2'
  if (text.includes('jabl')) return '2'
  return '2'
}

export function k04TempLabel(productName = '') {
  const t = k04TempForProductName(productName)
  return `${t}°C`
}

function isSaleOperation(op) {
  if (!op) return false
  const type = normalizeText(op.operation_type)
  return type === 'sprzedaz' || type === 'sprzedaz_bez_produkcji'
}

/** Jabłko przemysłowe – bez magazynowania CP3, prosto do sprzedaży (K04.1). */
export function isIndustrialApple(productName = '', productGroup = '') {
  const t = normalizeText(productName)
  const g = normalizeText(productGroup)
  if (t.includes('obier')) return false
  if (g === 'jab_obier') return false
  return g === 'jab_przem' || (t.includes('jabl') && (t.includes('przem') || t.includes('przemysl')))
}

/** Jabłko na obierkę – magazynowane w CP3. */
export function isPeelingApple(productName = '', productGroup = '') {
  const t = normalizeText(productName)
  const g = normalizeText(productGroup)
  return g === 'jab_obier' || t.includes('obier')
}

/** Produkty bez magazynowania CP3 – transport bezpośredni (K04.1). */
export function isDirectToSaleProduct(productName = '', productGroup = '') {
  return isIndustrialApple(productName, productGroup)
}

function isFinishedGoodLot(lot, prodOpIds) {
  const productName = lot.products?.name || lot.product_name || ''
  const group = lot.product_group || productGroupForName(productName)
  if (isDirectToSaleProduct(productName, group)) return false
  if (lot.source_operation_id && prodOpIds.has(lot.source_operation_id)) return true
  const chamber = lot.chamber
  if (isCcp1Chamber(chamber)) return false
  if (chamber?.control_point === 'CP2') return false
  if (isCp3Chamber(chamber)) return true
  const finishedGroups = new Set(['malina', 'truskawka', 'wisnia', 'porzeczka_czarna', 'porzeczka_czerwona', 'aronia', 'sliwka', 'jab_obier', 'gruszka'])
  return finishedGroups.has(group)
}

/** Pola K06 wg wzoru papierowego (wsteczna kompatybilność ze starymi kluczami). */
export function normalizeK06Data(data = {}) {
  const barwa = normalizePn(data.barwa ?? data.wyglad_zapach ?? 'P')
  const zapach = normalizePn(data.zapach ?? data.smak ?? 'P')
  return {
    barwa,
    zapach,
    twardosc_jablko: normalizePn(data.twardosc_jablko ?? 'P'),
    brak_plesni: normalizePn(data.brak_plesni ?? 'P'),
    uwagi: data.uwagi ?? '',
    podpis: data.podpis ?? data.podpis_kontrolujacego ?? '',
    auto_source: data.auto_source || '',
    k03_key: data.k03_key || '',
    k03_mode: data.k03_mode || '',
    tryb_label: data.tryb_label || '',
    wz_no: data.wz_no || '',
    wz_date: data.wz_date || '',
    przerob_date: data.przerob_date || ''
  }
}

/** Nazwa produktu gotowego z K03 (linia WZ), nie surowca z PZ. */
export function finishedProductNameFromK03(k03) {
  return String(k03?.product_name || k03?.data?.gotowy_produkt || '').trim() || 'Produkt gotowy'
}

export function k06EvaluationDateFromK03(k03) {
  const wf = k03?.data?.k03_workflow || {}
  const mode = wf.mode || ''
  if (mode === 'przerob') {
    return String(wf.przerob_date || wf.fifo_cutoff_date || k03.document_date || '').slice(0, 10)
  }
  if (mode === 'bez_przerobu') {
    return String(k03.data?.wz_date || k03.document_date || '').slice(0, 10)
  }
  return String(k03.document_date || '').slice(0, 10)
}

function k06LotNoFromK03(k03, ov = {}) {
  return String(
    ov.lot_no ??
    k03.lot_no ??
    k03.data?.k03_workflow?.lot_no ??
    ''
  ).trim()
}

export function shouldIncludeK03InK06(k03) {
  if (!k03?.product_name) return false
  const mode = k03.data?.k03_workflow?.mode
  if (!mode || !['przerob', 'bez_przerobu'].includes(mode)) return false
  const evalDate = k06EvaluationDateFromK03(k03)
  return Boolean(evalDate && evalDate !== '0000-01-01')
}

function isCp3Chamber(chamber) {
  if (!chamber) return false
  return chamber.control_point === 'CP3' || normalizeText(chamber.code).startsWith('cp3')
}

function isCcp1Chamber(chamber) {
  if (!chamber) return false
  return chamber.control_point === 'CCP1' || normalizeText(chamber.code).startsWith('ccp1')
}

function dateRangeInclusive(start, end) {
  const dates = []
  if (!start || !end || start > end) return dates
  const cursor = new Date(`${start}T12:00:00`)
  const endDate = new Date(`${end}T12:00:00`)
  while (cursor <= endDate) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setDate(cursor.getDate() + 1)
  }
  return dates
}

function applyK04Override(doc, ov = {}) {
  const data = { ...(doc.data || {}) }
  if (Object.prototype.hasOwnProperty.call(ov, 'godzina')) data.godzina = ov.godzina
  if (Object.prototype.hasOwnProperty.call(ov, 'temperatura_chlodnia_1')) data.temperatura_chlodnia_1 = ov.temperatura_chlodnia_1
  if (Object.prototype.hasOwnProperty.call(ov, 'temperatura_chlodnia_2')) data.temperatura_chlodnia_2 = ov.temperatura_chlodnia_2
  if (Object.prototype.hasOwnProperty.call(ov, 'podpis_kontrolujacego')) data.podpis_kontrolujacego = ov.podpis_kontrolujacego
  if (Object.prototype.hasOwnProperty.call(ov, 'uwagi')) data.uwagi = ov.uwagi
  return {
    ...doc,
    data,
    status: normalizePn(data.uwagi || 'P') === 'N' ? 'N' : 'P',
    signed_by_operator: ov.podpis_kontrolujacego ?? doc.signed_by_operator ?? ''
  }
}

export const K07_KONTROLA_ETAPY = [
  { id: 'przed', label: 'Przed przerobem' },
  { id: 'po', label: 'Po przerobie' }
]

/** K07 dotyczy wyłącznie przerobu maliny i porzeczki czarnej (decyzja w K03). */
export const K07_ALLOWED_PRODUCT_GROUPS = new Set(['malina', 'porzeczka_czarna'])

export function isK07AllowedProduct(productName = '', productGroup = '') {
  const g = productGroup || productGroupForName(productName)
  return K07_ALLOWED_PRODUCT_GROUPS.has(g)
}

export function isK07EligibleDoc(doc) {
  if (!doc || doc.document_type !== 'K07') return false
  const surowiec = doc.data?.surowiec || doc.product_name || ''
  if (doc.data?.auto_source === 'manual') {
    return !surowiec.trim() || isK07AllowedProduct(surowiec)
  }
  return isK07AllowedProduct(surowiec)
}

function k07PartiaGroupKey(doc) {
  const partia = String(doc?.data?.numer_partii || doc?.lot_no || '').trim().toLowerCase()
  const date = String(doc?.document_date || '').slice(0, 10)
  if (partia && date) return `partia:${partia}|${date}`
  const k03Key = doc?.data?.k03_key
  if (k03Key) return `k03:${k03Key}`
  const opId = doc?.data?.operation_id || doc?.operation_id
  if (opId) return `op:${opId}`
  return `id:${doc?.id || ''}`
}

function applyK07Override(doc, ov = {}) {
  const base = normalizeK07Data(doc.data || {}, doc)
  const merged = { ...base, ...ov }
  if (Object.prototype.hasOwnProperty.call(ov, 'surowiec')) merged.surowiec = ov.surowiec
  if (Object.prototype.hasOwnProperty.call(ov, 'numer_partii')) merged.numer_partii = ov.numer_partii
  if (Object.prototype.hasOwnProperty.call(ov, 'partia')) merged.numer_partii = ov.partia
  if (Object.prototype.hasOwnProperty.call(ov, 'kontrola_etap')) {
    merged.kontrola_etap = ov.kontrola_etap
    merged.kontrola_label = ov.kontrola_label || K07_KONTROLA_ETAPY.find(e => e.id === ov.kontrola_etap)?.label || merged.kontrola_label
  }
  return {
    ...doc,
    document_date: ov.document_date ?? doc.document_date,
    product_name: merged.surowiec || doc.product_name || '',
    lot_no: merged.numer_partii || doc.lot_no || '',
    data: merged,
    status: normalizePn(merged.stan_sita || 'P') === 'N' ? 'N' : 'P',
    signed_by_operator: ov.podpis_kontrolujacego ?? doc.signed_by_operator ?? merged.podpis_kontrolujacego ?? ''
  }
}

export function k07SyntheticId(operationId, etap) {
  return `K07-${operationId}-${etap}`
}

export function k07SyntheticIdFromK03(k03Key, etap) {
  const base = String(k03Key || '').replace(/^K03-/, '')
  return `K07-K03-${base}-${etap}`
}

/** Klucz deduplikacji wpisu K07 (partia × data × etap). */
export function k07DedupeKey(doc) {
  const partia = String(doc?.data?.numer_partii || doc?.lot_no || '').trim().toLowerCase()
  const date = String(doc?.document_date || '').slice(0, 10)
  const etap = doc?.data?.kontrola_etap || 'przed'
  if (partia && date) return `partia:${partia}|${date}|${etap}`
  const k03Key = doc?.data?.k03_key
  if (k03Key) return `k03:${k03Key}|${etap}`
  const opId = doc?.data?.operation_id || doc?.operation_id
  if (opId) return `op:${opId}|${etap}`
  return `id:${doc?.id || ''}|${etap}`
}

export function k07K03EtapKey(doc) {
  const k03Key = doc?.data?.k03_key
  if (!k03Key) return ''
  return `${k03Key}|${doc?.data?.kontrola_etap || 'przed'}`
}

/** Czy w bazie jest już wpis K07 dla tego samego przerobu / partii. */
export function k07AlreadyInDb(haccpDocs, doc) {
  const key = k07DedupeKey(doc)
  const k03Etap = k07K03EtapKey(doc)
  return (haccpDocs || []).some(d => {
    if (d.document_type !== 'K07') return false
    if (k07DedupeKey(d) === key) return true
    if (k03Etap && k07K03EtapKey(d) === k03Etap) return true
    return false
  })
}

export function k07RowHideKey(doc) {
  return k07DedupeKey(doc) || String(doc?.id || '').trim()
}

export function shouldIncludeK03InK07(k03) {
  if (!k03?.product_name) return false
  const mode = k03.data?.k03_workflow?.mode
  if (mode !== 'przerob') return false
  const group = k03.product_group || k03.data?.product_group || productGroupForName(k03.product_name)
  if (!isK07AllowedProduct(k03.product_name, group)) return false
  const evalDate = k06EvaluationDateFromK03(k03)
  return Boolean(evalDate && evalDate !== '0000-01-01')
}

export function isSyntheticK07Doc(doc) {
  if (!doc || doc.document_type !== 'K07') return false
  if (doc.synthetic) return true
  const id = String(doc.id || '')
  if (id.startsWith('K07-manual-')) return true
  return id.startsWith('K07-') && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
}

function k07CoverageForOp(haccpDocs, opId) {
  const entries = (haccpDocs || []).filter(d =>
    d.document_type === 'K07' && (d.data?.operation_id || d.operation_id) === opId
  )
  const etaps = new Set(entries.map(d => d.data?.kontrola_etap || 'przed'))
  return {
    przed: etaps.has('przed'),
    po: etaps.has('po')
  }
}

function k07CoverageForPartia(haccpDocs, numerPartii, date) {
  const partia = String(numerPartii || '').trim().toLowerCase()
  const day = String(date || '').slice(0, 10)
  const entries = (haccpDocs || []).filter(d => {
    if (d.document_type !== 'K07') return false
    const p = String(d.data?.numer_partii || d.lot_no || '').trim().toLowerCase()
    return p === partia && String(d.document_date || '').slice(0, 10) === day
  })
  const etaps = new Set(entries.map(d => d.data?.kontrola_etap || 'przed'))
  return {
    przed: etaps.has('przed'),
    po: etaps.has('po')
  }
}

function buildK07PoFromTemplate(przedDoc, overrides = {}) {
  const opId = przedDoc.data?.operation_id || przedDoc.operation_id
  const k03Key = przedDoc.data?.k03_key || ''
  const id = k03Key ? k07SyntheticIdFromK03(k03Key, 'po') : k07SyntheticId(opId, 'po')
  const ov = overrides[id] || {}
  const base = {
    id,
    synthetic: true,
    document_type: 'K07',
    operation_id: opId || null,
    document_date: przedDoc.document_date,
    product_name: przedDoc.product_name || '',
    lot_no: przedDoc.lot_no || '',
    document_no: k03Key
      ? `K07/K03/${String(k03Key).replace(/^K03-/, '')}/po`
      : `K07/${przedDoc.document_no || przedDoc.document_date || 'brak'}/po`,
    chamber_code: 'CCP1',
    qty: 0,
    status: 'P',
    data: {
      ...normalizeK07Data(przedDoc.data || {}, przedDoc),
      kontrola_etap: 'po',
      kontrola_label: 'Po przerobie',
      godzina: '',
      podpis_kontrolujacego: '',
      k03_key: k03Key || przedDoc.data?.k03_key || null,
      auto_source: przedDoc.data?.auto_source || 'k03_przerob'
    },
    signed_by_operator: '',
    document_version: 'I/2024',
    created_at: przedDoc.document_date
  }
  return applyK07Override(base, ov)
}

/** Uzupełnia brakujące wpisy „Po przerobie” gdy w bazie jest tylko „Przed”. */
export function buildMissingK07PoPairs(haccpDocs = [], overrides = {}) {
  const result = []
  const seen = new Set()
  const groups = new Map()

  for (const d of (haccpDocs || []).filter(x => x.document_type === 'K07' && isK07EligibleDoc(x))) {
    const groupKey = k07PartiaGroupKey(d)
    if (!groups.has(groupKey)) groups.set(groupKey, [])
    groups.get(groupKey).push(d)
  }

  for (const [, entries] of groups) {
    const hasPo = entries.some(e => e.data?.kontrola_etap === 'po')
    if (hasPo) continue
    const przed = entries.find(e => (e.data?.kontrola_etap || 'przed') === 'przed') || entries[0]
    if (!przed) continue
    const po = buildK07PoFromTemplate(przed, overrides)
    const key = k07DedupeKey(po)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(po)
  }
  return result
}

function buildK07EntryFromK03(k03, etap, overrides = {}) {
  const wf = k03.data?.k03_workflow || {}
  const k03Key = k03.id
  const id = k07SyntheticIdFromK03(k03Key, etap)
  const ov = overrides[id] || {}
  const date = k06EvaluationDateFromK03(k03)
  const surowiec = String(k03.product_name || '').trim() || 'Przerób na pulę (CCP1)'
  const numerPartii = String(k03.lot_no || wf.lot_no || '').trim()
  const opId = k03.data?.sale_operation_id || null
  const etapMeta = K07_KONTROLA_ETAPY.find(e => e.id === etap) || { id: etap, label: etap }
  const base = {
    id,
    synthetic: true,
    document_type: 'K07',
    operation_id: opId,
    document_date: date,
    product_name: surowiec,
    lot_no: numerPartii,
    document_no: `K07/K03/${String(k03Key).replace(/^K03-/, '')}/${etap}`,
    chamber_code: 'CCP1',
    qty: Number(k03.qty || k03.data?.saleQty || 0),
    status: 'P',
    data: {
      godzina: '',
      surowiec,
      numer_partii: numerPartii,
      stan_sita: 'P',
      podpis_kontrolujacego: '',
      operation_id: opId,
      k03_key: k03Key,
      k03_mode: 'przerob',
      auto_source: 'k03_przerob',
      kontrola_etap: etapMeta.id,
      kontrola_label: etapMeta.label,
      wz_no: k03.document_no || k03.data?.wz_no || ''
    },
    signed_by_operator: '',
    document_version: 'I/2024',
    created_at: date
  }
  return applyK07Override(base, ov)
}

/** K07 z kart K03 (decyzja: przerób na pulę) – 2 wpisy na każdy K03. */
export function buildSyntheticK07DocsFromK03(k03Forms = [], haccpDocs = [], overrides = {}) {
  const result = []
  const existingIds = new Set((haccpDocs || []).filter(d => d.document_type === 'K07').map(d => d.id))

  for (const k03 of k03Forms || []) {
    if (!shouldIncludeK03InK07(k03)) continue
    const k03Key = k03.id
    const date = k06EvaluationDateFromK03(k03)
    const numerPartii = String(k03.lot_no || k03.data?.k03_workflow?.lot_no || '').trim()
    const coverage = k07CoverageForPartia(haccpDocs, numerPartii, date)

    for (const etap of K07_KONTROLA_ETAPY) {
      if (coverage[etap.id]) continue
      const id = k07SyntheticIdFromK03(k03Key, etap.id)
      if (existingIds.has(id)) continue
      result.push(buildK07EntryFromK03(k03, etap.id, overrides))
    }
  }

  return result.sort((a, b) =>
    String(a.document_date || '').localeCompare(String(b.document_date || '')) ||
    String(a.data?.kontrola_etap || '').localeCompare(String(b.data?.kontrola_etap || '')) ||
    String(a.product_name || '').localeCompare(String(b.product_name || ''))
  )
}

/** Pusty wiersz K07 do ręcznego uzupełnienia w kartotece miesięcznej. */
export function buildManualK07BlankDoc(period, manualId, seed = {}, overrides = {}) {
  const date = String(seed.document_date || `${period}-01`).slice(0, 10)
  const etap = seed.kontrola_etap === 'po' ? 'po' : 'przed'
  const etapMeta = K07_KONTROLA_ETAPY.find(e => e.id === etap) || K07_KONTROLA_ETAPY[0]
  const id = manualId || `K07-manual-${period}-${Date.now()}`
  const ov = overrides[id] || {}
  const base = {
    id,
    synthetic: true,
    document_type: 'K07',
    operation_id: null,
    document_date: date,
    product_name: String(seed.surowiec || '').trim(),
    lot_no: String(seed.numer_partii || seed.lot_no || '').trim(),
    document_no: `K07/reczny/${date}/${etap}`,
    chamber_code: 'CCP1',
    qty: 0,
    status: 'P',
    data: {
      godzina: String(seed.godzina || ''),
      surowiec: String(seed.surowiec || ''),
      numer_partii: String(seed.numer_partii || seed.lot_no || ''),
      stan_sita: normalizePn(seed.stan_sita || 'P'),
      podpis_kontrolujacego: String(seed.podpis_kontrolujacego || ''),
      auto_source: 'manual',
      kontrola_etap: etapMeta.id,
      kontrola_label: etapMeta.label
    },
    signed_by_operator: seed.podpis_kontrolujacego || '',
    document_version: 'I/2024',
    created_at: date
  }
  return applyK07Override(base, ov)
}

function buildK07EntryFromProduction(op, etap, trace, overrides = {}) {
  const { allocations = [], lots = [] } = trace
  const lotMap = new Map(lots.map(l => [l.id, l]))
  const date = String(op.operation_date || '').slice(0, 10)
  const related = allocations.filter(a => a.operation_id === op.id)
  const outputLots = related.map(a => lotMap.get(a.output_lot_id)).filter(Boolean)
  const inputLots = related.map(a => lotMap.get(a.source_lot_id)).filter(Boolean)
  const surowiec = Array.from(new Set(
    inputLots.map(l => l.products?.name || l.product_name || '').filter(Boolean)
  )).join(', ')
  const outputLot = outputLots[0]
  const numerPartii = outputLot?.lot_no || ''
  const etapMeta = K07_KONTROLA_ETAPY.find(e => e.id === etap) || { id: etap, label: etap }
  const id = k07SyntheticId(op.id, etap)
  const ov = overrides[id] || {}
  const base = {
    id,
    synthetic: true,
    document_type: 'K07',
    operation_id: op.id,
    document_date: date,
    product_name: surowiec || 'Przerób na pulę (CCP1)',
    lot_no: numerPartii,
    document_no: `K07/${op.document_no || date}/${etap}`,
    chamber_code: 'CCP1',
    qty: 0,
    status: 'P',
    data: {
      godzina: '',
      surowiec: surowiec || 'Przerób na pulę (CCP1)',
      numer_partii: numerPartii,
      stan_sita: 'P',
      podpis_kontrolujacego: '',
      operation_id: op.id,
      kontrola_etap: etapMeta.id,
      kontrola_label: etapMeta.label
    },
    signed_by_operator: '',
    document_version: 'I/2024',
    created_at: date
  }
  return applyK07Override(base, ov)
}

/** Pola K07 wg wzoru papierowego. */
export function normalizeK07Data(data = {}, doc = {}) {
  const surowiec = data.surowiec || doc.product_name || data.rodzaj_surowca || ''
  const numerPartii = data.numer_partii || data.partia || doc.lot_no || ''
  const etap = data.kontrola_etap || ''
  return {
    godzina: data.godzina ?? '',
    surowiec,
    numer_partii: numerPartii,
    stan_sita: normalizePn(data.stan_sita || 'P'),
    podpis_kontrolujacego: data.podpis_kontrolujacego || '',
    operation_id: data.operation_id || doc.operation_id || null,
    k03_key: data.k03_key || null,
    k03_mode: data.k03_mode || null,
    auto_source: data.auto_source || null,
    wz_no: data.wz_no || '',
    kontrola_etap: etap,
    kontrola_label: data.kontrola_label || (etap === 'przed' ? 'Przed przerobem' : etap === 'po' ? 'Po przerobie' : '')
  }
}

function applyK06Override(doc, ov = {}) {
  const data = normalizeK06Data({ ...(doc.data || {}), ...ov })
  return {
    ...doc,
    document_date: ov.document_date ?? ov.przerob_date ?? doc.document_date,
    lot_no: ov.lot_no ?? doc.lot_no ?? '',
    product_name: ov.product_name ?? doc.product_name ?? '',
    data: {
      ...data,
      przerob_date: ov.przerob_date ?? data.przerob_date ?? doc.document_date,
      wz_no: data.wz_no,
      wz_date: data.wz_date
    },
    signed_by_operator: ov.podpis ?? ov.podpis_kontrolujacego ?? doc.signed_by_operator ?? data.podpis ?? ''
  }
}

export function getLiveK06Doc(doc, overrides = {}) {
  const ov = overrides?.[doc?.id] || {}
  return applyK06Override(doc, ov)
}

function upsertK04DailyEntry(dailyEntries, mixedDays, { chamberCode, productGroup, productName, lot, start, end, lotId = null }) {
  const temp = k04TempForProductName(productName)
  for (const date of dateRangeInclusive(start, end)) {
    const mixedKey = `${chamberCode}|${date}`
    const id = `K04-${chamberCode}-${productGroup}-${date}`
    if (!dailyEntries.has(id)) {
      dailyEntries.set(id, {
        id,
        synthetic: true,
        document_type: 'K04',
        document_date: date,
        product_name: productName,
        lot_no: lot?.lot_no || '',
        supplier_name: '',
        document_no: `K04/${chamberCode}/${productGroup}/${date}`,
        chamber_code: chamberCode,
        qty: Number(lot?.remaining_qty || lot?.initial_qty || 0),
        status: 'P',
        data: {
          godzina: '09:15',
          temperatura_chlodnia_1: String(temp),
          temperatura_chlodnia_2: String(temp),
          podpis_kontrolujacego: '',
          uwagi: 'P',
          product_group: productGroup,
          produkty: productName,
          lot_ids: lotId ? [lotId] : [],
          k03_source: lotId ? null : 'k03'
        },
        signed_by_operator: '',
        document_version: 'I/2024',
        created_at: date
      })
    } else {
      const entry = dailyEntries.get(id)
      if (lotId && !entry.data.lot_ids.includes(lotId)) entry.data.lot_ids.push(lotId)
      if (!normalizeText(entry.product_name).includes(normalizeText(productName))) {
        entry.data.produkty = `${entry.data.produkty}, ${productName}`
      }
    }
    const groupsOnDay = dailyEntries.get(id)?.data?.product_group
    if (groupsOnDay && groupsOnDay !== productGroup) mixedDays.add(mixedKey)
  }
}

/**
 * K04 – dzienna kontrola CP3: od dnia produkcji / przerobu (K03) do dnia WZ (wyjazd).
 */
export function buildSyntheticK04DocsFromTrace(trace = {}, overrides = {}, k03Forms = []) {
  const { lots = [], allocations = [], operations = [] } = trace
  const opMap = new Map(operations.map(o => [o.id, o]))
  const today = new Date().toISOString().slice(0, 10)

  const lastSaleByLot = new Map()
  for (const alloc of allocations) {
    if (!alloc.source_lot_id) continue
    const op = opMap.get(alloc.operation_id)
    if (!isSaleOperation(op)) continue
    const saleDate = String(op.operation_date || '').slice(0, 10)
    if (!saleDate) continue
    const prev = lastSaleByLot.get(alloc.source_lot_id)
    if (!prev || saleDate > prev) lastSaleByLot.set(alloc.source_lot_id, saleDate)
  }

  const dailyEntries = new Map()
  const mixedDays = new Set()

  for (const lot of lots) {
    const chamber = lot.chamber || null
    const productName = lot.products?.name || lot.product_name || ''
    const productGroup = lot.product_group || productGroupForName(productName)
    if (isDirectToSaleProduct(productName, productGroup)) continue
    if (!isCp3Chamber(chamber)) continue
    const chamberCode = chamber.code || 'CP3'
    const start = String(lot.production_date || lot.created_at || '').slice(0, 10)
    if (!start) continue

    let end = lastSaleByLot.get(lot.id) || ''
    if (!end && Number(lot.remaining_qty || 0) > 0) end = today
    if (!end) end = start

    upsertK04DailyEntry(dailyEntries, mixedDays, {
      chamberCode, productGroup, productName, lot, start, end, lotId: lot.id
    })
  }

  for (const k03 of k03Forms || []) {
    if (!k03?.product_name) continue
    if (k03.data?.k03_source === 'excel') continue
    const productName = k03.product_name
    const productGroup = k03.product_group || k03.data?.product_group || productGroupForName(productName)
    if (isDirectToSaleProduct(productName, productGroup)) continue
    const wzDate = String(k03.data?.wz_date || k03.document_date || '').slice(0, 10)
    const start = String(
      k03.data?.k03_workflow?.przerob_date ||
      k03.data?.k03_workflow?.fifo_cutoff_date ||
      wzDate
    ).slice(0, 10)
    if (!start || !wzDate) continue
    const matchedLot = (lots || []).find(l => l.lot_no && k03.lot_no && l.lot_no === k03.lot_no)
    const chamberCode = matchedLot?.chamber?.code || 'CP3'
    upsertK04DailyEntry(dailyEntries, mixedDays, {
      chamberCode,
      productGroup,
      productName,
      lot: matchedLot || { lot_no: k03.lot_no, remaining_qty: k03.qty, initial_qty: k03.qty },
      start,
      end: wzDate,
      lotId: matchedLot?.id || null
    })
  }

  return Array.from(dailyEntries.values()).map(doc => {
    const mixedKey = `${doc.chamber_code}|${doc.document_date}`
    if (mixedDays.has(mixedKey)) {
      doc.data.chamber_mix_warning = true
    }
    return applyK04Override(doc, overrides[doc.id] || {})
  }).sort((a, b) =>
    String(a.chamber_code).localeCompare(String(b.chamber_code)) ||
    String(a.data?.product_group || '').localeCompare(String(b.data?.product_group || '')) ||
    String(a.document_date).localeCompare(String(b.document_date))
  )
}

/** Fallback gdy brak danych magazynowych – stary mechanizm z haccp_documents. */
export function buildSyntheticK04Docs(allDocs, overrides = {}) {
  return buildSyntheticK04DocsFromTrace({}, overrides)
}

/**
 * K07 – dwa wpisy na każdy przerób (przed i po): kontrola sita CCP1.
 * Źródła: operacje produkcji w magazynie + brakujące pary „po” z istniejących wpisów.
 */
export function buildSyntheticK07DocsFromTrace(trace = {}, overrides = {}, haccpDocs = []) {
  const { operations = [] } = trace
  const result = []
  const existingKeys = new Set((haccpDocs || []).filter(d => d.document_type === 'K07').map(k07DedupeKey))
  const pendingKeys = new Set()

  for (const op of operations) {
    if (normalizeText(op.operation_type) !== 'produkcja') continue
    const date = String(op.operation_date || '').slice(0, 10)
    if (!date) continue

    const coverage = k07CoverageForOp(haccpDocs, op.id)

    for (const etap of K07_KONTROLA_ETAPY) {
      if (coverage[etap.id]) continue
      const doc = buildK07EntryFromProduction(op, etap.id, trace, overrides)
      const key = k07DedupeKey(doc)
      if (existingKeys.has(key) || pendingKeys.has(key)) continue
      pendingKeys.add(key)
      result.push(doc)
    }
  }

  for (const doc of buildMissingK07PoPairs(haccpDocs, overrides)) {
    const key = k07DedupeKey(doc)
    if (existingKeys.has(key) || pendingKeys.has(key)) continue
    pendingKeys.add(key)
    result.push(doc)
  }

  return result.sort((a, b) =>
    String(a.document_date || '').localeCompare(String(b.document_date || '')) ||
    String(a.data?.operation_id || a.operation_id || '').localeCompare(String(b.data?.operation_id || b.operation_id || '')) ||
    String(a.data?.kontrola_etap || '').localeCompare(String(b.data?.kontrola_etap || '')) ||
    String(a.product_name || '').localeCompare(String(b.product_name || ''))
  )
}

/** Pełna lista syntetycznych K07: wyłącznie K03 (przerób malina / porzeczka czarna) + brakujące „po”. */
export function buildAllSyntheticK07Docs(trace = {}, k03Forms = [], overrides = {}, haccpDocs = []) {
  const fromK03 = buildSyntheticK07DocsFromK03(k03Forms, haccpDocs, overrides)
  const keys = new Set(fromK03.map(k07DedupeKey))
  const merged = [...fromK03]
  for (const doc of buildMissingK07PoPairs(haccpDocs, overrides)) {
    const key = k07DedupeKey(doc)
    if (keys.has(key)) continue
    keys.add(key)
    merged.push(doc)
  }
  return merged.sort(k07DocSort)
}

export function k07DocSort(a, b) {
  return String(a.document_date || '').localeCompare(String(b.document_date || '')) ||
    String(a.data?.numer_partii || a.lot_no || '').localeCompare(String(b.data?.numer_partii || b.lot_no || '')) ||
    (a.data?.kontrola_etap === 'po' ? 1 : 0) - (b.data?.kontrola_etap === 'po' ? 1 : 0) ||
    String(a.product_name || '').localeCompare(String(b.product_name || ''))
}

export function buildSyntheticK07Docs(allDocs, overrides = {}) {
  return buildSyntheticK07DocsFromTrace({}, overrides)
}

/**
 * K06 – ocena jakości produktu gotowego wyłącznie z K03 (WZ: po przerobie lub bez przerobu).
 * Nie używa partii surowca z CP2 / magazynu PZ.
 * @deprecated Zachowane dla kompatybilności – zwraca pustą listę.
 */
export function buildSyntheticK06DocsFromTrace(_trace = {}, _haccpDocs = []) {
  return []
}

/**
 * K06 – jeden wiersz na każdy K03 z decyzją przerób / bez przerobu (produkt gotowy z WZ).
 */
export function buildSyntheticK06DocsFromK03(k03Forms = [], haccpDocs = [], overrides = {}) {
  const dbK06 = (haccpDocs || []).filter(d => d.document_type === 'K06')
  const existingK03Keys = new Set(dbK06.map(d => d.data?.k03_key).filter(Boolean))
  const existingIds = new Set(dbK06.map(d => d.id))

  const result = []
  for (const k03 of k03Forms || []) {
    if (!shouldIncludeK03InK06(k03)) continue

    const k03Key = k03.id
    const id = `K06-K03-${k03Key}`
    if (existingK03Keys.has(k03Key) || existingIds.has(id)) continue

    const wf = k03.data?.k03_workflow || {}
    const ov = overrides[id] || {}
    const productName = finishedProductNameFromK03(k03)
    const evalDate = k06EvaluationDateFromK03(k03)
    const lotNo = k06LotNoFromK03(k03, ov)
    const mode = wf.mode || 'bez_przerobu'

    const base = {
      id,
      synthetic: true,
      document_type: 'K06',
      document_date: evalDate,
      product_name: productName,
      lot_no: lotNo,
      lot_id: null,
      document_no: `K06/WZ-${k03.document_no || k03Key.replace(/^K03-/, '')}`,
      chamber_code: 'CP3',
      qty: Number(k03.qty || k03.data?.saleQty || 0),
      status: 'P',
      data: normalizeK06Data({
        barwa: 'P',
        zapach: 'P',
        twardosc_jablko: 'P',
        brak_plesni: 'P',
        uwagi: '',
        podpis: '',
        auto_source: 'k03',
        k03_key: k03Key,
        k03_mode: mode,
        tryb_label: mode === 'przerob' ? 'Po przerobie' : 'Bez przerobu',
        wz_no: k03.document_no || k03.data?.wz_no || '',
        wz_date: String(k03.data?.wz_date || k03.document_date || '').slice(0, 10),
        przerob_date: mode === 'przerob'
          ? String(wf.przerob_date || wf.fifo_cutoff_date || evalDate).slice(0, 10)
          : ''
      }),
      signed_by_operator: '',
      document_version: 'I/2024',
      created_at: evalDate
    }
    result.push(applyK06Override(base, ov))
  }
  return result.sort((a, b) =>
    String(a.document_date || '').localeCompare(String(b.document_date || '')) ||
    String(a.product_name || '').localeCompare(String(b.product_name || ''))
  )
}

export function isSyntheticK06Doc(doc) {
  if (!doc || doc.document_type !== 'K06') return false
  if (doc.synthetic) return true
  const id = String(doc.id || '')
  return id.startsWith('K06-K03-') || id.startsWith('K06-syn-')
}

export function k06RowHideKey(doc) {
  return String(doc?.data?.k03_key || doc?.id || '').trim()
}

export function buildK06InsertPayload(doc) {
  return {
    document_type: 'K06',
    lot_id: doc.lot_id || null,
    operation_id: doc.operation_id || null,
    document_date: doc.document_date,
    product_name: doc.product_name,
    lot_no: doc.lot_no,
    document_no: doc.document_no,
    chamber_code: doc.chamber_code || 'CP3',
    qty: doc.qty || 0,
    status: doc.status || 'P',
    data: normalizeK06Data(doc.data || {}),
    signed_by_operator: doc.signed_by_operator || doc.data?.podpis || null,
    document_version: 'I/2024'
  }
}

export function buildK07InsertPayload(doc) {
  const live = doc.data ? { ...doc, data: normalizeK07Data(doc.data, doc) } : doc
  const d = normalizeK07Data(live.data || {}, live)
  return {
    document_type: 'K07',
    operation_id: d.operation_id || live.operation_id || null,
    document_date: live.document_date,
    product_name: d.surowiec || live.product_name || '',
    lot_no: d.numer_partii || live.lot_no || '',
    document_no: live.document_no || `K07/${live.document_date || 'brak'}`,
    chamber_code: 'CCP1',
    qty: live.qty || 0,
    status: live.status || (normalizePn(d.stan_sita) === 'N' ? 'N' : 'P'),
    data: d,
    signed_by_operator: live.signed_by_operator || d.podpis_kontrolujacego || null,
    document_version: 'I/2024'
  }
}

export function normalizePn(value) {
  return value === 'N' ? 'N' : 'P'
}

export function getLiveK04Doc(doc, overrides) {
  return applyK04Override(doc, overrides?.[doc?.id] || {})
}

export function getLiveK07Doc(doc, overrides) {
  return applyK07Override(doc, overrides?.[doc?.id] || {})
}

function k04TempNote(productName = '', chamberCode = '') {
  if (normalizeText(chamberCode).startsWith('ccp')) {
    return '- Temp. w beczkach CCP1 (pulpa): ok. -18°C (±2°C).'
  }
  return `- Temp. CP3: jabłko na obierkę/gruszki 2°C, truskawki -2°C, maliny/porzeczki 0°C. Jabłko przemysłowe nie jest magazynowane – jedzie prosto do sprzedaży (K04.1).`
}

export function buildK04MonthlyHtml(group, escapeHtml) {
  const docs = group.docs || []
  const year = (group.period || docs[0]?.document_date || '').slice(0, 4)
  const month = (group.period || docs[0]?.document_date || '').slice(5, 7)
  const chamber = group.chamber || docs[0]?.chamber_code || 'CP3'
  const productLabel = group.product || docs[0]?.product_name || docs[0]?.data?.produkty || ''
  const rows = docs.map(doc => {
    const d = doc.data || {}
    return `<tr><td>${escapeHtml(doc.document_date || '')}</td><td>${escapeHtml(d.godzina || '09:15')}</td><td>${escapeHtml(d.temperatura_chlodnia_1 || '')}</td><td>${escapeHtml(d.temperatura_chlodnia_2 || '')}</td><td>${escapeHtml(doc.signed_by_operator || d.podpis_kontrolujacego || '')}</td><td>${normalizePn(d.uwagi || 'P')}</td></tr>`
  }).join('')
  const blanks = Array.from({ length: Math.max(0, 16 - docs.length) }, () => `<tr class="blank-row"><td></td><td></td><td></td><td></td><td></td><td></td></tr>`).join('')
  const note = k04TempNote(productLabel, chamber)
  return `<!doctype html><html><head><meta charset="utf-8"><title>K04 ${escapeHtml(chamber)} ${escapeHtml(group.period)}</title><style>@page{size:A4 landscape;margin:8mm}body{font-family:"Times New Roman",serif;color:#111;margin:0}table{width:100%;border-collapse:collapse;table-layout:fixed}td,th{border:1px solid #111;padding:4px;text-align:center;vertical-align:middle;font-size:11pt;line-height:1.12}.company{width:31%;font-weight:bold;line-height:1.12}.title{width:44%;font-weight:bold;line-height:1.5}.meta{width:25%;text-align:left;vertical-align:top}.temp-note{text-align:left;font-size:11pt;line-height:1.15;padding-left:8px}.blank-row td{height:21px}@media print{button{display:none}}</style></head><body><table><tbody><tr><td class="company" rowspan="2">AGRO-MAR<br>MARIUSZ BAŃKA<br>SP. Z O.O.<br>24-335 ŁAZISKA,<br>KOLONIA ŁAZISKA 30<br>NIP: 7171839598</td><td class="title">Karta K04 - Karta kontroli parametrów<br>magazynowania produktów gotowych (CP3)</td><td class="meta"><b>Rok:</b> ${escapeHtml(year)}<br><br><b>Miesiąc:</b> ${escapeHtml(month)}<br><b>Komora:</b> ${escapeHtml(chamber)}<br><b>Produkt:</b> ${escapeHtml(productLabel)}</td></tr><tr><td class="temp-note">${note}</td><td class="meta" style="text-align:center;vertical-align:middle">Wersja I/2024</td></tr></tbody></table><table><thead><tr><th>Data</th><th>Godzina</th><th>Temperatura<br>nr 1 [°C]</th><th>Temperatura<br>nr 2 [°C]</th><th>Podpis osoby<br>kontrolującej</th><th>Uwagi<br>(P/N)*</th></tr></thead><tbody>${rows}${blanks}</tbody></table><script>window.onload=function(){setTimeout(function(){window.focus();window.print()},700)}</script></body></html>`
}

export function buildK06MonthlyHtml(group, escapeHtml) {
  const docs = group.docs || []
  const year = (group.period || docs[0]?.document_date || '').slice(0, 4)
  const month = (group.period || docs[0]?.document_date || '').slice(5, 7)
  const rows = docs.map(doc => {
    const d = normalizeK06Data(doc.data || {})
    return `<tr><td>${escapeHtml(doc.document_date || '')}</td><td class="left">${escapeHtml(doc.product_name || '')}</td><td>${escapeHtml(doc.lot_no || '')}</td><td>${normalizePn(d.barwa)}</td><td>${normalizePn(d.zapach)}</td><td>${normalizePn(d.twardosc_jablko)}</td><td>${normalizePn(d.brak_plesni)}</td><td>${escapeHtml(doc.signed_by_operator || d.podpis || '')}</td></tr>`
  }).join('')
  const blanks = Array.from({ length: Math.max(0, 11 - docs.length) }, () => `<tr class="blank-row"><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>K06 ${escapeHtml(group.period)}</title><style>@page{size:A4 landscape;margin:8mm}body{font-family:"Times New Roman",serif;color:#111;margin:0}table{width:100%;border-collapse:collapse;table-layout:fixed}td,th{border:1px solid #111;padding:4px;text-align:center;vertical-align:middle;font-size:10.5pt;line-height:1.1}.company{width:31%;font-weight:bold;line-height:1.12}.title{width:44%;font-weight:bold;line-height:1.3}.meta{width:25%;text-align:left;vertical-align:top}.left{text-align:left}.blank-row td{height:21px}@media print{button{display:none}}</style></head><body><table><tbody><tr><td class="company" rowspan="2">AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.<br>24-335 ŁAZISKA,<br>KOLONIA ŁAZISKA 30<br>NIP: 7171839598</td><td class="title">Karta K06 - Karta oceny jakości gotowego produktu</td><td class="meta"><b>Rok:</b> ${escapeHtml(year)}<br><b>Miesiąc:</b> ${escapeHtml(month)}<br><b>Strona:</b> 1 z 1</td></tr><tr><td></td><td class="meta" style="text-align:center;vertical-align:middle">Wersja I/2024</td></tr></tbody></table><table><thead><tr><th>Data</th><th>Nazwa towaru</th><th>Numer partii</th><th>Barwa<br>(P/N)*</th><th>Zapach<br>(P/N)*</th><th>Twardość (jabłko)<br>(P/N)*</th><th>Brak oznak pleśni<br>(P/N)*</th><th>Podpis kontrolującego</th></tr></thead><tbody>${rows}${blanks}</tbody></table><script>window.onload=function(){setTimeout(function(){window.focus();window.print()},700)}</script></body></html>`
}

export function buildK07MonthlyHtml(group, escapeHtml) {
  const docs = group.docs || []
  const year = (group.period || docs[0]?.document_date || '').slice(0, 4)
  const month = (group.period || docs[0]?.document_date || '').slice(5, 7)
  const rows = docs.map(doc => {
    const d = normalizeK07Data(doc.data || {}, doc)
    return `<tr><td>${escapeHtml(doc.document_date || '')}</td><td>${escapeHtml(d.godzina || '12:00')}</td><td class="left">${escapeHtml(d.surowiec || '')}</td><td>${escapeHtml(d.numer_partii || '')}</td><td>${normalizePn(d.stan_sita || 'P')}</td><td>${escapeHtml(doc.signed_by_operator || d.podpis_kontrolujacego || '')}</td></tr>`
  }).join('')
  const blanks = Array.from({ length: Math.max(0, 11 - docs.length) }, () => `<tr class="blank-row"><td></td><td></td><td></td><td></td><td></td><td></td></tr>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>K07 ${escapeHtml(group.period)}</title><style>@page{size:A4 landscape;margin:8mm}body{font-family:"Times New Roman",serif;color:#111;margin:0}table{width:100%;border-collapse:collapse;table-layout:fixed}td,th{border:1px solid #111;padding:4px;text-align:center;vertical-align:middle;font-size:10.5pt;line-height:1.1}.company{width:31%;font-weight:bold;line-height:1.12}.title{width:44%;font-weight:bold;line-height:1.25}.meta{width:25%;text-align:left;vertical-align:top}.left{text-align:left}.blank-row td{height:21px}@media print{button{display:none}}</style></head><body><table><tbody><tr><td class="company" rowspan="2">AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.<br>24-335 ŁAZISKA,<br>KOLONIA ŁAZISKA 30<br>NIP: 7171839598</td><td class="title">Karta K07 - Karta kontroli stanu sita na linii do przerobu na pulpę (CCP1)</td><td class="meta"><b>Rok:</b> ${escapeHtml(year)}<br><b>Miesiąc:</b> ${escapeHtml(month)}<br><b>Strona:</b> 1 z 1</td></tr><tr><td style="font-size:9.5pt;text-align:left;padding:4px 8px">Godzina (kontrolę należy przeprowadzać przed i po zakończeniu procesu rozdrabniania)</td><td class="meta" style="text-align:center;vertical-align:middle">Wersja I/2024</td></tr></tbody></table><table><thead><tr><th>Data</th><th>Godzina</th><th>Rodzaj przerabianego surowca</th><th>Produkowany numer partii</th><th>Stan sita<br>(P/N)*</th><th>Podpis kontrolującego</th></tr></thead><tbody>${rows}${blanks}</tbody></table><script>window.onload=function(){setTimeout(function(){window.focus();window.print()},700)}</script></body></html>`
}

export function buildManualMonthlyHtml(group, escapeHtml, config) {
  const docs = group.docs || []
  const year = (group.period || docs[0]?.document_date || '').slice(0, 4)
  const month = (group.period || docs[0]?.document_date || '').slice(5, 7)
  const head = config.columns.map(c => `<th>${escapeHtml(c.label)}</th>`).join('')
  const rows = docs.map((doc, i) => {
    const cells = config.columns.map(c => `<td>${escapeHtml(String(c.value(doc, i) ?? ''))}</td>`).join('')
    return `<tr>${cells}</tr>`
  }).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(config.code)} ${escapeHtml(group.period)}</title><style>@page{size:A4 landscape;margin:8mm}body{font-family:"Times New Roman",serif;color:#111;margin:0}table{width:100%;border-collapse:collapse}td,th{border:1px solid #111;padding:5px;text-align:center;font-size:10.5pt}.company{width:30%;font-weight:bold;text-align:left}.title{width:55%;font-weight:bold}.meta{width:15%;text-align:left}@media print{button{display:none}}</style></head><body><table><tbody><tr><td class="company">AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.<br>24-335 ŁAZISKA, KOLONIA ŁAZISKA 30<br>NIP: 7171839598</td><td class="title">${escapeHtml(config.title)}</td><td class="meta"><b>Rok:</b> ${escapeHtml(year)}<br><b>Miesiąc:</b> ${escapeHtml(month)}</td></tr></tbody></table><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table><script>window.onload=function(){setTimeout(function(){window.focus();window.print()},700)}</script></body></html>`
}

export const MANUAL_HACCP_FORMS = {
  'K04.1': {
    code: 'K04.1',
    title: 'Karta K04.1 - Karta kontroli parametrów magazynowania podczas transportu',
    columns: [
      { key: 'lp', label: 'Lp.', value: (_, i) => i + 1 },
      { key: 'document_date', label: 'Data', value: d => d.document_date || '' },
      { key: 'product_name', label: 'Produkt', value: d => d.product_name || '' },
      { key: 'lot_no', label: 'Nr partii', value: d => d.lot_no || '' },
      { key: 'temperatura_transport', label: 'Temperatura [°C]', value: d => d.data?.temperatura_transport || '' },
      { key: 'stan_opakowania', label: 'Stan opakowania (P/N)', value: d => normalizePn(d.data?.stan_opakowania || 'P') },
      { key: 'uwagi', label: 'Uwagi', value: d => d.data?.uwagi || '' },
      { key: 'podpis', label: 'Podpis', value: d => d.signed_by_operator || d.data?.podpis || '' }
    ],
    fields: [
      { key: 'document_date', label: 'Data', type: 'date', required: true },
      { key: 'product_name', label: 'Produkt', type: 'text', required: true },
      { key: 'lot_no', label: 'Nr partii', type: 'text', required: true },
      { key: 'temperatura_transport', label: 'Temperatura transport [°C]', type: 'text', data: true },
      { key: 'stan_opakowania', label: 'Stan opakowania', type: 'pn', data: true },
      { key: 'uwagi', label: 'Uwagi', type: 'text', data: true },
      { key: 'signed_by', label: 'Podpis', type: 'employee', data: false }
    ]
  },
  K05: {
    code: 'K05',
    title: 'Karta K05 - Karta towarów wycofanych',
    columns: [
      { key: 'lp', label: 'Lp.', value: (_, i) => i + 1 },
      { key: 'document_date', label: 'Data', value: d => d.document_date || '' },
      { key: 'product_name', label: 'Nazwa produktu', value: d => d.product_name || '' },
      { key: 'lot_no', label: 'Nr partii', value: d => d.lot_no || '' },
      { key: 'qty', label: 'Ilość [kg]', value: d => d.qty ?? '' },
      { key: 'powod', label: 'Powód wycofania', value: d => d.data?.powod_wycofania || '' },
      { key: 'dzialanie', label: 'Działanie podjęte', value: d => d.data?.dzialanie || '' },
      { key: 'podpis', label: 'Podpis', value: d => d.signed_by_operator || '' }
    ],
    fields: [
      { key: 'document_date', label: 'Data', type: 'date', required: true },
      { key: 'product_name', label: 'Nazwa produktu', type: 'text', required: true },
      { key: 'lot_no', label: 'Nr partii', type: 'text', required: true },
      { key: 'qty', label: 'Ilość [kg]', type: 'number', required: true },
      { key: 'powod_wycofania', label: 'Powód wycofania', type: 'text', data: true, required: true },
      { key: 'dzialanie', label: 'Działanie podjęte', type: 'text', data: true },
      { key: 'signed_by', label: 'Podpis', type: 'employee', data: false }
    ]
  },
  K06: {
    code: 'K06',
    title: 'Karta K06 - Karta oceny jakości gotowego produktu',
    columns: [
      { key: 'document_date', label: 'Data', value: d => d.document_date || '' },
      { key: 'product_name', label: 'Nazwa towaru', value: d => d.product_name || '' },
      { key: 'lot_no', label: 'Numer partii', value: d => d.lot_no || '' },
      { key: 'barwa', label: 'Barwa (P/N)', value: d => normalizePn(normalizeK06Data(d.data || {}).barwa) },
      { key: 'zapach', label: 'Zapach (P/N)', value: d => normalizePn(normalizeK06Data(d.data || {}).zapach) },
      { key: 'twardosc_jablko', label: 'Twardość (jabłko) (P/N)', value: d => normalizePn(normalizeK06Data(d.data || {}).twardosc_jablko) },
      { key: 'brak_plesni', label: 'Brak oznak pleśni (P/N)', value: d => normalizePn(normalizeK06Data(d.data || {}).brak_plesni) },
      { key: 'podpis', label: 'Podpis kontrolującego', value: d => d.signed_by_operator || normalizeK06Data(d.data || {}).podpis || '' }
    ],
    fields: [
      { key: 'document_date', label: 'Data', type: 'date', required: true },
      { key: 'product_name', label: 'Nazwa towaru', type: 'text', required: true },
      { key: 'lot_no', label: 'Numer partii', type: 'text', required: true },
      { key: 'barwa', label: 'Barwa', type: 'pn', data: true },
      { key: 'zapach', label: 'Zapach', type: 'pn', data: true },
      { key: 'twardosc_jablko', label: 'Twardość (jabłko)', type: 'pn', data: true },
      { key: 'brak_plesni', label: 'Brak oznak pleśni', type: 'pn', data: true },
      { key: 'signed_by', label: 'Podpis kontrolującego', type: 'employee', data: false }
    ]
  },
  K07: {
    code: 'K07',
    title: 'Karta K07 - Karta kontroli stanu sita na linii do przerobu na pulpę (CCP1)',
    columns: [
      { key: 'document_date', label: 'Data', value: d => d.document_date || '' },
      { key: 'kontrola_etap', label: 'Etap', value: d => normalizeK07Data(d.data || {}, d).kontrola_label || normalizeK07Data(d.data || {}, d).kontrola_etap || '' },
      { key: 'godzina', label: 'Godzina', value: d => normalizeK07Data(d.data || {}, d).godzina || '' },
      { key: 'surowiec', label: 'Rodzaj przerabianego surowca', value: d => normalizeK07Data(d.data || {}, d).surowiec || d.product_name || '' },
      { key: 'numer_partii', label: 'Produkowany numer partii', value: d => normalizeK07Data(d.data || {}, d).numer_partii || d.lot_no || '' },
      { key: 'stan_sita', label: 'Stan sita (P/N)', value: d => normalizePn(normalizeK07Data(d.data || {}, d).stan_sita) },
      { key: 'podpis', label: 'Podpis kontrolującego', value: d => d.signed_by_operator || normalizeK07Data(d.data || {}, d).podpis_kontrolujacego || '' }
    ],
    fields: [
      { key: 'document_date', label: 'Data przerobu', type: 'date', required: true },
      { key: 'kontrola_etap', label: 'Etap kontroli', type: 'select', data: true, required: true, options: [{ value: 'przed', label: 'Przed przerobem' }, { value: 'po', label: 'Po przerobie' }] },
      { key: 'godzina', label: 'Godzina', type: 'text', data: true, required: false },
      { key: 'surowiec', label: 'Rodzaj przerabianego surowca', type: 'text', data: true, required: true },
      { key: 'numer_partii', label: 'Produkowany numer partii', type: 'text', data: true, required: true },
      { key: 'stan_sita', label: 'Stan sita', type: 'pn', data: true },
      { key: 'signed_by', label: 'Podpis kontrolującego', type: 'employee', data: false }
    ]
  }
}

export function buildManualExcelRows(group, config) {
  const docs = group.docs || []
  const rows = []
  rows.push(['AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.'])
  rows.push([config.title, '', '', `Okres: ${group.period || ''}`])
  rows.push(config.columns.map(c => c.label))
  docs.forEach((doc, i) => rows.push(config.columns.map(c => c.value(doc, i))))
  return rows
}

export function buildK04ExcelRows(group) {
  const docs = group.docs || []
  const rows = []
  rows.push(['AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.'])
  rows.push(['Karta K04 - magazynowanie produktów gotowych (CP3)', '', '', '', '', `Okres: ${group.period || ''} · ${group.chamber || ''} · ${group.product || ''}`])
  rows.push(['Data', 'Godzina', 'Temperatura nr 1 [°C]', 'Temperatura nr 2 [°C]', 'Podpis', 'Uwagi (P/N)'])
  for (const doc of docs) {
    const d = doc.data || {}
    rows.push([doc.document_date || '', d.godzina || '', d.temperatura_chlodnia_1 || '', d.temperatura_chlodnia_2 || '', doc.signed_by_operator || d.podpis_kontrolujacego || '', normalizePn(d.uwagi || 'P')])
  }
  return rows
}

export function buildK06ExcelRows(group) {
  const docs = group.docs || []
  const rows = []
  rows.push(['AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.'])
  rows.push(['Karta K06 - ocena jakości gotowego produktu', '', '', '', '', '', '', `Okres: ${group.period || ''}`])
  rows.push(['Data', 'Nazwa towaru', 'Numer partii', 'Barwa (P/N)', 'Zapach (P/N)', 'Twardość (jabłko) (P/N)', 'Brak oznak pleśni (P/N)', 'Podpis kontrolującego'])
  for (const doc of docs) {
    const d = normalizeK06Data(doc.data || {})
    rows.push([doc.document_date || '', doc.product_name || '', doc.lot_no || '', normalizePn(d.barwa), normalizePn(d.zapach), normalizePn(d.twardosc_jablko), normalizePn(d.brak_plesni), doc.signed_by_operator || d.podpis || ''])
  }
  return rows
}

export function buildK07ExcelRows(group) {
  const docs = group.docs || []
  const rows = []
  rows.push(['AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.'])
  rows.push(['Karta K07 - kontrola sita CCP1', '', '', '', '', `Okres: ${group.period || ''}`])
  rows.push(['Data', 'Godzina', 'Rodzaj przerabianego surowca', 'Produkowany numer partii', 'Stan sita (P/N)', 'Podpis kontrolującego'])
  for (const doc of docs) {
    const d = normalizeK07Data(doc.data || {}, doc)
    rows.push([doc.document_date || '', d.godzina || '12:00', d.surowiec || '', d.numer_partii || '', normalizePn(d.stan_sita || 'P'), doc.signed_by_operator || d.podpis_kontrolujacego || ''])
  }
  return rows
}
