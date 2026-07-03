import * as XLSX from 'xlsx'

const REQUIRED = {
  documentType: ['Rodzaj', 'Typ', 'Dokument', 'Rodzaj dokumentu'],
  documentNo: ['Nr', 'Numer', 'Nr dokumentu', 'Nr faktury', 'Numer faktury', 'Nr Faktury', 'Numer dokumentu'],
  issueDate: ['Data wystawienia', 'Data', 'Data dokumentu', 'Data wystawienia dokumentu'],
  qty: ['Ilość.1', 'Ilość', 'Ilosc', 'Qty'],
  productName: ['Produkt/usługa', 'Produkt', 'Towar', 'Nazwa produktu', 'Asortyment', 'Surowiec', 'Nazwa towaru', 'Materiał'],
  // Przy PZ/MM dostawcą NIE jest AGRO-MAR z kolumny „Odbiorca”.
  // Najpierw bierzemy faktycznego dostawcę z kolumn „Dostawca/Nadawca”,
  // a „Odbiorca” zostawiamy dla WZ/FV jako klienta/odbiorcę.
  supplierName: ['Dostawca', 'Nadawca', 'Dane dostawcy', 'Nazwa dostawcy', 'Sprzedawca', 'Producent', 'Rolnik', 'Wystawca', 'Kontrahent', 'Dostawca / Odbiorca', 'Dostawca/Odbiorca'],
  receiverName: ['Odbiorca', 'Nabywca', 'Dane odbiorcy', 'Nazwa odbiorcy', 'Klient', 'Kontrahent odbiorcy'],
  nip: ['NIP', 'Nip', 'NIP kontrahenta', 'Nip dostawcy', 'Nip odbiorcy'],
  invoiceNo: ['Faktura', 'Nr faktury', 'Numer faktury'],
  notes: ['Uwagi', 'Opis']
}

function normalizeHeader(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function pick(row, names) {
  const keys = Object.keys(row)
  for (const wanted of names) {
    const w = normalizeHeader(wanted)
    const found = keys.find(k => normalizeHeader(k) === w)
    if (found && row[found] !== '') return row[found]
  }
  for (const wanted of names) {
    const w = normalizeHeader(wanted)
    const found = keys.find(k => {
      const kn = normalizeHeader(k)
      return kn.includes(w) || w.includes(kn)
    })
    if (found && row[found] !== '') return row[found]
  }
  return ''
}

function inferDocumentType(documentType, documentNo) {
  const t = String(documentType || '').trim()
  if (t) return t
  const n = String(documentNo || '').trim().toUpperCase()
  if (/^RR[\/\s-]|\/RR\//.test(n) || n.startsWith('RR/')) return 'Faktura RR'
  if (/^PZ[\/\s-]|\/PZ\//.test(n) || n.startsWith('PZ/')) return 'PZ'
  if (/^WZ[\/\s-]|\/WZ\//.test(n) || n.startsWith('WZ/')) return 'WZ'
  if (/^FV[\/\s-]|^FS[\/\s-]/.test(n)) return 'FV'
  return t
}

function findHeaderRowIndex(sheet) {
  if (!sheet?.['!ref']) return 0
  const range = XLSX.utils.decode_range(sheet['!ref'])
  for (let r = range.s.r; r <= Math.min(range.s.r + 10, range.e.r); r++) {
    const parts = []
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })]
      if (cell?.v != null && cell.v !== '') parts.push(String(cell.v))
    }
    const line = parts.join(' ').toLowerCase()
    if (/rodzaj|dostawca|odbiorca|produkt|towar|nabywca|sprzedawca/.test(line)) return r
  }
  return 0
}

function pickContractorFromRow(row, documentType, documentNo) {
  const text = `${documentType || ''} ${documentNo || ''}`.toUpperCase()
  const supplier = String(pick(row, REQUIRED.supplierName) || '').trim()
  const receiver = String(pick(row, REQUIRED.receiverName) || '').trim()
  const isInbound = /PZ|MM|PRZYJ/.test(text)
  const isOutbound = /WZ|FV|FS|RR|FAKTURA|WYDANIE/.test(text)

  if (isInbound) {
    if (supplier && !isAgromarName(supplier)) return supplier
    if (receiver && !isAgromarName(receiver)) return receiver
  } else if (isOutbound) {
    if (receiver && !isAgromarName(receiver)) return receiver
    if (supplier && !isAgromarName(supplier)) return supplier
  } else {
    if (supplier && !isAgromarName(supplier)) return supplier
    if (receiver && !isAgromarName(receiver)) return receiver
  }

  for (const [key, val] of Object.entries(row)) {
    const s = String(val ?? '').trim()
    if (s.length < 3 || s.length > 160) continue
    if (isAgromarName(s)) continue
    if (/^\d+([,.]\d+)?$/.test(s.replace(/\s/g, ''))) continue
    if (/^\d{4}-\d{2}-\d{2}|^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(s)) continue
    if (/^(pz|wz|mm|rr|fv|fs)[\/\s-]/i.test(s)) continue
    const kn = normalizeHeader(key)
    if (/produkt|towar|ilo|warto|data|magazyn|utworz|uwag|netto|brutto|cena|vat|lp$|rabat|jm|j\.m/.test(kn)) continue
    if (/dostawca|odbiorca|nabywca|sprzedawca|kontrahent|rolnik|klient|firma|nazwa/.test(kn)) return s
  }

  for (const val of Object.values(row)) {
    const s = String(val ?? '').trim()
    if (s.length < 4 || s.length > 160) continue
    if (isAgromarName(s)) continue
    if (/truskawka|malina|jabłk|jabl|gruszk|aroni|śliwk|wisn|porzecz|skrzyn|palet|karton|worek/i.test(s) && s.length < 40) continue
    if (/sp\.?\s*z\.?\s*o\.?|spółka|gospodarstwo|rolno|sadown|firma|przedsiębior|wielkopolsk|mazowieck/i.test(s)) return s
  }

  return ''
}

function forwardFillExcelRows(rows) {
  const out = []
  let last = { documentType: '', documentNo: '', contractorName: '', nip: '' }

  for (const row of rows) {
    const documentType = inferDocumentType(row.documentType, row.documentNo)
    const documentNo = String(row.documentNo || '').trim() || last.documentNo
    let contractorName = String(row.contractorName || '').trim()
    if (contractorName && !isAgromarName(contractorName)) {
      last.contractorName = contractorName
    } else if (!contractorName && last.contractorName) {
      contractorName = last.contractorName
    }
    const nip = row.nip || last.nip
    if (row.nip) last.nip = row.nip
    if (documentType) last.documentType = documentType
    if (row.documentNo) last.documentNo = row.documentNo

    out.push({
      ...row,
      documentType: documentType || last.documentType,
      documentNo,
      contractorName: contractorName && !isAgromarName(contractorName) ? contractorName : pickContractorFromRow(row, documentType || last.documentType, documentNo),
      nip
    })
  }
  return out
}

function parseExcelDate(value) {
  if (!value) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`
  }
  const text = String(value).trim()
  const parts = text.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/)
  if (parts) return `${parts[3]}-${parts[2].padStart(2, '0')}-${parts[1].padStart(2, '0')}`
  return text
}

function parseQty(value) {
  if (typeof value === 'number') return value
  const text = String(value ?? '').replace(/\s/g, '').replace(',', '.')
  const n = Number.parseFloat(text)
  return Number.isFinite(n) ? n : 0
}

function isAgromarName(value) {
  return /agro[-\s]?mar|mariusz\s+bańka|mariusz\s+banka/i.test(String(value || ''))
}

function normalizeNip(value) {
  const d = String(value || '').replace(/\D/g, '')
  return d.length === 10 ? d : ''
}

function pickContractorForRow(row, documentType, documentNo) {
  return pickContractorFromRow(row, documentType, documentNo)
}

export async function readAgromarExcel(file) {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  const headerRow = findHeaderRowIndex(sheet)
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', range: headerRow })

  const mapped = rows
    .map((row, index) => {
      let documentType = String(pick(row, REQUIRED.documentType)).trim()
      let documentNo = String(pick(row, REQUIRED.documentNo)).trim()
      if (!documentNo) {
        for (const val of Object.values(row)) {
          const s = String(val || '').trim()
          if (/^(PZ|WZ|MM|RR|FV|FS)[\/\s-][\w/.-]+/i.test(s)) {
            documentNo = s.match(/((?:PZ|WZ|MM|RR|FV|FS)[\/\s-][\w/.-]+)/i)?.[1] || s
            break
          }
        }
      }
      documentType = inferDocumentType(documentType, documentNo)
      return {
        rowNo: headerRow + index + 2,
        documentType,
        documentNo,
        issueDate: parseExcelDate(pick(row, REQUIRED.issueDate)),
        qty: parseQty(pick(row, REQUIRED.qty)),
        productName: String(pick(row, REQUIRED.productName)).trim(),
        contractorName: pickContractorFromRow(row, documentType, documentNo),
        nip: normalizeNip(pick(row, REQUIRED.nip)),
        invoiceNo: String(pick(row, REQUIRED.invoiceNo)).trim(),
        notes: String(pick(row, REQUIRED.notes)).trim(),
      }
    })
    .filter(row => row.documentNo || row.productName || row.qty || row.contractorName)

  return forwardFillExcelRows(mapped)
}

export function classifyOperation(documentType, documentNo) {
  const text = `${documentType} ${documentNo}`.toUpperCase()
  // Przyjęcia na magazyn: PZ oraz przesunięcia magazynowe MM.
  if (text.includes('PZ') || text.includes('MM')) return 'przyjecie'
  // Rozchody/sprzedaż: WZ, FV, FS. Ilości w Excelu mogą być ujemne, ale w bazie zapisujemy je jako dodatni rozchód.
  if (text.includes('WZ') || text.includes('FV') || text.includes('FS') || text.includes('RR')) return 'sprzedaz'
  return 'przyjecie'
}
