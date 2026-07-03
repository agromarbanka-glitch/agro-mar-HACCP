/**
 * Odczyt faktur PDF dla kartoteki K01.1
 */
import { getDocument } from 'pdfjs-dist'

export const K011_PDF_IMPORT_VERSION = '1.1'

function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
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
    if (Math.abs(yA - yB) > 4) return yB - yA
    return (a.transform?.[4] ?? 0) - (b.transform?.[4] ?? 0)
  })
  const lines = []
  let bucket = []
  let lastY = null
  for (const item of sorted) {
    const str = String(item.str || '').trim()
    if (!str) continue
    const y = item.transform?.[5] ?? 0
    if (lastY === null || Math.abs(y - lastY) <= 4) {
      bucket.push(str)
      lastY = lastY ?? y
    } else {
      if (bucket.length) lines.push(bucket.join(' '))
      bucket = [str]
      lastY = y
    }
  }
  if (bucket.length) lines.push(bucket.join(' '))
  return lines.join('\n')
}

function decodePdfStreamFallback(buffer) {
  const raw = new TextDecoder('latin1').decode(buffer)
  const chunks = []
  const tjRegex = /\(([^()\\]{1,200})\)\s*Tj/g
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
  if (chunks.length > 40) return chunks.join('\n')
  return raw
    .replace(/\(([^()]{1,120})\)\s*Tj/g, '\n$1\n')
    .replace(/[^\x09\x0A\x0D\x20-\x7EĄĆĘŁŃÓŚŹŻąćęłńóśźż]+/g, ' ')
}

export async function extractPdfText(file) {
  const buffer = await file.arrayBuffer()
  try {
    const pdf = await getDocument({ data: buffer, disableWorker: true, useWorkerFetch: false, isEvalSupported: false }).promise
    const parts = []
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      const page = await pdf.getPage(pageNo)
      const content = await page.getTextContent()
      parts.push(mergeTextItems(content.items))
    }
    const text = parts.join('\n').trim()
    if (text.replace(/\s/g, '').length >= 30) return text
  } catch {
    /* fallback below */
  }
  return decodePdfStreamFallback(buffer)
}

function firstLineAfterLabel(lines, labels, skipPatterns = []) {
  for (let i = 0; i < lines.length; i++) {
    const n = normalizeText(lines[i])
    if (!labels.some(l => n.includes(normalizeText(l)))) continue
    for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
      const candidate = lines[j].trim()
      if (!candidate || candidate.length < 2) continue
      const cn = normalizeText(candidate)
      if (skipPatterns.some(p => p.test(cn))) continue
      if (/^[0-9\s,./-]+$/.test(candidate)) continue
      if (/^nip\s*[:.]?\s*\d/i.test(candidate)) continue
      return candidate.replace(/^(nazwa|firma|sprzedawca|dostawca|wystawca)\s*[:\-]?\s*/i, '').trim()
    }
  }
  return ''
}

function findInvoiceNumber(text) {
  const patterns = [
    /(?:faktura\s*(?:vat)?|fv|nr\s*faktury|numer\s*faktury|invoice)\s*(?:nr|numer|no\.?)?\s*[:#.\-]?\s*([A-Z0-9][A-Z0-9/_.\-]{2,40})/i,
    /\b(FV[\s\/.\-]?[0-9]{1,4}[\s\/.\-]?[0-9]{1,4}[\s\/.\-]?[0-9]{2,4})\b/i,
    /\b([0-9]{1,4}\/[0-9]{1,6}\/[A-Z]{0,3}[0-9]{2,4})\b/
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (m?.[1]) return m[1].replace(/[;,.\s]+$/g, '').trim()
  }
  return ''
}

function findDeliveryDate(text) {
  const labeled = [
    /(?:data\s+wystawienia|data\s+dostawy|data\s+sprzedaży|data\s+sprzedazy|data\s+dokumentu|termin\s+płatności)\s*[:\-]?\s*(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{4})/i,
    /(?:w\s+dniu|dnia)\s+(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{4})/i
  ]
  for (const re of labeled) {
    const m = text.match(re)
    const iso = polishDateToIso(m?.[1])
    if (iso) return iso
  }
  const all = [...text.matchAll(/(\d{1,2}[.\-/]\d{1,2}[.\-/](20\d{2}))/g)]
  for (const m of all) {
    const iso = polishDateToIso(m[1])
    if (iso) return iso
  }
  return ''
}

function findSupplier(lines, text) {
  const skip = [/nip/, /regon/, /konto/, /bank/, /tel/, /fax/, /www/, /agro-mar/, /7171839598/]
  let name = firstLineAfterLabel(lines, ['Sprzedawca', 'Dostawca', 'Wystawca', 'Sprzedający'], skip)
  if (name) return name.slice(0, 120)

  const nipBlocks = [...text.matchAll(/NIP\s*[:\s]*(\d{3}[-\s]?\d{3}[-\s]?\d{2}[-\s]?\d{2}|\d{10})/gi)]
  for (const m of nipBlocks) {
    const nip = m[1].replace(/\D/g, '')
    if (nip === '7171839598') continue
    const idx = text.indexOf(m[0])
    const before = text.slice(Math.max(0, idx - 200), idx)
    const beforeLines = before.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    for (let i = beforeLines.length - 1; i >= Math.max(0, beforeLines.length - 4); i--) {
      const line = beforeLines[i]
      if (line.length >= 3 && !/nip|ul\.|tel|bank/i.test(line) && !/^\d+$/.test(line)) {
        return line.slice(0, 120)
      }
    }
  }
  return ''
}

function findLineItems(lines) {
  const qtyRegex = /(\d+(?:[\s ]?\d{3})*(?:[,.]\d+)?)\s*(szt\.?|kg|g|opak\.?|rol\.?|mb|m2|m²|kpl\.?|pcs|l|litr)/i
  const materialKeywords = /(karton|worek|worki|skrzyn|beczk|etykiet|foli|opakowan|palet|taśm|tasma|wiadr|pojemnik|nakrętk|nakretk|butel|słoik|pojem|stretch|regranulat|papier|tektur|zgrzew|lin|sito|pokryw)/i
  const skipRow = /(razem|suma|vat|netto|brutto|do\s+zapłaty|wartość|lp\.|nazwa\s+towaru|j\.m\.|jm|pkwi|gtu)/i

  const items = []
  for (const line of lines) {
    if (skipRow.test(line) || line.length < 4) continue
    const q = line.match(qtyRegex)
    if (!q && !materialKeywords.test(line)) continue
    let name = line
      .replace(/\s+\d+(?:[\s ]?\d{3})*(?:[,.]\d+)?\s*(szt\.?|kg|g|opak\.?|rol\.?|mb|m2|m²|kpl\.?|pcs|l|litr).*/i, '')
      .replace(/^\d+[\s.)-]+/, '')
      .trim()
    if (name.length < 3) continue
    const qty = q ? `${q[1].replace(/\s/g, '').replace(',', '.')} ${q[2].replace('.', '')}` : ''
    items.push({ name: name.slice(0, 120), qty })
  }

  if (items.length) return items

  const nameHeaderIdx = lines.findIndex(l => /nazwa\s+(towaru|usługi|produktu)/i.test(l))
  if (nameHeaderIdx >= 0) {
    for (let i = nameHeaderIdx + 1; i < Math.min(nameHeaderIdx + 15, lines.length); i++) {
      const line = lines[i]
      if (skipRow.test(line)) continue
      const q = line.match(qtyRegex)
      if (q || line.length >= 8) {
        items.push({
          name: line.replace(qtyRegex, '').replace(/^\d+[\s.)-]+/, '').trim().slice(0, 120) || line.slice(0, 80),
          qty: q ? `${q[1].replace(/\s/g, '')} ${q[2]}` : ''
        })
        break
      }
    }
  }
  return items
}

export function parseInvoiceTextForK011(text, fileName = '') {
  const clean = String(text || '').replace(/\u0000/g, ' ').replace(/\r/g, '')
  const lines = clean.split(/\n/).map(l => l.trim()).filter(Boolean)

  const invoiceNo = findInvoiceNumber(clean) || (fileName.match(/FV[\s._-]?([0-9/_.-]+)/i)?.[1] || '')
  const deliveryDate = findDeliveryDate(clean)
  const supplier = findSupplier(lines, clean)
  const lineItems = findLineItems(lines)
  const primary = lineItems[0] || {}

  let itemName = primary.name || ''
  let qty = primary.qty || ''

  if (!itemName) {
    const guess = lines.find(l => materialKeywordsLoose(l) && l.length >= 5 && l.length <= 100)
    if (guess) itemName = guess.replace(/^\d+[\s.)-]+/, '').slice(0, 120)
  }

  const supplierInvoice = [supplier, invoiceNo].filter(Boolean).join(' / ')
  const confidence = [deliveryDate, supplierInvoice, itemName].filter(Boolean).length

  return {
    deliveryDate,
    invoiceNo,
    supplier,
    itemName,
    qty,
    supplierInvoice,
    lineItems,
    confidence,
    textLength: clean.replace(/\s/g, '').length,
    previewLines: lines.slice(0, 40)
  }
}

function materialKeywordsLoose(line) {
  return /(karton|worek|foli|opakow|etykiet|palet|taśm|beczk|skrzyn|wiadr|pojemnik|nakr|butel|słoik|stretch|tektur|papier)/i.test(line)
}

export function buildK011UpdatesFromParse(parsed) {
  const updates = {}
  if (parsed.deliveryDate) updates.delivery_date = parsed.deliveryDate
  if (parsed.itemName) updates.item_name = parsed.itemName
  if (parsed.supplierInvoice) updates.supplier_invoice = parsed.supplierInvoice
  else if (parsed.invoiceNo) updates.supplier_invoice = parsed.invoiceNo
  else if (parsed.supplier) updates.supplier_invoice = parsed.supplier
  if (parsed.qty) updates.qty = parsed.qty
  return updates
}

export async function importK011FromPdfFile(file) {
  const text = await extractPdfText(file)
  const parsed = parseInvoiceTextForK011(text, file.name)
  const updates = buildK011UpdatesFromParse(parsed)
  return { text, parsed, updates }
}
