import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Upload, Database, FileText, Package, Printer, ShieldCheck, AlertTriangle, RefreshCcw, Warehouse, ArrowRightLeft, Eye, Trash2, Settings, ClipboardList, LayoutDashboard } from 'lucide-react'
import { supabase, isSupabaseConfigured } from './supabaseClient'
import { readAgromarExcel, classifyOperation } from './excelImport'
import { loadK03Forms, mergeK03Overrides, buildK03FormsFromExcelRows, buildK03FormsFromImportPreview, isSaleOperation, K03_ENGINE_VERSION, buildK03PaperData, buildK03PrintHtml, buildK03ExcelRows, loadK03Snapshots, mergeK03Snapshots, saveK03Snapshot } from './k03Engine'
import { loadWzQueue, previewK03Workflow, generateK03Workflow, revertK03Workflow, unfreezeK03Workflow, wzStatusLabel, suggestFrozenK03UnfreezeAfterImport, K03_WZ_ENGINE_VERSION } from './k03WzEngine'
import { recalculateFifoIncremental, recalculateFifoFullProtected, frozenKeysFromSnapshots, frozenOperationIdsFromSnapshots, countIncompleteSales } from './fifoEngine'
import { HACCP_FORMS_VERSION, buildSyntheticK04DocsFromTrace, buildSyntheticK07DocsFromTrace, buildSyntheticK06DocsFromTrace, buildK06InsertPayload, getLiveK04Doc, getLiveK07Doc, buildK04MonthlyHtml, buildK07MonthlyHtml, buildManualMonthlyHtml, buildManualExcelRows, buildK04ExcelRows, buildK07ExcelRows, MANUAL_HACCP_FORMS, normalizePn as formNormalizePn, k04TempForProductName, isDirectToSaleProduct, isIndustrialApple, isPeelingApple } from './haccpFormsEngine'
import * as XLSX from 'xlsx'
import './style.css'

const PRODUCTS = [
  ['Malina pulpa', 'Mp'], ['Porzeczka czarna', 'Pcz'], ['Porzeczka czarna pulpa', 'Pczp'], ['Porzeczka czerwona', 'Pk'], ['Porzeczka czerwona pulpa', 'Pkp'], ['Truskawka', 'T'],
  ['Truskawka z szypułką', 'Tsz'], ['Aronia', 'A'], ['Śliwka', 'S'], ['Wiśnia', 'W'],
  ['Malina klasa I', 'M1'], ['Malina extra', 'Mex'], ['Jabłko obierka', 'Jabobier'], ['Jabłko na obierkę', 'Jabobier'], ['Jabłko przemysłowe', 'Jab']
]

const DOCS_HUB_SECTIONS = [
  ['kartoteki', 'Kartoteki', 'K01–K07 karty kontrolne HACCP'],
  ['wykazy', 'Wykazy', 'W01–W10'],
  ['formularze', 'Formularze', 'F01–F03'],
  ['protokoly', 'Protokoły', 'PR01–PR08'],
  ['specyfikacje', 'Specyfikacje', 'S01–S09']
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


const K03_ASSORTMENT_TABS = [
  ['all', 'Wszystkie'],
  ['malina', 'Malina'],
  ['truskawka', 'Truskawka'],
  ['wisnia', 'Wiśnia'],
  ['porzeczka_czarna', 'Porzeczka czarna'],
  ['porzeczka_czerwona', 'Porzeczka czerwona'],
  ['aronia', 'Aronia'],
  ['jab_obier', 'Jabłko obierka'],
  ['jab_przem', 'Jabłko przemysłowe'],
  ['sliwka', 'Śliwka']
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
  if (isDirectToSaleProduct(productName)) return null
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
  const [docsHubSection, setDocsHubSection] = useState('kartoteki')
  const [docsFlyoutOpen, setDocsFlyoutOpen] = useState(false)
  const [docsDateFrom, setDocsDateFrom] = useState('')
  const [docsDateTo, setDocsDateTo] = useState('')
  const [docsWorkflowFilter, setDocsWorkflowFilter] = useState('all')
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
  const [k02Overrides, setK02Overrides] = useState({})
  const [k04Overrides, setK04Overrides] = useState({})
  const [k07Overrides, setK07Overrides] = useState({})
  const [defaultK04Employee, setDefaultK04Employee] = useState('')
  const [defaultK07Employee, setDefaultK07Employee] = useState('')
  const [defaultK06Employee, setDefaultK06Employee] = useState('')
  const [formsTrace, setFormsTrace] = useState({ operations: [], allocations: [] })
  const [manualHaccpForm, setManualHaccpForm] = useState({})
  const [k03FormsRaw, setK03FormsRaw] = useState([])
  const [k03Overrides, setK03Overrides] = useState({})
  const [k03AssortmentFilter, setK03AssortmentFilter] = useState('all')
  const [k03YearFilter, setK03YearFilter] = useState('all')
  const [k03MonthFilter, setK03MonthFilter] = useState('all')
  const [defaultK03Employee, setDefaultK03Employee] = useState('')
  const [k03Diag, setK03Diag] = useState({ wzDocs: 0, saleLines: 0, forms: 0, allocations: 0 })
  const [k03Loading, setK03Loading] = useState(false)
  const [k03PanelNote, setK03PanelNote] = useState('')
  const [k03Snapshots, setK03Snapshots] = useState([])
  const [wzQueueLines, setWzQueueLines] = useState([])
  const [k03WzModal, setK03WzModal] = useState(null)
  const [k03UnfreezeSuggestions, setK03UnfreezeSuggestions] = useState([])
  const [fifoChangeLog, setFifoChangeLog] = useState([])
  const [fifoRecalculating, setFifoRecalculating] = useState(false)
  const [auxRows, setAuxRows] = useState([])
  const [auxYear, setAuxYear] = useState(new Date().getFullYear().toString())
  const [auxHalf, setAuxHalf] = useState(new Date().getMonth() < 6 ? '1' : '2')
  const [auxForm, setAuxForm] = useState({ delivery_date: new Date().toISOString().slice(0,10), item_name: '', supplier_invoice: '', vehicle_hygiene: 'P', qty: '', lot_no: '', notes: '', signed_by: '' })
  const [selectedAuxCard, setSelectedAuxCard] = useState(null)
  const [auxPdfName, setAuxPdfName] = useState('')
  const [pzRows, setPzRows] = useState([])
  const [pzHistoryRows, setPzHistoryRows] = useState([])
  const [pzEditDates, setPzEditDates] = useState({})
  const [pzSearch, setPzSearch] = useState('')
  const [pzStatusFilter, setPzStatusFilter] = useState('all')
  const [fifoKartotekiDirty, setFifoKartotekiDirty] = useState(false)

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

  const visiblePzRows = useMemo(() => {
    const q = normalizeText(pzSearch)
    return (pzRows || []).filter(r => {
      if (pzStatusFilter !== 'all' && r.status_key !== pzStatusFilter) return false
      if (!q) return true
      return normalizeText(`${r.lot_no} ${r.document_no} ${r.product_name} ${r.product_group} ${r.supplier_name}`).includes(q)
    }).slice(0, 1000)
  }, [pzRows, pzSearch, pzStatusFilter])

  const HACCPCARDS = [
    ['K01', 'K01 – Przyjęcie surowca (CP1)', 'Dostawy PZ/MM, ocena surowca i pojazdu'],
    ['K01.1', 'K01.1 – Przyjęcie materiałów pomocniczych', 'Faktury zakupowe, opakowania i materiały pomocnicze'],
    ['K02', 'K02 – Magazynowanie surowca (CP2)', 'Komory surowca, temperatury i status P/N'],
    ['K03', 'K03 – Identyfikacja partii produktu', 'PZ użyte do konkretnego WZ, zgodnie z FIFO'],
    ['K04', 'K04 – Magazynowanie produktu gotowego (CP3/CCP1)', 'Produkty gotowe, pulpy i komory/beczki'],
    ['K04.1', 'K04.1 – Magazynowanie podczas transportu', 'Kontrola temperatury i opakowania w transporcie'],
    ['K05', 'K05 – Towary wycofane', 'Rejestr wycofań partii i działań korygujących'],
    ['K06', 'K06 – Ocena jakości produktu', 'Ocena sensoryczna partii gotowej / po produkcji'],
    ['K07', 'K07 – Kontrola sita / identyfikowalność', 'Kontrola przed przerobem oraz śledzenie partii']
  ]


  const MODULE_STATUS = [
    { code: 'K01', name: 'Przyjęcie surowca', status: 'gotowe', note: 'Kartoteka miesięczna, jeden asortyment, podpis z listy, druk/Excel.' },
    { code: 'K01.1', name: 'Materiały pomocnicze', status: 'robocze', note: 'Kartoteka półroczna i ręczna edycja. OCR faktur odłożony na później.' },
    { code: 'K02', name: 'Magazynowanie surowca', status: 'w realizacji', note: 'Następny formularz do dopracowania 1:1 z oryginałem.' },
    { code: 'K03', name: 'Identyfikacja partii produktu', status: 'w realizacji', note: 'Jeden formularz = jeden WZ. PZ po lewej, WZ po prawej, sumy zgodne z FIFO.' },
    { code: 'K04', name: 'Magazynowanie produktów gotowych', status: 'w realizacji', note: 'Miesięczna kartoteka dzienna per komora CP3/CCP1 – jak K02.' },
    { code: 'K04.1', name: 'Transport produktu', status: 'w realizacji', note: 'Ręczne wpisy transportu – druk/Excel.' },
    { code: 'K05', name: 'Towary wycofane', status: 'w realizacji', note: 'Ręczny rejestr wycofań.' },
    { code: 'K06', name: 'Ocena jakości produktu', status: 'w realizacji', note: 'Auto z produkcji + ręczna edycja P/N.' },
    { code: 'K07', name: 'Kontrola sita CCP1', status: 'w realizacji', note: 'Dzienna kartoteka sita na linii przerobu.' },
    { code: 'Raporty', name: 'R00–R13', status: 'do wykonania', note: 'Po kartach K.' },
    { code: 'Wykazy/Protokoły', name: 'W01–W10 / PR01–PR08', status: 'do wykonania', note: 'Po raportach podstawowych.' }
  ]

  const BACKLOG = [
    { prio: 'A', title: 'K02 1:1 z oryginałem', desc: 'Miesięczne kartoteki, podpis, P/N, druk, PDF, Excel.' },
    { prio: 'A', title: 'Stabilność importu/FIFO', desc: 'Pełne przeliczanie chronologiczne po imporcie starszych plików.' },
    { prio: 'A', title: 'Formularze do pracy', desc: 'K03, K04, K06 oraz wydruki zgodne ze wzorami.' },
    { prio: 'B', title: 'Graficzny podgląd komór', desc: 'CP2, CP3, CCP1 z zajętością i grupą asortymentową.' },
    { prio: 'B', title: 'OCR faktur PDF', desc: 'Odczyt faktur do K01.1 z podglądem i ręczną korektą.' },
    { prio: 'C', title: 'QR / aplikacja mobilna', desc: 'Po wersji produkcyjnej systemu.' }
  ]

  function statusClass(status) {
    if (status === 'gotowe') return 'status-green'
    if (status === 'robocze' || status === 'w realizacji') return 'status-yellow'
    return 'status-gray'
  }

  function k02TempForProducts(productNames = []) {
    const names = productNames.map(n => normalizeText(n)).join(' ')
    if (names.includes('malina')) return '1'
    return '2'
  }

  function buildSyntheticK02Docs(allDocs) {
    const k01 = (allDocs || []).filter(d => d.document_type === 'K01' && d.document_date)
    const byDay = new Map()
    for (const d of k01) {
      const day = String(d.document_date || '').slice(0, 10)
      if (!day) continue
      if (!byDay.has(day)) byDay.set(day, [])
      byDay.get(day).push(d)
    }
    return Array.from(byDay.entries()).sort(([a],[b]) => a.localeCompare(b)).map(([day, docs]) => {
      const products = Array.from(new Set(docs.map(d => d.product_name || '').filter(Boolean)))
      const temp = k02TempForProducts(products)
      const id = `K02-${day}`
      const ov = k02Overrides[id] || {}
      return {
        id,
        synthetic: true,
        document_type: 'K02',
        document_date: day,
        product_name: 'CP2 – magazyn surowca',
        lot_no: '',
        supplier_name: '',
        document_no: `K02/${day}`,
        chamber_code: 'CP2',
        qty: docs.reduce((sum, d) => sum + (Number(d.qty) || 0), 0),
        status: ov.status ?? 'P',
        data: {
          godzina: Object.prototype.hasOwnProperty.call(ov, 'godzina') ? ov.godzina : '09:15',
          temperatura_chlodnia_1: Object.prototype.hasOwnProperty.call(ov, 'temperatura_chlodnia_1') ? ov.temperatura_chlodnia_1 : temp,
          temperatura_chlodnia_2: Object.prototype.hasOwnProperty.call(ov, 'temperatura_chlodnia_2') ? ov.temperatura_chlodnia_2 : temp,
          podpis_kontrolujacego: Object.prototype.hasOwnProperty.call(ov, 'podpis_kontrolujacego') ? ov.podpis_kontrolujacego : '',
          uwagi: Object.prototype.hasOwnProperty.call(ov, 'uwagi') ? ov.uwagi : 'P',
          produkty: products.join(', '),
        },
        signed_by_operator: Object.prototype.hasOwnProperty.call(ov, 'podpis_kontrolujacego') ? ov.podpis_kontrolujacego : '',
        signed_by_admin: '',
        document_version: 'I/2024',
        created_at: day,
      }
    })
  }


  const formsTraceContext = useMemo(() => ({
    lots: stockRows,
    allocations: formsTrace.allocations || [],
    operations: formsTrace.operations || []
  }), [stockRows, formsTrace])

  const syntheticK04Docs = useMemo(() => buildSyntheticK04DocsFromTrace(formsTraceContext, k04Overrides), [formsTraceContext, k04Overrides])
  const syntheticK07Docs = useMemo(() => buildSyntheticK07DocsFromTrace(formsTraceContext, k07Overrides), [formsTraceContext, k07Overrides])
  const syntheticK06Docs = useMemo(() => buildSyntheticK06DocsFromTrace(formsTraceContext, haccpDocs), [formsTraceContext, haccpDocs])
  const mergedK06Docs = useMemo(() => {
    const fromDb = (haccpDocs || []).filter(d => d.document_type === 'K06')
    const dbLotIds = new Set(fromDb.map(d => d.lot_id).filter(Boolean))
    const extraSynthetic = syntheticK06Docs.filter(d => d.lot_id && !dbLotIds.has(d.lot_id))
    return [...fromDb, ...extraSynthetic].sort((a, b) =>
      String(a.document_date || '').localeCompare(String(b.document_date || '')) ||
      String(a.lot_no || '').localeCompare(String(b.lot_no || ''))
    )
  }, [haccpDocs, syntheticK06Docs])

  function matchesDocsDateRange(dateStr, from = docsDateFrom, to = docsDateTo) {
    const date = String(dateStr || '').slice(0, 10)
    if (!from && !to) return true
    if (!date || date === '0000-01-01') return false
    const f = from || '0000-01-01'
    const t = to || '9999-12-31'
    return date >= f && date <= t
  }

  function k03LineWorkflowTag(line) {
    if (line.status === 'pending') return 'nieprzerobione'
    if (line.frozen || line.status === 'frozen') return 'zamrozone'
    if (line.workflow?.mode === 'przerob') return 'przerobione'
    if (line.workflow?.mode === 'bez_przerobu') return 'bez_przerobu'
    if (line.status === 'legacy_auto') return 'czesciowo'
    if (line.status === 'k03_ready' && !line.frozen) {
      const doc = line.k03Form
      const fifoOk = doc?.data?.quantitiesMatch !== false && Number(doc?.data?.shortage || 0) <= 0
      if (!fifoOk || doc?.status === 'N') return 'czesciowo'
      if (!doc?.signed_by_operator) return 'do_zatwierdzenia'
      return 'przerobione'
    }
    return 'czesciowo'
  }

  function k03DocWorkflowTag(doc) {
    if (doc?.frozen || doc?.data?.frozen) return 'zamrozone'
    if (doc?.data?.k03_workflow?.mode === 'przerob') return 'przerobione'
    if (doc?.data?.k03_workflow?.mode === 'bez_przerobu') return 'bez_przerobu'
    const fifoOk = doc?.data?.quantitiesMatch !== false && Number(doc?.data?.shortage || 0) <= 0
    if (!fifoOk || doc?.status === 'N') return 'czesciowo'
    if (!doc?.signed_by_operator) return 'do_zatwierdzenia'
    return 'przerobione'
  }

  function matchesDocsWorkflowFilter(tag) {
    if (docsWorkflowFilter === 'all') return true
    return tag === docsWorkflowFilter
  }

  function selectKartoteka(code) {
    setDocsFilter(code)
    setDocsHubSection('kartoteki')
    setDocsFlyoutOpen(false)
    setDocsWorkflowFilter('all')
    if (code === 'K03') loadK03TraceData()
    if (MANUAL_HACCP_FORMS[code]) resetManualHaccpForm(code)
  }

  function renderDocsSidebar() {
    const isK03 = docsFilter === 'K03'
    const workflowOptions = isK03
      ? [
        ['all', 'Wszystkie stany'],
        ['do_zatwierdzenia', 'Do zatwierdzenia'],
        ['nieprzerobione', 'Nieprzerobione (oczekuje)'],
        ['przerobione', 'Po przerobie'],
        ['bez_przerobu', 'Bez przerobu (gotowiec)'],
        ['czesciowo', 'Częściowo / do uzupełnienia'],
        ['zamrozone', 'Zamrożone']
      ]
      : [
        ['all', 'Wszystkie'],
        ['do_zatwierdzenia', 'Do zatwierdzenia (brak podpisu)'],
        ['czesciowo', 'Niezgodności (N)']
      ]

    return <aside className="docs-sidebar">
      <div className="docs-sidebar-head">
        <span className="docs-sidebar-k">{docsFilter}</span>
        <small>{HACCPCARDS.find(c => c[0] === docsFilter)?.[1]?.replace(/^K[0-9.]+ – /, '') || ''}</small>
      </div>

      <div className="docs-sidebar-block">
        <h4>Zakres dat</h4>
        <label>Od<input type="date" value={docsDateFrom} onChange={e => setDocsDateFrom(e.target.value)} /></label>
        <label>Do<input type="date" value={docsDateTo} onChange={e => setDocsDateTo(e.target.value)} /></label>
        {(docsDateFrom || docsDateTo) && (
          <button type="button" className="mini secondary docs-clear-dates" onClick={() => { setDocsDateFrom(''); setDocsDateTo('') }}>Pokaż wszystko</button>
        )}
        {!docsDateFrom && !docsDateTo && <p className="hint sidebar-hint">Domyślnie widoczne są wszystkie daty.</p>}
      </div>

      <div className="docs-sidebar-block">
        <h4>Stan / workflow</h4>
        <label>Filtr
          <select value={docsWorkflowFilter} onChange={e => setDocsWorkflowFilter(e.target.value)}>
            {workflowOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>

      {isK03 && <div className="docs-sidebar-block">
        <h4>Asortyment</h4>
        <label>Grupa
          <select value={k03AssortmentFilter} onChange={e => setK03AssortmentFilter(e.target.value)}>
            {K03_ASSORTMENT_TABS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </label>
        <label>Podpis zbiorczy
          <select value={defaultK03Employee} onChange={e => setDefaultK03Employee(e.target.value)}>
            <option value="">—</option>
            {employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}
          </select>
        </label>
        <button type="button" className="mini secondary" onClick={() => setEmployeeForVisibleK03Forms(defaultK03Employee, true)}>Uzupełnij puste podpisy</button>
      </div>}

      <div className="docs-sidebar-block">
        <h4>Szukaj i status</h4>
        <label>Szukaj<input value={haccpSearch} onChange={e => setHaccpSearch(e.target.value)} placeholder="partia, PZ, WZ…" /></label>
        <label>Status P/N
          <select value={haccpStatusFilter} onChange={e => setHaccpStatusFilter(e.target.value)}>
            <option value="all">Wszystkie</option>
            <option value="P">P – prawidłowe</option>
            <option value="N">N – niezgodność</option>
          </select>
        </label>
      </div>

      <div className="docs-sidebar-stats">
        <span><b>{haccpCount(docsFilter)}</b> wpisów</span>
        <span><b>{haccpNonconformityCount(docsFilter)}</b> N</span>
        <span><b>{haccpPendingCount(docsFilter)}</b> bez podpisu</span>
      </div>
    </aside>
  }

  const syntheticK03Docs = useMemo(() => mergeK03Overrides(k03FormsRaw, k03Overrides), [k03FormsRaw, k03Overrides])
  const k03WorkflowHistory = useMemo(() => fifoChangeLog.filter(h => String(h.change_type || '').startsWith('k03_')), [fifoChangeLog])
  const filteredWzQueueLines = useMemo(() => {
    return (wzQueueLines || []).filter(line => {
      if (!matchesDocsDateRange(line.wz_date)) return false
      if (k03AssortmentFilter !== 'all') {
        const group = line.product_group || ''
        if (k03AssortmentFilter === 'jab_przem' && group !== 'jab_przem') return false
        if (k03AssortmentFilter === 'jab_obier' && group !== 'jab_obier') return false
        if (k03AssortmentFilter !== 'jab_przem' && k03AssortmentFilter !== 'jab_obier' && group !== k03AssortmentFilter) return false
      }
      if (!matchesDocsWorkflowFilter(k03LineWorkflowTag(line))) return false
      return true
    })
  }, [wzQueueLines, k03AssortmentFilter, docsDateFrom, docsDateTo, docsWorkflowFilter])
  const frozenKartoteki = useMemo(() => {
    const items = []
    for (const doc of syntheticK03Docs) {
      if (!doc.frozen && doc.data?.frozen !== true) continue
      items.push({
        type: 'K03',
        label: `${doc.document_no || '-'} · ${doc.product_name || ''}`,
        sub: doc.lot_no || doc.document_date || '',
        group: { key: doc.id, type: 'K03', product: doc.product_name, docs: [doc] }
      })
    }
    return items.sort((a, b) => String(b.group.docs[0]?.document_date || '').localeCompare(String(a.group.docs[0]?.document_date || '')))
  }, [syntheticK03Docs])

  function setK03GroupEmployee(doc, employeeName) {
    if (!doc?.id) return
    setK03Overrides(prev => ({ ...prev, [doc.id]: { ...(prev[doc.id] || {}), signed_by_operator: employeeName } }))
    setSelectedHaccpDoc(prev => {
      if (!prev?.groupPreview) return prev
      const group = prev.group
      if (!group?.docs?.some(d => d.id === doc.id)) return prev
      return { ...prev, group: { ...group, docs: group.docs.map(d => d.id === doc.id ? { ...d, signed_by_operator: employeeName, data: { ...(d.data || {}), saleRows: (d.data?.saleRows || []).map(r => ({ ...r, signed_by: employeeName })) } } : d) } }
    })
    const nextDoc = {
      ...doc,
      signed_by_operator: employeeName,
      data: {
        ...(doc.data || {}),
        saleRows: (doc.data?.saleRows || []).map(r => ({ ...r, signed_by: employeeName }))
      }
    }
    if (supabase) {
      saveK03Snapshot(supabase, nextDoc, { freeze: doc.frozen === true, userRole: userRole }).catch(err => {
        console.warn('K03 signature save', err)
      })
    }
  }

  async function unfreezeK03Document(doc) {
    if (!doc?.id || !supabase) return
    if (!doc.frozen && doc.data?.frozen !== true) {
      setMessage('Kartoteka nie jest zamrożona.')
      return
    }
    const reason = window.prompt('Podaj powód odmrożenia K03 (wymagane):')
    if (!reason?.trim()) {
      setMessage('Odmrożenie anulowane – brak powodu.')
      return
    }
    if (!window.confirm(`Odmrozić K03 dla WZ ${doc.document_no || ''}? FIFO będzie mógł ponownie zmienić to rozliczenie.`)) return
    try {
      await unfreezeK03Workflow(supabase, doc, reason.trim(), userRole)
      await loadK03TraceData()
      await loadFifoChangeLog()
      setK03UnfreezeSuggestions(prev => prev.filter(s => s.k03_key !== doc.id))
      setMessage(`K03 odmrożony: ${reason.trim()}`)
    } catch (err) {
      setMessage(`Błąd odmrożenia: ${err?.message || String(err)}`)
    }
  }

  function docFromK03Snapshot(snap) {
    if (!snap) return null
    return {
      id: snap.data?.k03_key || snap.data?.form_id,
      document_type: 'K03',
      document_no: snap.document_no,
      document_date: snap.document_date,
      product_name: snap.product_name,
      lot_no: snap.lot_no,
      qty: snap.qty,
      frozen: true,
      data: snap.data,
      signed_by_operator: snap.signed_by_operator || ''
    }
  }

  function renderK03UnfreezeBanner() {
    if (!k03UnfreezeSuggestions.length) return null
    return <section className="card k03-unfreeze-banner">
      <div className="section-title"><AlertTriangle/><div>
        <h2>Po imporcie – rozważ odmrożenie K03</h2>
        <p>Nowe dane mogą zmienić rozliczenie FIFO dla poniższych zamrożonych kartotek. Odmroż tylko te, których dotyczy import.</p>
      </div></div>
      <div className="unfreeze-suggest-list">
        {k03UnfreezeSuggestions.map(item => (
          <div key={item.k03_key || item.wz_no} className="unfreeze-suggest-item">
            <div className="unfreeze-suggest-main">
              <b>K03 · WZ {item.wz_no}</b>
              <span>{item.product_name}{item.lot_no ? ` · ${item.lot_no}` : ''}</span>
              <small>{item.wz_date || ''}</small>
            </div>
            <ul className="unfreeze-reasons">{item.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
            <div className="row-actions">
              <button className="mini secondary" onClick={() => {
                const doc = docFromK03Snapshot(item.snap)
                if (doc) unfreezeK03Document(doc)
              }}>Odmroź</button>
              <button className="mini secondary" onClick={() => {
                const doc = docFromK03Snapshot(item.snap)
                if (!doc) return
                setActiveTab('kartoteki')
                setDocsHubSection('kartoteki')
                setDocsFilter('K03')
                setSelectedHaccpDoc({ groupPreview: true, group: { key: doc.id, type: 'K03', product: doc.product_name, docs: [doc] } })
              }}><Eye size={14}/> Podgląd</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  }

  async function revertK03Line(line) {
    if (!line || !supabase) return
    if (line.frozen || line.status === 'frozen') {
      setMessage('Nie można cofnąć zamrożonego K03 – najpierw odmroź kartotekę.')
      return
    }
    if (!window.confirm(`Cofnąć decyzję K03 dla WZ ${line.document_no} / ${line.product_name}?`)) return
    const reason = window.prompt('Powód cofnięcia (opcjonalnie):') || 'Cofnięcie decyzji K03/WZ'
    try {
      await revertK03Workflow(supabase, line, { reason, changedBy: userRole })
      await loadK03TraceData()
      await loadFifoChangeLog()
      setMessage('Decyzja K03 cofnięta – pozycja wróciła do kolejki WZ.')
    } catch (err) {
      setMessage(`Błąd cofania: ${err?.message || String(err)}`)
    }
  }

  function openK03WzModal(line, mode) {
    const przerobDate = mode === 'przerob' ? new Date().toISOString().slice(0, 10) : ''
    setK03WzModal({ line, mode, przerobDate, lotNo: '', rawStored: false, preview: null, loading: false, saving: false, error: '', confirmMismatch: false })
  }

  async function refreshK03WzPreview() {
    if (!k03WzModal || !supabase) return
    setK03WzModal(m => ({ ...m, loading: true, error: '', preview: null }))
    try {
      const preview = await previewK03Workflow(supabase, k03WzModal.line, {
        mode: k03WzModal.mode,
        przerobDate: k03WzModal.przerobDate
      })
      if (!preview.ok) throw new Error(preview.error || 'Błąd podglądu FIFO.')
      setK03WzModal(m => ({ ...m, preview, loading: false }))
    } catch (err) {
      setK03WzModal(m => ({ ...m, loading: false, error: err?.message || String(err) }))
    }
  }

  async function confirmK03WzModal(acceptMismatch = false) {
    if (!k03WzModal || !supabase) return
    setK03WzModal(m => ({ ...m, saving: true, error: '' }))
    try {
      const result = await generateK03Workflow(supabase, k03WzModal.line, {
        mode: k03WzModal.mode,
        przerobDate: k03WzModal.przerobDate,
        lotNo: k03WzModal.lotNo,
        rawStored: k03WzModal.rawStored,
        acceptQuantityMismatch: acceptMismatch || k03WzModal.confirmMismatch,
        changedBy: userRole
      })
      if (result.needConfirm) {
        setK03WzModal(m => ({
          ...m,
          saving: false,
          preview: result.preview,
          error: result.message,
          confirmMismatch: true
        }))
        return
      }
      if (!result.ok) throw new Error(result.message || 'Nie udało się utworzyć K03.')
      const wzNo = k03WzModal.line.document_no
      const wzMode = k03WzModal.mode === 'przerob' ? 'przerób' : 'brak przerobu'
      const frozenNote = result.autoFrozen ? ' Kartoteka zamrożona automatycznie (kompletna i prawidłowa).' : ' Kartoteka pozostaje robocza (niespójność ilości – uzupełnij i odmroź ręcznie po korekcie).'
      setK03WzModal(null)
      await loadK03TraceData()
      await loadFifoChangeLog()
      setMessage(`K03 utworzony dla WZ ${wzNo} (${wzMode}).${frozenNote}`)
    } catch (err) {
      setK03WzModal(m => ({ ...m, saving: false, error: err?.message || String(err) }))
    }
  }

  function renderK03WzModal() {
    if (!k03WzModal) return null
    const { line, mode, preview, loading, saving, error, confirmMismatch } = k03WzModal
    const title = mode === 'przerob' ? 'Dodaj przerób → K03' : 'Brak przerobu → K03'
    const rawTotal = preview?.pzRows?.reduce((s, r) => s + Number(r.qty || 0), 0) || 0
    const mismatch = preview && (Math.abs(rawTotal - Number(preview.saleQty || 0)) >= 0.001 || Number(preview.shortage || 0) > 0)

    return <div className="modal-backdrop" onClick={() => !saving && setK03WzModal(null)}>
      <div className="haccp-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 720 }}>
        <h3>{title}</h3>
        <p><b>{line.product_name}</b> · WZ {line.document_no} · {Number(line.qty || 0).toLocaleString('pl-PL')} kg · {line.wz_date}</p>
        <div className="form-grid compact">
          {mode === 'przerob' && <>
            <label>Data przerobu (wymagana)
              <input type="date" value={k03WzModal.przerobDate} onChange={e => setK03WzModal(m => ({ ...m, przerobDate: e.target.value, preview: null, confirmMismatch: false }))} />
            </label>
            <label>Numer partii (opcjonalnie – auto jeśli puste)
              <input value={k03WzModal.lotNo} onChange={e => setK03WzModal(m => ({ ...m, lotNo: e.target.value }))} placeholder="np. T/001/2026" />
            </label>
            <p className="hint">FIFO dobiera PZ do daty przerobu (nie do daty WZ).</p>
          </>}
          {mode === 'bez_przerobu' && <>
            <label>Czy surowiec był magazynowany (K02)?
              <select value={k03WzModal.rawStored ? 'tak' : 'nie'} onChange={e => setK03WzModal(m => ({ ...m, rawStored: e.target.value === 'tak' }))}>
                <option value="nie">Nie – gotowiec / prosto na samochód</option>
                <option value="tak">Tak – wymaga K02</option>
              </select>
            </label>
            <p className="hint">Pomija K04/K06. FIFO dobiera PZ do daty WZ. Przy transporcie (np. jabłko przem.) użyj K04.1.</p>
          </>}
        </div>
        <div className="actions">
          <button className="secondary" onClick={refreshK03WzPreview} disabled={loading || saving}>{loading ? 'FIFO…' : 'Podgląd FIFO / PZ'}</button>
          <button onClick={() => confirmK03WzModal(confirmMismatch)} disabled={saving || (!preview && !confirmMismatch)}>
            {saving ? 'Zapisywanie…' : confirmMismatch ? 'Zatwierdź mimo ostrzeżenia' : 'Utwórz K03'}
          </button>
          <button className="secondary" onClick={() => setK03WzModal(null)} disabled={saving}>Anuluj</button>
        </div>
        {error && <p className="status danger">{error}</p>}
        {mismatch && preview && <p className="status danger">Niespójność: WZ {Number(preview.saleQty || 0).toLocaleString('pl-PL')} kg vs PZ {rawTotal.toLocaleString('pl-PL')} kg{Number(preview.shortage || 0) > 0 ? ` (brak ${Number(preview.shortage).toLocaleString('pl-PL')} kg)` : ''}.</p>}
        {preview?.pzRows?.length > 0 && <div className="table-wrap small"><table>
          <thead><tr><th>PZ</th><th>Data</th><th>Dostawca</th><th>Ilość kg</th></tr></thead>
          <tbody>{preview.pzRows.map((r, i) => <tr key={i}><td>{r.pz_no}</td><td>{r.pz_date}</td><td>{r.supplier}</td><td>{Number(r.qty || 0).toLocaleString('pl-PL')}</td></tr>)}</tbody>
        </table></div>}
      </div>
    </div>
  }

  async function loadK03SnapshotsOnly() {
    if (!supabase) return
    const snaps = await loadK03Snapshots(supabase)
    setK03Snapshots(snaps)
  }

  async function loadFifoChangeLog() {
    if (!supabase) return
    try {
      const { data, error } = await supabase
        .from('fifo_allocation_change_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100)
      if (!error) setFifoChangeLog(data || [])
    } catch {
      setFifoChangeLog([])
    }
  }

  function setEmployeeForVisibleK03Forms(employeeName, onlyEmpty = false) {
    if (!employeeName) {
      setMessage('Wybierz pracownika z listy.')
      return
    }
    const docs = haccpListDocs.filter(d => !onlyEmpty || !(d.signed_by_operator || d.data?.saleRows?.[0]?.signed_by))
    if (!docs.length) {
      setMessage(onlyEmpty ? 'Nie ma pustych podpisów do uzupełnienia.' : 'Brak formularzy do zmiany podpisu.')
      return
    }
    const confirmed = window.confirm(`Ustawić podpis „${employeeName}” dla ${docs.length} formularzy K03 na liście?`)
    if (!confirmed) return
    setK03Overrides(prev => {
      const next = { ...prev }
      for (const doc of docs) {
        if (onlyEmpty && (prev[doc.id]?.signed_by_operator || doc.signed_by_operator)) continue
        next[doc.id] = { ...(next[doc.id] || {}), signed_by_operator: employeeName }
      }
      return next
    })
    if (supabase) {
      for (const doc of docs) {
        if (onlyEmpty && doc.signed_by_operator) continue
        const nextDoc = { ...doc, signed_by_operator: employeeName, data: { ...(doc.data || {}), saleRows: (doc.data?.saleRows || []).map(r => ({ ...r, signed_by: employeeName })) } }
        saveK03Snapshot(supabase, nextDoc, { freeze: doc.frozen === true, userRole: userRole }).catch(() => {})
      }
    }
    setMessage(`Ustawiono podpis dla ${docs.length} formularzy K03. Możesz zmienić pojedynczy formularz w edycji.`)
  }

  function setK04Override(doc, field, value) {
    if (!doc?.id) return
    setK04Overrides(prev => ({
      ...prev,
      [doc.id]: {
        ...(prev[doc.id] || {}),
        [field]: value,
        uwagi: field === 'uwagi' ? formNormalizePn(value) : (prev[doc.id]?.uwagi ?? doc.data?.uwagi ?? 'P')
      }
    }))
  }

  function setK07Override(doc, field, value) {
    if (!doc?.id) return
    setK07Overrides(prev => ({
      ...prev,
      [doc.id]: {
        ...(prev[doc.id] || {}),
        [field]: value,
        uwagi: field === 'uwagi' ? formNormalizePn(value) : (prev[doc.id]?.uwagi ?? doc.data?.uwagi ?? 'P')
      }
    }))
  }

  function setEmployeeForVisibleK04Group(group, employeeName, onlyEmpty = false) {
    if (!group || !employeeName) return
    const docs = (group.docs || []).filter(d => !onlyEmpty || !(d.signed_by_operator || d.data?.podpis_kontrolujacego))
    if (!docs.length) { setMessage(onlyEmpty ? 'Nie ma pustych podpisów K04.' : 'Brak wpisów K04.'); return }
    setK04Overrides(prev => {
      const next = { ...prev }
      for (const doc of docs) next[doc.id] = { ...(next[doc.id] || {}), podpis_kontrolujacego: employeeName }
      return next
    })
    setMessage(`Ustawiono podpis K04 dla ${docs.length} wpisów.`)
  }

  function setEmployeeForVisibleK07Group(group, employeeName, onlyEmpty = false) {
    if (!group || !employeeName) return
    const docs = (group.docs || []).filter(d => !onlyEmpty || !(d.signed_by_operator || d.data?.podpis_kontrolujacego))
    if (!docs.length) { setMessage(onlyEmpty ? 'Nie ma pustych podpisów K07.' : 'Brak wpisów K07.'); return }
    setK07Overrides(prev => {
      const next = { ...prev }
      for (const doc of docs) next[doc.id] = { ...(next[doc.id] || {}), podpis_kontrolujacego: employeeName }
      return next
    })
    setMessage(`Ustawiono podpis K07 dla ${docs.length} wpisów.`)
  }

  async function setEmployeeForVisibleK06Group(group, employeeName, onlyEmpty = false) {
    if (!group || !employeeName) return
    const docs = (group.docs || []).filter(d => !onlyEmpty || !d.signed_by_operator)
    if (!docs.length) { setMessage(onlyEmpty ? 'Nie ma pustych podpisów K06.' : 'Brak wpisów K06.'); return }
    if (!supabase) { setMessage('Brak bazy – podpis K06 wymaga Supabase.'); return }
    try {
      for (const doc of docs) {
        if (doc.synthetic && !doc.lot_id) continue
        if (doc.id && !String(doc.id).startsWith('K06-syn-')) {
          await supabase.from('haccp_documents').update({ signed_by_operator: employeeName, updated_at: new Date().toISOString() }).eq('id', doc.id)
        }
      }
      await loadHaccpDocs()
      setMessage(`Ustawiono podpis K06 dla ${docs.length} pozycji.`)
    } catch (err) {
      setMessage(`Błąd podpisu K06: ${err.message}`)
    }
  }

  function setK02Override(doc, field, value) {
    if (!doc?.id) return
    setK02Overrides(prev => {
      const current = prev[doc.id] || {}
      return {
        ...prev,
        [doc.id]: {
          ...current,
          [field]: value,
          status: field === 'uwagi' ? normalizePN(value) : (current.status ?? doc.status ?? 'P')
        }
      }
    })
  }

  function k02FieldValue(doc, field, fallback = '') {
    const override = k02Overrides?.[doc?.id]
    if (override && Object.prototype.hasOwnProperty.call(override, field)) return override[field]
    const data = doc?.data || {}
    if (Object.prototype.hasOwnProperty.call(data, field)) return data[field]
    return fallback
  }

  function getLiveK02Doc(doc) {
    if (!doc?.id) return doc
    const ov = k02Overrides?.[doc.id] || {}
    const data = {
      ...(doc.data || {}),
      ...ov,
      uwagi: Object.prototype.hasOwnProperty.call(ov, 'uwagi') ? ov.uwagi : (doc.data?.uwagi ?? doc.status ?? 'P')
    }
    return {
      ...doc,
      data,
      status: Object.prototype.hasOwnProperty.call(ov, 'uwagi') ? normalizePN(ov.uwagi) : (ov.status ?? doc.status ?? 'P'),
      signed_by_operator: Object.prototype.hasOwnProperty.call(ov, 'podpis_kontrolujacego') ? ov.podpis_kontrolujacego : (doc.signed_by_operator || doc.data?.podpis_kontrolujacego || '')
    }
  }

  const haccpDocsForFilter = useMemo(() => {
    const q = normalizeText(haccpSearch)
    const sourceDocs = docsFilter === 'K02' ? buildSyntheticK02Docs(haccpDocs)
      : docsFilter === 'K03' ? syntheticK03Docs
      : docsFilter === 'K04' ? syntheticK04Docs
      : docsFilter === 'K06' ? mergedK06Docs
      : docsFilter === 'K07' ? syntheticK07Docs
      : haccpDocs
    return sourceDocs
      .filter(d => d.document_type === docsFilter)
      .filter(d => {
        if (docsFilter !== 'K03' || k03AssortmentFilter === 'all') return true
        const group = d.product_group || d.data?.product_group || productGroupForName(d.product_name || '')
        return group === k03AssortmentFilter
      })
      .filter(d => matchesDocsDateRange(d.document_date))
      .filter(d => {
        if (docsFilter !== 'K03') {
          if (docsWorkflowFilter === 'all') return true
          if (docsWorkflowFilter === 'do_zatwierdzenia') return !d.signed_by_operator
          if (docsWorkflowFilter === 'czesciowo') return d.status === 'N'
          return true
        }
        return matchesDocsWorkflowFilter(k03DocWorkflowTag(d))
      })
      .filter(d => haccpStatusFilter === 'all' || d.status === haccpStatusFilter)
      .filter(d => {
        if (!q) return true
        return normalizeText(`${d.lot_no || ''} ${d.product_name || ''} ${d.supplier_name || ''} ${d.document_no || ''} ${d.chamber_code || ''}`).includes(q)
      })
  }, [haccpDocs, docsFilter, haccpSearch, haccpStatusFilter, k02Overrides, syntheticK03Docs, syntheticK04Docs, syntheticK07Docs, mergedK06Docs, k03AssortmentFilter, docsDateFrom, docsDateTo, docsWorkflowFilter])


  function docInSelectedPeriod(doc) {
    return matchesDocsDateRange(doc.document_date)
  }

  const haccpPeriodDocs = useMemo(() => {
    return haccpDocsForFilter.filter(docInSelectedPeriod)
  }, [haccpDocsForFilter, docsDateFrom, docsDateTo])

  const haccpListDocs = useMemo(() => haccpPeriodDocs, [haccpPeriodDocs])

  const k03AssortmentCounts = useMemo(() => {
    const filtered = syntheticK03Docs.filter(d => matchesDocsDateRange(d.document_date))
    const counts = new Map([['all', filtered.length]])
    for (const doc of filtered) {
      const group = doc.product_group || doc.data?.product_group || productGroupForName(doc.product_name || '')
      counts.set(group, (counts.get(group) || 0) + 1)
    }
    return counts
  }, [syntheticK03Docs, docsDateFrom, docsDateTo])

  const k03YearOptions = useMemo(() => {
    const years = new Set()
    for (const doc of syntheticK03Docs) {
      const year = String(doc.document_date || '').slice(0, 4)
      if (year && year !== '0000') years.add(year)
    }
    return Array.from(years).sort((a, b) => b.localeCompare(a))
  }, [syntheticK03Docs])

  const haccpMonthlyGroups = useMemo(() => {
    // Kartoteki zbiorcze korzystają z tych samych dokumentów co filtr okresu,
    // ale grupują je do kartotek miesięcznych/asortymentowych.
    // Na stronie głównej NIE pokazujemy pojedynczych dostaw jako osobnych kartotek.
    const source = haccpListDocs

    const map = new Map()
    for (const doc of source) {
      const period = String(doc.document_date || '').slice(0, 7) || haccpMonth || 'brak-daty'
      const product = doc.product_name || 'Bez produktu'
      const chamber = doc.document_type === 'K02' || doc.document_type === 'K04' ? (doc.chamber_code || 'bez komory') : ''
      const productGroup = doc.document_type === 'K04' ? (doc.data?.product_group || doc.product_name || 'produkt') : (doc.product_name || 'Bez produktu')
      const key = doc.document_type === 'K01'
        ? `${doc.document_type}|${period}|${product}`
        : doc.document_type === 'K03'
          ? `${doc.document_type}|${doc.id}|${doc.document_no || 'brak-wz'}`
          : ['K05', 'K06', 'K04.1', 'K07'].includes(doc.document_type)
            ? `${doc.document_type}|${period}`
            : doc.document_type === 'K02'
              ? `${doc.document_type}|${period}`
              : doc.document_type === 'K04'
                ? `${doc.document_type}|${period}|${chamber}|${productGroup}`
                : `${doc.document_type}|${period}|${product}|${chamber}`
      if (!map.has(key)) map.set(key, { key, type: doc.document_type, period, product: doc.document_type === 'K04' ? productGroup : product, chamber, docs: [] })
      map.get(key).docs.push(doc)
    }
    return Array.from(map.values()).map(g => {
      const docs = g.docs.sort((a,b) => String(a.document_date || '').localeCompare(String(b.document_date || '')) || String(a.document_no || '').localeCompare(String(b.document_no || '')))
      const products = Array.from(new Set(docs.map(d => d.product_name || '').filter(Boolean)))
      return {
        ...g,
        product: g.type === 'K04'
          ? (products.length === 1 ? products[0] : (docs[0]?.data?.produkty || g.product))
          : g.type === 'K01'
            ? (products.length === 1 ? products[0] : 'według wpisów w tabeli')
            : g.product,
        docs
      }
    })
  }, [haccpListDocs])

  function buildK01MonthlyGroupForPeriod(period) {
    const docs = haccpDocs
      .filter(d => d.document_type === 'K01')
      .filter(d => String(d.document_date || '').slice(0, 7) === period)
      .sort((a,b) => String(a.document_date || '').localeCompare(String(b.document_date || '')) || String(a.document_no || '').localeCompare(String(b.document_no || '')))
    if (!docs.length) return null
    const products = Array.from(new Set(docs.map(d => d.product_name || '').filter(Boolean)))
    return {
      key: `K01|${period}|forced`,
      type: 'K01',
      period,
      product: products.length === 1 ? products[0] : 'według wpisów w tabeli',
      chamber: '',
      docs
    }
  }

  function findMonthlyGroupForDoc(doc) {
    if (!doc) return null
    const period = String(doc.document_date || '').slice(0, 7)
    if (doc.document_type === 'K01') {
      // Nie opieramy się na aktualnie wybranym miesiącu/filtrach, bo wtedy kliknięcie
      // w wierszu z października nie działa, jeśli u góry wybrany jest inny miesiąc.
      return haccpMonthlyGroups.find(g => g.type === 'K01' && g.period === period) || buildK01MonthlyGroupForPeriod(period)
    }
    if (doc.document_type === 'K03') {
      return haccpMonthlyGroups.find(g => g.type === 'K03' && g.docs.some(d => d.id === doc.id)) || null
    }
    if (['K05', 'K06', 'K04.1', 'K07'].includes(doc.document_type)) {
      return haccpMonthlyGroups.find(g => g.type === doc.document_type && g.period === period) || null
    }
    const product = doc.product_name || 'Bez produktu'
    const productGroup = doc.data?.product_group || product
    const chamber = doc.document_type === 'K02' || doc.document_type === 'K04' ? (doc.chamber_code || 'bez komory') : ''
    if (doc.document_type === 'K04') {
      return haccpMonthlyGroups.find(g => g.type === 'K04' && g.period === period && g.chamber === chamber && g.product === productGroup) || null
    }
    return haccpMonthlyGroups.find(g => g.type === doc.document_type && g.period === period && g.product === product && g.chamber === chamber) || null
  }

  function haccpCount(type) {
    if (type === 'K03') return syntheticK03Docs.length
    if (type === 'K04') return syntheticK04Docs.length
    if (type === 'K06') return mergedK06Docs.length
    if (type === 'K07') return syntheticK07Docs.length
    return haccpDocs.filter(d => d.document_type === type).length
  }

  function haccpNonconformityCount(type) {
    if (type === 'K03') return syntheticK03Docs.filter(d => d.status === 'N').length
    if (type === 'K04') return syntheticK04Docs.filter(d => d.status === 'N').length
    if (type === 'K06') return mergedK06Docs.filter(d => d.status === 'N').length
    if (type === 'K07') return syntheticK07Docs.filter(d => d.status === 'N').length
    return haccpDocs.filter(d => d.document_type === type && d.status === 'N').length
  }

  function haccpPendingCount(type) {
    if (type === 'K03') return syntheticK03Docs.filter(d => !d.signed_by_operator).length
    if (type === 'K04') return syntheticK04Docs.filter(d => !d.signed_by_operator).length
    if (type === 'K06') return mergedK06Docs.filter(d => !d.signed_by_operator).length
    if (type === 'K07') return syntheticK07Docs.filter(d => !d.signed_by_operator).length
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

  function printHtmlInIframe(html) {
    try {
      const oldFrame = document.getElementById('haccp-print-frame')
      if (oldFrame) oldFrame.remove()
      const frame = document.createElement('iframe')
      frame.id = 'haccp-print-frame'
      frame.title = 'HACCP print'
      frame.style.position = 'fixed'
      frame.style.right = '0'
      frame.style.bottom = '0'
      frame.style.width = '0'
      frame.style.height = '0'
      frame.style.border = '0'
      document.body.appendChild(frame)
      const doc = frame.contentWindow?.document
      if (!doc) throw new Error('Brak dostępu do iframe wydruku')
      doc.open()
      doc.write(html)
      doc.close()
      setTimeout(() => {
        frame.contentWindow?.focus()
        frame.contentWindow?.print()
      }, 500)
    } catch (err) {
      const win = window.open('', '_blank', 'width=1200,height=800')
      if (!win) {
        setMessage('Przeglądarka zablokowała okno drukowania. Zezwól na wyskakujące okna dla tej strony.')
        return
      }
      win.document.open()
      win.document.write(html)
      win.document.close()
    }
  }

  function isAgromarDisplayName(value) {
    return /agro[-\s]?mar|mariusz\s+bańka|mariusz\s+banka/i.test(String(value || ''))
  }

  function cleanSupplierName(value) {
    let supplier = String(value || '').trim()
    supplier = supplier.replace(/,?\s*NIP\s*[:\-]?\s*\d+.*/i, '')
    supplier = supplier.split(/,\s*(ul\.|kolonia|\d{2}-\d{3}|polska)/i)[0]
    supplier = supplier.replace(/\s+/g, ' ').trim()
    if (isAgromarDisplayName(supplier)) return ''
    return supplier
  }

  function getK01SupplierName(doc) {
    const manual = cleanSupplierName(doc?.data?.faktyczny_dostawca || doc?.data?.dostawca_rzeczywisty || doc?.data?.dostawca || '')
    if (manual) return manual
    return cleanSupplierName(doc?.supplier_name || '')
  }

  function shortSupplier(nameOrDoc, docNo) {
    const isDoc = nameOrDoc && typeof nameOrDoc === 'object'
    const doc = isDoc ? nameOrDoc : null
    const supplier = doc ? getK01SupplierName(doc) : cleanSupplierName(nameOrDoc)
    const no = doc ? doc.document_no : docNo
    return [supplier || 'Brak dostawcy', no].filter(Boolean).join(' / ')
  }

  function buildK01PrintHtml(doc) {
    const pn = (field) => normalizePN(doc.data?.[field])
    const dataDostawy = doc.document_date || ''
    const dostawca = shortSupplier(doc)
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
    let workingDoc = doc
    if (doc.synthetic && doc.lot_id && doc.document_type === 'K06') {
      const { data: inserted, error } = await supabase.from('haccp_documents').insert(buildK06InsertPayload(doc)).select('id').single()
      if (error) { setMessage(`K06: nie udało się zapisać wpisu auto: ${error.message}`); return }
      workingDoc = { ...doc, id: inserted.id, synthetic: false }
      await loadHaccpDocs()
    }
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
        const nextData = { ...(workingDoc.data || {}), [field]: nextValue, uwagi: reason }
        await updateHaccpDocumentField(workingDoc, field, label, currentValue, nextValue, nextData, reason)
        return
      }
    } else {
      nextValue = options.directValue ?? window.prompt(`Edytuj pole: ${label}`, currentValue || '')
      if (nextValue === null) return
    }
    const reason = options.directValue ? 'Zmiana z poziomu kartoteki' : (window.prompt('Powód zmiany / korekty:', 'Korekta zapisu') || 'Korekta zapisu')
    const nextData = { ...(workingDoc.data || {}), [field]: nextValue }
    await updateHaccpDocumentField(workingDoc, field, label, currentValue, nextValue, nextData, reason)
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
              <td><K01Value doc={doc} field="dane_dostawcy" label="Dane dostawcy / nr faktury">{shortSupplier(doc)}</K01Value><button type="button" className="mini secondary no-print" onClick={()=>promptK01Supplier(doc)}>Zmień dostawcę</button></td>
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
      return `<tr><td>${i+1}</td><td>${escapeHtml(doc.document_date || '')}</td><td style="text-align:left">${escapeHtml(shortSupplier(doc))}</td><td>${pn('stan_higieniczny_pojazdu')}</td><td>${escapeHtml(Number(doc.qty || 0).toLocaleString('pl-PL'))}</td><td>${pn('wybarwienie_zapach_brak_uszkodzen')}</td><td>${pn('brak_zgnilizny_zaplesnienia_zagrzybienia')}</td><td>${escapeHtml(podpis)}</td></tr>`
    }).join('')
    const blanks = Array.from({ length: Math.max(0, 14 - docs.length) }, (_, i) => `<tr class="blank-row"><td>${docs.length+i+1}</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`).join('')
    return `<!doctype html><html><head><meta charset="utf-8"><title>K01 ${escapeHtml(group.product)} ${escapeHtml(group.period)}</title><style>@page{size:A4 landscape;margin:8mm}body{font-family:"Times New Roman",serif;color:#111;margin:0}table{width:100%;border-collapse:collapse}td,th{border:1px solid #111;padding:5px;text-align:center;vertical-align:middle;font-size:10.5pt;line-height:1.08}.company{width:30%;font-size:10.5pt}.title{width:55%;font-size:12pt}.meta{width:15%;text-align:left;vertical-align:top}.raw-name{height:34px}.blank-row td{height:28px}.foot{margin-top:8px;font-size:10pt;text-align:left}@media print{button{display:none}}</style></head><body><table><tbody><tr><td class="company" rowspan="2"><b>AGRO-MAR MARIUSZ<br>BAŃKA SP. Z O.O.<br>24-335 ŁAZISKA,<br>KOLONIA ŁAZISKA 30<br>NIP: 7171839598</b><br><b>Wersja I/2024</b></td><td class="title"><b>Karta K01 – Karta kontroli przyjęcia surowców (CP1)</b></td><td class="meta" rowspan="2"><b>Rok:</b> ${escapeHtml(year)}<br><b>Miesiąc:</b> ${escapeHtml(month)}<br><b>Strona:</b> 1</td></tr><tr><td class="raw-name"><b>Nazwa surowca:</b> ${escapeHtml(group.product || '')}</td></tr></tbody></table><table><thead><tr><th rowspan="2">Lp.</th><th rowspan="2">Data dostawy</th><th rowspan="2">Dane dostawcy/<br>nr faktury</th><th rowspan="2">Stan higieniczny<br>pojazdu<br>(P/N)*</th><th rowspan="2">Ilość</th><th colspan="2">Ocena surowca (P/N)*</th><th rowspan="2">Podpis przyjmującego</th></tr><tr><th>Wybarwienie/zapach/<br>brak uszkodzeń<br>mechanicznych</th><th>Brak zgnilizny/<br>zapleśnienia/<br>zagrzybienia</th></tr></thead><tbody>${rows}${blanks}</tbody></table><div class="foot">* P – prawidłowo, N – nieprawidłowo. Liczba wpisów w kartotece: ${docs.length}</div><script>window.onload=function(){setTimeout(function(){window.focus();window.print()},700)}</script></body></html>`
  }

  function buildK02MonthlyHtml(group) {
    const docs = group.docs || []
    const year = (docs[0]?.document_date || group.period || '').slice(0, 4)
    const month = (docs[0]?.document_date || group.period || '').slice(5, 7)
    const rows = docs.map((doc, i) => `<tr><td>${escapeHtml(doc.document_date || '')}</td><td>${escapeHtml(doc.data?.godzina || '09:15')}</td><td>${escapeHtml(doc.data?.temperatura_chlodnia_1 || '2')}</td><td>${escapeHtml(doc.data?.temperatura_chlodnia_2 || '2')}</td><td>${escapeHtml(doc.signed_by_operator || doc.data?.podpis_kontrolujacego || '')}</td><td>${normalizePN(doc.data?.uwagi || doc.status || 'P')}</td></tr>`).join('')
    const blanks = Array.from({ length: Math.max(0, 16 - docs.length) }, () => `<tr class="blank-row"><td></td><td></td><td></td><td></td><td></td><td></td></tr>`).join('')
    return `<!doctype html><html><head><meta charset="utf-8"><title>K02 ${escapeHtml(group.period)}</title><style>@page{size:A4 landscape;margin:8mm}body{font-family:"Times New Roman",serif;color:#111;margin:0}table{width:100%;border-collapse:collapse;table-layout:fixed}td,th{border:1px solid #111;padding:4px;text-align:center;vertical-align:middle;font-size:11pt;line-height:1.12}.company{width:31%;font-size:15pt;font-weight:bold;line-height:1.12}.title{width:44%;font-size:15pt;font-weight:bold;line-height:1.5}.meta{width:25%;font-size:13pt;text-align:left;vertical-align:top}.temp-note{text-align:left;font-size:12pt;line-height:1.15;padding-left:8px}.blank-row td{height:21px}.date{width:15%}.hour{width:15%}.temp{width:13%}.sign{width:18%}.notes{width:21%}@media print{button{display:none}}</style></head><body><table><tbody><tr><td class="company" rowspan="2">AGRO-MAR<br>MARIUSZ BAŃKA<br>SP. Z O.O.<br>24-335 ŁAZISKA,<br>KOLONIA ŁAZISKA 30<br>NIP: 7171839598</td><td class="title">Karta K02 - Karta kontroli parametrów<br>magazynowania surowców (CP2)</td><td class="meta"><b>Rok:</b> ${escapeHtml(year)}<br><br><b>Miesiąc:</b> ${escapeHtml(month)}</td></tr><tr><td class="temp-note">- Temp. w chłodniach docelowo:<br>2-3°C (±1°C). – GRUPA I i II (jabłka, gruszki,<br>truskawki, wiśnie, porzeczki czarne i czerwone, aronie)<br>0-1°C – GRUPA III (maliny, porzeczki czarne<br>i czerwone)</td><td class="meta" style="text-align:center;vertical-align:middle">Wersja I/2024</td></tr></tbody></table><table><thead><tr><th class="date">Data</th><th class="hour">Godzina</th><th class="temp">Temperatura<br>w chłodni<br>surowca<br>nr 1 [°C]</th><th class="temp">Temperatura<br>w chłodni<br>surowca<br>nr 2 [°C]</th><th class="sign">Podpis osoby<br>kontrolującej</th><th class="notes">Uwagi<br>(P/N)*</th></tr></thead><tbody>${rows}${blanks}</tbody></table><script>window.onload=function(){setTimeout(function(){window.focus();window.print()},700)}</script></body></html>`
  }


  function buildK03MonthlyHtml(group) {
    const doc = (group.docs || [])[0]
    if (!doc) return '<!doctype html><html><body>Brak danych K03</body></html>'
    return buildK03PrintHtml(doc)
  }

  async function printHaccpGroup(group) {
    if (!group) return
    const html = group.type === 'K01' ? buildK01MonthlyHtml(group)
      : group.type === 'K03' ? buildK03MonthlyHtml(group)
      : group.type === 'K04' ? buildK04MonthlyHtml(group, escapeHtml)
      : group.type === 'K07' ? buildK07MonthlyHtml(group, escapeHtml)
      : MANUAL_HACCP_FORMS[group.type] ? buildManualMonthlyHtml(group, escapeHtml, MANUAL_HACCP_FORMS[group.type])
      : buildK02MonthlyHtml(group)
    printHtmlInIframe(html)
  }

  function exportHaccpGroupExcel(group) {
    const docs = group.docs || []
    const rows = []
    if (group.type === 'K01') {
      rows.push(['AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.'])
      rows.push(['Karta K01 – Karta kontroli przyjęcia surowców (CP1)', '', '', '', '', '', '', `Okres: ${periodLabel(group)}`])
      rows.push(['Nazwa surowca:', group.product])
      rows.push(['Lp.', 'Data dostawy', 'Dane dostawcy / nr faktury', 'Stan higieniczny pojazdu (P/N)', 'Ilość', 'Wybarwienie/zapach/brak uszkodzeń (P/N)', 'Brak zgnilizny/zapleśnienia/zagrzybienia (P/N)', 'Podpis przyjmującego'])
      docs.forEach((doc, i) => rows.push([i+1, doc.document_date || '', shortSupplier(doc), normalizePN(doc.data?.stan_higieniczny_pojazdu), Number(doc.qty || 0), normalizePN(doc.data?.wybarwienie_zapach_brak_uszkodzen), normalizePN(doc.data?.brak_zgnilizny_zaplesnienia_zagrzybienia), doc.signed_by_operator || doc.data?.podpis_przyjmujacego || '']))
    } else if (group.type === 'K02') {
      rows.push(['AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.'])
      rows.push(['Karta K02 - Karta kontroli parametrów magazynowania surowców (CP2)', '', '', '', '', `Okres: ${periodLabel(group)}`])
      rows.push(['Data', 'Godzina', 'Temperatura chłodni surowca nr 1 [°C]', 'Temperatura chłodni surowca nr 2 [°C]', 'Podpis osoby kontrolującej', 'Uwagi (P/N)'])
      docs.forEach(doc => rows.push([doc.document_date || '', doc.data?.godzina || '09:15', doc.data?.temperatura_chlodnia_1 || '2', doc.data?.temperatura_chlodnia_2 || '2', doc.signed_by_operator || doc.data?.podpis_kontrolujacego || '', normalizePN(doc.data?.uwagi || 'P')]))
    } else if (group.type === 'K04') {
      rows.push(...buildK04ExcelRows(group))
    } else if (group.type === 'K07') {
      rows.push(...buildK07ExcelRows(group))
    } else if (MANUAL_HACCP_FORMS[group.type]) {
      rows.push(...buildManualExcelRows(group, MANUAL_HACCP_FORMS[group.type]))
    } else if (group.type === 'K03') {
      const doc = (docs || [])[0]
      if (doc) rows.push(...buildK03ExcelRows(doc))
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

  async function setEmployeeForVisibleK01Group(group, employeeName, onlyEmpty = false) {
    if (!supabase || !group || !employeeName) return
    const docs = (group.docs || []).filter(d => !onlyEmpty || !(d.signed_by_operator || d.data?.podpis_przyjmujacego))
    if (!docs.length) { setMessage(onlyEmpty ? 'Nie ma pustych podpisów do uzupełnienia.' : 'Brak pozycji do zmiany podpisu.'); return }
    const confirmed = window.confirm(`Ustawić podpis "${employeeName}" dla ${docs.length} pozycji w tej kartotece K01? Poprzednie podpisy w tych wierszach zostaną zastąpione.`)
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
      const ids = new Set(docs.map(d => d.id))
      setHaccpDocs(prev => prev.map(d => ids.has(d.id) ? { ...d, data: { ...(d.data || {}), podpis_przyjmujacego: employeeName }, signed_by_operator: employeeName } : d))
      setSelectedHaccpDoc(prev => {
        if (!prev) return prev
        if (prev.groupPreview && prev.group?.docs) {
          return { ...prev, group: { ...prev.group, docs: prev.group.docs.map(d => ids.has(d.id) ? { ...d, data: { ...(d.data || {}), podpis_przyjmujacego: employeeName }, signed_by_operator: employeeName } : d) } }
        }
        return prev
      })
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
          <label>Podpis przyjmującego dla całej kartoteki
            <select value={defaultK01Employee} onChange={e => setDefaultK01Employee(e.target.value)}>
              <option value="">Wybierz pracownika</option>
              {employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}
            </select>
          </label>
          <button className="secondary" onClick={() => setEmployeeForVisibleK01Group(group, defaultK01Employee, false)}>Zastosuj do wszystkich pozycji</button>
          <button className="secondary" onClick={() => setEmployeeForVisibleK01Group(group, defaultK01Employee, true)}>Uzupełnij tylko puste</button>
          <span className="hint">Po zastosowaniu można nadal zmienić pojedynczy wiersz w ostatniej kolumnie.</span>
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
              <td style={{textAlign:'left'}}><span>{shortSupplier(doc)}</span><button type="button" className="mini secondary no-print" onClick={()=>promptK01Supplier(doc)}>Zmień dostawcę</button></td>
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
    if (group.type === 'K02') {
      const maxRows = Math.max(16, docs.length)
      return <div className="monthly-paper k02-original">
        <table className="k02-head"><tbody>
          <tr>
            <td className="k02-company" rowSpan="2"><b>AGRO-MAR<br/>MARIUSZ BAŃKA<br/>SP. Z O.O.<br/>24-335 ŁAZISKA,<br/>KOLONIA ŁAZISKA 30<br/>NIP: 7171839598</b></td>
            <td className="k02-title"><b>Karta K02 - Karta kontroli parametrów<br/>magazynowania surowców (CP2)</b></td>
            <td className="k02-meta"><b>Rok:</b> {group.period.slice(0,4)}<br/><br/><b>Miesiąc:</b> {group.period.slice(5,7)}</td>
          </tr>
          <tr>
            <td className="k02-note">- Temp. w chłodniach docelowo:<br/>2-3°C (±1°C). – GRUPA I i II (jabłka, gruszki,<br/>truskawki, wiśnie, porzeczki czarne i czerwone, aronie)<br/>0-1°C – GRUPA III (maliny, porzeczki czarne<br/>i czerwone)</td>
            <td className="k02-version">Wersja I/2024</td>
          </tr>
        </tbody></table>
        <table className="k02-table"><thead><tr><th>Data</th><th>Godzina</th><th>Temperatura<br/>w chłodni<br/>surowca<br/>nr 1 [°C]</th><th>Temperatura<br/>w chłodni<br/>surowca<br/>nr 2 [°C]</th><th>Podpis osoby<br/>kontrolującej</th><th>Uwagi<br/>(P/N)*</th></tr></thead><tbody>
          {Array.from({length: maxRows}).map((_,i) => {
            const baseDoc = docs[i]
            if (!baseDoc) return <tr className="blank-row" key={`k02-blank-${i}`}><td></td><td></td><td></td><td></td><td></td><td></td></tr>
            const doc = getLiveK02Doc(baseDoc)
            const godzina = k02FieldValue(doc, 'godzina', '09:15')
            const temp1 = k02FieldValue(doc, 'temperatura_chlodnia_1', '')
            const temp2 = k02FieldValue(doc, 'temperatura_chlodnia_2', '')
            const signed = k02FieldValue(doc, 'podpis_kontrolujacego', '') || doc.signed_by_operator || ''
            const uwagi = normalizePN(k02FieldValue(doc, 'uwagi', doc.status || 'P'))
            return <tr key={doc.id}>
              <td>{doc.document_date}</td>
              <td><input className="cell-input no-print" value={godzina} onChange={e=>setK02Override(doc,'godzina',e.target.value)} /><span className="print-only">{godzina}</span></td>
              <td><input className="cell-input no-print" value={temp1} onChange={e=>setK02Override(doc,'temperatura_chlodnia_1',e.target.value)} /><span className="print-only">{temp1}</span></td>
              <td><input className="cell-input no-print" value={temp2} onChange={e=>setK02Override(doc,'temperatura_chlodnia_2',e.target.value)} /><span className="print-only">{temp2}</span></td>
              <td><select className="mini-select no-print" value={signed} onChange={e=>setK02Override(doc,'podpis_kontrolujacego',e.target.value)}><option value="">Wybierz</option>{employees.map(emp=><option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}</select><span className="print-only">{signed}</span></td>
              <td className={uwagi==='N'?'pn-n':''}><select className="mini-select no-print" value={uwagi} onChange={e=>setK02Override(doc,'uwagi',e.target.value)}><option value="P">P</option><option value="N">N</option></select><span className="print-only">{uwagi}</span></td>
            </tr>
          })}
        </tbody></table>
        <p className="hint no-print">K02 uzupełnia się automatycznie: jeden pomiar dziennie o 9:15. Dla jabłka, truskawki, wiśni, porzeczek i aronii temperatura 2°C; dla malin 1°C. Pola można zmienić ręcznie przed drukiem/Excel.</p>
      </div>
    }

    if (group.type === 'K04') {
      const maxRows = Math.max(16, docs.length)
      const chamber = group.chamber || docs[0]?.chamber_code || 'CP3'
      const productLabel = docs[0]?.product_name || docs[0]?.data?.produkty || group.product || ''
      const defaultTemp = k04TempForProductName(productLabel)
      return <div className="monthly-paper k02-original k04-original">
        <div className="no-print employee-signature-row" style={{marginBottom: '10px'}}>
          <label>Podpis kontrolującego (zbiorczo)
            <select value={defaultK04Employee} onChange={e => setDefaultK04Employee(e.target.value)}>
              <option value="">Wybierz pracownika</option>
              {employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}
            </select>
          </label>
          <button className="secondary" onClick={() => setEmployeeForVisibleK04Group(group, defaultK04Employee, false)}>Zastosuj do wszystkich</button>
          <button className="secondary" onClick={() => setEmployeeForVisibleK04Group(group, defaultK04Employee, true)}>Uzupełnij puste</button>
        </div>
        <table className="k02-head"><tbody>
          <tr>
            <td className="k02-company" rowSpan="2"><b>AGRO-MAR<br/>MARIUSZ BAŃKA<br/>SP. Z O.O.<br/>24-335 ŁAZISKA,<br/>KOLONIA ŁAZISKA 30<br/>NIP: 7171839598</b></td>
            <td className="k02-title"><b>Karta K04 - Karta kontroli parametrów<br/>magazynowania produktów gotowych (CP3)</b></td>
            <td className="k02-meta"><b>Rok:</b> {group.period.slice(0,4)}<br/><br/><b>Miesiąc:</b> {group.period.slice(5,7)}<br/><b>Komora:</b> {chamber}<br/><b>Produkt:</b> {productLabel}</td>
          </tr>
          <tr>
            <td className="k02-note">- Temp. CP3: jabłko na obierkę/gruszki 2°C, truskawki -2°C, maliny/porzeczki 0°C.<br/><b>Jabłko przemysłowe nie jest magazynowane</b> – prosto do sprzedaży (K04.1).</td>
            <td className="k02-version">Wersja I/2024</td>
          </tr>
        </tbody></table>
        <table className="k02-table"><thead><tr><th>Data</th><th>Godzina</th><th>Temperatura<br/>nr 1 [°C]</th><th>Temperatura<br/>nr 2 [°C]</th><th>Podpis osoby<br/>kontrolującej</th><th>Uwagi<br/>(P/N)*</th></tr></thead><tbody>
          {Array.from({length: maxRows}).map((_,i) => {
            const baseDoc = docs[i]
            if (!baseDoc) return <tr className="blank-row" key={`k04-blank-${i}`}><td></td><td></td><td></td><td></td><td></td><td></td></tr>
            const doc = getLiveK04Doc(baseDoc, k04Overrides)
            const godzina = doc.data?.godzina || '09:15'
            const temp1 = doc.data?.temperatura_chlodnia_1 ?? String(defaultTemp)
            const temp2 = doc.data?.temperatura_chlodnia_2 ?? String(defaultTemp)
            const signed = doc.data?.podpis_kontrolujacego || doc.signed_by_operator || ''
            const uwagi = formNormalizePn(doc.data?.uwagi || 'P')
            return <tr key={doc.id}>
              <td>{doc.document_date}</td>
              <td><input className="cell-input no-print" value={godzina} onChange={e=>setK04Override(doc,'godzina',e.target.value)} /><span className="print-only">{godzina}</span></td>
              <td><input className="cell-input no-print" value={temp1} onChange={e=>setK04Override(doc,'temperatura_chlodnia_1',e.target.value)} /><span className="print-only">{temp1}</span></td>
              <td><input className="cell-input no-print" value={temp2} onChange={e=>setK04Override(doc,'temperatura_chlodnia_2',e.target.value)} /><span className="print-only">{temp2}</span></td>
              <td><select className="mini-select no-print" value={signed} onChange={e=>setK04Override(doc,'podpis_kontrolujacego',e.target.value)}><option value="">Wybierz</option>{employees.map(emp=><option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}</select><span className="print-only">{signed}</span></td>
              <td className={uwagi==='N'?'pn-n':''}><select className="mini-select no-print" value={uwagi} onChange={e=>setK04Override(doc,'uwagi',e.target.value)}><option value="P">P</option><option value="N">N</option></select><span className="print-only">{uwagi}</span></td>
            </tr>
          })}
        </tbody></table>
        {docs.some(d => d.data?.chamber_mix_warning) && <div className="haccp-warning no-print">Uwaga: wykryto różne asortymenty w tej komorze tego dnia – sprawdź przypisanie partii w Magazynie.</div>}
        <p className="hint no-print">K04: tylko partie w komorze CP3. <b>Jabłko przemysłowe</b> nie idzie do CP3 – użyj <b>K04.1</b>. <b>Jabłko na obierkę</b> jest magazynowane.</p>
      </div>
    }

    if (group.type === 'K07') {
      const maxRows = Math.max(16, docs.length)
      return <div className="monthly-paper k02-original k07-original">
        <div className="no-print employee-signature-row" style={{marginBottom: '10px'}}>
          <label>Podpis kontrolującego (zbiorczo)
            <select value={defaultK07Employee} onChange={e => setDefaultK07Employee(e.target.value)}>
              <option value="">Wybierz pracownika</option>
              {employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}
            </select>
          </label>
          <button className="secondary" onClick={() => setEmployeeForVisibleK07Group(group, defaultK07Employee, false)}>Zastosuj do wszystkich</button>
          <button className="secondary" onClick={() => setEmployeeForVisibleK07Group(group, defaultK07Employee, true)}>Uzupełnij puste</button>
        </div>
        <table className="k02-head"><tbody>
          <tr>
            <td className="k02-company" rowSpan="2"><b>AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.<br/>24-335 ŁAZISKA,<br/>KOLONIA ŁAZISKA 30<br/>NIP: 7171839598</b></td>
            <td className="k02-title"><b>Karta K07 - Karta kontroli stanu sita<br/>na linii do przerobu na pulę (CCP1)</b></td>
            <td className="k02-meta"><b>Rok:</b> {group.period.slice(0,4)}<br/><br/><b>Miesiąc:</b> {group.period.slice(5,7)}</td>
          </tr>
          <tr><td className="k02-note">Wpis przy rozpoczęciu/zakończeniu przerobu. Domyślnie P.</td><td className="k02-version">Wersja I/2024</td></tr>
        </tbody></table>
        <table className="k02-table"><thead><tr><th>Data</th><th>Godzina</th><th>Stan sita<br/>(P/N)*</th><th>Sito całe<br/>(P/N)*</th><th>Partia / produkt</th><th>Podpis</th><th>Uwagi<br/>(P/N)*</th></tr></thead><tbody>
          {Array.from({length: maxRows}).map((_,i) => {
            const baseDoc = docs[i]
            if (!baseDoc) return <tr className="blank-row" key={`k07-blank-${i}`}><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
            const doc = getLiveK07Doc(baseDoc, k07Overrides)
            const godzina = doc.data?.godzina || '09:15'
            const stan = formNormalizePn(doc.data?.stan_sita || 'P')
            const cale = formNormalizePn(doc.data?.sito_cale || 'P')
            const partia = doc.data?.partia || doc.lot_no || ''
            const signed = doc.data?.podpis_kontrolujacego || doc.signed_by_operator || ''
            const uwagi = formNormalizePn(doc.data?.uwagi || 'P')
            return <tr key={doc.id}>
              <td>{doc.document_date}</td>
              <td><input className="cell-input no-print" value={godzina} onChange={e=>setK07Override(doc,'godzina',e.target.value)} /><span className="print-only">{godzina}</span></td>
              <td className={stan==='N'?'pn-n':''}><select className="mini-select no-print" value={stan} onChange={e=>setK07Override(doc,'stan_sita',e.target.value)}><option value="P">P</option><option value="N">N</option></select><span className="print-only">{stan}</span></td>
              <td className={cale==='N'?'pn-n':''}><select className="mini-select no-print" value={cale} onChange={e=>setK07Override(doc,'sito_cale',e.target.value)}><option value="P">P</option><option value="N">N</option></select><span className="print-only">{cale}</span></td>
              <td><input className="cell-input no-print" value={partia} onChange={e=>setK07Override(doc,'partia',e.target.value)} /><span className="print-only">{partia}</span></td>
              <td><select className="mini-select no-print" value={signed} onChange={e=>setK07Override(doc,'podpis_kontrolujacego',e.target.value)}><option value="">Wybierz</option>{employees.map(emp=><option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}</select><span className="print-only">{signed}</span></td>
              <td className={uwagi==='N'?'pn-n':''}><select className="mini-select no-print" value={uwagi} onChange={e=>setK07Override(doc,'uwagi',e.target.value)}><option value="P">P</option><option value="N">N</option></select><span className="print-only">{uwagi}</span></td>
            </tr>
          })}
        </tbody></table>
        <p className="hint no-print">K07: wpis przy każdym przerobie (produkcja). Domyślnie P – możesz zmienić każde pole przed drukiem/Excel.</p>
      </div>
    }

    if (MANUAL_HACCP_FORMS[group.type]) {
      const cfg = MANUAL_HACCP_FORMS[group.type]
      const pnFields = new Set(['stan_opakowania', 'wyglad_zapach', 'smak', 'barwa'])
      const isK06 = group.type === 'K06'
      return <div className="monthly-paper k011-original">
        {isK06 && <div className="no-print employee-signature-row" style={{marginBottom: '10px'}}>
          <label>Podpis oceniającego (zbiorczo)
            <select value={defaultK06Employee} onChange={e => setDefaultK06Employee(e.target.value)}>
              <option value="">Wybierz pracownika</option>
              {employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}
            </select>
          </label>
          <button className="secondary" onClick={() => setEmployeeForVisibleK06Group(group, defaultK06Employee, false)}>Zastosuj do wszystkich</button>
          <button className="secondary" onClick={() => setEmployeeForVisibleK06Group(group, defaultK06Employee, true)}>Uzupełnij puste</button>
        </div>}
        <table className="k011-head"><tbody><tr><td className="k011-company"><b>AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.<br/>24-335 ŁAZISKA, KOLONIA ŁAZISKA 30<br/>NIP: 7171839598</b></td><td className="k011-title"><b>{cfg.title}</b></td><td className="k011-meta"><b>Rok:</b> {group.period.slice(0,4)}<br/><b>Miesiąc:</b> {group.period.slice(5,7)}</td></tr></tbody></table>
        <table className="k011-table"><thead><tr>{cfg.columns.map(c => <th key={c.key}>{c.label}</th>)}</tr></thead><tbody>
          {docs.map((doc, i) => <tr key={doc.id}>
            {cfg.columns.map(c => {
              if (c.key === 'lp') return <td key={c.key}>{i + 1}</td>
              const dataKey = c.key === 'podpis' ? null : (c.key === 'temperatura_transport' ? 'temperatura_transport' : c.key === 'powod' ? 'powod_wycofania' : c.key === 'dzialanie' ? 'dzialanie' : c.key === 'wyglad' ? 'wyglad_zapach' : c.key)
              if (dataKey && pnFields.has(dataKey)) {
                const val = formNormalizePn(doc.data?.[dataKey] || 'P')
                return <td key={c.key} className={val === 'N' ? 'pn-n' : ''}>
                  <select className="mini-select no-print" value={val} onChange={e => editHaccpRowField(doc, dataKey, c.label, e.target.value, { directValue: e.target.value, pn: true })}><option value="P">P</option><option value="N">N</option></select>
                  <span className="print-only">{val}</span>
                </td>
              }
              if (c.key === 'podpis') {
                return <td key={c.key}>
                  <select className="mini-select no-print" value={doc.signed_by_operator || ''} onChange={e => setDocumentEmployeeFromGroup(doc, e.target.value)}><option value="">Wybierz</option>{employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}</select>
                  <span className="print-only">{doc.signed_by_operator || ''}</span>
                </td>
              }
              return <td key={c.key} className={c.key === 'product_name' || c.key === 'powod' ? 'left' : ''}>{c.value(doc, i)}</td>
            })}
          </tr>)}
        </tbody></table>
      </div>
    }

    if (group.type === 'K03') {
      const doc = docs[0]
      if (!doc) return <div className="monthly-paper">Brak danych K03.</div>
      const paper = buildK03PaperData(doc)
      const rawRows = doc.data?.rawRows || []
      return <div className="monthly-paper k03-original">
        <div className="no-print employee-signature-row" style={{marginBottom: '10px'}}>
          <label>Podpis uzupełniającego wpisy
            <select value={doc.signed_by_operator || ''} onChange={e => setK03GroupEmployee(doc, e.target.value)}>
              <option value="">Wybierz pracownika</option>
              {employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}
            </select>
          </label>
          <span className="hint">{doc.frozen ? 'Zamrożony – FIFO nie zmieni przypisanych PZ.' : `Jeden formularz K03 = jedna sprzedaż (WZ). Suma PZ = ${paper.rawTotal.toLocaleString('pl-PL')} kg, WZ = ${paper.saleTotal.toLocaleString('pl-PL')} kg.`}</span>
        </div>
        <table className="k03-head"><tbody><tr><td className="company"><b>AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.<br/>24-335 ŁAZISKA,<br/>KOLONIA ŁAZISKA 30<br/>NIP: 7171839598</b><br/>Wersja I/2024</td><td className="title"><b>Karta K03 - Karta identyfikacji partii produktu</b></td><td className="meta"><b>Rok:</b> {paper.year}<br/><b>Miesiąc:</b> {paper.month}<br/><b>Strona:</b></td></tr></tbody></table>
        <table className="k03-fields"><tbody><tr><td><b>Nazwa produktu:</b> {paper.productName}</td><td><b>Data sprzedaży (WZ):</b> {paper.wzDate}</td></tr><tr><td><b>Numer WZ:</b> {paper.wzNo}</td><td><b>Ilość WZ (kg):</b> {paper.saleTotal.toLocaleString('pl-PL')}</td></tr><tr><td><b>Nadany numer partii wyrobu gotowego:</b> {paper.lotNo || '-'}</td><td><b>Odbiorca:</b> {paper.receiver || '-'}</td></tr></tbody></table>
        <table className="k03-table"><colgroup><col className="col-lp"/><col className="col-pz"/><col className="col-date"/><col className="col-dost"/><col className="col-qty"/><col className="col-lp"/><col className="col-wz"/><col className="col-date"/><col className="col-odb"/><col className="col-qty"/><col className="col-sign"/></colgroup><thead><tr><th colSpan="5">Dane dotyczące dostaw surowców składających się na partię (PZ)</th><th className="right-start" colSpan="6">Dane dotyczące sprzedaży (WZ)</th></tr><tr><th>Lp.</th><th>Nr faktury / PZ</th><th>Data zakupu</th><th>Dostawca</th><th>Ilość surowca (kg)</th><th className="right-start">Lp.</th><th>Nr faktury / WZ</th><th>Data</th><th>Odbiorca</th><th>Ilość w kg</th><th>Podpis uzupełniającego wpisy</th></tr></thead><tbody>
          {paper.rows.map((r, i) => {
            const shortageRow = rawRows[i]?.isShortage
            return <tr key={`k03-${i}`} className={shortageRow ? 'k03-shortage-row' : ''}>
              <td>{r.lp}</td><td className="cell-wrap">{r.pzNo}</td><td>{r.pzDate}</td><td className="cell-wrap">{r.dostawca}</td><td>{r.qty !== '' ? Number(r.qty).toLocaleString('pl-PL') : ''}</td>
              {r.lp === 1
                ? <><td className="right-start">1</td><td className="cell-wrap">{r.wzNo}</td><td>{r.wzDate}</td><td className="cell-wrap">{r.wzReceiver}</td><td>{Number(r.wzQty).toLocaleString('pl-PL')}</td><td className="cell-wrap">{r.signed}</td></>
                : <><td className="right-start">{r.wzLp}</td><td></td><td></td><td></td><td></td><td></td></>}
            </tr>
          })}
          <tr><td colSpan="4" className="sum-cell">Suma surowca (PZ):</td><td><b>{paper.rawTotal.toLocaleString('pl-PL')}</b></td><td className="right-start" colSpan="4">Suma sprzedana (WZ):</td><td><b>{paper.saleTotal.toLocaleString('pl-PL')}</b></td><td></td></tr>
        </tbody></table>
        {paper.shortage > 0 && <div className="haccp-warning no-print">Brak {paper.shortage.toLocaleString('pl-PL')} kg surowca dostępnego na dzień WZ ({paper.wzDate}). System nie dobiera PZ z datą późniejszą niż WZ.</div>}
        {doc.data?.invalidFuturePz && <div className="haccp-warning no-print">Wykryto PZ z datą późniejszą niż WZ – popraw datę w zakładce PZ / FIFO.</div>}
      </div>
    }

    return <div className="monthly-paper"><div className="paper-head"><div><b>AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.</b><br/>24-335 ŁAZISKA, KOLONIA ŁAZISKA 30<br/>NIP: 7171839598</div><div><b>{group.type} – kartoteka miesięczna</b><br/>Okres: {periodLabel(group)}<br/>Komora: {group.chamber || '-'}</div></div><table className="paper-table"><thead><tr><th>Lp.</th><th>Data</th><th>Godzina</th><th>Komora</th><th>Produkt</th><th>Partia</th><th>Ilość</th><th>Temperatura</th><th>P/N</th><th>Uwagi</th><th>Podpis</th></tr></thead><tbody>{docs.map((doc,i)=><tr key={doc.id}><td>{i+1}</td><td>{doc.document_date}</td><td>{doc.data?.godzina || ''}</td><td>{doc.chamber_code}</td><td>{doc.product_name}</td><td>{doc.lot_no}</td><td>{Number(doc.qty||0).toLocaleString('pl-PL')}</td><td>{doc.data?.temperatura || ''} <button className="mini edit no-print" onClick={()=>editHaccpRowField(doc,'temperatura','Temperatura',doc.data?.temperatura||'')}>Edytuj</button></td><td className={normalizePN(doc.data?.parametry_magazynowania)==='N'?'pn-n':''}>{normalizePN(doc.data?.parametry_magazynowania || 'P')} <button className="mini edit no-print" onClick={()=>editHaccpRowField(doc,'parametry_magazynowania','Ocena parametrów magazynowania', normalizePN(doc.data?.parametry_magazynowania || 'P'), {pn:true})}>Edytuj</button></td><td>{doc.data?.uwagi || ''}</td><td><select className="mini-select no-print" value={doc.signed_by_operator || doc.data?.podpis_przyjmujacego || ''} onChange={e=>setDocumentEmployeeFromGroup(doc,e.target.value)}><option value="">Wybierz</option>{employees.map(emp=><option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}</select><span className="print-only">{doc.signed_by_operator || doc.data?.podpis_przyjmujacego || ''}</span></td></tr>)}</tbody></table></div>
  }



  function auxHalfFromDate(dateValue) {
    const d = String(dateValue || '').slice(0, 10)
    const year = d.slice(0, 4) || auxYear
    const month = Number(d.slice(5, 7) || 1)
    return { year, half: month <= 6 ? '1' : '2', label: `${year} / ${month <= 6 ? 'I półrocze' : 'II półrocze'}` }
  }

  const auxVisibleRows = useMemo(() => {
    return auxRows.filter(r => {
      const h = auxHalfFromDate(r.delivery_date)
      return h.year === auxYear && h.half === auxHalf
    }).sort((a,b) => String(a.delivery_date || '').localeCompare(String(b.delivery_date || '')) || String(a.created_at || '').localeCompare(String(b.created_at || '')))
  }, [auxRows, auxYear, auxHalf])

  async function loadAuxMaterials() {
    if (!supabase) return
    try {
      const { data, error } = await supabase
        .from('haccp_aux_materials')
        .select('*')
        .order('delivery_date', { ascending: true })
        .limit(2000)
      if (error) throw error
      setAuxRows(data || [])
    } catch (err) {
      setAuxRows([])
    }
  }

  function getDefaultManualHaccpForm(type) {
    const cfg = MANUAL_HACCP_FORMS[type]
    if (!cfg) return { type }
    const form = { id: null, type }
    for (const f of cfg.fields) {
      if (f.key === 'signed_by') form.signed_by = ''
      else if (f.type === 'pn') form[f.key] = 'P'
      else if (f.type === 'date') form[f.key] = new Date().toISOString().slice(0, 10)
      else form[f.key] = ''
    }
    return form
  }

  function resetManualHaccpForm(type) {
    setManualHaccpForm(getDefaultManualHaccpForm(type || docsFilter))
  }

  async function saveManualHaccpEntry() {
    const type = manualHaccpForm.type || docsFilter
    const cfg = MANUAL_HACCP_FORMS[type]
    if (!cfg || !supabase) return
    for (const f of cfg.fields) {
      if (!f.required || f.key === 'signed_by') continue
      if (!String(manualHaccpForm[f.key] ?? '').trim()) {
        setMessage(`${type}: uzupełnij pole „${f.label}".`)
        return
      }
    }
    const data = {}
    let status = 'P'
    for (const f of cfg.fields) {
      if (f.key === 'signed_by') continue
      if (!f.data) continue
      const val = f.type === 'pn' ? formNormalizePn(manualHaccpForm[f.key]) : String(manualHaccpForm[f.key] ?? '').trim()
      data[f.key] = val
      if (f.type === 'pn' && val === 'N') status = 'N'
    }
    const payload = {
      document_type: type,
      document_date: manualHaccpForm.document_date,
      product_name: manualHaccpForm.product_name || null,
      lot_no: manualHaccpForm.lot_no || null,
      qty: manualHaccpForm.qty !== '' && manualHaccpForm.qty != null ? Number(manualHaccpForm.qty) : 0,
      document_no: `${type}/${manualHaccpForm.document_date || 'brak'}/${manualHaccpForm.lot_no || 'brak'}`,
      chamber_code: type === 'K04.1' ? 'TRANSPORT' : null,
      status,
      data,
      signed_by_operator: manualHaccpForm.signed_by || null,
      document_version: 'I/2024',
      updated_at: new Date().toISOString()
    }
    try {
      if (manualHaccpForm.id) {
        const { error } = await supabase.from('haccp_documents').update(payload).eq('id', manualHaccpForm.id)
        if (error) throw error
        setMessage(`${type}: zapisano zmiany wpisu.`)
      } else {
        const { error } = await supabase.from('haccp_documents').insert(payload)
        if (error) throw error
        setMessage(`${type}: dodano wpis do kartoteki miesięcznej.`)
      }
      resetManualHaccpForm(type)
      await loadHaccpDocs()
    } catch (err) {
      setMessage(`Błąd zapisu ${type}: ${err.message}`)
    }
  }

  function editManualHaccpEntry(doc) {
    const cfg = MANUAL_HACCP_FORMS[doc.document_type]
    if (!cfg) return
    const form = { id: doc.id, type: doc.document_type }
    for (const f of cfg.fields) {
      if (f.key === 'signed_by') form.signed_by = doc.signed_by_operator || ''
      else if (f.data) form[f.key] = f.type === 'pn' ? formNormalizePn(doc.data?.[f.key]) : (doc.data?.[f.key] ?? '')
      else form[f.key] = doc[f.key] ?? (f.type === 'date' ? '' : '')
    }
    setManualHaccpForm(form)
  }

  async function deleteManualHaccpEntry(doc) {
    if (!supabase || !doc?.id) return
    if (!window.confirm(`Usunąć wpis ${doc.document_type}: ${doc.product_name || doc.lot_no || ''}?`)) return
    try {
      const { error } = await supabase.from('haccp_documents').delete().eq('id', doc.id)
      if (error) throw error
      if (manualHaccpForm.id === doc.id) resetManualHaccpForm(doc.document_type)
      await loadHaccpDocs()
      setMessage(`${doc.document_type}: usunięto wpis.`)
    } catch (err) {
      setMessage(`Błąd usuwania: ${err.message}`)
    }
  }

  function renderManualFormField(f) {
    const value = manualHaccpForm[f.key] ?? (f.type === 'pn' ? 'P' : f.type === 'date' ? new Date().toISOString().slice(0, 10) : '')
    if (f.type === 'employee') {
      return <label key={f.key}>{f.label}
        <select value={manualHaccpForm.signed_by || ''} onChange={e => setManualHaccpForm(prev => ({ ...prev, signed_by: e.target.value }))}>
          <option value="">Wybierz pracownika</option>
          {employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}
        </select>
      </label>
    }
    if (f.type === 'pn') {
      return <label key={f.key}>{f.label}
        <select value={value} onChange={e => setManualHaccpForm(prev => ({ ...prev, [f.key]: e.target.value }))}>
          <option value="P">P</option><option value="N">N</option>
        </select>
      </label>
    }
    if (f.type === 'date') {
      return <label key={f.key}>{f.label}<input type="date" value={value} onChange={e => setManualHaccpForm(prev => ({ ...prev, [f.key]: e.target.value }))} /></label>
    }
    if (f.type === 'number') {
      return <label key={f.key}>{f.label}<input type="number" step="0.01" value={value} onChange={e => setManualHaccpForm(prev => ({ ...prev, [f.key]: e.target.value }))} /></label>
    }
    return <label key={f.key}>{f.label}<input value={value} onChange={e => setManualHaccpForm(prev => ({ ...prev, [f.key]: e.target.value }))} /></label>
  }

  function printManualHaccpPeriod(type, docs) {
    const cfg = MANUAL_HACCP_FORMS[type]
    if (!cfg || !docs.length) { setMessage('Brak wpisów do wydruku.'); return }
    const period = String(docs[0]?.document_date || haccpMonth).slice(0, 7)
    printHtmlInIframe(buildManualMonthlyHtml({ type, period, docs }, escapeHtml, cfg))
  }

  function exportManualHaccpPeriodExcel(type, docs) {
    const cfg = MANUAL_HACCP_FORMS[type]
    if (!cfg || !docs.length) { setMessage('Brak wpisów do Excel.'); return }
    const period = String(docs[0]?.document_date || haccpMonth).slice(0, 7)
    const rows = buildManualExcelRows({ type, period, docs }, cfg)
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = rows[rows.length - 1]?.map(() => ({ wch: 18 })) || []
    XLSX.utils.book_append_sheet(wb, ws, type)
    XLSX.writeFile(wb, `${type}_${period}.xlsx`)
  }

  function renderManualPaperPreview(type, periodDocs) {
    const cfg = MANUAL_HACCP_FORMS[type]
    if (!cfg) return null
    const period = String(periodDocs[0]?.document_date || haccpMonth).slice(0, 7)
    const year = period.slice(0, 4)
    const month = period.slice(5, 7)
    const pnFields = new Set(['stan_opakowania', 'wyglad_zapach', 'smak', 'barwa'])
    const pnKeyMap = { wyglad: 'wyglad_zapach', powod: 'powod_wycofania', dzialanie: 'dzialanie' }
    const maxRows = Math.max(type === 'K06' ? periodDocs.length : 12, periodDocs.length)
    const blanks = Math.max(0, maxRows - periodDocs.length)
    return <>
      <div className="actions no-print">
        <button className="secondary" onClick={() => printManualHaccpPeriod(type, periodDocs)}><Printer size={16}/> Druk/PDF – {type}</button>
        <button className="secondary" onClick={() => exportManualHaccpPeriodExcel(type, periodDocs)}>Pobierz Excel</button>
      </div>
      <h3>Podgląd kartoteki {type} – {year}-{month} ({periodDocs.length} wpisów)</h3>
      <div className="k011-original haccp-paper">
        <table className="k011-head"><tbody><tr>
          <td className="k011-company"><b>AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.<br/>24-335 ŁAZISKA, KOLONIA ŁAZISKA 30<br/>NIP: 7171839598<br/>Wersja I/2024</b></td>
          <td className="k011-title"><b>{cfg.title}</b></td>
          <td className="k011-meta"><b>Rok:</b> {year}<br/><b>Miesiąc:</b> {month}</td>
        </tr></tbody></table>
        <table className="k011-table"><thead><tr>
          {cfg.columns.map(c => <th key={c.key}>{c.label}</th>)}
          <th className="no-print actions-col">Akcje</th>
        </tr></thead><tbody>
          {periodDocs.map((doc, i) => <tr key={doc.id || `row-${i}`}>
            {cfg.columns.map(c => {
              if (c.key === 'lp') return <td key={c.key}>{i + 1}</td>
              const dataKey = pnKeyMap[c.key] || (c.key === 'temperatura_transport' ? 'temperatura_transport' : c.key === 'podpis' ? null : c.key)
              if (dataKey && pnFields.has(dataKey)) {
                const val = formNormalizePn(doc.data?.[dataKey] || 'P')
                return <td key={c.key} className={val === 'N' ? 'pn-n' : ''}>
                  <select className="mini-select no-print" value={val} onChange={e => editHaccpRowField(doc, dataKey, c.label, e.target.value, { directValue: e.target.value, pn: true })}><option value="P">P</option><option value="N">N</option></select>
                  <span className="print-only">{val}</span>
                </td>
              }
              if (c.key === 'podpis') {
                return <td key={c.key}>
                  <select className="mini-select no-print" value={doc.signed_by_operator || ''} onChange={e => setDocumentEmployeeFromGroup(doc, e.target.value)}><option value="">Wybierz</option>{employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}</select>
                  <span className="print-only">{doc.signed_by_operator || ''}</span>
                </td>
              }
              return <td key={c.key} className={c.key === 'product_name' || c.key === 'powod' ? 'left' : ''}>{c.value(doc, i)}</td>
            })}
            <td className="no-print row-actions">
              {!doc.synthetic && <button className="mini secondary" onClick={() => editManualHaccpEntry(doc)}>Edytuj</button>}
              {!doc.lot_id && !doc.synthetic && <button className="mini danger" onClick={() => deleteManualHaccpEntry(doc)}>Usuń</button>}
              {doc.synthetic && <span className="hint">auto</span>}
            </td>
          </tr>)}
          {Array.from({ length: blanks }).map((_, i) => <tr key={`blank-${i}`} className="blank-row">
            {cfg.columns.map(c => <td key={c.key}></td>)}
            <td className="no-print"></td>
          </tr>)}
        </tbody></table>
      </div>
    </>
  }

  function renderManualHaccpEntrySection() {
    const type = docsFilter
    const cfg = MANUAL_HACCP_FORMS[type]
    if (!cfg) return null
    const periodDocs = haccpPeriodDocs.filter(d => d.document_type === type)
    const autoCount = periodDocs.filter(d => d.synthetic || d.data?.auto_source).length
    return <>
      <div className="card inner-card no-print">
        <h3>{manualHaccpForm.id ? `Edytuj wpis ${type}` : `Dodaj wpis – ${cfg.title}`}</h3>
        {type === 'K06' && <p className="hint">K06 uzupełnia się automatycznie z magazynu CP3 i produkcji (P domyślnie). {autoCount > 0 ? `W tym okresie: ${autoCount} wpisów auto.` : 'Kliknij „Odśwież magazyn partii”, potem „Odśwież kartoteki”.'} Jabłko przemysłowe nie trafia do K06 – jedzie prosto do sprzedaży.</p>}
        {type === 'K05' && <p className="hint">Rejestr wycofań – wpis ręczny na każde wycofanie partii. Poniżej podgląd kartoteki jak na papierze.</p>}
        {type === 'K04.1' && <p className="hint"><b>Transport / sprzedaż bez magazynowania CP3</b> – m.in. jabłko przemysłowe prosto na samochód. Uzupełnij temperaturę, opakowanie P/N i podpis.</p>}
        <div className="form-grid compact">{cfg.fields.map(renderManualFormField)}</div>
        <div className="actions">
          <button onClick={saveManualHaccpEntry}>{manualHaccpForm.id ? 'Zapisz zmiany' : 'Dodaj do kartoteki'}</button>
          <button className="secondary" onClick={() => resetManualHaccpForm(type)}>Wyczyść</button>
        </div>
      </div>
      {periodDocs.length === 0 && <p className="hint">Brak wpisów w wybranym okresie. {type === 'K06' ? 'Przypisz partie gotowca do CP3 lub wykonaj produkcję, potem odśwież magazyn.' : 'Dodaj pierwszy wpis powyżej.'}</p>}
      {periodDocs.length > 0 && renderManualPaperPreview(type, periodDocs)}
    </>
  }

  function resetAuxForm() {
    setAuxForm({ delivery_date: new Date().toISOString().slice(0,10), item_name: '', supplier_invoice: '', vehicle_hygiene: 'P', qty: '', lot_no: '', notes: '', signed_by: '' })
    setAuxPdfName('')
  }

  async function saveAuxMaterial() {
    if (!supabase) return
    if (!auxForm.delivery_date || !auxForm.item_name || !auxForm.supplier_invoice) {
      setMessage('K01.1: uzupełnij datę, nazwę towaru i dostawcę/nr faktury.')
      return
    }
    const payload = {
      delivery_date: auxForm.delivery_date,
      item_name: auxForm.item_name,
      supplier_invoice: auxForm.supplier_invoice,
      vehicle_hygiene: auxForm.vehicle_hygiene || 'P',
      qty: auxForm.qty || null,
      lot_no: auxForm.lot_no || null,
      notes: auxForm.notes || null,
      signed_by: auxForm.signed_by || null,
      source_filename: auxPdfName || null
    }
    try {
      if (auxForm.id) {
        const { error } = await supabase.from('haccp_aux_materials').update(payload).eq('id', auxForm.id)
        if (error) throw error
        setMessage('K01.1: zapisano zmiany pozycji.')
      } else {
        const { error } = await supabase.from('haccp_aux_materials').insert(payload)
        if (error) throw error
        setMessage('K01.1: dodano pozycję do kartoteki półrocznej.')
      }
      resetAuxForm()
      await loadAuxMaterials()
    } catch (err) {
      setMessage(`Błąd zapisu K01.1: ${err.message}`)
    }
  }

  function editAuxMaterial(row) {
    setAuxForm({
      id: row.id,
      delivery_date: row.delivery_date || '',
      item_name: row.item_name || '',
      supplier_invoice: row.supplier_invoice || '',
      vehicle_hygiene: normalizePN(row.vehicle_hygiene || 'P'),
      qty: row.qty || '',
      lot_no: row.lot_no || '',
      notes: row.notes || '',
      signed_by: row.signed_by || ''
    })
    setAuxPdfName(row.source_filename || '')
  }

  async function deleteAuxMaterial(row) {
    if (!supabase || !row) return
    if (!window.confirm(`Usunąć pozycję K01.1: ${row.item_name || ''}?`)) return
    if (!window.confirm('Potwierdź drugi raz usunięcie pozycji z kartoteki K01.1.')) return
    try {
      const { error } = await supabase.from('haccp_aux_materials').delete().eq('id', row.id)
      if (error) throw error
      await loadAuxMaterials()
      setMessage('K01.1: usunięto pozycję.')
    } catch (err) {
      setMessage(`Błąd usuwania K01.1: ${err.message}`)
    }
  }

  function polishDateToIso(value) {
    const text = String(value || '').trim()
    const m = text.match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/)
    if (!m) return ''
    return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`
  }

  function firstUsefulLineAfter(text, labels) {
    const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    for (let i = 0; i < lines.length; i++) {
      const n = normalizeText(lines[i])
      if (labels.some(label => n.includes(normalizeText(label)))) {
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const candidate = lines[j]
          const cn = normalizeText(candidate)
          if (!candidate || cn.includes('nip') || cn.includes('regon') || cn.includes('konto') || cn.includes('bank')) continue
          if (/^[0-9\s,./-]+$/.test(candidate)) continue
          return candidate.replace(/^(nazwa|firma|sprzedawca|dostawca)\s*[:\-]?\s*/i, '').trim()
        }
      }
    }
    return ''
  }

  function parseInvoiceTextForK011(text) {
    const clean = String(text || '').replace(/\u0000/g, ' ').replace(/[ \t]+/g, ' ')
    const lines = clean.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    const invoiceMatch = clean.match(/(?:faktura(?:\s+vat)?|nr\s*faktury|numer\s*faktury|fv)\s*(?:nr|numer)?\s*[:#-]?\s*([A-ZĄĆĘŁŃÓŚŹŻ0-9][A-ZĄĆĘŁŃÓŚŹŻ0-9/_.\-]{2,})/i)
    const invoiceNo = invoiceMatch?.[1]?.replace(/[;,]$/, '') || ''

    const dateLabelMatch = clean.match(/(?:data\s+wystawienia|data\s+dostawy|data\s+sprzedaży|data\s+sprzedazy)\s*[:\-]?\s*(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{4})/i)
    const anyDateMatch = clean.match(/(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{4})/)
    const deliveryDate = polishDateToIso(dateLabelMatch?.[1] || anyDateMatch?.[1] || '')

    const supplier = firstUsefulLineAfter(clean, ['Sprzedawca', 'Dostawca', 'Wystawca'])

    let itemName = ''
    let qty = ''
    const materialKeywords = /(karton|worek|worki|skrzyn|beczk|etykiet|foli|opakowan|palet|taśm|tasma|wiadr|pojemnik|nakrętk|nakretk)/i
    const qtyRegex = /(\d+(?:[\s ]?\d{3})*(?:[,.]\d+)?)\s*(szt\.?|kg|opak\.?|rol\.?|mb|m2|m²|kpl\.?|pcs)/i
    const candidates = lines.filter(l => materialKeywords.test(l) || qtyRegex.test(l))
    for (const line of candidates) {
      const q = line.match(qtyRegex)
      if (q && !qty) qty = `${q[1].replace(/\s/g, '')} ${q[2].replace('.', '')}`
      if (materialKeywords.test(line) && !itemName) {
        itemName = line
          .replace(/\s+\d+(?:[\s ]?\d{3})*(?:[,.]\d+)?\s*(szt\.?|kg|opak\.?|rol\.?|mb|m2|m²|kpl\.?|pcs).*/i, '')
          .replace(/^\d+\.?\s*/, '')
          .trim()
      }
      if (itemName && qty) break
    }
    if (!itemName && candidates[0]) itemName = candidates[0].slice(0, 80)

    const supplierInvoice = [supplier, invoiceNo].filter(Boolean).join(' / ')
    return { deliveryDate, invoiceNo, supplier, itemName, qty, supplierInvoice }
  }

  async function extractPdfText(file) {
    try {
      const pdfjsLib = await import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.mjs')
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.mjs'
      const data = await file.arrayBuffer()
      const pdf = await pdfjsLib.getDocument({ data }).promise
      const parts = []
      for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
        const page = await pdf.getPage(pageNo)
        const content = await page.getTextContent()
        parts.push(content.items.map(item => item.str).join('\n'))
      }
      return parts.join('\n')
    } catch (err) {
      const buffer = await file.arrayBuffer()
      const raw = new TextDecoder('latin1').decode(buffer)
      return raw
        .replace(/\(([^()]{1,120})\)\s*Tj/g, '\n$1\n')
        .replace(/<([0-9A-Fa-f]{4,})>\s*Tj/g, '\n')
        .replace(/[^\x09\x0A\x0D\x20-\x7EĄĆĘŁŃÓŚŹŻąćęłńóśźż]+/g, ' ')
    }
  }

  async function handleAuxPdfFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setAuxPdfName(file.name)
    setMessage('K01.1: odczytuję fakturę PDF...')
    try {
      const text = await extractPdfText(file)
      const parsed = parseInvoiceTextForK011(text)
      const updates = {}
      if (parsed.deliveryDate) updates.delivery_date = parsed.deliveryDate
      if (parsed.itemName) updates.item_name = parsed.itemName
      if (parsed.supplierInvoice) updates.supplier_invoice = parsed.supplierInvoice
      else if (parsed.invoiceNo) updates.supplier_invoice = parsed.invoiceNo
      if (parsed.qty) updates.qty = parsed.qty
      setAuxForm(prev => ({ ...prev, ...updates, notes: prev.notes || `PDF: ${file.name}` }))
      const filled = Object.keys(updates).length
      if (filled) {
        setMessage(`K01.1: odczytano PDF i uzupełniono ${filled} pola. Sprawdź dane przed zapisem.`)
      } else {
        setMessage('K01.1: nie udało się automatycznie rozpoznać danych z PDF. Uzupełnij pola ręcznie i zapisz pozycję.')
      }
    } catch (err) {
      setMessage(`K01.1: błąd odczytu PDF: ${err.message}. Uzupełnij dane ręcznie.`)
    }
  }

  function buildK011Rows(rows, editable = false) {
    const visible = rows.slice(0, 12)
    const blanksCount = Math.max(0, 12 - visible.length)
    const rowHtml = visible.map((r, i) => `<tr>
      <td class="lp">${i + 1}</td>
      <td>${escapeHtml(r.delivery_date || '')}</td>
      <td class="left">${escapeHtml(r.item_name || '')}</td>
      <td class="left">${escapeHtml(r.supplier_invoice || '')}</td>
      <td>${escapeHtml(normalizePN(r.vehicle_hygiene || 'P'))}</td>
      <td>${escapeHtml(r.qty || '')}</td>
      <td>${escapeHtml(r.lot_no || '')}</td>
      <td class="left">${escapeHtml(r.notes || '')}</td>
      <td>${escapeHtml(r.signed_by || '')}</td>
    </tr>`).join('')
    const blankHtml = Array.from({ length: blanksCount }, (_, i) => `<tr class="blank-row">
      <td class="lp">${visible.length + i + 1}</td><td></td><td></td><td></td><td>P</td><td></td><td></td><td></td><td></td>
    </tr>`).join('')
    return rowHtml + blankHtml
  }

  function buildK011Html(rows) {
    const period = auxHalf === '1' ? 'I półrocze' : 'II półrocze'
    const trs = buildK011Rows(rows)
    return `<!doctype html><html><head><meta charset="utf-8"><title>K01.1 ${escapeHtml(auxYear)} ${escapeHtml(period)}</title><style>
      @page{size:A4 landscape;margin:7mm}
      html,body{margin:0;padding:0;background:#fff;color:#111;font-family:"Times New Roman",serif}
      .k011-sheet{width:100%;box-sizing:border-box}
      table{width:100%;border-collapse:collapse;table-layout:fixed}
      td,th{border:1px solid #111;text-align:center;vertical-align:middle;padding:4px 5px;font-size:10.5pt;line-height:1.08;font-weight:400}
      th{font-weight:700}
      .head-left{width:30%;font-size:11pt;font-weight:700;line-height:1.08}
      .head-title{width:52%;font-size:12pt;font-weight:700}
      .head-meta{width:18%;text-align:left;vertical-align:top;font-size:10.5pt;font-weight:700;line-height:1.25}
      .lp{width:4%}.date{width:10%}.name{width:18%}.supplier{width:16%}.hygiene{width:10%}.qty{width:9%}.lot{width:12%}.notes{width:13%}.sign{width:14%}
      .left{text-align:left}
      tbody td{height:34px}
      .blank-row td{height:34px}
    </style></head><body><div class="k011-sheet">
      <table><tbody><tr>
        <td class="head-left">AGRO-MAR MARIUSZ BAŃKA<br>SP. Z O.O.<br>24-335 ŁAZISKA,<br>KOLONIA ŁAZISKA 30<br>NIP: 7171839598<br>Wersja I/2024</td>
        <td class="head-title">Karta K01/1 – Karta kontroli przyjęcia materiałów pomocniczych</td>
        <td class="head-meta">Rok: ${escapeHtml(auxYear)}<br>Miesiąc:<br>Strona:</td>
      </tr></tbody></table>
      <table><thead><tr>
        <th class="lp">Lp.</th><th class="date">Data<br>dostawy</th><th class="name">Nazwa<br>towaru/przeznaczenie</th><th class="supplier">Dostawca/nr faktury</th><th class="hygiene">Stan<br>higieniczny<br>pojazdu<br>(P/N)*</th><th class="qty">Ilość</th><th class="lot">Nadany numer<br>partii<br>(w przypadku<br>opakowań)</th><th class="notes">Uwagi</th><th class="sign">Podpis przyjmującego</th>
      </tr></thead><tbody>${trs}</tbody></table></div><script>window.onload=function(){setTimeout(function(){window.focus();window.print()},500)}</script></body></html>`
  }

  function printK011() { printHtmlInIframe(buildK011Html(auxVisibleRows)) }

  function exportK011Excel() {
    const rows = [
      ['AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.', '', '', 'Karta K01/1 – Karta kontroli przyjęcia materiałów pomocniczych', '', '', '', 'Rok:', auxYear],
      ['Lp.', 'Data dostawy', 'Nazwa towaru/przeznaczenie', 'Dostawca/nr faktury', 'Stan higieniczny pojazdu (P/N)', 'Ilość', 'Nadany numer partii', 'Uwagi', 'Podpis przyjmującego'],
      ...auxVisibleRows.map((r,i)=>[i+1, r.delivery_date || '', r.item_name || '', r.supplier_invoice || '', normalizePN(r.vehicle_hygiene || 'P'), r.qty || '', r.lot_no || '', r.notes || '', r.signed_by || ''])
    ]
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [{wch:6},{wch:14},{wch:28},{wch:28},{wch:18},{wch:12},{wch:20},{wch:24},{wch:22}]
    XLSX.utils.book_append_sheet(wb, ws, 'K01.1')
    XLSX.writeFile(wb, `K01-1-materialy-pomocnicze-${auxYear}-H${auxHalf}.xlsx`)
  }


  function auxHalfCounts() {
    const years = new Set(auxRows.map(r => String((r.delivery_date || '').slice(0,4))).filter(Boolean))
    years.add(auxYear)
    const rows = []
    Array.from(years).sort().forEach(year => {
      for (const half of ['1','2']) {
        const count = auxRows.filter(r => {
          const h = auxHalfFromDate(r.delivery_date)
          return h.year === year && h.half === half
        }).length
        rows.push({ year, half, count, label: half === '1' ? 'I półrocze' : 'II półrocze' })
      }
    })
    return rows
  }

  function openAuxHalf(year, half) {
    setAuxYear(String(year))
    setAuxHalf(String(half))
    resetAuxForm()
  }

  function renderK011Section() {
    const periodLabel = auxHalf === '1' ? 'I półrocze' : 'II półrocze'
    const rowsForPaper = auxVisibleRows.slice(0, 12)
    const blanks = Array.from({length: Math.max(0, 12-rowsForPaper.length)})
    return <>
      <div className="section-title"><ClipboardList/><div><h2>K01.1 – Karta kontroli przyjęcia materiałów pomocniczych</h2><p>Lista półrocznych kartotek. Najpierw wybierz kartotekę, potem dodawaj lub edytuj jej pozycje. wgraj fakturę PDF, system spróbuje odczytać dane i uzupełnić formularz; dane możesz poprawić przed zapisem.</p></div></div>
      <div className="card inner-card no-print">
        <h3>Lista kartotek K01.1</h3>
        <table><thead><tr><th>Kartoteka</th><th>Okres</th><th>Wpisy</th><th>Akcje</th></tr></thead><tbody>
          {auxHalfCounts().map(row => <tr key={`${row.year}-${row.half}`}>
            <td>K01.1</td><td>{row.year} – {row.label}</td><td>{row.count}</td>
            <td className="row-actions"><button className="mini secondary" onClick={()=>openAuxHalf(row.year,row.half)}>Otwórz / Edytuj</button>{String(auxYear)===String(row.year)&&String(auxHalf)===String(row.half) ? <span className="status ok">otwarta</span> : null}</td>
          </tr>)}
        </tbody></table>
      </div>
      <div className="form-grid compact no-print">
        <label>Rok<input value={auxYear} onChange={e=>setAuxYear(e.target.value)} /></label>
        <label>Okres<select value={auxHalf} onChange={e=>setAuxHalf(e.target.value)}><option value="1">I półrocze</option><option value="2">II półrocze</option></select></label>
      </div>
      <div className="card inner-card no-print">
        <h3>{auxForm.id ? 'Edytuj pozycję K01.1' : `Dodaj pozycję do K01.1 – ${auxYear}, ${periodLabel}`}</h3>
        <div className="form-grid compact">
          <label>Faktura PDF<input type="file" accept="application/pdf" onChange={handleAuxPdfFile} /><span className="hint">PDF tekstowy odczytuje się automatycznie; skan może wymagać ręcznej korekty.</span></label>
          <label>Data dostawy<input type="date" value={auxForm.delivery_date} onChange={e=>setAuxForm({...auxForm, delivery_date:e.target.value})} /></label>
          <label>Nazwa towaru / przeznaczenie<input value={auxForm.item_name} onChange={e=>setAuxForm({...auxForm, item_name:e.target.value})} placeholder="np. kartony, worki, etykiety" /></label>
          <label>Dostawca / nr faktury<input value={auxForm.supplier_invoice} onChange={e=>setAuxForm({...auxForm, supplier_invoice:e.target.value})} placeholder="np. Firma X / FV/123/2026" /></label>
          <label>Stan higieniczny pojazdu<select value={auxForm.vehicle_hygiene} onChange={e=>setAuxForm({...auxForm, vehicle_hygiene:e.target.value})}><option value="P">P</option><option value="N">N</option></select></label>
          <label>Ilość<input value={auxForm.qty} onChange={e=>setAuxForm({...auxForm, qty:e.target.value})} placeholder="np. 500 szt." /></label>
          <label>Nadany numer partii<input value={auxForm.lot_no} onChange={e=>setAuxForm({...auxForm, lot_no:e.target.value})} placeholder="jeśli dotyczy" /></label>
          <label>Podpis przyjmującego<select value={auxForm.signed_by} onChange={e=>setAuxForm({...auxForm, signed_by:e.target.value})}><option value="">Wybierz pracownika</option>{employees.map(emp=><option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}</select></label>
          <label>Uwagi<input value={auxForm.notes} onChange={e=>setAuxForm({...auxForm, notes:e.target.value})} /></label>
        </div>
        {auxPdfName && <p className="hint">Wybrany PDF: <b>{auxPdfName}</b></p>}
        <div className="actions"><button onClick={saveAuxMaterial}>{auxForm.id ? 'Zapisz zmiany' : 'Dodaj do kartoteki'}</button><button className="secondary" onClick={resetAuxForm}>Wyczyść</button></div>
      </div>
      <div className="actions no-print"><button className="secondary" onClick={loadAuxMaterials}><RefreshCcw size={16}/> Odśwież</button><button className="secondary" onClick={printK011}><Printer size={16}/> Druk/PDF</button><button className="secondary" onClick={exportK011Excel}>Pobierz Excel</button></div>
      <h3 className="no-print">Podgląd otwartej kartoteki: K01.1 – {auxYear}, {periodLabel}</h3>
      <div className="k011-original haccp-paper">
        <table className="k011-head"><tbody><tr>
          <td className="k011-company"><b>AGRO-MAR MARIUSZ BAŃKA<br/>SP. Z O.O.<br/>24-335 ŁAZISKA,<br/>KOLONIA ŁAZISKA 30<br/>NIP: 7171839598<br/>Wersja I/2024</b></td>
          <td className="k011-title"><b>Karta K01/1 – Karta kontroli przyjęcia materiałów pomocniczych</b></td>
          <td className="k011-meta"><b>Rok:</b> {auxYear}<br/><b>Miesiąc:</b><br/><b>Strona:</b></td>
        </tr></tbody></table>
        <table className="k011-table"><thead><tr>
          <th className="lp">Lp.</th><th className="date">Data<br/>dostawy</th><th className="name">Nazwa<br/>towaru/przeznaczenie</th><th className="supplier">Dostawca/nr faktury</th><th className="hygiene">Stan<br/>higieniczny<br/>pojazdu<br/>(P/N)*</th><th className="qty">Ilość</th><th className="lot">Nadany numer<br/>partii<br/>(w przypadku<br/>opakowań)</th><th className="notes">Uwagi</th><th className="sign">Podpis przyjmującego</th><th className="no-print actions-col">Akcje</th>
        </tr></thead><tbody>
          {rowsForPaper.map((r,i)=><tr key={r.id}><td>{i+1}</td><td>{r.delivery_date}</td><td className="left">{r.item_name}</td><td className="left">{r.supplier_invoice}</td><td>{normalizePN(r.vehicle_hygiene || 'P')}</td><td>{r.qty}</td><td>{r.lot_no}</td><td className="left">{r.notes}</td><td>{r.signed_by}</td><td className="no-print"><button className="mini secondary" onClick={()=>editAuxMaterial(r)}>Edytuj</button><button className="mini danger" onClick={()=>deleteAuxMaterial(r)}>Usuń</button></td></tr>)}
          {blanks.map((_,i)=><tr key={`blank-${i}`} className="blank-row"><td>{rowsForPaper.length+i+1}</td><td></td><td></td><td></td><td>P</td><td></td><td></td><td></td><td></td><td className="no-print"></td></tr>)}
        </tbody></table>
      </div>
    </>
  }

  function renderHaccpPreview(doc) {
    if (!doc) return null
    if (doc.groupPreview) {
      const group = haccpMonthlyGroups.find(g => g.key === doc.group?.key) || doc.group
      return <div className="modal-backdrop" onClick={() => setSelectedHaccpDoc(null)}><div className="haccp-modal wide" onClick={e => e.stopPropagation()}><div className="haccp-paper">{renderGroupPreviewTable(group)}</div><div className="modal-actions no-print">
        {group.type === 'K03' && (group.docs || [])[0] && (group.docs[0].frozen
          ? <>
            <span className="status ok">Zamrożony – FIFO nie zmieni tej kartoteki</span>
            <button className="secondary" onClick={() => unfreezeK03Document(group.docs[0])}>Odmroź</button>
          </>
          : <span className="pill">Roboczy – uzupełnij dane; prawidłowy K03 zamraża się automatycznie przy tworzeniu</span>)}
        <button className="secondary" onClick={() => printHaccpGroup(group)}><Printer size={16}/> Drukuj / PDF</button><button className="secondary" onClick={() => exportHaccpGroupExcel(group)}>Pobierz Excel</button><button className="secondary" onClick={() => setSelectedHaccpDoc(null)}>Zamknij</button></div></div></div>
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
    if (activeTab === 'kartoteki' && docsFilter === 'K03') {
      loadK03TraceData()
    }
  }, [activeTab, docsFilter])

  useEffect(() => {
    if (!isSupabaseConfigured) return
    ;(async () => {
      await loadFifoData()
      loadImports()
      loadHaccpDocs()
      loadEmployees()
      loadAuxMaterials()
      loadPzManagementData()
      await loadK03SnapshotsOnly()
      await loadK03TraceData()
      await loadFifoChangeLog()
    })()
  }, [])

  async function runFifoIncremental(showConfirm = true) {
    if (!supabase) {
      setMessage('Brak konfiguracji Supabase.')
      return null
    }
    const frozenKeys = frozenKeysFromSnapshots(k03Snapshots)
    const stats = await countIncompleteSales(supabase, frozenKeys).catch(() => ({ incomplete: 0, complete: 0, frozen: frozenKeys.size }))
    if (showConfirm && !window.confirm(
      `Uzupełnić braki FIFO?\n\n` +
      `• Pominięte (kompletne): ${stats.complete}\n` +
      `• Zamrożone (z wydruku): ${stats.frozen}\n` +
      `• Do uzupełnienia: ${stats.incomplete}\n\n` +
      `Wcześniejsze zgodne i zamrożone kartoteki K03 nie zostaną zmienione.`
    )) return null

    setFifoRecalculating(true)
    try {
      const fifoResult = await recalculateFifoIncremental(supabase, { frozenKeys })
      if (!fifoResult.ok) throw new Error('Przeliczenie FIFO nie powiodło się.')
      await loadFifoData()
      await loadK03TraceData()
      await loadPzManagementData()
      await loadFifoChangeLog()
      setFifoKartotekiDirty(false)
      const shortageCount = (fifoResult.shortages || []).length
      setMessage(
        `FIFO uzupełnione (${fifoResult.mode}). Przetworzono ${fifoResult.processed} WZ, ` +
        `pominięto ${fifoResult.skippedComplete} kompletnych i ${fifoResult.skippedFrozen} zamrożonych.` +
        (shortageCount ? ` Brak PZ dla ${shortageCount} pozycji.` : '')
      )
      return fifoResult
    } catch (err) {
      setMessage(`Błąd uzupełniania FIFO: ${err?.message || String(err)}`)
      return null
    } finally {
      setFifoRecalculating(false)
    }
  }

  async function runFifoFullRecalculate(showConfirm = true) {
    if (!supabase) {
      setMessage('Brak konfiguracji Supabase.')
      return null
    }
    const frozenKeys = frozenKeysFromSnapshots(k03Snapshots)
    const frozenOpIds = frozenOperationIdsFromSnapshots(k03Snapshots)
    const frozenCount = frozenKeys.size

    if (showConfirm) {
      const msg = frozenCount
        ? `Pełne przeliczenie FIFO (z ochroną ${frozenCount} zamrożonych K03).\n\n` +
          `Zamrożone wydruki NIE zmienią przypisanych PZ.\n` +
          `Pozostałe WZ zostaną przeliczone od nowa.\n\nKontynuować?`
        : `Przeliczyć wszystkie WZ od nowa?\n\nKompletne rozliczenia zostaną przeliczone ponownie (brak zamrożonych K03).`
      if (!window.confirm(msg)) return null
    }

    setFifoRecalculating(true)
    try {
      const fifoResult = await recalculateFifoFullProtected(supabase, {
        frozenKeys,
        frozenOperationIds: frozenOpIds,
        changedBy: userRole,
        reason: 'Pełne przeliczenie z ochładką K03'
      })
      if (!fifoResult.ok) throw new Error('Przeliczenie FIFO nie powiodło się.')
      await loadFifoData()
      await loadK03TraceData()
      await loadPzManagementData()
      await loadFifoChangeLog()
      setFifoKartotekiDirty(false)
      const shortageCount = (fifoResult.shortages || []).length
      setMessage(
        `Pełne FIFO (${fifoResult.mode}). Przeliczono ${fifoResult.processed} WZ, ` +
        `chroniono ${fifoResult.frozenProtected} zamrożonych.` +
        (shortageCount ? ` Brak PZ: ${shortageCount} pozycji.` : '')
      )
      return fifoResult
    } catch (err) {
      setMessage(`Błąd przeliczenia FIFO: ${err?.message || String(err)}`)
      return null
    } finally {
      setFifoRecalculating(false)
    }
  }

  /** @deprecated alias – używa trybu przyrostowego */
  async function runFifoRecalculate(showConfirm = true) {
    return runFifoIncremental(showConfirm)
  }

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setMessage('')
    try {
      const parsed = await readAgromarExcel(file)
      setRows(parsed)
      let loadMsg = `Wczytano ${parsed.length} wierszy. System pobiera tylko potrzebne dane: nr PZ/WZ/FV, datę, produkt i ilość.`
      if (supabase) {
        const classified = parsed.map(r => ({ ...r, operation: classifyOperation(r.documentType, r.documentNo) }))
        const groups = groupImportRows(classified)
        const suggestions = await suggestFrozenK03UnfreezeAfterImport(supabase, groups)
        setK03UnfreezeSuggestions(suggestions)
        if (suggestions.length) {
          loadMsg += ` Możliwe konflikty z ${suggestions.length} zamrożonymi K03 – sprawdź baner przed zapisem.`
        }
      }
      setMessage(loadMsg)
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
  const controlPoint = forcedControlPoint === null ? null : (forcedControlPoint || targetControlPointForProduct(productName))
  let storageChamberId = null
  if (controlPoint) {
    storageChamberId = await findCompatibleChamber(productGroup, controlPoint)
  }

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

function resolveProductGroup(product, productName = '') {
  return product?.product_group || productGroupForName(product?.name || productName)
}

async function fetchSupabaseInChunks(table, select, column, ids, chunkSize = 80) {
  const uniqueIds = Array.from(new Set((ids || []).filter(Boolean)))
  if (!uniqueIds.length) return []
  const results = []
  for (let i = 0; i < uniqueIds.length; i += chunkSize) {
    const chunk = uniqueIds.slice(i, i + chunkSize)
    const { data, error } = await supabase.from(table).select(select).in(column, chunk)
    if (error) throw error
    results.push(...(data || []))
  }
  return results
}

function isIncomingLotOperation(op) {
  if (!op) return true
  if (op.operation_type === 'przyjecie') return true
  const no = String(op.document_no || '').toUpperCase()
  return no.startsWith('PZ') || no.startsWith('MM')
}

async function recalculateFifoClientSide() {
  const [{ data: products, error: productsErr }, { data: lotsRaw, error: lotsErr }, { data: operations, error: opsErr }, { data: saleItemsRaw, error: itemsErr }] = await Promise.all([
    supabase.from('products').select('id, name, code, product_group'),
    supabase.from('lots').select('id, lot_no, product_id, product_group, production_date, created_at, initial_qty, remaining_qty, source_operation_id, status'),
    supabase.from('operations').select('id, operation_type, operation_date, document_no, created_at'),
    supabase.from('operation_items').select('id, operation_id, product_id, qty, direction').eq('direction', 'rozchod')
  ])
  if (productsErr) throw productsErr
  if (lotsErr) throw lotsErr
  if (opsErr) throw opsErr
  if (itemsErr) throw itemsErr

  const productMap = new Map((products || []).map(p => [p.id, p]))
  const opMap = new Map((operations || []).map(o => [o.id, o]))
  const saleOpIds = new Set((operations || []).filter(isSaleOperation).map(o => o.id))
  for (const item of saleItemsRaw || []) {
    if (item.operation_id) saleOpIds.add(item.operation_id)
  }

  const { data: existingAllocations, error: allocFetchErr } = await supabase
    .from('fifo_allocations')
    .select('id, operation_id')
  if (allocFetchErr) throw allocFetchErr

  const allocIdsToDelete = (existingAllocations || []).filter(a => saleOpIds.has(a.operation_id)).map(a => a.id)
  for (let i = 0; i < allocIdsToDelete.length; i += 100) {
    const chunk = allocIdsToDelete.slice(i, i + 100)
    if (!chunk.length) continue
    const { error } = await supabase.from('fifo_allocations').delete().in('id', chunk)
    if (error) throw error
  }

  const lotState = new Map()
  for (const lot of lotsRaw || []) {
    const srcOp = opMap.get(lot.source_operation_id)
    const isIncoming = !lot.source_operation_id || isIncomingLotOperation(srcOp)
    if (!isIncoming || Number(lot.initial_qty || 0) <= 0) {
      lotState.set(lot.id, { ...lot, remaining_qty: Number(lot.remaining_qty || 0) })
      continue
    }
    lotState.set(lot.id, {
      ...lot,
      remaining_qty: Number(lot.initial_qty || 0),
      status: Number(lot.initial_qty || 0) > 0 ? 'aktywna' : lot.status
    })
    const { error } = await supabase.from('lots').update({
      remaining_qty: Number(lot.initial_qty || 0),
      status: Number(lot.initial_qty || 0) > 0 ? 'aktywna' : lot.status
    }).eq('id', lot.id)
    if (error) throw error
  }

  const saleLines = []
  for (const item of saleItemsRaw || []) {
    const op = opMap.get(item.operation_id)
    if (!item.operation_id || !item.product_id) continue
    const qty = Math.abs(Number(item.qty || 0))
    if (qty <= 0) continue
    const product = productMap.get(item.product_id)
    saleLines.push({
      operation_id: item.operation_id,
      product_id: item.product_id,
      sale_group: resolveProductGroup(product),
      sale_date: op?.operation_date,
      sale_doc_no: op?.document_no || '',
      sale_created_at: op?.created_at,
      sale_qty: qty
    })
  }

  const saleGroups = new Map()
  for (const line of saleLines) {
    const key = `${line.operation_id}|${line.product_id}`
    const current = saleGroups.get(key) || { ...line, sale_qty: 0 }
    current.sale_qty += line.sale_qty
    saleGroups.set(key, current)
  }

  const sortedSales = Array.from(saleGroups.values()).sort((a, b) =>
    String(a.sale_date || '').localeCompare(String(b.sale_date || '')) ||
    String(a.sale_created_at || '').localeCompare(String(b.sale_created_at || '')) ||
    String(a.sale_doc_no || '').localeCompare(String(b.sale_doc_no || '')) ||
    String(a.product_id || '').localeCompare(String(b.product_id || ''))
  )

  const shortages = []
  let allocationCount = 0

  for (const sale of sortedSales) {
    let remaining = Number(sale.sale_qty || 0)
    let allocated = 0
    const saleDate = String(sale.sale_date || '9999-12-31').slice(0, 10)

    const candidateLots = Array.from(lotState.values())
      .filter(lot => {
        const group = lot.product_group || resolveProductGroup(productMap.get(lot.product_id))
        return group === sale.sale_group &&
          Number(lot.remaining_qty || 0) > 0 &&
          lot.production_date &&
          String(lot.production_date).slice(0, 10) <= saleDate
      })
      .sort((a, b) =>
        String(a.production_date || '').localeCompare(String(b.production_date || '')) ||
        String(a.created_at || '').localeCompare(String(b.created_at || '')) ||
        String(a.lot_no || '').localeCompare(String(b.lot_no || ''))
      )

    for (const lot of candidateLots) {
      if (remaining <= 0) break
      const available = Number(lot.remaining_qty || 0)
      const take = Math.min(available, remaining)
      if (take <= 0) continue

      const newRemaining = available - take
      lot.remaining_qty = newRemaining
      lot.status = newRemaining <= 0.0005 ? 'zuzyta' : 'aktywna'
      lotState.set(lot.id, lot)

      const { error: lotErr } = await supabase.from('lots').update({
        remaining_qty: newRemaining,
        status: lot.status
      }).eq('id', lot.id)
      if (lotErr) throw lotErr

      const { error: allocErr } = await supabase.from('fifo_allocations').insert({
        operation_id: sale.operation_id,
        source_lot_id: lot.id,
        product_id: sale.product_id,
        qty: take
      })
      if (allocErr) throw allocErr

      allocationCount += 1
      remaining -= take
      allocated += take
    }

    if (remaining > 0.0005) {
      shortages.push({
        wz_no: sale.sale_doc_no,
        wz_date: saleDate,
        product_group: sale.sale_group,
        wz_qty: Number(sale.sale_qty || 0),
        allocated_qty: allocated,
        shortage: remaining
      })
    }
  }

  return { ok: true, mode: 'client', shortages, allocationCount }
}

async function recalculateFifoEngine() {
  if (!supabase) return { ok: false, mode: 'none', shortages: [], allocationCount: 0 }
  const { error } = await supabase.rpc('recalculate_fifo_strict_by_group_date')
  if (!error) {
    const { count } = await supabase.from('fifo_allocations').select('*', { count: 'exact', head: true })
    return { ok: true, mode: 'rpc', shortages: [], allocationCount: count || 0 }
  }
  console.warn('FIFO RPC niedostępne, przeliczanie po stronie aplikacji:', error?.message || error)
  const clientResult = await recalculateFifoClientSide()
  return clientResult
}

async function allocateFifo(operationId, productId, qtyNeeded, operationDate = null) {
  let remainingToAllocate = Math.abs(Number(qtyNeeded) || 0)
  const allocations = []

  const { data: product, error: productErr } = await supabase
    .from('products')
    .select('id, name, code, product_group')
    .eq('id', productId)
    .maybeSingle()
  if (productErr) throw productErr
  const saleGroup = resolveProductGroup(product)

  const { data: lots, error } = await supabase
    .from('lots')
    .select('id, remaining_qty, production_date, created_at, product_group, lot_no, product_id')
    .gt('remaining_qty', 0)
    .lte('production_date', operationDate || '9999-12-31')
    .order('production_date', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error

  const matchingLots = (lots || []).filter(lot => {
    const lotGroup = lot.product_group
    if (lotGroup && saleGroup) return lotGroup === saleGroup
    return lot.product_id === productId
  })

  for (const lot of matchingLots) {
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



  async function loadK03TraceData() {
    setK03Loading(true)
    try {
      let forms = []
      let diag = { wzDocs: 0, saleLines: 0, forms: 0, allocations: 0, source: 'brak' }
      let note = ''

      if (supabase) {
        const queue = await loadWzQueue(supabase)
        forms = queue.forms || []
        setWzQueueLines(queue.lines || [])
        diag = queue.diag || diag
        note = queue.message || ''
        setK03Snapshots(queue.snapshots || [])
        const pending = (queue.lines || []).filter(l => l.status === 'pending').length
        const ready = (queue.lines || []).filter(l => l.status === 'k03_ready' || l.status === 'legacy_auto').length
        const frozenCount = (queue.lines || []).filter(l => l.status === 'frozen').length
        if (pending) note = `${note ? note + ' ' : ''}${pending} WZ oczekuje na decyzję (przerób / brak przerobu).`
        if (ready) note = `${note ? note + ' ' : ''}${ready} K03 gotowych.`
        if (frozenCount) note = `${note ? note + ' ' : ''}${frozenCount} K03 zamrożonych – FIFO ich nie zmienia.`
        await loadFifoChangeLog()
      } else {
        note = 'Brak pliku .env z danymi bazy – K03 pokaże WZ z wczytanego Excela (jeśli jest).'
      }

      if (!forms.length && supabase && importRows.length) {
        const latestImport = importRows[0]
        const { data: opsFromImport, error: importOpsErr } = await supabase
          .from('operations')
          .select('id, operation_type, operation_date, document_no, invoice_no, contractor_id, created_at, operation_items(qty, direction, raw_product_name, product_id)')
          .eq('imported_file_id', latestImport.id)
          .order('operation_date', { ascending: true })
          .limit(500)
        if (!importOpsErr && opsFromImport?.length) {
          const fromImport = buildK03FormsFromImportPreview(opsFromImport)
          if (fromImport.length) {
            forms = fromImport
            diag = { ...diag, forms: fromImport.length, wzDocs: opsFromImport.filter(isSaleOperation).length, source: 'ostatni-import' }
            note = `Pokazuję ${fromImport.length} WZ z ostatniego importu Excel („${latestImport.filename || 'plik'}”). Kliknij „Przelicz FIFO”, żeby dobrać PZ.`
          }
        }
      }

      if (!forms.length && importPreview.length) {
        const fromImport = buildK03FormsFromImportPreview(importPreview)
        if (fromImport.length) {
          forms = fromImport
          diag = { ...diag, forms: fromImport.length, source: 'podglad-importu' }
          note = `Pokazuję ${fromImport.length} WZ z podglądu importu. Otwórz zakładkę Importy → Podgląd przy pliku Excel.`
        }
      }

      if (!forms.length && filteredRows.some(r => r.operation === 'sprzedaz')) {
        const fromExcel = buildK03FormsFromExcelRows(filteredRows)
        if (fromExcel.length) {
          forms = fromExcel
          diag = { ...diag, forms: fromExcel.length, wzDocs: new Set(fromExcel.map(f => f.document_no)).size, source: 'excel' }
          note = `Pokazuję ${fromExcel.length} WZ z wczytanego Excela. Aby zapisać na stałe: Importy → Zapisz do Supabase, potem Odśwież kartoteki.`
        }
      }

      setK03FormsRaw(forms)
      if (!supabase && forms.length) {
        setWzQueueLines(forms.map(f => ({
          key: f.id.replace(/^K03-/, ''),
          formId: f.id,
          operation_id: f.data?.sale_operation_id,
          product_id: f.data?.product_id,
          product_name: f.product_name,
          product_group: f.product_group || f.data?.product_group,
          document_no: f.document_no,
          wz_date: f.document_date,
          qty: Number(f.qty || 0),
          receiver: f.data?.odbiorca || '',
          status: f.data?.k03_source === 'excel' ? 'pending' : 'legacy_auto',
          frozen: false,
          workflow: f.data?.k03_workflow || null,
          k03Form: f.data?.k03_source === 'excel' ? null : f,
          haccp_doc_id: null
        })))
      }
      setK03Diag(diag)
      setK03PanelNote(note || (forms.length ? `Załadowano ${forms.length} formularzy K03.` : 'Brak WZ do wyświetlenia.'))
    } catch (err) {
      setK03FormsRaw([])
      setK03Diag({ wzDocs: 0, saleLines: 0, forms: 0, allocations: 0, source: 'blad' })
      console.error('K03 load error', err)
      setK03PanelNote(`Błąd K03: ${err?.message || String(err)}`)
    } finally {
      setK03Loading(false)
    }
  }

  async function loadFifoData() {
    if (!supabase) return
    setLoadingStock(true)
    try {
      // Wersja v7: celowo bez zagnieżdżonych relacji Supabase, żeby ominąć błędy typu select/relationship.
      const { data: lotsRaw, error: lotsErr } = await supabase
        .from('lots')
        .select('id, lot_no, production_date, initial_qty, remaining_qty, status, product_id, product_group, storage_chamber_id, source_operation_id, created_at')
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

      try {
        const [{ data: traceAllocations }, { data: traceOperations }] = await Promise.all([
          supabase.from('fifo_allocations').select('id, qty, source_lot_id, output_lot_id, operation_id').limit(20000),
          supabase.from('operations').select('id, operation_type, operation_date, document_no').in('operation_type', ['sprzedaz', 'sprzedaz_bez_produkcji', 'produkcja']).limit(20000)
        ])
        setFormsTrace({ allocations: traceAllocations || [], operations: traceOperations || [] })
        const { data: k06Existing } = await supabase.from('haccp_documents').select('id, document_type, lot_id, lot_no').eq('document_type', 'K06')
        const k06Added = await syncAutoK06Documents(lotsData, traceOperations || [], k06Existing || [])
        if (k06Added > 0) await loadHaccpDocs()
      } catch {
        setFormsTrace({ allocations: [], operations: [] })
      }

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

      const { data: outLot } = await supabase.from('lots').select('lot_no, storage_chamber_id').eq('id', outputLotId).single()
      const isPulpa = /pulpa/i.test(productionOutputName)
      const isDirectSale = isDirectToSaleProduct(productionOutputName)
      if (!isPulpa && !isDirectSale && outLot) {
        const chamber = chamberRows.find(c => c.id === outLot.storage_chamber_id)
        await supabase.from('haccp_documents').insert({
          document_type: 'K06',
          lot_id: outputLotId,
          operation_id: op.id,
          document_date: today,
          product_name: productionOutputName,
          lot_no: outLot.lot_no,
          document_no: documentNo,
          chamber_code: chamber?.code || 'CP3',
          qty: outputQty,
          status: 'P',
          data: { wyglad_zapach: 'P', smak: 'P', barwa: 'P', uwagi: '', podpis: '' }
        })
      }

      setMessage(`Utworzono produkcję ${documentNo}. Zdjęto ${inputQty.toLocaleString('pl-PL')} kg z partii ${sourceLot.lot_no}, utworzono ${outputQty.toLocaleString('pl-PL')} kg: ${productionOutputName}.`)
      setProductionInputLotId('')
      setProductionInputQty('')
      setProductionOutputQty('')
      await loadFifoData()
      await loadHaccpDocs()
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
      loadAuxMaterials()
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
      loadAuxMaterials()
      setMessage('Pracownik został ukryty z listy podpisów.')
    } catch (err) {
      setMessage(`Błąd usuwania pracownika: ${err.message}`)
    }
  }

  async function setDocumentEmployee(doc, employeeName) {
    if (!supabase || !doc) return
    const nextData = { ...(doc.data || {}), podpis_przyjmujacego: employeeName || '' }
    try {
      const { error } = await supabase
        .from('haccp_documents')
        .update({ data: nextData, signed_by_operator: employeeName || null, updated_at: new Date().toISOString() })
        .eq('id', doc.id)
      if (error) throw error
      await supabase.from('haccp_document_history').insert({
        document_id: doc.id,
        action: 'wybor_pracownika',
        field_name: 'podpis_przyjmujacego',
        old_value: doc.signed_by_operator || doc.data?.podpis_przyjmujacego || '',
        new_value: employeeName || '',
        reason: 'Wybór podpisu przyjmującego z listy pracowników',
        changed_by: userRole
      })
      const updated = { ...doc, data: nextData, signed_by_operator: employeeName || '' }
      setHaccpDocs(prev => prev.map(d => d.id === doc.id ? updated : d))
      setSelectedHaccpDoc(prev => {
        if (!prev) return prev
        if (prev.groupPreview && prev.group?.docs) {
          return { ...prev, group: { ...prev.group, docs: prev.group.docs.map(d => d.id === doc.id ? updated : d) } }
        }
        if (prev.id === doc.id) return updated
        return prev
      })
      setMessage('Podpis przyjmującego zapisany.')
    } catch (err) {
      setMessage(`Błąd zapisu podpisu: ${err.message}`)
    }
  }


  async function setK01Supplier(doc, supplierName) {
    if (!supabase || !doc) return
    const clean = cleanSupplierName(supplierName)
    if (!clean) { setMessage('Wpisz faktyczne imię i nazwisko / nazwę dostawcy.'); return }
    const nextData = { ...(doc.data || {}), faktyczny_dostawca: clean }
    try {
      const { error } = await supabase
        .from('haccp_documents')
        .update({ data: nextData, updated_at: new Date().toISOString() })
        .eq('id', doc.id)
      if (error) throw error
      await supabase.from('haccp_document_history').insert({
        document_id: doc.id,
        action: 'zmiana_dostawcy_k01',
        field_name: 'faktyczny_dostawca',
        old_value: getK01SupplierName(doc) || '',
        new_value: clean,
        reason: 'Ręczne uzupełnienie faktycznego dostawcy K01',
        changed_by: userRole
      })
      const updated = { ...doc, data: nextData }
      setHaccpDocs(prev => prev.map(d => d.id === doc.id ? updated : d))
      setSelectedHaccpDoc(prev => {
        if (!prev) return prev
        if (prev.groupPreview && prev.group?.docs) {
          return { ...prev, group: { ...prev.group, docs: prev.group.docs.map(d => d.id === doc.id ? updated : d) } }
        }
        if (prev.id === doc.id) return updated
        return prev
      })
      setMessage('Zapisano faktycznego dostawcę dla wpisu K01.')
    } catch (err) {
      setMessage(`Błąd zapisu dostawcy: ${err.message}`)
    }
  }

  function promptK01Supplier(doc) {
    const current = getK01SupplierName(doc)
    const next = window.prompt('Podaj faktycznego dostawcę dla tego PZ (np. Sałasiński Edward):', current || '')
    if (next !== null) setK01Supplier(doc, next)
  }


  async function loadPzManagementData() {
    if (!supabase) return
    try {
      const { data: rowsRaw, error: rowsErr } = await supabase
        .from('pz_fifo_overview')
        .select('*')
        .order('production_date', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(10000)
      if (rowsErr) throw rowsErr

      const rows = (rowsRaw || []).map(r => {
        const initial = Number(r.initial_qty || 0)
        const allocated = Number(r.allocated_qty || 0)
        const remaining = Math.max(0, Number(r.calculated_remaining_qty ?? (initial - allocated)))
        let statusKey = r.status_key || 'wolna'
        let statusLabel = r.status_label || 'Nieprzypisana'
        if (!r.status_key) {
          if (allocated >= initial - 0.001 && initial > 0) { statusKey = 'wykorzystana'; statusLabel = 'Wykorzystana' }
          else if (allocated > 0) { statusKey = 'czesciowo'; statusLabel = 'Częściowo' }
        }
        return { ...r, initial_qty: initial, allocated_qty: allocated, calculated_remaining_qty: remaining, status_key: statusKey, status_label: statusLabel }
      })
      setPzRows(rows)

      const { data: hist, error: histErr } = await supabase.from('pz_fifo_change_log').select('*').order('created_at', { ascending: false }).limit(200)
      if (!histErr) setPzHistoryRows(hist || [])
      setMessage(rows.length ? `Wczytano PZ: ${rows.length}.` : 'Nie znaleziono PZ do wyświetlenia.')
    } catch (err) {
      console.error('PZ management load error', err)
      setMessage(`Błąd odczytu zakładki PZ: ${err?.message || String(err)}. Uruchom SQL v31.1.`)
    }
  }

  async function savePzDate(row) {
    if (!supabase || !row?.id) return
    const newDate = pzEditDates[row.id] || String(row.production_date || row.operation_date || '').slice(0, 10)
    const oldDate = String(row.production_date || row.operation_date || '').slice(0, 10)
    if (!newDate || newDate === oldDate) { setMessage('Data PZ bez zmian.'); return }
    const reason = window.prompt(`Podaj powód zmiany daty PZ ${row.document_no || row.lot_no}:`, 'Korekta daty PZ/FIFO')
    if (reason === null) return
    if (!window.confirm(`Zmienić datę PZ ${row.document_no || row.lot_no} z ${oldDate} na ${newDate}?`)) return
    try {
      const { error: lotErr } = await supabase.from('lots').update({ production_date: newDate }).eq('id', row.id)
      if (lotErr) throw lotErr
      if (row.source_operation_id) {
        const { error: opErr } = await supabase.from('operations').update({ operation_date: newDate }).eq('id', row.source_operation_id)
        if (opErr) throw opErr
      }
      await supabase.from('pz_fifo_change_log').insert({ lot_id: row.id, source_operation_id: row.source_operation_id, document_no: row.document_no, old_date: oldDate, new_date: newDate, change_reason: reason || 'Korekta daty PZ/FIFO', changed_by: 'admin', action_type: 'change_date' })
      const frozenN = k03Snapshots.filter(s => s.data?.frozen).length
      await runFifoIncremental(false)
      setMessage(`Zmieniono datę PZ. Uzupełniono braki FIFO (bez zmiany ${frozenN} zamrożonych K03). Sprawdź kartoteki, jeśli data dotyczyła wydrukowanych formularzy.`)
      await loadPzManagementData()
    } catch (err) { setMessage(`Błąd zmiany daty PZ: ${err?.message || String(err)}`) }
  }

  async function recalculateFifoFromPzTab() {
    await runFifoIncremental(true)
  }

  async function recalculateFifoFullFromPzTab() {
    await runFifoFullRecalculate(true)
  }

  async function refreshHaccpAfterFifo() {
    await loadHaccpDocs(); await loadK03TraceData(); await loadFifoData(); await loadPzManagementData()
    setFifoKartotekiDirty(false)
    setMessage('Kartoteki odświeżone po zmianach FIFO.')
  }

  async function undoPzChange(change) {
    if (!supabase || !change?.lot_id || !change?.old_date) return
    if (!window.confirm(`Cofnąć zmianę PZ ${change.document_no || ''}: ${change.new_date} → ${change.old_date}?`)) return
    try {
      const { error: lotErr } = await supabase.from('lots').update({ production_date: change.old_date }).eq('id', change.lot_id)
      if (lotErr) throw lotErr
      if (change.source_operation_id) {
        const { error: opErr } = await supabase.from('operations').update({ operation_date: change.old_date }).eq('id', change.source_operation_id)
        if (opErr) throw opErr
      }
      await supabase.from('pz_fifo_change_log').insert({ lot_id: change.lot_id, source_operation_id: change.source_operation_id, document_no: change.document_no, old_date: change.new_date, new_date: change.old_date, change_reason: `Cofnięcie zmiany ${change.id || ''}`, changed_by: 'admin', action_type: 'undo_date_change' })
      await runFifoIncremental(false)
      setMessage('Cofnięto zmianę daty PZ. Uzupełniono braki FIFO (zamrożone K03 bez zmian).')
      await loadPzManagementData()
    } catch (err) { setMessage(`Błąd cofania zmiany: ${err?.message || String(err)}`) }
  }

  async function syncAutoK06Documents(lotsData, operations, currentDocs) {
    if (!supabase) return 0
    const trace = { lots: lotsData, operations }
    const pending = buildSyntheticK06DocsFromTrace(trace, currentDocs)
    if (!pending.length) return 0
    let inserted = 0
    for (const doc of pending) {
      const { error } = await supabase.from('haccp_documents').insert(buildK06InsertPayload(doc))
      if (!error) inserted += 1
    }
    return inserted
  }

  async function loadHaccpDocs() {
    if (!supabase) return
    try {
      const { data, error } = await supabase
        .from('haccp_documents')
        .select('id, document_type, lot_id, document_date, product_name, lot_no, supplier_name, document_no, chamber_code, qty, status, data, signed_by_operator, signed_by_admin, document_version, created_at')
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
    ['pz', 'PZ / FIFO', Database],
    ['magazyn', 'Magazyn', Warehouse],
    ['kartoteki', 'Dokumentacja HACCP', ClipboardList],
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
      const groupsToImport = groups
        .filter(g => !existingKeys.has(`${g.operation}|${g.documentNo}`))
        .sort((a, b) => String(a.issueDate || '').localeCompare(String(b.issueDate || '')) || String(a.documentNo || '').localeCompare(String(b.documentNo || '')))
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
      let rozchodItems = 0

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
            rozchodItems += 1
          }
        }
      }

      setFifoRecalculating(true)
      let fifoAllocations = 0
      let shortageCount = 0
      let shortageKg = 0
      try {
        const snaps = supabase ? await loadK03Snapshots(supabase) : []
        const frozenKeys = frozenKeysFromSnapshots(snaps)
        const fifoResult = await recalculateFifoIncremental(supabase, { frozenKeys })
        if (fifoResult.ok) {
          fifoAllocations = fifoResult.allocationCount ?? rozchodItems
          shortageCount = (fifoResult.shortages || []).length
          shortageKg = (fifoResult.shortages || []).reduce((sum, s) => sum + Number(s.shortage || 0), 0)
        }
      } finally {
        setFifoRecalculating(false)
      }

      const importMsg =
        `Import zakończony. Zaimportowano dokumentów: ${importedOperations}, pozycji: ${importedItems}, utworzono partii: ${createdLots}, rozliczeń FIFO: ${fifoAllocations}. Pominięto duplikatów: ${duplicateCount}.` +
        (shortageCount ? ` Uwaga: brakło towaru FIFO w ${shortageCount} pozycjach, razem ${shortageKg.toLocaleString('pl-PL')} kg.` : '')

      const suggestions = supabase ? await suggestFrozenK03UnfreezeAfterImport(supabase, groups) : []
      setK03UnfreezeSuggestions(suggestions)

      setMessage(
        importMsg +
        (suggestions.length ? ` Sprawdź ${suggestions.length} zamrożonych K03 do ewentualnego odmrożenia (baner poniżej).` : '')
      )
      await loadFifoData()
      await loadK03TraceData()
      await loadImports()
      await loadHaccpDocs()
      await loadK03SnapshotsOnly()
      await loadFifoChangeLog()
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
      <div className="badge"><ShieldCheck size={18}/> v27 · K03 {K03_ENGINE_VERSION} · FIFO</div>
    </header>

    <section className="warning">
      <AlertTriangle size={20}/>
      <div><strong>Ważne:</strong> ta aplikacja ma być podłączona wyłącznie do nowego projektu Supabase <b>AGRO-MAR-HACCP</b>, nigdy do starej bazy opakowań.</div>
    </section>

    {renderK03UnfreezeBanner()}


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
      <div className="section-title"><ClipboardList/><div><h2>Status modułów HACCP/IFS</h2><p>Lista postępu projektu. Od teraz zamykamy jeden formularz/moduł do końca, zanim przejdziemy do kolejnego.</p></div></div>
      <div className="module-status-grid">
        {MODULE_STATUS.map(m => <div key={m.code} className="module-status-card">
          <div className="module-status-head"><b>{m.code}</b><span className={statusClass(m.status)}>{m.status}</span></div>
          <strong>{m.name}</strong>
          <small>{m.note}</small>
        </div>)}
      </div>
    </section>

    <section className="card">
      <div className="section-title"><LayoutDashboard/><div><h2>Priorytety wdrożenia</h2><p>A = niezbędne do uruchomienia, B = usprawnienia, C = rozwój po wdrożeniu.</p></div></div>
      <div className="backlog-list">
        {BACKLOG.map((b, idx) => <div key={idx} className={`backlog-item prio-${b.prio}`}>
          <span>Priorytet {b.prio}</span><b>{b.title}</b><small>{b.desc}</small>
        </div>)}
      </div>
    </section>

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
    {renderK03UnfreezeBanner()}
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


    {activeTab === 'pz' && <>
    <section className="card">
      <div className="section-title"><Database/><div><h2>PZ – Zarządzanie FIFO</h2><p>Ręczna korekta dat PZ bez ponownego importu. Po zmianie FIFO przelicza się od początku, ale kartoteki odświeżasz osobnym przyciskiem.</p></div></div>
      {fifoKartotekiDirty && <div className="warning inline-warning"><AlertTriangle size={18}/><div><b>Zmieniono dane FIFO.</b> Kartoteki mogą pokazywać stary układ. Kliknij „Odśwież kartoteki”.</div></div>}
      {message && <p className="message">{message}</p>}
      <div className="actions"><button className="secondary" onClick={loadPzManagementData}><RefreshCcw size={16}/> Odśwież PZ</button><button onClick={recalculateFifoFromPzTab} disabled={fifoRecalculating}><RefreshCcw size={16}/> {fifoRecalculating ? 'FIFO…' : 'Uzupełnij braki FIFO'}</button><button className="secondary" onClick={recalculateFifoFullFromPzTab} disabled={fifoRecalculating}>Pełne FIFO (admin)</button><button className="secondary" onClick={refreshHaccpAfterFifo}><ClipboardList size={16}/> Odśwież kartoteki</button></div>
      <div className="summary"><span>PZ razem: <b>{pzRows.length}</b></span><span>Nieprzypisane: <b>{pzRows.filter(r => r.status_key === 'wolna').length}</b></span><span>Częściowo: <b>{pzRows.filter(r => r.status_key === 'czesciowo').length}</b></span><span>Wykorzystane: <b>{pzRows.filter(r => r.status_key === 'wykorzystana').length}</b></span></div>
      <div className="form-grid compact"><label>Szukaj PZ / partii / produktu<input value={pzSearch} onChange={e => setPzSearch(e.target.value)} placeholder="np. PZ/001 albo Jab/001 albo truskawka" /></label><label>Status<select value={pzStatusFilter} onChange={e => setPzStatusFilter(e.target.value)}><option value="all">Wszystkie</option><option value="wolna">Nieprzypisane</option><option value="czesciowo">Częściowo</option><option value="wykorzystana">Wykorzystane</option></select></label></div>
      <div className="table-wrap small"><table><thead><tr><th>Data PZ</th><th>Nr PZ</th><th>Partia</th><th>Asortyment</th><th>Grupa</th><th>Ilość PZ</th><th>Przypisano</th><th>Pozostało</th><th>Status</th><th>Akcje</th></tr></thead><tbody>{visiblePzRows.map(row => { const editDate = pzEditDates[row.id] ?? String(row.production_date || row.operation_date || '').slice(0, 10); return <tr key={row.id}><td><input className="cell-input pz-date-input" type="date" value={editDate || ''} onChange={e => setPzEditDates(prev => ({ ...prev, [row.id]: e.target.value }))} /></td><td><b>{row.document_no || '-'}</b></td><td>{row.lot_no}</td><td>{row.product_name}</td><td>{row.product_group}</td><td>{Number(row.initial_qty || 0).toLocaleString('pl-PL')}</td><td>{Number(row.allocated_qty || 0).toLocaleString('pl-PL')}</td><td>{Number(row.calculated_remaining_qty || 0).toLocaleString('pl-PL')}</td><td><span className={`pill pz-status-${row.status_key}`}>{row.status_label}</span></td><td className="row-actions"><button className="mini secondary" onClick={() => savePzDate(row)}>Zapisz datę</button></td></tr> })}</tbody></table></div>
    </section>
    <section className="card"><div className="section-title"><ArrowRightLeft/><div><h2>Historia zmian PZ/FIFO</h2><p>Każda zmiana daty PZ jest zapisana. Możesz cofnąć wybraną zmianę jednym przyciskiem.</p></div></div>{pzHistoryRows.length === 0 && <p className="hint">Brak historii albo nie uruchomiono jeszcze SQL v31.</p>}{pzHistoryRows.length > 0 && <div className="table-wrap small"><table><thead><tr><th>Data zmiany</th><th>PZ</th><th>Stara data</th><th>Nowa data</th><th>Akcja</th><th>Powód</th><th>Cofnij</th></tr></thead><tbody>{pzHistoryRows.map(h => <tr key={h.id}><td>{h.created_at ? new Date(h.created_at).toLocaleString('pl-PL') : '-'}</td><td><b>{h.document_no || '-'}</b></td><td>{h.old_date || '-'}</td><td>{h.new_date || '-'}</td><td>{h.action_type || 'change_date'}</td><td>{h.change_reason || '-'}</td><td><button className="mini secondary" onClick={() => undoPzChange(h)}>Cofnij</button></td></tr>)}</tbody></table></div>}</section>
    <section className="card"><div className="section-title"><Database/><div><h2>Historia przeliczeń FIFO</h2><p>Pełne przeliczenia i operacje admina (wymaga SQL v34).</p></div></div>{fifoChangeLog.length === 0 && <p className="hint">Brak wpisów – uruchom migrację <b>2026-v34-fifo-incremental-k03-freeze.sql</b> w Supabase.</p>}{fifoChangeLog.length > 0 && <div className="table-wrap small"><table><thead><tr><th>Data</th><th>Typ</th><th>WZ</th><th>Powód</th><th>Szczegóły</th></tr></thead><tbody>{fifoChangeLog.map(h => <tr key={h.id}><td>{h.created_at ? new Date(h.created_at).toLocaleString('pl-PL') : '-'}</td><td>{h.change_type || '-'}</td><td>{h.wz_no || h.k03_key || '-'}</td><td>{h.change_reason || '-'}</td><td className="hint">{h.after_data ? JSON.stringify(h.after_data).slice(0, 120) : '-'}</td></tr>)}</tbody></table></div>}</section>
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

    <details className="card collapsible">
      <summary><div className="section-title"><Package/><div><h2>Przerób partii (magazyn)</h2><p>Fizyczne przekształcenie partii surowca w produkt gotowy. Decyzja papierowa K03/WZ jest w Dokumentacja → K03.</p></div></div></summary>
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
          <input value={productionOutputQty} onChange={e => setProductionOutputQty(e.target.value)} placeholder="np. 4800" />
        </label>
      </div>
      <div className="actions"><button className="ghost" onClick={calculateProductionOutputQty}>Oblicz wg uzysku</button><button className="secondary" onClick={createProductionConversion}>Utwórz przerób</button></div>
      <p className="hint">Tworzy nową partię produktu gotowego i wpisy K06/K07. Formularz K03 tworzysz osobno przy WZ.</p>
    </details>

    <details className="card collapsible">
      <summary><div className="section-title"><ShieldCheck/><div><h2>Zmiana numeru partii (admin)</h2><p>Tylko administrator, z potwierdzeniem i historią.</p></div></div></summary>
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
    </details>

    <section className="card">
      <div className="section-title"><ArrowRightLeft/><div><h2>Stany partii i FIFO</h2><p>Podgląd pozostałych kilogramów z PZ oraz ostatnich rozliczeń WZ/FV według FIFO.</p></div></div>
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
    <div className="docs-hub">
      <header className="docs-hub-head">
        <div className="section-title"><ClipboardList/><div><h2>Dokumentacja HACCP</h2><p>Kartoteki, wykazy, formularze i protokoły w jednym miejscu.</p></div></div>
      </header>

      <nav className="docs-hub-nav">
        {DOCS_HUB_SECTIONS.map(([key, label, desc]) => {
          if (key === 'kartoteki') {
            return (
              <div
                key={key}
                className={`docs-hub-tab-wrap ${docsHubSection === key ? 'active' : ''}`}
                onMouseEnter={() => setDocsFlyoutOpen(true)}
                onMouseLeave={() => setDocsFlyoutOpen(false)}
              >
                <button
                  type="button"
                  className={`docs-hub-tab has-flyout ${docsHubSection === key ? 'active' : ''}`}
                  onClick={() => { setDocsHubSection(key); setDocsFlyoutOpen(v => !v) }}
                >
                  <b>{label}</b><small>{desc}</small>
                </button>
                {docsFlyoutOpen && (
                  <div className="docs-k-flyout">
                    {HACCPCARDS.map(([code, title, cardDesc]) => (
                      <button
                        key={code}
                        type="button"
                        className={docsFilter === code && docsHubSection === 'kartoteki' ? 'active' : ''}
                        onClick={() => selectKartoteka(code)}
                      >
                        <b>{code}</b>
                        <span>{title.replace(/^K[0-9.]+ – /, '')}</span>
                        <small>{cardDesc}</small>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          }
          return (
            <button key={key} type="button" className={docsHubSection === key ? 'docs-hub-tab active' : 'docs-hub-tab'} onClick={() => setDocsHubSection(key)}>
              <b>{label}</b><small>{desc}</small>
            </button>
          )
        })}
      </nav>

      {docsHubSection !== 'kartoteki' && (
        <section className="card docs-placeholder">
          <h3>{DOCS_HUB_SECTIONS.find(s => s[0] === docsHubSection)?.[1]}</h3>
          <p className="hint">Sekcja w przygotowaniu – dokumenty z tej kategorii będą dodawane w kolejnych etapach.</p>
          <div className="doc-progress">{DOCS.filter((_, i) => {
            if (docsHubSection === 'wykazy') return i === 4
            if (docsHubSection === 'formularze') return i === 2
            if (docsHubSection === 'protokoly') return i === 3
            if (docsHubSection === 'specyfikacje') return i === 7
            return false
          }).map(d => <span key={d[0]} className="pill">{d[1]}</span>)}</div>
        </section>
      )}

      {docsHubSection === 'kartoteki' && <>
      {renderK03UnfreezeBanner()}
      <div className="docs-layout">
        {renderDocsSidebar()}
        <div className="docs-main">
      <section className="card docs-panel" id="kartoteki-haccp">
        <div className="docs-main-head">
          <div>
            <h3>{HACCPCARDS.find(c => c[0] === docsFilter)?.[1] || docsFilter}</h3>
            <p className="hint">{HACCPCARDS.find(c => c[0] === docsFilter)?.[2]}</p>
          </div>
          <div className="actions docs-actions">
            <button className="secondary" onClick={() => { loadHaccpDocs(); loadK03TraceData(); loadFifoData() }}><RefreshCcw size={16}/> Odśwież</button>
            {docsFilter === 'K03' && <>
              <button onClick={() => runFifoIncremental(true)} disabled={fifoRecalculating}>{fifoRecalculating ? 'FIFO…' : 'Uzupełnij FIFO'}</button>
              <button className="secondary" onClick={() => runFifoFullRecalculate(true)} disabled={fifoRecalculating}>Pełne FIFO</button>
            </>}
          </div>
        </div>

        {docsFilter === 'K03' && <>
          <details className="docs-k03-wz" open>
            <summary><b>Lista WZ</b> – {filteredWzQueueLines.filter(l => l.status === 'pending').length} oczekuje · {syntheticK03Docs.length} K03</summary>
            {filteredWzQueueLines.length === 0 && !k03Loading && <p className="hint">Brak WZ. Import Excel → Zapisz do Supabase.</p>}
            {filteredWzQueueLines.length > 0 && <div className="table-wrap docs-table-wrap"><table className="docs-table">
              <thead><tr><th>Asortyment</th><th>Data WZ</th><th>Nr WZ</th><th>Ilość</th><th>Status</th><th>Akcje</th></tr></thead>
              <tbody>{filteredWzQueueLines.map(line => {
                const canDecide = line.status === 'pending'
                return <tr key={line.key}>
                  <td><b>{line.product_name}</b></td>
                  <td>{line.wz_date || '-'}</td>
                  <td>{line.document_no || '-'}</td>
                  <td>{Number(line.qty || 0).toLocaleString('pl-PL')} kg</td>
                  <td><span className={line.status === 'frozen' ? 'status ok' : 'pill'}>{wzStatusLabel(line.status)}</span></td>
                  <td className="row-actions">
                    {canDecide && <>
                      <button className="mini" onClick={() => openK03WzModal(line, 'przerob')}>Przerób</button>
                      <button className="mini secondary" onClick={() => openK03WzModal(line, 'bez_przerobu')}>Bez przerobu</button>
                    </>}
                    {line.k03Form && <button className="mini secondary" onClick={() => setSelectedHaccpDoc({ groupPreview: true, group: { key: line.formId, type: 'K03', product: line.product_name, docs: [line.k03Form] } })}><Eye size={14}/></button>}
                    {(line.status === 'k03_ready' || line.status === 'legacy_auto') && !line.frozen && <button className="mini danger" onClick={() => revertK03Line(line)}>Cofnij</button>}
                  </td>
                </tr>
              })}</tbody>
            </table></div>}
          </details>
        </>}

        {docsFilter === 'K01.1' && renderK011Section()}
        {MANUAL_HACCP_FORMS[docsFilter] && renderManualHaccpEntrySection()}

        {!['K01.1', 'K04.1', 'K05'].includes(docsFilter) && <>
          {haccpMonthlyGroups.length === 0 && docsFilter === 'K03' && <p className="hint">Brak kartotek K03 – wybierz WZ powyżej.</p>}
          {haccpMonthlyGroups.length === 0 && docsFilter === 'K04' && <p className="hint">Brak K04 – przypisz partie w Magazyn → CP3.</p>}
          {haccpMonthlyGroups.length === 0 && docsFilter === 'K07' && <p className="hint">Brak K07 – wpisy po przerobie partii (Magazyn → Przerób partii).</p>}
          {haccpMonthlyGroups.length === 0 && docsFilter === 'K06' && <p className="hint">Brak K06 – auto po produkcji lub ręczny wpis poniżej.</p>}
          {haccpMonthlyGroups.length === 0 && !['K03','K04','K06','K07'].includes(docsFilter) && <p className="hint">Brak kartotek dla filtrów.</p>}

          {haccpMonthlyGroups.length > 0 && <div className="table-wrap docs-table-wrap"><table className="docs-table">
            <thead><tr>
              {docsFilter === 'K03'
                ? <><th>Data WZ</th><th>Nr WZ</th><th>Partia</th><th>Produkt</th><th>WZ kg</th><th>PZ kg</th><th>Status</th><th>FIFO</th><th>Podpis</th><th>Akcje</th></>
                : <><th>Okres</th><th>Produkt / komora</th><th>Wpisy</th><th>N</th><th>Akcje</th></>}
            </tr></thead>
            <tbody>{haccpMonthlyGroups.map(g => {
              const doc = g.docs[0]
              if (docsFilter === 'K03' && doc) {
                const saleQty = Number(doc.qty || 0)
                const pzQty = Number(doc.data?.rawTotal || 0)
                const fifoOk = doc.data?.quantitiesMatch !== false && Number(doc.data?.shortage || 0) <= 0
                return <tr key={g.key} className={doc.frozen ? 'row-frozen' : ''}>
                  <td>{doc.document_date || '-'}</td>
                  <td><b>{doc.document_no || '-'}</b></td>
                  <td>{doc.lot_no || '-'}</td>
                  <td>{doc.product_name || g.product}</td>
                  <td>{saleQty.toLocaleString('pl-PL')}</td>
                  <td>{pzQty.toLocaleString('pl-PL')}</td>
                  <td>{doc.frozen ? <span className="status ok">Zamrożony</span> : <span className="pill">Roboczy</span>}</td>
                  <td><span className={fifoOk ? 'status ok' : 'status danger'}>{fifoOk ? 'OK' : '!'}</span></td>
                  <td>
                    <select className="mini-select" value={doc.signed_by_operator || ''} onChange={e => setK03GroupEmployee(doc, e.target.value)}>
                      <option value="">—</option>
                      {employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}
                    </select>
                  </td>
                  <td className="row-actions">
                    <button className="mini secondary" onClick={() => setSelectedHaccpDoc({ groupPreview: true, group: g })} title="Otwórz / edytuj"><Eye size={14}/></button>
                    <button className="mini secondary" onClick={() => printHaccpGroup(g)} title="Druk"><Printer size={14}/></button>
                    <button className="mini secondary" onClick={() => exportHaccpGroupExcel(g)} title="Excel">XLS</button>
                  </td>
                </tr>
              }
              return <tr key={g.key}>
                <td>{periodLabel(g)}</td>
                <td>{g.product}{g.chamber ? ` / ${g.chamber}` : ''}</td>
                <td>{g.docs.length}</td>
                <td>{g.docs.filter(d => d.status === 'N').length || '—'}</td>
                <td className="row-actions">
                  <button className="mini secondary" onClick={() => setSelectedHaccpDoc({ groupPreview: true, group: g })}><Eye size={14}/> Otwórz</button>
                  <button className="mini secondary" onClick={() => printHaccpGroup(g)}><Printer size={14}/></button>
                  <button className="mini secondary" onClick={() => exportHaccpGroupExcel(g)}>XLS</button>
                </td>
              </tr>
            })}</tbody>
          </table></div>}
        </>}
      </section>

      {(frozenKartoteki.length > 0 || k03WorkflowHistory.length > 0) && (
        <section className="card docs-frozen-panel">
          {frozenKartoteki.length > 0 && <>
            <h3>Zamrożone kartoteki K03 ({frozenKartoteki.length})</h3>
            <p className="hint">Kompletne K03 zamrażają się automatycznie przy utworzeniu. Odmrożenie tylko ręczne – np. po imporcie nowych PZ.</p>
            <div className="frozen-list">
              {frozenKartoteki.map(item => (
                <div key={item.group.key} className="frozen-item">
                  <span><b>{item.type}</b> {item.label}</span>
                  <small>{item.sub}</small>
                  <button className="mini secondary" onClick={() => setSelectedHaccpDoc({ groupPreview: true, group: item.group })}>Otwórz</button>
                  <button className="mini secondary" onClick={() => unfreezeK03Document(item.group.docs[0])}>Odmroź</button>
                </div>
              ))}
            </div>
          </>}
          {k03WorkflowHistory.length > 0 && (
            <details className="docs-history">
              <summary>Historia decyzji K03/WZ ({k03WorkflowHistory.length})</summary>
              <div className="table-wrap docs-table-wrap"><table className="docs-table compact">
                <thead><tr><th>Data</th><th>WZ</th><th>Produkt</th><th>Akcja</th><th>Powód</th></tr></thead>
                <tbody>{k03WorkflowHistory.slice(0, 30).map(h => <tr key={h.id}>
                  <td>{h.created_at ? new Date(h.created_at).toLocaleString('pl-PL') : '-'}</td>
                  <td>{h.wz_no || '-'}</td>
                  <td>{h.product_name || '-'}</td>
                  <td>{h.change_type || '-'}</td>
                  <td>{h.change_reason || '-'}</td>
                </tr>)}</tbody>
              </table></div>
            </details>
          )}
        </section>
      )}
        </div>
      </div>
      </>}
    </div>
    {selectedHaccpDoc && renderHaccpPreview(selectedHaccpDoc)}
    {renderK03WzModal()}
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
