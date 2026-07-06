import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Upload, Database, FileText, Package, Printer, ShieldCheck, AlertTriangle, RefreshCcw, Warehouse, ArrowRightLeft, Eye, Trash2, Settings, ClipboardList, LayoutDashboard, History, LogOut } from 'lucide-react'
import { supabase, isSupabaseConfigured } from './supabaseClient'
import { readAgromarExcel, classifyOperation } from './excelImport'
import { loadK03Forms, mergeK03Overrides, buildK03FormsFromExcelRows, buildK03FormsFromImportPreview, isSaleOperation, K03_ENGINE_VERSION, buildK03PaperData, buildK03PrintHtml, buildK03ExcelRows, loadK03Snapshots, mergeK03Snapshots, saveK03Snapshot, applyK03DocEdits } from './k03Engine'
import { loadWzQueue, previewK03Workflow, generateK03Workflow, revertK03Workflow, unfreezeK03Workflow, resyncOpenK03FromFifo, unfreezeAndResyncK03ByWzMonth, suggestFrozenK03UnfreezeAfterImport, K03_WZ_ENGINE_VERSION } from './k03WzEngine'
import { recalculateFifoIncremental, recalculateFifoFullProtected, frozenKeysFromSnapshots, frozenOperationIdsFromSnapshots, countIncompleteSales } from './fifoEngine'
import { HACCP_FORMS_VERSION, buildSyntheticK04DocsFromTrace, buildSyntheticK07DocsFromTrace, buildSyntheticK06DocsFromTrace, buildSyntheticK06DocsFromK03, buildK06InsertPayload, buildK07InsertPayload, getLiveK04Doc, getLiveK06Doc, getLiveK07Doc, buildK04MonthlyHtml, buildK06MonthlyHtml, buildK07MonthlyHtml, buildManualMonthlyHtml, buildManualExcelRows, buildK04ExcelRows, buildK06ExcelRows, buildK07ExcelRows, MANUAL_HACCP_FORMS, normalizePn as formNormalizePn, normalizeK06Data, normalizeK07Data, k04TempForProductName, isDirectToSaleProduct, isIndustrialApple, isPeelingApple } from './haccpFormsEngine'
import { buildSyntheticK01DocsFromTrace, buildK01InsertPayload } from './k01Engine'
import { computeDashboardCompliance, complianceStatusLabel, complianceStatusClass } from './dashboardComplianceEngine'
import { WYKAZY_CARDS, WYKAZY_ENGINE_VERSION } from './wykazyEngine'
import { RAPORTY_CARDS, RAPORTY_ENGINE_VERSION } from './raportyEngine'
import {
  R01_ENGINE_VERSION, R01_HEADER, R01_MCD_OPTIONS, loadR01Columns, saveR01Columns, buildR01MonthPayloads,
  buildR01PeriodGroups, buildR01PrintHtml, buildR01ExcelRows, sortR01Docs, r01ColumnsFromDocs, r01CleaningForDoc,
  r01McdDisplay, formatR01PlDate, buildR01CalendarRows, buildR01SingleDayPayload, r01MakeColumn,
  defaultR01Cleaning, normalizeMcd, mergeR01ColumnsWithDefaults, r01MissingDefaultColumnLabels
} from './r01Engine'
import {
  R02_ENGINE_VERSION, R02_HEADER, R02_MCD_OPTIONS, loadR02Columns, saveR02Columns, buildR02MonthPayloads,
  buildR02PeriodGroups, buildR02PrintHtml, buildR02ExcelRows, sortR02Docs, r02ColumnsFromDocs, r02CleaningForDoc,
  r02McdDisplay, formatR02PlDate, buildR02CalendarRows, buildR02SingleDayPayload, r02MakeColumn,
  defaultR02Cleaning, normalizeMcd as normalizeR02Mcd
} from './r02Engine'
import {
  R13_ENGINE_VERSION, R13_HEADER, loadR13Columns, saveR13Columns, buildR13MonthPayloads, buildR13PeriodGroups,
  buildR13PrintHtml, buildR13ExcelRows, sortR13Docs, r13DocStatus, r13ColumnsFromDocs, r13ChecksForDoc,
  r13CheckDisplay, formatR13PlDate, buildR13CalendarRows, buildR13SingleDayPayload, r13MakeColumn,
  isSundayDate, defaultR13Checks
} from './r13Engine'
import {
  W03_HEADER, W03_FREQ_KEYS, sortW03Docs, buildW03InsertPayload,
  buildW03SeedPayloads, buildW03PrintHtml, buildW03ExcelRows, loadW03Meta, saveW03Meta, w03Freq
} from './w03Engine'
import {
  sortW06Docs, buildW06InsertPayload, buildW06PrintHtml, buildW06ExcelRows,
  parseW06FromPdfFile, parseW06FromExcelFile, isW06ExcelFile, filterNewW06Parties, listW06ImportBatches, w06PartyLabel, w06KindLabel, w06DedupeKey,
  partyToW06NewRow, W06_PARTY_LABELS
} from './w06Engine'
import { buildRMonthlyPeriodGroups, buildRMonthlyPrintHtml, buildRMonthlyExcelRows } from './rMonthlyEngine'
import { isRMonthlyReport } from './rMonthlyConfigs'
import { RMonthlyReportSection, RMonthlyReportPreview } from './RMonthlyReportUI'
import {
  HACCP_DOCS_LOAD_MAX, HACCP_DOC_LIST_SELECT, batchInsertHaccpDocuments, fetchAllHaccpDocuments, mergeHaccpDocs, patchHaccpDocInList
} from './haccpLoadHelpers'
import { R09TrendSection } from './R09TrendUI'
import { LoginScreen } from './LoginScreen'
import { HistorySection } from './HistorySection'
import { UsersAdminSection } from './UsersAdminSection'
import {
  getCurrentSession, loadAppProfile, signOut, isAdmin, isMagazynier, canDelete, confirmDelete, canSeeTab, canSeeDocsHubSection, authDisplayName
} from './authEngine'
import { auditActor, auditDeleteHaccpDocument, auditDeleteHaccpDocuments, auditDeleteGeneric, auditUpdateHaccpDocument, logAudit } from './auditEngine'
import { FORMULARZE_CARDS, FORMULARZE_ENGINE_VERSION } from './formularzeEngine'
import { PROTOKOLY_CARDS, PROTOKOLY_ENGINE_VERSION } from './protokolyEngine'
import { SPECYFIKACJE_CARDS, SPECYFIKACJE_ENGINE_VERSION } from './specyfikacjeEngine'
import { getHaccpDocForm, buildHubDocGroups, hubPeriodLabel, buildDocumentHtml } from './haccpDocRegistry'
import { importPdfForDocType, PDF_IMPORT_VERSION, PDF_IMPORT_DOC_TYPES } from './pdfImportEngine'
import * as XLSX from 'xlsx'
import './style.css'

const PRODUCTS = [
  ['Malina pulpa', 'Mp'], ['Porzeczka czarna', 'Pcz'], ['Porzeczka czarna pulpa', 'Pczp'], ['Porzeczka czerwona', 'Pk'], ['Porzeczka czerwona pulpa', 'Pkp'], ['Truskawka', 'T'],
  ['Truskawka z szypułką', 'Tsz'], ['Aronia', 'A'], ['Śliwka', 'S'], ['Wiśnia', 'W'],
  ['Malina klasa I', 'M1'], ['Malina extra', 'Mex'], ['Jabłko obierka', 'Jabobier'], ['Jabłko na obierkę', 'Jabobier'], ['Jabłko przemysłowe', 'Jab']
]

const DOCS_HUB_SECTIONS = [
  ['kartoteki', 'Kartoteki', 'K01–K07 karty kontrolne HACCP'],
  ['raporty', 'Raporty', 'R00–R13'],
  ['wykazy', 'Wykazy', 'W01–W10'],
  ['formularze', 'Formularze', 'F01–F03'],
  ['protokoly', 'Protokoły', 'PR01–PR08'],
  ['specyfikacje', 'Specyfikacje', 'S01–S09']
]

const DOCS_FILTERS_STORAGE_KEY = 'agro-mar-docs-filters-v1'
const K01_DEFAULT_EMPLOYEE_KEY = 'agro-mar-k01-default-employee'
const K02_DEFAULT_EMPLOYEE_KEY = 'agro-mar-k02-default-employee'

const WORKFLOW_PILL_LABELS = {
  do_zatwierdzenia: 'Do zatwierdzenia',
  nieprzerobione: 'Nieprzerobione',
  przerobione: 'Po przerobie',
  bez_przerobu: 'Bez przerobu',
  czesciowo: 'Częściowo',
  zamrozone: 'Zamrożony'
}

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
  const skipAuth = import.meta.env.VITE_SKIP_AUTH === 'true'
  const [authProfile, setAuthProfile] = useState(skipAuth ? { role: 'admin', display_name: 'Tryb dev', email: 'dev@local', is_active: true } : null)
  const [authSession, setAuthSession] = useState(null)
  const [authReady, setAuthReady] = useState(skipAuth)
  const [haccpBusy, setHaccpBusy] = useState(false)
  const [importDeleting, setImportDeleting] = useState(false)
  const loadedForUserRef = useRef(null)
  const haccpLoadInFlightRef = useRef(null)
  const userRole = authProfile?.role || 'magazynier'
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
  const [activeTab, setActiveTab] = useState(skipAuth ? 'dashboard' : 'kartoteki')
  const [dashboardMonth, setDashboardMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [importRows, setImportRows] = useState([])
  const [importPreview, setImportPreview] = useState([])
  const [haccpDocs, setHaccpDocs] = useState([])
  const [docsFilter, setDocsFilter] = useState('K01')
  const [docsWykazFilter, setDocsWykazFilter] = useState('W01')
  const [docsRaportFilter, setDocsRaportFilter] = useState('R00')
  const [docsFormularzFilter, setDocsFormularzFilter] = useState('F01')
  const [docsProtokolFilter, setDocsProtokolFilter] = useState('PR01')
  const [docsSpecFilter, setDocsSpecFilter] = useState('S01')
  const [docsHubSection, setDocsHubSection] = useState('kartoteki')
  const [docsFlyoutOpen, setDocsFlyoutOpen] = useState(false)
  const [docsWykazFlyoutOpen, setDocsWykazFlyoutOpen] = useState(false)
  const [docsRaportFlyoutOpen, setDocsRaportFlyoutOpen] = useState(false)
  const [docsFormularzFlyoutOpen, setDocsFormularzFlyoutOpen] = useState(false)
  const [docsProtokolFlyoutOpen, setDocsProtokolFlyoutOpen] = useState(false)
  const [docsSpecFlyoutOpen, setDocsSpecFlyoutOpen] = useState(false)
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
  const [defaultK01Employee, setDefaultK01Employee] = useState(() => {
    try { return localStorage.getItem(K01_DEFAULT_EMPLOYEE_KEY) || '' } catch { return '' }
  })
  const [k02Overrides, setK02Overrides] = useState({})
  const [k04Overrides, setK04Overrides] = useState({})
  const [k06Overrides, setK06Overrides] = useState({})
  const [defaultK02Employee, setDefaultK02Employee] = useState(() => {
    try { return localStorage.getItem(K02_DEFAULT_EMPLOYEE_KEY) || '' } catch { return '' }
  })
  const [k07Overrides, setK07Overrides] = useState({})
  const [defaultK04Employee, setDefaultK04Employee] = useState('')
  const [defaultR13Employee, setDefaultR13Employee] = useState('')
  const [r13NewMonth, setR13NewMonth] = useState(new Date().toISOString().slice(0, 7))
  const [r13ColumnDefs, setR13ColumnDefs] = useState(() => loadR13Columns())
  const [r13NewColumnLabel, setR13NewColumnLabel] = useState('')
  const [defaultR01Employee, setDefaultR01Employee] = useState('')
  const [r01NewMonth, setR01NewMonth] = useState(new Date().toISOString().slice(0, 7))
  const [r01ColumnDefs, setR01ColumnDefs] = useState(() => loadR01Columns())
  const [r01NewColumnLabel, setR01NewColumnLabel] = useState('')
  const [defaultR02Employee, setDefaultR02Employee] = useState('')
  const [r02NewMonth, setR02NewMonth] = useState(new Date().toISOString().slice(0, 7))
  const [r02ColumnDefs, setR02ColumnDefs] = useState(() => loadR02Columns())
  const [r02NewColumnLabel, setR02NewColumnLabel] = useState('')
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
  const [auxPdfPreview, setAuxPdfPreview] = useState('')
  const [auxPdfImporting, setAuxPdfImporting] = useState(false)
  const [auxPdfInputKey, setAuxPdfInputKey] = useState(0)
  const [k011PdfLineItems, setK011PdfLineItems] = useState([])
  const [manualPdfName, setManualPdfName] = useState('')
  const [manualPdfPreview, setManualPdfPreview] = useState('')
  const [manualPdfImporting, setManualPdfImporting] = useState(false)
  const [manualPdfInputKey, setManualPdfInputKey] = useState(0)
  const [w03Meta, setW03Meta] = useState(() => loadW03Meta())
  const [w03NewRow, setW03NewRow] = useState(() => ({
    object_name: '',
    freq_after_use: '',
    freq_daily: '',
    freq_weekly: '',
    freq_monthly: '',
    freq_bimonthly: ''
  }))
  const [w06PdfImporting, setW06PdfImporting] = useState(false)
  const [w06PdfPreview, setW06PdfPreview] = useState('')
  const [w06PdfInputKey, setW06PdfInputKey] = useState(0)
  const [w06PdfFileName, setW06PdfFileName] = useState('')
  const [w06PdfStagedParties, setW06PdfStagedParties] = useState([])
  const [w06NewRow, setW06NewRow] = useState({
    party_type: 'supplier',
    supplier_kind: 'raw',
    company_name: '',
    nip: '',
    address: '',
    item_name: ''
  })
  const [pzRows, setPzRows] = useState([])
  const [pzHistoryRows, setPzHistoryRows] = useState([])
  const [pzEditDates, setPzEditDates] = useState({})
  const [pzSearch, setPzSearch] = useState('')
  const [pzStatusFilter, setPzStatusFilter] = useState('all')
  const [fifoKartotekiDirty, setFifoKartotekiDirty] = useState(false)
  const [k03BulkMonth, setK03BulkMonth] = useState(new Date().toISOString().slice(0, 7))
  const docsFiltersHydrated = useRef(false)
  const docsFiltersSkipSave = useRef(true)
  const docsHubNavRef = useRef(null)

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


  function activeDocsCode() {
    if (docsHubSection === 'wykazy') return docsWykazFilter
    if (docsHubSection === 'raporty') return docsRaportFilter
    if (docsHubSection === 'formularze') return docsFormularzFilter
    if (docsHubSection === 'protokoly') return docsProtokolFilter
    if (docsHubSection === 'specyfikacje') return docsSpecFilter
    return docsFilter
  }

  function getDocFormCfg(type) {
    return getHaccpDocForm(type)
  }

  function activeHubCards() {
    if (docsHubSection === 'wykazy') return WYKAZY_CARDS
    if (docsHubSection === 'raporty') return RAPORTY_CARDS
    if (docsHubSection === 'formularze') return FORMULARZE_CARDS
    if (docsHubSection === 'protokoly') return PROTOKOLY_CARDS
    if (docsHubSection === 'specyfikacje') return SPECYFIKACJE_CARDS
    return []
  }

  function closeHubFlyouts(except) {
    if (except !== 'kartoteki') setDocsFlyoutOpen(false)
    if (except !== 'wykazy') setDocsWykazFlyoutOpen(false)
    if (except !== 'raporty') setDocsRaportFlyoutOpen(false)
    if (except !== 'formularze') setDocsFormularzFlyoutOpen(false)
    if (except !== 'protokoly') setDocsProtokolFlyoutOpen(false)
    if (except !== 'specyfikacje') setDocsSpecFlyoutOpen(false)
  }

  /** Klik w zakładkę – otwiera listę pod-zakładek i trzyma ją otwartą do wyboru lub kliknięcia poza menu. */
  function openHubTab(section) {
    if (!canSeeDocsHubSection(authProfile, section)) return
    setDocsHubSection(section)
    closeHubFlyouts(null)
    if (section === 'kartoteki') setDocsFlyoutOpen(true)
    else if (section === 'wykazy') setDocsWykazFlyoutOpen(true)
    else if (section === 'raporty') setDocsRaportFlyoutOpen(true)
    else if (section === 'formularze') setDocsFormularzFlyoutOpen(true)
    else if (section === 'protokoly') setDocsProtokolFlyoutOpen(true)
    else if (section === 'specyfikacje') setDocsSpecFlyoutOpen(true)
  }

  useEffect(() => {
    function onDocPointerDown(e) {
      if (!docsHubNavRef.current?.contains(e.target)) closeHubFlyouts(null)
    }
    document.addEventListener('mousedown', onDocPointerDown)
    return () => document.removeEventListener('mousedown', onDocPointerDown)
  }, [])

  function lastDayOfMonth(yearMonth) {
    const [y, m] = String(yearMonth || '').split('-').map(Number)
    if (!y || !m) return ''
    return new Date(y, m, 0).toISOString().slice(0, 10)
  }

  function goToComplianceForm(code) {
    const ym = dashboardMonth
    setDocsDateFrom(`${ym}-01`)
    setDocsDateTo(lastDayOfMonth(ym))
    setActiveTab('kartoteki')
    if (code === 'K01.1') {
      selectKartoteka('K01.1')
    } else if (code.startsWith('K')) {
      selectKartoteka(code)
    } else if (code.startsWith('R')) {
      selectRaport(code)
    } else if (code.startsWith('W')) {
      selectWykaz(code)
    }
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


  const syntheticK03Docs = useMemo(() => mergeK03Overrides(k03FormsRaw, k03Overrides), [k03FormsRaw, k03Overrides])

  const formsTraceContext = useMemo(() => ({
    lots: stockRows,
    allocations: formsTrace.allocations || [],
    operations: formsTrace.operations || []
  }), [stockRows, formsTrace])

  const syntheticK04Docs = useMemo(
    () => buildSyntheticK04DocsFromTrace(formsTraceContext, k04Overrides, syntheticK03Docs),
    [formsTraceContext, k04Overrides, syntheticK03Docs]
  )
  const syntheticK07Docs = useMemo(() => buildSyntheticK07DocsFromTrace(formsTraceContext, k07Overrides, haccpDocs), [formsTraceContext, k07Overrides, haccpDocs])
  const syntheticK06Docs = useMemo(() => buildSyntheticK06DocsFromTrace(formsTraceContext, haccpDocs), [formsTraceContext, haccpDocs])
  const syntheticK06FromK03 = useMemo(
    () => buildSyntheticK06DocsFromK03(syntheticK03Docs, haccpDocs, k06Overrides),
    [syntheticK03Docs, haccpDocs, k06Overrides]
  )
  const mergedK06Docs = useMemo(() => {
    const fromDb = (haccpDocs || []).filter(d => d.document_type === 'K06')
    const dbK03Keys = new Set(fromDb.map(d => d.data?.k03_key).filter(Boolean))
    const dbLotIds = new Set(fromDb.map(d => d.lot_id).filter(Boolean))
    const extraFromLots = syntheticK06Docs.filter(d => d.lot_id && !dbLotIds.has(d.lot_id))
    const extraFromK03 = syntheticK06FromK03.filter(d => !dbK03Keys.has(d.data?.k03_key))
    return [...fromDb, ...extraFromLots, ...extraFromK03].sort((a, b) =>
      String(a.document_date || '').localeCompare(String(b.document_date || '')) ||
      String(a.lot_no || '').localeCompare(String(b.lot_no || ''))
    )
  }, [haccpDocs, syntheticK06Docs, syntheticK06FromK03])
  const mergedK07Docs = useMemo(() => {
    const fromDb = (haccpDocs || []).filter(d => d.document_type === 'K07')
    const dbOpIds = new Set(fromDb.map(d => d.data?.operation_id || d.operation_id).filter(Boolean))
    const extraSynthetic = syntheticK07Docs.filter(d => {
      const opId = d.data?.operation_id || d.operation_id
      return opId ? !dbOpIds.has(opId) : !fromDb.some(x => x.id === d.id)
    })
    return [...fromDb, ...extraSynthetic].sort((a, b) =>
      String(a.document_date || '').localeCompare(String(b.document_date || '')) ||
      String(a.lot_no || '').localeCompare(String(b.lot_no || ''))
    )
  }, [haccpDocs, syntheticK07Docs])

  const dashboardSyntheticK02 = useMemo(() => buildSyntheticK02Docs(haccpDocs), [haccpDocs, k02Overrides])

  const dashboardCompliance = useMemo(() => {
    const year = String(dashboardMonth).slice(0, 4)
    return computeDashboardCompliance({
      yearMonth: dashboardMonth,
      haccpDocs,
      haccpDocsK01: haccpDocs.filter(d => d.document_type === 'K01'),
      syntheticK02Docs: dashboardSyntheticK02,
      syntheticK04Docs,
      mergedK06Docs,
      mergedK07Docs,
      wzQueueLines,
      stockRows,
      operations: formsTrace.operations || [],
      auxCount: auxRows.filter(r => String(r.delivery_date || '').slice(0, 4) === year).length
    })
  }, [dashboardMonth, haccpDocs, dashboardSyntheticK02, syntheticK04Docs, mergedK06Docs, mergedK07Docs, wzQueueLines, stockRows, formsTrace, auxRows])

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

  function workflowPillClass(tag) {
    const map = {
      do_zatwierdzenia: 'wf-pill wf-approval',
      nieprzerobione: 'wf-pill wf-pending',
      przerobione: 'wf-pill wf-done',
      bez_przerobu: 'wf-pill wf-bypass',
      czesciowo: 'wf-pill wf-partial',
      zamrozone: 'wf-pill wf-frozen'
    }
    return map[tag] || 'wf-pill'
  }

  function workflowPillLabel(tag) {
    return WORKFLOW_PILL_LABELS[tag] || tag
  }

  function getDocsFilterSnapshot() {
    return {
      docsDateFrom,
      docsDateTo,
      docsWorkflowFilter,
      haccpSearch,
      haccpStatusFilter,
      k03AssortmentFilter
    }
  }

  function applyDocsFilterSnapshot(snap = {}) {
    setDocsDateFrom(snap.docsDateFrom || '')
    setDocsDateTo(snap.docsDateTo || '')
    setDocsWorkflowFilter(snap.docsWorkflowFilter || 'all')
    setHaccpSearch(snap.haccpSearch || '')
    setHaccpStatusFilter(snap.haccpStatusFilter || 'all')
    setK03AssortmentFilter(snap.k03AssortmentFilter || 'all')
  }

  function persistDocsFilters(code, snap) {
    try {
      const all = JSON.parse(localStorage.getItem(DOCS_FILTERS_STORAGE_KEY) || '{}')
      all[code] = snap
      localStorage.setItem(DOCS_FILTERS_STORAGE_KEY, JSON.stringify(all))
    } catch { /* ignore quota / private mode */ }
  }

  function selectKartoteka(code) {
    if (code !== docsFilter) {
      persistDocsFilters(docsFilter, getDocsFilterSnapshot())
      try {
        const all = JSON.parse(localStorage.getItem(DOCS_FILTERS_STORAGE_KEY) || '{}')
        applyDocsFilterSnapshot(all[code] || {})
      } catch {
        applyDocsFilterSnapshot({})
      }
    }
    setDocsFilter(code)
    setDocsHubSection('kartoteki')
    closeHubFlyouts(null)
    setDocsFlyoutOpen(false)
    if (code === 'K03') loadK03TraceData()
    if (getDocFormCfg(code)) resetManualHaccpForm(code)
  }

  function renderDocsDateFilters() {
    return <>
      <label>Od<input type="date" value={docsDateFrom} onChange={e => setDocsDateFrom(e.target.value)} /></label>
      <label>Do<input type="date" value={docsDateTo} onChange={e => setDocsDateTo(e.target.value)} /></label>
      {(docsDateFrom || docsDateTo) && (
        <button type="button" className="mini secondary docs-clear-dates" onClick={() => { setDocsDateFrom(''); setDocsDateTo('') }}>Pokaż wszystko</button>
      )}
      {!docsDateFrom && !docsDateTo && <p className="hint sidebar-hint">Domyślnie widoczne są wszystkie daty.</p>}
    </>
  }

  function selectHubDoc(code, section, setFilter) {
    setFilter(code)
    setDocsHubSection(section)
    closeHubFlyouts(null)
    resetManualHaccpForm(code)
  }

  function selectWykaz(code) {
    selectHubDoc(code, 'wykazy', setDocsWykazFilter)
  }

  function selectRaport(code) {
    selectHubDoc(code, 'raporty', setDocsRaportFilter)
  }

  function selectFormularz(code) {
    selectHubDoc(code, 'formularze', setDocsFormularzFilter)
  }

  function selectProtokol(code) {
    selectHubDoc(code, 'protokoly', setDocsProtokolFilter)
  }

  function selectSpec(code) {
    selectHubDoc(code, 'specyfikacje', setDocsSpecFilter)
  }

  function renderHubManualSidebar(filterStats = {}) {
    const code = activeDocsCode()
    const cfg = getDocFormCfg(code)
    const cards = activeHubCards()
    return <aside className="docs-sidebar">
      <div className="docs-sidebar-head">
        <span className="docs-sidebar-k">{code}</span>
        <small>{cards.find(c => c[0] === code)?.[2] || ''}</small>
      </div>
      <div className="docs-sidebar-block">
        <h4>Zakres dat</h4>
        {renderDocsDateFilters()}
      </div>
      <div className="docs-sidebar-block">
        <h4>Szukaj</h4>
        <label>Szukaj<input value={haccpSearch} onChange={e => setHaccpSearch(e.target.value)} placeholder="nazwa, numer, symbol…" /></label>
        <label>Status P/N
          <select value={haccpStatusFilter} onChange={e => setHaccpStatusFilter(e.target.value)}>
            <option value="all">Wszystkie</option>
            <option value="P">P – prawidłowe</option>
            <option value="N">N – niezgodność</option>
          </select>
        </label>
      </div>
      {cfg && <p className="hint sidebar-hint">
        {cfg.layout === 'document' ? 'Dokument wielopolowy – każdy zapis to osobny protokół / specyfikacja.' :
          cfg.periodMode === 'register' ? 'Rejestr ciągły – wpisy z całego okresu (filtr dat opcjonalny).' :
            cfg.periodMode === 'single' ? 'Kartoteka produktu – wersje specyfikacji / dokumentu.' :
              cfg.periodMode === 'year' ? 'Kartoteki roczne – grupowanie wg roku daty wpisu.' :
                'Kartoteki miesięczne – grupowanie wg miesiąca daty wpisu.'}
      </p>}
      <div className="docs-sidebar-counter">
        <span className="docs-counter-main"><strong>{filterStats.filteredDocs ?? 0}</strong> z <strong>{filterStats.totalDocs ?? 0}</strong></span>
        <span className="docs-counter-label">wpisów</span>
        {filterStats.filtersActive && <span className="docs-counter-badge">Filtry aktywne</span>}
      </div>
      <div className="docs-sidebar-stats">
        <span><b>{filterStats.filteredGroups ?? 0}</b> kartotek</span>
        <span><b>{filterStats.filteredDocs ?? 0}</b> wpisów widocznych</span>
      </div>
    </aside>
  }

  function renderDocsSidebar(filterStats = {}) {
    const isK03 = docsFilter === 'K03'
    const isK02 = docsFilter === 'K02'
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
        {renderDocsDateFilters()}
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

      {isK02 && <div className="docs-sidebar-block">
        <h4>Podpis kontrolującego</h4>
        <label>Pracownik
          <select value={defaultK02Employee} onChange={e => {
            const v = e.target.value
            setDefaultK02Employee(v)
            try { localStorage.setItem(K02_DEFAULT_EMPLOYEE_KEY, v) } catch (_) {}
          }}>
            <option value="">—</option>
            {employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}
          </select>
        </label>
        <button type="button" className="mini secondary" onClick={() => {
          const groups = haccpMonthlyGroups.filter(g => g.type === 'K02')
          if (!groups.length) { setMessage('Brak kartotek K02 w bieżącym filtrze.'); return }
          groups.forEach(g => setEmployeeForVisibleK02Group(g, defaultK02Employee, true))
        }}>Uzupełnij puste podpisy (wszystkie kartoteki)</button>
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

      <div className="docs-sidebar-counter">
        <span className="docs-counter-main"><strong>{filterStats.filteredDocs ?? 0}</strong> z <strong>{filterStats.totalDocs ?? haccpCount(docsFilter)}</strong></span>
        <span className="docs-counter-label">wpisów kartoteki</span>
        {filterStats.filtersActive && <span className="docs-counter-badge">Filtry aktywne</span>}
      </div>

      {isK03 && (
        <div className="docs-sidebar-counter docs-sidebar-counter-secondary">
          <span className="docs-counter-main"><strong>{filterStats.filteredWz ?? 0}</strong> z <strong>{filterStats.totalWz ?? 0}</strong></span>
          <span className="docs-counter-label">pozycji WZ</span>
        </div>
      )}

      <div className="docs-sidebar-stats">
        <span><b>{haccpNonconformityCount(docsFilter)}</b> N łącznie</span>
        <span><b>{haccpPendingCount(docsFilter)}</b> bez podpisu</span>
        <span><b>{filterStats.filteredGroups ?? 0}</b> kartotek w tabeli</span>
      </div>
    </aside>
  }

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
      if (!matchesDocsDateRange(doc.document_date)) continue
      items.push({
        type: 'K03',
        label: `${doc.document_no || '-'} · ${doc.product_name || ''}`,
        sub: doc.lot_no || doc.document_date || '',
        group: { key: doc.id, type: 'K03', product: doc.product_name, docs: [doc] }
      })
    }
    return items.sort((a, b) => String(b.group.docs[0]?.document_date || '').localeCompare(String(a.group.docs[0]?.document_date || '')))
  }, [syntheticK03Docs, docsDateFrom, docsDateTo])

  const k03BulkMonthStats = useMemo(() => {
    const month = String(k03BulkMonth || '').slice(0, 7)
    const inMonth = (wzQueueLines || []).filter(l => String(l.wz_date || '').slice(0, 7) === month)
    return {
      total: inMonth.length,
      frozen: inMonth.filter(l => l.frozen || l.status === 'frozen').length,
      ready: inMonth.filter(l => !l.frozen && l.status !== 'frozen' && l.status !== 'pending').length,
      pending: inMonth.filter(l => l.status === 'pending').length
    }
  }, [wzQueueLines, k03BulkMonth])

  function setK03GroupEmployee(doc, employeeName) {
    patchK03Document(doc, { signed_by_operator: employeeName })
  }

  function patchK03Document(doc, patch) {
    if (!doc?.id) return
    const current = k03Overrides[doc.id] || {}
    const rawRowPatches = patch.rawRowPatches
      ? { ...(current.rawRowPatches || {}), ...patch.rawRowPatches }
      : current.rawRowPatches
    const mergedOverride = {
      ...current,
      ...patch,
      ...(rawRowPatches ? { rawRowPatches } : {})
    }
    setK03Overrides(prev => ({ ...prev, [doc.id]: mergedOverride }))

    const mergedDoc = applyK03DocEdits(doc, mergedOverride)
    const toSave = {
      ...mergedDoc,
      data: {
        ...mergedDoc.data,
        k03_edits: {
          lot_no: mergedDoc.lot_no,
          wz_date: mergedDoc.data?.wz_date || mergedDoc.document_date,
          rawRowPatches: mergedOverride.rawRowPatches || null
        }
      }
    }

    setSelectedHaccpDoc(prev => {
      if (!prev?.groupPreview) return prev
      const group = prev.group
      if (!group?.docs?.some(d => d.id === doc.id)) return prev
      return {
        ...prev,
        group: {
          ...group,
          docs: group.docs.map(d => d.id === doc.id ? toSave : d)
        }
      }
    })

    if (supabase) {
      saveK03Snapshot(supabase, toSave, { freeze: doc.frozen === true, userRole: userRole }).catch(err => {
        console.warn('K03 save', err)
      })
    }
  }

  function patchK03RawRow(doc, rowIndex, field, value) {
    patchK03Document(doc, { rawRowPatches: { [rowIndex]: { [field]: value } } })
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
    if (!ensureCanDelete()) return
    if (line.frozen || line.status === 'frozen') {
      setMessage('Nie można cofnąć zamrożonego K03 – najpierw odmroź kartotekę.')
      return
    }
    if (!confirmDelete(`Decyzję K03 dla WZ ${line.document_no} / ${line.product_name}.\n\nPozycja wróci do kolejki WZ.`)) return
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
            <p className="hint">FIFO dobiera tylko PZ z datą ≤ data przerobu. Późniejsze PZ nie są przypisywane.</p>
          </>}
          {mode === 'bez_przerobu' && <>
            <label>Czy surowiec był magazynowany (K02)?
              <select value={k03WzModal.rawStored ? 'tak' : 'nie'} onChange={e => setK03WzModal(m => ({ ...m, rawStored: e.target.value === 'tak' }))}>
                <option value="nie">Nie – gotowiec / prosto na samochód</option>
                <option value="tak">Tak – wymaga K02</option>
              </select>
            </label>
            <p className="hint">FIFO dobiera tylko PZ z datą ≤ data WZ. Późniejsze PZ nie są przypisywane.</p>
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
        {mismatch && preview && <p className="status danger">
          Brak wystarczającego surowca: WZ {Number(preview.saleQty || 0).toLocaleString('pl-PL')} kg, przypisano PZ {rawTotal.toLocaleString('pl-PL')} kg
          {Number(preview.shortage || 0) > 0 ? ` – brakuje ${Number(preview.shortage).toLocaleString('pl-PL')} kg` : ''}.
          {Number(preview.excludedFuturePzQty || 0) > 0 ? ` PZ z późniejszą datą (${Number(preview.excludedFuturePzQty).toLocaleString('pl-PL')} kg) pominięto.` : ''}
        </p>}
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
        [field]: value
      }
    }))
  }

  async function commitK07Override(doc, field, value) {
    setK07Override(doc, field, value)
    return saveK07DocumentField(doc, { [field]: value })
  }

  async function saveK07DocumentField(doc, patch = {}) {
    if (!supabase || !doc) return null
    try {
      const live = getLiveK07Doc(doc, { ...(k07Overrides[doc.id] || {}), ...patch })
      const opId = live.data?.operation_id || live.operation_id
      const existing = opId
        ? (haccpDocs || []).find(d => d.document_type === 'K07' && (d.operation_id === opId || d.data?.operation_id === opId))
        : null
      let workingDoc = existing || doc

      if ((doc.synthetic || String(doc.id).startsWith('K07-')) && !existing) {
        const { data: inserted, error } = await supabase.from('haccp_documents').insert(buildK07InsertPayload(live)).select('*').single()
        if (error) throw error
        workingDoc = inserted
        setK07Overrides(prev => {
          const next = { ...prev }
          delete next[doc.id]
          return next
        })
      } else {
        const base = existing || doc
        const nextData = normalizeK07Data({ ...(base.data || {}), ...patch }, base)
        const status = formNormalizePn(nextData.stan_sita) === 'N' ? 'N' : 'P'
        const signed = patch.podpis_kontrolujacego !== undefined
          ? patch.podpis_kontrolujacego
          : (base.signed_by_operator || nextData.podpis_kontrolujacego || '')
        const payload = {
          data: nextData,
          status,
          product_name: nextData.surowiec || base.product_name,
          lot_no: nextData.numer_partii || base.lot_no,
          signed_by_operator: signed || null,
          updated_at: new Date().toISOString()
        }
        const { error } = await supabase.from('haccp_documents').update(payload).eq('id', base.id)
        if (error) throw error
        workingDoc = { ...base, ...payload }
        if (doc.id !== base.id) {
          setK07Overrides(prev => {
            const next = { ...prev }
            delete next[doc.id]
            return next
          })
        }
      }
      mergeHaccpDoc(workingDoc.id, workingDoc)
      return workingDoc
    } catch (err) {
      setMessage(`K07: błąd zapisu – ${err.message}`)
      return null
    }
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

  async function setEmployeeForVisibleK07Group(group, employeeName, onlyEmpty = false) {
    if (!group || !employeeName) return
    const docs = (group.docs || []).filter(d => !onlyEmpty || !(d.signed_by_operator || d.data?.podpis_kontrolujacego))
    if (!docs.length) { setMessage(onlyEmpty ? 'Nie ma pustych podpisów K07.' : 'Brak wpisów K07.'); return }
    if (!supabase) { setMessage('Brak bazy – podpis K07 wymaga Supabase.'); return }
    try {
      for (const doc of docs) {
        await saveK07DocumentField(doc, { podpis_kontrolujacego: employeeName })
      }
      await loadHaccpDocs()
      setMessage(`Ustawiono podpis K07 dla ${docs.length} wpisów.`)
    } catch (err) {
      setMessage(`Błąd podpisu K07: ${err.message}`)
    }
  }

  async function saveR13Cell(doc, patch = {}, signedBy) {
    if (!supabase || !doc?.id) return
    const nextData = { ...(doc.data || {}), ...patch }
    if (patch.checks) nextData.checks = { ...(doc.data?.checks || {}), ...patch.checks }
    const columns = r13ColumnsFromDocs([doc])
    const payload = {
      data: nextData,
      status: r13DocStatus({ ...doc, data: nextData }, columns),
      updated_at: new Date().toISOString()
    }
    if (signedBy !== undefined) payload.signed_by_operator = signedBy
    try {
      const { error } = await supabase.from('haccp_documents').update(payload).eq('id', doc.id)
      if (error) throw error
      await loadHaccpDocs()
    } catch (err) {
      setMessage(`R13: błąd zapisu – ${err.message}`)
    }
  }

  async function setR13GlassCheck(doc, columnId, value, columns) {
    const cols = columns || r13ColumnsFromDocs([doc])
    const checks = r13ChecksForDoc(doc, cols)
    const nextVal = value === '' ? '' : formNormalizePn(value)
    await saveR13Cell(doc, { checks: { ...checks, [columnId]: nextVal } })
  }

  async function setR13RowAllP(doc, columns) {
    const cols = columns || r13ColumnsFromDocs([doc])
    await saveR13Cell(doc, { checks: defaultR13Checks(cols, 'P') })
  }

  async function updateR13DocsColumns(group, nextColumns, fillNewWithP = true) {
    if (!supabase || !group?.docs?.length) return
    saveR13Columns(nextColumns)
    setR13ColumnDefs(nextColumns)
    try {
      for (const doc of group.docs) {
        const oldChecks = r13ChecksForDoc(doc, r13ColumnsFromDocs([doc]))
        const sunday = doc.data?.is_day_off || isSundayDate(doc.document_date)
        const checks = {}
        for (const col of nextColumns) {
          if (oldChecks[col.id] !== undefined && oldChecks[col.id] !== '') checks[col.id] = oldChecks[col.id]
          else checks[col.id] = sunday ? '' : (fillNewWithP ? 'P' : '')
        }
        const { error } = await supabase.from('haccp_documents').update({
          data: { ...(doc.data || {}), glass_columns: nextColumns, checks },
          status: r13DocStatus({ ...doc, data: { ...doc.data, checks } }, nextColumns),
          updated_at: new Date().toISOString()
        }).eq('id', doc.id)
        if (error) throw error
      }
      await loadHaccpDocs()
    } catch (err) {
      setMessage(`R13: ${err.message}`)
    }
  }

  async function addR13ColumnToGroup(group, label) {
    if (!ensureCanDelete()) return
    const col = r13MakeColumn(label)
    const cols = [...(group.columns || r13ColumnsFromDocs(group.docs)), col]
    await updateR13DocsColumns(group, cols, true)
    setR13NewColumnLabel('')
    setMessage(`R13: dodano kolumnę „${col.label}”.`)
  }

  async function removeR13ColumnFromGroup(group, columnId) {
    if (!ensureCanDelete()) return
    const allCols = group.columns || r13ColumnsFromDocs(group.docs)
    const removed = allCols.find(c => c.id === columnId)
    const cols = allCols.filter(c => c.id !== columnId)
    if (cols.length < 1) { setMessage('R13: musi zostać co najmniej jedna szyba.'); return }
    if (!confirmDelete(`Kolumnę „${removed?.label || columnId}" z tej kartoteki R13.\n\nTej operacji nie można cofnąć jednym kliknięciem.`)) return
    await updateR13DocsColumns(group, cols, false)
    setMessage('R13: usunięto kolumnę.')
  }

  async function renameR13ColumnInGroup(group, columnId, newLabel) {
    if (!ensureCanDelete()) return
    const label = String(newLabel || '').trim()
    if (!label) return
    const cols = (group.columns || r13ColumnsFromDocs(group.docs)).map(c => c.id === columnId ? { ...c, label } : c)
    await updateR13DocsColumns(group, cols, false)
  }

  async function setEmployeeForVisibleR13Group(group, employeeName, onlyEmpty = false) {
    if (!group || !employeeName) return
    if (!supabase) { setMessage('Brak bazy – podpis R13 wymaga Supabase.'); return }
    const docs = (group.docs || []).filter(d => !onlyEmpty || !(d.signed_by_operator || ''))
    if (!docs.length) { setMessage(onlyEmpty ? 'Nie ma pustych podpisów R13.' : 'Brak wpisów R13.'); return }
    try {
      for (const doc of docs) {
        const { error } = await supabase.from('haccp_documents').update({
          signed_by_operator: employeeName,
          updated_at: new Date().toISOString()
        }).eq('id', doc.id)
        if (error) throw error
      }
      await loadHaccpDocs()
      setMessage(`Ustawiono podpis R13 dla ${docs.length} dni.`)
    } catch (err) {
      setMessage(`R13: ${err.message}`)
    }
  }

  async function createR13MonthKartoteka() {
    if (haccpBusy) return
    if (!supabase) {
      setMessage('R13: brak połączenia z bazą (Supabase).')
      return
    }
    const yearMonth = r13NewMonth
    if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
      setMessage('R13: wybierz rok i miesiąc.')
      return
    }
    const existing = (haccpDocs || []).filter(d => d.document_type === 'R13' && d.data?.month_key === yearMonth)
    if (existing.length && !window.confirm(`Kartoteka R13 za ${yearMonth} już istnieje (${existing.length} wpisów). Utworzyć ponownie (doda kolejne dni)?`)) return
    const payloads = buildR13MonthPayloads(yearMonth, defaultR13Employee, r13ColumnDefs)
    if (!payloads.length) {
      setMessage('R13: brak dni w wybranym miesiącu.')
      return
    }
    const existingDates = new Set(
      (haccpDocs || []).filter(d => d.document_type === 'R13').map(d => d.document_date)
    )
    const toInsert = payloads.filter(p => !existingDates.has(p.document_date))
    if (!toInsert.length) {
      setMessage(`R13: wszystkie dni za ${yearMonth} są już w systemie.`)
      return
    }
    setHaccpBusy(true)
    try {
      const { rows } = await batchInsertHaccpDocuments(supabase, toInsert)
      setHaccpDocs(prev => mergeHaccpDocs(prev, rows))
      const totalDays = payloads.length
      const sundays = payloads.filter(p => p.data?.is_day_off).length
      setMessage(`R13: utworzono kartotekę za ${yearMonth} – ${rows.length} dni (${totalDays - sundays} roboczych z P, ${sundays} niedziel pustych)${defaultR13Employee ? `, podpis: ${defaultR13Employee}` : ''}.`)
    } catch (err) {
      setMessage(`R13: błąd tworzenia – ${err.message}`)
    } finally {
      setHaccpBusy(false)
    }
  }

  async function deleteR13Month(group) {
    if (!supabase || !group?.docs?.length) return
    if (!ensureCanDelete()) return
    if (!confirmDelete(`Całą kartotekę R13 za ${group.period} (${group.docs.length} wpisów).\n\nWpis trafi do historii – administrator może przywrócić.`)) return
    try {
      await auditDeleteHaccpDocuments(supabase, group.docs, getAuditActor(), `R13 ${group.period}`)
      await loadHaccpDocs()
      setSelectedHaccpDoc(null)
      setMessage(`R13: usunięto kartotekę za ${group.period} (zapis w historii).`)
    } catch (err) {
      setMessage(`R13: ${err.message}`)
    }
  }

  async function saveR13DocumentDate(doc, newDate) {
    if (!supabase || !doc?.id || !newDate) return
    const monthKey = doc.data?.month_key || String(doc.document_date || '').slice(0, 7)
    if (!String(newDate).startsWith(monthKey)) {
      setMessage('R13: data musi pozostać w tym samym miesiącu kartoteki.')
      return
    }
    const sunday = isSundayDate(newDate)
    try {
      const columns = r13ColumnsFromDocs([doc])
      const checks = r13ChecksForDoc(doc, columns)
      const { error } = await supabase.from('haccp_documents').update({
        document_date: newDate,
        data: { ...(doc.data || {}), is_day_off: sunday, checks },
        updated_at: new Date().toISOString()
      }).eq('id', doc.id)
      if (error) throw error
      await loadHaccpDocs()
    } catch (err) {
      setMessage(`R13: ${err.message}`)
    }
  }

  function shiftR13NewMonth(delta) {
    const [y, m] = r13NewMonth.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setR13NewMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  async function addMissingR13Day(group, date) {
    if (!supabase || !date) return
    const yearMonth = group.period
    const columns = group.columns || r13ColumnsFromDocs(group.docs)
    const sunday = isSundayDate(date)
    const payload = buildR13SingleDayPayload(yearMonth, date, columns, defaultR13Employee || sortR13Docs(group.docs)[0]?.signed_by_operator || '', sunday)
    try {
      const { error } = await supabase.from('haccp_documents').insert(payload)
      if (error) throw error
      await loadHaccpDocs()
      setMessage(`R13: dodano wpis na ${formatR13PlDate(date)}${sunday ? ' (dzień wolny – uzupełnij ręcznie)' : ''}.`)
    } catch (err) {
      setMessage(`R13: ${err.message}`)
    }
  }

  async function saveR01Cell(doc, patch = {}, signedBy) {
    if (!supabase || !doc?.id) return
    const nextData = { ...(doc.data || {}), ...patch }
    if (patch.cleaning) nextData.cleaning = { ...(doc.data?.cleaning || {}), ...patch.cleaning }
    const payload = {
      data: nextData,
      status: 'P',
      updated_at: new Date().toISOString()
    }
    if (signedBy !== undefined) payload.signed_by_operator = signedBy
    try {
      const { error } = await supabase.from('haccp_documents').update(payload).eq('id', doc.id)
      if (error) throw error
      await loadHaccpDocs()
    } catch (err) {
      setMessage(`R01: błąd zapisu – ${err.message}`)
    }
  }

  async function setR01RoomMcd(doc, columnId, value, columns) {
    const cols = columns || r01ColumnsFromDocs([doc])
    const cleaning = r01CleaningForDoc(doc, cols)
    await saveR01Cell(doc, { cleaning: { ...cleaning, [columnId]: normalizeMcd(value) } })
  }

  async function setR01RowAutoM(doc, columns) {
    const cols = columns || r01ColumnsFromDocs([doc])
    await saveR01Cell(doc, { cleaning: defaultR01Cleaning(cols, false) })
  }

  async function updateR01DocsColumns(group, nextColumns) {
    if (!supabase || !group?.docs?.length) return
    saveR01Columns(nextColumns)
    setR01ColumnDefs(nextColumns)
    try {
      for (const doc of group.docs) {
        const old = r01CleaningForDoc(doc, r01ColumnsFromDocs([doc]))
        const sunday = doc.data?.is_day_off || isSundayDate(doc.document_date)
        const cleaning = {}
        for (const col of nextColumns) {
          cleaning[col.id] = old[col.id] !== undefined && old[col.id] !== '' ? old[col.id] : (sunday ? '' : ((col.auto_m || col.id === 'pom-przyjecia') ? 'M' : ''))
        }
        const { error } = await supabase.from('haccp_documents').update({
          data: { ...(doc.data || {}), room_columns: nextColumns, cleaning },
          updated_at: new Date().toISOString()
        }).eq('id', doc.id)
        if (error) throw error
      }
      await loadHaccpDocs()
    } catch (err) {
      setMessage(`R01: ${err.message}`)
    }
  }

  async function addR01ColumnToGroup(group, label) {
    if (!ensureCanDelete()) return
    const col = r01MakeColumn(label)
    const cols = [...(group.columns || r01ColumnsFromDocs(group.docs)), col]
    await updateR01DocsColumns(group, cols)
    setR01NewColumnLabel('')
    setMessage(`R01: dodano kolumnę „${col.label}”.`)
  }

  async function removeR01ColumnFromGroup(group, columnId) {
    if (!ensureCanDelete()) return
    const allCols = group.columns || r01ColumnsFromDocs(group.docs)
    const removed = allCols.find(c => c.id === columnId)
    const cols = allCols.filter(c => c.id !== columnId)
    if (cols.length < 1) { setMessage('R01: musi zostać co najmniej jeden obiekt.'); return }
    if (!confirmDelete(`Obiekt „${removed?.label || columnId}" z kartoteki R01.\n\nUsunięcie kolumny zmienia układ całej kartoteki.`)) return
    await updateR01DocsColumns(group, cols)
    setMessage('R01: usunięto kolumnę.')
  }

  async function renameR01ColumnInGroup(group, columnId, newLabel) {
    if (!ensureCanDelete()) return
    const label = String(newLabel || '').trim()
    if (!label) return
    const cols = (group.columns || r01ColumnsFromDocs(group.docs)).map(c => c.id === columnId ? { ...c, label } : c)
    await updateR01DocsColumns(group, cols)
  }

  async function setEmployeeForVisibleR01Group(group, employeeName, onlyEmpty = false) {
    if (!supabase || !group || !employeeName) return
    const docs = sortR01Docs(group.docs || []).filter(d => !onlyEmpty || !(d.signed_by_operator || '').trim())
    if (!docs.length) { setMessage(onlyEmpty ? 'Nie ma pustych podpisów R01.' : 'Brak wpisów R01.'); return }
    try {
      for (const doc of docs) {
        const { error } = await supabase.from('haccp_documents').update({
          signed_by_operator: employeeName,
          updated_at: new Date().toISOString()
        }).eq('id', doc.id)
        if (error) throw error
      }
      await loadHaccpDocs()
      setMessage(`Ustawiono podpis R01 dla ${docs.length} dni.`)
    } catch (err) {
      setMessage(`R01: ${err.message}`)
    }
  }

  async function createR01MonthKartoteka() {
    if (haccpBusy) return
    if (!supabase) {
      setMessage('R01: brak połączenia z bazą (Supabase).')
      return
    }
    const yearMonth = r01NewMonth
    if (!yearMonth) {
      setMessage('R01: wybierz rok i miesiąc.')
      return
    }
    const existing = (haccpDocs || []).filter(d => d.document_type === 'R01' && d.data?.month_key === yearMonth)
    if (existing.length && !window.confirm(`Kartoteka R01 za ${yearMonth} już istnieje (${existing.length} wpisów). Utworzyć ponownie (doda kolejne dni)?`)) return
    const payloads = buildR01MonthPayloads(yearMonth, defaultR01Employee, r01ColumnDefs)
    if (!payloads.length) {
      setMessage('R01: brak dni w wybranym miesiącu.')
      return
    }
    const existingDates = new Set(
      (haccpDocs || []).filter(d => d.document_type === 'R01').map(d => d.document_date)
    )
    const toInsert = payloads.filter(p => !existingDates.has(p.document_date))
    if (!toInsert.length) {
      setMessage(`R01: wszystkie dni za ${yearMonth} są już w systemie.`)
      return
    }
    setHaccpBusy(true)
    try {
      const { rows } = await batchInsertHaccpDocuments(supabase, toInsert)
      setHaccpDocs(prev => mergeHaccpDocs(prev, rows))
      const totalDays = payloads.length
      const sundays = payloads.filter(p => p.data?.is_day_off).length
      setMessage(`R01: utworzono kartotekę za ${yearMonth} – ${rows.length} dni (${totalDays - sundays} roboczych z M w przyjęciu surowców, ${sundays} niedziel pustych)${defaultR01Employee ? `, podpis: ${defaultR01Employee}` : ''}.`)
    } catch (err) {
      setMessage(`R01: błąd tworzenia – ${err.message}`)
    } finally {
      setHaccpBusy(false)
    }
  }

  async function deleteR01Month(group) {
    if (!supabase || !group?.docs?.length) return
    if (!ensureCanDelete()) return
    if (!confirmDelete(`Całą kartotekę R01 za ${group.period} (${group.docs.length} wpisów).\n\nWpis trafi do historii.`)) return
    try {
      await auditDeleteHaccpDocuments(supabase, group.docs, getAuditActor(), `R01 ${group.period}`)
      await loadHaccpDocs()
      setSelectedHaccpDoc(null)
      setMessage(`R01: usunięto kartotekę za ${group.period} (zapis w historii).`)
    } catch (err) {
      setMessage(`R01: ${err.message}`)
    }
  }

  async function saveR01DocumentDate(doc, newDate) {
    if (!supabase || !doc?.id || !newDate) return
    const monthKey = doc.data?.month_key || String(doc.document_date || '').slice(0, 7)
    if (!String(newDate).startsWith(monthKey)) {
      setMessage('R01: data musi pozostać w tym samym miesiącu kartoteki.')
      return
    }
    const sunday = isSundayDate(newDate)
    const columns = r01ColumnsFromDocs([doc])
    const cleaning = r01CleaningForDoc(doc, columns)
    try {
      const { error } = await supabase.from('haccp_documents').update({
        document_date: newDate,
        data: { ...(doc.data || {}), is_day_off: sunday, cleaning },
        updated_at: new Date().toISOString()
      }).eq('id', doc.id)
      if (error) throw error
      await loadHaccpDocs()
    } catch (err) {
      setMessage(`R01: ${err.message}`)
    }
  }

  function shiftR01NewMonth(delta) {
    const [y, m] = r01NewMonth.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setR01NewMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  async function addMissingR01Day(group, date) {
    if (!supabase || !date) return
    const yearMonth = group.period
    const columns = group.columns || r01ColumnsFromDocs(group.docs)
    const sunday = isSundayDate(date)
    const payload = buildR01SingleDayPayload(yearMonth, date, columns, defaultR01Employee || sortR01Docs(group.docs)[0]?.signed_by_operator || '', sunday)
    try {
      const { error } = await supabase.from('haccp_documents').insert(payload)
      if (error) throw error
      await loadHaccpDocs()
      setMessage(`R01: dodano wpis na ${formatR01PlDate(date)}${sunday ? ' (dzień wolny – uzupełnij ręcznie)' : ''}.`)
    } catch (err) {
      setMessage(`R01: ${err.message}`)
    }
  }

  function addR01DefaultColumn() {
    const col = r01MakeColumn(r01NewColumnLabel)
    const next = [...r01ColumnDefs, col]
    saveR01Columns(next)
    setR01ColumnDefs(next)
    setR01NewColumnLabel('')
    setMessage(`R01: dodano domyślną kolumnę „${col.label}” (dla nowych kartotek).`)
  }

  function removeR01DefaultColumn(columnId) {
    if (!ensureCanDelete()) return
    const removed = r01ColumnDefs.find(c => c.id === columnId)
    const next = r01ColumnDefs.filter(c => c.id !== columnId)
    if (next.length < 1) { setMessage('R01: musi zostać co najmniej jeden obiekt.'); return }
    if (!confirmDelete(`„${removed?.label || columnId}" z domyślnych obiektów R01.\n\nNowe kartoteki nie będą miały tej kolumny.`)) return
    saveR01Columns(next)
    setR01ColumnDefs(next)
    setMessage('R01: usunięto kolumnę z ustawień domyślnych.')
  }

  async function restoreR01MissingDefaultsForGroup(group) {
    if (!ensureCanDelete()) return
    const current = group.columns || r01ColumnsFromDocs(group.docs)
    const missing = r01MissingDefaultColumnLabels(current)
    if (!missing.length) {
      setMessage('R01: wszystkie obiekty ze wzoru są już w tej kartotece.')
      return
    }
    if (!confirmDelete(`Brakujące obiekty ze wzoru w tej kartotece:\n${missing.join('\n')}`)) return
    const merged = mergeR01ColumnsWithDefaults(current)
    await updateR01DocsColumns(group, merged)
    setMessage(`R01: przywrócono obiekty: ${missing.join(', ')}.`)
  }

  async function restoreAllR01MissingDefaults() {
    if (!ensureCanDelete()) return
    const groups = buildR01PeriodGroups(haccpDocs || [])
    const affected = groups.filter(g => r01MissingDefaultColumnLabels(g.columns || r01ColumnsFromDocs(g.docs)).length > 0)
    if (!affected.length) {
      setMessage('R01: we wszystkich kartotekach są już pełne obiekty ze wzoru.')
      return
    }
    if (!confirmDelete(`Brakujące obiekty ze wzoru w ${affected.length} kartotekach R01.`)) return
    for (const group of affected) {
      const merged = mergeR01ColumnsWithDefaults(group.columns || r01ColumnsFromDocs(group.docs))
      await updateR01DocsColumns(group, merged)
    }
    const nextDefaults = mergeR01ColumnsWithDefaults(loadR01Columns())
    saveR01Columns(nextDefaults)
    setR01ColumnDefs(nextDefaults)
    setMessage(`R01: przywrócono brakujące obiekty w ${affected.length} kartotekach.`)
  }

  async function saveR02Cell(doc, patch = {}, signedBy) {
    if (!supabase || !doc?.id) return
    const nextData = { ...(doc.data || {}), ...patch }
    if (patch.cleaning) nextData.cleaning = { ...(doc.data?.cleaning || {}), ...patch.cleaning }
    const payload = {
      data: nextData,
      status: 'P',
      updated_at: new Date().toISOString()
    }
    if (signedBy !== undefined) payload.signed_by_operator = signedBy
    try {
      const { error } = await supabase.from('haccp_documents').update(payload).eq('id', doc.id)
      if (error) throw error
      mergeHaccpDoc(doc.id, payload)
    } catch (err) {
      setMessage(`R02: błąd zapisu – ${err.message}`)
    }
  }

  async function setR02MachineMcd(doc, columnId, value, columns) {
    const cols = columns || r02ColumnsFromDocs([doc])
    const cleaning = r02CleaningForDoc(doc, cols)
    await saveR02Cell(doc, { cleaning: { ...cleaning, [columnId]: normalizeR02Mcd(value) } })
  }

  async function updateR02DocsColumns(group, nextColumns) {
    if (!supabase || !group?.docs?.length) return
    saveR02Columns(nextColumns)
    setR02ColumnDefs(nextColumns)
    try {
      for (const doc of group.docs) {
        const old = r02CleaningForDoc(doc, r02ColumnsFromDocs([doc]))
        const sunday = doc.data?.is_day_off || isSundayDate(doc.document_date)
        const cleaning = {}
        for (const col of nextColumns) {
          cleaning[col.id] = old[col.id] !== undefined && old[col.id] !== '' ? old[col.id] : (sunday ? '' : (col.auto_m ? 'M' : ''))
        }
        const payload = {
          data: { ...(doc.data || {}), machine_columns: nextColumns, cleaning },
          updated_at: new Date().toISOString()
        }
        const { error } = await supabase.from('haccp_documents').update(payload).eq('id', doc.id)
        if (error) throw error
        mergeHaccpDoc(doc.id, payload)
      }
    } catch (err) {
      setMessage(`R02: ${err.message}`)
    }
  }

  async function addR02ColumnToGroup(group, label) {
    if (!ensureCanDelete()) return
    const col = r02MakeColumn(label)
    const cols = [...(group.columns || r02ColumnsFromDocs(group.docs)), col]
    await updateR02DocsColumns(group, cols)
    setR02NewColumnLabel('')
    setMessage(`R02: dodano kolumnę „${col.label}”.`)
  }

  async function removeR02ColumnFromGroup(group, columnId) {
    if (!ensureCanDelete()) return
    const allCols = group.columns || r02ColumnsFromDocs(group.docs)
    const removed = allCols.find(c => c.id === columnId)
    const cols = allCols.filter(c => c.id !== columnId)
    if (cols.length < 1) { setMessage('R02: musi zostać co najmniej jedna maszyna.'); return }
    if (!confirmDelete(`Kolumnę „${removed?.label || columnId}" z tej kartoteki R02.`)) return
    await updateR02DocsColumns(group, cols)
    setMessage('R02: usunięto kolumnę.')
  }

  async function renameR02ColumnInGroup(group, columnId, newLabel) {
    if (!ensureCanDelete()) return
    const label = String(newLabel || '').trim()
    if (!label) return
    const cols = (group.columns || r02ColumnsFromDocs(group.docs)).map(c => c.id === columnId ? { ...c, label } : c)
    await updateR02DocsColumns(group, cols)
  }

  async function setEmployeeForVisibleR02Group(group, employeeName, onlyEmpty = false) {
    if (!supabase || !group || !employeeName) return
    const docs = sortR02Docs(group.docs || []).filter(d => !onlyEmpty || !(d.signed_by_operator || '').trim())
    if (!docs.length) { setMessage(onlyEmpty ? 'Nie ma pustych podpisów R02.' : 'Brak wpisów R02.'); return }
    try {
      for (const doc of docs) {
        const { error } = await supabase.from('haccp_documents').update({
          signed_by_operator: employeeName,
          updated_at: new Date().toISOString()
        }).eq('id', doc.id)
        if (error) throw error
        mergeHaccpDoc(doc.id, { signed_by_operator: employeeName })
      }
      setMessage(`Ustawiono podpis R02 dla ${docs.length} dni.`)
    } catch (err) {
      setMessage(`R02: ${err.message}`)
    }
  }

  async function createR02MonthKartoteka() {
    if (haccpBusy) return
    if (!supabase) {
      setMessage('R02: brak połączenia z bazą (Supabase).')
      return
    }
    const yearMonth = r02NewMonth
    if (!yearMonth) {
      setMessage('R02: wybierz rok i miesiąc.')
      return
    }
    const existing = (haccpDocs || []).filter(d => d.document_type === 'R02' && d.data?.month_key === yearMonth)
    if (existing.length && !window.confirm(`Kartoteka R02 za ${yearMonth} już istnieje (${existing.length} wpisów). Utworzyć ponownie (doda kolejne dni)?`)) return
    const payloads = buildR02MonthPayloads(yearMonth, defaultR02Employee, r02ColumnDefs)
    if (!payloads.length) {
      setMessage('R02: brak dni w wybranym miesiącu.')
      return
    }
    const existingDates = new Set(
      (haccpDocs || []).filter(d => d.document_type === 'R02').map(d => d.document_date)
    )
    const toInsert = payloads.filter(p => !existingDates.has(p.document_date))
    if (!toInsert.length) {
      setMessage(`R02: wszystkie dni za ${yearMonth} są już w systemie.`)
      return
    }
    setHaccpBusy(true)
    try {
      const { rows } = await batchInsertHaccpDocuments(supabase, toInsert)
      setHaccpDocs(prev => mergeHaccpDocs(prev, rows))
      const totalDays = payloads.length
      const sundays = payloads.filter(p => p.data?.is_day_off).length
      setMessage(`R02: utworzono kartotekę za ${yearMonth} – ${rows.length} dni (${totalDays - sundays} roboczych do uzupełnienia, ${sundays} niedziel pustych)${defaultR02Employee ? `, podpis: ${defaultR02Employee}` : ''}.`)
    } catch (err) {
      setMessage(`R02: błąd tworzenia – ${err.message}`)
    } finally {
      setHaccpBusy(false)
    }
  }

  async function deleteR02Month(group) {
    if (!supabase || !group?.docs?.length) return
    if (!ensureCanDelete()) return
    if (!confirmDelete(`Całą kartotekę R02 za ${group.period} (${group.docs.length} wpisów).\n\nWpis trafi do historii.`)) return
    try {
      await auditDeleteHaccpDocuments(supabase, group.docs, getAuditActor(), `R02 ${group.period}`)
      await loadHaccpDocs()
      setSelectedHaccpDoc(null)
      setMessage(`R02: usunięto kartotekę za ${group.period} (zapis w historii).`)
    } catch (err) {
      setMessage(`R02: ${err.message}`)
    }
  }

  async function saveR02DocumentDate(doc, newDate) {
    if (!supabase || !doc?.id || !newDate) return
    const monthKey = doc.data?.month_key || String(doc.document_date || '').slice(0, 7)
    if (!String(newDate).startsWith(monthKey)) {
      setMessage('R02: data musi pozostać w tym samym miesiącu kartoteki.')
      return
    }
    const sunday = isSundayDate(newDate)
    const columns = r02ColumnsFromDocs([doc])
    const cleaning = r02CleaningForDoc(doc, columns)
    try {
      const payload = {
        document_date: newDate,
        data: { ...(doc.data || {}), is_day_off: sunday, cleaning },
        updated_at: new Date().toISOString()
      }
      const { error } = await supabase.from('haccp_documents').update(payload).eq('id', doc.id)
      if (error) throw error
      mergeHaccpDoc(doc.id, payload)
    } catch (err) {
      setMessage(`R02: ${err.message}`)
    }
  }

  function shiftR02NewMonth(delta) {
    const [y, m] = r02NewMonth.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setR02NewMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  async function addMissingR02Day(group, date) {
    if (!supabase || !date) return
    const yearMonth = group.period
    const columns = group.columns || r02ColumnsFromDocs(group.docs)
    const sunday = isSundayDate(date)
    const payload = buildR02SingleDayPayload(yearMonth, date, columns, defaultR02Employee || sortR02Docs(group.docs)[0]?.signed_by_operator || '', sunday)
    try {
      const { data, error } = await supabase.from('haccp_documents').insert(payload).select(HACCP_DOC_LIST_SELECT).single()
      if (error) throw error
      mergeHaccpDocsBatch(data ? [data] : [])
      setMessage(`R02: dodano wpis na ${formatR02PlDate(date)}${sunday ? ' (dzień wolny – uzupełnij ręcznie)' : ''}.`)
    } catch (err) {
      setMessage(`R02: ${err.message}`)
    }
  }

  function addR02DefaultColumn() {
    const col = r02MakeColumn(r02NewColumnLabel)
    const next = [...r02ColumnDefs, col]
    saveR02Columns(next)
    setR02ColumnDefs(next)
    setR02NewColumnLabel('')
    setMessage(`R02: dodano domyślną kolumnę „${col.label}” (dla nowych kartotek).`)
  }

  function removeR02DefaultColumn(columnId) {
    if (!ensureCanDelete()) return
    const removed = r02ColumnDefs.find(c => c.id === columnId)
    const next = r02ColumnDefs.filter(c => c.id !== columnId)
    if (next.length < 1) { setMessage('R02: musi zostać co najmniej jedna maszyna.'); return }
    if (!confirmDelete(`„${removed?.label || columnId}" z domyślnych maszyn R02.`)) return
    saveR02Columns(next)
    setR02ColumnDefs(next)
    setMessage('R02: usunięto kolumnę z ustawień domyślnych.')
  }

  async function setEmployeeForVisibleK06Group(group, employeeName, onlyEmpty = false) {
    if (!group || !employeeName) return
    const docs = (group.docs || []).filter(d => !onlyEmpty || !d.signed_by_operator)
    if (!docs.length) { setMessage(onlyEmpty ? 'Nie ma pustych podpisów K06.' : 'Brak wpisów K06.'); return }
    if (!supabase) { setMessage('Brak bazy – podpis K06 wymaga Supabase.'); return }
    try {
      for (const doc of docs) {
        if (doc.synthetic || String(doc.id).startsWith('K06-syn-')) {
          const { error } = await supabase.from('haccp_documents').insert(buildK06InsertPayload({ ...doc, signed_by_operator: employeeName, data: { ...normalizeK06Data(doc.data || {}), podpis: employeeName } }))
          if (error) throw error
        } else {
          await supabase.from('haccp_documents').update({ signed_by_operator: employeeName, updated_at: new Date().toISOString() }).eq('id', doc.id)
        }
      }
      await loadHaccpDocs()
      setMessage(`Ustawiono podpis K06 dla ${docs.length} pozycji.`)
    } catch (err) {
      setMessage(`Błąd podpisu K06: ${err.message}`)
    }
  }

  function setEmployeeForVisibleK02Group(group, employeeName, onlyEmpty = false) {
    if (!employeeName?.trim()) { setMessage('Wybierz pracownika z listy.'); return }
    const docs = (group?.docs || [])
    const targets = onlyEmpty
      ? docs.filter(d => !k02FieldValue(getLiveK02Doc(d), 'podpis_kontrolujacego', ''))
      : docs
    if (!targets.length) { setMessage(onlyEmpty ? 'Nie ma pustych podpisów K02.' : 'Brak wpisów K02.'); return }
    for (const doc of targets) setK02Override(doc, 'podpis_kontrolujacego', employeeName.trim())
    setMessage(`Ustawiono podpis K02 dla ${targets.length} pozycji.`)
  }

  function setK06Override(doc, field, value) {
    if (!doc?.id) return
    setK06Overrides(prev => ({
      ...prev,
      [doc.id]: { ...(prev[doc.id] || {}), [field]: value }
    }))
  }

  async function commitK06Override(doc, field, value) {
    if (!doc?.id || !supabase) return
    setK06Override(doc, field, value)
    const ov = { ...(k06Overrides[doc.id] || {}), [field]: value }
    const live = getLiveK06Doc(doc, { [doc.id]: ov })
    try {
      if (doc.synthetic || String(doc.id).startsWith('K06-K03-') || String(doc.id).startsWith('K06-syn-')) {
        const { data: inserted, error } = await supabase.from('haccp_documents').insert(buildK06InsertPayload(live)).select('id').single()
        if (error) throw error
        setK06Overrides(prev => {
          const next = { ...prev }
          delete next[doc.id]
          return next
        })
        await loadHaccpDocs()
        setMessage('K06: zapisano wpis.')
        return
      }
      const patch = {}
      if (field === 'document_date' || field === 'przerob_date') patch.document_date = value
      if (field === 'lot_no') patch.lot_no = value
      if (field === 'product_name') patch.product_name = value
      const k06Data = normalizeK06Data({ ...(live.data || {}), ...(field.startsWith('barwa') || field === 'zapach' || field === 'twardosc_jablko' || field === 'brak_plesni' ? { [field]: value } : {}), przerob_date: field === 'przerob_date' ? value : live.data?.przerob_date })
      const { error } = await supabase.from('haccp_documents').update({
        ...patch,
        data: k06Data,
        updated_at: new Date().toISOString()
      }).eq('id', doc.id)
      if (error) throw error
      await loadHaccpDocs()
    } catch (err) {
      setMessage(`K06: błąd zapisu – ${err.message}`)
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
      signed_by_operator: Object.prototype.hasOwnProperty.call(ov, 'podpis_kontrolujacego') ? ov.podpis_kontrolujacego : ''
    }
  }

  const haccpDocsForFilter = useMemo(() => {
    const q = normalizeText(haccpSearch)
    const sourceDocs = docsFilter === 'K02' ? buildSyntheticK02Docs(haccpDocs)
      : docsFilter === 'K03' ? syntheticK03Docs
      : docsFilter === 'K04' ? syntheticK04Docs
      : docsFilter === 'K06' ? mergedK06Docs
      : docsFilter === 'K07' ? mergedK07Docs
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
  }, [haccpDocs, docsFilter, haccpSearch, haccpStatusFilter, k02Overrides, syntheticK03Docs, syntheticK04Docs, syntheticK07Docs, mergedK06Docs, mergedK07Docs, k03AssortmentFilter, docsDateFrom, docsDateTo, docsWorkflowFilter])


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

  const docsFilterStats = useMemo(() => {
    const filtersActive = Boolean(
      docsDateFrom || docsDateTo || docsWorkflowFilter !== 'all' ||
      haccpSearch.trim() || haccpStatusFilter !== 'all' ||
      (docsFilter === 'K03' && k03AssortmentFilter !== 'all')
    )
    return {
      filteredDocs: haccpDocsForFilter.length,
      totalDocs: haccpCount(docsFilter),
      filteredGroups: haccpMonthlyGroups.length,
      filteredWz: filteredWzQueueLines.length,
      totalWz: wzQueueLines.length,
      filtersActive
    }
  }, [haccpDocsForFilter, haccpMonthlyGroups, filteredWzQueueLines, wzQueueLines, docsFilter, docsDateFrom, docsDateTo, docsWorkflowFilter, haccpSearch, haccpStatusFilter, k03AssortmentFilter, syntheticK03Docs, syntheticK04Docs, mergedK07Docs, mergedK06Docs, haccpDocs])

  const hubManualDocsForFilter = useMemo(() => {
    if (docsHubSection === 'kartoteki') return []
    const code = activeDocsCode()
    const q = normalizeText(haccpSearch)
    return (haccpDocs || [])
      .filter(d => d.document_type === code)
      .filter(d => matchesDocsDateRange(d.document_date))
      .filter(d => haccpStatusFilter === 'all' || d.status === haccpStatusFilter)
      .filter(d => {
        if (!q) return true
        const data = d.data || {}
        return normalizeText([
          d.product_name, d.supplier_name, d.lot_no, d.document_no,
          data.employee_name, data.item_name, data.supplier_name, data.procedure_title,
          data.procedure_code, data.device_name, data.area, data.topic, data.assortment,
          data.protocol_no, data.raw_material, data.packaging_name, data.object_name,
          data.auditors, data.scope, data.crisis_situation, data.subject
        ].join(' ')).includes(q)
      })
  }, [haccpDocs, docsHubSection, docsWykazFilter, docsRaportFilter, docsFormularzFilter, docsProtokolFilter, docsSpecFilter, docsDateFrom, docsDateTo, haccpSearch, haccpStatusFilter])

  const hubManualGroups = useMemo(() => {
    const code = activeDocsCode()
    const cfg = getDocFormCfg(code)
    if (!cfg || docsHubSection === 'kartoteki') return []
    if (code === 'R02') return buildR02PeriodGroups(hubManualDocsForFilter)
    if (code === 'R01') return buildR01PeriodGroups(hubManualDocsForFilter)
    if (code === 'R13') return buildR13PeriodGroups(hubManualDocsForFilter)
    if (isRMonthlyReport(code)) return buildRMonthlyPeriodGroups(code, hubManualDocsForFilter)
    return buildHubDocGroups(hubManualDocsForFilter, code, cfg)
  }, [hubManualDocsForFilter, docsHubSection, docsWykazFilter, docsRaportFilter, docsFormularzFilter, docsProtokolFilter, docsSpecFilter])

  const hubManualFilterStats = useMemo(() => {
    const code = activeDocsCode()
    if (docsHubSection === 'kartoteki') return { filteredDocs: 0, totalDocs: 0, filteredGroups: 0, filtersActive: false }
    const total = (haccpDocs || []).filter(d => d.document_type === code).length
    const filtersActive = Boolean(docsDateFrom || docsDateTo || haccpSearch.trim() || haccpStatusFilter !== 'all')
    return {
      filteredDocs: hubManualDocsForFilter.length,
      totalDocs: total,
      filteredGroups: hubManualGroups.length,
      filtersActive
    }
  }, [hubManualDocsForFilter, hubManualGroups, docsHubSection, docsWykazFilter, docsRaportFilter, docsFormularzFilter, docsProtokolFilter, docsSpecFilter, haccpDocs, docsDateFrom, docsDateTo, haccpSearch, haccpStatusFilter])

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
    if (type === 'K07') return mergedK07Docs.length
    return haccpDocs.filter(d => d.document_type === type).length
  }

  function haccpNonconformityCount(type) {
    if (type === 'K03') return syntheticK03Docs.filter(d => d.status === 'N').length
    if (type === 'K04') return syntheticK04Docs.filter(d => d.status === 'N').length
    if (type === 'K06') return mergedK06Docs.filter(d => d.status === 'N').length
    if (type === 'K07') return mergedK07Docs.filter(d => d.status === 'N').length
    return haccpDocs.filter(d => d.document_type === type && d.status === 'N').length
  }

  function haccpPendingCount(type) {
    if (type === 'K03') return syntheticK03Docs.filter(d => !d.signed_by_operator).length
    if (type === 'K04') return syntheticK04Docs.filter(d => !d.signed_by_operator).length
    if (type === 'K06') return mergedK06Docs.filter(d => !d.signed_by_operator).length
    if (type === 'K07') return mergedK07Docs.filter(d => !d.signed_by_operator).length
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
    if (doc.synthetic && doc.document_type === 'K06') {
      const live = getLiveK06Doc(doc, k06Overrides[doc.id] ? { [doc.id]: k06Overrides[doc.id] } : {})
      const { data: inserted, error } = await supabase.from('haccp_documents').insert(buildK06InsertPayload(live)).select('id').single()
      if (error) { setMessage(`K06: nie udało się zapisać wpisu auto: ${error.message}`); return }
      workingDoc = { ...live, id: inserted.id, synthetic: false }
      await loadHaccpDocs()
    }
    if ((doc.synthetic || String(doc.id).startsWith('K07-')) && doc.document_type === 'K07') {
      const { data: inserted, error } = await supabase.from('haccp_documents').insert(buildK07InsertPayload(getLiveK07Doc(doc, k07Overrides[doc.id] || {}))).select('id').single()
      if (error) { setMessage(`K07: nie udało się zapisać wpisu auto: ${error.message}`); return }
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
      const k06Data = doc.document_type === 'K06' ? normalizeK06Data(nextData) : nextData
      const finalStatus = doc.document_type === 'K06'
        ? (['barwa', 'zapach', 'twardosc_jablko', 'brak_plesni'].some(k => k06Data[k] === 'N') ? 'N' : 'P')
        : newStatus
      const { error } = await supabase
        .from('haccp_documents')
        .update({ data: doc.document_type === 'K06' ? k06Data : nextData, status: finalStatus, updated_at: new Date().toISOString() })
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
      const updated = { ...doc, data: doc.document_type === 'K06' ? k06Data : nextData, status: finalStatus }
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
    const cfg = getDocFormCfg(group.type)
    const html = group.type === 'K01' ? buildK01MonthlyHtml(group)
      : group.type === 'K03' ? buildK03MonthlyHtml(group)
      : group.type === 'K04' ? buildK04MonthlyHtml(group, escapeHtml)
      : group.type === 'K06' ? buildK06MonthlyHtml(group, escapeHtml)
      : group.type === 'K07' ? buildK07MonthlyHtml(group, escapeHtml)
      : cfg?.layout === 'document' && (group.docs || []).length === 1
        ? buildDocumentHtml(group.docs[0], cfg)
      : group.type === 'W03'
        ? buildW03PrintHtml(group.docs || [], w03Meta, escapeHtml)
      : group.type === 'W06'
        ? buildW06PrintHtml(group.docs || [], escapeHtml)
      : group.type === 'R02'
        ? buildR02PrintHtml(group, escapeHtml)
      : group.type === 'R01'
        ? buildR01PrintHtml(group, escapeHtml)
      : group.type === 'R13'
        ? buildR13PrintHtml(group, escapeHtml)
      : isRMonthlyReport(group.type)
        ? buildRMonthlyPrintHtml(group.type, group, escapeHtml)
      : cfg ? buildManualMonthlyHtml(group, escapeHtml, cfg)
      : buildK02MonthlyHtml(group)
    printHtmlInIframe(html)
  }

  function printHaccpDocument(doc) {
    const cfg = getDocFormCfg(doc?.document_type)
    if (!cfg || !doc) return
    const html = cfg.layout === 'document'
      ? buildDocumentHtml(doc, cfg)
      : buildManualMonthlyHtml({ type: doc.document_type, period: String(doc.document_date || '').slice(0, 7), docs: [doc] }, escapeHtml, cfg)
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
    } else if (group.type === 'K06') {
      rows.push(...buildK06ExcelRows(group))
    } else if (group.type === 'K07') {
      rows.push(...buildK07ExcelRows(group))
    } else if (group.type === 'W03') {
      rows.push(...buildW03ExcelRows(docs, w03Meta))
    } else if (group.type === 'W06') {
      rows.push(...buildW06ExcelRows(docs))
    } else if (group.type === 'R02') {
      rows.push(...buildR02ExcelRows(group))
    } else if (group.type === 'R01') {
      rows.push(...buildR01ExcelRows(group))
    } else if (group.type === 'R13') {
      rows.push(...buildR13ExcelRows(group))
    } else if (isRMonthlyReport(group.type)) {
      rows.push(...buildRMonthlyExcelRows(group.type, group))
    } else if (getDocFormCfg(group.type)) {
      rows.push(...buildManualExcelRows(group, getDocFormCfg(group.type)))
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
            <select value={defaultK01Employee} onChange={e => {
              const v = e.target.value
              setDefaultK01Employee(v)
              try { localStorage.setItem(K01_DEFAULT_EMPLOYEE_KEY, v) } catch (_) {}
            }}>
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
        <div className="no-print employee-signature-row" style={{marginBottom: '10px'}}>
          <label>Podpis kontrolujący (zbiorczo)
            <select value={defaultK02Employee} onChange={e => {
              const v = e.target.value
              setDefaultK02Employee(v)
              try { localStorage.setItem(K02_DEFAULT_EMPLOYEE_KEY, v) } catch (_) {}
            }}>
              <option value="">Wybierz pracownika</option>
              {employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}
            </select>
          </label>
          <button className="secondary" onClick={() => setEmployeeForVisibleK02Group(group, defaultK02Employee, false)}>Zastosuj do wszystkich</button>
          <button className="secondary" onClick={() => setEmployeeForVisibleK02Group(group, defaultK02Employee, true)}>Uzupełnij puste</button>
        </div>
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
        <p className="hint no-print">K02 uzupełnia się automatycznie: jeden pomiar dziennie o 9:15. Podpis wybierasz ręcznie – nie uzupełnia się sam. Dla jabłka, truskawki, wiśni, porzeczek i aronii temperatura 2°C; dla malin 1°C.</p>
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
        <p className="hint no-print">K04: wpisy od daty przerobu (K03) do daty WZ. Tylko partie w CP3 (jabłko przemysłowe → K04.1).</p>
      </div>
    }

    if (group.type === 'K06') {
      const maxRows = Math.max(11, docs.length)
      return <div className="monthly-paper k02-original k06-original">
        <div className="no-print employee-signature-row" style={{marginBottom: '10px'}}>
          <label>Podpis kontrolującego (zbiorczo)
            <select value={defaultK06Employee} onChange={e => setDefaultK06Employee(e.target.value)}>
              <option value="">Wybierz pracownika</option>
              {employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}
            </select>
          </label>
          <button className="secondary" onClick={() => setEmployeeForVisibleK06Group(group, defaultK06Employee, false)}>Zastosuj do wszystkich</button>
          <button className="secondary" onClick={() => setEmployeeForVisibleK06Group(group, defaultK06Employee, true)}>Uzupełnij puste</button>
        </div>
        <table className="k02-head"><tbody>
          <tr>
            <td className="k02-company" rowSpan="2"><b>AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.<br/>24-335 ŁAZISKA,<br/>KOLONIA ŁAZISKA 30<br/>NIP: 7171839598</b></td>
            <td className="k02-title"><b>Karta K06 - Karta oceny jakości gotowego produktu</b></td>
            <td className="k02-meta"><b>Rok:</b> {group.period.slice(0,4)}<br/><b>Miesiąc:</b> {group.period.slice(5,7)}<br/><b>Strona:</b> 1 z 1</td>
          </tr>
          <tr><td></td><td className="k02-version">Wersja I/2024</td></tr>
        </tbody></table>
        <table className="k02-table"><thead><tr>
          <th>Data</th><th>Nazwa towaru</th><th>Numer partii</th><th>Barwa<br/>(P/N)*</th><th>Zapach<br/>(P/N)*</th><th>Twardość (jabłko)<br/>(P/N)*</th><th>Brak oznak pleśni<br/>(P/N)*</th><th>Podpis kontrolującego</th>
        </tr></thead><tbody>
          {Array.from({length: maxRows}).map((_,i) => {
            const baseDoc = docs[i]
            if (!baseDoc) return <tr className="blank-row" key={`k06-blank-${i}`}><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
            const doc = getLiveK06Doc(baseDoc, k06Overrides)
            const d = normalizeK06Data(doc.data || {})
            const pnCell = (field, label) => {
              const val = formNormalizePn(d[field] || 'P')
              return <td className={val==='N'?'pn-n':''} key={field}>
                <select className="mini-select no-print" value={val} onChange={e => editHaccpRowField(doc, field, label, val, { directValue: e.target.value, pn: true })}><option value="P">P</option><option value="N">N</option></select>
                <span className="print-only">{val}</span>
              </td>
            }
            const signed = doc.signed_by_operator || d.podpis || ''
            const wzHint = d.wz_no ? ` · WZ ${d.wz_no}` : ''
            return <tr key={doc.id}>
              <td>
                <input className="cell-input no-print" type="date" defaultValue={doc.document_date} key={`k06-date-${doc.id}-${doc.document_date}`} title="Data przerobu / oceny" onBlur={e => { if (e.target.value && e.target.value !== doc.document_date) void commitK06Override(doc, 'przerob_date', e.target.value) }} />
                <span className="print-only">{doc.document_date}</span>
              </td>
              <td className="left">{doc.product_name}{wzHint ? <small className="hint no-print">{wzHint}</small> : null}</td>
              <td>
                <input className="cell-input no-print" type="text" defaultValue={doc.lot_no || ''} key={`k06-lot-${doc.id}-${doc.lot_no}`} onBlur={e => { if (e.target.value !== (doc.lot_no || '')) void commitK06Override(doc, 'lot_no', e.target.value.trim()) }} />
                <span className="print-only">{doc.lot_no}</span>
              </td>
              {pnCell('barwa', 'Barwa')}
              {pnCell('zapach', 'Zapach')}
              {pnCell('twardosc_jablko', 'Twardość (jabłko)')}
              {pnCell('brak_plesni', 'Brak oznak pleśni')}
              <td>
                <select className="mini-select no-print" value={signed} onChange={e => setDocumentEmployeeFromGroup(doc, e.target.value)}><option value="">Wybierz</option>{employees.map(emp=><option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}</select>
                <span className="print-only">{signed}</span>
              </td>
            </tr>
          })}
        </tbody></table>
        <p className="hint no-print">K06: auto z K03/WZ – produkt gotowy i partia z faktury WZ, data przerobu z K03 (możesz poprawić ręcznie). Domyślnie P we wszystkich polach oceny.</p>
      </div>
    }

    if (group.type === 'K07') {
      const maxRows = Math.max(11, docs.length)
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
            <td className="k02-title"><b>Karta K07 - Karta kontroli stanu sita<br/>na linii do przerobu na pulpę (CCP1)</b></td>
            <td className="k02-meta"><b>Rok:</b> {group.period.slice(0,4)}<br/><b>Miesiąc:</b> {group.period.slice(5,7)}<br/><b>Strona:</b> 1 z 1</td>
          </tr>
          <tr><td className="k02-note">Godzina (kontrolę należy przeprowadzać przed i po zakończeniu procesu rozdrabniania)</td><td className="k02-version">Wersja I/2024</td></tr>
        </tbody></table>
        <table className="k02-table"><thead><tr><th>Data</th><th>Godzina</th><th>Rodzaj przerabianego surowca</th><th>Produkowany numer partii</th><th>Stan sita<br/>(P/N)*</th><th>Podpis kontrolującego</th></tr></thead><tbody>
          {Array.from({length: maxRows}).map((_,i) => {
            const baseDoc = docs[i]
            if (!baseDoc) return <tr className="blank-row" key={`k07-blank-${i}`}><td></td><td></td><td></td><td></td><td></td><td></td></tr>
            const doc = getLiveK07Doc(baseDoc, k07Overrides)
            const d = normalizeK07Data(doc.data || {}, doc)
            const godzina = d.godzina || '12:00'
            const surowiec = d.surowiec || doc.product_name || ''
            const numerPartii = d.numer_partii || doc.lot_no || ''
            const stan = formNormalizePn(d.stan_sita || 'P')
            const signed = doc.signed_by_operator || d.podpis_kontrolujacego || ''
            return <tr key={doc.id}>
              <td>{doc.document_date}</td>
              <td><input className="cell-input no-print" value={godzina} onChange={e=>setK07Override(doc,'godzina',e.target.value)} onBlur={e=>void commitK07Override(doc,'godzina',e.target.value)} /><span className="print-only">{godzina}</span></td>
              <td className="left"><input className="cell-input no-print" value={surowiec} onChange={e=>setK07Override(doc,'surowiec',e.target.value)} onBlur={e=>void commitK07Override(doc,'surowiec',e.target.value)} /><span className="print-only">{surowiec}</span></td>
              <td><input className="cell-input no-print" value={numerPartii} onChange={e=>setK07Override(doc,'numer_partii',e.target.value)} onBlur={e=>void commitK07Override(doc,'numer_partii',e.target.value)} /><span className="print-only">{numerPartii}</span></td>
              <td className={stan==='N'?'pn-n':''}><select className="mini-select no-print" value={stan} onChange={e=>void commitK07Override(doc,'stan_sita',e.target.value)}><option value="P">P</option><option value="N">N</option></select><span className="print-only">{stan}</span></td>
              <td><select className="mini-select no-print" value={signed} onChange={e=>void commitK07Override(doc,'podpis_kontrolujacego',e.target.value)}><option value="">Wybierz</option>{employees.map(emp=><option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}</select><span className="print-only">{signed}</span></td>
            </tr>
          })}
        </tbody></table>
        <p className="hint no-print">K07: wpis przy każdym przerobie – asortyment surowca, data przerobu, godzina 12:00, stan sita P. Wszystkie pola edytowalne; możesz też dodać wpis ręcznie poniżej listy kartotek.</p>
      </div>
    }

    if (group.type === 'W06') {
      const sorted = sortW06Docs(docs)
      return <div className="w06-paper haccp-paper">
        <table className="w06-head"><tbody><tr>
          <td className="w06-company"><b>AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.<br/>NIP: 7171839598</b></td>
          <td className="w06-title"><b>Wykaz W06 – dostawcy i odbiorcy</b></td>
          <td className="w06-meta"><b>Wpisy:</b> {sorted.length}</td>
        </tr></tbody></table>
        <table className="w06-table"><thead><tr>
          <th>Lp.</th><th>Typ</th><th>Dane firmy</th><th>NIP</th><th>Towar</th><th>Źr.</th>
        </tr></thead><tbody>
          {sorted.map((doc, i) => {
            const d = doc.data || {}
            return <tr key={doc.id}>
              <td>{i + 1}</td><td>{w06PartyLabel(doc)}</td>
              <td className="left">{d.supplier_name || d.company_name || ''}</td>
              <td>{d.nip || ''}</td>
              <td className="left">{d.item_name || doc.product_name || ''}</td>
              <td>{d.source_doc_kind || ''}</td>
            </tr>
          })}
        </tbody></table>
      </div>
    }

    if (group.type === 'W03') {
      const sorted = sortW03Docs(docs)
      return <div className="w03-paper haccp-paper">
        <table className="w03-head"><tbody><tr>
          <td className="w03-company">{W03_HEADER.companyLines.map((l, i) => <span key={i}>{l}{i < W03_HEADER.companyLines.length - 1 && <br/>}</span>)}</td>
          <td className="w03-title"><b>{W03_HEADER.title}</b></td>
          <td className="w03-meta"><b>Wersja</b> {w03Meta.version || W03_HEADER.version}<br/><b>Data wydania:</b> {formatW03PlDate(w03Meta.issueDate || W03_HEADER.issueDate)}<br/><b>Strona:</b> 1 z 1</td>
        </tr></tbody></table>
        <table className="w03-table"><thead>
          <tr><th rowSpan={2}>L.p.</th><th rowSpan={2}>OBIEKT</th><th colSpan={5}>CZĘSTOTLIWOŚĆ WYKONYWANIA PROCESU</th></tr>
          <tr>{W03_FREQ_KEYS.map(([, label]) => <th key={label}>{label}</th>)}</tr>
        </thead><tbody>
          {sorted.map((doc, i) => <tr key={doc.id}>
            <td>{i + 1}</td>
            <td className="left">{doc.data?.object_name || doc.product_name || ''}</td>
            {W03_FREQ_KEYS.map(([key]) => <td key={key}>{w03Freq(doc, key)}</td>)}
          </tr>)}
        </tbody></table>
        <p className="w03-legend"><b>M</b> – mycie, <b>C</b> – czyszczenie, <b>D</b> – dezynfekcja</p>
        <div className="w03-footer"><span><b>Zatwierdził:</b> {w03Meta.approvedBy || ''}</span><span><b>Data i podpis:</b> {formatW03PlDate(w03Meta.approvalDate)}</span></div>
      </div>
    }

    if (isRMonthlyReport(group.type)) {
      return <RMonthlyReportPreview
        group={group}
        supabase={supabase}
        employees={employees}
        haccpDocs={haccpDocs}
        loadHaccpDocs={loadHaccpDocs}
        mergeHaccpDoc={mergeHaccpDoc}
        setMessage={setMessage}
        defaultEmployee=""
        allowDelete={isAdmin(authProfile)}
        onAuditDelete={async (docs, reason) => {
          if (!ensureCanDelete()) return
          await auditDeleteHaccpDocuments(supabase, docs, getAuditActor(), reason)
        }}
      />
    }

    if (getDocFormCfg(group.type) && !['K06', 'K07'].includes(group.type) && !['r13', 'r01', 'r02', 'monthly'].includes(getDocFormCfg(group.type).layout)) {
      const cfg = getDocFormCfg(group.type)
      if (cfg.layout === 'document') {
        const fields = (cfg.documentFields || cfg.fields).filter(f => f.key !== 'signed_by' && f.key !== 'document_date')
        const periodMeta = cfg.periodMode === 'year' ? <><b>Rok:</b> {String(group.period || '').slice(0, 4)}</>
          : cfg.periodMode === 'register' || cfg.periodMode === 'single' ? <><b>Rejestr</b></>
          : <><b>Rok:</b> {group.period?.slice?.(0, 4) || '—'}<br/><b>Miesiąc:</b> {group.period?.slice?.(5, 7) || '—'}</>
        return <div className="monthly-paper haccp-doc-preview">
          {docs.map(doc => <div key={doc.id || doc.document_no} className="doc-sheet" style={{ marginBottom: '24px' }}>
            <table className="k011-head"><tbody><tr>
              <td className="k011-company"><b>AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.<br/>24-335 ŁAZISKA, KOLONIA ŁAZISKA 30<br/>NIP: 7171839598</b></td>
              <td className="k011-title"><b>{cfg.title}</b></td>
              <td className="k011-meta">{periodMeta}<br/><b>Data:</b> {doc.document_date || '—'}</td>
            </tr></tbody></table>
            <table className="k011-table doc-fields-table"><tbody>
              {fields.map(f => {
                const val = f.data === false ? (doc[f.key] ?? '') : (doc.data?.[f.key] ?? '')
                return <tr key={f.key}><td className="left" style={{ width: '34%', fontWeight: 'bold' }}>{f.label}</td><td className="left" style={{ whiteSpace: 'pre-wrap' }}>{String(val || '')}</td></tr>
              })}
            </tbody></table>
            <p><b>Podpis:</b> {doc.signed_by_operator || '—'}</p>
            <div className="no-print row-actions" style={{ marginTop: '8px' }}>
              <button className="mini secondary" onClick={() => { editManualHaccpEntry(doc); setSelectedHaccpDoc(null) }}>Edytuj</button>
              <button className="mini secondary" onClick={() => printHaccpDocument(doc)}><Printer size={14}/> Druk</button>
              {isAdmin(authProfile) && !doc.synthetic && <button className="mini danger" onClick={() => deleteManualHaccpEntry(doc)}>Usuń</button>}
            </div>
          </div>)}
        </div>
      }
      const pnFields = new Set(['stan_opakowania', 'barwa', 'zapach', 'twardosc_jablko', 'brak_plesni', 'stan_sita', 'status', 'approval', 'rating', 'result', 'active', 'qualified'])
      const isK06 = false
      const periodMeta = cfg.periodMode === 'year'
        ? <><b>Rok:</b> {String(group.period || '').slice(0, 4)}</>
        : cfg.periodMode === 'register' || cfg.periodMode === 'single'
          ? <><b>Rejestr / dokument</b></>
        : <><b>Rok:</b> {group.period.slice(0,4)}<br/><b>Miesiąc:</b> {group.period.slice(5,7)}</>
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
        <table className="k011-head"><tbody><tr><td className="k011-company"><b>AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.<br/>24-335 ŁAZISKA, KOLONIA ŁAZISKA 30<br/>NIP: 7171839598</b></td><td className="k011-title"><b>{cfg.title}</b></td><td className="k011-meta">{periodMeta}</td></tr></tbody></table>
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

    if (group.type === 'R02') {
      const r02Docs = sortR02Docs(group.docs || [])
      const period = String(group.period || r02Docs[0]?.data?.month_key || '')
      const year = period.slice(0, 4)
      const month = period.slice(5, 7)
      const columns = group.columns || r02ColumnsFromDocs(r02Docs)
      const calendar = buildR02CalendarRows(period, r02Docs)
      const renderMcdCell = (doc, col) => {
        const cleaning = r02CleaningForDoc(doc, columns)
        const val = cleaning[col.id] || ''
        const display = r02McdDisplay(val)
        return <td key={col.id}>
          <select className="mini-select no-print" value={val} onChange={e => setR02MachineMcd(doc, col.id, e.target.value, columns)}>
            {R02_MCD_OPTIONS.map(o => <option key={o || 'empty'} value={o}>{o || '—'}</option>)}
          </select>
          <span className="print-only">{display}</span>
        </td>
      }
      return <div className="monthly-paper r02-paper r13-paper">
        <div className="no-print employee-signature-row" style={{ marginBottom: '10px' }}>
          <label>Podpis uzupełniającego (zbiorczo)
            <select value={defaultR02Employee} onChange={e => setDefaultR02Employee(e.target.value)}>
              <option value="">Wybierz pracownika</option>
              {employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}
            </select>
          </label>
          <button className="secondary" onClick={() => setEmployeeForVisibleR02Group(group, defaultR02Employee, false)}>Zastosuj do wszystkich</button>
          <button className="secondary" onClick={() => setEmployeeForVisibleR02Group(group, defaultR02Employee, true)}>Uzupełnij puste</button>
          {isAdmin(authProfile) && <button className="secondary danger" onClick={() => deleteR02Month(group)}>Usuń kartotekę</button>}
          <span className="hint">Niedziele na różowo – domyślnie puste, uzupełnij ręcznie M/C/D przy każdej maszynie.</span>
        </div>
        {isAdmin(authProfile) && <div className="no-print r13-columns-panel">
          <b>Maszyny / urządzenia w tej kartotece:</b>
          <div className="r13-columns-list">
            {columns.map(col => (
              <span key={col.id} className="r13-column-chip">
                <input className="cell-input r13-col-rename" defaultValue={col.label} onBlur={e => { if (e.target.value.trim() && e.target.value.trim() !== col.label) renameR02ColumnInGroup(group, col.id, e.target.value) }} />
                {columns.length > 1 && <button type="button" className="mini danger" title="Usuń kolumnę" onClick={() => removeR02ColumnFromGroup(group, col.id)}>×</button>}
              </span>
            ))}
          </div>
          <div className="r13-add-column-row">
            <input value={r02NewColumnLabel} onChange={e => setR02NewColumnLabel(e.target.value)} placeholder="np. Separator magnetyczny" onKeyDown={e => { if (e.key === 'Enter' && r02NewColumnLabel.trim()) addR02ColumnToGroup(group, r02NewColumnLabel) }} />
            <button type="button" className="secondary" onClick={() => addR02ColumnToGroup(group, r02NewColumnLabel)} disabled={!r02NewColumnLabel.trim()}>Dodaj maszynę</button>
          </div>
        </div>}
        <table className="r02-head r13-head"><tbody><tr>
          <td className="r13-company"><b>AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.<br/>24-335 ŁAZISKA, KOLONIA ŁAZISKA 30<br/>NIP: 7171839598</b></td>
          <td className="r13-title"><b>{R02_HEADER.title}</b></td>
          <td className="r13-meta"><b>Rok:</b> {year}<br/><b>Miesiąc:</b> {month}<br/><b>Str.</b> 1 z 1<br/><b>Wersja</b> {R02_HEADER.version}</td>
        </tr></tbody></table>
        <table className="r02-table r13-table">
          <thead><tr>
            <th>Lp.</th><th>Dzień w miesiącu</th>
            {columns.map(col => <th key={col.id}>{col.label}<br/><small>(M/C/D*)</small></th>)}
            <th>Podpis osoby uzupełniającej wpisy</th><th className="no-print">Akcje</th>
          </tr></thead>
          <tbody>
            {calendar.map(row => {
              const dayOff = row.isSunday
              const doc = row.doc
              if (!doc) {
                return <tr key={row.date} className={`${dayOff ? 'r13-day-off' : ''} r13-missing no-print`.trim()}>
                  <td>{row.lp}</td>
                  <td>{formatR02PlDate(row.date)}{dayOff ? <small className="r13-off-tag"> (dzień wolny)</small> : ''}</td>
                  {columns.map(col => <td key={col.id}>—</td>)}
                  <td className="hint">{dayOff ? 'Niedziela – pusty wpis' : 'Brak wpisu'}</td>
                  <td className="no-print">
                    <button type="button" className="mini secondary" onClick={() => addMissingR02Day(group, row.date)}>{dayOff ? 'Dodaj wpis' : 'Dodaj dzień'}</button>
                  </td>
                </tr>
              }
              const isOff = dayOff || doc.data?.is_day_off
              return <tr key={doc.id} className={isOff ? 'r13-day-off' : ''}>
                <td>{row.lp}</td>
                <td>
                  <input className="cell-input no-print" type="date" defaultValue={doc.document_date} onBlur={e => { if (e.target.value !== doc.document_date) saveR02DocumentDate(doc, e.target.value) }} />
                  <span className="print-only">{formatR02PlDate(doc.document_date)}{isOff ? ' (dzień wolny)' : ''}</span>
                </td>
                {columns.map(col => renderMcdCell(doc, col))}
                <td>
                  <select className="mini-select no-print" value={doc.signed_by_operator || ''} onChange={e => saveR02Cell(doc, {}, e.target.value)}>
                    <option value="">Wybierz</option>
                    {employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}
                  </select>
                  <span className="print-only">{doc.signed_by_operator || ''}</span>
                </td>
                <td className="no-print"></td>
              </tr>
            })}
          </tbody>
        </table>
        <div className="r13-legend">
          * <b>M</b> – Mycie; <b>C</b> – Czyszczenie; <b>D</b> – Dezynfekcja (można łączyć: M/C, C/D itd.).<br/>
          Niedziele oznaczone na różowo – domyślnie puste, uzupełniane ręcznie w razie pracy.
        </div>
      </div>
    }

    if (group.type === 'R01') {
      const r01Docs = sortR01Docs(group.docs || [])
      const period = String(group.period || r01Docs[0]?.data?.month_key || '')
      const year = period.slice(0, 4)
      const month = period.slice(5, 7)
      const columns = group.columns || r01ColumnsFromDocs(r01Docs)
      const calendar = buildR01CalendarRows(period, r01Docs)
      const renderMcdCell = (doc, col) => {
        const cleaning = r01CleaningForDoc(doc, columns)
        const val = cleaning[col.id] || ''
        const display = r01McdDisplay(val)
        return <td key={col.id}>
          <select className="mini-select no-print" value={val} onChange={e => setR01RoomMcd(doc, col.id, e.target.value, columns)}>
            {R01_MCD_OPTIONS.map(o => <option key={o || 'empty'} value={o}>{o || '—'}</option>)}
          </select>
          <span className="print-only">{display}</span>
        </td>
      }
      return <div className="monthly-paper r01-paper r13-paper">
        <div className="no-print employee-signature-row" style={{ marginBottom: '10px' }}>
          <label>Podpis uzupełniającego (zbiorczo)
            <select value={defaultR01Employee} onChange={e => setDefaultR01Employee(e.target.value)}>
              <option value="">Wybierz pracownika</option>
              {employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}
            </select>
          </label>
          <button className="secondary" onClick={() => setEmployeeForVisibleR01Group(group, defaultR01Employee, false)}>Zastosuj do wszystkich</button>
          <button className="secondary" onClick={() => setEmployeeForVisibleR01Group(group, defaultR01Employee, true)}>Uzupełnij puste</button>
          {isAdmin(authProfile) && <>
            <button className="secondary danger" onClick={() => deleteR01Month(group)}>Usuń kartotekę</button>
            {r01MissingDefaultColumnLabels(columns).length > 0 && (
              <button type="button" className="secondary" onClick={() => restoreR01MissingDefaultsForGroup(group)}>Przywróć brakujące obiekty</button>
            )}
          </>}
          <span className="hint">Niedziele na różowo – domyślnie puste; pomieszczenie przyjęcia surowców ma M w dni robocze.</span>
        </div>
        {isAdmin(authProfile) && <div className="no-print r13-columns-panel">
          <b>Obiekty w tej kartotece:</b>
          <div className="r13-columns-list">
            {columns.map(col => (
              <span key={col.id} className="r13-column-chip">
                <input className="cell-input r13-col-rename" defaultValue={col.label} onBlur={e => { if (e.target.value.trim() && e.target.value.trim() !== col.label) renameR01ColumnInGroup(group, col.id, e.target.value) }} />
                {columns.length > 1 && <button type="button" className="mini danger" title="Usuń kolumnę" onClick={() => removeR01ColumnFromGroup(group, col.id)}>×</button>}
              </span>
            ))}
          </div>
          <div className="r13-add-column-row">
            <input value={r01NewColumnLabel} onChange={e => setR01NewColumnLabel(e.target.value)} placeholder="np. Magazyn opakowań" onKeyDown={e => { if (e.key === 'Enter' && r01NewColumnLabel.trim()) addR01ColumnToGroup(group, r01NewColumnLabel) }} />
            <button type="button" className="secondary" onClick={() => addR01ColumnToGroup(group, r01NewColumnLabel)} disabled={!r01NewColumnLabel.trim()}>Dodaj obiekt</button>
          </div>
        </div>}
        <table className="r01-head r13-head"><tbody><tr>
          <td className="r13-company"><b>AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.<br/>24-335 ŁAZISKA, KOLONIA ŁAZISKA 30<br/>NIP: 7171839598</b></td>
          <td className="r13-title"><b>{R01_HEADER.title}</b></td>
          <td className="r13-meta"><b>Rok:</b> {year}<br/><b>Miesiąc:</b> {month}<br/><b>Str.</b> 1 z 1<br/><b>Wersja</b> {R01_HEADER.version}</td>
        </tr></tbody></table>
        <table className="r01-table r13-table">
          <thead><tr>
            <th>Lp.</th><th>Dzień w miesiącu</th>
            {columns.map(col => <th key={col.id}>{col.label}<br/><small>(M/C/D*)</small></th>)}
            <th>Podpis osoby uzupełniającej wpisy</th><th className="no-print">Akcje</th>
          </tr></thead>
          <tbody>
            {calendar.map(row => {
              const dayOff = row.isSunday
              const doc = row.doc
              if (!doc) {
                return <tr key={row.date} className={`${dayOff ? 'r13-day-off' : ''} r13-missing no-print`.trim()}>
                  <td>{row.lp}</td>
                  <td>{formatR01PlDate(row.date)}{dayOff ? <small className="r13-off-tag"> (dzień wolny)</small> : ''}</td>
                  {columns.map(col => <td key={col.id}>—</td>)}
                  <td className="hint">{dayOff ? 'Niedziela – pusty wpis' : 'Brak wpisu'}</td>
                  <td className="no-print">
                    <button type="button" className="mini secondary" onClick={() => addMissingR01Day(group, row.date)}>{dayOff ? 'Dodaj wpis' : 'Dodaj dzień'}</button>
                  </td>
                </tr>
              }
              const cleaning = r01CleaningForDoc(doc, columns)
              const isOff = dayOff || doc.data?.is_day_off
              const hasAutoM = cleaning['pom-przyjecia'] === 'M' || columns.some(c => c.auto_m && cleaning[c.id] === 'M')
              return <tr key={doc.id} className={isOff ? 'r13-day-off' : ''}>
                <td>{row.lp}</td>
                <td>
                  <input className="cell-input no-print" type="date" defaultValue={doc.document_date} onBlur={e => { if (e.target.value !== doc.document_date) saveR01DocumentDate(doc, e.target.value) }} />
                  <span className="print-only">{formatR01PlDate(doc.document_date)}{isOff ? ' (dzień wolny)' : ''}</span>
                </td>
                {columns.map(col => renderMcdCell(doc, col))}
                <td>
                  <select className="mini-select no-print" value={doc.signed_by_operator || ''} onChange={e => saveR01Cell(doc, {}, e.target.value)}>
                    <option value="">Wybierz</option>
                    {employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}
                  </select>
                  <span className="print-only">{doc.signed_by_operator || ''}</span>
                </td>
                <td className="no-print">
                  {!hasAutoM && !isOff && (
                    <button type="button" className="mini secondary" onClick={() => setR01RowAutoM(doc, columns)} title="Ustaw M w pomieszczeniu przyjęcia surowców">Domyślne M</button>
                  )}
                </td>
              </tr>
            })}
          </tbody>
        </table>
        <div className="r13-legend">
          * <b>M</b> – Mycie; <b>C</b> – Czyszczenie; <b>D</b> – Dezynfekcja (można łączyć: M/C, C/D itd.).<br/>
          Niedziele oznaczone na różowo – domyślnie puste, uzupełniane ręcznie w razie pracy.
        </div>
      </div>
    }

    if (group.type === 'R13') {
      const r13Docs = sortR13Docs(group.docs || [])
      const period = String(group.period || r13Docs[0]?.data?.month_key || '')
      const year = period.slice(0, 4)
      const month = period.slice(5, 7)
      const columns = group.columns || r13ColumnsFromDocs(r13Docs)
      const calendar = buildR13CalendarRows(period, r13Docs)
      const renderGlassCell = (doc, col) => {
        const checks = r13ChecksForDoc(doc, columns)
        const val = checks[col.id]
        const display = r13CheckDisplay(val)
        return <td key={col.id} className={display === 'N' ? 'pn-n' : ''}>
          <select className="mini-select no-print" value={val === '' ? '' : formNormalizePn(val)} onChange={e => setR13GlassCheck(doc, col.id, e.target.value, columns)}>
            <option value="">—</option><option value="P">P</option><option value="N">N</option>
          </select>
          <span className="print-only">{display}</span>
        </td>
      }
      return <div className="monthly-paper r13-paper">
        <div className="no-print employee-signature-row" style={{ marginBottom: '10px' }}>
          <label>Podpis kontrolującego (zbiorczo)
            <select value={defaultR13Employee} onChange={e => setDefaultR13Employee(e.target.value)}>
              <option value="">Wybierz pracownika</option>
              {employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}
            </select>
          </label>
          <button className="secondary" onClick={() => setEmployeeForVisibleR13Group(group, defaultR13Employee, false)}>Zastosuj do wszystkich</button>
          <button className="secondary" onClick={() => setEmployeeForVisibleR13Group(group, defaultR13Employee, true)}>Uzupełnij puste</button>
          {isAdmin(authProfile) && <button className="secondary danger" onClick={() => deleteR13Month(group)}>Usuń kartotekę</button>}
          <span className="hint">Niedziele na różowo – domyślnie puste, można uzupełnić ręcznie (np. praca w niedzielę).</span>
        </div>
        {isAdmin(authProfile) && <div className="no-print r13-columns-panel">
          <b>Kolumny szyb w tej kartotece:</b>
          <div className="r13-columns-list">
            {columns.map(col => (
              <span key={col.id} className="r13-column-chip">
                <input className="cell-input r13-col-rename" defaultValue={col.label} onBlur={e => { if (e.target.value.trim() && e.target.value.trim() !== col.label) renameR13ColumnInGroup(group, col.id, e.target.value) }} />
                {columns.length > 1 && <button type="button" className="mini danger" title="Usuń kolumnę" onClick={() => removeR13ColumnFromGroup(group, col.id)}>×</button>}
              </span>
            ))}
          </div>
          <div className="r13-add-column-row">
            <input value={r13NewColumnLabel} onChange={e => setR13NewColumnLabel(e.target.value)} placeholder="np. Szyba 3" onKeyDown={e => { if (e.key === 'Enter' && r13NewColumnLabel.trim()) addR13ColumnToGroup(group, r13NewColumnLabel) }} />
            <button type="button" className="secondary" onClick={() => addR13ColumnToGroup(group, r13NewColumnLabel)} disabled={!r13NewColumnLabel.trim()}>Dodaj szybę</button>
          </div>
        </div>}
        <table className="r13-head"><tbody><tr>
          <td className="r13-company"><b>AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.<br/>24-335 ŁAZISKA, KOLONIA ŁAZISKA 30<br/>NIP: 7171839598</b></td>
          <td className="r13-title"><b>{R13_HEADER.title}</b></td>
          <td className="r13-meta"><b>Rok:</b> {year}<br/><b>Miesiąc:</b> {month}<br/><b>Str.</b> 1 z 1<br/><b>Wersja</b> {R13_HEADER.version}</td>
        </tr></tbody></table>
        <table className="r13-table">
          <thead><tr>
            <th>Lp.</th><th>Data</th>
            {columns.map(col => <th key={col.id}>{col.label}<br/><small>(*P/N)</small></th>)}
            <th>Podpis kontrolującego</th><th>Uwagi **T/N</th><th className="no-print">Akcje</th>
          </tr></thead>
          <tbody>
            {calendar.map(row => {
              const dayOff = row.isSunday
              const doc = row.doc
              if (!doc) {
                return <tr key={row.date} className={`${dayOff ? 'r13-day-off' : ''} r13-missing no-print`.trim()}>
                  <td>{row.lp}</td>
                  <td>{formatR13PlDate(row.date)}{dayOff ? <small className="r13-off-tag"> (dzień wolny)</small> : ''}</td>
                  {columns.map(col => <td key={col.id}>—</td>)}
                  <td colSpan={2} className="hint">{dayOff ? 'Niedziela – pusty wpis' : 'Brak wpisu'}</td>
                  <td className="no-print">
                    <button type="button" className="mini secondary" onClick={() => addMissingR13Day(group, row.date)}>{dayOff ? 'Dodaj wpis' : 'Dodaj P'}</button>
                  </td>
                </tr>
              }
              const checks = r13ChecksForDoc(doc, columns)
              const rowHasN = Object.values(checks).some(v => v === 'N')
              const isOff = dayOff || doc.data?.is_day_off
              return <tr key={doc.id} className={isOff ? 'r13-day-off' : ''}>
                <td>{row.lp}</td>
                <td>
                  <input className="cell-input no-print" type="date" defaultValue={doc.document_date} onBlur={e => { if (e.target.value !== doc.document_date) saveR13DocumentDate(doc, e.target.value) }} />
                  <span className="print-only">{formatR13PlDate(doc.document_date)}{isOff ? ' (dzień wolny)' : ''}</span>
                </td>
                {columns.map(col => renderGlassCell(doc, col))}
                <td>
                  <select className="mini-select no-print" value={doc.signed_by_operator || ''} onChange={e => saveR13Cell(doc, {}, e.target.value)}>
                    <option value="">Wybierz</option>
                    {employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}
                  </select>
                  <span className="print-only">{doc.signed_by_operator || ''}</span>
                </td>
                <td className={doc.data?.corrective === 'N' ? 'pn-n' : ''}>
                  <select className="mini-select no-print" value={doc.data?.corrective || ''} onChange={e => saveR13Cell(doc, { corrective: e.target.value })}>
                    <option value="">—</option><option value="T">T</option><option value="N">N</option>
                  </select>
                  <span className="print-only">{doc.data?.corrective || '—'}</span>
                </td>
                <td className="no-print">
                  {(isOff || rowHasN || !Object.values(checks).every(v => v === 'P')) && (
                    <button type="button" className="mini secondary" onClick={() => setR13RowAllP(doc, columns)} title="Ustaw P we wszystkich szybach">Wszystkie P</button>
                  )}
                </td>
              </tr>
            })}
          </tbody>
        </table>
        <div className="r13-legend">
          * <b>P</b> – prawidłowo, element cały nieuszkodzony; <b>N</b> – nieprawidłowo, element uszkodzony/zbity/wyszczerbiony.<br/>
          ** <b>T</b> – podjęto działania naprawcze/korekcyjne; <b>N</b> – nie podjęto działań naprawczych.<br/>
          Niedziele oznaczone na różowo – domyślnie puste, uzupełniane ręcznie w razie pracy.
        </div>
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
          <span className="hint">{doc.frozen ? 'Zamrożony – FIFO nie zmieni przypisanych PZ.' : `Jeden formularz K03 = jedna sprzedaż (WZ). Suma PZ = ${paper.rawTotal.toLocaleString('pl-PL')} kg, WZ = ${paper.saleTotal.toLocaleString('pl-PL')} kg. Numer partii, datę WZ i nr PZ możesz poprawić ręcznie – zapis następuje po wyjściu z pola.`}</span>
        </div>
        <table className="k03-head"><tbody><tr><td className="company"><b>AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.<br/>24-335 ŁAZISKA,<br/>KOLONIA ŁAZISKA 30<br/>NIP: 7171839598</b><br/>Wersja I/2024</td><td className="title"><b>Karta K03 - Karta identyfikacji partii produktu</b></td><td className="meta"><b>Rok:</b> {paper.year}<br/><b>Miesiąc:</b> {paper.month}<br/><b>Strona:</b></td></tr></tbody></table>
        <table className="k03-fields"><tbody>
          <tr><td><b>Nazwa produktu:</b> {paper.productName}</td><td><b>Data sprzedaży (WZ):</b>
            <input className="cell-input no-print" type="date" defaultValue={paper.wzDate} key={`k03-wz-date-${doc.id}-${paper.wzDate}`} onBlur={e => { if (e.target.value && e.target.value !== paper.wzDate) patchK03Document(doc, { wz_date: e.target.value, document_date: e.target.value }) }} />
            <span className="print-only">{paper.wzDate}</span>
          </td></tr>
          <tr><td><b>Numer WZ:</b> {paper.wzNo}</td><td><b>Ilość WZ (kg):</b> {paper.saleTotal.toLocaleString('pl-PL')}</td></tr>
          <tr><td><b>Nadany numer partii wyrobu gotowego:</b>
            <input className="cell-input no-print" type="text" defaultValue={paper.lotNo || ''} key={`k03-lot-${doc.id}-${paper.lotNo}`} placeholder="np. Mp/001/2024" onBlur={e => { if (e.target.value !== (paper.lotNo || '')) patchK03Document(doc, { lot_no: e.target.value.trim() }) }} />
            <span className="print-only">{paper.lotNo || '-'}</span>
          </td><td><b>Odbiorca:</b> {paper.receiver || '-'}</td></tr>
        </tbody></table>
        <table className="k03-table"><colgroup><col className="col-lp"/><col className="col-pz"/><col className="col-date"/><col className="col-dost"/><col className="col-qty"/><col className="col-lp"/><col className="col-wz"/><col className="col-date"/><col className="col-odb"/><col className="col-qty"/><col className="col-sign"/></colgroup><thead><tr><th colSpan="5">Dane dotyczące dostaw surowców składających się na partię (PZ)</th><th className="right-start" colSpan="6">Dane dotyczące sprzedaży (WZ)</th></tr><tr><th>Lp.</th><th>Nr faktury / PZ</th><th>Data zakupu</th><th>Dostawca</th><th>Ilość surowca (kg)</th><th className="right-start">Lp.</th><th>Nr faktury / WZ</th><th>Data</th><th>Odbiorca</th><th>Ilość w kg</th><th>Podpis uzupełniającego wpisy</th></tr></thead><tbody>
          {paper.rows.map((r, i) => {
            const shortageRow = rawRows[i]?.isShortage
            const rawPz = rawRows[i]?.pz_no_display ?? rawRows[i]?.pz_no ?? ''
            return <tr key={`k03-${i}`} className={shortageRow ? 'k03-shortage-row' : ''}>
              <td>{r.lp}</td>
              <td className="cell-wrap">
                {shortageRow ? r.pzNo : <>
                  <input className="cell-input no-print" type="text" defaultValue={rawPz} key={`k03-pz-${doc.id}-${i}-${rawPz}`} onBlur={e => { if (e.target.value !== rawPz) patchK03RawRow(doc, i, 'pz_no', e.target.value.trim()) }} />
                  <span className="print-only">{r.pzNo}</span>
                </>}
              </td>
              <td>{r.pzDate}</td><td className="cell-wrap">{r.dostawca}</td><td>{r.qty !== '' ? Number(r.qty).toLocaleString('pl-PL') : ''}</td>
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
    const cfg = getDocFormCfg(type)
    if (!cfg) return { type }
    const form = { id: null, type }
    for (const f of cfg.fields) {
      if (f.key === 'signed_by') form.signed_by = ''
      else if (f.type === 'pn') form[f.key] = 'P'
      else if (f.type === 'tri') form[f.key] = '+'
      else if (f.type === 'date') form[f.key] = new Date().toISOString().slice(0, 10)
      else if (f.type === 'select' && f.options?.length) form[f.key] = f.options[0].value ?? f.options[0]
      else form[f.key] = ''
    }
    if (type.startsWith('S') && type !== 'S09' && !form.product_name) {
      form.product_name = cfg.fields.find(x => x.key === 'product_name') ? (SPECYFIKACJE_CARDS.find(c => c[0] === type)?.[1]?.replace(/^S[0-9]+ – /, '') || '') : ''
    }
    if (type === 'K07' && !form.godzina) form.godzina = '12:00'
    return form
  }

  function resetManualHaccpForm(type) {
    resetManualPdfState()
    setManualHaccpForm(getDefaultManualHaccpForm(type || activeDocsCode()))
  }

  async function saveManualHaccpEntry() {
    const type = manualHaccpForm.type || activeDocsCode()
    const cfg = getDocFormCfg(type)
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
      if (!f.data && f.data !== false) continue
      if (f.data === false) continue
      const raw = manualHaccpForm[f.key]
      const val = f.type === 'pn' ? formNormalizePn(raw)
        : f.type === 'tri' ? String(raw || '+').trim()
        : String(raw ?? '').trim()
      data[f.key] = val
      if (f.type === 'pn' && val === 'N') status = 'N'
      if (f.type === 'tri' && val === '-') status = 'N'
    }
    const topLevel = {}
    for (const f of cfg.fields) {
      if (f.data !== false || f.key === 'signed_by' || f.key === 'document_date') continue
      topLevel[f.key] = String(manualHaccpForm[f.key] ?? '').trim()
    }
    if (type === 'K07' && !data.godzina) data.godzina = '12:00'
    if (type === 'K06') Object.assign(data, normalizeK06Data(data))
    const payload = {
      document_type: type,
      document_date: manualHaccpForm.document_date,
      product_name: topLevel.product_name || manualHaccpForm.product_name || data.surowiec || data.employee_name || data.item_name || data.procedure_title || data.device_name || data.assortment || data.sample_type || data.scope || data.area || data.raw_material || data.packaging_name || data.object_name || data.supplier_name || null,
      lot_no: manualHaccpForm.lot_no || topLevel.lot_no || data.numer_partii || data.serial_no || data.procedure_code || null,
      supplier_name: manualHaccpForm.supplier_name || data.supplier_name || data.producer || null,
      qty: manualHaccpForm.qty !== '' && manualHaccpForm.qty != null ? Number(manualHaccpForm.qty) : 0,
      document_no: topLevel.document_no || data.protocol_no || data.audit_no || `${type}/${manualHaccpForm.document_date || 'brak'}/${data.procedure_code || data.employee_name || data.item_name || data.protocol_no || 'wpis'}`.slice(0, 120),
      chamber_code: type === 'K04.1' ? 'TRANSPORT' : type === 'K07' ? 'CCP1' : type === 'K06' ? 'CP3' : null,
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
    const cfg = getDocFormCfg(doc.document_type)
    if (!cfg) return
    const form = { id: doc.id, type: doc.document_type }
    for (const f of cfg.fields) {
      if (f.key === 'signed_by') form.signed_by = doc.signed_by_operator || ''
      else if (f.data === false) form[f.key] = doc[f.key] ?? (f.type === 'date' ? '' : '')
      else if (f.data) form[f.key] = f.type === 'pn' ? formNormalizePn(doc.data?.[f.key]) : (doc.data?.[f.key] ?? '')
      else form[f.key] = doc[f.key] ?? (f.type === 'date' ? '' : '')
    }
    setManualHaccpForm(form)
  }

  async function deleteManualHaccpEntry(doc) {
    if (!supabase || !doc?.id) return
    if (!ensureCanDelete()) return
    if (!confirmDelete(`Wpis ${doc.document_type}: ${doc.product_name || doc.lot_no || doc.document_no || ''}.\n\nWpis trafi do historii.`)) return
    try {
      await auditDeleteHaccpDocument(supabase, doc, getAuditActor())
      if (manualHaccpForm.id === doc.id) resetManualHaccpForm(doc.document_type)
      await loadHaccpDocs()
      setMessage(`${doc.document_type}: usunięto wpis (zapis w historii).`)
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
    if (f.type === 'tri') {
      return <label key={f.key}>{f.label}
        <select value={value || '+'} onChange={e => setManualHaccpForm(prev => ({ ...prev, [f.key]: e.target.value }))}>
          <option value="+">+ spełnione</option>
          <option value="+/-">+/- działanie korygujące</option>
          <option value="-">− niespełnione</option>
        </select>
      </label>
    }
    if (f.type === 'select') {
      const opts = (f.options || []).map(o => typeof o === 'string' ? { value: o, label: o } : o)
      return <label key={f.key}>{f.label}
        <select value={value} onChange={e => setManualHaccpForm(prev => ({ ...prev, [f.key]: e.target.value }))}>
          {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
    }
    if (f.type === 'textarea') {
      return <label key={f.key} className="full-width">{f.label}
        <textarea rows={3} value={value} onChange={e => setManualHaccpForm(prev => ({ ...prev, [f.key]: e.target.value }))} />
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
    if (type === 'W03') {
      printHtmlInIframe(buildW03PrintHtml(docs, w03Meta, escapeHtml))
      return
    }
    if (type === 'W06') {
      printHtmlInIframe(buildW06PrintHtml(docs, escapeHtml))
      return
    }
    if (type === 'K06') {
      const period = String(docs[0]?.document_date || haccpMonth).slice(0, 7)
      printHtmlInIframe(buildK06MonthlyHtml({ type, period, docs }, escapeHtml))
      return
    }
    if (type === 'K07') {
      const period = String(docs[0]?.document_date || haccpMonth).slice(0, 7)
      printHtmlInIframe(buildK07MonthlyHtml({ type, period, docs }, escapeHtml))
      return
    }
    const cfg = getDocFormCfg(type)
    if (!cfg || !docs.length) { setMessage('Brak wpisów do wydruku.'); return }
    const period = String(docs[0]?.document_date || haccpMonth).slice(0, cfg.periodMode === 'year' ? 4 : 7)
    printHtmlInIframe(buildManualMonthlyHtml({ type, period, docs }, escapeHtml, cfg))
  }

  function exportManualHaccpPeriodExcel(type, docs) {
    if (type === 'W03') {
      const rows = buildW03ExcelRows(docs, w03Meta)
      const wb = XLSX.utils.book_new()
      const ws = XLSX.utils.aoa_to_sheet(rows)
      ws['!cols'] = rows[4]?.map(() => ({ wch: 20 })) || []
      XLSX.utils.book_append_sheet(wb, ws, 'W03')
      XLSX.writeFile(wb, 'W03-harmonogram-mycia.xlsx')
      return
    }
    if (type === 'W06') {
      const rows = buildW06ExcelRows(docs)
      const wb = XLSX.utils.book_new()
      const ws = XLSX.utils.aoa_to_sheet(rows)
      ws['!cols'] = rows[3]?.map(() => ({ wch: 22 })) || []
      XLSX.utils.book_append_sheet(wb, ws, 'W06')
      XLSX.writeFile(wb, 'W06-dostawcy-odbiorcy.xlsx')
      return
    }
    if (type === 'K06') {
      const period = String(docs[0]?.document_date || haccpMonth).slice(0, 7)
      const rows = buildK06ExcelRows({ type, period, docs })
      const wb = XLSX.utils.book_new()
      const ws = XLSX.utils.aoa_to_sheet(rows)
      ws['!cols'] = rows[rows.length - 1]?.map(() => ({ wch: 18 })) || []
      XLSX.utils.book_append_sheet(wb, ws, 'K06')
      XLSX.writeFile(wb, `K06_${period}.xlsx`)
      return
    }
    if (type === 'K07') {
      const period = String(docs[0]?.document_date || haccpMonth).slice(0, 7)
      const rows = buildK07ExcelRows({ type, period, docs })
      const wb = XLSX.utils.book_new()
      const ws = XLSX.utils.aoa_to_sheet(rows)
      ws['!cols'] = rows[rows.length - 1]?.map(() => ({ wch: 18 })) || []
      XLSX.utils.book_append_sheet(wb, ws, 'K07')
      XLSX.writeFile(wb, `K07_${period}.xlsx`)
      return
    }
    const cfg = getDocFormCfg(type)
    if (!cfg || !docs.length) { setMessage('Brak wpisów do Excel.'); return }
    const period = String(docs[0]?.document_date || haccpMonth).slice(0, cfg.periodMode === 'year' ? 4 : 7)
    const rows = buildManualExcelRows({ type, period, docs }, cfg)
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = rows[rows.length - 1]?.map(() => ({ wch: 18 })) || []
    XLSX.utils.book_append_sheet(wb, ws, type)
    XLSX.writeFile(wb, `${type}_${period}.xlsx`)
  }

  function renderManualPaperPreview(type, periodDocs) {
    const cfg = getDocFormCfg(type)
    if (!cfg) return null
    const period = String(periodDocs[0]?.document_date || haccpMonth).slice(0, cfg.periodMode === 'year' ? 4 : 7)
    const year = period.slice(0, 4)
    const month = cfg.periodMode === 'year' ? '—' : period.slice(5, 7)
    const pnFields = new Set(['stan_opakowania', 'barwa', 'zapach', 'twardosc_jablko', 'brak_plesni', 'stan_sita', 'status', 'approval', 'rating', 'result', 'active'])
    const pnKeyMap = { powod: 'powod_wycofania', dzialanie: 'dzialanie' }
    const maxRows = Math.max(type === 'K06' ? periodDocs.length : 12, periodDocs.length)
    const blanks = Math.max(0, maxRows - periodDocs.length)
    return <>
      <div className="actions no-print">
        <button className="secondary" onClick={() => printManualHaccpPeriod(type, periodDocs)}><Printer size={16}/> Druk/PDF – {type}</button>
        <button className="secondary" onClick={() => exportManualHaccpPeriodExcel(type, periodDocs)}>Pobierz Excel</button>
      </div>
      <h3>Podgląd kartoteki {type} – {cfg.periodMode === 'year' ? year : `${year}-${month}`} ({periodDocs.length} wpisów)</h3>
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
              {isAdmin(authProfile) && !doc.lot_id && !doc.synthetic && <button className="mini danger" onClick={() => deleteManualHaccpEntry(doc)}>Usuń</button>}
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
    const type = activeDocsCode()
    const cfg = getDocFormCfg(type)
    if (!cfg) return null
    const isHub = docsHubSection !== 'kartoteki'
    const sourceDocs = isHub ? hubManualDocsForFilter : haccpPeriodDocs
    const periodDocs = sourceDocs.filter(d => d.document_type === type)
    const autoCount = periodDocs.filter(d => d.synthetic || d.data?.auto_source).length
    const hubLabel = { wykazy: 'Wykaz', raporty: 'Raport', formularze: 'Formularz', protokoly: 'Protokół', specyfikacje: 'Specyfikacja' }[docsHubSection] || ''
    const pdfCfg = PDF_IMPORT_DOC_TYPES[type]
    return <>
      <div className="card inner-card no-print">
        <h3>{manualHaccpForm.id ? `Edytuj wpis ${type}` : `Dodaj wpis – ${cfg.title}`}</h3>
        {hubLabel && <p className="hint">{hubLabel} {type} – układ zgodny ze wzorem Word.</p>}
        {pdfCfg && <>
          <label className="full-width">Import PDF ({pdfCfg.label})
            <input key={manualPdfInputKey} type="file" accept="application/pdf,.pdf" disabled={manualPdfImporting}
              onChange={e => handleManualPdfFile(e, type)} />
          </label>
          {manualPdfImporting && <p className="hint">Trwa odczyt PDF…</p>}
          {manualPdfName && <p className="hint">PDF: <b>{manualPdfName}</b></p>}
          {manualPdfPreview && <details className="k011-pdf-preview" open>
            <summary>Podgląd tekstu z PDF</summary>
            <pre className="pdf-text-preview">{manualPdfPreview}</pre>
          </details>}
        </>}
        {type === 'K06' && <p className="hint">K06 uzupełnia się automatycznie z magazynu CP3 i produkcji (P domyślnie). {autoCount > 0 ? `W tym okresie: ${autoCount} wpisów auto.` : 'Kliknij „Odśwież magazyn partii”, potem „Odśwież kartoteki”.'} Jabłko przemysłowe nie trafia do K06 – jedzie prosto do sprzedaży.</p>}
        {type === 'K05' && <p className="hint">Rejestr wycofań – wpis ręczny na każde wycofanie partii. Poniżej podgląd kartoteki jak na papierze.</p>}
        {type === 'K04.1' && <p className="hint"><b>Transport / sprzedaż bez magazynowania CP3</b> – m.in. jabłko przemysłowe prosto na samochód. Uzupełnij temperaturę, opakowanie P/N i podpis.</p>}
        <div className={`form-grid compact${cfg.layout === 'document' ? ' doc-form-grid' : ''}`}>{cfg.fields.map(renderManualFormField)}</div>
        <div className="actions">
          <button onClick={saveManualHaccpEntry}>{manualHaccpForm.id ? 'Zapisz zmiany' : (cfg.layout === 'document' ? 'Zapisz dokument' : 'Dodaj do kartoteki')}</button>
          <button className="secondary" onClick={() => resetManualHaccpForm(type)}>Wyczyść</button>
        </div>
      </div>
      {periodDocs.length === 0 && <p className="hint">Brak wpisów. {type === 'K06' ? 'Przypisz partie gotowca do CP3 lub wykonaj produkcję, potem odśwież magazyn.' : 'Dodaj pierwszy wpis powyżej.'}</p>}
      {periodDocs.length > 0 && cfg.layout !== 'document' && renderManualPaperPreview(type, periodDocs)}
      {periodDocs.length > 0 && cfg.layout === 'document' && <p className="hint">Zapisano {periodDocs.length} dokument(ów) – podgląd i wydruk z listy kartotek poniżej (Otwórz).</p>}
    </>
  }

  async function ensureW03Seed(force = false) {
    if (!supabase) return
    const existing = (haccpDocs || []).filter(d => d.document_type === 'W03')
    if (existing.length && !force) return
    if (existing.length && force) {
      if (!ensureCanDelete()) return
      if (!confirmDelete(`Przywrócić 7 obiektów ze wzoru W03.\n\nIstniejące wpisy zostaną usunięte.`)) return
    }
    try {
      if (existing.length) {
        for (const doc of existing) {
          await supabase.from('haccp_documents').delete().eq('id', doc.id)
        }
      }
      const payloads = buildW03SeedPayloads()
      for (const payload of payloads) {
        const { error } = await supabase.from('haccp_documents').insert(payload)
        if (error) throw error
      }
      await loadHaccpDocs()
      setMessage('W03: wczytano wzór harmonogramu (7 obiektów).')
    } catch (err) {
      setMessage(`W03: błąd inicjalizacji – ${err.message}`)
    }
  }

  async function saveW03Cell(doc, field, value) {
    if (!supabase || !doc?.id) return
    const nextData = { ...(doc.data || {}), [field]: value }
    const payload = { data: nextData, updated_at: new Date().toISOString() }
    if (field === 'object_name') payload.product_name = value
    try {
      const { error } = await supabase.from('haccp_documents').update(payload).eq('id', doc.id)
      if (error) throw error
      setHaccpDocs(prev => prev.map(d => d.id === doc.id ? { ...d, ...payload, data: nextData, product_name: field === 'object_name' ? value : d.product_name } : d))
    } catch (err) {
      setMessage(`W03: błąd zapisu – ${err.message}`)
    }
  }

  async function addW03Object() {
    if (!supabase) return
    const name = String(w03NewRow.object_name || '').trim()
    if (!name) {
      setMessage('W03: podaj nazwę obiektu.')
      return
    }
    const existing = sortW03Docs((haccpDocs || []).filter(d => d.document_type === 'W03'))
    const sortOrder = existing.length ? Math.max(...existing.map(d => Number(d.data?.sort_order) || 0)) + 1 : 1
    const payload = buildW03InsertPayload({ ...w03NewRow, object_name: name }, sortOrder)
    try {
      const { error } = await supabase.from('haccp_documents').insert(payload)
      if (error) throw error
      setW03NewRow({ object_name: '', freq_after_use: '', freq_daily: '', freq_weekly: '', freq_monthly: '', freq_bimonthly: '' })
      await loadHaccpDocs()
      setMessage('W03: dodano obiekt do harmonogramu.')
    } catch (err) {
      setMessage(`W03: błąd dodawania – ${err.message}`)
    }
  }

  async function deleteW03Row(doc) {
    if (!supabase || !doc?.id) return
    if (!ensureCanDelete()) return
    if (!confirmDelete(`Obiekt W03: ${doc.data?.object_name || doc.product_name || ''}.\n\nWpis trafi do historii.`)) return
    try {
      await auditDeleteHaccpDocument(supabase, doc, getAuditActor())
      await loadHaccpDocs()
      setMessage('W03: usunięto obiekt (zapis w historii).')
    } catch (err) {
      setMessage(`W03: błąd usuwania – ${err.message}`)
    }
  }

  function updateW03MetaField(key, value) {
    const next = { ...w03Meta, [key]: value }
    setW03Meta(next)
    saveW03Meta(next)
  }

  function formatW03PlDate(iso) {
    if (!iso) return ''
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (!m) return iso
    return `${m[3]}.${m[2]}.${m[1]}`
  }

  async function importW06StagedParties(parties, existing) {
    const { added, skipped } = filterNewW06Parties(existing, parties)
    if (!added.length) return { added: 0, skipped: skipped.length }
    for (const party of added) {
      const { error } = await supabase.from('haccp_documents').insert(buildW06InsertPayload(party))
      if (error) throw error
    }
    await loadHaccpDocs()
    return { added: added.length, skipped: skipped.length }
  }

  async function deleteW06ImportBatch(fileName) {
    if (!supabase || !fileName) return
    if (!ensureCanDelete()) return
    const toDelete = (haccpDocs || []).filter(d => d.document_type === 'W06' && d.data?.source_filename === fileName)
    if (!toDelete.length) {
      setMessage(`W06: brak wpisów z pliku „${fileName}".`)
      return
    }
    if (!confirmDelete(`${toDelete.length} wpis(ów) z importu pliku:\n„${fileName}"`)) return
    try {
      for (const doc of toDelete) {
        const { error } = await supabase.from('haccp_documents').delete().eq('id', doc.id)
        if (error) throw error
      }
      await loadHaccpDocs()
      setW06PdfStagedParties(prev => prev.filter(p => p.source_filename !== fileName))
      setMessage(`W06: usunięto ${toDelete.length} wpisów z importu „${fileName}".`)
    } catch (err) {
      setMessage(`W06: błąd usuwania importu – ${err?.message || String(err)}`)
    }
  }

  async function handleW06ImportFiles(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    if (!supabase) {
      setMessage('W06: brak połączenia z bazą – odśwież stronę i zaloguj się ponownie.')
      return
    }
    setW06PdfFileName(files.map(f => f.name).join(', '))
    setW06PdfImporting(true)
    setW06PdfPreview('')
    setW06PdfStagedParties([])
    setMessage(`W06: odczytuję ${files.length} plik(ów)…`)
    try {
      const existing = (haccpDocs || []).filter(d => d.document_type === 'W06')
      const parsedParties = []
      let previewText = ''
      const unreadable = []
      const noParty = []
      for (const file of files) {
        try {
          const isExcel = isW06ExcelFile(file)
          const result = isExcel ? await parseW06FromExcelFile(file) : await parseW06FromPdfFile(file)
          if (!previewText && result.text) previewText = String(result.text).slice(0, 2500)
          if (result.unreadable) {
            unreadable.push(`${file.name}${isExcel ? ' (brak kontrahentów w Excelu)' : ''}${result.pdfError ? ` (${result.pdfError})` : ''}`)
            continue
          }
          const fromFile = result.parties?.length ? result.parties : (result.party ? [result.party] : [])
          if (fromFile.length) {
            parsedParties.push(...fromFile)
          } else {
            noParty.push(`${file.name} (${result.kind || '?'})`)
          }
        } catch (fileErr) {
          unreadable.push(`${file.name} (${fileErr?.message || 'błąd odczytu'})`)
        }
      }
      setW06PdfPreview(previewText || (unreadable.length ? 'Nie udało się odczytać danych – sprawdź kolumny: Rodzaj, Dostawca/Odbiorca, Produkt/Towar.' : ''))
      if (!parsedParties.length) {
        if (unreadable.length) {
          setMessage(`W06: brak kontrahentów (${unreadable.join(', ')}). Użyj Excela z kolumnami Dostawca i Towar lub dodaj ręcznie.`)
        } else if (noParty.length) {
          setMessage(`W06: odczytano plik, ale nie rozpoznano kontrahentów w: ${noParty.join('; ')}. Sprawdź podgląd poniżej.`)
        } else {
          setMessage('W06: brak danych do dodania.')
        }
        setW06PdfInputKey(k => k + 1)
        return
      }
      setW06PdfStagedParties(parsedParties)
      const firstRow = partyToW06NewRow(parsedParties[0])
      if (firstRow) setW06NewRow(firstRow)

      const { added, skipped } = await importW06StagedParties(parsedParties, existing)
      setW06PdfInputKey(k => k + 1)
      if (added > 0) {
        setW06PdfStagedParties(prev => {
          const keys = new Set(filterNewW06Parties(existing, parsedParties).added.map(p => p.dedupe_key))
          return prev.filter(p => !keys.has(p.dedupe_key || w06DedupeKey(p)))
        })
        let msg = `W06: dodano ${added} kontrahentów do wykazu`
        if (skipped) msg += `, pominięto ${skipped} duplikatów`
        if (parsedParties.length > added) msg += `. Rozpoznano łącznie ${parsedParties.length} firm`
        setMessage(msg + '.')
      } else {
        setMessage(`W06: rozpoznano ${parsedParties.length} firm – wszystkie są już na liście. Możesz edytować poniżej lub kliknąć „Dodaj rozpoznane firmy".`)
      }
      if (unreadable.length) setMessage(prev => `${prev} Nieczytelne pliki: ${unreadable.length}.`)
      if (noParty.length) setMessage(prev => `${prev} Pliki bez kontrahenta: ${noParty.length}.`)
    } catch (err) {
      setMessage(`W06: błąd importu – ${err?.message || String(err)}`)
    } finally {
      setW06PdfImporting(false)
    }
  }

  async function addW06StagedFromPdf() {
    if (!supabase || !w06PdfStagedParties.length) {
      setMessage('W06: brak rozpoznanych firm z PDF – wgraj plik ponownie.')
      return
    }
    try {
      const existing = (haccpDocs || []).filter(d => d.document_type === 'W06')
      const { added, skipped } = await importW06StagedParties(w06PdfStagedParties, existing)
      if (added > 0) {
        setW06PdfStagedParties([])
        setMessage(`W06: dodano ${added} kontrahentów do wykazu${skipped ? `, pominięto ${skipped} duplikatów` : ''}.`)
      } else {
        setMessage(`W06: wszystkie rozpoznane firmy (${w06PdfStagedParties.length}) są już na liście.`)
      }
    } catch (err) {
      setMessage(`W06: błąd dodawania – ${err?.message || String(err)}`)
    }
  }

  async function saveW06Cell(doc, field, value) {
    if (!supabase || !doc?.id) return
    const nextData = { ...(doc.data || {}), [field]: value }
    if (field === 'company_name') {
      const addr = nextData.address || doc.data?.address || ''
      nextData.supplier_name = addr ? `${value}, ${addr}` : value
    }
    if (field === 'address') {
      const name = nextData.company_name || doc.data?.company_name || ''
      nextData.supplier_name = value ? `${name}, ${value}` : name
    }
    if (field === 'party_type') {
      if (value === 'recipient') nextData.supplier_kind = 'recipient'
      else if (nextData.supplier_kind === 'recipient') nextData.supplier_kind = 'raw'
    }
    nextData.dedupe_key = w06DedupeKey({
      nip: nextData.nip || doc.data?.nip,
      company_name: nextData.company_name || doc.data?.company_name,
      supplier_name: nextData.supplier_name
    })
    const payload = {
      data: nextData,
      product_name: nextData.item_name || doc.product_name,
      supplier_name: nextData.supplier_name || doc.supplier_name,
      updated_at: new Date().toISOString()
    }
    try {
      const { error } = await supabase.from('haccp_documents').update(payload).eq('id', doc.id)
      if (error) throw error
      setHaccpDocs(prev => prev.map(d => d.id === doc.id ? { ...d, ...payload, data: nextData } : d))
    } catch (err) {
      setMessage(`W06: błąd zapisu – ${err.message}`)
    }
  }

  async function addW06Row() {
    if (!supabase) return
    const name = String(w06NewRow.company_name || '').trim()
    if (!name) {
      setMessage('W06: podaj nazwę firmy.')
      return
    }
    const existing = (haccpDocs || []).filter(d => d.document_type === 'W06')
    const party = {
      party_type: w06NewRow.party_type || 'supplier',
      supplier_kind: w06NewRow.party_type === 'recipient' ? 'recipient' : (w06NewRow.supplier_kind || 'raw'),
      company_name: name,
      supplier_name: [name, w06NewRow.address].filter(Boolean).join(', '),
      nip: w06NewRow.nip || '',
      address: w06NewRow.address || '',
      item_name: w06NewRow.item_name || '',
      source_doc_kind: 'ręcznie'
    }
    party.dedupe_key = w06DedupeKey(party)
    const { added } = filterNewW06Parties(existing, [party])
    if (!added.length) {
      setMessage('W06: taka firma jest już na liście (duplikat NIP/nazwy).')
      return
    }
    try {
      const { error } = await supabase.from('haccp_documents').insert(buildW06InsertPayload(added[0]))
      if (error) throw error
      setW06NewRow({ party_type: 'supplier', supplier_kind: 'raw', company_name: '', nip: '', address: '', item_name: '' })
      await loadHaccpDocs()
      setMessage('W06: dodano kontrahenta.')
    } catch (err) {
      setMessage(`W06: błąd dodawania – ${err.message}`)
    }
  }

  async function deleteW06Row(doc) {
    if (!supabase || !doc?.id) return
    if (!ensureCanDelete()) return
    const label = doc.data?.company_name || doc.data?.supplier_name || ''
    if (!confirmDelete(`Wpis W06: ${label}.\n\nWpis trafi do historii.`)) return
    try {
      await auditDeleteHaccpDocument(supabase, doc, getAuditActor())
      await loadHaccpDocs()
      setMessage('W06: usunięto wpis (zapis w historii).')
    } catch (err) {
      setMessage(`W06: błąd usuwania – ${err.message}`)
    }
  }

  function renderW06Section() {
    const w06Docs = sortW06Docs(hubManualDocsForFilter.filter(d => d.document_type === 'W06'))
    const w06ImportBatches = listW06ImportBatches(w06Docs)
    return <>
      <div className="card inner-card no-print">
        <h3>Import Excel / PDF – PZ (dostawcy) i WZ (odbiorcy)</h3>
        <p className="hint">Wgraj <b>Excel</b> (zalecane – kolumny Dostawca/Odbiorca i Towar/Produkt) lub PDF. Program doda <b>unikalnych</b> kontrahentów z asortymentem – bez duplikatów.</p>
        <label className="full-width">Pliki Excel (.xlsx) lub PDF
          <input key={w06PdfInputKey} type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/pdf,.pdf" multiple disabled={w06PdfImporting} onChange={handleW06ImportFiles} />
          <span className="hint">Excel: eksport rejestru PZ/WZ z Subiekta/Comarch (Rodzaj, Dostawca/Odbiorca, Produkt/Towar). PDF: dokumenty z tekstem.</span>
        </label>
        {w06PdfImporting && <p className="hint">Trwa odczyt pliku…</p>}
        {w06PdfFileName && !w06PdfImporting && <p className="hint">Wybrany plik: <b>{w06PdfFileName}</b></p>}
        {w06PdfPreview && <details className="k011-pdf-preview" open>
          <summary>Podgląd odczytu (pierwsze wiersze)</summary>
          <pre className="pdf-text-preview">{w06PdfPreview}</pre>
        </details>}
        {w06PdfStagedParties.length > 0 && <div className="w06-staged no-print">
          <p className="hint"><b>Rozpoznano ({w06PdfStagedParties.length}):</b></p>
          <ul className="w06-staged-list">
            {w06PdfStagedParties.map((p, i) => <li key={i}>
              {W06_PARTY_LABELS[p.party_type] || 'Dostawca'} – {p.company_name || p.supplier_name}
              {p.nip ? `, NIP ${p.nip}` : ''}
              {p.item_name ? ` · towar: ${p.item_name}` : ''}
              <button type="button" className="mini secondary" onClick={() => { const row = partyToW06NewRow(p); if (row) setW06NewRow(row) }}>Wstaw do formularza</button>
            </li>)}
          </ul>
          <div className="actions">
            <button onClick={addW06StagedFromPdf}>Dodaj rozpoznane firmy do wykazu ({w06PdfStagedParties.length})</button>
          </div>
        </div>}
        {w06ImportBatches.length > 0 && <div className="w06-imports no-print">
          <p className="hint"><b>Wgrane pliki ({w06ImportBatches.length}):</b></p>
          <ul className="w06-staged-list">
            {w06ImportBatches.map(b => <li key={b.name}>
              <span>{b.name} – <b>{b.count}</b> wpis(ów) na liście</span>
              {isAdmin(authProfile) && <button type="button" className="mini danger" onClick={() => deleteW06ImportBatch(b.name)}>Usuń ten import</button>}
            </li>)}
          </ul>
          <p className="hint">Usunięcie importu kasuje z wykazu W06 wszystkie firmy dodane z danego pliku (po potwierdzeniu).</p>
        </div>}
      </div>
      <div className="actions no-print" style={{ marginBottom: 12 }}>
        <button className="secondary" onClick={() => loadHaccpDocs({ syncK01: true })}><RefreshCcw size={16}/> Odśwież</button>
        <button className="secondary" onClick={() => printManualHaccpPeriod('W06', w06Docs)}><Printer size={16}/> Druk / PDF</button>
        <button className="secondary" onClick={() => exportManualHaccpPeriodExcel('W06', w06Docs)}>Pobierz Excel</button>
      </div>
      <div className="w06-paper haccp-paper">
        <table className="w06-head"><tbody><tr>
          <td className="w06-company"><b>AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.<br/>24-335 ŁAZISKA, KOLONIA ŁAZISKA 30<br/>NIP: 7171839598</b></td>
          <td className="w06-title"><b>Wykaz W06 – Wykaz kwalifikowanych dostawców i odbiorców</b></td>
          <td className="w06-meta"><b>Wersja</b> I/2024<br/><b>Wpisy:</b> {w06Docs.length}</td>
        </tr></tbody></table>
        <table className="w06-table">
          <thead><tr>
            <th>Lp.</th><th>Typ</th><th>Kategoria</th><th>Dane firmy</th><th>NIP</th><th>Towar / surowiec</th><th>Źr.</th>
            <th className="no-print w06-act">Akcje</th>
          </tr></thead>
          <tbody>
            {w06Docs.length === 0 && <tr><td colSpan={8} className="hint">Brak wpisów – wgraj Excel/PDF PZ/WZ lub dodaj ręcznie poniżej.</td></tr>}
            {w06Docs.map((doc, i) => {
              const d = doc.data || {}
              return <tr key={doc.id}>
                <td>{i + 1}</td>
                <td>
                  <select className="w06-cell-input no-print" defaultValue={d.party_type || 'supplier'} onBlur={e => saveW06Cell(doc, 'party_type', e.target.value)}>
                    <option value="supplier">Dostawca</option>
                    <option value="recipient">Odbiorca</option>
                  </select>
                  <span className="print-only">{w06PartyLabel(doc)}</span>
                </td>
                <td>
                  <select className="w06-cell-input no-print" defaultValue={d.supplier_kind || 'raw'} onBlur={e => saveW06Cell(doc, 'supplier_kind', e.target.value)}>
                    <option value="raw">Surowiec</option>
                    <option value="aux">Materiały pom.</option>
                    <option value="recipient">Odbiorca</option>
                  </select>
                  <span className="print-only">{w06KindLabel(doc)}</span>
                </td>
                <td className="left">
                  <input className="w06-cell-input w06-wide no-print" defaultValue={d.company_name || d.supplier_name || ''} onBlur={e => saveW06Cell(doc, 'company_name', e.target.value)} />
                  <span className="print-only">{d.supplier_name || d.company_name || ''}</span>
                </td>
                <td>
                  <input className="w06-cell-input no-print" defaultValue={d.nip || ''} onBlur={e => saveW06Cell(doc, 'nip', e.target.value.replace(/\D/g, '').slice(0, 10))} />
                  <span className="print-only">{d.nip || ''}</span>
                </td>
                <td className="left">
                  <input className="w06-cell-input w06-wide no-print" defaultValue={d.item_name || doc.product_name || ''} onBlur={e => saveW06Cell(doc, 'item_name', e.target.value)} />
                  <span className="print-only">{d.item_name || doc.product_name || ''}</span>
                </td>
                <td>{d.source_doc_kind || ''}</td>
                <td className="no-print row-actions">{isAdmin(authProfile) && <button className="mini danger" onClick={() => deleteW06Row(doc)}>Usuń</button>}</td>
              </tr>
            })}
          </tbody>
        </table>
      </div>
      <div className="card inner-card no-print">
        <h3>Dodaj kontrahenta ręcznie</h3>
        <div className="form-grid compact">
          <label>Typ
            <select value={w06NewRow.party_type} onChange={e => setW06NewRow(prev => ({ ...prev, party_type: e.target.value, supplier_kind: e.target.value === 'recipient' ? 'recipient' : prev.supplier_kind === 'recipient' ? 'raw' : prev.supplier_kind }))}>
              <option value="supplier">Dostawca (PZ)</option>
              <option value="recipient">Odbiorca (WZ)</option>
            </select>
          </label>
          <label>Kategoria
            <select value={w06NewRow.supplier_kind} onChange={e => setW06NewRow(prev => ({ ...prev, supplier_kind: e.target.value }))}>
              <option value="raw">Surowiec</option>
              <option value="aux">Materiały pomocnicze</option>
              <option value="recipient">Odbiorca (klient)</option>
            </select>
          </label>
          <label className="full-width">Nazwa firmy<input value={w06NewRow.company_name} onChange={e => setW06NewRow(prev => ({ ...prev, company_name: e.target.value }))} /></label>
          <label>NIP<input value={w06NewRow.nip} onChange={e => setW06NewRow(prev => ({ ...prev, nip: e.target.value }))} placeholder="10 cyfr" /></label>
          <label>Adres<input value={w06NewRow.address} onChange={e => setW06NewRow(prev => ({ ...prev, address: e.target.value }))} /></label>
          <label>Przykładowy towar<input value={w06NewRow.item_name} onChange={e => setW06NewRow(prev => ({ ...prev, item_name: e.target.value }))} /></label>
        </div>
        <p className="hint">Po wgraniu Excel/PDF pola poniżej uzupełnią się pierwszą rozpoznaną firmą – możesz poprawić i kliknąć „Dodaj do wykazu", albo użyć przycisku „Dodaj rozpoznane firmy" powyżej.</p>
        <div className="actions"><button onClick={addW06Row}>Dodaj do wykazu</button></div>
      </div>
    </>
  }

  function renderW03Section() {
    const w03Docs = sortW03Docs(hubManualDocsForFilter.filter(d => d.document_type === 'W03'))
    return <>
      <div className="actions no-print" style={{ marginBottom: 12 }}>
        <button className="secondary" onClick={() => loadHaccpDocs({ syncK01: true })}><RefreshCcw size={16}/> Odśwież</button>
        <button className="secondary" onClick={() => printManualHaccpPeriod('W03', w03Docs)}><Printer size={16}/> Druk / PDF</button>
        <button className="secondary" onClick={() => exportManualHaccpPeriodExcel('W03', w03Docs)}>Pobierz Excel</button>
        {isAdmin(authProfile) && <button className="secondary" onClick={() => ensureW03Seed(true)}>Przywróć wzór (7 obiektów)</button>}
      </div>
      {w03Docs.length === 0 && <p className="hint no-print">Brak wpisów – wczytuję wzór harmonogramu…</p>}
      <div className="w03-paper haccp-paper">
        <table className="w03-head"><tbody><tr>
          <td className="w03-company">{W03_HEADER.companyLines.map((l, i) => <span key={i}>{l}{i < W03_HEADER.companyLines.length - 1 && <br/>}</span>)}</td>
          <td className="w03-title"><b>{W03_HEADER.title}</b></td>
          <td className="w03-meta"><b>Wersja</b> {w03Meta.version || W03_HEADER.version}<br/><b>Data wydania:</b> {formatW03PlDate(w03Meta.issueDate || W03_HEADER.issueDate)}<br/><b>Strona:</b> 1 z 1</td>
        </tr></tbody></table>
        <table className="w03-table">
          <thead>
            <tr>
              <th rowSpan={2} className="w03-lp">L.p.</th>
              <th rowSpan={2} className="w03-obj">OBIEKT</th>
              <th colSpan={5}>CZĘSTOTLIWOŚĆ WYKONYWANIA PROCESU</th>
              <th rowSpan={2} className="no-print w03-act">Akcje</th>
            </tr>
            <tr>
              {W03_FREQ_KEYS.map(([, label]) => <th key={label}>{label}</th>)}
            </tr>
          </thead>
          <tbody>
            {w03Docs.map((doc, i) => <tr key={doc.id}>
              <td>{i + 1}</td>
              <td className="left">
                <input className="w03-cell-input w03-obj-input no-print" defaultValue={doc.data?.object_name || doc.product_name || ''} onBlur={e => saveW03Cell(doc, 'object_name', e.target.value)} />
                <span className="print-only">{doc.data?.object_name || doc.product_name || ''}</span>
              </td>
              {W03_FREQ_KEYS.map(([key]) => <td key={key}>
                <input className="w03-cell-input no-print" defaultValue={w03Freq(doc, key)} placeholder="M/C/D" onBlur={e => saveW03Cell(doc, key, e.target.value)} />
                <span className="print-only">{w03Freq(doc, key)}</span>
              </td>)}
              <td className="no-print row-actions">
                {isAdmin(authProfile) && <button className="mini danger" onClick={() => deleteW03Row(doc)}>Usuń</button>}
              </td>
            </tr>)}
          </tbody>
        </table>
        <p className="w03-legend"><b>M</b> – mycie, <b>C</b> – czyszczenie, <b>D</b> – dezynfekcja</p>
        <div className="w03-footer no-print">
          <label>Zatwierdził<input value={w03Meta.approvedBy || ''} onChange={e => updateW03MetaField('approvedBy', e.target.value)} placeholder="podpis / imię i nazwisko" /></label>
          <label>Data zatwierdzenia<input type="date" value={w03Meta.approvalDate || ''} onChange={e => updateW03MetaField('approvalDate', e.target.value)} /></label>
        </div>
        <div className="w03-footer print-only">
          <span><b>Zatwierdził:</b> {w03Meta.approvedBy || ''}</span>
          <span><b>Data i podpis:</b> {formatW03PlDate(w03Meta.approvalDate)}</span>
        </div>
      </div>
      <div className="card inner-card no-print">
        <h3>Dodaj obiekt do harmonogramu W03</h3>
        <p className="hint">W kolumnach częstotliwości wpisz kody: M (mycie), C (czyszczenie), D (dezynfekcja), np. C/M lub M/D.</p>
        <div className="form-grid compact w03-add-grid">
          <label className="full-width">Obiekt<input value={w03NewRow.object_name} onChange={e => setW03NewRow(prev => ({ ...prev, object_name: e.target.value }))} placeholder="np. Sala pakowania – podłogi" /></label>
          {W03_FREQ_KEYS.map(([key, label]) => <label key={key}>{label}<input value={w03NewRow[key]} onChange={e => setW03NewRow(prev => ({ ...prev, [key]: e.target.value }))} placeholder="M/C/D" /></label>)}
        </div>
        <div className="actions"><button onClick={addW03Object}>Dodaj obiekt</button></div>
      </div>
    </>
  }

  function addR13DefaultColumn() {
    const col = r13MakeColumn(r13NewColumnLabel)
    const next = [...r13ColumnDefs, col]
    saveR13Columns(next)
    setR13ColumnDefs(next)
    setR13NewColumnLabel('')
    setMessage(`R13: dodano domyślną kolumnę „${col.label}” (dla nowych kartotek).`)
  }

  function removeR13DefaultColumn(columnId) {
    if (!ensureCanDelete()) return
    const removed = r13ColumnDefs.find(c => c.id === columnId)
    const next = r13ColumnDefs.filter(c => c.id !== columnId)
    if (next.length < 1) { setMessage('R13: musi zostać co najmniej jedna szyba.'); return }
    if (!confirmDelete(`„${removed?.label || columnId}" z domyślnych kolumn R13.`)) return
    saveR13Columns(next)
    setR13ColumnDefs(next)
    setMessage('R13: usunięto kolumnę z ustawień domyślnych.')
  }

  function renderR02Section() {
    return <>
      <div className="card inner-card no-print r13-add-panel">
        <h3>Dodaj kartotekę R02 za miesiąc</h3>
        <p className="hint">System uzupełni <b>cały miesiąc</b> – dni robocze puste do wpisania M/C/D przy każdej maszynie, <b>niedziele puste</b> (jasny czerwony) z możliwością ręcznego uzupełnienia.</p>
        {isAdmin(authProfile) && <div className="r13-columns-panel">
          <b>Maszyny / urządzenia (domyślne dla nowych kartotek):</b>
          <div className="r13-columns-list">
            {r02ColumnDefs.map(col => (
              <span key={col.id} className="r13-column-chip">{col.label}
                {r02ColumnDefs.length > 1 && <button type="button" className="mini danger" title="Usuń z domyślnych" onClick={() => removeR02DefaultColumn(col.id)}>×</button>}
              </span>
            ))}
          </div>
          <div className="r13-add-column-row">
            <input value={r02NewColumnLabel} onChange={e => setR02NewColumnLabel(e.target.value)} placeholder="np. Separator magnetyczny" onKeyDown={e => { if (e.key === 'Enter' && r02NewColumnLabel.trim()) addR02DefaultColumn() }} />
            <button type="button" className="secondary" onClick={addR02DefaultColumn} disabled={!r02NewColumnLabel.trim()}>Dodaj maszynę</button>
          </div>
          <p className="hint">Kolumny można też dopisać do istniejącej kartoteki w podglądzie (Otwórz).</p>
        </div>}
        <div className="k03-bulk-row">
          <label>Rok i miesiąc
            <div className="r13-month-picker">
              <button type="button" className="mini secondary" onClick={() => shiftR02NewMonth(-1)} title="Poprzedni miesiąc">◀</button>
              <input type="month" value={r02NewMonth} onChange={e => setR02NewMonth(e.target.value)} />
              <button type="button" className="mini secondary" onClick={() => shiftR02NewMonth(1)} title="Następny miesiąc">▶</button>
            </div>
          </label>
          <label>Podpis uzupełniającego
            <select value={defaultR02Employee} onChange={e => setDefaultR02Employee(e.target.value)}>
              <option value="">Wybierz pracownika</option>
              {employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}
            </select>
          </label>
          <button onClick={createR02MonthKartoteka} disabled={haccpBusy}>{haccpBusy ? 'Tworzenie…' : 'Utwórz kartotekę'}</button>
        </div>
        <p className="hint">Wersja silnika R02: {R02_ENGINE_VERSION}. Maszyny: {r02ColumnDefs.length} (ze wzoru Word I/2024).</p>
      </div>
      {hubManualGroups.length === 0 && <p className="hint">Brak kartotek R02 – utwórz pierwszą kartotekę miesięczną powyżej.</p>}
      {hubManualGroups.length > 0 && <>
        <h3>Lista kartotek R02</h3>
        <div className="table-wrap docs-table-wrap"><table className="docs-table">
          <thead><tr><th>Miesiąc</th><th>Dni w miesiącu</th><th>Akcje</th></tr></thead>
          <tbody>{hubManualGroups.map(g => (
            <tr key={g.key}>
              <td><b>{g.period}</b> <span className="hint">({(g.columns || r02ColumnsFromDocs(g.docs)).length} maszyn)</span></td>
              <td>{g.docs.length}</td>
              <td className="row-actions">
                <button className="mini secondary" onClick={() => setSelectedHaccpDoc({ groupPreview: true, group: g })}><Eye size={14}/> Otwórz</button>
                <button className="mini secondary" onClick={() => printHaccpGroup(g)}><Printer size={14}/></button>
                <button className="mini secondary" onClick={() => exportHaccpGroupExcel(g)}>XLS</button>
                {isAdmin(authProfile) && <button className="mini danger" onClick={() => deleteR02Month(g)} title="Usuń całą kartotekę za ten miesiąc"><Trash2 size={14}/> Usuń</button>}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      </>}
    </>
  }

  function renderR01Section() {
    return <>
      <div className="card inner-card no-print r13-add-panel">
        <h3>Dodaj kartotekę R01 za miesiąc</h3>
        <p className="hint">System uzupełni <b>cały miesiąc</b>: w dni robocze <b>M</b> (mycie) w kolumnie <b>Pomieszczenie przyjęcia surowców</b>, pozostałe obiekty puste do uzupełnienia. <b>Niedziele puste</b> (jasny czerwony) – można uzupełnić ręcznie.</p>
        {isAdmin(authProfile) && <>
        <div className="r13-columns-panel">
          <b>Obiekty (domyślne dla nowych kartotek):</b>
          <div className="r13-columns-list">
            {r01ColumnDefs.map(col => (
              <span key={col.id} className="r13-column-chip">{col.label}{col.auto_m ? ' (auto M)' : ''}
                {r01ColumnDefs.length > 1 && <button type="button" className="mini danger" title="Usuń z domyślnych" onClick={() => removeR01DefaultColumn(col.id)}>×</button>}
              </span>
            ))}
          </div>
          <div className="r13-add-column-row">
            <input value={r01NewColumnLabel} onChange={e => setR01NewColumnLabel(e.target.value)} placeholder="np. Magazyn opakowań" onKeyDown={e => { if (e.key === 'Enter' && r01NewColumnLabel.trim()) addR01DefaultColumn() }} />
            <button type="button" className="secondary" onClick={addR01DefaultColumn} disabled={!r01NewColumnLabel.trim()}>Dodaj obiekt</button>
            <button type="button" className="secondary" onClick={restoreAllR01MissingDefaults}>Przywróć brakujące obiekty (wszystkie R01)</button>
          </div>
          <p className="hint">Kolumny można też dopisać do istniejącej kartoteki w podglądzie (Otwórz).</p>
        </div>
        </>}
        <div className="k03-bulk-row">
          <label>Rok i miesiąc
            <div className="r13-month-picker">
              <button type="button" className="mini secondary" onClick={() => shiftR01NewMonth(-1)} title="Poprzedni miesiąc">◀</button>
              <input type="month" value={r01NewMonth} onChange={e => setR01NewMonth(e.target.value)} />
              <button type="button" className="mini secondary" onClick={() => shiftR01NewMonth(1)} title="Następny miesiąc">▶</button>
            </div>
          </label>
          <label>Podpis uzupełniającego
            <select value={defaultR01Employee} onChange={e => setDefaultR01Employee(e.target.value)}>
              <option value="">Wybierz pracownika</option>
              {employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}
            </select>
          </label>
          <button onClick={createR01MonthKartoteka} disabled={haccpBusy}>{haccpBusy ? 'Tworzenie…' : 'Utwórz kartotekę'}</button>
        </div>
        <p className="hint">Wersja silnika R01: {R01_ENGINE_VERSION}. Obiekty: {r01ColumnDefs.length} (ze wzoru Word I/2024).</p>
      </div>
      {hubManualGroups.length === 0 && <p className="hint">Brak kartotek R01 – utwórz pierwszą kartotekę miesięczną powyżej.</p>}
      {hubManualGroups.length > 0 && <>
        <h3>Lista kartotek R01</h3>
        <div className="table-wrap docs-table-wrap"><table className="docs-table">
          <thead><tr><th>Miesiąc</th><th>Dni w miesiącu</th><th>Akcje</th></tr></thead>
          <tbody>{hubManualGroups.map(g => (
            <tr key={g.key}>
              <td><b>{g.period}</b> <span className="hint">({(g.columns || r01ColumnsFromDocs(g.docs)).length} obiektów)</span></td>
              <td>{g.docs.length}</td>
              <td className="row-actions">
                <button className="mini secondary" onClick={() => setSelectedHaccpDoc({ groupPreview: true, group: g })}><Eye size={14}/> Otwórz</button>
                <button className="mini secondary" onClick={() => printHaccpGroup(g)}><Printer size={14}/></button>
                <button className="mini secondary" onClick={() => exportHaccpGroupExcel(g)}>XLS</button>
                {isAdmin(authProfile) && <button className="mini danger" onClick={() => deleteR01Month(g)} title="Usuń całą kartotekę za ten miesiąc"><Trash2 size={14}/> Usuń</button>}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      </>}
    </>
  }

  function renderR13Section() {
    return <>
      <div className="card inner-card no-print r13-add-panel">
        <h3>Dodaj kartotekę R13 za miesiąc</h3>
        <p className="hint">System uzupełni <b>cały miesiąc</b>: dni robocze (pon–sob) z <b>P</b> w każdej szybie, <b>niedziele puste</b> (jasny czerwony) – można je potem uzupełnić ręcznie.</p>
        {isAdmin(authProfile) && <div className="r13-columns-panel">
          <b>Kolumny szyb (domyślne dla nowych kartotek):</b>
          <div className="r13-columns-list">
            {r13ColumnDefs.map(col => (
              <span key={col.id} className="r13-column-chip">{col.label}
                {r13ColumnDefs.length > 1 && <button type="button" className="mini danger" title="Usuń z domyślnych" onClick={() => removeR13DefaultColumn(col.id)}>×</button>}
              </span>
            ))}
          </div>
          <div className="r13-add-column-row">
            <input value={r13NewColumnLabel} onChange={e => setR13NewColumnLabel(e.target.value)} placeholder="np. Szyba 3" onKeyDown={e => { if (e.key === 'Enter' && r13NewColumnLabel.trim()) addR13DefaultColumn() }} />
            <button type="button" className="secondary" onClick={addR13DefaultColumn} disabled={!r13NewColumnLabel.trim()}>Dodaj szybę</button>
          </div>
          <p className="hint">Dodane kolumny można też dopisać do istniejącej kartoteki w podglądzie (Otwórz).</p>
        </div>}
        <div className="k03-bulk-row">
          <label>Rok i miesiąc
            <div className="r13-month-picker">
              <button type="button" className="mini secondary" onClick={() => shiftR13NewMonth(-1)} title="Poprzedni miesiąc">◀</button>
              <input type="month" value={r13NewMonth} onChange={e => setR13NewMonth(e.target.value)} />
              <button type="button" className="mini secondary" onClick={() => shiftR13NewMonth(1)} title="Następny miesiąc">▶</button>
            </div>
          </label>
          <label>Podpis kontrolującego
            <select value={defaultR13Employee} onChange={e => setDefaultR13Employee(e.target.value)}>
              <option value="">Wybierz pracownika</option>
              {employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}
            </select>
          </label>
          <button onClick={createR13MonthKartoteka} disabled={haccpBusy}>{haccpBusy ? 'Tworzenie…' : 'Utwórz kartotekę'}</button>
        </div>
        <p className="hint">Wersja silnika R13: {R13_ENGINE_VERSION}. Kolumny: {r13ColumnDefs.map(c => c.label).join(', ')}.</p>
      </div>
      {hubManualGroups.length === 0 && <p className="hint">Brak kartotek R13 – utwórz pierwszą kartotekę miesięczną powyżej.</p>}
      {hubManualGroups.length > 0 && <>
        <h3>Lista kartotek R13</h3>
        <div className="table-wrap docs-table-wrap"><table className="docs-table">
          <thead><tr><th>Miesiąc</th><th>Dni w miesiącu</th><th>N</th><th>Akcje</th></tr></thead>
          <tbody>{hubManualGroups.map(g => {
            const cols = g.columns || r13ColumnsFromDocs(g.docs)
            return <tr key={g.key}>
              <td><b>{g.period}</b> <span className="hint">({cols.map(c => c.label).join(', ')})</span></td>
              <td>{g.docs.length}</td>
              <td>{g.docs.filter(d => r13DocStatus(d, cols) === 'N').length || '—'}</td>
              <td className="row-actions">
                <button className="mini secondary" onClick={() => setSelectedHaccpDoc({ groupPreview: true, group: g })}><Eye size={14}/> Otwórz</button>
                <button className="mini secondary" onClick={() => printHaccpGroup(g)}><Printer size={14}/></button>
                <button className="mini secondary" onClick={() => exportHaccpGroupExcel(g)}>XLS</button>
                {isAdmin(authProfile) && <button className="mini danger" onClick={() => deleteR13Month(g)} title="Usuń całą kartotekę za ten miesiąc"><Trash2 size={14}/> Usuń</button>}
              </td>
            </tr>
          })}</tbody>
        </table></div>
      </>}
    </>
  }

  function renderHubManualSection() {
    const code = activeDocsCode()
    const cards = activeHubCards()
    const cfg = getDocFormCfg(code)
    return <div className="docs-layout">
      {renderHubManualSidebar(hubManualFilterStats)}
      <div className="docs-main">
        <section className="card docs-panel">
          <div className="docs-main-head">
            <div>
              <h3>{cards.find(c => c[0] === code)?.[1] || code}</h3>
              <p className="hint">{cards.find(c => c[0] === code)?.[2]}</p>
            </div>
            <div className="actions docs-actions">
              <button className="secondary" onClick={() => loadHaccpDocs({ syncK01: true })}><RefreshCcw size={16}/> Odśwież</button>
            </div>
          </div>
          {code === 'W03' ? renderW03Section() : code === 'W06' ? renderW06Section() : code === 'R02' ? renderR02Section() : code === 'R01' ? renderR01Section() : code === 'R13' ? renderR13Section() : code === 'R09' ? (
            <R09TrendSection haccpDocs={haccpDocs} escapeHtml={escapeHtml} printHtmlInIframe={printHtmlInIframe} />
          ) : isRMonthlyReport(code) ? (
            <RMonthlyReportSection
              code={code}
              supabase={supabase}
              employees={employees}
              haccpDocs={haccpDocs}
              hubManualGroups={hubManualGroups}
              loadHaccpDocs={loadHaccpDocs}
              mergeHaccpDoc={mergeHaccpDoc}
              mergeHaccpDocsBatch={mergeHaccpDocsBatch}
              setMessage={setMessage}
              setSelectedHaccpDoc={setSelectedHaccpDoc}
              printHaccpGroup={printHaccpGroup}
              exportHaccpGroupExcel={exportHaccpGroupExcel}
              allowDelete={isAdmin(authProfile)}
              onAuditDelete={async (docs, reason) => {
                if (!ensureCanDelete()) return
                await auditDeleteHaccpDocuments(supabase, docs, getAuditActor(), reason)
              }}
            />
          ) : <>
          {cfg && renderManualHaccpEntrySection()}
          {hubManualGroups.length === 0 && <p className="hint">Brak wpisów. Dodaj pierwszy wpis powyżej.</p>}
          {hubManualGroups.length > 0 && <>
            <h3>Lista kartotek {code}</h3>
            <div className="table-wrap docs-table-wrap"><table className="docs-table">
              <thead><tr><th>Okres / rejestr</th><th>Wpisy</th><th>N</th><th>Akcje</th></tr></thead>
              <tbody>{hubManualGroups.map(g => {
                const gcfg = getDocFormCfg(g.type)
                return <tr key={g.key}>
                  <td><b>{hubPeriodLabel(g, gcfg)}</b></td>
                  <td>{g.docs.length}</td>
                  <td>{g.docs.filter(d => d.status === 'N').length || '—'}</td>
                  <td className="row-actions">
                    <button className="mini secondary" onClick={() => setSelectedHaccpDoc({ groupPreview: true, group: g })}><Eye size={14}/> Otwórz</button>
                    <button className="mini secondary" onClick={() => printHaccpGroup(g)}><Printer size={14}/></button>
                    <button className="mini secondary" onClick={() => exportHaccpGroupExcel(g)}>XLS</button>
                  </td>
                </tr>
              })}</tbody>
            </table></div>
          </>}
          </>}
        </section>
      </div>
    </div>
  }

  function resetAuxForm() {
    setAuxForm({ delivery_date: new Date().toISOString().slice(0,10), item_name: '', supplier_invoice: '', vehicle_hygiene: 'P', qty: '', lot_no: '', notes: '', signed_by: '' })
    setAuxPdfName('')
    setAuxPdfPreview('')
    setK011PdfLineItems([])
    setAuxPdfInputKey(k => k + 1)
  }

  function normalizeAuxFormForSave(form, pdfName = '', lineItems = []) {
    const delivery_date = String(form.delivery_date || '').trim()
    let item_name = String(form.item_name || '').trim()
    let supplier_invoice = String(form.supplier_invoice || '').trim()
    if (!item_name && lineItems[0]?.name) item_name = String(lineItems[0].name).trim()
    if (!supplier_invoice && pdfName) supplier_invoice = pdfName.replace(/\.pdf$/i, '').slice(0, 120)
    return { ...form, delivery_date, item_name, supplier_invoice }
  }

  function updateK011LineItem(index, field, value) {
    setK011PdfLineItems(prev => prev.map((it, i) => i === index ? { ...it, [field]: value } : it))
    if (index === 0 && (field === 'name' || field === 'qty')) {
      setAuxForm(prev => ({ ...prev, [field === 'name' ? 'item_name' : 'qty']: value }))
    }
  }

  async function saveAuxMaterial() {
    if (!supabase) {
      setMessage('K01.1: brak połączenia z bazą (Supabase).')
      return
    }
    const norm = normalizeAuxFormForSave(auxForm, auxPdfName, k011PdfLineItems)
    if (!norm.delivery_date) {
      setMessage('K01.1: podaj datę dostawy.')
      return
    }
    if (!norm.item_name || norm.item_name.length < 2) {
      setMessage('K01.1: podaj nazwę towaru (min. 2 znaki) – popraw pozycję z PDF lub wpisz ręcznie.')
      return
    }
    if (!norm.supplier_invoice) {
      setMessage('K01.1: podaj dostawcę / nr faktury – uzupełnij ręcznie pole „Dostawca / nr faktury".')
      return
    }
    const payload = {
      delivery_date: norm.delivery_date,
      item_name: norm.item_name,
      supplier_invoice: norm.supplier_invoice,
      vehicle_hygiene: norm.vehicle_hygiene || 'P',
      qty: norm.qty || null,
      lot_no: norm.lot_no || null,
      notes: norm.notes || null,
      signed_by: norm.signed_by || null,
      source_filename: auxPdfName || null,
      updated_at: new Date().toISOString()
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
      setMessage(`Błąd zapisu K01.1: ${err.message}. Jeśli widzisz „relation does not exist", uruchom migrację SQL haccp_aux_materials w Supabase.`)
    }
  }

  async function saveAuxMaterialsBatchFromPdf() {
    if (!supabase) {
      setMessage('K01.1: brak połączenia z bazą.')
      return
    }
    if (!k011PdfLineItems.length) {
      setMessage('K01.1: brak wielu pozycji z PDF – użyj zwykłego zapisu.')
      return
    }
    const validItems = k011PdfLineItems.filter(it => String(it.name || '').trim().length >= 2)
    if (!validItems.length) {
      setMessage('K01.1: brak pozycji do zapisu – uzupełnij nazwy towarów w tabeli poniżej.')
      return
    }
    const norm = normalizeAuxFormForSave(auxForm, auxPdfName, validItems)
    if (!norm.delivery_date) {
      setMessage('K01.1: podaj datę dostawy przed zapisem pozycji z faktury.')
      return
    }
    const supplierBase = norm.supplier_invoice || auxPdfName?.replace(/\.pdf$/i, '') || 'PDF'
    try {
      for (const item of validItems) {
        const { error } = await supabase.from('haccp_aux_materials').insert({
          delivery_date: norm.delivery_date,
          item_name: item.name,
          supplier_invoice: supplierBase,
          vehicle_hygiene: norm.vehicle_hygiene || 'P',
          qty: item.qty || norm.qty || null,
          lot_no: norm.lot_no || null,
          notes: norm.notes || (auxPdfName ? `PDF: ${auxPdfName}` : null),
          signed_by: norm.signed_by || null,
          source_filename: auxPdfName || null,
          updated_at: new Date().toISOString()
        })
        if (error) throw error
      }
      setMessage(`K01.1: zapisano ${validItems.length} pozycji z faktury PDF.`)
      resetAuxForm()
      await loadAuxMaterials()
    } catch (err) {
      setMessage(`Błąd zapisu wsadowego K01.1: ${err.message}`)
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
    setAuxPdfPreview('')
    setK011PdfLineItems([])
    setAuxPdfInputKey(k => k + 1)
  }

  async function deleteAuxMaterial(row) {
    if (!supabase || !row) return
    if (!ensureCanDelete()) return
    if (!confirmDelete(`Pozycję K01.1: ${row.item_name || ''}.`)) return
    try {
      const { error } = await supabase.from('haccp_aux_materials').delete().eq('id', row.id)
      if (error) throw error
      await loadAuxMaterials()
      setMessage('K01.1: usunięto pozycję.')
    } catch (err) {
      setMessage(`Błąd usuwania K01.1: ${err.message}`)
    }
  }

  async function handleAuxPdfFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.type && file.type !== 'application/pdf') {
      setMessage('K01.1: wybierz plik PDF.')
      return
    }
    setAuxPdfName(file.name)
    setAuxPdfImporting(true)
    setAuxPdfPreview('')
    setK011PdfLineItems([])
    setMessage('K01.1: odczytuję fakturę PDF...')
    try {
      const { text, parsed, updates, lineItems } = await importPdfForDocType('K01.1', file)
      setAuxPdfPreview(String(text || '').trim().slice(0, 3000))
      const rawItems = lineItems?.length ? lineItems : (parsed.itemName ? [{ name: parsed.itemName, qty: parsed.qty }] : [])
      const items = rawItems.map(it => ({ name: String(it.name || '').trim(), qty: String(it.qty || '').trim() })).filter(it => it.name.length >= 2 || it.qty)
      setK011PdfLineItems(items.length ? items : rawItems)
      setAuxForm(prev => ({
        ...prev,
        ...updates,
        item_name: updates.item_name || items[0]?.name || prev.item_name,
        qty: updates.qty || items[0]?.qty || prev.qty,
        notes: prev.notes || `PDF: ${file.name}`
      }))
      const filled = Object.keys(updates).length
      if (items.length > 1) {
        setMessage(`K01.1: rozpoznano ${items.length} pozycje (np. ${items[0].name}). Sprawdź datę i dostawcę, potem „Zapisz wszystkie pozycje z faktury".`)
      } else if (filled >= 1 && items.length === 1) {
        setMessage(`K01.1: odczytano ${filled} pól – sprawdź formularz i kliknij „Dodaj do kartoteki".`)
      } else if (parsed.textLength < 40) {
        setMessage('K01.1: skan PDF bez tekstu – wpisz dane ręcznie.')
      } else if (items.length === 0) {
        setMessage('K01.1: tekst z PDF jest, ale nazwy towarów nieczytelne – uzupełnij ręcznie (podgląd poniżej).')
      } else {
        setMessage('K01.1: częściowy odczyt – uzupełnij brakujące pola ręcznie.')
      }
    } catch (err) {
      setAuxPdfPreview('')
      setK011PdfLineItems([])
      setMessage(`K01.1: błąd PDF – ${err?.message || String(err)}`)
    } finally {
      setAuxPdfImporting(false)
    }
  }

  async function handleManualPdfFile(e, docType) {
    const file = e.target.files?.[0]
    if (!file || !PDF_IMPORT_DOC_TYPES[docType]) return
    setManualPdfName(file.name)
    setManualPdfImporting(true)
    setManualPdfPreview('')
    setMessage(`${docType}: odczytuję PDF…`)
    try {
      const { text, updates } = await importPdfForDocType(docType, file)
      setManualPdfPreview(String(text || '').slice(0, 3000))
      setManualHaccpForm(prev => ({ ...prev, type: docType, ...updates, notes: prev.notes || `PDF: ${file.name}` }))
      const filled = Object.keys(updates).length
      setMessage(filled ? `${docType}: uzupełniono ${filled} pól – sprawdź i zapisz.` : `${docType}: słaby odczyt – uzupełnij ręcznie.`)
    } catch (err) {
      setManualPdfPreview('')
      setMessage(`${docType}: błąd PDF – ${err?.message || String(err)}`)
    } finally {
      setManualPdfImporting(false)
    }
  }

  function resetManualPdfState() {
    setManualPdfName('')
    setManualPdfPreview('')
    setManualPdfInputKey(k => k + 1)
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
          <label className="full-width">Faktura PDF
            <input key={auxPdfInputKey} type="file" accept="application/pdf,.pdf" disabled={auxPdfImporting} onChange={handleAuxPdfFile} />
            <span className="hint">PDF z tekstem (np. z Subiekta, Comarch) – system uzupełni formularz. Skan/zdjęcie w PDF wymaga ręcznego wpisu.</span>
          </label>
          {auxPdfImporting && <p className="hint">Trwa odczyt PDF…</p>}
          {auxPdfName && <p className="hint">Wybrany PDF: <b>{auxPdfName}</b></p>}
          {auxPdfPreview && <details className="k011-pdf-preview" open>
            <summary>Podgląd tekstu odczytanego z PDF (pierwsze ~2500 znaków)</summary>
            <pre className="pdf-text-preview">{auxPdfPreview}</pre>
          </details>}
          {k011PdfLineItems.length > 0 && <div className="k011-pdf-lines">
            <p className="hint"><b>Pozycje z faktury ({k011PdfLineItems.length}) – popraw przed zapisem:</b></p>
            {k011PdfLineItems.map((it, i) => <div key={i} className="k011-line-edit">
              <label>Nazwa<input value={it.name} onChange={e => updateK011LineItem(i, 'name', e.target.value)} placeholder="nazwa towaru" /></label>
              <label>Ilość<input value={it.qty || ''} onChange={e => updateK011LineItem(i, 'qty', e.target.value)} placeholder="np. 4224 szt" /></label>
            </div>)}
          </div>}
          <label>Data dostawy<input type="date" value={auxForm.delivery_date} onChange={e => setAuxForm(prev => ({ ...prev, delivery_date: e.target.value }))} /></label>
          <label>Nazwa towaru / przeznaczenie<input value={auxForm.item_name} onChange={e => setAuxForm(prev => ({ ...prev, item_name: e.target.value }))} placeholder="np. kartony, worki, etykiety" /></label>
          <label>Dostawca / nr faktury<input value={auxForm.supplier_invoice} onChange={e => setAuxForm(prev => ({ ...prev, supplier_invoice: e.target.value }))} placeholder="np. Firma X / FV/123/2026" /></label>
          <label>Stan higieniczny pojazdu<select value={auxForm.vehicle_hygiene} onChange={e => setAuxForm(prev => ({ ...prev, vehicle_hygiene: e.target.value }))}><option value="P">P</option><option value="N">N</option></select></label>
          <label>Ilość<input value={auxForm.qty} onChange={e => setAuxForm(prev => ({ ...prev, qty: e.target.value }))} placeholder="np. 500 szt." /></label>
          <label>Nadany numer partii<input value={auxForm.lot_no} onChange={e => setAuxForm(prev => ({ ...prev, lot_no: e.target.value }))} placeholder="jeśli dotyczy" /></label>
          <label>Podpis przyjmującego<select value={auxForm.signed_by} onChange={e => setAuxForm(prev => ({ ...prev, signed_by: e.target.value }))}><option value="">Wybierz pracownika</option>{employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}</select></label>
          <label>Uwagi<input value={auxForm.notes} onChange={e => setAuxForm(prev => ({ ...prev, notes: e.target.value }))} /></label>
        </div>
        <div className="actions">
          <button onClick={saveAuxMaterial}>{auxForm.id ? 'Zapisz zmiany' : 'Dodaj do kartoteki'}</button>
          {!auxForm.id && k011PdfLineItems.length > 1 && <button type="button" className="secondary" onClick={saveAuxMaterialsBatchFromPdf}>Zapisz wszystkie pozycje z faktury ({k011PdfLineItems.length})</button>}
          <button type="button" className="secondary" onClick={resetAuxForm}>Wyczyść</button>
        </div>
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
          {rowsForPaper.map((r,i)=><tr key={r.id}><td>{i+1}</td><td>{r.delivery_date}</td><td className="left">{r.item_name}</td><td className="left">{r.supplier_invoice}</td><td>{normalizePN(r.vehicle_hygiene || 'P')}</td><td>{r.qty}</td><td>{r.lot_no}</td><td className="left">{r.notes}</td><td>{r.signed_by}</td><td className="no-print"><button className="mini secondary" onClick={()=>editAuxMaterial(r)}>Edytuj</button>{isAdmin(authProfile) && <button className="mini danger" onClick={()=>deleteAuxMaterial(r)}>Usuń</button>}</td></tr>)}
          {blanks.map((_,i)=><tr key={`blank-${i}`} className="blank-row"><td>{rowsForPaper.length+i+1}</td><td></td><td></td><td></td><td>P</td><td></td><td></td><td></td><td></td><td className="no-print"></td></tr>)}
        </tbody></table>
      </div>
    </>
  }

  function renderHaccpPreview(doc) {
    if (!doc) return null
    if (doc.groupPreview) {
      const liveGroup = hubManualGroups.find(g => g.key === doc.group?.key)
        || haccpMonthlyGroups.find(g => g.key === doc.group?.key)
        || doc.group
      return <div className="modal-backdrop" onClick={() => setSelectedHaccpDoc(null)}><div className="haccp-modal wide" onClick={e => e.stopPropagation()}><div className="haccp-paper">{renderGroupPreviewTable(liveGroup)}</div><div className="modal-actions no-print">
        {liveGroup.type === 'K03' && (liveGroup.docs || [])[0] && (liveGroup.docs[0].frozen
          ? <>
            <span className="status ok">Zamrożony – FIFO nie zmieni tej kartoteki</span>
            <button className="secondary" onClick={() => unfreezeK03Document(liveGroup.docs[0])}>Odmroź</button>
          </>
          : <span className="pill">Roboczy – uzupełnij dane; prawidłowy K03 zamraża się automatycznie przy tworzeniu</span>)}
        <button className="secondary" onClick={() => printHaccpGroup(liveGroup)}><Printer size={16}/> Drukuj / PDF</button><button className="secondary" onClick={() => exportHaccpGroupExcel(liveGroup)}>Pobierz Excel</button>
        {isAdmin(authProfile) && liveGroup.type === 'R02' && <button className="secondary danger" onClick={() => deleteR02Month(liveGroup)}><Trash2 size={16}/> Usuń kartotekę</button>}
        {isAdmin(authProfile) && liveGroup.type === 'R01' && <button className="secondary danger" onClick={() => deleteR01Month(liveGroup)}><Trash2 size={16}/> Usuń kartotekę</button>}
        {isAdmin(authProfile) && liveGroup.type === 'R13' && <button className="secondary danger" onClick={() => deleteR13Month(liveGroup)}><Trash2 size={16}/> Usuń kartotekę</button>}
        {isAdmin(authProfile) && String(liveGroup.type || '').startsWith('K') && <button className="secondary danger" onClick={() => deleteKartotekaGroup(liveGroup)} disabled={haccpBusy}><Trash2 size={16}/> Usuń kartotekę</button>}
        {isAdmin(authProfile) && isRMonthlyReport(liveGroup.type) && <button className="secondary danger" onClick={async () => {
          if (!supabase || !ensureCanDelete() || !confirmDelete(`Kartotekę ${liveGroup.type} za ${liveGroup.period}.`)) return
          await auditDeleteHaccpDocuments(supabase, liveGroup.docs || [], getAuditActor(), `${liveGroup.type} ${liveGroup.period}`)
          await loadHaccpDocs()
          setSelectedHaccpDoc(null)
          setMessage(`${liveGroup.type}: usunięto kartotekę (zapis w historii).`)
        }}><Trash2 size={16}/> Usuń kartotekę</button>}
        <button className="secondary" onClick={() => setSelectedHaccpDoc(null)}>Zamknij</button></div></div></div>
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
    try {
      const all = JSON.parse(localStorage.getItem(DOCS_FILTERS_STORAGE_KEY) || '{}')
      applyDocsFilterSnapshot(all[docsFilter] || {})
    } catch {
      applyDocsFilterSnapshot({})
    }
    docsFiltersHydrated.current = true
    const t = setTimeout(() => { docsFiltersSkipSave.current = false }, 0)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (!docsFiltersHydrated.current || docsFiltersSkipSave.current) return
    persistDocsFilters(docsFilter, getDocsFilterSnapshot())
  }, [docsDateFrom, docsDateTo, docsWorkflowFilter, haccpSearch, haccpStatusFilter, k03AssortmentFilter])

  useEffect(() => {
    if (docsHubSection !== 'wykazy' || docsWykazFilter !== 'W03' || !supabase) return
    const count = (haccpDocs || []).filter(d => d.document_type === 'W03').length
    if (count === 0) ensureW03Seed(false)
  }, [docsHubSection, docsWykazFilter, haccpDocs, supabase])

  useEffect(() => {
    if (skipAuth || !supabase) {
      if (!skipAuth) setAuthReady(true)
      return
    }
    let mounted = true
    ;(async () => {
      const { session, profile } = await getCurrentSession()
      if (!mounted) return
      setAuthSession(session)
      setAuthProfile(profile)
      setAuthReady(true)
      if (profile && isMagazynier(profile)) setActiveTab('kartoteki')
    })()
    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'TOKEN_REFRESHED') return
      setAuthSession(session)
      if (session?.user?.id) {
        try {
          const profile = await loadAppProfile(supabase, session.user.id)
          setAuthProfile(prev => (prev?.auth_user_id === profile?.auth_user_id && prev?.role === profile?.role ? prev : profile))
          if (profile && isMagazynier(profile)) setActiveTab(t => t === 'dashboard' ? 'kartoteki' : t)
        } catch {
          setAuthProfile(null)
        }
      } else {
        setAuthProfile(null)
        loadedForUserRef.current = null
      }
    })
    return () => {
      mounted = false
      sub?.subscription?.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!authProfile) return
    if (!canSeeTab(authProfile, activeTab)) {
      setActiveTab(isMagazynier(authProfile) ? 'kartoteki' : 'dashboard')
    }
  }, [authProfile, activeTab])

  useEffect(() => {
    if (!authProfile) return
    if (!canSeeDocsHubSection(authProfile, docsHubSection)) {
      setDocsHubSection('kartoteki')
      closeHubFlyouts(null)
    }
  }, [authProfile, docsHubSection])

  function getAuditActor() {
    return auditActor(authProfile, authSession)
  }

  function isPersistedHaccpDoc(doc) {
    if (!doc?.id || doc.synthetic) return false
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(doc.id))
  }

  function kartotekaGroupLabel(group) {
    if (!group) return ''
    if (group.type === 'K03') {
      const d = group.docs?.[0]
      return `WZ ${d?.document_no || ''} · ${d?.product_name || group.product || ''}`.trim()
    }
    const parts = [group.period, group.product, group.chamber].filter(Boolean)
    return parts.join(' · ')
  }

  async function deleteKartotekaGroup(group) {
    if (!supabase || !group?.docs?.length) return
    if (!ensureCanDelete()) return
    const deletable = group.docs.filter(isPersistedHaccpDoc)
    if (!deletable.length) {
      setMessage(`${group.type}: ta kartoteka jest generowana automatycznie z magazynu (partie/FIFO). Usuń import Excel lub partie w Magazynie – wpisy znikną same.`)
      return
    }
    const label = kartotekaGroupLabel(group)
    const fifoNote = group.type === 'K03'
      ? '\n\nFIFO i rozliczenia partii NIE zostaną zmienione – znika tylko dokumentacja K03. WZ wróci do kolejki do ponownego utworzenia K03.'
      : ''
    if (!confirmDelete(`Całą kartotekę ${group.type}${label ? `: ${label}` : ''} (${deletable.length} wpisów).\n\nWpis trafi do historii – administrator może przywrócić.${fifoNote}`)) return
    setHaccpBusy(true)
    try {
      await auditDeleteHaccpDocuments(supabase, deletable, getAuditActor(), `${group.type} ${label || group.period || ''}`.trim())
      setHaccpDocs(prev => prev.filter(d => !deletable.some(x => x.id === d.id)))
      if (group.type === 'K03') await loadK03TraceData()
      setSelectedHaccpDoc(null)
      setMessage(`${group.type}: usunięto kartotekę (${deletable.length} wpisów) – zapis w Historii.`)
    } catch (err) {
      setMessage(`${group.type}: ${err.message}`)
    } finally {
      setHaccpBusy(false)
    }
  }

  function ensureCanDelete() {
    if (!canDelete(authProfile)) {
      setMessage('Tylko administrator może usuwać wpisy.')
      return false
    }
    return true
  }

  async function handleLogout() {
    loadedForUserRef.current = null
    setAuthProfile(null)
    setAuthSession(null)
    setMessage('Wylogowano.')
    try {
      await signOut()
    } catch {
      /* sesja lokalna i tak wyczyszczona */
    }
  }

  useEffect(() => {
    if (activeTab === 'kartoteki' && docsFilter === 'K03') {
      loadK03TraceData()
    }
  }, [activeTab, docsFilter])

  useEffect(() => {
    if (!isSupabaseConfigured) return
    if (!authReady) return
    if (!authProfile && !skipAuth) return

    const userKey = authProfile?.auth_user_id || (skipAuth ? 'dev' : '')
    if (!userKey) return
    if (loadedForUserRef.current === userKey) return
    loadedForUserRef.current = userKey

    const isMag = isMagazynier(authProfile)
    ;(async () => {
      if (!isMag) {
        await loadFifoData()
        loadImports()
        loadPzManagementData()
        await loadK03SnapshotsOnly()
        await loadK03TraceData()
        await loadFifoChangeLog()
      }
      loadHaccpDocs({ syncK01: true })
      loadEmployees()
      loadAuxMaterials()
    })()
  }, [authReady, authProfile?.auth_user_id, skipAuth])

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

  async function runUnfreezeMonthK03() {
    if (!supabase) {
      setMessage('Brak konfiguracji Supabase.')
      return null
    }
    const month = String(k03BulkMonth || '').slice(0, 7)
    const { frozen, total, ready, pending } = k03BulkMonthStats
    if (total === 0) {
      setMessage(`Brak WZ/K03 z datą WZ w miesiącu ${month}.`)
      return null
    }
    const reason = window.prompt(
      `Odmrozić i przeliczyć K03 za ${month}?\n\n` +
      `WZ w miesiącu: ${total}\n` +
      `Zamrożonych: ${frozen}\n` +
      `Gotowych (otwartych): ${ready}\n` +
      `Oczekujących na decyzję: ${pending}\n\n` +
      `Podaj powód (wymagane):`,
      `Przeliczenie miesiąca ${month} – korekta PZ/FIFO`
    )
    if (!reason?.trim()) {
      setMessage('Anulowano – brak powodu odmrożenia.')
      return null
    }
    if (!window.confirm(
      `Potwierdź: odmrożenie ${frozen} kartotek i przeliczenie ${ready + frozen} K03 za ${month} (wg daty WZ).\n\n` +
      `PZ późniejsze niż data WZ nie będą przypisane. Kompletne K03 zamrożą się ponownie automatycznie.`
    )) return null

    setFifoRecalculating(true)
    try {
      const result = await unfreezeAndResyncK03ByWzMonth(supabase, month, { changedBy: userRole, reason: reason.trim() })
      await loadFifoData()
      await loadK03TraceData()
      await loadHaccpDocs()
      await loadPzManagementData()
      await loadFifoChangeLog()
      const errNote = result.errors?.length ? ` Błędy (${result.errors.length}): ${result.errors.slice(0, 2).join('; ')}` : ''
      setMessage(
        `Miesiąc ${month}: odmrożono ${result.unfrozen}, przeliczono ${result.resynced} K03` +
        (result.autoRefrozen ? `, ponownie zamrożono ${result.autoRefrozen} kompletnych` : '') +
        (pending ? `, ${pending} WZ nadal oczekuje na decyzję` : '') +
        `${errNote}`
      )
      return result
    } catch (err) {
      setMessage(`Błąd przeliczenia miesiąca: ${err?.message || String(err)}`)
      return null
    } finally {
      setFifoRecalculating(false)
    }
  }

  async function runResyncOpenK03(showConfirm = true) {
    if (!supabase) {
      setMessage('Brak konfiguracji Supabase.')
      return null
    }
    const openCount = (wzQueueLines || []).filter(l => l.status !== 'pending' && !l.frozen && l.status !== 'frozen').length
    const frozenCount = (wzQueueLines || []).filter(l => l.frozen || l.status === 'frozen').length
    if (openCount === 0 && frozenCount > 0) {
      setMessage(`Wszystkie K03 (${frozenCount}) są zamrożone. Odmroź kartotekę, cofnij decyzję i utwórz K03 ponownie.`)
      return null
    }
    if (showConfirm && !window.confirm(
      `Przeliczyć otwarte K03 wg nowych reguł FIFO?\n\n` +
      `• Otwarte K03 do aktualizacji: ${openCount}\n` +
      `• Zamrożone (pominięte): ${frozenCount}\n\n` +
      `PZ z datą późniejszą niż WZ/przerób nie będą przypisane. Braki pojawią się jako ostrzeżenie.`
    )) return null

    setFifoRecalculating(true)
    try {
      const result = await resyncOpenK03FromFifo(supabase, { changedBy: userRole })
      await loadFifoData()
      await loadK03TraceData()
      await loadHaccpDocs()
      await loadPzManagementData()
      await loadFifoChangeLog()
      const errNote = result.errors?.length ? ` Błędy: ${result.errors.slice(0, 3).join('; ')}` : ''
      setMessage(
        `K03 zsynchronizowane: ${result.updated} zaktualizowano, ${result.skippedFrozen} zamrożonych pominięto, ${result.skippedPending} WZ oczekuje.${errNote}`
      )
      return result
    } catch (err) {
      setMessage(`Błąd synchronizacji K03: ${err?.message || String(err)}`)
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
        const receiptDate = String(opMap.get(lot.source_operation_id)?.operation_date || lot.production_date || '').slice(0, 10)
        return group === sale.sale_group &&
          Number(lot.remaining_qty || 0) > 0 &&
          receiptDate &&
          receiptDate !== '0000-01-01' &&
          receiptDate <= saleDate
      })
      .sort((a, b) => {
        const dateA = String(opMap.get(a.source_operation_id)?.operation_date || a.production_date || '').slice(0, 10)
        const dateB = String(opMap.get(b.source_operation_id)?.operation_date || b.production_date || '').slice(0, 10)
        return dateA.localeCompare(dateB) ||
          String(a.created_at || '').localeCompare(String(b.created_at || '')) ||
          String(a.lot_no || '').localeCompare(String(b.lot_no || ''))
      })

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
    .select('id, remaining_qty, production_date, created_at, product_group, lot_no, product_id, source_operation_id')
    .gt('remaining_qty', 0)
    .order('production_date', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error

  const sourceOpIds = Array.from(new Set((lots || []).map(l => l.source_operation_id).filter(Boolean)))
  const sourceOps = sourceOpIds.length
    ? await fetchSupabaseInChunks('operations', 'id, operation_date', 'id', sourceOpIds)
    : []
  const sourceOpMap = new Map(sourceOps.map(o => [o.id, o]))
  const opDateCutoff = String(operationDate || '9999-12-31').slice(0, 10)

  const matchingLots = (lots || []).filter(lot => {
    const lotGroup = lot.product_group
    const groupMatch = lotGroup && saleGroup ? lotGroup === saleGroup : lot.product_id === productId
    const receiptDate = String(sourceOpMap.get(lot.source_operation_id)?.operation_date || lot.production_date || '').slice(0, 10)
    return groupMatch &&
      receiptDate &&
      receiptDate !== '0000-01-01' &&
      receiptDate <= opDateCutoff
  }).sort((a, b) => {
    const dateA = String(sourceOpMap.get(a.source_operation_id)?.operation_date || a.production_date || '').slice(0, 10)
    const dateB = String(sourceOpMap.get(b.source_operation_id)?.operation_date || b.production_date || '').slice(0, 10)
    return dateA.localeCompare(dateB) ||
      String(a.created_at || '').localeCompare(String(b.created_at || '')) ||
      String(a.lot_no || '').localeCompare(String(b.lot_no || ''))
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
        const [{ data: traceAllocations }, { data: prodOps }] = await Promise.all([
          supabase.from('fifo_allocations').select('id, qty, source_lot_id, output_lot_id, operation_id').limit(20000),
          supabase.from('operations').select('id, operation_type, operation_date, document_no').eq('operation_type', 'produkcja').limit(20000)
        ])
        const saleOpIds = Array.from(new Set((traceAllocations || []).map(a => a.operation_id).filter(Boolean)))
        const saleOps = saleOpIds.length
          ? await fetchSupabaseInChunks('operations', 'id, operation_type, operation_date, document_no', 'id', saleOpIds)
          : []
        const opById = new Map()
        for (const op of [...(prodOps || []), ...saleOps]) {
          if (op?.id) opById.set(op.id, op)
        }
        setFormsTrace({ allocations: traceAllocations || [], operations: Array.from(opById.values()) })
        const { data: k06Existing } = await supabase.from('haccp_documents').select('id, document_type, lot_id, lot_no').eq('document_type', 'K06')
        const traceOps = Array.from(opById.values())
        const k06Added = await syncAutoK06Documents(lotsData, traceOps, k06Existing || [])
        const { data: k07Existing } = await supabase.from('haccp_documents').select('id, document_type, operation_id, data').eq('document_type', 'K07')
        const k07Added = await syncAutoK07Documents(lotsData, traceOps, traceAllocations || [], k07Existing || [])
        const k01Added = await syncAutoK01Documents(lotsData)
        if (k06Added > 0 || k07Added > 0 || k01Added > 0) await loadHaccpDocs()
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
      const sourceProductName = sourceLot.products?.name || 'surowiec do przerobu'
      await supabase.from('haccp_documents').insert(buildK07InsertPayload({
        document_type: 'K07',
        operation_id: op.id,
        document_date: today,
        product_name: sourceProductName,
        lot_no: outLot?.lot_no || '',
        document_no: `K07/${documentNo}`,
        status: 'P',
        data: {
          godzina: '12:00',
          surowiec: sourceProductName,
          numer_partii: outLot?.lot_no || '',
          stan_sita: 'P',
          podpis_kontrolujacego: '',
          operation_id: op.id
        }
      }))

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
          data: normalizeK06Data({ barwa: 'P', zapach: 'P', twardosc_jablko: 'P', brak_plesni: 'P', auto_source: 'produkcja' })
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
    if (!ensureCanDelete()) return
    if (!confirmDelete(`Import Excel: ${fileNameForConfirm || fileId}.\n\nOperacja usunie powiązane operacje, partie, FIFO i kartoteki K powiązane z tym importem.`)) return
    const typed = window.prompt('Potwierdź wpisując: USUN IMPORT (bez polskich znaków)')
    if (normalizeText(typed) !== 'usun import') {
      setMessage('Usuwanie anulowane — wpisz dokładnie: USUN IMPORT')
      return
    }
    const reason = window.prompt('Podaj powód usunięcia importu (np. dane testowe):')
    if (!String(reason || '').trim()) {
      setMessage('Usuwanie anulowane — powód jest wymagany.')
      return
    }
    setImportDeleting(true)
    try {
      const { error } = await supabase.rpc('delete_import_excel_admin', {
        p_imported_file_id: fileId,
        p_reason: String(reason).trim(),
        p_user_role: isAdmin(authProfile) ? 'admin' : (authProfile?.role || 'magazynier')
      })
      if (error) throw error
      setMessage('Import usunięty. Powiązane operacje, partie i FIFO zostały wyczyszczone.')
      setImportPreview([])
      setRows([])
      setFileName('')
      await loadImports()
      await loadFifoData()
      await loadHaccpDocs()
      await loadK03TraceData()
      await loadPzManagementData()
    } catch (err) {
      const msg = String(err?.message || err)
      if (/permission denied|42501|function.*does not exist/i.test(msg)) {
        setMessage(`Błąd usuwania importu: ${msg}. Uruchom w Supabase SQL: 2026-v37-fix-delete-import.sql`)
      } else {
        setMessage(`Błąd usuwania importu: ${msg}`)
      }
    } finally {
      setImportDeleting(false)
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
    if (!ensureCanDelete()) return
    if (!confirmDelete(`Pracownika z listy podpisów: ${employee.full_name}.`)) return
    try {
      const before = { ...employee }
      const { error } = await supabase
        .from('haccp_employees')
        .update({ is_active: false })
        .eq('id', employee.id)
      if (error) throw error
      await logAuditSoftDeleteEmployee(before)
      await loadEmployees()
      loadAuxMaterials()
      setMessage('Pracownik został ukryty z listy podpisów.')
    } catch (err) {
      setMessage(`Błąd usuwania pracownika: ${err.message}`)
    }
  }

  async function logAuditSoftDeleteEmployee(employee) {
    await logAudit(supabase, {
      entity_type: 'haccp_employee',
      entity_id: employee.id,
      action: 'delete',
      summary: `Pracownik: ${employee.full_name}`,
      before_data: employee,
      changed_by: getAuditActor().changedBy,
      changed_by_email: getAuditActor().changedByEmail,
      can_restore: false
    })
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

  async function syncAutoK01Documents(lotsData = null) {
    if (!supabase) return 0
    const { data: k01Existing } = await supabase
      .from('haccp_documents')
      .select('id, document_type, lot_id, lot_no')
      .eq('document_type', 'K01')
    const existingLotIds = new Set((k01Existing || []).map(d => d.lot_id).filter(Boolean))

    let lots = lotsData
    if (!lots) {
      const { data: lotsRaw, error: lotsErr } = await supabase
        .from('lots')
        .select('id, lot_no, product_id, product_group, production_date, created_at, initial_qty, remaining_qty, source_operation_id, storage_chamber_id')
        .limit(50000)
      if (lotsErr) throw lotsErr
      const productIds = Array.from(new Set((lotsRaw || []).map(l => l.product_id).filter(Boolean)))
      const chamberIds = Array.from(new Set((lotsRaw || []).map(l => l.storage_chamber_id).filter(Boolean)))
      const [productsRaw, chambersRaw] = await Promise.all([
        productIds.length ? fetchSupabaseInChunks('products', 'id, name, product_group', 'id', productIds) : Promise.resolve([]),
        chamberIds.length ? fetchSupabaseInChunks('storage_chambers', 'id, code', 'id', chamberIds) : Promise.resolve([])
      ])
      const productMap = new Map((productsRaw || []).map(p => [p.id, p]))
      const chamberMap = new Map((chambersRaw || []).map(c => [c.id, c]))
      lots = (lotsRaw || []).map(l => ({
        ...l,
        products: productMap.get(l.product_id) || null,
        chamber: chamberMap.get(l.storage_chamber_id) || null
      }))
    }

    const candidateLots = (lots || []).filter(l => !existingLotIds.has(l.id))
    if (!candidateLots.length) return 0

    const opIds = Array.from(new Set(candidateLots.map(l => l.source_operation_id).filter(Boolean)))
    const operations = opIds.length
      ? await fetchSupabaseInChunks(
        'operations',
        'id, operation_type, operation_date, document_no, contractor_id, contractors(name)',
        'id',
        opIds
      )
      : []

    const trace = { lots: candidateLots, operations }
    const pending = buildSyntheticK01DocsFromTrace(trace, k01Existing || [], {
      defaultSignature: defaultK01Employee || ''
    })
    if (!pending.length) return 0

    let inserted = 0
    for (const doc of pending) {
      const { error } = await supabase.from('haccp_documents').insert(buildK01InsertPayload(doc))
      if (!error) inserted += 1
    }
    return inserted
  }

  async function syncAutoK07Documents(lotsData, operations, allocations, currentDocs) {
    if (!supabase) return 0
    const trace = { lots: lotsData, operations, allocations }
    const pending = buildSyntheticK07DocsFromTrace(trace, {}, currentDocs)
    if (!pending.length) return 0
    let inserted = 0
    for (const doc of pending) {
      const { error } = await supabase.from('haccp_documents').insert(buildK07InsertPayload(doc))
      if (!error) inserted += 1
    }
    return inserted
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

  async function loadHaccpDocs(options = {}) {
    if (!supabase) return
    if (haccpLoadInFlightRef.current) return haccpLoadInFlightRef.current
    haccpLoadInFlightRef.current = (async () => {
      try {
        if (options.syncK01) {
          const k01Added = await syncAutoK01Documents()
          if (k01Added > 0) {
            setMessage(`Uzupełniono ${k01Added} brakujących kart K01 (przyjęcia PZ/MM, ocena P).`)
          }
        }
        const data = await fetchAllHaccpDocuments(supabase)
        setHaccpDocs(data)
        if (data.length >= HACCP_DOCS_LOAD_MAX) {
          setMessage(`Wczytano ${data.length.toLocaleString('pl-PL')} kartotek (górny limit). Użyj filtra dat w panelu bocznym, aby zawęzić widok.`)
        }
      } catch (err) {
        setHaccpDocs([])
        const msg = String(err?.message || err)
        if (/permission denied|row-level security|42501/i.test(msg)) {
          setMessage('Brak dostępu do kartotek po zalogowaniu. Uruchom w Supabase SQL: LOGOWANIE-KROK-5-haccp-rls-authenticated.sql')
        } else {
          setMessage(`Błąd wczytywania kartotek: ${msg}`)
        }
      } finally {
        haccpLoadInFlightRef.current = null
      }
    })()
    return haccpLoadInFlightRef.current
  }

  function mergeHaccpDoc(id, patch) {
    setHaccpDocs(prev => patchHaccpDocInList(prev, id, patch))
    setSelectedHaccpDoc(prev => {
      if (!prev?.groupPreview || !prev.group?.docs?.some(d => d.id === id)) return prev
      return {
        ...prev,
        group: {
          ...prev.group,
          docs: patchHaccpDocInList(prev.group.docs, id, patch)
        }
      }
    })
  }

  function haccpDocBelongsToGroup(doc, group) {
    if (!doc || !group?.type) return false
    if (doc.document_type !== group.type) return false
    const period = doc.data?.month_key || String(doc.document_date || '').slice(0, 7)
    return period === group.period
  }

  function mergeHaccpDocsBatch(rows, removedIds = []) {
    setHaccpDocs(prev => {
      const filtered = removedIds.length ? prev.filter(d => !removedIds.includes(d.id)) : prev
      return mergeHaccpDocs(filtered, rows)
    })
    setSelectedHaccpDoc(prev => {
      if (!prev?.groupPreview || !prev.group) return prev
      let docs = prev.group.docs || []
      const hadRemoved = removedIds.some(id => docs.some(d => d.id === id))
      if (removedIds.length) docs = docs.filter(d => !removedIds.includes(d.id))
      const matching = (rows || []).filter(r => haccpDocBelongsToGroup(r, prev.group))
      if (matching.length) docs = mergeHaccpDocs(docs, matching)
      if (!hadRemoved && !matching.length) return prev
      return { ...prev, group: { ...prev.group, docs } }
    })
  }

  const allTabs = [
    ['dashboard', 'Start', LayoutDashboard],
    ['importy', 'Importy Excel', Upload],
    ['pz', 'PZ / FIFO', Database],
    ['magazyn', 'Magazyn', Warehouse],
    ['kartoteki', 'Dokumentacja HACCP', ClipboardList],
    ['historia', 'Historia', History],
    ['ustawienia', 'Ustawienia', Settings]
  ]
  const tabs = allTabs.filter(([key]) => canSeeTab(authProfile, key))

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

  if (!authReady) {
    return <div className="login-screen"><div className="login-card"><p>Ładowanie sesji…</p></div></div>
  }

  if (!authProfile && !skipAuth) {
    return (
      <LoginScreen
        supabaseConfigured={isSupabaseConfigured}
        onSuccess={({ session, profile }) => {
          setAuthSession(session)
          setAuthProfile(profile)
          if (isMagazynier(profile)) setActiveTab('kartoteki')
        }}
      />
    )
  }

  return <div className="page">
    <header>
      <div>
        <p className="eyebrow">AGRO-MAR</p>
        <h1>HACCP / IFS / FIFO</h1>
        <p className="lead">Osobny system do importu operacji, numerów partii, FIFO i dokumentacji jakościowej.</p>
        {authProfile && (
          <p className="hint user-bar">
            {authDisplayName(authProfile, authSession)} · {authProfile.role === 'admin' ? 'Administrator' : 'Magazynier'}
            {!skipAuth && (
              <button type="button" className="linkish" onClick={handleLogout} style={{ marginLeft: 12 }}><LogOut size={14} /> Wyloguj</button>
            )}
          </p>
        )}
      </div>
      <div className="badge"><ShieldCheck size={18}/> K03 {K03_ENGINE_VERSION} · WZ {K03_WZ_ENGINE_VERSION} · R13 {R13_ENGINE_VERSION} · R {RAPORTY_ENGINE_VERSION} · W {WYKAZY_ENGINE_VERSION} · F {FORMULARZE_ENGINE_VERSION} · PR {PROTOKOLY_ENGINE_VERSION} · S {SPECYFIKACJE_ENGINE_VERSION}</div>
    </header>

    <section className="warning">
      <AlertTriangle size={20}/>
      <div><strong>Ważne:</strong> ta aplikacja ma być podłączona wyłącznie do nowego projektu Supabase <b>AGRO-MAR-HACCP</b>, nigdy do starej bazy opakowań.</div>
    </section>

    {renderK03UnfreezeBanner()}


    <nav className="top-tabs">
      {tabs.map(([key, label, Icon]) => <button key={key} className={activeTab === key ? 'tab active' : 'tab'} onClick={() => setActiveTab(key)}><Icon size={16}/>{label}</button>)}
    </nav>

    {activeTab === 'dashboard' && canSeeTab(authProfile, 'dashboard') && <>
    <div className="grid stats">
      <StatCard icon={Package} value={dashboardCompliance.summary.ok} label="formularzy uzupełnionych" />
      <StatCard icon={AlertTriangle} value={dashboardCompliance.summary.warn + dashboardCompliance.summary.missing} label="wymaga uwagi" />
      <StatCard icon={Database} value={isSupabaseConfigured ? 'TAK' : 'NIE'} label="Supabase skonfigurowany" />
      <StatCard icon={ClipboardList} value={dashboardCompliance.period} label="sprawdzany okres" />
    </div>

    <section className="card">
      <div className="section-title"><ClipboardList/><div>
        <h2>Status formularzy HACCP</h2>
        <p>Sprawdzenie uzupełnienia wg harmonogramu. Kliknij kartę, aby przejść do formularza z filtrem wybranego miesiąca.</p>
      </div></div>
      <div className="dashboard-period-row no-print">
        <label>Okres kontroli (miesiąc)
          <input type="month" value={dashboardMonth} onChange={e => setDashboardMonth(e.target.value)} />
        </label>
        <button className="secondary" onClick={() => { loadHaccpDocs({ syncK01: true }); loadFifoData(); loadK03TraceData(); loadAuxMaterials() }}><RefreshCcw size={16}/> Odśwież dane</button>
      </div>
      <div className="compliance-summary-row">
        <span className={complianceStatusClass('ok')}>{dashboardCompliance.summary.ok} uzupełnione</span>
        <span className={complianceStatusClass('warn')}>{dashboardCompliance.summary.warn} do uzupełnienia</span>
        <span className={complianceStatusClass('missing')}>{dashboardCompliance.summary.missing} brakuje</span>
        <span className={complianceStatusClass('na')}>{dashboardCompliance.summary.na} nie dotyczy</span>
      </div>
      {['Kartoteki', 'Raporty', 'Wykazy'].map(groupName => {
        const groupItems = dashboardCompliance.items.filter(i => i.group === groupName)
        if (!groupItems.length) return null
        return <div key={groupName} className="compliance-group">
          <h3>{groupName}</h3>
          <div className="module-status-grid">
            {groupItems.map(row => <button type="button" key={row.code} className={`module-status-card compliance-card compliance-${row.status}`} onClick={() => goToComplianceForm(row.code)}>
              <div className="module-status-head"><b>{row.code}</b><span className={complianceStatusClass(row.status)}>{complianceStatusLabel(row.status)}</span></div>
              <strong>{row.name}</strong>
              <small className="compliance-rule">{row.rule}</small>
              <small className="compliance-summary">{row.summary}</small>
              {row.gaps?.length > 0 && <ul className="compliance-gaps">{row.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul>}
            </button>)}
          </div>
        </div>
      })}
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


    {activeTab === 'importy' && canSeeTab(authProfile, 'importy') && <>
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
          <td className="row-actions"><button className="secondary mini" onClick={() => loadImportPreview(f.id)}><Eye size={14}/> Podgląd</button>{isAdmin(authProfile) && <button className="danger mini" disabled={importDeleting} onClick={() => deleteImportedFile(f.id, f.filename || f.file_name)}><Trash2 size={14}/> {importDeleting ? '…' : 'Usuń'}</button>}</td>
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


    {activeTab === 'pz' && canSeeTab(authProfile, 'pz') && <>
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


    {activeTab === 'magazyn' && canSeeTab(authProfile, 'magazyn') && <>
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

    {activeTab === 'kartoteki' && canSeeTab(authProfile, 'kartoteki') && <>
    <div className="docs-hub">
      <header className="docs-hub-head">
        <div className="section-title"><ClipboardList/><div><h2>Dokumentacja HACCP</h2><p>Kartoteki, raporty, wykazy, formularze i protokoły w jednym miejscu.</p></div></div>
      </header>

      <nav className="docs-hub-nav" ref={docsHubNavRef}>
        {DOCS_HUB_SECTIONS.filter(([key]) => canSeeDocsHubSection(authProfile, key)).map(([key, label, desc]) => {
          if (key === 'kartoteki') {
            return (
              <div
                key={key}
                className={`docs-hub-tab-wrap ${docsHubSection === key ? 'active' : ''}`}
              >
                <button
                  type="button"
                  className={`docs-hub-tab has-flyout ${docsHubSection === key ? 'active' : ''} ${docsFlyoutOpen ? 'flyout-open' : ''}`}
                  onClick={() => openHubTab(key)}
                  aria-expanded={docsFlyoutOpen}
                >
                  <b>{label}</b><small>{desc}</small>
                </button>
                {docsFlyoutOpen && docsHubSection === key && (
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
          if (key === 'raporty') {
            return (
              <div
                key={key}
                className={`docs-hub-tab-wrap ${docsHubSection === key ? 'active' : ''}`}
              >
                <button
                  type="button"
                  className={`docs-hub-tab has-flyout ${docsHubSection === key ? 'active' : ''} ${docsRaportFlyoutOpen ? 'flyout-open' : ''}`}
                  onClick={() => openHubTab(key)}
                  aria-expanded={docsRaportFlyoutOpen}
                >
                  <b>{label}</b><small>{desc}</small>
                </button>
                {docsRaportFlyoutOpen && docsHubSection === key && (
                  <div className="docs-k-flyout">
                    {RAPORTY_CARDS.map(([code, title, cardDesc]) => (
                      <button
                        key={code}
                        type="button"
                        className={docsRaportFilter === code && docsHubSection === 'raporty' ? 'active' : ''}
                        onClick={() => selectRaport(code)}
                      >
                        <b>{code}</b>
                        <span>{title.replace(/^R[0-9]+ – /, '')}</span>
                        <small>{cardDesc}</small>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          }
          if (key === 'wykazy') {
            return (
              <div
                key={key}
                className={`docs-hub-tab-wrap ${docsHubSection === key ? 'active' : ''}`}
              >
                <button
                  type="button"
                  className={`docs-hub-tab has-flyout ${docsHubSection === key ? 'active' : ''} ${docsWykazFlyoutOpen ? 'flyout-open' : ''}`}
                  onClick={() => openHubTab(key)}
                  aria-expanded={docsWykazFlyoutOpen}
                >
                  <b>{label}</b><small>{desc}</small>
                </button>
                {docsWykazFlyoutOpen && docsHubSection === key && (
                  <div className="docs-k-flyout">
                    {WYKAZY_CARDS.map(([code, title, cardDesc]) => (
                      <button
                        key={code}
                        type="button"
                        className={docsWykazFilter === code && docsHubSection === 'wykazy' ? 'active' : ''}
                        onClick={() => selectWykaz(code)}
                      >
                        <b>{code}</b>
                        <span>{title.replace(/^W[0-9]+ – /, '')}</span>
                        <small>{cardDesc}</small>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          }
          if (key === 'formularze') {
            return (
              <div
                key={key}
                className={`docs-hub-tab-wrap ${docsHubSection === key ? 'active' : ''}`}
              >
                <button type="button" className={`docs-hub-tab has-flyout ${docsHubSection === key ? 'active' : ''} ${docsFormularzFlyoutOpen ? 'flyout-open' : ''}`} onClick={() => openHubTab(key)} aria-expanded={docsFormularzFlyoutOpen}>
                  <b>{label}</b><small>{desc}</small>
                </button>
                {docsFormularzFlyoutOpen && docsHubSection === key && (
                  <div className="docs-k-flyout">
                    {FORMULARZE_CARDS.map(([code, title, cardDesc]) => (
                      <button key={code} type="button" className={docsFormularzFilter === code && docsHubSection === 'formularze' ? 'active' : ''} onClick={() => selectFormularz(code)}>
                        <b>{code}</b><span>{title.replace(/^F[0-9.]+ – /, '')}</span><small>{cardDesc}</small>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          }
          if (key === 'protokoly') {
            return (
              <div
                key={key}
                className={`docs-hub-tab-wrap ${docsHubSection === key ? 'active' : ''}`}
              >
                <button type="button" className={`docs-hub-tab has-flyout ${docsHubSection === key ? 'active' : ''} ${docsProtokolFlyoutOpen ? 'flyout-open' : ''}`} onClick={() => openHubTab(key)} aria-expanded={docsProtokolFlyoutOpen}>
                  <b>{label}</b><small>{desc}</small>
                </button>
                {docsProtokolFlyoutOpen && docsHubSection === key && (
                  <div className="docs-k-flyout">
                    {PROTOKOLY_CARDS.map(([code, title, cardDesc]) => (
                      <button key={code} type="button" className={docsProtokolFilter === code && docsHubSection === 'protokoly' ? 'active' : ''} onClick={() => selectProtokol(code)}>
                        <b>{code}</b><span>{title.replace(/^PR[0-9]+ – /, '')}</span><small>{cardDesc}</small>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          }
          if (key === 'specyfikacje') {
            return (
              <div
                key={key}
                className={`docs-hub-tab-wrap ${docsHubSection === key ? 'active' : ''}`}
              >
                <button type="button" className={`docs-hub-tab has-flyout ${docsHubSection === key ? 'active' : ''} ${docsSpecFlyoutOpen ? 'flyout-open' : ''}`} onClick={() => openHubTab(key)} aria-expanded={docsSpecFlyoutOpen}>
                  <b>{label}</b><small>{desc}</small>
                </button>
                {docsSpecFlyoutOpen && docsHubSection === key && (
                  <div className="docs-k-flyout">
                    {SPECYFIKACJE_CARDS.map(([code, title, cardDesc]) => (
                      <button key={code} type="button" className={docsSpecFilter === code && docsHubSection === 'specyfikacje' ? 'active' : ''} onClick={() => selectSpec(code)}>
                        <b>{code}</b><span>{title.replace(/^S[0-9]+ – /, '')}</span><small>{cardDesc}</small>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          }
          return (
            <button key={key} type="button" className={docsHubSection === key ? 'docs-hub-tab active' : 'docs-hub-tab'} onClick={() => openHubTab(key)}>
              <b>{label}</b><small>{desc}</small>
            </button>
          )
        })}
      </nav>

      {canSeeDocsHubSection(authProfile, docsHubSection) && ['raporty', 'wykazy', 'formularze', 'protokoly', 'specyfikacje'].includes(docsHubSection) && renderHubManualSection()}

      {docsHubSection === 'kartoteki' && <>
      {renderK03UnfreezeBanner()}
      <div className="docs-layout">
        {renderDocsSidebar(docsFilterStats)}
        <div className="docs-main">
      <section className="card docs-panel" id="kartoteki-haccp">
        <div className="docs-main-head">
          <div>
            <h3>{HACCPCARDS.find(c => c[0] === docsFilter)?.[1] || docsFilter}</h3>
            <p className="hint">{HACCPCARDS.find(c => c[0] === docsFilter)?.[2]}</p>
          </div>
          <div className="actions docs-actions">
            <button className="secondary" onClick={() => { loadHaccpDocs({ syncK01: true }); loadK03TraceData(); loadFifoData() }}><RefreshCcw size={16}/> Odśwież</button>
            {docsFilter === 'K03' && <>
              <button className="secondary" onClick={() => runResyncOpenK03(true)} disabled={fifoRecalculating}>{fifoRecalculating ? 'K03…' : 'Napraw otwarte K03'}</button>
              <button onClick={() => runFifoIncremental(true)} disabled={fifoRecalculating}>{fifoRecalculating ? 'FIFO…' : 'Uzupełnij FIFO'}</button>
              <button className="secondary" onClick={() => runFifoFullRecalculate(true)} disabled={fifoRecalculating}>Pełne FIFO</button>
            </>}
          </div>
        </div>

        {docsFilter === 'K03' && <>
          <section className="card k03-bulk-panel">
            <div className="section-title"><RefreshCcw size={20}/><div>
              <h3>Przeliczenie miesiąca K03</h3>
              <p className="hint">Wg <b>daty WZ</b>. Odmraża zamrożone kartoteki z wybranego miesiąca, przelicza FIFO (tylko PZ do daty WZ lub przerobu) i zapisuje K03 od nowa.</p>
            </div></div>
            <div className="k03-bulk-row">
              <label>Miesiąc (data WZ)
                <input type="month" value={k03BulkMonth} onChange={e => setK03BulkMonth(e.target.value)} />
              </label>
              <button type="button" onClick={() => runUnfreezeMonthK03()} disabled={fifoRecalculating || k03Loading}>
                {fifoRecalculating ? 'Przeliczanie…' : 'Odmroź miesiąc i przelicz K03'}
              </button>
            </div>
            <p className="hint k03-bulk-stats">
              W {k03BulkMonth}: <b>{k03BulkMonthStats.total}</b> WZ · <b>{k03BulkMonthStats.frozen}</b> zamrożonych · <b>{k03BulkMonthStats.ready}</b> otwartych · <b>{k03BulkMonthStats.pending}</b> oczekuje
            </p>
          </section>
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
                  <td><span className={workflowPillClass(k03LineWorkflowTag(line))}>{workflowPillLabel(k03LineWorkflowTag(line))}</span></td>
                  <td className="row-actions">
                    {canDecide && <>
                      <button className="mini" onClick={() => openK03WzModal(line, 'przerob')}>Przerób</button>
                      <button className="mini secondary" onClick={() => openK03WzModal(line, 'bez_przerobu')}>Bez przerobu</button>
                    </>}
                    {line.k03Form && (() => {
                      const k03Doc = syntheticK03Docs.find(d => d.id === line.formId) || line.k03Form
                      return <button className="mini secondary" onClick={() => setSelectedHaccpDoc({ groupPreview: true, group: { key: line.formId, type: 'K03', product: line.product_name, docs: [k03Doc] } })}><Eye size={14}/></button>
                    })()}
                    {(line.status === 'k03_ready' || line.status === 'legacy_auto') && !line.frozen && isAdmin(authProfile) && <button className="mini danger" onClick={() => revertK03Line(line)}>Cofnij</button>}
                  </td>
                </tr>
              })}</tbody>
            </table></div>}
          </details>
        </>}

        {docsFilter === 'K01.1' && renderK011Section()}
        {getDocFormCfg(docsFilter) && docsHubSection === 'kartoteki' && renderManualHaccpEntrySection()}

        {!['K01.1', 'K04.1', 'K05'].includes(docsFilter) && <>
          {haccpMonthlyGroups.length === 0 && docsFilter === 'K03' && <p className="hint">Brak kartotek K03 – wybierz WZ powyżej.</p>}
          {haccpMonthlyGroups.length === 0 && docsFilter === 'K04' && <p className="hint">Brak K04 – uzupełnij K03 (WZ) i odśwież magazyn, lub przypisz partie w CP3.</p>}
          {haccpMonthlyGroups.length === 0 && docsFilter === 'K06' && <p className="hint">Brak K06 – utwórz K03 dla WZ (przerób / bez przerobu), potem odśwież kartoteki.</p>}
          {haccpMonthlyGroups.length === 0 && docsFilter === 'K07' && <p className="hint">Brak K07 – wpisy po przerobie (Magazyn → Przerób partii) lub ręczny wpis poniżej.</p>}
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
                const wfTag = k03DocWorkflowTag(doc)
                return <tr key={g.key} className={doc.frozen ? 'row-frozen' : ''}>
                  <td>{doc.document_date || '-'}</td>
                  <td><b>{doc.document_no || '-'}</b></td>
                  <td>{doc.lot_no || '-'}</td>
                  <td>{doc.product_name || g.product}</td>
                  <td>{saleQty.toLocaleString('pl-PL')}</td>
                  <td>{pzQty.toLocaleString('pl-PL')}</td>
                  <td><span className={workflowPillClass(wfTag)}>{workflowPillLabel(wfTag)}</span></td>
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
                    {isAdmin(authProfile) && g.docs.some(isPersistedHaccpDoc) && <button className="mini danger" onClick={() => deleteKartotekaGroup(g)} disabled={haccpBusy} title="Usuń kartotekę (Historia)"><Trash2 size={14}/></button>}
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
                  {isAdmin(authProfile) && g.docs.some(isPersistedHaccpDoc) && <button className="mini danger" onClick={() => deleteKartotekaGroup(g)} disabled={haccpBusy} title="Usuń kartotekę (Historia)"><Trash2 size={14}/> Usuń</button>}
                </td>
              </tr>
            })}</tbody>
          </table></div>}
        </>}
      </section>

      {docsFilter === 'K03' && docsWorkflowFilter === 'zamrozone' && (frozenKartoteki.length > 0 || k03WorkflowHistory.length > 0) && (
        <details className="card docs-frozen-panel">
          <summary>Zarządzanie zamrożonymi K03 ({frozenKartoteki.length}) – odmrożenie i historia</summary>
          {frozenKartoteki.length > 0 && <>
            <p className="hint">Kompletne K03 zamrażają się automatycznie. Odmrożenie tylko ręczne – np. po imporcie nowych PZ.</p>
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
        </details>
      )}
        </div>
      </div>
      </>}
    </div>
    {selectedHaccpDoc && renderHaccpPreview(selectedHaccpDoc)}
    {renderK03WzModal()}
    </>}

    {activeTab === 'historia' && isAdmin(authProfile) && (
      <HistorySection
        supabase={supabase}
        authProfile={authProfile}
        authSession={authSession}
        setMessage={setMessage}
        onRestored={() => { loadHaccpDocs({ syncK01: true }); loadEmployees() }}
      />
    )}

    {activeTab === 'ustawienia' && isAdmin(authProfile) && <>
    {isAdmin(authProfile) && (
      <UsersAdminSection
        supabase={supabase}
        authProfile={authProfile}
        authSession={authSession}
        setMessage={setMessage}
        onLogout={handleLogout}
      />
    )}
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
      {employees.length > 0 && <div className="table-wrap small"><table><thead><tr><th>Pracownik</th><th>Rola</th>{isAdmin(authProfile) && <th>Akcje</th>}</tr></thead><tbody>{employees.map(emp => <tr key={emp.id}><td><b>{emp.full_name}</b></td><td>{emp.role_name || 'przyjmujący'}</td>{isAdmin(authProfile) && <td><button className="mini danger" onClick={() => deleteEmployee(emp)}><Trash2 size={14}/> Usuń</button></td>}</tr>)}</tbody></table></div>}
    </section>
    </>}
  </div>
}

createRoot(document.getElementById('root')).render(<App />)
