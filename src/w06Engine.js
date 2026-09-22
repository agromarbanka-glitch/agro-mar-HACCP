/**
 * W06 – kwalifikowani dostawcy i odbiorcy (import PDF/Excel PZ/WZ, deduplikacja).
 */
import { extractPdfData, isReadablePdfText, rebuildTextFromItems } from './pdfImportEngine.js'
import { isReadableName } from './k011InvoiceParser.js'
import { readAgromarExcel } from './excelImport.js'
import * as XLSX from 'xlsx'

export const W06_ENGINE_VERSION = '2.0'

/** Domyślny zestaw surowców (lewa kolumna W06) – dopisywany automatycznie. */
export const W06_DEFAULT_RAW_ITEMS = ['Truskawka', 'Malina', 'Porzeczka', 'Jabłko', 'Wiśnia']
export const AGRO_MAR_NIP = '7171839598'
export const W06_MIN_ROWS = 20

/** Układ 1:1 – W06 - Wykaz kwalifikowanych dostawców.docx (I/2024). */
export const W06_HEADER = {
  companyLines: [
    'AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.',
    '24-335 ŁAZISKA,',
    'KOLONIA ŁAZISKA 30',
    'NIP: 7171839598'
  ],
  title: 'Wykaz W06 - Wykaz kwalifikowanych dostawców',
  version: 'I/2024',
  issueDate: '2024-09-02',
  issueDateLabel: '02.09.2024'
}

export const W06_RAW_SUPPLIER_HEAD = 'Dane dostawcy surowca (nazwa i dane firmy)'
export const W06_AUX_SUPPLIER_HEAD = 'Dane dostawcy materiałów pomocniczych w tym opakowań i środków czystości (nazwa i dane firmy)'

export function formatW06PlDate(iso) {
  if (!iso) return ''
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return iso
  return `${m[3]}.${m[2]}.${m[1]}`
}

export const W06_PARTY_LABELS = {
  supplier: 'Dostawca',
  recipient: 'Odbiorca'
}

export const W06_KIND_LABELS = {
  raw: 'Surowiec',
  aux: 'Materiały pomocnicze',
  recipient: 'Odbiorca (klient)'
}

function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isAgromarParty(name = '', nip = '') {
  const n = normalizeText(name)
  const nipDigits = String(nip).replace(/\D/g, '')
  if (nipDigits === AGRO_MAR_NIP) return true
  return /agro[-\s]?mar|mariusz\s+bank|mariusz\s+ban|kolonia\s+laziska|laziska\s+30/.test(n)
}

export function normalizeNip(value) {
  const d = String(value || '').replace(/\D/g, '')
  if (d.length === 10) return d
  return ''
}

export function w06CompanyFingerprint(name = '') {
  return normalizeText(name)
    .replace(/["«»„"]/g, '')
    .replace(/\bsp\.?\s*z\.?\s*o\.?\s*o\.?\b/g, ' spzoo ')
    .replace(/\bprzedsiebiorstwo\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Klucz dopasowania tej samej firmy – po nazwie (pierwsze słowo ≥4 zn.), NIP tylko gdy brak sensownej nazwy. */
export function w06DedupeKey(party) {
  const fp = w06CompanyFingerprint(party?.company_name || party?.supplier_name || party?.name || '')
  if (fp.length >= 3) {
    const first = fp.split(' ').filter(Boolean)[0] || fp
    if (first.length >= 4) return `co:${first}`
    return `name:${fp.slice(0, 80)}`
  }
  const nip = normalizeNip(party?.nip)
  if (nip) return `nip:${nip}`
  return ''
}

export function w06LooksLikeCompanyName(text, companyHint = '') {
  const p = w06CompanyFingerprint(text)
  if (!p || p.length < 4) return false
  const hint = w06CompanyFingerprint(companyHint)
  if (hint && (p === hint || p.includes(hint) || hint.includes(p))) return true
  if (/spzoo|ograniczona odpowiedzialnoscia|spolka akcyjna|\bsa\b/.test(p)) return true
  if (p.length > 36 && /przedsiebiorstwo|wielobranzow|handlow|produkcyjn|dostawc/.test(p)) return true
  return false
}

export function w06SanitizeSupplierProduct(companyName, productName) {
  const product = String(productName || '').trim()
  if (!product) return ''
  if (w06LooksLikeCompanyName(product, companyName)) return ''
  if (/^\d{10}$/.test(normalizeNip(product))) return ''
  return product.slice(0, 80)
}

/** Usuwa z listy surowców wpisy będące nazwą firmy (błędny import). */
export function w06CleanItemListForSupplier(itemName, companyName) {
  const kept = w06ParseItemList(itemName).filter(item => !w06LooksLikeCompanyName(item, companyName))
  return kept.join('; ').slice(0, 160)
}

export function w06MatchKeyFromDoc(doc) {
  const d = doc?.data || {}
  return w06DedupeKey({
    nip: d.nip,
    company_name: d.company_name || d.supplier_name,
    supplier_name: d.supplier_name
  })
}

export function w06KindPartitionKey(doc) {
  const d = doc?.data || {}
  const kind = d.supplier_kind || (d.party_type === 'recipient' ? 'recipient' : 'raw')
  return kind
}

export function w06CompositeMatchKey(doc) {
  const mk = w06MatchKeyFromDoc(doc)
  if (!mk) return ''
  return `${w06KindPartitionKey(doc)}|${mk}`
}

export function detectW06DocKind(text, fileName = '') {
  const flat = `${text || ''} ${fileName || ''}`.toUpperCase()
  const fn = String(fileName).toUpperCase()
  if (/\bPZ[\s./_-]|\bPZ\b|PRZYJ[EĘ]CIE|PRZYJECIE\s+ZEWN|PRZYJ[EĘ]CIE\s+MAGAZ|DOKUMENT\s+PZ/.test(flat) || fn.includes('PZ')) return 'PZ'
  if (/\bMM[\s./_-]|\bMM\b|PRZESUN[IĘ]CIE/.test(flat) || fn.includes('MM')) return 'PZ'
  if (/\bWZ[\s./_-]|\bWZ\b|WYDANIE|WYDANIE\s+ZEWN|WYDANIE\s+MAGAZ|DOKUMENT\s+WZ/.test(flat) || fn.includes('WZ')) return 'WZ'
  if (/\bRR\b|FAKTURA\s*VAT\s*RR|RACHUNEK\s*RR|\bRR\//.test(flat) || fn.includes('RR')) return 'WZ'
  if (/\bFS\b|\bFV\b|FAKTURA/.test(flat)) {
    const t = String(text || '')
    if (/nabywca[\s\S]{0,400}?7171839598/i.test(t) || /7171839598[\s\S]{0,400}?nabywca/i.test(t)) return 'PZ'
    if (/sprzedawca[\s\S]{0,400}?7171839598/i.test(t) || /7171839598[\s\S]{0,400}?sprzedawca/i.test(t)) return 'WZ'
    return 'WZ'
  }
  return 'unknown'
}

function expandW06Text(text) {
  let t = String(text || '').replace(/\r/g, '')
  if (t.split('\n').filter(l => l.trim()).length >= 6) return t
  return t
    .replace(/\s+(Sprzedawca|Nabywca|Odbiorca|Dostawca|Wystawca|Kontrahent|NIP|Tel\.|Adres|Lp\.|Produkt|Towar|PZ|WZ|Przyj[eę]cie|Wydanie)/gi, '\n$1')
}

function toLines(text) {
  return expandW06Text(text).split('\n').map(l => l.replace(/\s{2,}/g, ' ').trim()).filter(Boolean)
}

function inferKindFromAgromar(text) {
  const t = String(text || '')
  if (/nabywca[\s\S]{0,600}?7171839598|7171839598[\s\S]{0,600}?nabywca|odbiorca[\s\S]{0,400}?7171839598/i.test(t)) return 'PZ'
  if (/sprzedawca[\s\S]{0,600}?7171839598|7171839598[\s\S]{0,600}?sprzedawca|dostawca[\s\S]{0,400}?7171839598/i.test(t)) return 'WZ'
  if (/7171839598[\s\S]{0,800}?(sprzedawca|dostawca|wystawca)/i.test(t)) return 'WZ'
  if (/7171839598[\s\S]{0,800}?(nabywca|odbiorca)/i.test(t)) return 'PZ'
  if (/(sprzedawca|dostawca)/i.test(t) && !isAgromarParty('', findNipNear(t, ['Sprzedawca', 'Dostawca']))) return 'PZ'
  if (/(odbiorca|nabywca)/i.test(t) && !isAgromarParty('', findNipNear(t, ['Odbiorca', 'Nabywca']))) return 'WZ'
  return 'unknown'
}

function labelValue(lines, labels) {
  for (const line of lines) {
    for (const label of labels) {
      const re = new RegExp(`^${label}\\s*[:\\-]\\s*(.+)$`, 'i')
      const m = line.match(re)
      if (m?.[1]?.trim()) return m[1].trim().slice(0, 200)
    }
  }
  return ''
}

function firstLineAfter(lines, labels, skip = []) {
  for (let i = 0; i < lines.length; i++) {
    const n = normalizeText(lines[i])
    if (!labels.some(l => n.includes(normalizeText(l)))) continue
    for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
      const c = lines[j]
      if (!c || c.length < 3) continue
      const cn = normalizeText(c)
      if (skip.some(s => s.test(cn))) continue
      if (/^nip\s*[:.]?\s*\d/i.test(c)) continue
      if (/^(ul\.|tel|bank|konto|www|email)/i.test(c)) continue
      if (isAgromarParty(c)) continue
      if (isReadableName(c) || c.length >= 4) return c.slice(0, 200)
    }
  }
  return ''
}

function findNipNear(text, labels) {
  for (const label of labels) {
    const re = new RegExp(`${label}[\\s\\S]{0,120}?NIP\\s*[:\\s]*([0-9\\-\\s]{10,13})`, 'i')
    const m = text.match(re)
    if (m?.[1]) return normalizeNip(m[1])
  }
  const nips = [...text.matchAll(/NIP\s*[:\s]*(\d{10}|\d{3}[-\s]?\d{3}[-\s]?\d{2}[-\s]?\d{2})/gi)]
  for (const m of nips) {
    const nip = normalizeNip(m[1])
    if (nip && nip !== AGRO_MAR_NIP) return nip
  }
  return ''
}

function findAddress(lines, nameLineIdx) {
  if (nameLineIdx < 0) return ''
  const parts = []
  for (let j = nameLineIdx + 1; j < Math.min(nameLineIdx + 4, lines.length); j++) {
    const c = lines[j]
    if (/^nip\s/i.test(c) || /^tel\s/i.test(c) || /^bank/i.test(c)) break
    if (/^\d{2}-\d{3}/.test(c) || /^ul\./i.test(c) || /laziska|wloclawek|polska/i.test(c)) parts.push(c)
  }
  return parts.join(', ').slice(0, 160)
}

function extractLabelBlock(text, labels) {
  for (const label of labels) {
    const re = new RegExp(
      `${label}\\s*[:\\-]?\\s*\\n?([\\s\\S]{0,350}?)(?=\\n\\s*(?:Nabywca|Odbiorca|Sprzedawca|Dostawca|Kontrahent|Wystawca|Tel\\.|Bank|Rachunek|Lp\\.|Produkt|$))`,
      'i'
    )
    const m = text.match(re)
    if (!m?.[1]) continue
    const blockLines = toLines(m[1])
    let name = ''
    let nip = ''
    let address = []
    for (const line of blockLines) {
      const nipM = line.match(/NIP\s*[:.]?\s*([0-9\-\\s]{10,13})/i)
      if (nipM) {
        nip = normalizeNip(nipM[1])
        continue
      }
      if (/^(ul\.|tel|bank|konto|regon|www|email)/i.test(line)) {
        if (/^ul\./i.test(line) || /^\d{2}-\d{3}/.test(line)) address.push(line)
        continue
      }
      if (!name && line.length >= 3 && !isAgromarParty(line)) name = line
      else if (name && /^\d{2}-\d{3}/.test(line)) address.push(line)
    }
    if (name && !isAgromarParty(name, nip)) {
      return { name: name.slice(0, 200), nip, address: address.join(', ').slice(0, 160) }
    }
  }
  return null
}

function extractPartyBlock(text, lines, kind) {
  const isSupplier = kind === 'PZ'
  const nameLabels = isSupplier
    ? ['Sprzedawca', 'Dostawca', 'Wystawca', 'Nadawca', 'Kontrahent']
    : ['Odbiorca', 'Nabywca', 'Klient', 'Odbiorca towaru']

  const fromBlock = extractLabelBlock(text, nameLabels)
  if (fromBlock?.name) return fromBlock

  const skip = [/nip/, /regon/, /konto/, /bank/, /tel/, /agro-mar/, /7171839598/, /nabywca/, /sprzedawca/]

  let name = labelValue(lines, nameLabels)
  if (!name || isAgromarParty(name)) {
    name = firstLineAfter(lines, nameLabels, skip)
  }
  if (!name || isAgromarParty(name)) {
    const nip = findNipNear(text, isSupplier ? ['Sprzedawca', 'Dostawca'] : ['Odbiorca', 'Nabywca'])
    if (nip) {
      const idx = text.indexOf(nip)
      const ctx = text.slice(Math.max(0, idx - 350), idx)
      const ctxLines = toLines(ctx)
      for (let i = ctxLines.length - 1; i >= 0; i--) {
        const line = ctxLines[i]
        if (line.length >= 3 && !isAgromarParty(line) && isReadableName(line)) {
          name = line
          break
        }
      }
    }
  }

  const nip = findNipNear(text, nameLabels)
  const nameIdx = lines.findIndex(l => l.includes(name?.slice(0, 20) || '___'))
  const address = findAddress(lines, nameIdx)

  return { name: String(name || '').trim(), nip, address }
}

function guessItemName(text, lines) {
  const rowRe = /(?:^|\n)\s*\d{1,3}\s+([\p{L}][\p{L}0-9\s.\-/,+]{3,80}?)\s+\d+/giu
  const m = rowRe.exec(text)
  if (m?.[1] && isReadableName(m[1])) return m[1].trim().slice(0, 120)
  const guess = lines.find(l => /jabłk|jabl|gruszk|malin|aroni|skrzyn|palet|karton|worek/i.test(l) && l.length <= 100)
  return guess ? guess.replace(/^\d+[\s.)-]+/, '').trim().slice(0, 120) : ''
}

function tryExtractNip(raw) {
  const digits = String(raw || '').replace(/\D/g, '')
  if (digits.length === 10) return digits
  if (digits.length > 10) {
    for (let i = 0; i <= digits.length - 10; i++) {
      const cand = digits.slice(i, i + 10)
      if (cand !== AGRO_MAR_NIP) return cand
    }
  }
  return ''
}

function findNipInSegment(seg) {
  const labeled = [...seg.matchAll(/NIP\s*([\d\s,.-]{4,20})/gi)]
  for (const m of labeled) {
    const nip = tryExtractNip(m[1])
    if (nip && nip !== AGRO_MAR_NIP) return nip
  }
  for (const m of seg.matchAll(/\b(\d{10,11})\b/g)) {
    const nip = tryExtractNip(m[1])
    if (nip && nip !== AGRO_MAR_NIP) return nip
  }
  return ''
}

function cleanRegisterName(raw) {
  return String(raw || '')
    .replace(/\d[\d\s,]*(?:zł|PLN)/gi, ' ')
    .replace(/\d{4}-\d{2}-\d{2}/g, ' ')
    .replace(/\b\d[\d\s,]{3,}\b/g, ' ')
    .replace(/\s+\d[\d\s,]*(?:zł|PLN).*$/i, '')
    .replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '')
    .replace(/\s+(?:RR-|wziąć|nowe dane|bez ceny|Magazyn).*$/i, '')
    .replace(/\s+Mariusz\s*\.\.\s*Bańka.*$/i, '')
    .replace(/\s+Bańka\s+Sp\.\s*z\s*o\.?\s*o\.?.*$/i, '')
    .replace(/\s+AGRO-\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function extractPartyFromRegisterSegment(seg, docKind, fileName) {
  const kind = docKind === 'WZ' ? 'WZ' : 'PZ'
  const dateM = seg.match(/\d{4}-\d{2}-\d{2}/)
  let rest = dateM ? seg.slice(seg.indexOf(dateM[0]) + dateM[0].length).trim() : seg.replace(/^(?:PZ|WZ|MM)\s+(?:PZ|WZ|MM)\/[^\n]+/i, '').trim()

  rest = rest.replace(/^Magazyn\s+\S+/i, '').trim()

  let name = ''
  let nip = findNipInSegment(rest)

  if (/GOSPODARSTWO/i.test(rest)) {
    const gosp = rest.match(/(GOSPODARSTWO[\s\S]{8,160}?OSUCH)/i)
    if (gosp) name = cleanRegisterName(gosp[1].replace(/\s+/g, ' '))
  }

  if (!name) {
    const commaNip = rest.match(/([\p{L}0-9][\p{L}\s.\-'&]{2,90}?),\s*NIP\s*[\d\s,.-]+/iu)
    if (commaNip) name = cleanRegisterName(commaNip[1])
  }

  if (!name) {
    const beforeQty = rest.match(/^([\p{L}][\p{L}\s.\-'&]{3,90}?)(?=\s+\d[\d\s,]{2,})/iu)
    if (beforeQty) name = cleanRegisterName(beforeQty[1])
  }

  if (!name) {
    const gosp = rest.match(/(GOSPODARSTWO[\s\S]{8,140}?OSUCH)/i)
    if (gosp) name = cleanRegisterName(gosp[1].replace(/\s+/g, ' '))
  }

  if (!name) {
    const words = rest.match(/([\p{L}]{2,}\s+[\p{L}]{2,}(?:\s+[\p{L}]{2,}){0,4})/u)
    if (words) name = cleanRegisterName(words[1])
  }

  name = cleanRegisterName(name)
  if (!name || name.length < 3 || isAgromarParty(name, nip)) return null

  const partyType = kind === 'WZ' ? 'recipient' : 'supplier'
  const party = {
    party_type: partyType,
    company_name: name.slice(0, 200),
    supplier_name: name.slice(0, 200),
    nip,
    address: '',
    item_name: '',
    supplier_kind: partyType === 'recipient' ? 'recipient' : 'raw',
    source_doc_kind: kind,
    source_filename: fileName
  }
  party.dedupe_key = w06DedupeKey(party)
  return party
}

/** Eksport rejestru PZ/WZ (wiele wierszy: Rodzaj, Dostawca/Odbiorca…) */
export function parseW06RegisterExport(text, fileName = '') {
  const flat = String(text || '')
  if (!/rodzaj|dostawca\s*\/\s*odbiorca|nr\s*faktury/i.test(flat)) return []
  if (!/\b(PZ|WZ|MM)\s+(PZ|WZ|MM)\//i.test(flat)) return []

  const segments = flat.split(/(?=\b(?:PZ|WZ|MM)\s+(?:PZ|WZ|MM)\/)/i)
  const parties = []
  const seen = new Set()

  for (const seg of segments) {
    const kindM = seg.match(/^\s*(PZ|WZ|MM)\s+/i)
    if (!kindM) continue
    const party = extractPartyFromRegisterSegment(seg, kindM[1].toUpperCase(), fileName)
    if (!party?.dedupe_key) continue
    if (seen.has(party.dedupe_key)) continue
    seen.add(party.dedupe_key)
    parties.push(party)
  }
  return parties
}

export function parseW06PartiesFromPdfText(text, fileName = '') {
  const registerParties = parseW06RegisterExport(text, fileName)
  if (registerParties.length) {
    return {
      kind: 'rejestr',
      parties: registerParties,
      itemName: '',
      textLength: String(text || '').replace(/\s/g, '').length
    }
  }
  const single = parseW06SingleDocFromPdfText(text, fileName)
  return {
    kind: single.kind,
    parties: single.party ? [single.party] : [],
    itemName: single.itemName,
    textLength: single.textLength
  }
}

function parseW06SingleDocFromPdfText(text, fileName = '') {
  let kind = detectW06DocKind(text, fileName)
  if (kind === 'unknown') kind = inferKindFromAgromar(text)
  const lines = toLines(text)

  let partyType = kind === 'WZ' ? 'recipient' : kind === 'PZ' ? 'supplier' : null
  let block = null

  if (partyType) {
    block = extractPartyBlock(text, lines, kind)
  } else {
    const pzBlock = extractPartyBlock(text, lines, 'PZ')
    const wzBlock = extractPartyBlock(text, lines, 'WZ')
    if (pzBlock.name && !isAgromarParty(pzBlock.name, pzBlock.nip)) {
      block = pzBlock
      partyType = 'supplier'
      kind = 'PZ'
    } else if (wzBlock.name && !isAgromarParty(wzBlock.name, wzBlock.nip)) {
      block = wzBlock
      partyType = 'recipient'
      kind = 'WZ'
    }
  }

  if (!block?.name || isAgromarParty(block.name, block.nip)) {
    return { kind, party: null, itemName: '', textLength: String(text || '').replace(/\s/g, '').length }
  }

  const itemName = guessItemName(text, lines)
  const companyDisplay = [block.name, block.address].filter(Boolean).join(', ')
  const party = {
    party_type: partyType,
    company_name: block.name,
    supplier_name: companyDisplay,
    nip: block.nip,
    address: block.address,
    item_name: itemName,
    supplier_kind: partyType === 'recipient' ? 'recipient' : 'raw',
    source_doc_kind: kind,
    source_filename: fileName
  }
  party.dedupe_key = w06DedupeKey(party)
  return { kind, party, itemName, textLength: String(text || '').replace(/\s/g, '').length }
}

/** @deprecated użyj parseW06PartiesFromPdfText */
export function parseW06FromPdfText(text, fileName = '') {
  const r = parseW06PartiesFromPdfText(text, fileName)
  return { kind: r.kind, party: r.parties[0] || null, itemName: r.itemName, textLength: r.textLength }
}

export function partyToW06NewRow(party) {
  if (!party) return null
  return {
    party_type: party.party_type || 'supplier',
    supplier_kind: party.supplier_kind || (party.party_type === 'recipient' ? 'recipient' : 'raw'),
    company_name: party.company_name || party.supplier_name || '',
    nip: party.nip || '',
    address: party.address || '',
    item_name: party.item_name || ''
  }
}

export async function parseW06FromPdfFile(file) {
  const { text, itemsByPage, error: pdfError } = await extractPdfData(file)
  let usableText = isReadablePdfText(text) ? text : rebuildTextFromItems(itemsByPage)
  if (!isReadablePdfText(usableText) && text && text.length >= 8 && !/%PDF-|endobj/i.test(text)) {
    usableText = text
  }
  if (!usableText || usableText.length < 8 || /%PDF-|endobj/i.test(usableText)) {
    return {
      text: '',
      kind: detectW06DocKind('', file.name),
      party: null,
      parties: [],
      itemName: '',
      textLength: 0,
      unreadable: true,
      pdfError: pdfError || null
    }
  }
  const parsed = parseW06PartiesFromPdfText(usableText, file.name)
  return { text: usableText, unreadable: false, pdfError: null, party: parsed.parties[0] || null, ...parsed }
}

function buildW06ExcelPreview(rows, parties, { dataRows = null, dupesInFile = 0 } = {}) {
  const dupNote = dupesInFile > 0 ? `, usunięto duplikatów w pliku: ${dupesInFile}` : ''
  const head =
    dataRows != null
      ? `Wierszy danych: ${dataRows}, unikalnych kontrahentów: ${parties.length}${dupNote}\n`
      : `Wierszy w Excelu: ${rows.length}, unikalnych kontrahentów: ${parties.length}${dupNote}\n`
  const sample = rows.slice(0, 12).map(r => {
    if (r.documentType || r.documentNo) {
      return `${r.documentType || '?'} ${r.documentNo || ''} | ${r.contractorName || '—'} | ${r.productName || '—'}`
    }
    return `${r.contractorName || '—'} | ${r.productName || '—'}${r.nip ? ` | NIP ${r.nip}` : ''}`
  }).join('\n')
  return head + sample
}

function w06NormHeaderLabel(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
}

function w06HeaderColumnKind(label) {
  const h = w06NormHeaderLabel(label)
  if (!h) return null
  if (/^(nip|nip firmy|numer nip)$/.test(h) || h.includes('nip')) return 'nip'
  if (/^owoc|^owoce|owoc$|owoce$/.test(h) || (/nazwa/.test(h) && /owoc|surowiec|towar/.test(h))) return 'product'
  if (
    /dostawca|odbiorca|kontrahent|sprzedawca|nabywca|nazwa firmy|nazwa dostawcy|dane firmy|dostawca\/odbiorca/.test(h) ||
    (/nazwa/.test(h) && /dostawc|firm|kontrahent/.test(h)) ||
    h === 'firma' ||
    h === 'nazwa'
  ) return 'company'
  if (/surowiec|towar|produkt|owoc|owoce|asortyment|material|materia|towar\/produkt|surowiec\/towar|zakres/.test(h)) return 'product'
  if (/^adres|siedziba|ulica|miejscowosc|miejscowość/.test(h)) return 'address'
  return null
}

function mapW06SupplierHeaderRow(row) {
  const cols = { company: -1, product: -1, nip: -1, address: -1 }
  for (let idx = 0; idx < (row || []).length; idx++) {
    const kind = w06HeaderColumnKind(row[idx])
    if (kind && cols[kind] < 0) cols[kind] = idx
  }
  return cols.company >= 0 ? cols : null
}

function w06SheetRowStrings(row) {
  return (row || []).map(c => String(c ?? '').trim())
}

function w06CellAt(row, index) {
  if (index < 0) return ''
  return String(row?.[index] ?? '').trim()
}

function isW06SupplierListTitleRow(cells) {
  const joined = cells.filter(Boolean).join(' ').toLowerCase()
  if (!joined) return true
  if (/wykaz|lista\s+dostaw|kwalifikowan|w06|dostawców|dostawcow/.test(joined) && cells.filter(Boolean).length <= 3) return true
  return false
}

function isW06LikelyWarehouseHeader(cols) {
  return cols.document >= 0 || cols.qty >= 0
}

function mapW06WarehouseHeaderRow(row) {
  const cols = { document: -1, qty: -1 }
  for (let idx = 0; idx < (row || []).length; idx++) {
    const h = w06NormHeaderLabel(row[idx])
    if (!h) continue
    if (/rodzaj|typ dokumentu|dokument/.test(h)) cols.document = idx
    if (/ilość|ilosc|qty|quantity/.test(h)) cols.qty = idx
  }
  return cols
}

function sheetLooksLikeWarehouseExport(sheet) {
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
  for (let i = 0; i < Math.min(matrix.length, 20); i++) {
    const line = w06SheetRowStrings(matrix[i]).join(' ').toUpperCase()
    if (/\bRODZAJ\b|\bILOŚĆ\b|\bILOSC\b|\bDATA WYSTAWIENIA\b/.test(line)) return true
    if (/\b(PZ|WZ|MM)[\/\s]\d/.test(line)) return true
  }
  return false
}

function buildSyntheticRowsFromSupplierSheet(sheet) {
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
  if (!matrix.length) return { rows: [], dataRows: 0, detected: false }

  let headerIdx = -1
  let cols = null
  for (let i = 0; i < Math.min(matrix.length, 25); i++) {
    const mapped = mapW06SupplierHeaderRow(matrix[i])
    if (!mapped) continue
    const wh = mapW06WarehouseHeaderRow(matrix[i])
    if (isW06LikelyWarehouseHeader(wh) && wh.qty >= 0) continue
    headerIdx = i
    cols = mapped
    break
  }

  const synthetic = []
  if (headerIdx >= 0 && cols) {
    for (let i = headerIdx + 1; i < matrix.length; i++) {
      const row = matrix[i]
      const company = w06CellAt(row, cols.company)
      const product = w06CellAt(row, cols.product)
      const nip = normalizeNip(w06CellAt(row, cols.nip))
      const address = w06CellAt(row, cols.address)
      if (!company && !product && !nip) continue
      if (isW06SupplierListTitleRow(w06SheetRowStrings(row))) continue
      if (!company || isAgromarParty(company, nip)) continue
      synthetic.push({
        contractorName: company,
        productName: product,
        nip,
        address,
        documentType: 'Lista',
        documentNo: ''
      })
    }
    return { rows: synthetic, dataRows: synthetic.length, detected: true, usedHeader: true }
  }

  if (sheetLooksLikeWarehouseExport(sheet)) {
    return { rows: [], dataRows: 0, detected: false }
  }

  for (let i = 0; i < matrix.length; i++) {
    const cells = w06SheetRowStrings(matrix[i]).filter(c => c !== '')
    if (cells.length < 2) continue
    if (isW06SupplierListTitleRow(cells)) continue
    const headerish = cells.join(' ').toLowerCase()
    if (/^lp\.?\s/.test(headerish) || (cells[0].toLowerCase() === 'lp' && cells.length >= 2)) continue
    if (/dostawca|firma|surowiec|towar|kontrahent|nip/.test(headerish) && cells.length <= 6) continue

    let company = ''
    let product = ''
    let nip = ''
    const lpLike = /^\d{1,4}$/.test(cells[0].replace(/\s/g, ''))
    if (lpLike && cells.length >= 3) {
      const a = cells[1]
      const b = cells[2]
      if (w06LooksLikeCompanyName(b) && !w06LooksLikeCompanyName(a)) {
        company = b
        product = w06SanitizeSupplierProduct(b, a)
      } else {
        company = a
        product = w06SanitizeSupplierProduct(a, b)
      }
      if (cells.length >= 4) nip = normalizeNip(cells[3])
    } else if (cells.length >= 2) {
      if (w06LooksLikeCompanyName(cells[0]) || !w06LooksLikeCompanyName(cells[1])) {
        company = cells[0]
        product = w06SanitizeSupplierProduct(cells[0], cells[1])
      } else {
        company = cells[1]
        product = w06SanitizeSupplierProduct(cells[1], cells[0])
      }
      if (cells.length >= 3 && /^\d{10}$/.test(normalizeNip(cells[2]))) nip = normalizeNip(cells[2])
    }
    if (!company || isAgromarParty(company, nip)) continue
    if (/^(razem|suma|ogółem|ogolem)$/i.test(company)) continue
    synthetic.push({
      contractorName: company,
      productName: product,
      nip,
      address: '',
      documentType: 'Lista',
      documentNo: ''
    })
  }

  const detected = synthetic.length > 0
  return { rows: synthetic, dataRows: synthetic.length, detected, usedHeader: false }
}

function scoreW06SupplierSheetAttempt(attempt) {
  if (!attempt?.rows?.length) return -1
  let score = attempt.rows.length
  if (attempt.usedHeader) score += 500_000
  return score
}

/** Lista dostawców (.xls/.xlsx) – kolumny Firma/Dostawca + Towar/Surowiec (bez PZ/WZ). */
export function parseW06SupplierListWorkbook(buffer, fileName = '') {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  let best = { rows: [], dataRows: 0, detected: false, usedHeader: false }
  let bestScore = -1
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue
    const attempt = buildSyntheticRowsFromSupplierSheet(sheet)
    const score = scoreW06SupplierSheetAttempt(attempt)
    if (score > bestScore) {
      best = attempt
      bestScore = score
    }
  }
  if (!best.rows.length) {
    return {
      kind: 'excel-suppliers',
      parties: [],
      preview: 'Wierszy danych: 0, unikalnych kontrahentów: 0\n(brak rozpoznanych kolumn – oczekiwane: Dostawca/Firma i opcjonalnie Towar/Surowiec, NIP)',
      rowCount: 0,
      detected: best.detected
    }
  }
  const beforeDedupe = best.rows.length
  const parsed = parseW06PartiesFromExcelRows(best.rows, fileName, { supplierList: true })
  for (const party of parsed.parties) {
    party.item_name = w06ApplyDefaultRawItems('', party.supplier_kind || 'raw', party.company_name)
  }
  const dupesInFile = Math.max(0, beforeDedupe - parsed.parties.length)
  parsed.preview = buildW06ExcelPreview(best.rows, parsed.parties, {
    dataRows: best.dataRows,
    dupesInFile
  })
  parsed.kind = 'excel-suppliers'
  parsed.detected = true
  return parsed
}

/** Usuwa duplikaty w partii (np. wiele wierszy tej samej firmy w pliku). */
export function dedupeW06PartiesBatch(parties) {
  return filterNewW06Parties([], parties || [])
}

/** Grupuje wiersze Excela (PZ/WZ) w unikalnych kontrahentów z asortymentem. */
export function parseW06PartiesFromExcelRows(rows, fileName = '', { supplierList = false } = {}) {
  const byKey = new Map()

  for (const row of rows || []) {
    const name = String(row.contractorName || '').trim()
    if (!name || isAgromarParty(name)) continue

    const docKind = detectW06DocKind(`${row.documentType || ''} ${row.documentNo || ''}`, fileName)
    const partyType = docKind === 'WZ' ? 'recipient' : 'supplier'
    const nip = normalizeNip(row.nip)
    const dedupeKey = w06DedupeKey({ company_name: name, nip })
    if (!dedupeKey) continue

    const product = supplierList
      ? ''
      : w06SanitizeSupplierProduct(name, row.productName)
    const existing = byKey.get(dedupeKey)

    if (existing) {
      if (product && !existing._items.includes(product)) {
        existing._items.push(product)
        existing.item_name = existing._items.slice(0, 5).join('; ').slice(0, 160)
      }
      if (!existing.nip && nip) existing.nip = nip
      continue
    }

    byKey.set(dedupeKey, {
      party_type: partyType,
      company_name: name.slice(0, 200),
      supplier_name: name.slice(0, 200),
      nip,
      address: String(row.address || '').trim().slice(0, 240),
      item_name: product.slice(0, 160),
      supplier_kind: partyType === 'recipient' ? 'recipient' : 'raw',
      source_doc_kind: docKind === 'unknown' ? String(row.documentType || 'Excel').slice(0, 12) : docKind,
      source_filename: fileName,
      dedupe_key: dedupeKey,
      _items: product ? [product] : []
    })
  }

  const parties = [...byKey.values()].map(({ _items, ...party }) => party)
  return {
    kind: 'excel',
    parties,
    preview: buildW06ExcelPreview(rows, parties),
    rowCount: (rows || []).length
  }
}

function enrichContractorsByDocument(rows) {
  const byDoc = new Map()
  for (const row of rows || []) {
    const key = String(row.documentNo || '').trim() || `_r${row.rowNo}`
    if (!byDoc.has(key)) byDoc.set(key, [])
    byDoc.get(key).push(row)
  }

  function findInGroup(group) {
    for (const r of group) {
      const c = String(r.contractorName || '').trim()
      if (c && !isAgromarParty(c)) return c
    }
    for (const r of group) {
      for (const val of Object.values(r)) {
        const s = String(val ?? '').trim()
        if (s.length < 4 || s.length > 160) continue
        if (isAgromarParty(s)) continue
        if (/^(pz|wz|mm|rr|fv|fs)[\/\s-]/i.test(s)) continue
        if (/^\d+([,.]\d+)?$/.test(s.replace(/\s/g, ''))) continue
        if (/^\d{4}-\d{2}-\d{2}|^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(s)) continue
        if (/faktura\s*vat|vat\s*rr/i.test(s)) continue
        if (/^(truskawka|malina|jabłko|jablko|gruszka|aronia|śliwka|wisnia|porzeczka|skrzynia|paleta|karton)$/i.test(s)) continue
        if (/sp\.?\s*z\.?\s*o\.?|spółka|gospodarstwo|rolno|sadown|przedsiębior/i.test(s)) return s
        if (/^[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+(\s+[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+){1,3}$/.test(s)) return s
      }
    }
    return ''
  }

  for (const group of byDoc.values()) {
    const contractor = findInGroup(group)
    if (!contractor) continue
    for (const r of group) {
      if (!r.contractorName || isAgromarParty(r.contractorName)) r.contractorName = contractor
    }
  }
  return rows
}

export function listW06ImportBatches(docs) {
  const map = new Map()
  for (const doc of docs || []) {
    const fn = doc.data?.source_filename
    if (!fn) continue
    map.set(fn, (map.get(fn) || 0) + 1)
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'pl'))
    .map(([name, count]) => ({ name, count }))
}

export async function parseW06FromExcelFile(file) {
  const buffer = await file.arrayBuffer()
  const supplierList = parseW06SupplierListWorkbook(buffer, file.name)
  if (supplierList.parties?.length) {
    return {
      text: supplierList.preview,
      unreadable: false,
      parties: supplierList.parties,
      party: supplierList.parties[0] || null,
      rowCount: supplierList.rowCount,
      kind: supplierList.kind
    }
  }

  const { rows } = await readAgromarExcel(file)
  const enriched = enrichContractorsByDocument(rows)
  const parsed = parseW06PartiesFromExcelRows(enriched, file.name)
  if (parsed.parties.length) {
    return {
      text: parsed.preview,
      unreadable: false,
      parties: parsed.parties,
      party: parsed.parties[0] || null,
      rowCount: parsed.rowCount,
      kind: parsed.kind
    }
  }

  if (supplierList.detected) {
    return {
      text: supplierList.preview,
      unreadable: true,
      parties: [],
      party: null,
      rowCount: 0,
      kind: supplierList.kind
    }
  }

  return {
    text: parsed.preview || supplierList.preview,
    unreadable: !parsed.parties.length,
    parties: parsed.parties,
    party: parsed.parties[0] || null,
    rowCount: parsed.rowCount,
    kind: parsed.kind
  }
}

export function isW06ExcelFile(file) {
  const name = String(file?.name || '').toLowerCase()
  const type = String(file?.type || '').toLowerCase()
  return /\.xlsx?$/.test(name) || type.includes('spreadsheet') || type.includes('excel')
}

export function existingW06DedupeKeys(docs) {
  const keys = new Set()
  for (const doc of docs || []) {
    const k = w06CompositeMatchKey(doc)
    if (k) keys.add(k)
  }
  return keys
}

export function filterNewW06Parties(existingDocs, parties) {
  const keys = existingW06DedupeKeys(existingDocs)
  const added = []
  const skipped = []
  for (const party of parties) {
    const kind = party.supplier_kind || (party.party_type === 'recipient' ? 'recipient' : 'raw')
    const mk = party.dedupe_key || w06DedupeKey(party)
    const key = mk ? `${kind}|${mk}` : ''
    if (!key) {
      skipped.push({ party, reason: 'brak nazwy/NIP' })
      continue
    }
    if (keys.has(key)) {
      skipped.push({ party, reason: 'już na liście' })
      continue
    }
    keys.add(key)
    added.push({ ...party, dedupe_key: mk })
  }
  return { added, skipped }
}

export function sortW06Docs(docs) {
  return [...(docs || [])].sort((a, b) => {
    const ta = a.data?.party_type === 'recipient' ? 1 : 0
    const tb = b.data?.party_type === 'recipient' ? 1 : 0
    if (ta !== tb) return ta - tb
    const aa = a.data?.accepted ? 1 : 0
    const ab = b.data?.accepted ? 1 : 0
    if (aa !== ab) return ab - aa
    if (aa && ab) {
      const ao = Number(a.data?.accepted_order || 0)
      const bo = Number(b.data?.accepted_order || 0)
      if (bo !== ao) return bo - ao
    }
    return String(a.data?.company_name || a.data?.supplier_name || '').localeCompare(
      String(b.data?.company_name || b.data?.supplier_name || ''), 'pl'
    )
  })
}

export function w06ParseItemList(itemName) {
  return String(itemName || '')
    .split(/[;,]/)
    .map(s => s.trim())
    .filter(Boolean)
}

/** Scala nowy owoc/surowiec z istniejącą listą (bez duplikatów). */
export function w06MergeItemNames(current, addition) {
  const add = String(addition || '').trim()
  if (!add) return w06ParseItemList(current).join('; ').slice(0, 160)
  const parts = w06ParseItemList(current)
  const key = add.toLowerCase()
  if (parts.some(p => p.toLowerCase() === key)) return parts.join('; ').slice(0, 160)
  parts.push(add)
  return parts.join('; ').slice(0, 160)
}

export function w06RemoveItemName(current, toRemove) {
  const rem = String(toRemove || '').trim().toLowerCase()
  if (!rem) return w06ParseItemList(current).join('; ').slice(0, 160)
  return w06ParseItemList(current)
    .filter(p => p.toLowerCase() !== rem)
    .join('; ')
    .slice(0, 160)
}

export function w06ApplyDefaultRawItems(itemName, supplierKind = 'raw', companyName = '') {
  if (supplierKind === 'recipient' || supplierKind === 'aux') {
    return w06CleanItemListForSupplier(itemName, companyName).slice(0, 160)
  }
  let cur = w06CleanItemListForSupplier(itemName, companyName)
  for (const fruit of W06_DEFAULT_RAW_ITEMS) {
    cur = w06MergeItemNames(cur, fruit)
  }
  return cur.slice(0, 160)
}

function w06LongestCompanyName(docs) {
  let best = ''
  for (const doc of docs || []) {
    const n = String(doc.data?.company_name || doc.data?.supplier_name || '').trim()
    if (n.length > best.length) best = n
  }
  return best
}

export function pickW06CanonicalDoc(group) {
  return [...(group || [])].sort((a, b) => {
    const aa = a.data?.accepted ? 1 : 0
    const ab = b.data?.accepted ? 1 : 0
    if (ab !== aa) return ab - aa
    const ao = Number(a.data?.accepted_order || 0)
    const bo = Number(b.data?.accepted_order || 0)
    if (bo !== ao) return bo - ao
    const la = String(a.data?.company_name || a.data?.supplier_name || '').length
    const lb = String(b.data?.company_name || b.data?.supplier_name || '').length
    if (lb !== la) return lb - la
    return String(a.id || '').localeCompare(String(b.id || ''))
  })[0]
}

/** Plan scalenia duplikatów tej samej firmy w tej samej kategorii (surowiec / aux / odbiorca). */
export function planW06DuplicateRepairs(docs) {
  const map = new Map()
  for (const doc of docs || []) {
    if (doc.document_type !== 'W06') continue
    const key = w06CompositeMatchKey(doc)
    if (!key) continue
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(doc)
  }
  const plans = []
  for (const group of map.values()) {
    if (group.length <= 1) continue
    const keep = pickW06CanonicalDoc(group)
    const remove = group.filter(d => d.id !== keep.id)
    let item_name = w06ItemLine(keep)
    let accepted = !!keep.data?.accepted
    let accepted_order = Number(keep.data?.accepted_order || 0)
    let nip = keep.data?.nip || ''
    for (const d of group) {
      item_name = w06MergeItemNames(item_name, w06ItemLine(d))
      if (d.data?.accepted) {
        accepted = true
        accepted_order = Math.max(accepted_order, Number(d.data?.accepted_order || 0))
      }
      if (!nip && d.data?.nip) nip = d.data.nip
    }
    const kind = w06KindPartitionKey(keep)
    item_name = w06ApplyDefaultRawItems(item_name, kind, company_name)
    const company_name = w06LongestCompanyName(group)
    const address = keep.data?.address || group.map(d => d.data?.address).find(Boolean) || ''
    const supplier_name = address ? `${company_name}, ${address}` : company_name
    const dedupe_key = w06MatchKeyFromDoc({ data: { ...keep.data, company_name, nip } })
    plans.push({
      keep,
      remove,
      patch: {
        company_name,
        supplier_name,
        nip,
        address,
        item_name,
        accepted,
        accepted_order: accepted ? accepted_order || Date.now() : 0,
        dedupe_key
      }
    })
  }
  return plans
}

export function buildW06InsertPayload(party) {
  const dedupe_key = party.dedupe_key || w06DedupeKey(party)
  const data = {
    party_type: party.party_type || 'supplier',
    supplier_kind: party.supplier_kind || (party.party_type === 'recipient' ? 'recipient' : 'raw'),
    company_name: party.company_name || party.supplier_name || '',
    supplier_name: party.supplier_name || party.company_name || '',
    nip: party.nip || '',
    address: party.address || '',
    item_name: w06ApplyDefaultRawItems(party.item_name || '', data.supplier_kind, data.company_name),
    source_doc_kind: party.source_doc_kind || '',
    source_filename: party.source_filename || '',
    dedupe_key,
    accepted: !!party.accepted,
    accepted_order: party.accepted_order ? Number(party.accepted_order) : 0
  }
  return {
    document_type: 'W06',
    document_date: new Date().toISOString().slice(0, 10),
    product_name: data.item_name || data.company_name,
    supplier_name: data.supplier_name,
    document_no: `W06/${dedupe_key.slice(0, 40)}`,
    status: 'P',
    data,
    qty: 0,
    document_version: 'I/2024',
    updated_at: new Date().toISOString()
  }
}

export function w06PartyLabel(doc) {
  return W06_PARTY_LABELS[doc?.data?.party_type] || W06_PARTY_LABELS.supplier
}

export function w06KindLabel(doc) {
  const k = doc?.data?.supplier_kind
  return W06_KIND_LABELS[k] || W06_KIND_LABELS.raw
}

export function w06CompanyLine(doc) {
  if (!doc) return ''
  const d = doc.data || {}
  return d.supplier_name || [d.company_name, d.address].filter(Boolean).join(', ') || d.company_name || ''
}

export function w06ItemLine(doc) {
  if (!doc) return ''
  const d = doc.data || {}
  return d.item_name || doc.product_name || ''
}

/** Surowiec | materiały pom. | odbiorcy (poza wzorem Word – import WZ). */
export function w06PartitionDocs(docs = []) {
  const raw = []
  const aux = []
  const recipients = []
  for (const doc of sortW06Docs(docs)) {
    const d = doc.data || {}
    if (d.party_type === 'recipient' || d.supplier_kind === 'recipient') recipients.push(doc)
    else if (d.supplier_kind === 'aux') aux.push(doc)
    else raw.push(doc)
  }
  return { raw, aux, recipients }
}

export function w06PaddedRows(docs = [], minRows = W06_MIN_ROWS) {
  const sorted = sortW06Docs(docs)
  const n = Math.max(minRows, sorted.length)
  return Array.from({ length: n }, (_, i) => ({ lp: i + 1, doc: sorted[i] || null }))
}

export function buildW06PrintHtml(docs, escapeHtml) {
  const { raw, aux } = w06PartitionDocs(docs)
  const rawRows = w06PaddedRows(raw)
  const auxRows = w06PaddedRows(aux)
  const rowCount = Math.max(rawRows.length, auxRows.length)
  while (rawRows.length < rowCount) rawRows.push({ lp: rawRows.length + 1, doc: null })
  while (auxRows.length < rowCount) auxRows.push({ lp: auxRows.length + 1, doc: null })
  const company = W06_HEADER.companyLines.map(l => escapeHtml(l)).join('<br/>')
  const paired = Array.from({ length: rowCount }, (_, i) => {
    const r = rawRows[i]
    const a = auxRows[i]
    return `<tr>
      <td>${r.lp}</td><td class="left">${escapeHtml(w06CompanyLine(r.doc))}</td><td class="left">${escapeHtml(w06ItemLine(r.doc))}</td>
      <td class="gap"></td>
      <td>${a.lp}</td><td class="left">${escapeHtml(w06CompanyLine(a.doc))}</td><td class="left">${escapeHtml(w06ItemLine(a.doc))}</td>
    </tr>`
  }).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>W06</title>
<style>@page{size:A4 landscape;margin:8mm}body{font-family:"Times New Roman",serif;color:#111;margin:0;font-size:10pt}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #111;padding:4px 5px;text-align:center;vertical-align:middle;font-size:9.5pt;line-height:1.15}
.left{text-align:left;vertical-align:top}.company{width:30%;font-weight:bold;text-align:left;line-height:1.2}
.title{width:44%;text-align:center;font-weight:bold;font-size:12pt;line-height:1.25}.meta{width:26%;text-align:left;font-size:10pt;vertical-align:top}
.head td{border:1px solid #111;padding:5px}.lp{width:5%}.gap{width:1%;border:none!important;background:transparent!important}
.section-head th{font-size:8.5pt;font-weight:bold;line-height:1.1;padding:5px 3px}
@media print{button{display:none}}</style></head><body>
<table class="head"><tbody>
<tr><td class="company" rowspan="3">${company}</td><td class="title" rowspan="2"><b>${escapeHtml(W06_HEADER.title)}</b></td><td class="meta"><b>Wersja</b> ${escapeHtml(W06_HEADER.version)}</td></tr>
<tr><td class="meta"><b>Data wydania:</b> ${escapeHtml(W06_HEADER.issueDateLabel)}</td></tr>
<tr><td></td><td class="meta"><b>Strona:</b> 1 z 1</td></tr>
</tbody></table>
<table style="margin-top:8px"><thead><tr class="section-head">
<th class="lp">Lp.</th><th class="left">${escapeHtml(W06_RAW_SUPPLIER_HEAD)}</th><th class="left">Nazwa surowca</th>
<th class="gap"></th>
<th class="lp">Lp.</th><th class="left">${escapeHtml(W06_AUX_SUPPLIER_HEAD)}</th><th class="left">Nazwa towaru</th>
</tr></thead><tbody>${paired}</tbody></table>
<script>window.onload=function(){setTimeout(function(){window.focus();window.print()},700)}</script></body></html>`
}

export function buildW06ExcelRows(docs) {
  const { raw, aux } = w06PartitionDocs(docs)
  const rawRows = w06PaddedRows(raw)
  const auxRows = w06PaddedRows(aux)
  const rowCount = Math.max(rawRows.length, auxRows.length)
  while (rawRows.length < rowCount) rawRows.push({ lp: rawRows.length + 1, doc: null })
  while (auxRows.length < rowCount) auxRows.push({ lp: auxRows.length + 1, doc: null })
  const rows = [
    W06_HEADER.companyLines,
    [W06_HEADER.title, '', '', '', `Wersja ${W06_HEADER.version}`, `Data wydania: ${W06_HEADER.issueDateLabel}`],
    [],
    ['Lp.', W06_RAW_SUPPLIER_HEAD, 'Nazwa surowca', '', 'Lp.', W06_AUX_SUPPLIER_HEAD, 'Nazwa towaru']
  ]
  for (let i = 0; i < rowCount; i++) {
    const r = rawRows[i]
    const a = auxRows[i]
    rows.push([
      r.lp, w06CompanyLine(r.doc), w06ItemLine(r.doc), '',
      a.lp, w06CompanyLine(a.doc), w06ItemLine(a.doc)
    ])
  }
  return rows
}
