/**
 * K04, K04.1, K05, K06, K07 – silnik kartotek HACCP (układ papierowy + syntetyczne wpisy dzienne).
 */
export const HACCP_FORMS_VERSION = '1.0'

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/\s+/g, ' ')
}

export function k04TempForProducts(productNames = [], chamberCode = '') {
  const names = (productNames || []).map(n => normalizeText(n)).join(' ')
  const chamber = normalizeText(chamberCode)
  if (names.includes('pulpa') || chamber.startsWith('ccp1')) return '-18'
  if (names.includes('malina')) return '0'
  return '2'
}

export function buildSyntheticK04Docs(allDocs, overrides = {}) {
  const k04 = (allDocs || []).filter(d => d.document_type === 'K04' && d.document_date)
  const byChamberMonth = new Map()
  for (const d of k04) {
    const chamber = d.chamber_code || 'CP3'
    const month = String(d.document_date).slice(0, 7)
    if (!month) continue
    const key = `${chamber}|${month}`
    if (!byChamberMonth.has(key)) byChamberMonth.set(key, { chamber, month, products: new Set() })
    if (d.product_name) byChamberMonth.get(key).products.add(d.product_name)
  }
  const result = []
  for (const info of byChamberMonth.values()) {
    const [y, m] = info.month.split('-').map(Number)
    const daysInMonth = new Date(y, m, 0).getDate()
    const products = Array.from(info.products)
    const temp = k04TempForProducts(products, info.chamber)
    for (let day = 1; day <= daysInMonth; day++) {
      const date = `${info.month}-${String(day).padStart(2, '0')}`
      const id = `K04-${info.chamber}-${date}`
      const ov = overrides[id] || {}
      result.push({
        id,
        synthetic: true,
        document_type: 'K04',
        document_date: date,
        product_name: products.join(', ') || 'Produkt gotowy',
        lot_no: '',
        supplier_name: '',
        document_no: `K04/${info.chamber}/${date}`,
        chamber_code: info.chamber,
        qty: 0,
        status: ov.uwagi ? normalizePn(ov.uwagi) : 'P',
        data: {
          godzina: ov.godzina ?? '09:15',
          temperatura_chlodnia_1: ov.temperatura_chlodnia_1 ?? temp,
          temperatura_chlodnia_2: ov.temperatura_chlodnia_2 ?? temp,
          podpis_kontrolujacego: ov.podpis_kontrolujacego ?? '',
          uwagi: ov.uwagi ?? 'P',
          produkty: products.join(', ')
        },
        signed_by_operator: ov.podpis_kontrolujacego ?? '',
        document_version: 'I/2024',
        created_at: date
      })
    }
  }
  return result.sort((a, b) =>
    String(a.chamber_code).localeCompare(String(b.chamber_code)) ||
    String(a.document_date).localeCompare(String(b.document_date))
  )
}

export function buildSyntheticK07Docs(allDocs, overrides = {}) {
  const k07 = (allDocs || []).filter(d => d.document_type === 'K07' && d.document_date)
  const byMonth = new Map()
  for (const d of k07) {
    const month = String(d.document_date).slice(0, 7)
    if (!month) continue
    if (!byMonth.has(month)) byMonth.set(month, { month, products: new Set(), parties: new Set() })
    if (d.product_name) byMonth.get(month).products.add(d.product_name)
    if (d.lot_no) byMonth.get(month).parties.add(d.lot_no)
  }
  const result = []
  for (const info of byMonth.values()) {
    const [y, m] = info.month.split('-').map(Number)
    const daysInMonth = new Date(y, m, 0).getDate()
    const products = Array.from(info.products)
    const sampleParty = Array.from(info.parties)[0] || ''
    for (let day = 1; day <= daysInMonth; day++) {
      const date = `${info.month}-${String(day).padStart(2, '0')}`
      const id = `K07-${date}`
      const ov = overrides[id] || {}
      result.push({
        id,
        synthetic: true,
        document_type: 'K07',
        document_date: date,
        product_name: products.join(', ') || 'Przerób na pulę (CCP1)',
        lot_no: sampleParty,
        document_no: `K07/${date}`,
        chamber_code: 'CCP1',
        qty: 0,
        status: ov.uwagi ? normalizePn(ov.uwagi) : 'P',
        data: {
          godzina: ov.godzina ?? '09:15',
          stan_sita: ov.stan_sita ?? 'P',
          sito_cale: ov.sito_cale ?? 'P',
          partia: ov.partia ?? sampleParty,
          podpis_kontrolujacego: ov.podpis_kontrolujacego ?? '',
          uwagi: ov.uwagi ?? 'P'
        },
        signed_by_operator: ov.podpis_kontrolujacego ?? '',
        document_version: 'I/2024',
        created_at: date
      })
    }
  }
  return result.sort((a, b) => String(a.document_date).localeCompare(String(b.document_date)))
}

export function normalizePn(value) {
  return value === 'N' ? 'N' : 'P'
}

export function applyFormOverride(doc, overrides, fieldMap = {}) {
  if (!doc?.id) return doc
  const ov = overrides[doc.id] || {}
  const data = { ...(doc.data || {}) }
  for (const [field, target] of Object.entries(fieldMap)) {
    if (Object.prototype.hasOwnProperty.call(ov, field)) data[target || field] = ov[field]
  }
  return { ...doc, data, signed_by_operator: ov.podpis_kontrolujacego ?? doc.signed_by_operator ?? '' }
}

export function getLiveK04Doc(doc, overrides) {
  const ov = overrides?.[doc?.id] || {}
  return applyFormOverride(doc, { [doc.id]: ov }, {
    godzina: 'godzina',
    temperatura_chlodnia_1: 'temperatura_chlodnia_1',
    temperatura_chlodnia_2: 'temperatura_chlodnia_2',
    podpis_kontrolujacego: 'podpis_kontrolujacego',
    uwagi: 'uwagi'
  })
}

export function getLiveK07Doc(doc, overrides) {
  const ov = overrides?.[doc?.id] || {}
  const data = {
    ...(doc.data || {}),
    ...ov,
    uwagi: Object.prototype.hasOwnProperty.call(ov, 'uwagi') ? ov.uwagi : (doc.data?.uwagi ?? 'P')
  }
  return {
    ...doc,
    data,
    signed_by_operator: ov.podpis_kontrolujacego ?? doc.signed_by_operator ?? ''
  }
}

function k04TempNote(chamberCode = '') {
  const chamber = normalizeText(chamberCode)
  if (chamber.startsWith('ccp1')) {
    return '- Temp. w beczkach CCP1 (pulpa): ok. -18°C (±2°C).'
  }
  return '- Temp. w chłodniach CP3 docelowo: 0–2°C (±1°C) dla produktu świeżego; mrożony zgodnie ze specyfikacją.'
}

export function buildK04MonthlyHtml(group, escapeHtml) {
  const docs = group.docs || []
  const year = (group.period || docs[0]?.document_date || '').slice(0, 4)
  const month = (group.period || docs[0]?.document_date || '').slice(5, 7)
  const chamber = group.chamber || docs[0]?.chamber_code || 'CP3'
  const rows = docs.map(doc => {
    const d = doc.data || {}
    return `<tr><td>${escapeHtml(doc.document_date || '')}</td><td>${escapeHtml(d.godzina || '09:15')}</td><td>${escapeHtml(d.temperatura_chlodnia_1 || '')}</td><td>${escapeHtml(d.temperatura_chlodnia_2 || '')}</td><td>${escapeHtml(doc.signed_by_operator || d.podpis_kontrolujacego || '')}</td><td>${normalizePn(d.uwagi || 'P')}</td></tr>`
  }).join('')
  const blanks = Array.from({ length: Math.max(0, 16 - docs.length) }, () => `<tr class="blank-row"><td></td><td></td><td></td><td></td><td></td><td></td></tr>`).join('')
  const note = k04TempNote(chamber)
  return `<!doctype html><html><head><meta charset="utf-8"><title>K04 ${escapeHtml(chamber)} ${escapeHtml(group.period)}</title><style>@page{size:A4 landscape;margin:8mm}body{font-family:"Times New Roman",serif;color:#111;margin:0}table{width:100%;border-collapse:collapse;table-layout:fixed}td,th{border:1px solid #111;padding:4px;text-align:center;vertical-align:middle;font-size:11pt;line-height:1.12}.company{width:31%;font-weight:bold;line-height:1.12}.title{width:44%;font-weight:bold;line-height:1.5}.meta{width:25%;text-align:left;vertical-align:top}.temp-note{text-align:left;font-size:11pt;line-height:1.15;padding-left:8px}.blank-row td{height:21px}@media print{button{display:none}}</style></head><body><table><tbody><tr><td class="company" rowspan="2">AGRO-MAR<br>MARIUSZ BAŃKA<br>SP. Z O.O.<br>24-335 ŁAZISKA,<br>KOLONIA ŁAZISKA 30<br>NIP: 7171839598</td><td class="title">Karta K04 - Karta kontroli parametrów<br>magazynowania produktów gotowych (CP3/CCP1)</td><td class="meta"><b>Rok:</b> ${escapeHtml(year)}<br><br><b>Miesiąc:</b> ${escapeHtml(month)}<br><b>Komora:</b> ${escapeHtml(chamber)}</td></tr><tr><td class="temp-note">${note}</td><td class="meta" style="text-align:center;vertical-align:middle">Wersja I/2024</td></tr></tbody></table><table><thead><tr><th>Data</th><th>Godzina</th><th>Temperatura<br>nr 1 [°C]</th><th>Temperatura<br>nr 2 [°C]</th><th>Podpis osoby<br>kontrolującej</th><th>Uwagi<br>(P/N)*</th></tr></thead><tbody>${rows}${blanks}</tbody></table><script>window.onload=function(){setTimeout(function(){window.focus();window.print()},700)}</script></body></html>`
}

export function buildK07MonthlyHtml(group, escapeHtml) {
  const docs = group.docs || []
  const year = (group.period || docs[0]?.document_date || '').slice(0, 4)
  const month = (group.period || docs[0]?.document_date || '').slice(5, 7)
  const rows = docs.map(doc => {
    const d = doc.data || {}
    return `<tr><td>${escapeHtml(doc.document_date || '')}</td><td>${escapeHtml(d.godzina || '09:15')}</td><td>${normalizePn(d.stan_sita || 'P')}</td><td>${normalizePn(d.sito_cale || 'P')}</td><td>${escapeHtml(d.partia || doc.lot_no || '')}</td><td>${escapeHtml(doc.signed_by_operator || d.podpis_kontrolujacego || '')}</td><td>${normalizePn(d.uwagi || 'P')}</td></tr>`
  }).join('')
  const blanks = Array.from({ length: Math.max(0, 16 - docs.length) }, () => `<tr class="blank-row"><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>K07 ${escapeHtml(group.period)}</title><style>@page{size:A4 landscape;margin:8mm}body{font-family:"Times New Roman",serif;color:#111;margin:0}table{width:100%;border-collapse:collapse;table-layout:fixed}td,th{border:1px solid #111;padding:4px;text-align:center;vertical-align:middle;font-size:11pt}.company{width:31%;font-weight:bold}.title{width:44%;font-weight:bold}.meta{width:25%;text-align:left}.blank-row td{height:21px}@media print{button{display:none}}</style></head><body><table><tbody><tr><td class="company" rowspan="2">AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.<br>24-335 ŁAZISKA,<br>KOLONIA ŁAZISKA 30<br>NIP: 7171839598</td><td class="title">Karta K07 - Karta kontroli stanu sita na linii do przerobu na pulę (CCP1)</td><td class="meta"><b>Rok:</b> ${escapeHtml(year)}<br><b>Miesiąc:</b> ${escapeHtml(month)}<br>Wersja I/2024</td></tr></tbody></table><table><thead><tr><th>Data</th><th>Godzina</th><th>Stan sita<br>(P/N)*</th><th>Sito całe<br>(P/N)*</th><th>Partia / produkt</th><th>Podpis</th><th>Uwagi<br>(P/N)*</th></tr></thead><tbody>${rows}${blanks}</tbody></table><script>window.onload=function(){setTimeout(function(){window.focus();window.print()},700)}</script></body></html>`
}

export function buildManualMonthlyHtml(group, escapeHtml, config) {
  const docs = group.docs || []
  const year = (group.period || docs[0]?.document_date || '').slice(0, 4)
  const month = (group.period || docs[0]?.document_date || '').slice(5, 7)
  const head = config.columns.map(c => `<th>${escapeHtml(c.label)}</th>`).join('')
  const rows = docs.map((doc, i) => {
    const cells = config.columns.map(c => `<td>${escapeHtml(String(c.value(doc, i) ?? ''))}</td>`).join('')
    return `<tr>${cells}</tr>`
  }).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(config.code)} ${escapeHtml(group.period)}</title><style>@page{size:A4 landscape;margin:8mm}body{font-family:"Times New Roman",serif;color:#111;margin:0}table{width:100%;border-collapse:collapse}td,th{border:1px solid #111;padding:5px;text-align:center;font-size:10.5pt}.company{width:30%;font-weight:bold;text-align:left}.title{width:55%;font-weight:bold}.meta{width:15%;text-align:left}@media print{button{display:none}}</style></head><body><table><tbody><tr><td class="company">AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.<br>24-335 ŁAZISKA, KOLONIA ŁAZISKA 30<br>NIP: 7171839598</td><td class="title">${escapeHtml(config.title)}</td><td class="meta"><b>Rok:</b> ${escapeHtml(year)}<br><b>Miesiąc:</b> ${escapeHtml(month)}</td></tr></tbody></table><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table><script>window.onload=function(){setTimeout(function(){window.focus();window.print()},700)}</script></body></html>`
}

export const MANUAL_HACCP_FORMS = {
  'K04.1': {
    code: 'K04.1',
    title: 'Karta K04.1 - Karta kontroli parametrów magazynowania podczas transportu',
    columns: [
      { key: 'lp', label: 'Lp.', value: (_, i) => i + 1 },
      { key: 'document_date', label: 'Data', value: d => d.document_date || '' },
      { key: 'product_name', label: 'Produkt', value: d => d.product_name || '' },
      { key: 'lot_no', label: 'Nr partii', value: d => d.lot_no || '' },
      { key: 'temperatura_transport', label: 'Temperatura [°C]', value: d => d.data?.temperatura_transport || '' },
      { key: 'stan_opakowania', label: 'Stan opakowania (P/N)', value: d => normalizePn(d.data?.stan_opakowania || 'P') },
      { key: 'uwagi', label: 'Uwagi', value: d => d.data?.uwagi || '' },
      { key: 'podpis', label: 'Podpis', value: d => d.signed_by_operator || d.data?.podpis || '' }
    ],
    fields: [
      { key: 'document_date', label: 'Data', type: 'date', required: true },
      { key: 'product_name', label: 'Produkt', type: 'text', required: true },
      { key: 'lot_no', label: 'Nr partii', type: 'text', required: true },
      { key: 'temperatura_transport', label: 'Temperatura transport [°C]', type: 'text', data: true },
      { key: 'stan_opakowania', label: 'Stan opakowania', type: 'pn', data: true },
      { key: 'uwagi', label: 'Uwagi', type: 'text', data: true },
      { key: 'signed_by', label: 'Podpis', type: 'employee', data: false }
    ]
  },
  K05: {
    code: 'K05',
    title: 'Karta K05 - Karta towarów wycofanych',
    columns: [
      { key: 'lp', label: 'Lp.', value: (_, i) => i + 1 },
      { key: 'document_date', label: 'Data', value: d => d.document_date || '' },
      { key: 'product_name', label: 'Nazwa produktu', value: d => d.product_name || '' },
      { key: 'lot_no', label: 'Nr partii', value: d => d.lot_no || '' },
      { key: 'qty', label: 'Ilość [kg]', value: d => d.qty ?? '' },
      { key: 'powod', label: 'Powód wycofania', value: d => d.data?.powod_wycofania || '' },
      { key: 'dzialanie', label: 'Działanie podjęte', value: d => d.data?.dzialanie || '' },
      { key: 'podpis', label: 'Podpis', value: d => d.signed_by_operator || '' }
    ],
    fields: [
      { key: 'document_date', label: 'Data', type: 'date', required: true },
      { key: 'product_name', label: 'Nazwa produktu', type: 'text', required: true },
      { key: 'lot_no', label: 'Nr partii', type: 'text', required: true },
      { key: 'qty', label: 'Ilość [kg]', type: 'number', required: true },
      { key: 'powod_wycofania', label: 'Powód wycofania', type: 'text', data: true, required: true },
      { key: 'dzialanie', label: 'Działanie podjęte', type: 'text', data: true },
      { key: 'signed_by', label: 'Podpis', type: 'employee', data: false }
    ]
  },
  K06: {
    code: 'K06',
    title: 'Karta K06 - Karta oceny jakości gotowego produktu',
    columns: [
      { key: 'lp', label: 'Lp.', value: (_, i) => i + 1 },
      { key: 'document_date', label: 'Data', value: d => d.document_date || '' },
      { key: 'product_name', label: 'Produkt', value: d => d.product_name || '' },
      { key: 'lot_no', label: 'Nr partii', value: d => d.lot_no || '' },
      { key: 'wyglad', label: 'Wygląd/zapach (P/N)', value: d => normalizePn(d.data?.wyglad_zapach || 'P') },
      { key: 'smak', label: 'Smak (P/N)', value: d => normalizePn(d.data?.smak || 'P') },
      { key: 'barwa', label: 'Barwa (P/N)', value: d => normalizePn(d.data?.barwa || 'P') },
      { key: 'podpis', label: 'Podpis', value: d => d.signed_by_operator || '' }
    ],
    fields: [
      { key: 'document_date', label: 'Data', type: 'date', required: true },
      { key: 'product_name', label: 'Produkt', type: 'text', required: true },
      { key: 'lot_no', label: 'Nr partii', type: 'text', required: true },
      { key: 'wyglad_zapach', label: 'Wygląd/zapach', type: 'pn', data: true },
      { key: 'smak', label: 'Smak', type: 'pn', data: true },
      { key: 'barwa', label: 'Barwa', type: 'pn', data: true },
      { key: 'signed_by', label: 'Podpis', type: 'employee', data: false }
    ]
  }
}

export function buildManualExcelRows(group, config) {
  const docs = group.docs || []
  const rows = []
  rows.push(['AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.'])
  rows.push([config.title, '', '', `Okres: ${group.period || ''}`])
  rows.push(config.columns.map(c => c.label))
  docs.forEach((doc, i) => rows.push(config.columns.map(c => c.value(doc, i))))
  return rows
}

export function buildK04ExcelRows(group) {
  const docs = group.docs || []
  const rows = []
  rows.push(['AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.'])
  rows.push(['Karta K04 - magazynowanie produktów gotowych (CP3/CCP1)', '', '', '', '', `Okres: ${group.period || ''} · ${group.chamber || ''}`])
  rows.push(['Data', 'Godzina', 'Temperatura nr 1 [°C]', 'Temperatura nr 2 [°C]', 'Podpis', 'Uwagi (P/N)'])
  for (const doc of docs) {
    const d = doc.data || {}
    rows.push([doc.document_date || '', d.godzina || '', d.temperatura_chlodnia_1 || '', d.temperatura_chlodnia_2 || '', doc.signed_by_operator || d.podpis_kontrolujacego || '', normalizePn(d.uwagi || 'P')])
  }
  return rows
}

export function buildK07ExcelRows(group) {
  const docs = group.docs || []
  const rows = []
  rows.push(['AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.'])
  rows.push(['Karta K07 - kontrola sita CCP1', '', '', '', '', '', `Okres: ${group.period || ''}`])
  rows.push(['Data', 'Godzina', 'Stan sita (P/N)', 'Sito całe (P/N)', 'Partia', 'Podpis', 'Uwagi (P/N)'])
  for (const doc of docs) {
    const d = doc.data || {}
    rows.push([doc.document_date || '', d.godzina || '', normalizePn(d.stan_sita || 'P'), normalizePn(d.sito_cale || 'P'), d.partia || doc.lot_no || '', doc.signed_by_operator || d.podpis_kontrolujacego || '', normalizePn(d.uwagi || 'P')])
  }
  return rows
}
