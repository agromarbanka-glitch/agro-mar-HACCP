/**
 * W06 – kwalifikowani dostawcy i odbiorcy (import PDF PZ/WZ, deduplikacja).
 */
import { extractPdfData, isReadablePdfText, rebuildTextFromItems } from './pdfImportEngine.js'
import { isReadableName } from './k011InvoiceParser.js'

export const W06_ENGINE_VERSION = '1.3'
export const AGRO_MAR_NIP = '7171839598'

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

export function w06DedupeKey(party) {
  const nip = normalizeNip(party?.nip)
  if (nip) return `nip:${nip}`
  const name = normalizeText(party?.company_name || party?.supplier_name || party?.name || '')
  if (!name || name.length < 3) return ''
  return `name:${name.replace(/\bsp z oo\b/g, 'spzoo').replace(/[^\w\sąćęłńóśźż]/g, '').slice(0, 80)}`
}

export function detectW06DocKind(text, fileName = '') {
  const flat = `${text || ''} ${fileName || ''}`.toUpperCase()
  const fn = String(fileName).toUpperCase()
  if (/\bPZ[\s./_-]|\bPZ\b|PRZYJ[EĘ]CIE|PRZYJECIE\s+ZEWN|PRZYJ[EĘ]CIE\s+MAGAZ|DOKUMENT\s+PZ/.test(flat) || fn.includes('PZ')) return 'PZ'
  if (/\bMM[\s./_-]|\bMM\b|PRZESUN[IĘ]CIE/.test(flat) || fn.includes('MM')) return 'PZ'
  if (/\bWZ[\s./_-]|\bWZ\b|WYDANIE|WYDANIE\s+ZEWN|WYDANIE\s+MAGAZ|DOKUMENT\s+WZ/.test(flat) || fn.includes('WZ')) return 'WZ'
  if (/\bFS\b|\bFV\b|FAKTURA/.test(flat)) {
    const t = String(text || '')
    if (/nabywca[\s\S]{0,400}?7171839598/i.test(t) || /7171839598[\s\S]{0,400}?nabywca/i.test(t)) return 'PZ'
    if (/sprzedawca[\s\S]{0,400}?7171839598/i.test(t) || /7171839598[\s\S]{0,400}?sprzedawca/i.test(t)) return 'WZ'
    return 'PZ'
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
      itemName: '',
      textLength: 0,
      unreadable: true,
      pdfError: pdfError || null
    }
  }
  const parsed = parseW06PartiesFromPdfText(usableText, file.name)
  return { text: usableText, unreadable: false, pdfError: null, party: parsed.parties[0] || null, ...parsed }
}

export function existingW06DedupeKeys(docs) {
  const keys = new Set()
  for (const doc of docs || []) {
    const k = doc.data?.dedupe_key || w06DedupeKey({
      nip: doc.data?.nip,
      company_name: doc.data?.company_name || doc.data?.supplier_name,
      supplier_name: doc.data?.supplier_name
    })
    if (k) keys.add(k)
  }
  return keys
}

export function filterNewW06Parties(existingDocs, parties) {
  const keys = existingW06DedupeKeys(existingDocs)
  const added = []
  const skipped = []
  for (const party of parties) {
    const key = party.dedupe_key || w06DedupeKey(party)
    if (!key) {
      skipped.push({ party, reason: 'brak nazwy/NIP' })
      continue
    }
    if (keys.has(key)) {
      skipped.push({ party, reason: 'już na liście' })
      continue
    }
    keys.add(key)
    added.push({ ...party, dedupe_key: key })
  }
  return { added, skipped }
}

export function sortW06Docs(docs) {
  return [...(docs || [])].sort((a, b) => {
    const ta = a.data?.party_type === 'recipient' ? 1 : 0
    const tb = b.data?.party_type === 'recipient' ? 1 : 0
    if (ta !== tb) return ta - tb
    return String(a.data?.company_name || a.data?.supplier_name || '').localeCompare(
      String(b.data?.company_name || b.data?.supplier_name || ''), 'pl'
    )
  })
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
    item_name: party.item_name || '',
    source_doc_kind: party.source_doc_kind || '',
    source_filename: party.source_filename || '',
    dedupe_key
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

export function buildW06PrintHtml(docs, escapeHtml) {
  const sorted = sortW06Docs(docs)
  const rows = sorted.map((doc, i) => {
    const d = doc.data || {}
    return `<tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(w06PartyLabel(doc))}</td>
      <td class="left">${escapeHtml(d.supplier_name || d.company_name || '')}</td>
      <td>${escapeHtml(d.nip || '')}</td>
      <td class="left">${escapeHtml(d.item_name || doc.product_name || '')}</td>
      <td>${escapeHtml(d.source_doc_kind || '')}</td>
    </tr>`
  }).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>W06 – Dostawcy i odbiorcy</title>
<style>@page{size:A4 landscape;margin:10mm}body{font-family:"Times New Roman",serif;color:#111;margin:0;font-size:11pt}
table{width:100%;border-collapse:collapse}td,th{border:1px solid #111;padding:6px;text-align:center;font-size:10pt}
.left{text-align:left}.company{font-weight:bold;text-align:left}.title{text-align:center;font-weight:bold;font-size:13pt}
@media print{button{display:none}}</style></head><body>
<table><tr><td class="company">AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.<br/>24-335 ŁAZISKA, KOLONIA ŁAZISKA 30<br/>NIP: 7171839598</td>
<td class="title">Wykaz W06 – Wykaz kwalifikowanych dostawców i odbiorców</td>
<td>Wersja I/2024</td></tr></table>
<table style="margin-top:12px"><thead><tr>
<th>Lp.</th><th>Typ</th><th>Dane firmy</th><th>NIP</th><th>Towar / surowiec</th><th>Źródło</th>
</tr></thead><tbody>${rows}</tbody></table>
<script>window.onload=function(){setTimeout(function(){window.focus();window.print()},700)}</script></body></html>`
}

export function buildW06ExcelRows(docs) {
  const sorted = sortW06Docs(docs)
  return [
    ['AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.'],
    ['Wykaz W06 – kwalifikowani dostawcy i odbiorcy'],
    [],
    ['Lp.', 'Typ', 'Dane firmy', 'NIP', 'Towar / surowiec', 'Źródło dokumentu'],
    ...sorted.map((doc, i) => {
      const d = doc.data || {}
      return [i + 1, w06PartyLabel(doc), d.supplier_name || d.company_name || '', d.nip || '', d.item_name || doc.product_name || '', d.source_doc_kind || '']
    })
  ]
}
