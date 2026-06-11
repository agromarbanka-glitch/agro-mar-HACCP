import * as XLSX from 'xlsx'

const REQUIRED = {
  documentType: ['Rodzaj', 'Typ', 'Dokument'],
  documentNo: ['Nr', 'Numer', 'Nr dokumentu'],
  issueDate: ['Data wystawienia', 'Data', 'Data dokumentu'],
  qty: ['Ilość.1', 'Ilość', 'Ilosc', 'Qty'],
  productName: ['Produkt/usługa', 'Produkt', 'Towar', 'Nazwa produktu'],
  contractorName: ['Odbiorca', 'Kontrahent', 'Dostawca'],
  invoiceNo: ['Faktura', 'Nr faktury', 'Numer faktury'],
  notes: ['Uwagi', 'Opis']
}

function normalizeHeader(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function pick(row, names) {
  const keys = Object.keys(row)
  for (const wanted of names) {
    const found = keys.find(k => normalizeHeader(k) === normalizeHeader(wanted))
    if (found) return row[found]
  }
  return ''
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

export async function readAgromarExcel(file) {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheetName = workbook.SheetNames[0]
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' })

  return rows
    .map((row, index) => ({
      rowNo: index + 2,
      documentType: String(pick(row, REQUIRED.documentType)).trim(),
      documentNo: String(pick(row, REQUIRED.documentNo)).trim(),
      issueDate: parseExcelDate(pick(row, REQUIRED.issueDate)),
      qty: parseQty(pick(row, REQUIRED.qty)),
      productName: String(pick(row, REQUIRED.productName)).trim(),
      contractorName: String(pick(row, REQUIRED.contractorName)).trim(),
      invoiceNo: String(pick(row, REQUIRED.invoiceNo)).trim(),
      notes: String(pick(row, REQUIRED.notes)).trim(),
    }))
    .filter(row => row.documentNo || row.productName || row.qty)
}

export function classifyOperation(documentType, documentNo) {
  const text = `${documentType} ${documentNo}`.toUpperCase()
  if (text.includes('PZ')) return 'przyjecie'
  if (text.includes('WZ') || text.includes('FV') || text.includes('FS')) return 'sprzedaz_bez_produkcji'
  return 'przyjecie'
}
