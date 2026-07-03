/**
 * Zaawansowany parser faktur zakupowych → K01.1
 */
const AGRO_MAR_NIP = '7171839598'
const UNIT = String.raw`(?:szt\.?|kg|g|opak\.?|kpl\.?|rol\.?|mb|m2|m²|l)`
const SKIP_ROW = /(razem|suma|vat|netto|brutto|do zaplaty|wartosc|lp\.|nazwa towaru|j\.?\s*m\.?|pkwi|gtu|rabat|transport|w tym|gtin|cena netto)/i

function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isReadableName(text) {
  const s = String(text || '').trim()
  if (s.length < 2) return false
  const letters = (s.match(/[\p{L}]/gu) || []).length
  const weird = (s.match(/[^0-9a-zA-Z\sąćęłńóśźżĄĆĘŁŃÓŚŹŻ.,\-()/+%°]/gu) || []).length
  if (letters < 2 && s.length < 8) return false
  if (weird / s.length > 0.15) return false
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

function polishWordScore(text) {
  const s = String(text || '')
  const words = s.match(/[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{3,}/g) || []
  const polishHits = words.filter(w => /[ąćęłńóśźż]/i.test(w)).length
  const materialHits = words.filter(w => /skrzyn|palet|karton|worek|foli|opakow|etykiet|beczk|ta[sś]m/i.test(w)).length
  const garbage = (s.match(/[^0-9a-zA-Z\sąćęłńóśźżĄĆĘŁŃÓŚŹŻ.,\-()/+%°]/g) || []).length
  return words.length * 2 + polishHits * 5 + materialHits * 8 - garbage * 3
}

export function pickBestInvoiceText(primary, fallback) {
  const a = String(primary || '').trim()
  const b = String(fallback || '').trim()
  if (!a) return b
  if (!b) return a
  return polishWordScore(a) >= polishWordScore(b) ? a : b
}

function toLines(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map(l => l.replace(/\s{2,}/g, ' ').trim())
    .filter(Boolean)
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
    /\b(FS\s*\d+\/\d+\/\d{4})\b/i,
    /(?:nr\s*faktury|numer\s*faktury)\s*[:#.\-]?\s*([A-Z0-9][A-Z0-9/_.\-\s]{2,40})/i
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (m?.[1]) return m[1].replace(/\s{2,}/g, ' ').replace(/[;,.]\s*$/g, '').trim()
  }
  return invoiceFromFileName(fileName)
}

function findDate(text) {
  const labels = ['data sprzedaży', 'data sprzedazy', 'data wystawienia', 'data dostawy', 'data dokumentu']
  for (const label of labels) {
    const rePl = new RegExp(`${label}[\\s\\S]{0,60}?(\\d{1,2}[.\\-/]\\d{1,2}[.\\-/]\\d{4})`, 'i')
    const mPl = text.match(rePl)
    const isoPl = polishDateToIso(mPl?.[1])
    if (isoPl) return isoPl
    const reIso = new RegExp(`${label}[\\s\\S]{0,60}?(\\d{4}-\\d{2}-\\d{2})`, 'i')
    const mIso = text.match(reIso)
    if (mIso?.[1]) return mIso[1]
  }
  const cityIso = text.match(/,\s*(\d{4}-\d{2}-\d{2})\b/)
  if (cityIso?.[1]) return cityIso[1]
  for (const m of text.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)) {
    if (m[1] >= '2020-01-01' && m[1] <= '2035-12-31') return m[1]
  }
  for (const m of text.matchAll(/(\d{1,2}[.\-/]\d{1,2}[.\-/](20\d{2}))/g)) {
    const iso = polishDateToIso(m[1])
    if (iso) return iso
  }
  return ''
}

function findSeller(text, lines) {
  const skip = [/nip/, /regon/, /konto/, /bank/, /tel/, /agro-mar/, /7171839598/, /nabywca/, /kolonia laziska/]
  for (const line of lines) {
    const m = line.match(/^(?:Sprzedawca|Dostawca|Wystawca)\s*[:\-]\s*(.+)$/i)
    if (m?.[1] && isReadableName(m[1]) && !skip.some(s => s.test(normalizeText(m[1])))) {
      return m[1].trim().slice(0, 120)
    }
  }
  const known = text.match(/\b(AGROTEX[^\n]{0,60})/i)?.[1]
  if (known) return known.replace(/\s{2,}/g, ' ').trim().slice(0, 120)

  for (const m of text.matchAll(/NIP\s*[:\s]*(\d{10}|\d{3}[-\s]?\d{3}[-\s]?\d{2}[-\s]?\d{2})/gi)) {
    const nip = m[1].replace(/\D/g, '')
    if (nip === AGRO_MAR_NIP) continue
    const ctx = text.slice(Math.max(0, text.indexOf(m[0]) - 350), text.indexOf(m[0]))
    const ctxLines = toLines(ctx)
    for (let i = ctxLines.length - 1; i >= 0; i--) {
      const line = ctxLines[i]
      if (line.length >= 3 && line.length <= 100 && isReadableName(line)
        && !/^(ul\.|tel|bank|nip|regon|kruszynska|wloclawek)/i.test(line)) {
        return line.slice(0, 120)
      }
    }
  }
  return ''
}

function parseRowFromTokens(tokens) {
  if (!tokens.length || !/^\d{1,3}$/.test(tokens[0])) return null
  const lp = Number(tokens[0])
  if (lp < 1 || lp > 300) return null

  const nameParts = []
  let qty = ''
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i]
    const joined = tokens.slice(i, i + 4).join(' ')
    const qm = joined.match(new RegExp(`^(\\d+(?:[\\s ]?\\d{3})*(?:[,.]\\d+)?)\\s*\\(?(${UNIT})\\)?`, 'i'))
    if (qm) {
      qty = `${qm[1].replace(/\s/g, '').replace(',', '.')} ${qm[2].replace(/\./g, '')}`
      break
    }
    if (/^\d{2,4}$/.test(t) && nameParts.length) continue
    if (/^\d+[,.]\d{2}$/.test(t) || /^(23|8|5|0)$/.test(t)) break
    if (SKIP_ROW.test(normalizeText(t))) break
    nameParts.push(t)
  }
  const name = nameParts.join(' ').replace(/\s{2,}/g, ' ').trim()
  if (!isReadableName(name) || SKIP_ROW.test(normalizeText(name))) return null
  return { name: name.slice(0, 120), qty }
}

function parseLineItemsFromTableText(text) {
  const items = []
  const flat = String(text || '')

  const afterHeader = flat.split(/Nazwa\s+towaru\s*\/?\s*us[łl]ugi/i)[1] || flat
  const rowRe = new RegExp(
    String.raw`(?:^|\n)\s*(\d{1,3})\s+([\p{L}0-9][\p{L}0-9\s.\-/,+]{2,90}?)\s+\d{2,4}\s+(\d+(?:[\s ]?\d{3})*(?:[,.]\d+)?)\s*\(?(?:${UNIT})\)?`,
    'giu'
  )
  let m
  while ((m = rowRe.exec(afterHeader)) !== null) {
    const name = m[2].replace(/\s{2,}/g, ' ').trim()
    if (!isReadableName(name)) continue
    items.push({
      name: name.slice(0, 120),
      qty: `${m[3].replace(/\s/g, '').replace(',', '.')} szt`
    })
  }
  if (items.length) return items

  const simpleRe = new RegExp(
    String.raw`(?:^|\n)\s*(\d{1,3})\s+([\p{L}][\p{L}0-9\s.\-/,+]{2,90}?)\s+(\d+(?:[\s ]?\d{3})*(?:[,.]\d+)?)\s*\(?(?:${UNIT})\)?`,
    'giu'
  )
  while ((m = simpleRe.exec(flat)) !== null) {
    const name = m[2].replace(/\s{2,}/g, ' ').trim()
    if (SKIP_ROW.test(normalizeText(name)) || !isReadableName(name)) continue
    items.push({
      name: name.slice(0, 120),
      qty: `${m[3].replace(/\s/g, '').replace(',', '.')} szt`
    })
  }
  return items
}

function groupItemsByRow(items, tolerance = 4) {
  const withPos = (items || [])
    .filter(i => String(i.str || '').trim())
    .map(i => ({
      str: String(i.str).trim(),
      x: i.transform?.[4] ?? 0,
      y: i.transform?.[5] ?? 0
    }))
    .sort((a, b) => (Math.abs(a.y - b.y) > tolerance ? b.y - a.y : a.x - b.x))

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

function parseLineItemsFromPositions(allItems) {
  const rows = groupItemsByRow(allItems, 4)
  const items = []
  for (const row of rows) {
    const tokens = [...row].sort((a, b) => a.x - b.x).map(r => r.str)
    const parsed = parseRowFromTokens(tokens)
    if (parsed) items.push(parsed)
  }
  return items
}

function dedupeItems(items) {
  const seen = new Set()
  return items.filter(it => {
    const k = normalizeText(it.name)
    if (!k || seen.has(k)) return false
    seen.add(k)
    return true
  })
}

export function parseK011InvoiceAdvanced(text, fileName = '', itemsByPage = []) {
  const flat = String(text || '')
  const lines = toLines(flat)
  const deliveryDate = findDate(flat)
  const invoiceNo = findInvoiceNumber(flat, fileName)
  const supplier = findSeller(flat, lines)

  const strategies = [
    parseLineItemsFromPositions(itemsByPage.flat()),
    parseLineItemsFromTableText(flat)
  ]
  let lineItems = dedupeItems(strategies.flat().filter(it => isReadableName(it.name)))

  const primary = lineItems[0] || {}
  let itemName = primary.name || ''
  if (!itemName) {
    const guess = lines.find(l => /skrzyn|palet|karton|worek|foli|opakow|etykiet/i.test(l) && isReadableName(l))
    if (guess) itemName = guess.replace(/^\d+[\s.)-]+/, '').trim().slice(0, 120)
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
    itemName: isReadableName(itemName) ? itemName : '',
    qty: primary.qty || '',
    supplierInvoice,
    lineItems,
    textLength: flat.replace(/\s/g, '').length,
    parseConfidence: lineItems.length > 0 ? 'high' : (deliveryDate && supplierInvoice ? 'partial' : 'low')
  }
}

export function buildK011UpdatesFromAdvanced(parsed) {
  const updates = {}
  if (parsed.deliveryDate) updates.delivery_date = parsed.deliveryDate
  if (parsed.itemName) updates.item_name = parsed.itemName
  if (parsed.supplierInvoice) updates.supplier_invoice = parsed.supplierInvoice
  if (parsed.qty) updates.qty = parsed.qty
  return updates
}
