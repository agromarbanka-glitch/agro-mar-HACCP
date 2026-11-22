import * as XLSX from 'xlsx'

const REQUIRED = {
  documentType: ['Rodzaj', 'Typ', 'Dokument', 'Rodzaj dokumentu'],
  // „Nr” w eksporcie Subiekta to często lp. wiersza (488) – prawdziwy PZ/WZ jest w osobnej kolumnie.
  documentNo: ['Nr dokumentu', 'Numer dokumentu', 'Nr faktury / PZ', 'Nr faktury / WZ', 'Nr faktury', 'Numer faktury', 'Nr Faktury', 'Numer faktury', 'Nr', 'Numer'],
  issueDate: ['Data wystawienia', 'Data wystaw', 'Data wysta', 'Data', 'Data dokumentu', 'Data wystawienia dokumentu'],
  productName: ['Produkt/usługa', 'Produkt/us', 'Produkt', 'Towar', 'Nazwa produktu', 'Asortyment', 'Surowiec', 'Nazwa towaru', 'Materiał'],
  // Przy PZ/MM dostawcą NIE jest AGRO-MAR z kolumny „Odbiorca”.
  supplierName: ['Dostawca', 'Nadawca', 'Dane dostawcy', 'Nazwa dostawcy', 'Sprzedawca', 'Producent', 'Rolnik', 'Wystawca', 'Kontrahent', 'Dostawca / Odbiorca', 'Dostawca/Odbiorca'],
  receiverName: ['Odbiorca', 'Nabywca', 'Dane odbiorcy', 'Nazwa odbiorcy', 'Klient', 'Kontrahent odbiorcy'],
  nip: ['NIP', 'Nip', 'NIP kontrahenta', 'Nip dostawcy', 'Nip odbiorcy'],
  invoiceNo: ['Faktura', 'Nr faktury', 'Numer faktury'],
  notes: ['Uwagi', 'Opis']
}

function normalizeHeader(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Ujednolicenie nr PZ/WZ do porównań (trim, bez spacji, slashe). */
export function normalizeDocumentNo(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/\\/g, '/')
}

/** Warianty nr do wyszukiwania w bazie — tylko format (spacja po prefiksie). Sufiks lokalizacji musi być identyczny. */
export function documentNoImportAliases(documentNo) {
  const norm = normalizeDocumentNo(documentNo)
  if (!norm) return []
  const out = new Set([norm])
  const prefixSpace = norm.match(/^(PZ|WZ|MM|RR|FV|FS)(\/.*)$/i)
  if (prefixSpace) out.add(`${prefixSpace[1]} ${prefixSpace[2]}`)
  return [...out]
}

const DOC_NO_PATTERN = /((?:PZ|WZ|MM|RR|FV|FS)(?:\/[^/\s,;]+)+)/i

/** Wyciąga pełny nr PZ/WZ z komórki (obsługa sufiksów z polskimi znakami: Chruślanki, Łaziska). */
export function extractWarehouseDocumentNo(value) {
  const s = String(value || '').trim()
  if (!s) return ''
  const m = s.match(DOC_NO_PATTERN)
  return m ? normalizeDocumentNo(m[1]) : ''
}

/** Prawdziwy numer magazynowy PZ/WZ/MM – nie lp. wiersza (488) ani sama data. */
export function looksLikeWarehouseDocumentNo(value) {
  return Boolean(extractWarehouseDocumentNo(value))
}

/** Szuka PZ/WZ/MM w komórkach wiersza; PZ/WZ ważniejsze od RR (RR bywa tylko odniesieniem faktury). */
export function findDocumentNoInRow(row) {
  const candidates = []
  for (const val of Object.values(row || {})) {
    const s = String(val || '').trim()
    if (!s) continue
    const m = s.match(DOC_NO_PATTERN)
    if (m) candidates.push(normalizeDocumentNo(m[1]))
  }
  for (const prefix of ['PZ', 'WZ', 'MM', 'FV', 'FS', 'RR']) {
    const found = candidates.find(c => c.toUpperCase().startsWith(prefix))
    if (found) return found
  }
  return candidates[0] || ''
}

/** Kolumna „Nr” często zwraca lp. (488) – wtedy szukamy PZ/WZ w całym wierszu. */
export function resolveDocumentNo(row, pickedFromColumn = '') {
  const picked = extractWarehouseDocumentNo(pickedFromColumn) || normalizeDocumentNo(pickedFromColumn)
  if (looksLikeWarehouseDocumentNo(picked)) return picked
  const scanned = findDocumentNoInRow(row)
  if (scanned) return scanned
  return picked
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

/** Klucze kolumn w kolejności arkusza (sheet_to_json zachowuje kolejność). */
function getSheetColumnKeys(sheet, headerRow) {
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', range: headerRow })
  return rows.length ? Object.keys(rows[0]) : []
}

function isQtyColumnKey(key) {
  const n = normalizeHeader(key)
  return /^ilo[sść]|ilosc|^qty$/.test(n)
}

function isNetUnitPriceColumnKey(key) {
  const n = normalizeHeader(key)
  if (/warto[sś]c.*netto|wartosc.*netto/.test(n)) return false
  if (/cena.*netto|^netto$/.test(n)) return true
  return false
}

function parseMoney(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const text = String(value ?? '').replace(/\s/g, '').replace(',', '.')
  const n = Number.parseFloat(text)
  return Number.isFinite(n) ? n : 0
}

/**
 * W eksporcie magazynowym są dwie kolumny „Cena netto”:
 * – pierwsza (przed produktem): często 0 / suma dokumentu,
 * – ostatnia (przy produkcie): cena jednostkowa pozycji.
 * Nie używamy kolumny „Wartość netto” (błędnie zsumowana na dokumencie).
 */
export function pickLineUnitNetPrice(row, orderedColumnKeys = []) {
  const priceKeys = (orderedColumnKeys.length ? orderedColumnKeys : Object.keys(row)).filter(isNetUnitPriceColumnKey)
  if (!priceKeys.length) return parseMoney(pick(row, ['Cena netto', 'Cena netto.1', 'Cena netto.2']))

  for (let i = priceKeys.length - 1; i >= 0; i -= 1) {
    const raw = row[priceKeys[i]]
    if (raw === '' || raw == null) continue
    const n = parseMoney(raw)
    if (n !== 0 || raw === 0 || raw === '0') return n
  }
  return 0
}

/**
 * W eksporcie magazynowym są dwie kolumny „Ilość”:
 * – pierwsza (przed produktem): suma całego PZ/WZ,
 * – ostatnia (przy produkcie): ilość danej pozycji.
 * Bierzemy ostatnią niepustą kolumnę ilości (od prawej).
 */
export function pickLineQty(row, orderedColumnKeys = []) {
  const qtyKeys = (orderedColumnKeys.length ? orderedColumnKeys : Object.keys(row)).filter(isQtyColumnKey)
  if (!qtyKeys.length) return parseQty(pick(row, ['Ilość', 'Ilość.1', 'Ilosc', 'Qty']))

  for (let i = qtyKeys.length - 1; i >= 0; i -= 1) {
    const raw = row[qtyKeys[i]]
    if (raw === '' || raw == null) continue
    const n = parseQty(raw)
    if (n !== 0 || raw === 0 || raw === '0') return n
  }
  return 0
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
    return ''
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

export function forwardFillExcelRows(rows) {
  const out = []
  let last = { documentType: '', documentNo: '', contractorName: '', nip: '', issueDate: '' }

  for (const row of rows) {
    const documentType = inferDocumentType(row.documentType, row.documentNo)
    let documentNo = String(row.documentNo || '').trim()
    if (!looksLikeWarehouseDocumentNo(documentNo)) {
      const scanned = findDocumentNoInRow(row)
      if (looksLikeWarehouseDocumentNo(scanned)) {
        const lastInbound = last.documentNo && /^(PZ|MM)/i.test(last.documentNo)
        // RR w wierszu pod PZ to zwykle powiązana faktura RR, nie osobny dokument.
        if (scanned.toUpperCase().startsWith('RR/') && lastInbound) {
          documentNo = last.documentNo
        } else {
          documentNo = scanned
        }
      }
    }
    if (!looksLikeWarehouseDocumentNo(documentNo) && last.documentNo) {
      const rowDateHint = String(row.issueDate || '').trim() || last.issueDate
      const dateAdvanced = rowDateHint && last.issueDate && rowDateHint > last.issueDate
      if (!dateAdvanced) documentNo = last.documentNo
    }

    const prevDocumentNo = last.documentNo
    if (looksLikeWarehouseDocumentNo(documentNo) && prevDocumentNo && documentNo !== prevDocumentNo) {
      // Nowy dokument — nie ustawiaj daty z numeru WZ (WZ/NNN/MM/RRRR nie ma dnia).
      last.issueDate = (documentNoHasExplicitDate(documentNo) && !isWzMonthYearDocument(documentNo))
        ? (inferDateFromDocumentNo(documentNo) || '')
        : ''
    }

    let issueDate = String(row.issueDate || '').trim()
    if (issueDate) {
      const resolved = resolveDocumentIssueDate(issueDate, documentNo)
      issueDate = resolved || issueDate
      last.issueDate = issueDate
    } else if (last.issueDate) {
      // Puste komórki daty pod pierwszym wierszem dokumentu = ta sama data co wyżej (ten sam nr).
      issueDate = last.issueDate
    } else if (looksLikeWarehouseDocumentNo(documentNo)) {
      issueDate = inferDateFromDocumentNo(documentNo)
      if (issueDate) last.issueDate = issueDate
    }

    let contractorName = String(row.contractorName || '').trim()
    if (contractorName && !isAgromarName(contractorName)) {
      last.contractorName = contractorName
    } else if (!contractorName && last.contractorName) {
      contractorName = last.contractorName
    }
    const nip = row.nip || last.nip
    if (row.nip) last.nip = row.nip
    if (documentType) last.documentType = documentType
    if (looksLikeWarehouseDocumentNo(documentNo)) last.documentNo = documentNo

    out.push({
      ...row,
      documentType: documentType || last.documentType,
      documentNo,
      issueDate,
      contractorName: contractorName && !isAgromarName(contractorName) ? contractorName : pickContractorFromRow(row, documentType || last.documentType, documentNo),
      nip
    })
  }
  return out
}

function parseExcelDate(value) {
  if (!value) return ''
  if (value instanceof Date) {
    // Lokalna data kalendarzowa — toISOString() przesuwał np. 29.06 na 28.06 (UTC).
    const y = value.getFullYear()
    const m = value.getMonth() + 1
    const d = value.getDate()
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`
  }
  const text = String(value).trim()
  const parts = text.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/)
  if (parts) return `${parts[3]}-${parts[2].padStart(2, '0')}-${parts[1].padStart(2, '0')}`
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  return ''
}

/** WZ/NNN/MM/RRRR — numer kolejny + miesiąc + rok; w numerze NIE MA dnia sprzedaży. */
export function isWzMonthYearDocument(documentNo) {
  const norm = normalizeDocumentNo(documentNo)
  return /^WZ\/\d+\/\d{1,2}\/\d{4}$/i.test(norm)
}

/** Czy numer PZ/WZ zawiera pełną datę DD/MM/RRRR (np. PZ/018/07/07/2026). Nie dotyczy WZ/009/06/2026. */
export function documentNoHasExplicitDate(documentNo) {
  const norm = normalizeDocumentNo(documentNo)
  if (isWzMonthYearDocument(norm)) return false
  return /\/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\/|$)/.test(norm)
}

/** Data z numeru PZ: pełna DD/MM/RRRR. WZ bez dnia w numerze zwraca ''. */
export function inferDateFromDocumentNo(documentNo) {
  const norm = normalizeDocumentNo(documentNo)
  if (isWzMonthYearDocument(norm)) return ''
  const full = norm.match(/\/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\/|$)/)
  if (full) {
    const day = Number(full[1])
    const month = Number(full[2])
    const year = Number(full[3])
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 2000 && year <= 2100) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
  }
  const m = norm.match(/\/(\d{1,2})\/(\d{4})$/)
  if (!m) return ''
  const month = Number(m[1])
  const year = Number(m[2])
  if (month < 1 || month > 12 || year < 2000 || year > 2100) return ''
  const lastDay = new Date(year, month, 0).getDate()
  return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
}

/** Miesiąc i rok z numeru dokumentu (WZ/009/07/2026 → lipiec 2026, PZ/022/30/06/2026 → czerwiec 2026). */
export function monthYearFromDocumentNo(documentNo) {
  const norm = normalizeDocumentNo(documentNo)
  if (!norm) return null

  if (isWzMonthYearDocument(norm)) {
    const m = norm.match(/^WZ\/\d+\/(\d{1,2})\/(\d{4})$/i)
    if (m) {
      const month = Number(m[1])
      const year = Number(m[2])
      if (month >= 1 && month <= 12 && year >= 2000 && year <= 2100) {
        return { month, year, kind: 'month_year' }
      }
    }
    return null
  }

  if (documentNoHasExplicitDate(norm)) {
    const full = norm.match(/\/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\/|$)/)
    if (full) {
      const day = Number(full[1])
      const month = Number(full[2])
      const year = Number(full[3])
      if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 2000 && year <= 2100) {
        return { month, year, day, kind: 'explicit_date' }
      }
    }
    return null
  }

  if (documentNoHasMonthYear(norm)) {
    const m = norm.match(/\/(\d{1,2})\/(\d{4})$/)
    if (m) {
      const month = Number(m[1])
      const year = Number(m[2])
      if (month >= 1 && month <= 12 && year >= 2000 && year <= 2100) {
        return { month, year, kind: 'month_year' }
      }
    }
  }
  return null
}

/** Czy numer ma miesiąc/rok na końcu (np. WZ/009/07/2026), bez dnia. */
export function documentNoHasMonthYear(documentNo) {
  const norm = normalizeDocumentNo(documentNo)
  if (isWzMonthYearDocument(norm)) return true
  if (documentNoHasExplicitDate(norm)) return false
  return /\/(\d{1,2})\/(\d{4})$/.test(norm)
}

/** Data dokumentu: WZ/NNN/MM/RRRR → wyłącznie Excel; PZ z dniem w nr → z numeru. */
export function resolveDocumentIssueDate(issueDate, documentNo) {
  const parsed = parseExcelDate(issueDate)
  const fromDocNo = inferDateFromDocumentNo(documentNo)
  if (isWzMonthYearDocument(documentNo)) return parsed || ''
  if (fromDocNo && documentNoHasExplicitDate(documentNo)) return fromDocNo
  if (parsed) return parsed
  if (fromDocNo && documentNoHasMonthYear(documentNo)) return fromDocNo
  return fromDocNo
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

/** Przesunięcia magazynowe MM – pomijane przy imporcie operacji. */
export function isMmDocument(documentType, documentNo) {
  const type = String(documentType || '').trim().toUpperCase()
  const no = String(documentNo || '').trim().toUpperCase()
  if (type === 'MM' || type.startsWith('MM/') || type.startsWith('MM ')) return true
  if (/^MM[\/\s_-]/.test(no)) return true
  return false
}

export async function readAgromarExcel(file, { skipMm = true, includeUnitPrice = false } = {}) {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  const headerRow = findHeaderRowIndex(sheet)
  const columnKeys = getSheetColumnKeys(sheet, headerRow)
  const sheetRows = XLSX.utils.sheet_to_json(sheet, { defval: '', range: headerRow })

  const mapped = sheetRows
    .map((row, index) => {
      let documentType = String(pick(row, REQUIRED.documentType)).trim()
      let documentNo = resolveDocumentNo(row, pick(row, REQUIRED.documentNo))
      documentType = inferDocumentType(documentType, documentNo)
      const productName = String(pick(row, REQUIRED.productName)).trim()
      const qty = pickLineQty(row, columnKeys)
      const unitNetPrice = includeUnitPrice ? pickLineUnitNetPrice(row, columnKeys) : 0

      return {
        rowNo: headerRow + index + 2,
        documentType,
        documentNo,
        issueDate: parseExcelDate(pick(row, REQUIRED.issueDate)),
        qty,
        unitNetPrice,
        productName,
        contractorName: pickContractorFromRow(row, documentType, documentNo),
        nip: normalizeNip(pick(row, REQUIRED.nip)),
        invoiceNo: String(pick(row, REQUIRED.invoiceNo)).trim(),
        notes: String(pick(row, REQUIRED.notes)).trim(),
      }
    })
    .filter(row => row.documentNo || row.productName || row.qty || row.contractorName)

  // Forward-fill PRZED odfiltrowaniem wierszy produktowych — nr PZ/WZ często jest w wierszu
  // nagłówkowym bez nazwy produktu (np. PZ/002/29/06/2026/Kolonia + porzeczka w wierszu niżej).
  const filled = forwardFillExcelRows(mapped)
  const skippedMmCount = skipMm ? filled.filter(row => isMmDocument(row.documentType, row.documentNo)).length : 0
  const afterMm = skipMm ? filled.filter(row => !isMmDocument(row.documentType, row.documentNo)) : filled
  const headerDocRows = mapped.filter(r => r.documentNo && !r.productName).length
  const resultRows = afterMm.filter(row => row.productName && Number(row.qty))
  const rowsWithoutDoc = resultRows.filter(r => !r.documentNo).length
  return { rows: resultRows, skippedMmCount, headerDocRows, rowsWithoutDoc }
}

export function classifyOperation(documentType, documentNo) {
  const type = String(documentType || '').trim().toUpperCase()
  const text = `${documentType} ${documentNo}`.toUpperCase()
  if (isMmDocument(documentType, documentNo)) return 'pominiete_mm'
  if (type === 'PZ' || text.includes('PZ')) return 'przyjecie'
  if (type === 'WZ' || type === 'FV' || type === 'FS' || text.includes('WZ') || text.includes('FV') || text.includes('FS') || text.includes('RR')) return 'sprzedaz'
  return 'przyjecie'
}
