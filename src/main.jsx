import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Upload, Database, FileText, Package, Printer, ShieldCheck, AlertTriangle, RefreshCcw, Warehouse, ArrowRightLeft, Eye, Trash2, Settings, ClipboardList, LayoutDashboard } from 'lucide-react'
import { supabase, isSupabaseConfigured } from './supabaseClient'
import { readAgromarExcel, classifyOperation } from './excelImport'
import * as XLSX from 'xlsx'
import './style.css'

const PRODUCTS = [
  ['Malina pulpa', 'Mp'], ['Porzeczka czarna', 'Pcz'], ['Porzeczka czarna pulpa', 'Pczp'], ['Porzeczka czerwona', 'Pk'], ['Porzeczka czerwona pulpa', 'Pkp'], ['Truskawka', 'T'],
  ['Truskawka z szypułką', 'Tsz'], ['Aronia', 'A'], ['Śliwka', 'S'], ['Wiśnia', 'W'],
  ['Malina klasa I', 'M1'], ['Malina extra', 'Mex'], ['Jabłko obierka', 'Jabobier'], ['Jabłko na obierkę', 'Jabobier'], ['Jabłko przemysłowe', 'Jab']
]

const DOCS = [
  ['Karty kontrolne', 'K01-K06', 'Przyjęcia, temperatury, identyfikacja partii, jakość'],
  ['Raporty', 'R00-R13', 'Mycie, higiena, reklamacje, CCP, magnesy, szkło'],
  ['Formularze', 'F01-F03', 'Przeglądy, szkolenia, ocena dostawców'],
  ['Protokoły', 'PR01-PR08', 'Audyty, reklamacje, przeglądy, sytuacje kryzysowe'],
  ['Wykazy', 'W01-W10', 'Badania, mycie, dostawcy, audyty, procedury'],
  ['Karty stanowiskowe', '2 dokumenty', 'Kierowca oraz magazynier/produkcja'],
  ['Pozostałe IFS', 'R.IFS.01-R.IFS.03', 'Instruktaż CCP/CP, higiena, food defence'],
  ['Specyfikacje', 'S01-S09', 'Specyfikacje produktów i opakowań']
]


const CHAMBERS = [
  ['CP2-1', 'Komora CP2-1', 'CP2', 'Surowce'],
  ['CP2-2', 'Komora CP2-2', 'CP2', 'Surowce'],
  ['CP3-1', 'Komora CP3-1', 'CP3', 'Produkt gotowy'],
  ['CP3-2', 'Komora CP3-2', 'CP3', 'Produkt gotowy'],
  ['CCP1-1', 'Beczka CCP1-1', 'CCP1', 'Pulpa'],
  ['CCP1-2', 'Beczka CCP1-2', 'CCP1', 'Pulpa'],
  ['CCP1-3', 'Beczka CCP1-3', 'CCP1', 'Pulpa'],
  ['CCP1-4', 'Beczka CCP1-4', 'CCP1', 'Pulpa']
]

function productGroupForName(productName) {
  const text = normalizeText(productName)
  if (text.includes('malin')) return 'malina'
  if (text.includes('wisn')) return 'wisnia'
  if (text.includes('porzeczka czarna')) return 'porzeczka_czarna'
  if (text.includes('porzeczka czerwona')) return 'porzeczka_czerwona'
  if (text.includes('truskawk')) return 'truskawka'
  if (text.includes('aronia')) return 'aronia'
  if (text.includes('sliw')) return 'sliwka'
  if (text.includes('obier')) return 'jab_obier'
  if (text.includes('jabl')) return 'jab_przem'
  return text.split(' ')[0] || 'inna'
}

function targetControlPointForProduct(productName) {
  const text = normalizeText(productName)
  if (text.includes('pulpa')) return 'CCP1'
  return 'CP2'
}

function targetControlPointForProductionOutput(productName) {
  const text = normalizeText(productName)
  if (text.includes('pulpa')) return 'CCP1'
  return 'CP3'
}


function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/\s+/g, ' ')
}

const PRODUCT_CODE_BY_NORMALIZED_NAME = new Map([
  ...PRODUCTS.map(([name, code]) => [normalizeText(name), code]),
  [normalizeText('Jabłko przemysłowe'), 'Jab'],
  [normalizeText('Jabłko'), 'Jab'],
  [normalizeText('Jabłko na obierkę'), 'Jabobier'],
  [normalizeText('Jabłko obierka'), 'Jabobier'],
  [normalizeText('Jabłko na obierke'), 'Jabobier'],
  [normalizeText('Porzeczka czarna pulpa'), 'Pczp'],
  [normalizeText('Porzeczka czerwona pulpa'), 'Pkp'],
])

function baseCodeForProduct(productName) {
  const normalized = normalizeText(productName)
  const known = PRODUCT_CODE_BY_NORMALIZED_NAME.get(normalized)
  if (known) return known
  const text = String(productName || 'Produkt')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-zA-Z0-9]/g, '')
  return (text.slice(0, 8) || 'X')
}

async function getOrCreateProduct(productName, cache) {
  const name = productName || 'Produkt do dopasowania'
  const key = normalizeText(name)
  if (cache.has(key)) return cache.get(key)

  const { data: existingByName, error: nameErr } = await supabase
    .from('products')
    .select('id, name, code, product_group')
    .eq('name', name)
    .maybeSingle()
  if (nameErr) throw nameErr
  if (existingByName) {
    cache.set(key, existingByName.id)
    return existingByName.id
  }

  let code = baseCodeForProduct(name)
  let suffix = 2
  while (true) {
    const { data: existingByCode, error: codeErr } = await supabase
      .from('products')
      .select('id, name, code, product_group')
      .eq('code', code)
      .maybeSingle()
    if (codeErr) throw codeErr

    if (!existingByCode) break
    if (normalizeText(existingByCode.name) === key) {
      cache.set(key, existingByCode.id)
      return existingByCode.id
    }
    code = `${baseCodeForProduct(name)}${suffix}`
    suffix += 1
  }

  const { data: inserted, error: insertErr } = await supabase
    .from('products')
    .insert({ name, code, product_type: 'surowiec_lub_produkt', product_group: productGroupForName(name) })
    .select('id')
    .single()
  if (insertErr) throw insertErr
  cache.set(key, inserted.id)
  return inserted.id
}

async function getOrCreateContractor(contractorName, cache) {
  if (!contractorName) return null
  const key = normalizeText(contractorName)
  if (cache.has(key)) return cache.get(key)

  const { data: existing, error: selectErr } = await supabase
    .from('contractors')
    .select('id')
    .eq('name', contractorName)
    .maybeSingle()
  if (selectErr) throw selectErr
  if (existing) {
    cache.set(key, existing.id)
    return existing.id
  }

  const { data: inserted, error: insertErr } = await supabase
    .from('contractors')
    .insert({ name: contractorName, contractor_type: 'oba' })
    .select('id')
    .single()
  if (insertErr) throw insertErr
  cache.set(key, inserted.id)
  return inserted.id
}

function StatCard({ icon: Icon, label, value }) {
  return <div className="stat"><Icon size={22}/><div><strong>{value}</strong><span>{label}</span></div></div>
}

function App() {
  const [rows, setRows] = useState([])
  const [fileName, setFileName] = useState('')
  const [message, setMessage] = useState('')
  const [stockRows, setStockRows] = useState([])
  const [fifoRows, setFifoRows] = useState([])
  const [loadingStock, setLoadingStock] = useState(false)
  const [chamberRows, setChamberRows] = useState([])
  const [userRole, setUserRole] = useState('admin')
  const [productionInputLotId, setProductionInputLotId] = useState('')
  const [productionInputQty, setProductionInputQty] = useState('')
  const [productionOutputName, setProductionOutputName] = useState('Malina pulpa')
  const [productionOutputQty, setProductionOutputQty] = useState('')
  const [productionYieldPercent, setProductionYieldPercent] = useState('92')
  const [lotEditId, setLotEditId] = useState('')
  const [lotEditNewNo, setLotEditNewNo] = useState('')
  const [lotEditReason, setLotEditReason] = useState('')
  const [lotSearch, setLotSearch] = useState('')
  const [moveLotId, setMoveLotId] = useState('')
  const [targetChamberId, setTargetChamberId] = useState('')
  const [moveReason, setMoveReason] = useState('')
  const [activeTab, setActiveTab] = useState('dashboard')
  const [importRows, setImportRows] = useState([])
  const [importPreview, setImportPreview] = useState([])
  const [haccpDocs, setHaccpDocs] = useState([])
  const [docsFilter, setDocsFilter] = useState('K01')
  const [haccpSearch, setHaccpSearch] = useState('')
  const [haccpStatusFilter, setHaccpStatusFilter] = useState('all')
  const [haccpPeriodMode, setHaccpPeriodMode] = useState('month')
  const [haccpMonth, setHaccpMonth] = useState(new Date().toISOString().slice(0, 7))
  const [haccpFrom, setHaccpFrom] = useState('')
  const [haccpTo, setHaccpTo] = useState('')
  const [selectedHaccpDoc, setSelectedHaccpDoc] = useState(null)
  const [employees, setEmployees] = useState([])
  const [newEmployeeName, setNewEmployeeName] = useState('')
  const [defaultK01Employee, setDefaultK01Employee] = useState('')

  const filteredRows = useMemo(() => rows.map(r => ({ ...r, operation: classifyOperation(r.documentType, r.documentNo) })), [rows])
  const pzCount = filteredRows.filter(r => r.operation === 'przyjecie').length
  const salesCount = filteredRows.filter(r => r.operation === 'sprzedaz').length
  const qtySum = filteredRows.reduce((s, r) => s + (Number(r.qty) || 0), 0)
  const activeLots = useMemo(() => stockRows.filter(l => Number(l.remaining_qty || 0) > 0), [stockRows])
  const visibleWarehouseLots = useMemo(() => {
    const q = normalizeText(lotSearch)
    return activeLots.filter(l => {
      if (!q) return true
      return normalizeText(`${l.lot_no} ${l.products?.name || ''} ${l.product_group || ''} ${l.chamber?.code || ''}`).includes(q)
    }).slice(0, 250)
  }, [activeLots, lotSearch])

  const HACCPCARDS = [
    ['K01', 'K01 – Przyjęcie surowca (CP1)', 'Dostawy PZ/MM, ocena surowca i pojazdu'],
    ['K02', 'K02 – Magazynowanie surowca (CP2)', 'Komory surowca, temperatury i status P/N'],
    ['K04', 'K04 – Magazynowanie produktu gotowego (CP3/CCP1)', 'Produkty gotowe, pulpy i komory/beczki'],
    ['K07', 'K07 – Kontrola sita / identyfikowalność', 'Kontrola przed przerobem oraz śledzenie partii']
  ]

  const haccpDocsForFilter = useMemo(() => {
    const q = normalizeText(haccpSearch)
    return haccpDocs
      .filter(d => d.document_type === docsFilter)
      .filter(d => haccpStatusFilter === 'all' || d.status === haccpStatusFilter)
      .filter(d => {
        if (!q) return true
        return normalizeText(`${d.lot_no || ''} ${d.product_name || ''} ${d.supplier_name || ''} ${d.document_no || ''} ${d.chamber_code || ''}`).includes(q)
      })
  }, [haccpDocs, docsFilter, haccpSearch, haccpStatusFilter])


  function docInSelectedPeriod(doc) {
    const date = String(doc.document_date || '').slice(0, 10)
    if (!date) return false
    if (haccpPeriodMode === 'month') return date.slice(0, 7) === haccpMonth
    const from = haccpFrom || '0000-01-01'
    const to = haccpTo || '9999-12-31'
    return date >= from && date <= to
  }

  const haccpPeriodDocs = useMemo(() => {
    return haccpDocsForFilter.filter(docInSelectedPeriod)
  }, [haccpDocsForFilter, haccpPeriodMode, haccpMonth, haccpFrom, haccpTo])

  const haccpMonthlyGroups = useMemo(() => {
    // Kartoteki zbiorcze NIE korzystają z pola wyszukiwania, bo wyszukiwarka zawężałaby
    // formularz do jednej pozycji. K01 ma pokazywać cały miesiąc/zakres.
    const source = haccpDocs
      .filter(d => d.document_type === docsFilter)
      .filter(d => haccpStatusFilter === 'all' || d.status === haccpStatusFilter)
      .filter(docInSelectedPeriod)

    const map = new Map()
    for (const doc of source) {
      const period = String(doc.document_date || '').slice(0, 7) || haccpMonth || 'brak-daty'
      const product = doc.product_name || 'Bez produktu'
      const chamber = doc.document_type === 'K02' || doc.document_type === 'K04' ? (doc.chamber_code || 'bez komory') : ''
      // K01 jest zbiorcze w obrębie miesiąca/zakresu i surowca, żeby zachować oryginalne pole "Nazwa surowca".
      const key = doc.document_type === 'K01'
        ? `${doc.document_type}|${period}|${product}`
        : `${doc.document_type}|${period}|${product}|${chamber}`
      if (!map.has(key)) map.set(key, { key, type: doc.document_type, period, product, chamber, docs: [] })
      map.get(key).docs.push(doc)
    }
    return Array.from(map.values()).map(g => ({
      ...g,
      docs: g.docs.sort((a,b) => String(a.document_date || '').localeCompare(String(b.document_date || '')) || String(a.document_no || '').localeCompare(String(b.document_no || '')))
    }))
  }, [haccpDocs, docsFilter, haccpStatusFilter, haccpPeriodMode, haccpMonth, haccpFrom, haccpTo])

  function haccpCount(type) {
    return haccpDocs.filter(d => d.document_type === type).length
  }

  function haccpNonconformityCount(type) {
    return haccpDocs.filter(d => d.document_type === type && d.status === 'N').length
  }

  function haccpPendingCount(type) {
    return haccpDocs.filter(d => d.document_type === type && !d.signed_by_operator).length
  }

  function statusLabel(doc) {
    if (doc?.status === 'N') return 'Niezgodność'
    if (!doc?.signed_by_operator) return 'W trakcie'
    return 'Prawidłowo'
  }

  function statusClass(doc) {
    if (doc?.status === 'N') return 'status danger'
    if (!doc?.signed_by_operator) return 'status wait'
    return 'status ok'
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]))
  }

  function shortSupplier(name, docNo) {
    let supplier = String(name || '').trim()
    supplier = supplier.replace(/,?\s*NIP\s*[:\-]?\s*\d+.*/i, '')
    supplier = supplier.split(/,\s*(ul\.|kolonia|\d{2}-\d{3}|polska)/i)[0]
    supplier = supplier.replace(/\s+/g, ' ').trim()
    return [supplier, docNo].filter(Boolean).join(' / ')
  }

  function buildK01PrintHtml(doc) {
    const pn = (field) => normalizePN(doc.data?.[field])
    const dataDostawy = doc.document_date || ''
    const dostawca = shortSupplier(doc.supplier_name, doc.document_no)
    const ilosc = Number(doc.qty || 0).toLocaleString('pl-PL')
    const podpis = doc.signed_by_operator || doc.data?.podpis_przyjmujacego || ''
    const blankRows = Array.from({ length: 8 }, (_, i) => `<tr class="blank-row"><td>${i + 2}</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`).join('')
    return `<!doctype html><html><head><meta charset="utf-8"><title>K01 ${doc.lot_no || ''}</title><style>
      @page{size:A4 landscape;margin:8mm} body{font-family:"Times New Roman",serif;color:#111;margin:0} table{width:100%;border-collapse:collapse} td,th{border:1px solid #111;padding:5px;text-align:center;vertical-align:middle;font-size:11pt;line-height:1.1}.company{width:30%;font-size:11pt}.title{width:55%;font-size:12pt}.meta{width:15%;text-align:left;vertical-align:top}.raw-name{height:40px;font-size:12pt}.blank-row td{height:30px}.foot{margin-top:8px;font-size:10pt;text-align:left}.print-wrap{width:100%}
    </style></head><body><div class="print-wrap"><table><tbody><tr><td class="company" rowspan="2"><b>AGRO-MAR MARIUSZ<br>BAŃKA SP. Z O.O.<br>24-335 ŁAZISKA,<br>KOLONIA ŁAZISKA 30<br>NIP: 7171839598</b><br><b>Wersja ${doc.document_version || 'I/2024'}</b></td><td class="title"><b>Karta K01 – Karta kontroli przyjęcia surowców (CP1)</b></td><td class="meta" rowspan="2"><b>Rok:</b> ${(doc.document_date || '').slice(0,4)}<br><b>Miesiąc:</b> ${(doc.document_date || '').slice(5,7)}<br><b>Strona:</b></td></tr><tr><td class="raw-name"><b>Nazwa surowca:</b> ${escapeHtml(doc.product_name || '')}</td></tr></tbody></table><table><thead><tr><th rowspan="2">Lp.</th><th rowspan="2">Data dostawy</th><th rowspan="2">Dane dostawcy/<br>nr faktury</th><th rowspan="2">Stan higieniczny<br>pojazdu<br>(P/N)*</th><th rowspan="2">Ilość</th><th colspan="2">Ocena surowca (P/N)*</th><th rowspan="2">Podpis przyjmującego</th></tr><tr><th>Wybarwienie/zapach/<br>brak uszkodzeń<br>mechanicznych</th><th>Brak zgnilizny/<br>zapleśnienia/<br>zagrzybienia</th></tr></thead><tbody><tr><td>1</td><td>${escapeHtml(dataDostawy)}</td><td style="text-align:left">${escapeHtml(dostawca)}</td><td>${pn('stan_higieniczny_pojazdu')}</td><td>${escapeHtml(ilosc)}</td><td>${pn('wybarwienie_zapach_brak_uszkodzen')}</td><td>${pn('brak_zgnilizny_zaplesnienia_zagrzybienia')}</td><td>${escapeHtml(podpis)}</td></tr>${blankRows}</tbody></table><div class="foot">* P – prawidłowo, N – nieprawidłowo. Uwagi: ${escapeHtml(doc.data?.uwagi || '')}</div></div><script>window.onload=function(){setTimeout(function(){window.focus();window.print()},700)}</script></body></html>`
  }

  function printHaccpDoc(doc) {
    if (!doc) return
    if (doc.document_type === 'K01') {
      const win = window.open('', '_blank', 'width=1200,height=800')
      if (!win) {
        setMessage('Przeglądarka zablokowała okno drukowania. Zezwól na wyskakujące okna dla tej strony.')
        return
      }
      win.document.open()
      win.document.write(buildK01PrintHtml(doc))
      win.document.close()
      return
    }
    setSelectedHaccpDoc(doc)
    setTimeout(() => window.print(), 250)
  }

  async function changeHaccpStatus(doc, newStatus) {
    if (!supabase || !doc) return
    let note = ''
    if (newStatus === 'N') {
      note = window.prompt('Wpisz opis niezgodności. Pole wymagane przy zmianie na N:') || ''
      if (!note.trim()) {
        setMessage('Nie zapisano: przy statusie N opis niezgodności jest wymagany.')
        return
      }
    }
    const confirmed = window.confirm(`Czy na pewno zmienić status dokumentu ${doc.document_type} / ${doc.lot_no || ''} na ${newStatus}?`)
    if (!confirmed) return
    const nextData = { ...(doc.data || {}), uwagi: newStatus === 'N' ? note : (doc.data?.uwagi || '') }
    try {
      const { error } = await supabase
        .from('haccp_documents')
        .update({ status: newStatus, data: nextData, updated_at: new Date().toISOString() })
        .eq('id', doc.id)
      if (error) throw error
      await supabase.from('haccp_document_history').insert({
        document_id: doc.id,
        action: 'zmiana_statusu',
        field_name: 'status',
        old_value: doc.status || 'P',
        new_value: newStatus,
        reason: newStatus === 'N' ? note : 'Zmiana statusu na P',
        changed_by: userRole
      })
      setMessage(`Zmieniono status dokumentu na ${newStatus}.`)
      await loadHaccpDocs()
    } catch (err) {
      setMessage(`Błąd zmiany statusu: ${err.message}`)
    }
  }

  function normalizePN(value) {
    return value === 'N' ? 'N' : 'P'
  }

  async function editHaccpDataField(doc, field, label, currentValue, options = {}) {
    if (!supabase || !doc) return
    let nextValue
    if (options.pn) {
      const current = normalizePN(currentValue)
      nextValue = options.directValue ? String(options.directValue).trim().toUpperCase() : window.prompt(`${label}: wpisz P albo N`, current)
      if (nextValue === null) return
      nextValue = String(nextValue).trim().toUpperCase()
      if (!['P', 'N'].includes(nextValue)) {
        setMessage('Nie zapisano: wpisz tylko P albo N.')
        return
      }
      if (nextValue === 'N') {
        const reason = window.prompt('Przy wartości N wpisz uwagę / opis niezgodności:') || ''
        if (!reason.trim()) {
          setMessage('Nie zapisano: przy N uwaga jest obowiązkowa.')
          return
        }
        const nextData = { ...(doc.data || {}), [field]: nextValue, uwagi: reason }
        await updateHaccpDocumentField(doc, field, label, currentValue, nextValue, nextData, reason)
        return
      }
    } else {
      nextValue = options.directValue ?? window.prompt(`Edytuj pole: ${label}`, currentValue || '')
      if (nextValue === null) return
    }
    const reason = options.directValue ? 'Zmiana z poziomu kartoteki' : (window.prompt('Powód zmiany / korekty:', 'Korekta zapisu') || 'Korekta zapisu')
    const nextData = { ...(doc.data || {}), [field]: nextValue }
    await updateHaccpDocumentField(doc, field, label, currentValue, nextValue, nextData, reason)
  }

  async function updateHaccpDocumentField(doc, field, label, oldValue, newValue, nextData, reason) {
    const confirmed = window.confirm(`Czy zapisać zmianę pola "${label}"?`)
    if (!confirmed) return
    try {
      const newStatus = Object.values(nextData || {}).some(v => v === 'N') ? 'N' : 'P'
      const { error } = await supabase
        .from('haccp_documents')
        .update({ data: nextData, status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', doc.id)
      if (error) throw error
      await supabase.from('haccp_document_history').insert({
        document_id: doc.id,
        action: 'edycja_pola',
        field_name: field,
        old_value: String(oldValue ?? ''),
        new_value: String(newValue ?? ''),
        reason,
        changed_by: userRole
      })
      const updated = { ...doc, data: nextData, status: newStatus }
      setSelectedHaccpDoc(updated)
      await loadHaccpDocs()
      setMessage(`Zapisano zmianę pola: ${label}.`)
    } catch (err) {
      setMessage(`Błąd edycji dokumentu: ${err.message}`)
    }
  }

  function K01Value({ doc, field, label, children, pn=false }) {
    const value = children ?? (pn ? normalizePN(doc.data?.[field]) : (doc.data?.[field] || ''))
    return <span className="editable-cell">
      {value || '-'}
      <button className="mini edit no-print" onClick={() => editHaccpDataField(doc, field, label, value, { pn })}>Edytuj</button>
    </span>
  }

  function renderK01OriginalLayout(doc) {
    const pn = (field) => normalizePN(doc.data?.[field])
    const blankRows = Array.from({ length: 8 })
    return <>
      <div className="k01-original">
        <table className="k01-head">
          <tbody>
            <tr>
              <td className="company" rowSpan="2"><b>AGRO-MAR MARIUSZ<br/>BAŃKA SP. Z O.O.<br/>24-335 ŁAZISKA,<br/>KOLONIA ŁAZISKA 30<br/>NIP: 7171839598</b><br/><b>Wersja {doc.document_version || 'I/2024'}</b></td>
              <td className="title"><b>Karta K01 – Karta kontroli przyjęcia surowców (CP1)</b></td>
              <td className="meta" rowSpan="2"><b>Rok:</b> {(doc.document_date || '').slice(0,4)}<br/><b>Miesiąc:</b> {(doc.document_date || '').slice(5,7)}<br/><b>Strona:</b></td>
            </tr>
            <tr><td className="raw-name"><b>Nazwa surowca:</b> {doc.product_name || '........................'}</td></tr>
          </tbody>
        </table>
        <table className="k01-table">
          <thead>
            <tr>
              <th rowSpan="2">Lp.</th>
              <th rowSpan="2">Data dostawy</th>
              <th rowSpan="2">Dane dostawcy/<br/>nr faktury</th>
              <th rowSpan="2">Stan higieniczny<br/>pojazdu<br/>(P/N)*</th>
              <th rowSpan="2">Ilość</th>
              <th colSpan="2">Ocena surowca (P/N)*</th>
              <th rowSpan="2">Podpis przyjmującego</th>
            </tr>
            <tr>
              <th>Wybarwienie/zapach/<br/>brak uszkodzeń<br/>mechanicznych</th>
              <th>Brak zgnilizny/<br/>zapleśnienia/<br/>zagrzybienia</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>1</td>
              <td><K01Value doc={doc} field="data_dostawy" label="Data dostawy">{doc.document_date || ''}</K01Value></td>
              <td><K01Value doc={doc} field="dane_dostawcy" label="Dane dostawcy / nr faktury">{shortSupplier(doc.supplier_name, doc.document_no)}</K01Value></td>
              <td className={pn('stan_higieniczny_pojazdu') === 'N' ? 'pn-n' : ''}><K01Value doc={doc} field="stan_higieniczny_pojazdu" label="Stan higieniczny pojazdu" pn>{pn('stan_higieniczny_pojazdu')}</K01Value></td>
              <td><K01Value doc={doc} field="ilosc" label="Ilość">{Number(doc.qty || 0).toLocaleString('pl-PL')}</K01Value></td>
              <td className={pn('wybarwienie_zapach_brak_uszkodzen') === 'N' ? 'pn-n' : ''}><K01Value doc={doc} field="wybarwienie_zapach_brak_uszkodzen" label="Wybarwienie/zapach/brak uszkodzeń mechanicznych" pn>{pn('wybarwienie_zapach_brak_uszkodzen')}</K01Value></td>
              <td className={pn('brak_zgnilizny_zaplesnienia_zagrzybienia') === 'N' ? 'pn-n' : ''}><K01Value doc={doc} field="brak_zgnilizny_zaplesnienia_zagrzybienia" label="Brak zgnilizny/zapleśnienia/zagrzybienia" pn>{pn('brak_zgnilizny_zaplesnienia_zagrzybienia')}</K01Value></td>
              <td>
                <select className="mini-select no-print" value={doc.signed_by_operator || doc.data?.podpis_przyjmujacego || ''} onChange={e => setDocumentEmployee(doc, e.target.value)}>
                  <option value="">Wybierz pracownika</option>
                  {employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}
                </select>
                <span className="print-only">{doc.signed_by_operator || doc.data?.podpis_przyjmujacego || ''}</span>
              </td>
            </tr>
            {blankRows.map((_, i) => <tr key={i} className="blank-row"><td>{i+2}</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>)}
          </tbody>
        </table>
        <div className="k01-foot">* P – prawidłowo, N – nieprawidłowo. Uwagi: {doc.data?.uwagi || '........................................................................................................'}</div>
      </div>
      <div className="modal-actions no-print inline-actions employee-signature-row">
        <button className="secondary" onClick={() => editHaccpDataField(doc, 'uwagi', 'Uwagi', doc.data?.uwagi || '')}>Edytuj uwagi</button>
        <label>Podpis przyjmującego
          <select value={doc.signed_by_operator || doc.data?.podpis_przyjmujacego || ''} onChange={e => setDocumentEmployee(doc, e.target.value)}>
            <option value="">Wybierz pracownika</option>
            {employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}
          </select>
        </label>
      </div>
    </>
  }

  function renderGenericHaccpLayout(doc) {
    const entries = Object.entries(doc.data || {})
    return <>
      <div className="paper-head">
        <div><b>AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.</b><br/>24-335 ŁAZISKA, KOLONIA ŁAZISKA 30<br/>NIP: 7171839598</div>
        <div><b>{doc.document_type}</b><br/>Wersja: {doc.document_version || 'I/2024'}<br/>Data: {doc.document_date || '-'}</div>
      </div>
      <h2>{HACCPCARDS.find(c => c[0] === doc.document_type)?.[1] || doc.document_type}</h2>
      <div className="paper-grid">
        <span><b>Nr partii:</b> {doc.lot_no || '-'}</span>
        <span><b>Produkt:</b> {doc.product_name || '-'}</span>
        <span><b>Dostawca:</b> {doc.supplier_name || '-'}</span>
        <span><b>Dokument:</b> {doc.document_no || '-'}</span>
        <span><b>Komora:</b> {doc.chamber_code || '-'}</span>
        <span><b>Ilość:</b> {Number(doc.qty || 0).toLocaleString('pl-PL')} kg</span>
      </div>
      <table className="paper-table"><tbody>
        {entries.length === 0 && <tr><td>Kontrola P/N</td><td>P</td></tr>}
        {entries.map(([k,v]) => <tr key={k}><td>{k}</td><td className={v === 'N' ? 'pn-n' : ''}>{String(v)} <button className="mini edit no-print" onClick={() => editHaccpDataField(doc, k, k, v, { pn: v === 'P' || v === 'N' })}>Edytuj</button></td></tr>)}
      </tbody></table>
      <div className="signature-row"><span>Podpis operatora: {doc.signed_by_operator || '....................'}</span><span>Podpis administratora: {doc.signed_by_admin || '....................'}</span></div>
    </>
  }


  function periodLabel(group) {
    if (haccpPeriodMode === 'month') return group.period
    return `${haccpFrom || 'początek'} – ${haccpTo || 'koniec'}`
  }

  function buildK01MonthlyHtml(group) {
    const docs = group.docs || []
    const year = (docs[0]?.document_date || group.period || '').slice(0, 4)
    const month = (docs[0]?.document_date || group.period || '').slice(5, 7)
    const rows = docs.map((doc, i) => {
      const pn = f => normalizePN(doc.data?.[f])
      const podpis = doc.signed_by_operator || doc.data?.podpis_przyjmujacego || ''
      return `<tr><td>${i+1}</td><td>${escapeHtml(doc.document_date || '')}</td><td style="text-align:left">${escapeHtml(shortSupplier(doc.supplier_name, doc.document_no))}</td><td>${pn('stan_higieniczny_pojazdu')}</td><td>${escapeHtml(Number(doc.qty || 0).toLocaleString('pl-PL'))}</td><td>${pn('wybarwienie_zapach_brak_uszkodzen')}</td><td>${pn('brak_zgnilizny_zaplesnienia_zagrzybienia')}</td><td>${escapeHtml(podpis)}</td></tr>`
    }).join('')
    const blanks = Array.from({ length: Math.max(0, 14 - docs.length) }, (_, i) => `<tr class="blank-row"><td>${docs.length+i+1}</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`).join('')
    return `<!doctype html><html><head><meta charset="utf-8"><title>K01 ${escapeHtml(group.product)} ${escapeHtml(group.period)}</title><style>@page{size:A4 landscape;margin:8mm}body{font-family:"Times New Roman",serif;color:#111;margin:0}table{width:100%;border-collapse:collapse}td,th{border:1px solid #111;padding:5px;text-align:center;vertical-align:middle;font-size:10.5pt;line-height:1.08}.company{width:30%;font-size:10.5pt}.title{width:55%;font-size:12pt}.meta{width:15%;text-align:left;vertical-align:top}.raw-name{height:34px}.blank-row td{height:28px}.foot{margin-top:8px;font-size:10pt;text-align:left}@media print{button{display:none}}</style></head><body><table><tbody><tr><td class="company" rowspan="2"><b>AGRO-MAR MARIUSZ<br>BAŃKA SP. Z O.O.<br>24-335 ŁAZISKA,<br>KOLONIA ŁAZISKA 30<br>NIP: 7171839598</b><br><b>Wersja I/2024</b></td><td class="title"><b>Karta K01 – Karta kontroli przyjęcia surowców (CP1)</b></td><td class="meta" rowspan="2"><b>Rok:</b> ${escapeHtml(year)}<br><b>Miesiąc:</b> ${escapeHtml(month)}<br><b>Strona:</b> 1</td></tr><tr><td class="raw-name"><b>Nazwa surowca:</b> ${escapeHtml(group.product || '')}</td></tr></tbody></table><table><thead><tr><th rowspan="2">Lp.</th><th rowspan="2">Data dostawy</th><th rowspan="2">Dane dostawcy/<br>nr faktury</th><th rowspan="2">Stan higieniczny<br>pojazdu<br>(P/N)*</th><th rowspan="2">Ilość</th><th colspan="2">Ocena surowca (P/N)*</th><th rowspan="2">Podpis przyjmującego</th></tr><tr><th>Wybarwienie/zapach/<br>brak uszkodzeń<br>mechanicznych</th><th>Brak zgnilizny/<br>zapleśnienia/<br>zagrzybienia</th></tr></thead><tbody>${rows}${blanks}</tbody></table><div class="foot">* P – prawidłowo, N – nieprawidłowo. *T – Tak, N – Nie.</div><script>window.onload=function(){setTimeout(function(){window.focus();window.print()},700)}</script></body></html>`
  }

  function buildK02MonthlyHtml(group) {
    const docs = group.docs || []
    const year = (docs[0]?.document_date || group.period || '').slice(0, 4)
    const month = (docs[0]?.document_date || group.period || '').slice(5, 7)
    const rows = docs.map((doc, i) => `<tr><td>${i+1}</td><td>${escapeHtml(doc.document_date || '')}</td><td>${escapeHtml(doc.data?.godzina || '')}</td><td>${escapeHtml(doc.chamber_code || group.chamber || '')}</td><td style="text-align:left">${escapeHtml(doc.product_name || '')}<br><small>${escapeHtml(doc.lot_no || '')}</small></td><td>${escapeHtml(Number(doc.qty || 0).toLocaleString('pl-PL'))}</td><td>${escapeHtml(doc.data?.temperatura || '')}</td><td>${normalizePN(doc.data?.parametry_magazynowania || 'P')}</td><td>${escapeHtml(doc.data?.uwagi || '')}</td><td>${escapeHtml(doc.signed_by_operator || doc.data?.podpis_przyjmujacego || '')}</td></tr>`).join('')
    const blanks = Array.from({ length: Math.max(0, 14 - docs.length) }, (_, i) => `<tr class="blank-row"><td>${docs.length+i+1}</td><td></td><td></td><td></td><td></td><td></td><td></td><td>P</td><td></td><td></td></tr>`).join('')
    return `<!doctype html><html><head><meta charset="utf-8"><title>K02 ${escapeHtml(group.chamber || '')} ${escapeHtml(group.period)}</title><style>@page{size:A4 landscape;margin:8mm}body{font-family:"Times New Roman",serif;color:#111;margin:0}table{width:100%;border-collapse:collapse}td,th{border:1px solid #111;padding:5px;text-align:center;vertical-align:middle;font-size:10pt;line-height:1.08}.company{width:30%;font-size:10.5pt}.title{width:55%;font-size:12pt}.meta{width:15%;text-align:left;vertical-align:top}.blank-row td{height:28px}.foot{margin-top:8px;font-size:10pt;text-align:left}@media print{button{display:none}}</style></head><body><table><tbody><tr><td class="company"><b>AGRO-MAR MARIUSZ<br>BAŃKA SP. Z O.O.<br>24-335 ŁAZISKA,<br>KOLONIA ŁAZISKA 30<br>NIP: 7171839598</b><br><b>Wersja I/2024</b></td><td class="title"><b>Karta K02 – Karta kontroli parametrów magazynowania surowców</b></td><td class="meta"><b>Rok:</b> ${escapeHtml(year)}<br><b>Miesiąc:</b> ${escapeHtml(month)}<br><b>Strona:</b> 1</td></tr></tbody></table><table><thead><tr><th>Lp.</th><th>Data</th><th>Godzina</th><th>Komora</th><th>Produkt / partia</th><th>Ilość</th><th>Temperatura</th><th>Ocena (P/N)</th><th>Uwagi</th><th>Podpis</th></tr></thead><tbody>${rows}${blanks}</tbody></table><div class="foot">* P – prawidłowo, N – nieprawidłowo. Temperaturę i uwagi można uzupełniać ręcznie.</div><script>window.onload=function(){setTimeout(function(){window.focus();window.print()},700)}</script></body></html>`
  }

  function printHaccpGroup(group) {
    if (!group) return
    const html = group.type === 'K01' ? buildK01MonthlyHtml(group) : buildK02MonthlyHtml(group)
    const win = window.open('', '_blank', 'width=1200,height=800')
    if (!win) { setMessage('Przeglądarka zablokowała okno drukowania. Zezwól na wyskakujące okna.'); return }
    win.document.open(); win.document.write(html); win.document.close()
  }

  function exportHaccpGroupExcel(group) {
    const docs = group.docs || []
    const rows = []
    if (group.type === 'K01') {
      rows.push(['AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.'])
      rows.push(['Karta K01 – Karta kontroli przyjęcia surowców (CP1)', '', '', '', '', '', '', `Okres: ${periodLabel(group)}`])
      rows.push(['Nazwa surowca:', group.product])
      rows.push(['Lp.', 'Data dostawy', 'Dane dostawcy / nr faktury', 'Stan higieniczny pojazdu (P/N)', 'Ilość', 'Wybarwienie/zapach/brak uszkodzeń (P/N)', 'Brak zgnilizny/zapleśnienia/zagrzybienia (P/N)', 'Podpis przyjmującego'])
      docs.forEach((doc, i) => rows.push([i+1, doc.document_date || '', shortSupplier(doc.supplier_name, doc.document_no), normalizePN(doc.data?.stan_higieniczny_pojazdu), Number(doc.qty || 0), normalizePN(doc.data?.wybarwienie_zapach_brak_uszkodzen), normalizePN(doc.data?.brak_zgnilizny_zaplesnienia_zagrzybienia), doc.signed_by_operator || doc.data?.podpis_przyjmujacego || '']))
    } else {
      rows.push(['AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.'])
      rows.push([`${group.type} – kartoteka miesięczna`, '', '', '', '', '', '', `Okres: ${periodLabel(group)}`])
      rows.push(['Lp.', 'Data', 'Godzina', 'Komora', 'Produkt', 'Partia', 'Ilość', 'Temperatura', 'Ocena P/N', 'Uwagi', 'Podpis'])
      docs.forEach((doc, i) => rows.push([i+1, doc.document_date || '', doc.data?.godzina || '', doc.chamber_code || group.chamber || '', doc.product_name || '', doc.lot_no || '', Number(doc.qty || 0), doc.data?.temperatura || '', normalizePN(doc.data?.parametry_magazynowania || 'P'), doc.data?.uwagi || '', doc.signed_by_operator || doc.data?.podpis_przyjmujacego || '']))
    }
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = rows[rows.length-1]?.map(() => ({ wch: 22 })) || []
    XLSX.utils.book_append_sheet(wb, ws, group.type)
    XLSX.writeFile(wb, `${group.type}_${group.product || group.chamber || 'kartoteka'}_${periodLabel(group)}.xlsx`)
  }

  async function editHaccpRowField(doc, field, label, currentValue, options = {}) {
    return editHaccpDataField(doc, field, label, currentValue, options)
  }

  async function setDocumentEmployeeFromGroup(doc, employeeName) {
    await setDocumentEmployee(doc, employeeName)
  }

  async function setEmployeeForVisibleK01Group(group, employeeName, onlyEmpty = true) {
    if (!supabase || !group || !employeeName) return
    const docs = (group.docs || []).filter(d => !onlyEmpty || !(d.signed_by_operator || d.data?.podpis_przyjmujacego))
    if (!docs.length) { setMessage('Nie ma pustych podpisów do uzupełnienia.'); return }
    const confirmed = window.confirm(`Ustawić podpis "${employeeName}" dla ${docs.length} widocznych pozycji K01?`)
    if (!confirmed) return
    try {
      for (const doc of docs) {
        const nextData = { ...(doc.data || {}), podpis_przyjmujacego: employeeName }
        const { error } = await supabase
          .from('haccp_documents')
          .update({ data: nextData, signed_by_operator: employeeName, updated_at: new Date().toISOString() })
          .eq('id', doc.id)
        if (error) throw error
        await supabase.from('haccp_document_history').insert({
          document_id: doc.id,
          action: 'wybor_pracownika_zbiorczy',
          field_name: 'signed_by_operator',
          old_value: doc.signed_by_operator || '',
          new_value: employeeName,
          reason: 'Zbiorcze ustawienie podpisu przyjmującego w kartotece K01',
          changed_by: userRole
        })
      }
      await loadHaccpDocs()
      setMessage(`Ustawiono podpis dla ${docs.length} pozycji K01.`)
    } catch (err) {
      setMessage(`Błąd zbiorczego ustawiania podpisu: ${err.message}`)
    }
  }

  function renderGroupPreviewTable(group) {
    const docs = group.docs || []
    if (group.type === 'K01') {
      const maxRows = Math.max(14, docs.length)
      return <div className="monthly-paper k01-original">
        <div className="no-print employee-signature-row" style={{marginBottom: '10px'}}>
          <label>Ustaw podpis przyjmującego dla pustych pozycji
            <select value={defaultK01Employee} onChange={e => setDefaultK01Employee(e.target.value)}>
              <option value="">Wybierz pracownika</option>
              {employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}
            </select>
          </label>
          <button className="secondary" onClick={() => setEmployeeForVisibleK01Group(group, defaultK01Employee, true)}>Uzupełnij puste podpisy</button>
          <span className="hint">Każdy wiersz można później zmienić osobno w ostatniej kolumnie.</span>
        </div>
        <table className="k01-head"><tbody><tr><td className="company" rowSpan="2"><b>AGRO-MAR MARIUSZ<br/>BAŃKA SP. Z O.O.<br/>24-335 ŁAZISKA,<br/>KOLONIA ŁAZISKA 30<br/>NIP: 7171839598</b><br/><b>Wersja I/2024</b></td><td className="title"><b>Karta K01 – Karta kontroli przyjęcia surowców (CP1)</b></td><td className="meta" rowSpan="2"><b>Rok:</b> {group.period.slice(0,4)}<br/><b>Miesiąc:</b> {group.period.slice(5,7)}<br/><b>Strona:</b></td></tr><tr><td className="raw-name"><b>Nazwa surowca:</b> {group.product}</td></tr></tbody></table>
        <table className="k01-table"><thead><tr><th rowSpan="2">Lp.</th><th rowSpan="2">Data dostawy</th><th rowSpan="2">Dane dostawcy/<br/>nr faktury</th><th rowSpan="2">Stan higieniczny<br/>pojazdu<br/>(P/N)*</th><th rowSpan="2">Ilość</th><th colSpan="2">Ocena surowca (P/N)*</th><th rowSpan="2">Podpis przyjmującego</th></tr><tr><th>Wybarwienie/zapach/<br/>brak uszkodzeń<br/>mechanicznych</th><th>Brak zgnilizny/<br/>zapleśnienia/<br/>zagrzybienia</th></tr></thead><tbody>
          {Array.from({length: maxRows}).map((_,i) => {
            const doc = docs[i]
            if (!doc) return <tr className="blank-row" key={`blank-${i}`}><td>{i+1}</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
            const signed = doc.signed_by_operator || doc.data?.podpis_przyjmujacego || ''
            return <tr key={doc.id}>
              <td>{i+1}</td>
              <td>{doc.document_date}</td>
              <td style={{textAlign:'left'}}>{shortSupplier(doc.supplier_name, doc.document_no)}</td>
              <td className={normalizePN(doc.data?.stan_higieniczny_pojazdu)==='N'?'pn-n':''}>
                <select className="mini-select no-print" value={normalizePN(doc.data?.stan_higieniczny_pojazdu)} onChange={e=>editHaccpRowField(doc,'stan_higieniczny_pojazdu','Stan higieniczny pojazdu', e.target.value, {directValue:e.target.value, pn:true})}><option value="P">P</option><option value="N">N</option></select>
                <span className="print-only">{normalizePN(doc.data?.stan_higieniczny_pojazdu)}</span>
              </td>
              <td>{Number(doc.qty||0).toLocaleString('pl-PL')}</td>
              <td className={normalizePN(doc.data?.wybarwienie_zapach_brak_uszkodzen)==='N'?'pn-n':''}>
                <select className="mini-select no-print" value={normalizePN(doc.data?.wybarwienie_zapach_brak_uszkodzen)} onChange={e=>editHaccpRowField(doc,'wybarwienie_zapach_brak_uszkodzen','Wybarwienie/zapach/brak uszkodzeń', e.target.value, {directValue:e.target.value, pn:true})}><option value="P">P</option><option value="N">N</option></select>
                <span className="print-only">{normalizePN(doc.data?.wybarwienie_zapach_brak_uszkodzen)}</span>
              </td>
              <td className={normalizePN(doc.data?.brak_zgnilizny_zaplesnienia_zagrzybienia)==='N'?'pn-n':''}>
                <select className="mini-select no-print" value={normalizePN(doc.data?.brak_zgnilizny_zaplesnienia_zagrzybienia)} onChange={e=>editHaccpRowField(doc,'brak_zgnilizny_zaplesnienia_zagrzybienia','Brak zgnilizny/zapleśnienia/zagrzybienia', e.target.value, {directValue:e.target.value, pn:true})}><option value="P">P</option><option value="N">N</option></select>
                <span className="print-only">{normalizePN(doc.data?.brak_zgnilizny_zaplesnienia_zagrzybienia)}</span>
              </td>
              <td>
                <select className="mini-select no-print" value={signed} onChange={e=>setDocumentEmployeeFromGroup(doc,e.target.value)}><option value="">Wybierz pracownika</option>{employees.map(emp=><option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}</select>
                <span className="print-only">{signed}</span>
              </td>
            </tr>
          })}
        </tbody></table><div className="k01-foot">* P – prawidłowo, N – nieprawidłowo. Podpis wybierany jest w ostatniej kolumnie dla każdej operacji.</div></div>
    }
    return <div className="monthly-paper"><div className="paper-head"><div><b>AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.</b><br/>24-335 ŁAZISKA, KOLONIA ŁAZISKA 30<br/>NIP: 7171839598</div><div><b>{group.type} – kartoteka miesięczna</b><br/>Okres: {periodLabel(group)}<br/>Komora: {group.chamber || '-'}</div></div><table className="paper-table"><thead><tr><th>Lp.</th><th>Data</th><th>Godzina</th><th>Komora</th><th>Produkt</th><th>Partia</th><th>Ilość</th><th>Temperatura</th><th>P/N</th><th>Uwagi</th><th>Podpis</th></tr></thead><tbody>{docs.map((doc,i)=><tr key={doc.id}><td>{i+1}</td><td>{doc.document_date}</td><td>{doc.data?.godzina || ''}</td><td>{doc.chamber_code}</td><td>{doc.product_name}</td><td>{doc.lot_no}</td><td>{Number(doc.qty||0).toLocaleString('pl-PL')}</td><td>{doc.data?.temperatura || ''} <button className="mini edit no-print" onClick={()=>editHaccpRowField(doc,'temperatura','Temperatura',doc.data?.temperatura||'')}>Edytuj</button></td><td className={normalizePN(doc.data?.parametry_magazynowania)==='N'?'pn-n':''}>{normalizePN(doc.data?.parametry_magazynowania || 'P')} <button className="mini edit no-print" onClick={()=>editHaccpRowField(doc,'parametry_magazynowania','Ocena parametrów magazynowania', normalizePN(doc.data?.parametry_magazynowania || 'P'), {pn:true})}>Edytuj</button></td><td>{doc.data?.uwagi || ''}</td><td><select className="mini-select no-print" value={doc.signed_by_operator || doc.data?.podpis_przyjmujacego || ''} onChange={e=>setDocumentEmployeeFromGroup(doc,e.target.value)}><option value="">Wybierz</option>{employees.map(emp=><option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}</select><span className="print-only">{doc.signed_by_operator || doc.data?.podpis_przyjmujacego || ''}</span></td></tr>)}</tbody></table></div>
  }

  function renderHaccpPreview(doc) {
    if (!doc) return null
    if (doc.groupPreview) {
      const group = doc.group
      return <div className="modal-backdrop" onClick={() => setSelectedHaccpDoc(null)}><div className="haccp-modal wide" onClick={e => e.stopPropagation()}><div className="haccp-paper">{renderGroupPreviewTable(group)}</div><div className="modal-actions no-print"><button className="secondary" onClick={() => printHaccpGroup(group)}><Printer size={16}/> Drukuj / PDF</button><button className="secondary" onClick={() => exportHaccpGroupExcel(group)}>Pobierz Excel</button><button className="secondary" onClick={() => setSelectedHaccpDoc(null)}>Zamknij</button></div></div></div>
    }
    return <div className="modal-backdrop" onClick={() => setSelectedHaccpDoc(null)}>
      <div className="haccp-modal" onClick={e => e.stopPropagation()}>
        <div className={doc.document_type === 'K01' ? 'haccp-paper k01-print' : 'haccp-paper'}>
          {doc.document_type === 'K01' ? renderK01OriginalLayout(doc) : renderGenericHaccpLayout(doc)}
        </div>
        <div className="modal-actions no-print">
          <button className="secondary" onClick={() => printHaccpDoc(doc)}><Printer size={16}/> Drukuj / PDF</button>
          <button className="secondary" onClick={() => setSelectedHaccpDoc(null)}>Zamknij</button>
        </div>
      </div>
    </div>
  }

  useEffect(() => {
    if (isSupabaseConfigured) {
      loadFifoData()
      loadImports()
      loadHaccpDocs()
      loadEmployees()
    }
  }, [])

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setMessage('')
    try {
      const parsed = await readAgromarExcel(file)
      setRows(parsed)
      setMessage(`Wczytano ${parsed.length} wierszy. System pobiera tylko potrzebne dane: nr PZ/WZ/FV, datę, produkt i ilość.`)
    } catch (err) {
      setMessage(`Błąd wczytywania pliku: ${err.message}`)
    }
  }

  function groupImportRows(rows) {
  const groups = new Map()
  for (const row of rows) {
    if (!row.documentNo || !row.productName || !Number(row.qty)) continue
    const key = `${row.operation}|${row.documentNo}`
    if (!groups.has(key)) {
      groups.set(key, {
        operation: row.operation,
        documentNo: row.documentNo,
        issueDate: row.issueDate || new Date().toISOString().slice(0, 10),
        invoiceNo: row.invoiceNo || null,
        contractorName: row.contractorName || null,
        notes: row.notes || null,
        items: []
      })
    }
    groups.get(key).items.push(row)
  }
  return [...groups.values()]
}

async function getExistingOperationKeys(groups) {
  const keys = new Set()
  const documentNos = [...new Set(groups.map(g => g.documentNo).filter(Boolean))]

  for (let i = 0; i < documentNos.length; i += 100) {
    const chunk = documentNos.slice(i, i + 100)
    const { data, error } = await supabase
      .from('operations')
      .select('operation_type, document_no')
      .in('document_no', chunk)
    if (error) throw error
    for (const op of data || []) {
      keys.add(`${op.operation_type}|${op.document_no}`)
    }
  }
  return keys
}

async function findCompatibleChamber(productGroup, controlPoint) {
  const { data: chambers, error: chambersErr } = await supabase
    .from('storage_chambers')
    .select('id, code, name, control_point')
    .eq('control_point', controlPoint)
    .eq('is_active', true)
    .order('code', { ascending: true })
  if (chambersErr) throw chambersErr
  if (!chambers?.length) return null

  const chamberIds = chambers.map(c => c.id)
  const { data: activeLots, error: lotsErr } = await supabase
    .from('lots')
    .select('storage_chamber_id, product_group, remaining_qty')
    .in('storage_chamber_id', chamberIds)
    .gt('remaining_qty', 0)
  if (lotsErr) throw lotsErr

  const groupsByChamber = new Map()
  for (const lot of activeLots || []) {
    if (!lot.storage_chamber_id || !lot.product_group) continue
    if (!groupsByChamber.has(lot.storage_chamber_id)) groupsByChamber.set(lot.storage_chamber_id, new Set())
    groupsByChamber.get(lot.storage_chamber_id).add(lot.product_group)
  }

  // Najpierw wybierz komorę, w której jest już ta sama grupa produktu.
  for (const chamber of chambers) {
    const groups = groupsByChamber.get(chamber.id)
    if (groups && groups.size === 1 && groups.has(productGroup)) return chamber.id
  }

  // Potem wybierz pustą komorę.
  for (const chamber of chambers) {
    if (!groupsByChamber.has(chamber.id)) return chamber.id
  }

  const occupied = chambers.map(ch => `${ch.code}: ${Array.from(groupsByChamber.get(ch.id) || []).join(', ') || 'pusta'}`).join('; ')
  throw new Error(`Brak wolnej komory ${controlPoint} dla grupy ${productGroup}. Nie wolno mieszać różnych asortymentów w jednej komorze. Obecnie: ${occupied}`)
}

async function createIncomingLot(productId, operationId, operationDate, qty, productName, forcedControlPoint = null) {
  const { data: lotNo, error: lotNoErr } = await supabase.rpc('generate_lot_no', {
    p_product_id: productId,
    p_date: operationDate
  })
  if (lotNoErr) throw lotNoErr

  const productGroup = productGroupForName(productName)
  const controlPoint = forcedControlPoint || targetControlPointForProduct(productName)
  const storageChamberId = await findCompatibleChamber(productGroup, controlPoint)

  const { data: lot, error: lotErr } = await supabase
    .from('lots')
    .insert({
      product_id: productId,
      lot_no: lotNo,
      source_operation_id: operationId,
      production_date: operationDate,
      initial_qty: qty,
      remaining_qty: qty,
      unit: 'kg',
      product_group: productGroup,
      storage_chamber_id: storageChamberId
    })
    .select('id')
    .single()
  if (lotErr) throw lotErr
  return lot.id
}

async function allocateFifo(operationId, productId, qtyNeeded) {
  let remainingToAllocate = Math.abs(Number(qtyNeeded) || 0)
  const allocations = []

  const { data: lots, error } = await supabase
    .from('lots')
    .select('id, remaining_qty, production_date, created_at')
    .eq('product_id', productId)
    .gt('remaining_qty', 0)
    .order('production_date', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error

  for (const lot of lots || []) {
    if (remainingToAllocate <= 0) break
    const available = Number(lot.remaining_qty) || 0
    const take = Math.min(available, remainingToAllocate)
    const newRemaining = available - take

    const { error: updateErr } = await supabase
      .from('lots')
      .update({ remaining_qty: newRemaining, status: newRemaining <= 0 ? 'zuzyta' : 'aktywna' })
      .eq('id', lot.id)
    if (updateErr) throw updateErr

    const { error: allocErr } = await supabase
      .from('fifo_allocations')
      .insert({ operation_id: operationId, source_lot_id: lot.id, product_id: productId, qty: take })
    if (allocErr) throw allocErr

    allocations.push({ lotId: lot.id, qty: take })
    remainingToAllocate -= take
  }

  return { allocations, shortage: remainingToAllocate }
}


  async function loadFifoData() {
    if (!supabase) return
    setLoadingStock(true)
    try {
      // Wersja v7: celowo bez zagnieżdżonych relacji Supabase, żeby ominąć błędy typu select/relationship.
      const { data: lotsRaw, error: lotsErr } = await supabase
        .from('lots')
        .select('id, lot_no, production_date, initial_qty, remaining_qty, status, product_id, product_group, storage_chamber_id, created_at')
        .order('production_date', { ascending: true })
        .order('created_at', { ascending: true })
      if (lotsErr) throw lotsErr

      const { data: allocationsRaw, error: allocErr } = await supabase
        .from('fifo_allocations')
        .select('id, qty, source_lot_id, output_lot_id, product_id, operation_id, created_at')
        .order('created_at', { ascending: false })
        .limit(80)
      if (allocErr) throw allocErr

      const productIds = Array.from(new Set([
        ...(lotsRaw || []).map(l => l.product_id).filter(Boolean),
        ...(allocationsRaw || []).map(a => a.product_id).filter(Boolean)
      ]))
      const operationIds = Array.from(new Set((allocationsRaw || []).map(a => a.operation_id).filter(Boolean)))

      let productMap = new Map()
      if (productIds.length) {
        const { data: productsRaw, error: productsErr } = await supabase
          .from('products')
          .select('id, name, code, product_group')
          .in('id', productIds)
        if (productsErr) throw productsErr
        productMap = new Map((productsRaw || []).map(p => [p.id, p]))
      }

      let operationMap = new Map()
      if (operationIds.length) {
        const { data: operationsRaw, error: operationsErr } = await supabase
          .from('operations')
          .select('id, document_no, operation_date')
          .in('id', operationIds)
        if (operationsErr) throw operationsErr
        operationMap = new Map((operationsRaw || []).map(o => [o.id, o]))
      }

      let chamberMap = new Map()
      try {
        const { data: chambersRaw } = await supabase
          .from('storage_chambers')
          .select('id, code, name, control_point, chamber_type')
          .order('code', { ascending: true })
        chamberMap = new Map((chambersRaw || []).map(c => [c.id, c]))
        const chamberStatus = (chambersRaw || []).map(c => {
          const chamberLots = (lotsRaw || []).filter(l => l.storage_chamber_id === c.id && Number(l.remaining_qty || 0) > 0)
          const groups = Array.from(new Set(chamberLots.map(l => l.product_group).filter(Boolean)))
          return { ...c, lotsCount: chamberLots.length, remainingQty: chamberLots.reduce((sum, l) => sum + (Number(l.remaining_qty) || 0), 0), groups }
        })
        setChamberRows(chamberStatus)
      } catch (_) {
        setChamberRows([])
      }

      const lotMap = new Map((lotsRaw || []).map(l => [l.id, l]))
      const lotsData = (lotsRaw || []).map(l => {
        const product = productMap.get(l.product_id) || null
        return {
          ...l,
          product_group: l.product_group || product?.product_group || productGroupForName(product?.name || ''),
          products: product,
          chamber: chamberMap.get(l.storage_chamber_id) || null
        }
      })
      const allocationsData = (allocationsRaw || []).map(a => ({
        ...a,
        products: productMap.get(a.product_id) || null,
        operations: operationMap.get(a.operation_id) || null,
        lots: lotMap.get(a.source_lot_id) || null
      }))

      setStockRows(lotsData)
      setFifoRows(allocationsData)
      setMessage('Stany FIFO, komory, magazyn partii i produkcja odświeżone. Wersja v15.')
    } catch (err) {
      setMessage(`Błąd odczytu stanów FIFO: ${err?.message || String(err)}`)
    } finally {
      setLoadingStock(false)
    }
  }


  function calculateProductionOutputQty() {
    const inputQty = Math.abs(Number(productionInputQty) || 0)
    const yieldPercent = Math.abs(Number(productionYieldPercent) || 0)
    if (!inputQty || !yieldPercent) {
      setMessage('Podaj ilość wejściową i procent uzysku.')
      return
    }
    const calculated = Math.round(inputQty * yieldPercent) / 100
    setProductionOutputQty(String(calculated))
    setMessage(`Obliczono uzysk: ${inputQty.toLocaleString('pl-PL')} kg × ${yieldPercent}% = ${calculated.toLocaleString('pl-PL')} kg produktu gotowego.`)
  }

  async function createProductionConversion() {
    if (!supabase) {
      setMessage('Brak konfiguracji Supabase.')
      return
    }
    const sourceLot = stockRows.find(l => l.id === productionInputLotId)
    if (!sourceLot) {
      setMessage('Najpierw wybierz partię wejściową do przerobu.')
      return
    }
    const inputQty = Math.abs(Number(productionInputQty) || 0)
    const outputQty = Math.abs(Number(productionOutputQty) || 0)
    if (inputQty <= 0 || outputQty <= 0) {
      setMessage('Podaj ilość wejściową i ilość produktu gotowego większą od zera.')
      return
    }
    if (inputQty > Number(sourceLot.remaining_qty || 0)) {
      setMessage('Nie można zużyć więcej niż pozostało na wybranej partii.')
      return
    }
    if (!window.confirm(`Potwierdzasz przerób ${inputQty.toLocaleString('pl-PL')} kg z partii ${sourceLot.lot_no} na ${productionOutputName}?`)) return

    try {
      const today = new Date().toISOString().slice(0, 10)
      const outputProductId = await getOrCreateProduct(productionOutputName, new Map())
      const documentNo = `PROD/${today.replaceAll('-', '')}/${Date.now().toString().slice(-5)}`

      const { data: op, error: opErr } = await supabase
        .from('operations')
        .insert({ operation_type: 'produkcja', operation_date: today, document_no: documentNo, notes: `Przerób ręczny: ${sourceLot.lot_no} -> ${productionOutputName}` })
        .select('id')
        .single()
      if (opErr) throw opErr

      const newRemaining = Number(sourceLot.remaining_qty || 0) - inputQty
      const { error: srcUpdateErr } = await supabase
        .from('lots')
        .update({ remaining_qty: newRemaining, status: newRemaining <= 0 ? 'zuzyta' : 'aktywna' })
        .eq('id', sourceLot.id)
      if (srcUpdateErr) throw srcUpdateErr

      const { error: outItemErr } = await supabase.from('operation_items').insert({
        operation_id: op.id,
        product_id: sourceLot.product_id,
        qty: inputQty,
        unit: 'kg',
        lot_id: sourceLot.id,
        direction: 'rozchod',
        raw_product_name: sourceLot.products?.name || 'surowiec do przerobu',
        notes: 'Ręczny przerób na pulpę / produkt gotowy'
      })
      if (outItemErr) throw outItemErr

      const outputLotId = await createIncomingLot(outputProductId, op.id, today, outputQty, productionOutputName, targetControlPointForProductionOutput(productionOutputName))
      const { error: inItemErr } = await supabase.from('operation_items').insert({
        operation_id: op.id,
        product_id: outputProductId,
        qty: outputQty,
        unit: 'kg',
        lot_id: outputLotId,
        direction: 'przychod',
        raw_product_name: productionOutputName,
        notes: `Powstało z partii ${sourceLot.lot_no}`
      })
      if (inItemErr) throw inItemErr

      const { error: allocErr } = await supabase.from('fifo_allocations').insert({
        operation_id: op.id,
        source_lot_id: sourceLot.id,
        output_lot_id: outputLotId,
        product_id: sourceLot.product_id,
        qty: inputQty
      })
      if (allocErr) throw allocErr

      setMessage(`Utworzono produkcję ${documentNo}. Zdjęto ${inputQty.toLocaleString('pl-PL')} kg z partii ${sourceLot.lot_no}, utworzono ${outputQty.toLocaleString('pl-PL')} kg: ${productionOutputName}.`)
      setProductionInputLotId('')
      setProductionInputQty('')
      setProductionOutputQty('')
      await loadFifoData()
    } catch (err) {
      setMessage(`Błąd produkcji/przerobu: ${err.message}`)
    }
  }


  function activeGroupsInChamber(chamberId, ignoreLotId = null) {
    return Array.from(new Set(
      stockRows
        .filter(l => l.storage_chamber_id === chamberId && l.id !== ignoreLotId && Number(l.remaining_qty || 0) > 0)
        .map(l => l.product_group || l.products?.product_group || productGroupForName(l.products?.name))
        .filter(Boolean)
    ))
  }

  async function moveLotToChamber() {
    if (!supabase) return
    const selectedLot = stockRows.find(l => l.id === moveLotId)
    const chamber = chamberRows.find(c => c.id === targetChamberId)
    if (!selectedLot) {
      setMessage('Wybierz partię magazynową do przypisania lub przeniesienia.')
      return
    }
    if (!chamber) {
      setMessage('Wybierz komorę docelową.')
      return
    }
    const reason = String(moveReason || '').trim()
    if (!reason) {
      setMessage('Podaj powód przypisania/przeniesienia partii do komory.')
      return
    }

    const lotGroup = selectedLot.product_group || selectedLot.products?.product_group || productGroupForName(selectedLot.products?.name)
    const groups = activeGroupsInChamber(chamber.id, selectedLot.id)
    if (groups.length && !groups.includes(lotGroup)) {
      setMessage(`Nie można przenieść partii ${selectedLot.lot_no} do ${chamber.code}. W komorze jest już grupa: ${groups.join(', ')}. Nie wolno mieszać różnych asortymentów.`)
      return
    }

    const oldCode = selectedLot.chamber?.code || 'brak komory'
    if (!window.confirm(`Potwierdź przypisanie/przeniesienie partii ${selectedLot.lot_no} (${selectedLot.products?.name || ''}) z ${oldCode} do ${chamber.code}.`)) return

    try {
      const { error: histErr } = await supabase.from('lot_location_history').insert({
        lot_id: selectedLot.id,
        old_chamber_id: selectedLot.storage_chamber_id || null,
        new_chamber_id: chamber.id,
        product_group: lotGroup,
        reason,
        changed_by_role: userRole
      })
      if (histErr) throw histErr

      const { error: updErr } = await supabase
        .from('lots')
        .update({ storage_chamber_id: chamber.id, product_group: lotGroup })
        .eq('id', selectedLot.id)
      if (updErr) throw updErr

      setMessage(`Partia ${selectedLot.lot_no} została przypisana do ${chamber.code}. Zapisano historię lokalizacji.`)
      setMoveLotId('')
      setTargetChamberId('')
      setMoveReason('')
      await loadFifoData()
    } catch (err) {
      setMessage(`Błąd przeniesienia partii: ${err.message}`)
    }
  }

  async function changeLotNumberAsAdmin() {
    if (!supabase) return
    if (userRole !== 'admin') {
      setMessage('Tylko administrator może zmienić numer partii.')
      return
    }
    const selectedLot = stockRows.find(l => l.id === lotEditId)
    if (!selectedLot) {
      setMessage('Wybierz partię do zmiany numeru.')
      return
    }
    const newNo = String(lotEditNewNo || '').trim()
    const reason = String(lotEditReason || '').trim()
    if (!newNo || !reason) {
      setMessage('Podaj nowy numer partii i powód zmiany.')
      return
    }
    if (!window.confirm('Uwaga! Zmiana numeru partii wpływa na identyfikowalność HACCP/IFS. Czy na pewno kontynuować?')) return
    if (!window.confirm(`Potwierdź zmianę numeru partii: ${selectedLot.lot_no} → ${newNo}`)) return

    try {
      const { error: histErr } = await supabase.from('lot_change_history').insert({
        lot_id: selectedLot.id,
        old_lot_no: selectedLot.lot_no,
        new_lot_no: newNo,
        reason,
        changed_by_role: userRole
      })
      if (histErr) throw histErr

      const { error: updErr } = await supabase
        .from('lots')
        .update({ lot_no: newNo })
        .eq('id', selectedLot.id)
      if (updErr) throw updErr

      setMessage(`Zmieniono numer partii ${selectedLot.lot_no} → ${newNo}. Zapisano historię zmiany.`)
      setLotEditId('')
      setLotEditNewNo('')
      setLotEditReason('')
      await loadFifoData()
    } catch (err) {
      setMessage(`Błąd zmiany numeru partii: ${err.message}`)
    }
  }


  async function loadImports() {
    if (!supabase) return
    try {
      const { data, error } = await supabase
        .from('imported_files')
        .select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      setImportRows(data || [])
    } catch (err) {
      setMessage(`Błąd odczytu importów Excel: ${err.message}`)
    }
  }

  async function loadImportPreview(fileId) {
    if (!supabase || !fileId) return
    try {
      const { data, error } = await supabase
        .from('operations')
        .select('id, operation_type, operation_date, document_no, invoice_no, notes, operation_items(qty, direction, raw_product_name)')
        .eq('imported_file_id', fileId)
        .order('operation_date', { ascending: false })
        .limit(80)
      if (error) throw error
      setImportPreview(data || [])
      setMessage(`Wczytano podgląd importu: ${(data || []).length} dokumentów.`)
    } catch (err) {
      setMessage(`Błąd podglądu importu: ${err.message}`)
    }
  }

  async function deleteImportedFile(fileId, fileNameForConfirm) {
    if (!supabase) return
    if (userRole !== 'admin') {
      setMessage('Tylko administrator może usuwać importy Excel.')
      return
    }
    const first = window.confirm(`UWAGA: usuwasz import Excel: ${fileNameForConfirm || fileId}. Operacja usunie powiązane operacje, pozycje, partie i rozliczenia FIFO. Kontynuować?`)
    if (!first) return
    const typed = window.prompt('Drugie potwierdzenie. Wpisz dokładnie: USUŃ IMPORT')
    if (normalizeText(typed) !== normalizeText('USUŃ IMPORT')) {
      setMessage('Usuwanie anulowane — wpisano nieprawidłowe potwierdzenie.')
      return
    }
    const reason = window.prompt('Podaj powód usunięcia importu:')
    if (!String(reason || '').trim()) {
      setMessage('Usuwanie anulowane — powód jest wymagany.')
      return
    }
    try {
      const { error } = await supabase.rpc('delete_import_excel_admin', {
        p_imported_file_id: fileId,
        p_reason: reason,
        p_user_role: userRole
      })
      if (error) throw error
      setMessage('Import został usunięty przez administratora. Zapisano ślad w audycie.')
      setImportPreview([])
      await loadImports()
      await loadFifoData()
      await loadHaccpDocs()
    } catch (err) {
      setMessage(`Błąd usuwania importu: ${err.message}`)
    }
  }

  async function loadEmployees() {
    if (!supabase) return
    try {
      const { data, error } = await supabase
        .from('haccp_employees')
        .select('id, full_name, role_name, is_active, created_at')
        .eq('is_active', true)
        .order('full_name', { ascending: true })
      if (error) throw error
      setEmployees(data || [])
    } catch (err) {
      setEmployees([])
    }
  }

  async function addEmployee() {
    if (!supabase) return
    const name = newEmployeeName.trim()
    if (!name) {
      setMessage('Wpisz imię i nazwisko pracownika.')
      return
    }
    try {
      const { error } = await supabase
        .from('haccp_employees')
        .insert({ full_name: name, role_name: 'przyjmujący', is_active: true })
      if (error) throw error
      setNewEmployeeName('')
      await loadEmployees()
      setMessage('Dodano pracownika do listy podpisów.')
    } catch (err) {
      setMessage(`Błąd dodawania pracownika: ${err.message}`)
    }
  }

  async function deleteEmployee(employee) {
    if (!supabase || !employee) return
    if (userRole !== 'admin') {
      setMessage('Tylko administrator może usuwać pracowników.')
      return
    }
    const ok = window.confirm(`Czy usunąć pracownika z listy podpisów: ${employee.full_name}?`)
    if (!ok) return
    try {
      const { error } = await supabase
        .from('haccp_employees')
        .update({ is_active: false })
        .eq('id', employee.id)
      if (error) throw error
      await loadEmployees()
      setMessage('Pracownik został ukryty z listy podpisów.')
    } catch (err) {
      setMessage(`Błąd usuwania pracownika: ${err.message}`)
    }
  }

  async function setDocumentEmployee(doc, employeeName) {
    if (!supabase || !doc) return
    if (!employeeName) return
    const confirmed = window.confirm(`Ustawić podpis przyjmującego na: ${employeeName}?`)
    if (!confirmed) return
    const nextData = { ...(doc.data || {}), podpis_przyjmujacego: employeeName }
    try {
      const { error } = await supabase
        .from('haccp_documents')
        .update({ data: nextData, signed_by_operator: employeeName, updated_at: new Date().toISOString() })
        .eq('id', doc.id)
      if (error) throw error
      await supabase.from('haccp_document_history').insert({
        document_id: doc.id,
        action: 'wybor_pracownika',
        field_name: 'signed_by_operator',
        old_value: doc.signed_by_operator || '',
        new_value: employeeName,
        reason: 'Wybór podpisu przyjmującego z listy pracowników',
        changed_by: userRole
      })
      const updated = { ...doc, data: nextData, signed_by_operator: employeeName }
      setSelectedHaccpDoc(updated)
      await loadHaccpDocs()
      setMessage('Zapisano podpis przyjmującego.')
    } catch (err) {
      setMessage(`Błąd zapisu podpisu: ${err.message}`)
    }
  }

  async function loadHaccpDocs() {
    if (!supabase) return
    try {
      const { data, error } = await supabase
        .from('haccp_documents')
        .select('id, document_type, document_date, product_name, lot_no, supplier_name, document_no, chamber_code, qty, status, data, signed_by_operator, signed_by_admin, document_version, created_at')
        .order('document_date', { ascending: false })
        .limit(5000)
      if (error) throw error
      setHaccpDocs(data || [])
    } catch (err) {
      // haccp_documents pojawia się dopiero po SQL v18/v19/v20.
      setHaccpDocs([])
    }
  }

  const tabs = [
    ['dashboard', 'Start', LayoutDashboard],
    ['importy', 'Importy Excel', Upload],
    ['magazyn', 'Magazyn', Warehouse],
    ['produkcja', 'Produkcja / Przerób', Package],
    ['kartoteki', 'Kartoteki HACCP', ClipboardList],
    ['raporty', 'Raporty', FileText],
    ['ustawienia', 'Ustawienia', Settings]
  ]

  async function saveToSupabase() {
    if (!supabase) {
      setMessage('Brak konfiguracji Supabase. Uzupełnij plik .env na podstawie .env.example.')
      return
    }
    if (!rows.length) {
      setMessage('Najpierw wczytaj plik Excel.')
      return
    }

    setMessage('Trwa import. Nie klikaj ponownie przycisku zapisu...')

    try {
      const productCache = new Map()
      const contractorCache = new Map()
      const groups = groupImportRows(filteredRows)
      const existingKeys = await getExistingOperationKeys(groups)
      const groupsToImport = groups.filter(g => !existingKeys.has(`${g.operation}|${g.documentNo}`))
      const duplicateCount = groups.length - groupsToImport.length

      const { data: imported, error: fileError } = await supabase
        .from('imported_files')
        .insert({
          filename: fileName || 'import.xlsx',
          rows_count: rows.length,
          status: duplicateCount ? `pominieto_duplikaty_${duplicateCount}` : 'wczytany'
        })
        .select('id')
        .single()
      if (fileError) throw fileError

      let importedOperations = 0
      let importedItems = 0
      let createdLots = 0
      let fifoAllocations = 0
      let shortageCount = 0
      let shortageKg = 0

      for (const group of groupsToImport) {
        const contractorId = await getOrCreateContractor(group.contractorName, contractorCache)

        const { data: op, error: opErr } = await supabase
          .from('operations')
          .insert({
            operation_type: group.operation,
            operation_date: group.issueDate,
            document_no: group.documentNo,
            invoice_no: group.invoiceNo,
            contractor_id: contractorId,
            imported_file_id: imported.id,
            notes: group.notes || null
          })
          .select('id')
          .single()
        if (opErr) {
          // Dodatkowe zabezpieczenie przy równoczesnym lub ponownym imporcie.
          if (String(opErr.message || '').includes('duplicate')) continue
          throw opErr
        }
        importedOperations += 1

        for (const row of group.items) {
          const productId = await getOrCreateProduct(row.productName, productCache)
          const direction = group.operation === 'przyjecie' ? 'przychod' : 'rozchod'
          // W plikach WZ/FV ilości często są ujemne. Do FIFO i partii zapisujemy zawsze dodatnią ilość,
          // a kierunek operacji określa, czy to przychód czy rozchód.
          const itemQty = Math.abs(Number(row.qty) || 0)
          if (itemQty <= 0) continue
          let lotId = null

          const { data: item, error: itemErr } = await supabase
            .from('operation_items')
            .insert({
              operation_id: op.id,
              product_id: productId,
              qty: itemQty,
              unit: 'kg',
              direction,
              raw_product_name: row.productName
            })
            .select('id')
            .single()
          if (itemErr) throw itemErr
          importedItems += 1

          if (direction === 'przychod') {
            lotId = await createIncomingLot(productId, op.id, group.issueDate, itemQty, row.productName)
            createdLots += 1
            const { error: itemLotErr } = await supabase
              .from('operation_items')
              .update({ lot_id: lotId })
              .eq('id', item.id)
            if (itemLotErr) throw itemLotErr
          } else {
            const result = await allocateFifo(op.id, productId, itemQty)
            fifoAllocations += result.allocations.length
            if (result.shortage > 0) {
              shortageCount += 1
              shortageKg += result.shortage
            }
          }
        }
      }

      setMessage(
        `Import zakończony. Zaimportowano dokumentów: ${importedOperations}, pozycji: ${importedItems}, utworzono partii: ${createdLots}, rozliczeń FIFO: ${fifoAllocations}. Pominięto duplikatów: ${duplicateCount}.` +
        (shortageCount ? ` Uwaga: brakło towaru FIFO w ${shortageCount} pozycjach, razem ${shortageKg.toLocaleString('pl-PL')} kg.` : '')
      )
      await loadFifoData()
      await loadImports()
      await loadHaccpDocs()
    } catch (err) {
      setMessage(`Błąd zapisu do Supabase: ${err.message}`)
    }
  }

  return <div className="page">
    <header>
      <div>
        <p className="eyebrow">AGRO-MAR</p>
        <h1>HACCP / IFS / FIFO</h1>
        <p className="lead">Osobny system do importu operacji, numerów partii, FIFO i dokumentacji jakościowej.</p>
      </div>
      <div className="badge"><ShieldCheck size={18}/> Osobny projekt od opakowań · v24.4 K01 MIESIĘCZNE NAPRAWIONE</div>
    </header>

    <section className="warning">
      <AlertTriangle size={20}/>
      <div><strong>Ważne:</strong> ta aplikacja ma być podłączona wyłącznie do nowego projektu Supabase <b>AGRO-MAR-HACCP</b>, nigdy do starej bazy opakowań.</div>
    </section>


    <nav className="top-tabs">
      {tabs.map(([key, label, Icon]) => <button key={key} className={activeTab === key ? 'tab active' : 'tab'} onClick={() => setActiveTab(key)}><Icon size={16}/>{label}</button>)}
    </nav>

    {activeTab === 'dashboard' && <>
    <div className="grid stats">
      <StatCard icon={Package} value={PRODUCTS.length} label="produktów startowych" />
      <StatCard icon={FileText} value="40+" label="szablonów dokumentów" />
      <StatCard icon={Database} value={isSupabaseConfigured ? 'TAK' : 'NIE'} label="Supabase skonfigurowany" />
      <StatCard icon={Printer} value="PDF/druk" label="zaplanowane w kolejnym etapie" />
    </div>

    <section className="card">
      <div className="section-title"><Upload/><div><h2>Import Excel</h2><p>Pobieramy tylko potrzebne pola: nr dokumentu/PZ, data wystawienia, ilość i produkt.</p></div></div>
      <input className="file" type="file" accept=".xls,.xlsx,.csv" onChange={handleFile} />
      {message && <p className="message">{message}</p>}
      <div className="actions"><button onClick={saveToSupabase}>Zapisz import do Supabase</button></div>

      {rows.length > 0 && <>
        <div className="summary">
          <span>Wiersze: <b>{rows.length}</b></span>
          <span>Przyjęcia/PZ: <b>{pzCount}</b></span>
          <span>Sprzedaż/WZ/FV: <b>{salesCount}</b></span>
          <span>Suma ilości: <b>{qtySum.toLocaleString('pl-PL')}</b></span>
        </div>
        <div className="table-wrap"><table>
          <thead><tr><th>Typ</th><th>Nr</th><th>Data</th><th>Produkt</th><th>Ilość</th><th>Kontrahent</th><th>Operacja</th></tr></thead>
          <tbody>{filteredRows.slice(0, 100).map((row, i) => <tr key={i}>
            <td>{row.documentType}</td><td>{row.documentNo}</td><td>{row.issueDate}</td><td>{row.productName}</td><td>{row.qty}</td><td>{row.contractorName}</td><td><span className="pill">{row.operation}</span></td>
          </tr>)}</tbody>
        </table></div>
      </>}
    </section>
    </>}


    {activeTab === 'importy' && <>
    <section className="card">
      <div className="section-title"><Upload/><div><h2>Import Excel</h2><p>Wgraj nowy plik Excel. Po imporcie plik pojawi się w rejestrze niżej.</p></div></div>
      <input className="file" type="file" accept=".xls,.xlsx,.csv" onChange={handleFile} />
      {message && <p className="message">{message}</p>}
      <div className="actions"><button onClick={saveToSupabase}>Zapisz import do Supabase</button></div>
      {rows.length > 0 && <>
        <div className="summary">
          <span>Wiersze: <b>{rows.length}</b></span>
          <span>Przyjęcia/PZ: <b>{pzCount}</b></span>
          <span>Sprzedaż/WZ/FV: <b>{salesCount}</b></span>
          <span>Suma ilości: <b>{qtySum.toLocaleString('pl-PL')}</b></span>
        </div>
        <div className="table-wrap"><table>
          <thead><tr><th>Typ</th><th>Nr</th><th>Data</th><th>Produkt</th><th>Ilość</th><th>Kontrahent</th><th>Operacja</th></tr></thead>
          <tbody>{filteredRows.slice(0, 100).map((row, i) => <tr key={i}>
            <td>{row.documentType}</td><td>{row.documentNo}</td><td>{row.issueDate}</td><td>{row.productName}</td><td>{row.qty}</td><td>{row.contractorName}</td><td><span className="pill">{row.operation}</span></td>
          </tr>)}</tbody>
        </table></div>
      </>}
    </section>

    <section className="card" id="importy-excel">
      <div className="section-title"><Upload/><div><h2>Rejestr importów Excel</h2><p>Podgląd wgranych plików i bezpieczne usuwanie importu przez administratora z podwójnym potwierdzeniem.</p></div></div>
      <div className="actions"><button className="secondary" onClick={loadImports}><RefreshCcw size={16}/> Odśwież importy</button></div>
      {importRows.length === 0 && <p className="hint">Brak importów do wyświetlenia albo uruchom SQL v21.</p>}
      {importRows.length > 0 && <div className="table-wrap small"><table>
        <thead><tr><th>Plik</th><th>Data</th><th>Wiersze</th><th>Status</th><th>Akcje</th></tr></thead>
        <tbody>{importRows.map(f => <tr key={f.id}>
          <td><b>{f.filename || f.file_name || 'import.xlsx'}</b></td>
          <td>{f.created_at ? new Date(f.created_at).toLocaleString('pl-PL') : '-'}</td>
          <td>{f.rows_count || f.row_count || '-'}</td>
          <td><span className="pill">{f.status || 'wczytany'}</span></td>
          <td className="row-actions"><button className="secondary mini" onClick={() => loadImportPreview(f.id)}><Eye size={14}/> Podgląd</button><button className="danger mini" onClick={() => deleteImportedFile(f.id, f.filename || f.file_name)}><Trash2 size={14}/> Usuń</button></td>
        </tr>)}</tbody>
      </table></div>}
      {importPreview.length > 0 && <><h3>Podgląd pozycji z importu</h3><div className="table-wrap small"><table>
        <thead><tr><th>Typ</th><th>Data</th><th>Dokument</th><th>FV</th><th>Pozycje</th></tr></thead>
        <tbody>{importPreview.map(op => <tr key={op.id}>
          <td>{op.operation_type}</td><td>{op.operation_date}</td><td>{op.document_no}</td><td>{op.invoice_no}</td><td>{(op.operation_items || []).map(i => `${i.raw_product_name || ''}: ${Number(i.qty || 0).toLocaleString('pl-PL')} kg`).join(' | ')}</td>
        </tr>)}</tbody>
      </table></div></>}
    </section>
    </>}


    {activeTab === 'magazyn' && <>
    <section className="card">
      <div className="section-title"><Warehouse/><div><h2>Komory CP/CCP</h2><p>CP2: 2 komory surowca, CP3: 2 komory produktu gotowego, CCP1: 4 beczki pulpy. System blokuje mieszanie różnych grup w jednej komorze.</p></div></div>
      <div className="chamber-grid">
        {CHAMBERS.map(([code, name, point, kind]) => {
          const row = chamberRows.find(c => c.code === code)
          return <div className="chamber" key={code}>
            <strong>{code}</strong><span>{name}</span><small>{point} · {kind}</small>
            <em>{row ? (row.groups.length ? `Grupa: ${row.groups.join(', ')} · ${Number(row.remainingQty || 0).toLocaleString('pl-PL')} kg` : 'Pusta / gotowa do przypisania') : 'Uruchom SQL v10 i odśwież stany'}</em>
          </div>
        })}
      </div>
    </section>


    <section className="card">
      <div className="section-title"><ArrowRightLeft/><div><h2>Magazyn partii</h2><p>Partie są osobne dla każdej dostawy. FIFO działa po dacie przyjęcia i partii. Komora może zawierać wiele partii, ale tylko jedną grupę asortymentową.</p></div></div>
      <div className="actions"><button className="secondary" onClick={loadFifoData} disabled={loadingStock}><RefreshCcw size={16}/> {loadingStock ? 'Odświeżanie...' : 'Odśwież magazyn partii'}</button></div>
      <div className="summary">
        <span>Aktywne partie: <b>{activeLots.length}</b></span>
        <span>Bez komory: <b>{activeLots.filter(l => !l.storage_chamber_id).length}</b></span>
        <span>Grupy: <b>{Array.from(new Set(activeLots.map(l => l.product_group || l.products?.product_group).filter(Boolean))).length}</b></span>
        <span>Pozostało kg: <b>{activeLots.reduce((s, l) => s + (Number(l.remaining_qty) || 0), 0).toLocaleString('pl-PL')}</b></span>
      </div>
      <div className="form-grid">
        <label>Szukaj partii / produktu / komory
          <input value={lotSearch} onChange={e => setLotSearch(e.target.value)} placeholder="np. M1/001 albo malina albo CP2-1" />
        </label>
        <label>Partia do przypisania/przeniesienia
          <select value={moveLotId} onChange={e => setMoveLotId(e.target.value)}>
            <option value="">Wybierz partię</option>
            {visibleWarehouseLots.map(l => <option key={l.id} value={l.id}>{l.lot_no} · {l.products?.name} · {Number(l.remaining_qty || 0).toLocaleString('pl-PL')} kg · {l.chamber?.code || 'bez komory'}</option>)}
          </select>
        </label>
        <label>Komora docelowa
          <select value={targetChamberId} onChange={e => setTargetChamberId(e.target.value)}>
            <option value="">Wybierz komorę</option>
            {chamberRows.map(c => <option key={c.id} value={c.id}>{c.code} · {c.name} · {c.groups?.length ? `grupa: ${c.groups.join(', ')}` : 'pusta'}</option>)}
          </select>
        </label>
        <label>Powód przypisania/przeniesienia
          <input value={moveReason} onChange={e => setMoveReason(e.target.value)} placeholder="np. przyjęcie PZ, korekta lokalizacji, przeniesienie" />
        </label>
      </div>
      <div className="actions"><button className="secondary" onClick={moveLotToChamber}>Przypisz / przenieś partię</button></div>
      <p className="hint">System zablokuje przeniesienie, jeśli w wybranej komorze znajduje się inna grupa asortymentowa, np. wiśnia zamiast maliny.</p>
      {activeLots.length === 0 && <p className="hint danger-text">Brak aktywnych partii w widoku. Kliknij "Odśwież magazyn partii" albo sprawdź w Supabase, czy remaining_qty jest większe od 0.</p>}
      {visibleWarehouseLots.length > 0 && <div className="table-wrap small"><table>
        <thead><tr><th>Partia</th><th>Produkt</th><th>Grupa</th><th>Komora</th><th>Data przyjęcia</th><th>Pozostało kg</th><th>Status</th></tr></thead>
        <tbody>{visibleWarehouseLots.map(l => <tr key={l.id}>
          <td><b>{l.lot_no}</b></td><td>{l.products?.name}</td><td>{l.product_group || l.products?.product_group}</td><td>{l.chamber?.code || <span className="danger-text">bez komory</span>}</td><td>{l.production_date}</td><td>{Number(l.remaining_qty || 0).toLocaleString('pl-PL')}</td><td><span className="pill">{l.status}</span></td>
        </tr>)}</tbody>
      </table></div>}
    </section>
    </>}

    {activeTab === 'produkcja' && <>
    <section className="card">
      <div className="section-title"><Package/><div><h2>Produkcja / Przerób</h2><p>Ręczna decyzja, czy dana partia surowca idzie do przerobu na pulpę lub produkt gotowy. FIFO dalej zostaje po dacie przyjęcia i partii.</p></div></div>
      <div className="form-grid">
        <label>Rola użytkownika
          <select value={userRole} onChange={e => setUserRole(e.target.value)}>
            <option value="admin">Administrator</option>
            <option value="magazynier">Magazynier</option>
          </select>
        </label>
        <label>Partia wejściowa
          <select value={productionInputLotId} onChange={e => setProductionInputLotId(e.target.value)}>
            <option value="">Wybierz partię z magazynu</option>
            {stockRows.filter(l => Number(l.remaining_qty || 0) > 0).slice(0, 500).map(l => <option key={l.id} value={l.id}>{l.lot_no} · {l.products?.name} · {Number(l.remaining_qty || 0).toLocaleString('pl-PL')} kg · {l.production_date}</option>)}
          </select>
        </label>
        <label>Ilość do przerobu kg
          <input value={productionInputQty} onChange={e => setProductionInputQty(e.target.value)} placeholder="np. 5000" />
        </label>
        <label>Produkt gotowy
          <select value={productionOutputName} onChange={e => setProductionOutputName(e.target.value)}>
            <option>Malina pulpa</option>
            <option>Porzeczka czarna pulpa</option>
            <option>Porzeczka czerwona pulpa</option>
            <option>Malina klasa I</option>
            <option>Malina extra</option>
            <option>Wiśnia</option>
            <option>Aronia</option>
            <option>Śliwka</option>
            <option>Truskawka</option>
            <option>Truskawka z szypułką</option>
            <option>Porzeczka czarna</option>
            <option>Porzeczka czerwona</option>
            <option>Jabłko przemysłowe</option>
            <option>Jabłko obierka</option>
            <option>Jabłko na obierkę</option>
          </select>
        </label>
        <label>Uzysk %
          <input value={productionYieldPercent} onChange={e => setProductionYieldPercent(e.target.value)} placeholder="np. 92" />
        </label>
        <label>Ilość produktu gotowego kg
          <input value={productionOutputQty} onChange={e => setProductionOutputQty(e.target.value)} placeholder="np. 4800 albo taka sama ilość bez przerobu" />
        </label>
      </div>
      <div className="actions"><button className="ghost" onClick={calculateProductionOutputQty}>Oblicz wg uzysku</button><button className="secondary" onClick={createProductionConversion}>Utwórz przerób / produkcję</button></div>
      <p className="hint">Przykład: wybierz partię Malina I, wpisz ilość, wybierz „Malina pulpa” albo ten sam owoc bez przerobu. System zdejmie ilość z partii wejściowej, utworzy nową partię produktu gotowego, zapisze powiązanie partia wejściowa → partia wyjściowa i przypisze pulpę do CCP1.</p>
    </section>

    <section className="card">
      <div className="section-title"><ShieldCheck/><div><h2>Zmiana numeru partii</h2><p>Tylko administrator, zawsze z potwierdzeniem i zapisem historii zmiany.</p></div></div>
      <div className="form-grid">
        <label>Partia
          <select value={lotEditId} onChange={e => setLotEditId(e.target.value)} disabled={userRole !== 'admin'}>
            <option value="">Wybierz partię</option>
            {stockRows.slice(0, 800).map(l => <option key={l.id} value={l.id}>{l.lot_no} · {l.products?.name}</option>)}
          </select>
        </label>
        <label>Nowy numer partii
          <input value={lotEditNewNo} onChange={e => setLotEditNewNo(e.target.value)} disabled={userRole !== 'admin'} placeholder="np. M1/003/2026" />
        </label>
        <label>Powód zmiany
          <input value={lotEditReason} onChange={e => setLotEditReason(e.target.value)} disabled={userRole !== 'admin'} placeholder="Wymagane uzasadnienie" />
        </label>
      </div>
      <div className="actions"><button className="secondary" onClick={changeLotNumberAsAdmin} disabled={userRole !== 'admin'}>Zmień numer partii</button></div>
      {userRole !== 'admin' && <p className="hint danger-text">Magazynier nie może zmieniać numerów partii.</p>}
    </section>
    </>}

    {activeTab === 'magazyn' && <>
    <section className="card">
      <div className="section-title"><Warehouse/><div><h2>Stany partii i FIFO</h2><p>Podgląd pozostałych kilogramów z PZ oraz ostatnich rozliczeń WZ/FV według FIFO.</p></div></div>
      <div className="actions"><button className="secondary" onClick={loadFifoData} disabled={loadingStock}><RefreshCcw size={16}/> {loadingStock ? 'Odświeżanie...' : 'Odśwież stany FIFO'}</button></div>
      <div className="summary">
        <span>Partie: <b>{stockRows.length}</b></span>
        <span>Pozostało kg: <b>{stockRows.reduce((s, l) => s + (Number(l.remaining_qty) || 0), 0).toLocaleString('pl-PL')}</b></span>
        <span>Rozliczenia FIFO: <b>{fifoRows.length}</b></span>
      </div>
      {stockRows.length > 0 && <div className="table-wrap small"><table>
        <thead><tr><th>Produkt</th><th>Grupa</th><th>Komora</th><th>Kod</th><th>Partia</th><th>Data</th><th>Ilość pocz.</th><th>Pozostało</th><th>Status</th></tr></thead>
        <tbody>{stockRows.slice(0, 120).map(l => <tr key={l.id}>
          <td>{l.products?.name}</td><td>{l.product_group || l.products?.product_group}</td><td>{l.chamber?.code || '-'}</td><td>{l.products?.code}</td><td>{l.lot_no}</td><td>{l.production_date}</td><td>{Number(l.initial_qty || 0).toLocaleString('pl-PL')}</td><td><b>{Number(l.remaining_qty || 0).toLocaleString('pl-PL')}</b></td><td><span className="pill">{l.status}</span></td>
        </tr>)}</tbody>
      </table></div>}
      {fifoRows.length > 0 && <><h3>Ostatnie rozliczenia FIFO</h3><div className="table-wrap small"><table>
        <thead><tr><th>WZ/FV</th><th>Data</th><th>Produkt</th><th>Partia PZ</th><th>Ilość zdjęta</th></tr></thead>
        <tbody>{fifoRows.map(a => <tr key={a.id}>
          <td>{a.operations?.document_no}</td><td>{a.operations?.operation_date}</td><td>{a.products?.name}</td><td>{a.lots?.lot_no}</td><td>{Number(a.qty || 0).toLocaleString('pl-PL')}</td>
        </tr>)}</tbody>
      </table></div></>}
    </section>
    </>}

    {activeTab === 'kartoteki' && <>
    <section className="card" id="kartoteki-haccp">
      <div className="section-title"><ClipboardList/><div><h2>Kartoteki HACCP</h2><p>v24.4: K01 miesięczne/zakresowe; podpis pracownika bez przycisku Edytuj; druk/PDF i Excel z kartoteki zbiorczej.</p></div></div>
      <div className="haccp-card-grid">
        {HACCPCARDS.map(([code, title, desc]) => <button key={code} className={docsFilter === code ? 'haccp-card active' : 'haccp-card'} onClick={() => setDocsFilter(code)}>
          <b>{title}</b><small>{desc}</small>
          <span><b>{haccpCount(code)}</b> dokumentów · <b>{haccpNonconformityCount(code)}</b> N · <b>{haccpPendingCount(code)}</b> bez podpisu</span>
        </button>)}
      </div>
      <div className="form-grid compact">
        <label>Szukaj partii / produktu / PZ / dostawcy<input value={haccpSearch} onChange={e => setHaccpSearch(e.target.value)} placeholder="np. Jab/067, PZ/..., dostawca" /></label>
        <label>Status<select value={haccpStatusFilter} onChange={e => setHaccpStatusFilter(e.target.value)}><option value="all">Wszystkie</option><option value="P">Prawidłowe P</option><option value="N">Niezgodność N</option></select></label>
      </div>
      <div className="form-grid compact">
        <label>Okres<select value={haccpPeriodMode} onChange={e => setHaccpPeriodMode(e.target.value)}><option value="month">Miesiąc</option><option value="range">Własny zakres</option></select></label>
        {haccpPeriodMode === 'month' && <label>Miesiąc<input type="month" value={haccpMonth} onChange={e => setHaccpMonth(e.target.value)} /></label>}
        {haccpPeriodMode === 'range' && <><label>Od<input type="date" value={haccpFrom} onChange={e => setHaccpFrom(e.target.value)} /></label><label>Do<input type="date" value={haccpTo} onChange={e => setHaccpTo(e.target.value)} /></label></>}
      </div>
      <div className="actions"><button className="secondary" onClick={loadHaccpDocs}><RefreshCcw size={16}/> Odśwież kartoteki</button></div>
      <div className="doc-progress">{['K01','K02','K04','K07'].map(code => <span key={code} className={haccpCount(code) ? 'done' : ''}>{code} {haccpCount(code) ? '✔' : '○'}</span>)}</div>
      <h3>Kartoteki zbiorcze – jedna kartoteka na miesiąc / zakres dat</h3><p className="hint"><b>Używaj tej sekcji do podglądu, druku/PDF i Excela.</b> Wyszukiwarka poniżej nie zawęża kartoteki miesięcznej, żeby nie drukować jednej operacji na kartce.</p>
      {haccpMonthlyGroups.length === 0 && <p className="hint">Brak kartotek zbiorczych dla wybranego okresu i filtrów.</p>}
      {haccpMonthlyGroups.length > 0 && <div className="table-wrap small"><table>
        <thead><tr><th>Kartoteka</th><th>Okres</th><th>Produkt / komora</th><th>Wpisy</th><th>Niezgodności</th><th>Akcje</th></tr></thead>
        <tbody>{haccpMonthlyGroups.map(g => <tr key={g.key}><td><b>{g.type}</b></td><td>{periodLabel(g)}</td><td>{g.product}{g.chamber ? ` / ${g.chamber}` : ''}</td><td>{g.docs.length}</td><td>{g.docs.filter(d => d.status === 'N').length}</td><td className="row-actions"><button className="mini secondary" onClick={() => setSelectedHaccpDoc({ groupPreview: true, group: g })}><Eye size={14}/> Kartoteka</button><button className="mini secondary" onClick={() => printHaccpGroup(g)}><Printer size={14}/> Druk/PDF</button><button className="mini secondary" onClick={() => exportHaccpGroupExcel(g)}>Excel</button></td></tr>)}</tbody>
      </table></div>}
      <h3>Wpisy w wybranej kartotece – edycja pojedynczych wierszy</h3>
      <p className="hint">Podgląd, druk/PDF i Excel wykonuj z sekcji „Kartoteki zbiorcze”. Poniżej edytujesz pojedyncze wiersze, żeby nie tworzyć osobnej kartki dla każdej dostawy.</p>
      {haccpDocsForFilter.length === 0 && <p className="hint">Brak wpisów {docsFilter} dla aktualnych filtrów. Dla K04/K07 pojawią się po utworzeniu partii produktu gotowego lub pracy w CP3/CCP1.</p>}
      {haccpDocsForFilter.length > 0 && <div className="table-wrap small"><table>
        <thead><tr><th>Partia</th><th>Produkt</th><th>Dostawca / PZ</th><th>Data</th><th>Komora</th><th>Status</th><th>Podpis</th><th>Akcje</th></tr></thead>
        <tbody>{haccpDocsForFilter.slice(0, 300).map(d => <tr key={d.id}>
          <td><b>{d.lot_no || '-'}</b></td><td>{d.product_name || '-'}</td><td>{shortSupplier(d.supplier_name, d.document_no) || '-'}</td><td>{d.document_date || '-'}</td><td>{d.chamber_code || '-'}</td><td><span className={statusClass(d)}>{statusLabel(d)}</span></td>
          <td><select className="mini-select" value={d.signed_by_operator || d.data?.podpis_przyjmujacego || ''} onChange={e=>setDocumentEmployee(d,e.target.value)}><option value="">Wybierz pracownika</option>{employees.map(emp=><option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}</select></td>
          <td className="row-actions"><button className="mini secondary" onClick={() => setSelectedHaccpDoc(d)}><Eye size={14}/> Szczegóły</button><button className="mini secondary" onClick={() => changeHaccpStatus(d, d.status === 'N' ? 'P' : 'N')}>{d.status === 'N' ? 'Zmień na P' : 'Zmień na N'}</button></td>
        </tr>)}</tbody>
      </table></div>}
    </section>
    {selectedHaccpDoc && renderHaccpPreview(selectedHaccpDoc)}
    </>}

    {activeTab === 'raporty' && <section className="card"><div className="section-title"><FileText/><div><h2>Raporty</h2><p>Tu będą raporty temperatur, FIFO, identyfikowalności i wydruki PDF.</p></div></div><p className="hint">Moduł raportów będzie rozbudowany w kolejnym etapie.</p></section>}

    {activeTab === 'ustawienia' && <>
    <section className="two">
      <div className="card"><h2>Produkty i kody partii</h2><div className="chips">{PRODUCTS.map(([n,c]) => <span key={c}>{n} <b>{c}/001/2026</b></span>)}</div></div>
      <div className="card"><h2>Zakładki dokumentów</h2>{DOCS.map(d => <div className="doc" key={d[0]}><b>{d[0]}</b><span>{d[1]}</span><small>{d[2]}</small></div>)}</div>
    </section>
    <section className="card">
      <div className="section-title"><ShieldCheck/><div><h2>Pracownicy do podpisów</h2><p>Lista osób dostępnych w polu „Podpis przyjmującego” w kartotekach HACCP.</p></div></div>
      <div className="form-grid compact">
        <label>Imię i nazwisko pracownika<input value={newEmployeeName} onChange={e => setNewEmployeeName(e.target.value)} placeholder="np. Jan Kowalski" /></label>
        <div className="actions employee-actions"><button className="secondary" onClick={addEmployee}>Dodaj pracownika</button></div>
      </div>
      {employees.length === 0 && <p className="hint">Brak pracowników. Dodaj pierwszą osobę, żeby można było wybierać podpis w K01.</p>}
      {employees.length > 0 && <div className="table-wrap small"><table><thead><tr><th>Pracownik</th><th>Rola</th><th>Akcje</th></tr></thead><tbody>{employees.map(emp => <tr key={emp.id}><td><b>{emp.full_name}</b></td><td>{emp.role_name || 'przyjmujący'}</td><td><button className="mini danger" onClick={() => deleteEmployee(emp)}><Trash2 size={14}/> Usuń</button></td></tr>)}</tbody></table></div>}
    </section>
    </>}
  </div>
}

createRoot(document.getElementById('root')).render(<App />)
