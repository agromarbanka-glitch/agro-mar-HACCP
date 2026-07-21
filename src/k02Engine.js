/**
 * K02 – karta kontroli parametrów magazynowania surowców (CP2).
 * Wpisy dzienne: auto z K01 (dni przyjęć) lub ręczna kartoteka miesięczna w haccp_documents.
 * Bez lot_id – nie wpływa na FIFO.
 */
import { normalizePn } from './haccpFormsEngine'
import { calendarDaysInMonth } from './r13Engine'

export const K02_ENGINE_VERSION = '1.0'

export function k02TempForProducts(productNames = []) {
  const names = (productNames || []).map(n => String(n || '').toLowerCase()).join(' ')
  if (names.includes('malina')) return '1'
  return '2'
}

export function normalizeK02Data(data = {}, signedBy = '') {
  const d = data || {}
  return {
    godzina: d.godzina ?? '09:15',
    temperatura_chlodnia_1: d.temperatura_chlodnia_1 ?? '2',
    temperatura_chlodnia_2: d.temperatura_chlodnia_2 ?? '2',
    podpis_kontrolujacego: signedBy || d.podpis_kontrolujacego || '',
    uwagi: d.uwagi === 'N' ? 'N' : (d.uwagi || 'P'),
    produkty: d.produkty || '',
    month_key: d.month_key || '',
    sort_order: Number(d.sort_order || 0),
    is_day_off: Boolean(d.is_day_off),
    manual_month: Boolean(d.manual_month),
    auto_source: d.auto_source || ''
  }
}

export function k01DocsByDay(k01Docs) {
  const byDay = new Map()
  for (const d of k01Docs || []) {
    const day = String(d.document_date || '').slice(0, 10)
    if (!day) continue
    if (!byDay.has(day)) byDay.set(day, [])
    byDay.get(day).push(d)
  }
  return byDay
}

/** Jeden wpis K02 na dzień z przyjęć K01 (syntetyczny, bez zapisu w bazie). */
export function buildSyntheticK02FromK01(k01Docs, overrides = {}) {
  const byDay = k01DocsByDay(k01Docs)
  return Array.from(byDay.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([day, docs]) => {
    const products = Array.from(new Set(docs.map(d => d.product_name || '').filter(Boolean)))
    const temp = k02TempForProducts(products)
    const id = `K02-${day}`
    const ov = overrides[id] || {}
    return {
      id,
      synthetic: true,
      document_type: 'K02',
      document_date: day,
      product_name: 'CP2 – magazyn surowca',
      lot_no: '',
      supplier_name: '',
      document_no: `K02/${day}`,
      chamber_code: 'CP2',
      qty: docs.reduce((sum, d) => sum + (Number(d.qty) || 0), 0),
      status: ov.status ?? 'P',
      data: {
        godzina: Object.prototype.hasOwnProperty.call(ov, 'godzina') ? ov.godzina : '09:15',
        temperatura_chlodnia_1: Object.prototype.hasOwnProperty.call(ov, 'temperatura_chlodnia_1') ? ov.temperatura_chlodnia_1 : temp,
        temperatura_chlodnia_2: Object.prototype.hasOwnProperty.call(ov, 'temperatura_chlodnia_2') ? ov.temperatura_chlodnia_2 : temp,
        podpis_kontrolujacego: Object.prototype.hasOwnProperty.call(ov, 'podpis_kontrolujacego') ? ov.podpis_kontrolujacego : '',
        uwagi: Object.prototype.hasOwnProperty.call(ov, 'uwagi') ? ov.uwagi : 'P',
        produkty: products.join(', '),
        auto_source: 'k01'
      },
      signed_by_operator: Object.prototype.hasOwnProperty.call(ov, 'podpis_kontrolujacego') ? ov.podpis_kontrolujacego : '',
      signed_by_admin: '',
      document_version: 'I/2024',
      created_at: day
    }
  })
}

/** Pełna kartoteka miesięczna – wszystkie dni kalendarza (zapis w haccp_documents, lot_id = null). */
export function buildK02MonthPayloads(yearMonth, options = {}) {
  const { signedBy = '', k01ByDay = new Map() } = options
  return calendarDaysInMonth(yearMonth).map((day, i) => {
    const sunday = day.isSunday
    const k01Day = k01ByDay.get(day.date) || []
    const products = Array.from(new Set(k01Day.map(d => d.product_name || '').filter(Boolean)))
    const temp = k02TempForProducts(products)
    const data = normalizeK02Data({
      month_key: yearMonth,
      sort_order: i + 1,
      is_day_off: sunday,
      godzina: sunday ? '' : '09:15',
      temperatura_chlodnia_1: sunday ? '' : temp,
      temperatura_chlodnia_2: sunday ? '' : temp,
      podpis_kontrolujacego: sunday ? '' : (signedBy || ''),
      uwagi: sunday ? '' : 'P',
      produkty: products.join(', '),
      manual_month: true,
      auto_source: k01Day.length ? 'manual_month+k01' : 'manual_month'
    }, signedBy)
    return {
      document_type: 'K02',
      lot_id: null,
      operation_id: null,
      document_date: day.date,
      document_no: `K02/${yearMonth}/${String(i + 1).padStart(2, '0')}`,
      product_name: 'CP2 – magazyn surowca',
      lot_no: null,
      supplier_name: null,
      chamber_code: 'CP2',
      qty: k01Day.reduce((sum, d) => sum + (Number(d.qty) || 0), 0),
      status: 'P',
      data,
      signed_by_operator: sunday ? null : (signedBy || null),
      document_version: 'I/2024',
      updated_at: new Date().toISOString()
    }
  })
}

function applyK02Overrides(doc, overrides = {}) {
  if (!doc?.id) return doc
  const ov = overrides[doc.id] || {}
  if (!Object.keys(ov).length) return doc
  const data = {
    ...(doc.data || {}),
    ...ov,
    uwagi: Object.prototype.hasOwnProperty.call(ov, 'uwagi') ? ov.uwagi : (doc.data?.uwagi ?? doc.status ?? 'P')
  }
  return {
    ...doc,
    data,
    status: Object.prototype.hasOwnProperty.call(ov, 'uwagi') ? normalizePn(ov.uwagi) : (ov.status ?? doc.status ?? 'P'),
    signed_by_operator: Object.prototype.hasOwnProperty.call(ov, 'podpis_kontrolujacego')
      ? ov.podpis_kontrolujacego
      : doc.signed_by_operator
  }
}

/**
 * Łączy wpisy z bazy (ręczna kartoteka) z auto z K01.
 * Dla tego samego dnia: wpis z bazy ma pierwszeństwo.
 */
export function mergeK02DisplayDocs(haccpDocs, k01Docs, overrides = {}) {
  const synthetic = buildSyntheticK02FromK01(k01Docs, overrides)
  const byDate = new Map()
  for (const doc of synthetic) {
    byDate.set(String(doc.document_date).slice(0, 10), doc)
  }
  for (const doc of (haccpDocs || []).filter(d => d.document_type === 'K02' && d.document_date)) {
    const day = String(doc.document_date).slice(0, 10)
    byDate.set(day, applyK02Overrides({ ...doc, synthetic: false }, overrides))
  }
  return Array.from(byDate.values()).sort((a, b) =>
    String(a.document_date || '').localeCompare(String(b.document_date || ''))
  )
}

export function k02GroupHasManualMonth(docs = []) {
  return docs.some(d => d.data?.manual_month || d.data?.month_key)
}

export function isSyntheticK02Doc(doc) {
  if (!doc || doc.document_type !== 'K02') return false
  if (doc.synthetic) return true
  const id = String(doc.id || '')
  if (id.startsWith('K02-manual-')) return true
  return id.startsWith('K02-') && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
}

export function buildManualK02BlankDoc(period, manualId, seed = {}) {
  const date = String(seed.document_date || `${period}-01`).slice(0, 10)
  const id = manualId || `K02-manual-${period}-${Date.now()}`
  return {
    id,
    synthetic: true,
    document_type: 'K02',
    document_date: date,
    product_name: 'CP2 – magazyn surowca',
    lot_no: '',
    document_no: `K02/reczny/${date}`,
    chamber_code: 'CP2',
    qty: 0,
    status: 'P',
    data: normalizeK02Data({
      godzina: seed.godzina || '',
      temperatura_chlodnia_1: seed.temperatura_chlodnia_1 ?? '',
      temperatura_chlodnia_2: seed.temperatura_chlodnia_2 ?? '',
      podpis_kontrolujacego: seed.podpis_kontrolujacego || '',
      uwagi: seed.uwagi || 'P',
      month_key: period,
      auto_source: 'manual'
    }),
    signed_by_operator: seed.podpis_kontrolujacego || '',
    document_version: 'I/2024',
    created_at: date
  }
}

export function buildK02InsertPayload(doc) {
  const d = normalizeK02Data(doc.data || {}, doc.signed_by_operator)
  if (!d.month_key && doc.document_date) d.month_key = String(doc.document_date).slice(0, 7)
  return {
    document_type: 'K02',
    lot_id: null,
    operation_id: null,
    document_date: doc.document_date,
    product_name: doc.product_name || 'CP2 – magazyn surowca',
    lot_no: null,
    document_no: doc.document_no || `K02/${doc.document_date || 'brak'}`,
    chamber_code: doc.chamber_code || 'CP2',
    qty: doc.qty || 0,
    status: doc.status || (normalizePn(d.uwagi) === 'N' ? 'N' : 'P'),
    data: d,
    signed_by_operator: doc.signed_by_operator || d.podpis_kontrolujacego || null,
    document_version: 'I/2024'
  }
}
