import * as XLSX from 'xlsx'

const REQUIRED = {
  documentType: ['Rodzaj', 'Typ', 'Dokument'],
  documentNo: ['Nr', 'Numer', 'Nr dokumentu'],
  issueDate: ['Data wystawienia', 'Data', 'Data dokumentu'],
  qty: ['Ilość.1', 'Ilość', 'Ilosc', 'Qty'],
  productName: ['Produkt/usługa', 'Produkt', 'Towar', 'Nazwa produktu'],
  // Przy PZ/MM dostawcą NIE jest AGRO-MAR z kolumny „Odbiorca”.
  // Najpierw bierzemy faktycznego dostawcę z kolumn „Dostawca/Nadawca”,
  // a „Odbiorca” zostawiamy dla WZ/FV jako klienta/odbiorcę.
  supplierName: ['Dostawca', 'Nadawca', 'Dane dostawcy', 'Nazwa dostawcy', 'Sprzedawca', 'Producent', 'Rolnik', 'Wystawca', 'Kontrahent'],
  receiverName: ['Odbiorca', 'Nabywca', 'Dane odbiorcy', 'Nazwa odbiorcy'],
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

function isAgromarName(value) {
  return /agro[-\s]?mar|mariusz\s+bańka|mariusz\s+banka/i.test(String(value || ''))
}

function pickContractorForRow(row, documentType, documentNo) {
  const text = `${documentType || ''} ${documentNo || ''}`.toUpperCase()
  const supplier = String(pick(row, REQUIRED.supplierName) || '').trim()
  const receiver = String(pick(row, REQUIRED.receiverName) || '').trim()

  // PZ/MM = przyjęcie, więc kontrahent w systemie to faktyczny dostawca.
  // Jeśli w Excelu kolumna „Odbiorca” zawiera AGRO-MAR, nie używamy jej jako dostawcy.
  if (text.includes('PZ') || text.includes('MM')) {
    if (supplier && !isAgromarName(supplier)) return supplier
    // W PZ/MM kolumna Odbiorca bardzo często oznacza AGRO-MAR, czyli odbiorcę dostawy, a nie dostawcę.
    // Nie wpisujemy AGRO-MAR jako dostawcy; jeśli faktycznego dostawcy nie ma w eksporcie, zostawiamy puste
    // i można go uzupełnić w K01 przy konkretnym PZ.
    if (receiver && !isAgromarName(receiver)) return receiver
    return ''
  }

  // WZ/FV/FS = rozchód, więc kontrahentem jest odbiorca/klient.
  if (receiver && !isAgromarName(receiver)) return receiver
  if (supplier && !isAgromarName(supplier)) return supplier
  return receiver || supplier || ''
}

export async function readAgromarExcel(file) {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheetName = workbook.SheetNames[0]
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' })

  return rows
    .map((row, index) => {
      const documentType = String(pick(row, REQUIRED.documentType)).trim()
      const documentNo = String(pick(row, REQUIRED.documentNo)).trim()
      return {
        rowNo: index + 2,
        documentType,
        documentNo,
        issueDate: parseExcelDate(pick(row, REQUIRED.issueDate)),
        qty: parseQty(pick(row, REQUIRED.qty)),
        productName: String(pick(row, REQUIRED.productName)).trim(),
        contractorName: pickContractorForRow(row, documentType, documentNo),
        invoiceNo: String(pick(row, REQUIRED.invoiceNo)).trim(),
        notes: String(pick(row, REQUIRED.notes)).trim(),
      }
    })
    .filter(row => row.documentNo || row.productName || row.qty)
}

export function classifyOperation(documentType, documentNo) {
  const text = `${documentType} ${documentNo}`.toUpperCase()
  // Przyjęcia na magazyn: PZ oraz przesunięcia magazynowe MM.
  if (text.includes('PZ') || text.includes('MM')) return 'przyjecie'
  // Rozchody/sprzedaż: WZ, FV, FS. Ilości w Excelu mogą być ujemne, ale w bazie zapisujemy je jako dodatni rozchód.
  if (text.includes('WZ') || text.includes('FV') || text.includes('FS')) return 'sprzedaz'
  return 'przyjecie'
}
