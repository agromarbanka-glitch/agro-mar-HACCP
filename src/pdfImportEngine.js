/**
 * Import PDF → pola formularzy (K01.1, W04, W05)
 */
import { getDocument } from 'pdfjs-dist'

export const PDF_IMPORT_VERSION = '1.3'

export const PDF_IMPORT_DOC_TYPES = {
  'K01.1': { label: 'faktura zakupowa', accept: '.pdf,application/pdf' },
  W04: { label: 'karta / atest środka czystości', accept: '.pdf,application/pdf' },
  W05: { label: 'raport laboratoryjny', accept: '.pdf,application/pdf' }
}

const PDFJS_VER = '4.4.168'
const AGRO_MAR_NIP = '7171839598'

function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Odrzuca losowy „śmieć” z błędnego kodowania PDF (np. i s*5 s C) ET…) */
export function isReadableName(text) {
  const s = String(text || '').trim()
  if (s.length < 3) return false
  const letters = (s.match(/[\p{L}]/gu) || []).length
  const digits = (s.match(/\d/g) || []).length
  const weird = (s.match(/[^0-9a-zA-Z\sąćęłńóśźżĄĆĘŁŃÓŚŹŻ.,\-()/+%°]/gu) || []).length
  if (letters < 2) return false
  if (weird / s.length > 0.12) return false
  if (letters / s.length < 0.35 && digits / s.length < 0.5) return false
  return true
}

export function polishDateToIso(value) {
  const text = String(value || '').trim()
  const m = text.match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/)
  if (!m) return ''
  const d = Number(m[1])
  const mo = Number(m[2])
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return ''
  return `${m[3]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function mergeTextItems(items) {
  if (!items?.length) return ''
  const sorted = [...items].sort((a, b) => {
    const yA = a.transform?.[5] ?? 0
    const yB = b.transform?.[5] ?? 0
    if (Math.abs(yA - yB) > 3) return yB - yA
    return (a.transform?.[4] ?? 0) - (b.transform?.[4] ?? 0)
  })
  const lines = []
  let bucket = []
  let lastY = null
  let lastEndX = null
  for (const item of sorted) {
    const str = String(item.str || '').trim()
    if (!str) continue
    const x = item.transform?.[4] ?? 0
    const y = item.transform?.[5] ?? 0
    const w = item.width ?? str.length * 5
    if (lastY !== null && Math.abs(y - lastY) > 3) {
      if (bucket.length) lines.push(bucket.join(''))
      bucket = []
      lastEndX = null
    }
    if (lastEndX !== null && x - lastEndX > 10) bucket.push(' ')
    bucket.push(str)
    lastEndX = x + w
    lastY = y
  }
  if (bucket.length) lines.push(bucket.join(''))
  return lines.join('\n')
}

function groupItemsByRow(items, tolerance = 4) {
  const withPos = (items || [])
    .filter(i => String(i.str || '').trim())
    .map(i => ({
      str: String(i.str).trim(),
      x: i.transform?.[4] ?? 0,
      y: i.transform?.[5] ?? 0,
      w: i.width ?? String(i.str).length * 5
    }))
    .sort((a, b) => {
      if (Math.abs(a.y - b.y) > tolerance) return b.y - a.y
      return a.x - b.x
    })
  const rows = []
  let row = []
  let lastY = null
  for (const item of withPos) {
    if (lastY !== null && Math.abs(item.y - lastY) > tolerance) {
      if (row.length) rows.push(row)
      row = []
    }
    row.push(item)
    lastY = item.y
  }
  if (row.length) rows.push(row)
  return rows
}

const UNIT_RE = /^(szt\.?|kg|g|opak\.?|kpl\.?|rol\.?|mb|m2|m²|l|litr\.?|pcs)$/i

function parseQtyFromRow(sorted, startIdx) {
  for (let i = startIdx; i < sorted.length; i++) {
    const s = sorted[i].str
    const combined = sorted.slice(i, i + 3).map(x => x.str).join(' ')
    const mCombined = combined.match(/(\d+(?:[\s ]?\d{3})*(?:[,.]\d+)?)\s*\(?(szt\.?|kg|g|opak\.?|kpl\.?|rol\.?|mb|m2|m²|l)\.?\)?/i)
    if (mCombined) {
      return {
        qty: `${mCombined[1].replace(/\s/g, '').replace(',', '.')} ${mCombined[2].replace(/\./g, '')}`,
        endIdx: i + 1
      }
    }
    if (/^\d+(?:[,.]\d+)?$/.test(s) && UNIT_RE.test(sorted[i + 1]?.str || '')) {
      return {
        qty: `${s.replace(',', '.')} ${sorted[i + 1].str.replace(/\./g, '')}`,
        endIdx: i + 2
      }
    }
    if (/^\d{2,4}$/.test(s) && sorted[i + 1] && /^\d+(?:[,.]\d+)?$/.test(sorted[i + 1].str)) {
      i++
      continue
    }
    if (/^\d+[,.]\d{2}$/.test(s) || /^23\s*%?$/.test(s)) break
  }
  return { qty: '', endIdx: startIdx }
}

function parseInvoiceLineItemsFromPositions(allItems) {
  const rows = groupItemsByRow(allItems, 4)
  const items = []
  for (const row of rows) {
    const sorted = [...row].sort((a, b) => a.x - b.x)
    if (!sorted.length || !/^\d{1,3}$/.test(sorted[0].str)) continue
    const lp = Number(sorted[0].str)
    if (lp < 1 || lp > 300) continue

    const nameParts = []
    let i = 1
    while (i < sorted.length) {
      const s = sorted[i].str
      if (/^\d+(?:[\s ]?\d{3})*(?:[,.]\d+)?$/.test(s.replace(/\s/g, ''))) {
        const peek = sorted.slice(i, i + 2).map(x => x.str).join(' ')
        if (/\(?(szt|kg|g|opak|kpl|rol|mb|m2|m²|l)\)?/i.test(peek)) break
        if (/^\d{2,4}$/.test(s) && nameParts.length) {
          i++
          continue
        }
        break
      }
      if (/^\d+[,.]\d{2}$/.test(s) || /^(23|8|5|0)\s*%?$/.test(s)) break
      if (SKIP_ROW.test(normalizeText(s))) break
      nameParts.push(s)
      i++
    }

    const { qty } = parseQtyFromRow(sorted, i)
    const name = nameParts.join(' ').replace(/\s{2,}/g, ' ').trim()
    if (!isReadableName(name)) continue
    if (SKIP_ROW.test(normalizeText(name))) continue
    items.push({ name: name.slice(0, 120), qty })
  }
  return items
}

function decodePdfStreamFallback(buffer) {
  const raw = new TextDecoder('latin1').decode(buffer)
  const chunks = []
  const tjRegex = /\(([^()\\]{1,300})\)\s*Tj/g
  let m
  while ((m = tjRegex.exec(raw)) !== null) {
    const t = m[1]
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '')
      .replace(/\\\(/g, '(')
      .replace(/\\\)/g, ')')
      .replace(/\\\\/g, '\\')
    if (t.trim()) chunks.push(t.trim())
  }
  if (chunks.length > 20) return chunks.join('\n')
  return raw
    .replace(/\(([^()]{1,120})\)\s*Tj/g, '\n$1\n')
    .replace(/[^\x09\x0A\x0D\x20-\x7EĄĆĘŁŃÓŚŹŻąćęłńóśźż]+/g, ' ')
}

async function loadPdfDocument(buffer) {
  return getDocument({
    data: buffer,
    disableWorker: true,
    useWorkerFetch: false,
    isEvalSupported: false,
    cMapUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VER}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VER}/standard_fonts/`
  }).promise
}

export async function extractPdfData(file) {
  const buffer = await file.arrayBuffer()
  const itemsByPage = []
  try {
    const pdf = await loadPdfDocument(buffer)
    const parts = []
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      const page = await pdf.getPage(pageNo)
      const content = await page.getTextContent()
      itemsByPage.push(content.items || [])
      parts.push(mergeTextItems(content.items))
    }
    const text = parts.join('\n\n').trim()
    if (text.replace(/\s/g, '').length >= 20) return { text, itemsByPage }
  } catch {
    /* fallback poniżej */
  }
  return { text: decodePdfStreamFallback(buffer), itemsByPage: [] }
}

export async function extractPdfText(file) {
  const { text } = await extractPdfData(file)
  return text
}

function expandCollapsedText(text) {
  let t = String(text || '').replace(/\r/g, '')
  if (t.split('\n').filter(l => l.trim()).length >= 8) return t
  return t
    .replace(/\s+(Sprzedawca|Nabywca|Odbiorca|Wystawca|Dostawca|Lp\.|Faktura\s*VAT|Faktura|Data wystawienia|Data sprzedaży|Data dostawy|NIP|AGRO-MAR|Nr\s*faktury)/gi, '\n$1')
    .replace(/\s+(Badany parametr|Parametr|Wynik|Nr\s*raportu|Nr\s*protoko|Laboratorium|AGROLAB|Oświadczenie| próbk)/gi, '\n$1')
    .replace(/\s+(Nazwa\s+(?:towaru|produktu|środka|preparatu)|Producent|Ważne\s+do|Data\s+ważności)/gi, '\n$1')
}

function toLines(text) {
  return expandCollapsedText(text)
    .split('\n')
    .map(l => l.replace(/\s{2,}/g, ' ').trim())
    .filter(Boolean)
}

function labelValue(lines, labels) {
  for (const line of lines) {
    for (const label of labels) {
      const re = new RegExp(`^${label}\\s*[:\\-]\\s*(.+)$`, 'i')
      const m = line.match(re)
      if (m?.[1]?.trim()) return m[1].trim().slice(0, 160)
    }
  }
  return ''
}

function firstLineAfter(lines, labels, skip = []) {
  for (let i = 0; i < lines.length; i++) {
    const n = normalizeText(lines[i])
    if (!labels.some(l => n.includes(normalizeText(l)))) continue
    for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
      const c = lines[j]
      if (!c || c.length < 2) continue
      const cn = normalizeText(c)
      if (skip.some(s => s.test(cn))) continue
      if (/^[0-9\s,./-]+$/.test(c)) continue
      if (/^nip\s*[:.]?\s*\d/i.test(c)) continue
      const cleaned = c.replace(/^(nazwa|firma|sprzedawca|dostawca|wystawca)\s*[:\-]?\s*/i, '').trim().slice(0, 160)
      if (isReadableName(cleaned)) return cleaned
    }
  }
  return ''
}

function invoiceFromFileName(fileName = '') {
  const base = String(fileName).replace(/\.pdf$/i, '')
  const patterns = [
    /faktura[-_\s]*fs[-_\s]*(\d+)[-_\s](\d{2})[-_\s](\d{4})/i,
    /fs[-_\s]*(\d+)[-_\s](\d{2})[-_\s](\d{4})/i,
    /fv[-_\s]*(\d+)[-_\s](\d{2})[-_\s](\d{4})/i
  ]
  for (const re of patterns) {
    const m = base.match(re)
    if (m) return `FS ${m[1]}/${m[2]}/${m[3]}`
  }
  return ''
}

function findInvoiceNumber(text, fileName = '') {
  const patterns = [
    /faktura\s*(?:vat\s*)?(?:numer|nr\.?)\s*(?:FS|FV)?\s*([A-Z]{0,3}\s*\d[\d/.\-\s]{2,40})/i,
    /(?:faktura\s*(?:vat)?|fv|nr\s*faktury|numer\s*faktury)\s*(?:nr|numer)?\s*[:#.\-]?\s*([A-Z0-9][A-Z0-9/_.\-\s]{2,40})/i,
    /\b(FS\s*\d+\/\d+\/\d{4})\b/i,
    /\b(FV[\s\/.\-][A-Z0-9/_.\-]{2,40})\b/i,
    /\b([0-9]{1,4}\/[0-9]{1,6}\/[0-9]{4})\b/
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (m?.[1]) return m[1].replace(/\s{2,}/g, ' ').replace(/[;,.]\s*$/g, '').trim()
  }
  return invoiceFromFileName(fileName)
}

function findDate(text, labels) {
  for (const label of labels) {
    const rePl = new RegExp(`${label}[\\s\\S]{0,50}?(\\d{1,2}[.\\-/]\\d{1,2}[.\\-/]\\d{4})`, 'i')
    const mPl = text.match(rePl)
    const isoPl = polishDateToIso(mPl?.[1])
    if (isoPl) return isoPl
    const reIso = new RegExp(`${label}[\\s\\S]{0,50}?(\\d{4}-\\d{2}-\\d{2})`, 'i')
    const mIso = text.match(reIso)
    if (mIso?.[1]) return mIso[1]
  }
  const cityIso = text.match(/,\s*(\d{4}-\d{2}-\d{2})\b/)
  if (cityIso?.[1]) return cityIso[1]
  const allIso = [...text.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)]
  for (const m of allIso) {
    const d = m[1]
    if (d >= '2020-01-01' && d <= '2035-12-31') return d
  }
  const all = [...text.matchAll(/(\d{1,2}[.\-/]\d{1,2}[.\-/](20\d{2}))/g)]
  for (const m of all) {
    const iso = polishDateToIso(m[1])
    if (iso) return iso
  }
  return ''
}

function findSeller(lines, text) {
  const skip = [/nip/, /regon/, /konto/, /bank/, /tel/, /fax/, /www/, /agro-mar/, /7171839598/, /nabywca/, /odbiorca/, /kolonia laziska/]
  let v = labelValue(lines, ['Sprzedawca', 'Dostawca', 'Wystawca'])
  if (v && isReadableName(v) && !skip.some(s => s.test(normalizeText(v)))) return v.slice(0, 120)

  v = firstLineAfter(lines, ['Sprzedawca', 'Dostawca', 'Wystawca', 'Sprzedający'], skip)
  if (v) return v.slice(0, 120)

  const known = text.match(/\b(AGROTEX[^\n]{0,50})/i)?.[1]
  if (known && isReadableName(known.replace(/\s*Sp\.\s*z\s*o\.?\s*o\.?.*$/i, '').trim() || known)) {
    return known.replace(/\s{2,}/g, ' ').trim().slice(0, 120)
  }

  const nips = [...text.matchAll(/NIP\s*[:\s]*(\d{10}|\d{3}[-\s]?\d{3}[-\s]?\d{2}[-\s]?\d{2})/gi)]
  for (const m of nips) {
    const nip = m[1].replace(/\D/g, '')
    if (nip === AGRO_MAR_NIP) continue
    const idx = text.indexOf(m[0])
    const ctx = text.slice(Math.max(0, idx - 320), idx)
    const ctxLines = toLines(ctx)
    for (let i = ctxLines.length - 1; i >= 0; i--) {
      const line = ctxLines[i]
      if (line.length >= 3 && line.length <= 100 && isReadableName(line)
        && !/^(ul\.|tel|bank|nip|regon|kruszynska|wloclawek)/i.test(line)
        && !/^\d+$/.test(line)) {
        return line.slice(0, 120)
      }
    }
  }
  return ''
}

const QTY_RE = /(\d+(?:[\s ]?\d{3})*(?:[,.]\d+)?)\s*(?:\(?)(szt\.?|kg|g|opak\.?|rol\.?|mb|m2|m²|kpl\.?|pcs|l\b|litr\.?)(?:\)?)/i
const MATERIAL_RE = /(karton|worek|worki|skrzyn|beczk|etykiet|foli|opakow|palet|ta[sś]m|wiadr|pojemnik|nakr[eę]tk|butel|słoik|stretch|tektur|papier|regranulat|pokryw|sito|lin\b|taśm)/i
const SKIP_ROW = /(razem|suma|vat|netto|brutto|do zaplaty|wartosc|lp\.|nazwa towaru|j\.?\s*m\.?|pkwi|gtu|rabat|transport|w tym|gtin)/i

function parseInvoiceLineItems(lines, flatText) {
  const items = []
  const rowRes = [
    /(?:^|\n)\s*(\d{1,3})[\s.)-]+(.{4,120}?)\s+(\d+(?:[\s ]?\d{3})*(?:[,.]\d+)?)\s*\(?(szt\.?|kg|g|opak\.?|kpl\.?|rol\.?|mb|m2|m²|l)\.?\)?/gi,
    /(?:^|\n)\s*(\d{1,3})\s+(.{4,120}?)\s+(\d+(?:[\s ]?\d{3})*(?:[,.]\d+)?)\s*(szt\.?|kg|g|opak\.?|kpl\.?)/gi
  ]
  for (const rowRe of rowRes) {
    let rm
    while ((rm = rowRe.exec(flatText)) !== null) {
      const name = rm[2].replace(/\s{2,}/g, ' ').replace(/\s+\d{2,4}\s+/g, ' ').trim()
      if (SKIP_ROW.test(normalizeText(name)) || !isReadableName(name)) continue
      items.push({
        name: name.slice(0, 120),
        qty: `${rm[3].replace(/\s/g, '').replace(',', '.')} ${rm[4].replace(/\./g, '')}`
      })
    }
    if (items.length) return items
  }

  for (const line of lines) {
    if (SKIP_ROW.test(line) || line.length < 4) continue
    const q = line.match(QTY_RE)
    if (!q && !MATERIAL_RE.test(line)) continue
    let name = line
      .replace(QTY_RE, '')
      .replace(/^\d+[\s.)-]+/, '')
      .replace(/\s+\d+[,.]\d{2}\s*$/, '')
      .trim()
    if (!isReadableName(name)) continue
    items.push({
      name: name.slice(0, 120),
      qty: q ? `${q[1].replace(/\s/g, '').replace(',', '.')} ${q[2].replace(/\./g, '')}` : ''
    })
  }
  return items
}

function dedupeLineItems(items) {
  const seen = new Set()
  return items.filter(it => {
    const k = normalizeText(it.name)
    if (!k || seen.has(k)) return false
    seen.add(k)
    return true
  })
}

export function parseK011Invoice(text, fileName = '', itemsByPage = []) {
  const flat = String(text || '')
  const lines = toLines(flat)
  const invoiceNo = findInvoiceNumber(flat, fileName)
  const deliveryDate = findDate(flat, ['data sprzedaży', 'data sprzedazy', 'data wystawienia', 'data dostawy', 'data dokumentu'])
  const supplier = findSeller(lines, flat)

  const flatItems = itemsByPage.flat()
  const fromPositions = flatItems.length ? parseInvoiceLineItemsFromPositions(flatItems) : []
  const fromText = parseInvoiceLineItems(lines, flat)
  const lineItems = dedupeLineItems([...fromPositions, ...fromText].filter(it => isReadableName(it.name)))

  const primary = lineItems[0] || {}

  let itemName = primary.name || ''
  if (!itemName) {
    const guess = lines.find(l => MATERIAL_RE.test(l) && l.length >= 4 && l.length <= 120 && !SKIP_ROW.test(l) && isReadableName(l))
    if (guess) itemName = guess.replace(/^\d+[\s.)-]+/, '').trim().slice(0, 120)
  }
  if (!itemName || !isReadableName(itemName)) {
    const lv = labelValue(lines, ['Nazwa towaru', 'Nazwa artykułu', 'Nazwa'])
    if (isReadableName(lv)) itemName = lv
    else itemName = ''
  }

  const supplierInvoice = [supplier, invoiceNo].filter(Boolean).join(' / ')
    || invoiceNo
    || supplier
    || invoiceFromFileName(fileName)
    || fileName.replace(/\.pdf$/i, '')

  return {
    deliveryDate,
    invoiceNo,
    supplier,
    itemName,
    qty: primary.qty || '',
    supplierInvoice,
    lineItems,
    textLength: flat.replace(/\s/g, '').length
  }
}

export function buildK011FormUpdates(parsed) {
  const updates = {}
  if (parsed.deliveryDate) updates.delivery_date = parsed.deliveryDate
  if (parsed.itemName && isReadableName(parsed.itemName)) updates.item_name = parsed.itemName
  if (parsed.supplierInvoice) updates.supplier_invoice = parsed.supplierInvoice
  if (parsed.qty) updates.qty = parsed.qty
  return updates
}

export function parseW04CleaningDoc(text, fileName = '') {
  const lines = toLines(text)
  const flat = String(text || '')
  const itemName = labelValue(lines, ['Nazwa produktu', 'Nazwa preparatu', 'Nazwa środka', 'Produkt', 'Nazwa'])
    || lines.find(l => /(dezynfek|czyszcz|detergent|środek|srodek|sanit|alkohol|chlor|pian)/i.test(l) && l.length <= 100 && isReadableName(l))?.slice(0, 120)
    || fileName.replace(/\.pdf$/i, '')
  const producer = labelValue(lines, ['Producent', 'Wytwórca', 'Dostawca', 'Importer'])
    || firstLineAfter(lines, ['Producent', 'Wytwórca'], [/nip/])
  const purpose = labelValue(lines, ['Przeznaczenie', 'Zastosowanie', 'Charakterystyka'])
  const validUntil = polishDateToIso(
    labelValue(lines, ['Data ważności', 'Ważne do', 'Termin ważności'])
    || (flat.match(/ważn[aey]\s+do\s*[:\-]?\s*(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{4})/i)?.[1])
  )
  const documentDate = findDate(flat, ['data wystawienia', 'data dokumentu', 'data']) || new Date().toISOString().slice(0, 10)
  const notes = labelValue(lines, ['Nr karty', 'Numer dokumentu', 'Batch', 'Seria']) || `PDF: ${fileName}`

  return { documentDate, itemName, producer, purpose, validUntil, approval: 'P', notes, textLength: flat.replace(/\s/g, '').length }
}

export function buildW04FormUpdates(parsed) {
  const u = {}
  if (parsed.documentDate) u.document_date = parsed.documentDate
  if (parsed.itemName) u.item_name = parsed.itemName
  if (parsed.producer) u.producer = parsed.producer
  if (parsed.purpose) u.purpose = parsed.purpose
  if (parsed.validUntil) u.valid_until = parsed.validUntil
  if (parsed.approval) u.approval = parsed.approval
  if (parsed.notes) u.notes = parsed.notes
  return u
}

const LAB_PARAMS = [
  ['pestycyd', 'Zawartość pestycydów'],
  ['patulin', 'Patulina'],
  ['patulina', 'Patulina'],
  ['pleśn', 'Pleśnie, drożdże'],
  ['plesni', 'Pleśnie, drożdże'],
  ['drożd', 'Pleśnie, drożdże'],
  ['drozd', 'Pleśnie, drożdże'],
  ['drobnoustro', 'Ogólna liczba drobnoustrojów'],
  ['mikrobi', 'Ogólna liczba drobnoustrojów'],
  ['salmonell', 'Salmonella'],
  ['e\\.\\s*coli', 'E. coli'],
  ['enterobacter', 'Enterobacteriaceae'],
  ['środowisk', 'Badania środowiskowe'],
  ['srodowisk', 'Badania środowiskowe']
]

const PRODUCT_HINTS = [
  ['jabłk', 'Jabłka'], ['jabl', 'Jabłka'],
  ['gruszk', 'Gruszki'],
  ['malin', 'Maliny / pulpa'], ['porzeczk', 'Porzeczki'],
  ['truskawk', 'Truskawki'],
  ['aroni', 'Aronia'], ['wiśni', 'Wiśnie'], ['wisni', 'Wiśnie'],
  ['środowisk', 'Badania środowiskowe'], ['srodowisk', 'Badania środowiskowe'],
  ['ręk', 'Badania środowiskowe – ręce'], ['rece', 'Badania środowiskowe – ręce']
]

export function parseW05LabReport(text, fileName = '') {
  const flat = String(text || '')

  let parameter = ''
  for (const [re, label] of LAB_PARAMS) {
    if (new RegExp(re, 'i').test(flat)) {
      parameter = label
      break
    }
  }
  const lines = toLines(flat)
  if (!parameter) parameter = labelValue(lines, ['Badany parametr', 'Parametr', 'Oznaczenie', 'Badanie']) || 'Badanie laboratoryjne'

  let productGroup = labelValue(lines, ['Nazwa próbki', 'Próbka', 'Produkt', 'Materiał', 'Oznaczenie próbki'])
  if (!productGroup) {
    for (const [re, label] of PRODUCT_HINTS) {
      if (new RegExp(re, 'i').test(flat)) {
        productGroup = label
        break
      }
    }
  }
  if (!productGroup) productGroup = fileName.replace(/\.pdf$/i, '').slice(0, 80)

  const documentDate = findDate(flat, ['data wydania', 'data badania', 'data wykonania', 'data raportu', 'data']) || new Date().toISOString().slice(0, 10)

  let resultPn = 'P'
  if (/(niezgodn|przekroczen|powyżej normy|powyzej normy|wynik niedopuszczaln)/i.test(flat)) resultPn = 'N'
  if (/(zgodn|wynik prawid|dopuszczaln|nie stwierdzono|brak wykrycia)/i.test(flat)) resultPn = 'P'

  const reportNo = labelValue(lines, ['Nr raportu', 'Numer raportu', 'Nr protokołu', 'Numer protokołu', 'Nr sprawozdania'])
    || (flat.match(/(?:raport|protok[oó]ł|sprawozdanie)\s*(?:nr|numer)?\s*[:#]?\s*([A-Z0-9/_.-]{3,40})/i)?.[1])
  const lab = /agrolab/i.test(flat) ? 'AGROLAB Polska Sp. z o.o.' : labelValue(lines, ['Laboratorium', 'Wykonał'])

  const notesParts = []
  if (reportNo) notesParts.push(`Nr raportu: ${reportNo}`)
  if (lab) notesParts.push(lab)
  notesParts.push(`Wynik: ${resultPn === 'P' ? 'zgodny' : 'niezgodny'}`)
  const notes = notesParts.join(' · ')

  return {
    documentDate,
    productGroup,
    parameter,
    frequency: 'wg harmonogramu W05',
    notes,
    resultPn,
    reportNo,
    lab,
    textLength: flat.replace(/\s/g, '').length
  }
}

export function buildW05FormUpdates(parsed) {
  const u = {}
  if (parsed.documentDate) u.document_date = parsed.documentDate
  if (parsed.productGroup) u.product_group = parsed.productGroup
  if (parsed.parameter) u.parameter = parsed.parameter
  if (parsed.frequency) u.frequency = parsed.frequency
  if (parsed.notes) u.notes = parsed.notes
  return u
}

export async function importPdfForDocType(docType, file) {
  const { text, itemsByPage } = await extractPdfData(file)
  if (docType === 'K01.1') {
    const parsed = parseK011Invoice(text, file.name, itemsByPage)
    return { text, parsed, updates: buildK011FormUpdates(parsed), lineItems: parsed.lineItems || [] }
  }
  if (docType === 'W04') {
    const parsed = parseW04CleaningDoc(text, file.name)
    return { text, parsed, updates: buildW04FormUpdates(parsed), lineItems: [] }
  }
  if (docType === 'W05') {
    const parsed = parseW05LabReport(text, file.name)
    return { text, parsed, updates: buildW05FormUpdates(parsed), lineItems: [] }
  }
  throw new Error(`Brak parsera PDF dla ${docType}`)
}

export const K011_PDF_IMPORT_VERSION = PDF_IMPORT_VERSION
export async function importK011FromPdfFile(file) {
  const r = await importPdfForDocType('K01.1', file)
  return { text: r.text, parsed: r.parsed, updates: r.updates }
}
export function parseInvoiceTextForK011(text, fileName = '') {
  return parseK011Invoice(text, fileName, [])
}
export function buildK011UpdatesFromParse(parsed) {
  return buildK011FormUpdates(parsed)
}
