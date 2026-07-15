import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Upload, Database, FileText, Package, Printer, ShieldCheck, AlertTriangle, RefreshCcw, Warehouse, ArrowRightLeft, Eye, Trash2, Settings, ClipboardList, LayoutDashboard, History, LogOut, FolderOpen, BarChart3, ChevronDown, ChevronUp, X } from 'lucide-react'
import { supabase, isSupabaseConfigured } from './supabaseClient'
import { readAgromarExcel, classifyOperation, normalizeDocumentNo, resolveDocumentIssueDate, inferDateFromDocumentNo, documentNoHasExplicitDate } from './excelImport'
import { resolveFifoProductGroup, resolveFifoMatchSpec, fifoLotMatchesMatchSpec, canonicalProductName, productGroupForName as k03ProductGroupForName } from './k03Engine'
import { saveImportToSupabase, getExistingOperationsForImport, splitImportGroupsByExisting, repairWarehouseImportDuplicates, formatRepairWarehouseResult, formatImportNetworkError, cleanupOrphanedDeletedImports, formatCleanupResult, runFullImportLotCleanup, prepareImportExcelSave, formatPrepareImportResult, purgeImportDataClientSide, appendNewItemsFromExistingDocuments, estimateMergeNewItems, repairMissingIncomingLots, formatMergeResult, purgeCompleteWarehouseReset, formatPurgeAllImportsResult } from './importSaveEngine'
import { loadK03Forms, mergeK03Overrides, buildK03FormsFromExcelRows, buildK03FormsFromImportPreview, isSaleOperation, K03_ENGINE_VERSION, buildK03PaperData, buildK03PrintHtml, buildK03ExcelRows, loadK03Snapshots, mergeK03Snapshots, saveK03Snapshot, applyK03DocEdits, fifoSourcePickerForProduct, defaultFifoSourceKeys, K03_CLASS_FILTER_TREE, matchesK03ClassFilter, normalizeK03ClassFilterValue, collectExtraK03Variants, normalizeFifoProductKey, formatK03PzNo, resolveK03PzNoFromRow } from './k03Engine'
import { loadWzQueue, previewK03Workflow, generateK03Workflow, changeK03Workflow, revertK03Workflow, unfreezeK03Workflow, k03LineAfterUnfreeze, resyncOpenK03FromFifo, unfreezeAndResyncK03ByWzMonth, suggestFrozenK03UnfreezeAfterImport, suggestK03LotNo, applyK03WorkflowResultToQueue, K03_WZ_ENGINE_VERSION } from './k03WzEngine'
import { computeUnassignedPzStock, STOCK_STATES_VERSION } from './stockStatesEngine'
import { recalculateFifoIncremental, recalculateFifoFullProtected, frozenKeysFromSnapshots, frozenOperationIdsFromSnapshots, countIncompleteSales, repairAllIncomingLotRemainingFromAllocations, invalidateFifoBaseCache, prefetchFifoBaseData } from './fifoEngine'
import { HACCP_FORMS_VERSION, buildSyntheticK04DocsFromTrace, buildSyntheticK07DocsFromTrace, buildSyntheticK06DocsFromK03, buildK06InsertPayload, buildK07InsertPayload, getLiveK04Doc, getLiveK06Doc, getLiveK07Doc, buildK04MonthlyHtml, buildK06MonthlyHtml, buildK07MonthlyHtml, buildManualMonthlyHtml, buildManualExcelRows, buildK04ExcelRows, buildK06ExcelRows, buildK07ExcelRows, MANUAL_HACCP_FORMS, normalizePn as formNormalizePn, normalizeK06Data, normalizeK07Data, k04TempForProductName, isDirectToSaleProduct, isIndustrialApple, isPeelingApple, isSyntheticK06Doc, k06RowHideKey, isSyntheticK07Doc, k07RowHideKey, K07_KONTROLA_ETAPY } from './haccpFormsEngine'
import { buildSyntheticK01DocsFromTrace, buildK01InsertPayload } from './k01Engine'
import {
  K02_ENGINE_VERSION, buildK02MonthPayloads, mergeK02DisplayDocs, k01DocsByDay, k02GroupHasManualMonth
} from './k02Engine'
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
import { buildRMonthlyPeriodGroups, buildRMonthlyPrintHtml, buildRMonthlyExcelRows, resolveRMonthlyGroupDeleteDocs } from './rMonthlyEngine'
import { isRMonthlyReport } from './rMonthlyConfigs'
import { RMonthlyReportSection, RMonthlyReportPreview } from './RMonthlyReportUI'
import {
  HACCP_DOCS_LOAD_MAX, HACCP_DOC_LIST_SELECT, batchInsertHaccpDocuments, fetchAllHaccpDocuments, mergeHaccpDocs, patchHaccpDocInList
} from './haccpLoadHelpers'
import { R09TrendSection } from './R09TrendUI'
import { StockValueReportSection } from './R14StockValueUI'
import { EXCEL_REPORT_VERSION } from './monthlyStockValueFromExcel'
import { LoginScreen } from './LoginScreen'
import { HistorySection } from './HistorySection'
import { PdfDocumentsSection } from './PdfDocumentsSection'
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
import { markKartotekaPrinted, setKartotekaPrintStatus, getKartotekaPrintInfo, kartotekaGroupFromDoc, loadLocalKartotekaPrints, PRINT_STATUS_OK, PRINT_STATUS_NEEDS_REPRINT } from './kartotekaPrintEngine'
import { KartotekaPrintBadge } from './KartotekaPrintBadge'
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

const K03_SAVE_STEP_LABELS = {
  unfreeze: 'Odmrażanie kartoteki…',
  fifo_revert: 'Cofanie starego FIFO…',
  fifo_preview: 'Weryfikacja FIFO…',
  fifo_save: 'Zapis FIFO…',
  k03_save: 'Zapisywanie kartoteki K03…'
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
  return k03ProductGroupForName(productName)
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
  [normalizeText('Porzeczka kolorowa'), 'Pk'],
  [normalizeText('Porzeczka kolorowa pulpa'), 'Pkp'],
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
  const name = canonicalProductName(productName || 'Produkt do dopasowania')
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
    if (productName && normalizeText(productName) !== key) cache.set(normalizeText(productName), existingByName.id)
    return existingByName.id
  }

  if (productName && normalizeText(productName) !== key) {
    const { data: aliasHit, error: aliasErr } = await supabase
      .from('products')
      .select('id, name, code, product_group')
      .eq('name', productName)
      .maybeSingle()
    if (aliasErr) throw aliasErr
    if (aliasHit) {
      cache.set(key, aliasHit.id)
      cache.set(normalizeText(productName), aliasHit.id)
      return aliasHit.id
    }
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
  const [k01SupplierBusyId, setK01SupplierBusyId] = useState(null)
  const [importDeleting, setImportDeleting] = useState(false)
  const [importCleaning, setImportCleaning] = useState(false)
  const [importResetting, setImportResetting] = useState(false)
  const [importDeduping, setImportDeduping] = useState(false)
  const [importSaving, setImportSaving] = useState(false)
  const [importProgress, setImportProgress] = useState('')
  const loadedForUserRef = useRef(null)
  const haccpLoadInFlightRef = useRef(null)
  const haccpLoadGenerationRef = useRef(0)
  const importCheckCacheRef = useRef(null)
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
  const [importDuplicates, setImportDuplicates] = useState([])
  const [importNewDocCount, setImportNewDocCount] = useState(0)
  const [importDuplicateDetails, setImportDuplicateDetails] = useState(new Map())
  const [importOrphanCount, setImportOrphanCount] = useState(0)
  const [haccpDocs, setHaccpDocs] = useState([])
  const [kartotekaLocalPrints, setKartotekaLocalPrints] = useState(() => loadLocalKartotekaPrints())
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
  const [k06DeletePending, setK06DeletePending] = useState(null)
  const K06_HIDDEN_STORAGE_KEY = 'agro-mar-k06-hidden-v1'
  const [k06HiddenKeys, setK06HiddenKeys] = useState(() => {
    try {
      const raw = localStorage.getItem(K06_HIDDEN_STORAGE_KEY)
      return new Set(JSON.parse(raw || '[]'))
    } catch {
      return new Set()
    }
  })
  const [defaultK02Employee, setDefaultK02Employee] = useState(() => {
    try { return localStorage.getItem(K02_DEFAULT_EMPLOYEE_KEY) || '' } catch { return '' }
  })
  const [k07Overrides, setK07Overrides] = useState({})
  const [k07DeletePending, setK07DeletePending] = useState(null)
  const [k07BulkGodzina, setK07BulkGodzina] = useState('')
  const [k07BulkStanSita, setK07BulkStanSita] = useState('P')
  const K07_HIDDEN_STORAGE_KEY = 'agro-mar-k07-hidden-v1'
  const [k07HiddenKeys, setK07HiddenKeys] = useState(() => {
    try {
      const raw = localStorage.getItem(K07_HIDDEN_STORAGE_KEY)
      return new Set(JSON.parse(raw || '[]'))
    } catch {
      return new Set()
    }
  })
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
  const [k02NewMonth, setK02NewMonth] = useState(new Date().toISOString().slice(0, 7))
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
  const [k03ActionDialog, setK03ActionDialog] = useState(null)
  const [k03UnfreezeSuggestions, setK03UnfreezeSuggestions] = useState([])
  const [k03UnfreezeBannerOpen, setK03UnfreezeBannerOpen] = useState(false)
  const [k03UnfreezeBannerHidden, setK03UnfreezeBannerHidden] = useState(false)
  const [fifoChangeLog, setFifoChangeLog] = useState([])
  const [fifoRecalculating, setFifoRecalculating] = useState(false)
  const [fifoProgress, setFifoProgress] = useState(null)
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
  const [stanyAsOfDate, setStanyAsOfDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [stanyRows, setStanyRows] = useState([])
  const [stanyLoading, setStanyLoading] = useState(false)
  const [stanySearch, setStanySearch] = useState('')
  const [stanyGroupFilter, setStanyGroupFilter] = useState('all')
  const [stanyDetailRow, setStanyDetailRow] = useState(null)
  const [fifoKartotekiDirty, setFifoKartotekiDirty] = useState(false)
  const [k03BulkMonth, setK03BulkMonth] = useState(new Date().toISOString().slice(0, 7))
  const docsFiltersHydrated = useRef(false)
  const docsFiltersSkipSave = useRef(true)
  const docsHubNavRef = useRef(null)

  const filteredRows = useMemo(() => rows
    .map(r => {
      const documentNo = normalizeDocumentNo(r.documentNo)
      const operation = classifyOperation(r.documentType, documentNo)
      return {
        ...r,
        documentNo,
        operation,
        issueDate: resolveDocumentIssueDate(r.issueDate, documentNo)
      }
    })
    .filter(r => r.operation !== 'pominiete_mm'), [rows])
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

  const visibleStanyRows = useMemo(() => {
    const q = normalizeText(stanySearch)
    return (stanyRows || []).filter(r => {
      if (stanyGroupFilter !== 'all' && r.product_group !== stanyGroupFilter) return false
      if (!q) return true
      return normalizeText(`${r.product_name} ${r.product_group}`).includes(q)
    })
  }, [stanyRows, stanySearch, stanyGroupFilter])

  const stanyGroupOptions = useMemo(() => {
    const set = new Set((stanyRows || []).map(r => r.product_group).filter(Boolean))
    return Array.from(set).sort()
  }, [stanyRows])

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

  function buildSyntheticK02Docs(allDocs) {
    const k01 = (allDocs || []).filter(d => d.document_type === 'K01' && d.document_date)
    return mergeK02DisplayDocs(allDocs, k01, k02Overrides)
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
  const syntheticK07Docs = useMemo(
    () => buildSyntheticK07DocsFromTrace(formsTraceContext, k07Overrides, haccpDocs)
      .filter(d => !k07HiddenKeys.has(k07RowHideKey(d))),
    [formsTraceContext, k07Overrides, haccpDocs, k07HiddenKeys]
  )
  const syntheticK06FromK03 = useMemo(
    () => buildSyntheticK06DocsFromK03(syntheticK03Docs, haccpDocs, k06Overrides)
      .filter(d => !k06HiddenKeys.has(k06RowHideKey(d))),
    [syntheticK03Docs, haccpDocs, k06Overrides, k06HiddenKeys]
  )
  const mergedK06Docs = useMemo(() => {
    const fromDb = (haccpDocs || []).filter(d => {
      if (d.document_type !== 'K06') return false
      if (k06HiddenKeys.has(k06RowHideKey(d))) return false
      const src = d.data?.auto_source || ''
      if (d.lot_id && !d.data?.k03_key) return false
      if (src === 'magazyn_cp3' || src === 'produkcja') return false
      return true
    })
    const dbK03Keys = new Set(fromDb.map(d => d.data?.k03_key).filter(Boolean))
    const extraFromK03 = syntheticK06FromK03.filter(d => !dbK03Keys.has(d.data?.k03_key))
    return [...fromDb, ...extraFromK03].sort((a, b) =>
      String(a.document_date || '').localeCompare(String(b.document_date || '')) ||
      String(a.product_name || '').localeCompare(String(b.product_name || '')) ||
      String(a.lot_no || '').localeCompare(String(b.lot_no || ''))
    )
  }, [haccpDocs, syntheticK06FromK03])
  const mergedK07Docs = useMemo(() => {
    const fromDb = (haccpDocs || []).filter(d =>
      d.document_type === 'K07' && !k07HiddenKeys.has(k07RowHideKey(d))
    )
    const extraSynthetic = syntheticK07Docs.filter(d => {
      const opId = d.data?.operation_id || d.operation_id
      const etap = d.data?.kontrola_etap
      if (opId && etap) {
        return !fromDb.some(x =>
          (x.data?.operation_id || x.operation_id) === opId && x.data?.kontrola_etap === etap
        )
      }
      return !fromDb.some(x => x.id === d.id)
    })
    return [...fromDb, ...extraSynthetic].sort((a, b) =>
      String(a.document_date || '').localeCompare(String(b.document_date || '')) ||
      String(a.data?.operation_id || a.operation_id || '').localeCompare(String(b.data?.operation_id || b.operation_id || '')) ||
      String(a.data?.kontrola_etap || '').localeCompare(String(b.data?.kontrola_etap || '')) ||
      String(a.lot_no || '').localeCompare(String(b.lot_no || ''))
    )
  }, [haccpDocs, syntheticK07Docs, k07HiddenKeys])

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
      syntheticK03Docs,
      wzQueueLines,
      stockRows,
      operations: formsTrace.operations || [],
      auxCount: auxRows.filter(r => String(r.delivery_date || '').slice(0, 4) === year).length
    })
  }, [dashboardMonth, haccpDocs, dashboardSyntheticK02, syntheticK04Docs, mergedK06Docs, mergedK07Docs, syntheticK03Docs, wzQueueLines, stockRows, formsTrace, auxRows])

  function matchesDocsDateRange(dateStr, from = docsDateFrom, to = docsDateTo) {
    const date = String(dateStr || '').slice(0, 10)
    if (!from && !to) return true
    if (!date || date === '0000-01-01') return false
    const f = from || '0000-01-01'
    const t = to || '9999-12-31'
    return date >= f && date <= t
  }

  function k03LineIsFrozen(line) {
    return Boolean(line?.frozen || line?.status === 'frozen' || line?.k03Form?.frozen || line?.k03Form?.data?.frozen)
  }

  function k03DocIsFrozen(doc) {
    return Boolean(doc?.frozen || doc?.data?.frozen)
  }

  function k03LineWorkflowModeTag(line) {
    if (line.status === 'pending') return 'nieprzerobione'
    if (line.workflow?.mode === 'przerob') return 'przerobione'
    if (line.workflow?.mode === 'bez_przerobu') return 'bez_przerobu'
    if (line.status === 'legacy_auto') return 'czesciowo'
    if (line.status === 'k03_ready' || line.status === 'frozen') {
      const doc = line.k03Form
      const fifoOk = doc?.data?.quantitiesMatch !== false && Number(doc?.data?.shortage || 0) <= 0
      if (!fifoOk || doc?.status === 'N') return 'czesciowo'
      if (!doc?.signed_by_operator) return 'do_zatwierdzenia'
      return 'przerobione'
    }
    return 'czesciowo'
  }

  function k03LineWorkflowTag(line) {
    return k03LineWorkflowModeTag(line)
  }

  function k03DocWorkflowModeTag(doc) {
    if (doc?.data?.k03_workflow?.mode === 'przerob') return 'przerobione'
    if (doc?.data?.k03_workflow?.mode === 'bez_przerobu') return 'bez_przerobu'
    const fifoOk = doc?.data?.quantitiesMatch !== false && Number(doc?.data?.shortage || 0) <= 0
    if (!fifoOk || doc?.status === 'N') return 'czesciowo'
    if (!doc?.signed_by_operator) return 'do_zatwierdzenia'
    return 'przerobione'
  }

  function k03DocWorkflowTag(doc) {
    return k03DocWorkflowModeTag(doc)
  }

  function matchesK03WorkflowFilter(modeTag, frozen, filter = docsWorkflowFilter) {
    if (filter === 'all') return true
    if (filter === 'zamrozone') return frozen
    return modeTag === filter
  }

  function renderWorkflowStatusPills(modeTag, frozen) {
    return (
      <span className="k03-status-pills">
        <span className={workflowPillClass(modeTag)}>{workflowPillLabel(modeTag)}</span>
        {frozen ? <span className="wf-pill wf-frozen">Zamrożone</span> : null}
      </span>
    )
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
    setK03AssortmentFilter(normalizeK03ClassFilterValue(snap.k03AssortmentFilter || 'all'))
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

      {isK03 && <div className="docs-sidebar-block docs-sidebar-class-filter">
        <h4>Klasa / asortyment</h4>
        <label>Wybierz klasę owocu
          <select className="k03-class-filter-select" value={k03AssortmentFilter} onChange={e => setK03AssortmentFilter(normalizeK03ClassFilterValue(e.target.value))}>
            <option value="all">Wszystkie klasy ({k03ClassCounts.get('all') || 0})</option>
            {K03_CLASS_FILTER_TREE.map(family => (
              <optgroup key={family.id} label={family.label}>
                <option value={`group:${family.id}`}>
                  Cała {family.label} ({k03ClassCounts.get(`group:${family.id}`) || 0})
                </option>
                {(family.variants || []).map(variant => (
                  <option key={variant.id} value={`variant:${variant.id}`}>
                    {variant.label} ({k03ClassCounts.get(`variant:${variant.id}`) || 0})
                  </option>
                ))}
              </optgroup>
            ))}
            {k03ExtraVariants.length > 0 && (
              <optgroup label="Inne w danych">
                {k03ExtraVariants.map(variant => (
                  <option key={variant.id} value={`variant:${variant.id}`}>
                    {variant.label} ({k03ClassCounts.get(`variant:${variant.id}`) || 0})
                  </option>
                ))}
              </optgroup>
            )}
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
      if (!matchesK03ClassFilter(line.product_name, line.product_group, k03AssortmentFilter)) return false
      if (!matchesK03WorkflowFilter(k03LineWorkflowModeTag(line), k03LineIsFrozen(line))) return false
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

  function openK03UnfreezeDialog(doc) {
    if (!doc?.id || !supabase) return
    if (!doc.frozen && doc.data?.frozen !== true) {
      setMessage('Kartoteka nie jest zamrożona.')
      return
    }
    setK03ActionDialog({
      kind: 'unfreeze',
      doc,
      reason: '',
      busy: false,
      error: ''
    })
  }

  function openK03RevertDialog(line) {
    if (!line || !supabase) return
    if (!ensureCanDelete()) return
    const frozen = k03LineIsFrozen(line)
    setK03ActionDialog({
      kind: 'revert',
      line,
      frozen,
      reason: '',
      revertReason: 'Cofnięcie decyzji K03/WZ',
      busy: false,
      error: ''
    })
  }

  async function submitK03ActionDialog() {
    if (!k03ActionDialog || !supabase) return
    const dialog = k03ActionDialog

    if (dialog.kind === 'unfreeze') {
      const reason = String(dialog.reason || '').trim()
      if (!reason) {
        setK03ActionDialog(d => ({ ...d, error: 'Podaj powód odmrożenia.' }))
        return
      }
      setK03ActionDialog(d => ({ ...d, busy: true, error: '' }))
      try {
        await unfreezeK03Workflow(supabase, dialog.doc, reason, userRole)
        await loadK03TraceData()
        await loadFifoChangeLog()
        setK03UnfreezeSuggestions(prev => prev.filter(s => s.k03_key !== dialog.doc.id))
        setK03ActionDialog(null)
        setMessage(`K03 odmrożony: ${reason}`)
      } catch (err) {
        setK03ActionDialog(d => ({ ...d, busy: false, error: err?.message || String(err) }))
      }
      return
    }

    if (dialog.kind === 'revert') {
      const { line, frozen } = dialog
      let workLine = line
      const revertReason = String(dialog.revertReason || dialog.reason || 'Cofnięcie decyzji K03/WZ').trim() || 'Cofnięcie decyzji K03/WZ'

      if (frozen) {
        const unfreezeReason = String(dialog.reason || '').trim()
        if (!unfreezeReason) {
          setK03ActionDialog(d => ({ ...d, error: 'Podaj powód odmrożenia przed cofnięciem.' }))
          return
        }
        const doc = line.k03Form
        if (!doc?.id) {
          setK03ActionDialog(d => ({ ...d, error: 'Brak dokumentu K03 do odmrożenia.' }))
          return
        }
        setK03ActionDialog(d => ({ ...d, busy: true, error: '' }))
        try {
          await unfreezeK03Workflow(supabase, doc, unfreezeReason, userRole)
          workLine = k03LineAfterUnfreeze(line)
        } catch (err) {
          setK03ActionDialog(d => ({ ...d, busy: false, error: `Błąd odmrożenia: ${err?.message || String(err)}` }))
          return
        }
      } else {
        setK03ActionDialog(d => ({ ...d, busy: true, error: '' }))
      }

      try {
        await revertK03Workflow(supabase, workLine, {
          reason: revertReason,
          changedBy: userRole,
          alreadyUnfrozen: frozen
        })
        await loadK03TraceData()
        await loadFifoChangeLog()
        setK03ActionDialog(null)
        setMessage('Decyzja K03 cofnięta – pozycja wróciła do kolejki WZ.')
      } catch (err) {
        setK03ActionDialog(d => ({ ...d, busy: false, error: `Błąd cofania: ${err?.message || String(err)}` }))
      }
    }
  }

  async function unfreezeK03Document(doc) {
    openK03UnfreezeDialog(doc)
  }

  async function unfreezeK03Line(line) {
    openK03UnfreezeDialog(line?.k03Form)
  }

  async function revertK03Line(line) {
    openK03RevertDialog(line)
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

  function renderFifoProgressBanner() {
    if (!fifoProgress || !fifoRecalculating) return null
    return (
      <div className="card fifo-progress-banner" role="status">
        <b>Przeliczanie FIFO</b>
        {fifoProgress.phase === 'start' && <span> · {fifoProgress.message || 'Wczytywanie…'}</span>}
        {fifoProgress.phase === 'running' && fifoProgress.total > 0 && (
          <span> · {fifoProgress.current}/{fifoProgress.total} WZ · uzupełniono {fifoProgress.processed || 0} · pominięto {fifoProgress.skippedComplete || 0}</span>
        )}
        {fifoProgress.phase === 'saving' && <span> · {fifoProgress.message || 'Zapis do bazy…'}</span>}
        {fifoProgress.total > 0 && fifoProgress.phase === 'running' && (
          <div className="fifo-progress-bar"><div style={{ width: `${Math.min(100, Math.round((fifoProgress.current / fifoProgress.total) * 100))}%` }} /></div>
        )}
      </div>
    )
  }

  function renderK03UnfreezeBanner() {
    if (!k03UnfreezeSuggestions.length || k03UnfreezeBannerHidden) return null
    const previewLimit = 8
    const preview = k03UnfreezeSuggestions.slice(0, previewLimit)
    const hiddenCount = k03UnfreezeSuggestions.length - preview.length
    return <section className="card k03-unfreeze-banner">
      <div className="k03-unfreeze-head">
        <div className="section-title"><AlertTriangle/><div>
          <h2>Odmrożenie K03 po imporcie ({k03UnfreezeSuggestions.length})</h2>
          <p>
            Tylko gdy import zmienia <b>PZ lub WZ już rozpisane</b> w zamrożonym K03 (inna data lub ilość).
            Całkiem <b>nowe numery</b> dokumentów nie wymagają odmrożenia — trafiają do K01 i FIFO automatycznie.
          </p>
        </div></div>
        <div className="k03-unfreeze-toolbar">
          <button type="button" className="mini secondary" onClick={() => setK03UnfreezeBannerOpen(o => !o)}>
            {k03UnfreezeBannerOpen ? <><ChevronUp size={14}/> Zwiń</> : <><ChevronDown size={14}/> Rozwiń listę</>}
          </button>
          <button type="button" className="mini secondary" onClick={() => setK03UnfreezeBannerHidden(true)} title="Ukryj do następnego importu">
            <X size={14}/> Ukryj
          </button>
        </div>
      </div>
      {!k03UnfreezeBannerOpen && (
        <p className="hint k03-unfreeze-summary">
          {k03UnfreezeSuggestions.length === 1
            ? '1 zamrożona kartoteka może wymagać uwagi.'
            : `${k03UnfreezeSuggestions.length} zamrożonych kartotek może wymagać uwagi.`}
          {' '}Kliknij „Rozwiń listę”, jeśli chcesz je przejrzeć.
        </p>
      )}
      {k03UnfreezeBannerOpen && <div className="unfreeze-suggest-list">
        {preview.map(item => (
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
      </div>}
      {k03UnfreezeBannerOpen && hiddenCount > 0 && <p className="hint">… i jeszcze {hiddenCount} kartotek (przewiń listę).</p>}
    </section>
  }

  function buildK03WzModalState(line, mode, editMode = false) {
    const wzDate = String(line.wz_date || '').slice(0, 10)
    const wf = line.workflow || {}
    const resolvedMode = editMode ? (wf.mode || mode || 'bez_przerobu') : mode
    const przerobDate = resolvedMode === 'przerob'
      ? String(wf.przerob_date || wf.fifo_cutoff_date || wzDate || new Date().toISOString().slice(0, 10)).slice(0, 10)
      : ''
    const lotNo = resolvedMode === 'przerob'
      ? (wf.lot_no || line.k03Form?.lot_no || suggestK03LotNo(k03FormsRaw, line, przerobDate, { mode: 'przerob' }))
      : ''
    const fifoSourcePicker = fifoSourcePickerForProduct(line.product_name)
    const fifoSourceKeys = wf.fifo_source_keys?.length
      ? [...wf.fifo_source_keys]
      : (fifoSourcePicker?.defaultKeys?.length ? [...fifoSourcePicker.defaultKeys] : defaultFifoSourceKeys(line.product_name))
    return {
      line,
      mode: resolvedMode,
      editMode,
      przerobDate,
      lotNo,
      rawStored: wf.raw_stored === true,
      fifoSourceKeys,
      fifoSourcePicker,
      preview: null,
      loading: false,
      saving: false,
      savingStep: '',
      error: '',
      confirmMismatch: false
    }
  }

  function openK03WzModal(line, mode) {
    setK03WzModal(buildK03WzModalState(line, mode, false))
    if (supabase) prefetchFifoBaseData(supabase)
  }

  function openK03WzEditModal(line) {
    setK03WzModal(buildK03WzModalState(line, line.workflow?.mode || 'bez_przerobu', true))
    if (supabase) prefetchFifoBaseData(supabase)
  }

  function k03WzFifoSourceKeys(modal) {
    if (!modal?.fifoSourceKeys?.length) return null
    return modal.fifoSourceKeys
  }

  function toggleK03FifoSourceKey(sourceKey, checked) {
    setK03WzModal(m => {
      const keys = new Set(m.fifoSourceKeys || [])
      if (checked) keys.add(sourceKey)
      else keys.delete(sourceKey)
      const next = [...keys]
      if (!next.length) return m
      return { ...m, fifoSourceKeys: next, preview: null, confirmMismatch: false }
    })
  }

  async function refreshK03WzPreview() {
    if (!k03WzModal || !supabase) return
    setK03WzModal(m => ({ ...m, loading: true, error: '', preview: null }))
    try {
      const preview = await previewK03Workflow(supabase, k03WzModal.line, {
        mode: k03WzModal.mode,
        przerobDate: k03WzModal.przerobDate,
        fifoSourceKeys: k03WzFifoSourceKeys(k03WzModal),
        frozenKeys: frozenKeysFromSnapshots(k03Snapshots)
      })
      if (!preview.ok) throw new Error(preview.error || 'Błąd podglądu FIFO.')
      setK03WzModal(m => ({ ...m, preview, loading: false }))
    } catch (err) {
      setK03WzModal(m => ({ ...m, loading: false, error: err?.message || String(err) }))
    }
  }

  async function confirmK03WzModal(acceptMismatch = false) {
    if (!k03WzModal || !supabase) return
    setK03WzModal(m => ({ ...m, saving: true, savingStep: 'Przygotowanie…', error: '' }))
    const reportSaveStep = (step) => {
      setK03WzModal(m => m ? ({ ...m, savingStep: K03_SAVE_STEP_LABELS[step] || step }) : m)
    }
    try {
      const workflowOpts = {
        mode: k03WzModal.mode,
        przerobDate: k03WzModal.przerobDate,
        lotNo: k03WzModal.lotNo,
        rawStored: k03WzModal.rawStored,
        acceptQuantityMismatch: acceptMismatch || k03WzModal.confirmMismatch,
        changedBy: userRole,
        fifoSourceKeys: k03WzFifoSourceKeys(k03WzModal),
        frozenKeys: frozenKeysFromSnapshots(k03Snapshots),
        existingPreview: k03WzModal.preview?.ok ? k03WzModal.preview : undefined,
        onProgress: reportSaveStep
      }
      const result = k03WzModal.editMode
        ? await changeK03Workflow(supabase, k03WzModal.line, workflowOpts)
        : await generateK03Workflow(supabase, k03WzModal.line, workflowOpts)
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
      const wasEdit = k03WzModal.editMode
      const savedLine = k03WzModal.line
      const wzNo = savedLine.document_no
      const wzMode = k03WzModal.mode === 'przerob' ? 'przerób' : 'brak przerobu'
      const frozenNote = result.autoFrozen ? ' Kartoteka zamrożona automatycznie (kompletna i prawidłowa).' : ' Kartoteka zapisana — możesz ją zamrozić ręcznie po weryfikacji.'
      const editNote = wasEdit ? ' Decyzja K03 zmieniona.' : ''
      setK03WzModal(null)
      const updatedLine = applyK03WorkflowResultToQueue(savedLine, result)
      if (updatedLine) {
        setWzQueueLines(lines => lines.map(l => l.key === updatedLine.key ? updatedLine : l))
        setK03FormsRaw(forms => {
          const idx = forms.findIndex(f => f.id === result.doc.id)
          if (idx >= 0) {
            const next = [...forms]
            next[idx] = result.doc
            return next
          }
          return forms
        })
      }
      loadFifoChangeLog()
      setMessage(`K03 ${wasEdit ? 'zaktualizowany' : 'utworzony'} dla WZ ${wzNo} (${wzMode}).${editNote}${frozenNote}`)
    } catch (err) {
      setK03WzModal(m => ({ ...m, saving: false, savingStep: '', error: err?.message || String(err) }))
    }
  }

  function clampPrzerobDateToWz(przerobDate, wzDate) {
    const p = String(przerobDate || '').slice(0, 10)
    const w = String(wzDate || '').slice(0, 10)
    if (!p || !w) return p
    return p > w ? w : p
  }

  function renderK03WzModal() {
    if (!k03WzModal) return null
    const { line, mode, preview, loading, saving, savingStep, error, confirmMismatch, editMode, fifoSourcePicker, fifoSourceKeys } = k03WzModal
    const wzDate = String(line.wz_date || '').slice(0, 10)
    const title = editMode
      ? 'Zmień decyzję K03'
      : (mode === 'przerob' ? 'Dodaj przerób → K03' : 'Brak przerobu → K03')
    const rawTotal = preview?.pzRows?.reduce((s, r) => s + Number(r.qty || 0), 0) || 0
    const mismatch = preview && (Math.abs(rawTotal - Number(preview.saleQty || 0)) >= 0.001 || Number(preview.shortage || 0) > 0)

    return <div className="modal-backdrop k03-wz-modal-backdrop" onClick={() => !saving && setK03WzModal(null)}>
      <div className="haccp-modal k03-wz-modal" onClick={e => e.stopPropagation()}>
        <div className="k03-wz-modal-header">
          <h3>{title}</h3>
          <p className="k03-wz-modal-subtitle"><b>{line.product_name}</b> · WZ {line.document_no} · {Number(line.qty || 0).toLocaleString('pl-PL')} kg · {line.wz_date}</p>
          {editMode && <p className="hint k03-wz-modal-note">Możesz zmienić tryb (przerób / bez przerobu), datę, źródła PZ i numer partii. Zamrożona kartoteka zostanie odmrożona i zapisana od nowa.</p>}
        </div>
        <div className="k03-wz-modal-body">
          {editMode && <label className="k03-wz-field">Decyzja
            <select value={mode} onChange={e => setK03WzModal(m => ({
              ...m,
              mode: e.target.value,
              przerobDate: e.target.value === 'przerob'
                ? String(m.przerobDate || m.line.workflow?.przerob_date || wzDate).slice(0, 10)
                : '',
              lotNo: e.target.value === 'przerob'
                ? (m.lotNo || m.line.workflow?.lot_no || m.line.k03Form?.lot_no || suggestK03LotNo(k03FormsRaw, m.line, String(m.przerobDate || m.line.workflow?.przerob_date || wzDate).slice(0, 10), { mode: 'przerob' }))
                : '',
              preview: null,
              confirmMismatch: false
            }))}>
              <option value="przerob">Przerób</option>
              <option value="bez_przerobu">Bez przerobu</option>
            </select>
          </label>}
          {fifoSourcePicker && <fieldset className="fifo-source-picker">
            <legend>Źródła PZ (klasa / odmiana)</legend>
            <p className="fifo-source-hint">{fifoSourcePicker.hint}</p>
            <div className="fifo-source-choices">
              {fifoSourcePicker.choices.map(choice => {
                const active = (fifoSourceKeys || []).includes(choice.key)
                return (
                  <label key={choice.key} className={`fifo-source-choice${active ? ' active' : ''}`}>
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={e => toggleK03FifoSourceKey(choice.key, e.target.checked)}
                    />
                    <span>{choice.label}</span>
                  </label>
                )
              })}
            </div>
            {(fifoSourceKeys || []).length === 0 && <p className="status danger">Zaznacz co najmniej jedno źródło PZ.</p>}
          </fieldset>}
          {mode === 'przerob' && <>
            <label className="k03-wz-field">Data przerobu (max = data WZ {wzDate || '—'})
              <input type="date" max={wzDate || undefined} value={k03WzModal.przerobDate} onChange={e => setK03WzModal(m => ({ ...m, przerobDate: clampPrzerobDateToWz(e.target.value, wzDate), preview: null, confirmMismatch: false }))} />
            </label>
            <label className="k03-wz-field">Numer partii wyrobu (proponowany – możesz zmienić)
              <input value={k03WzModal.lotNo} onChange={e => setK03WzModal(m => ({ ...m, lotNo: e.target.value }))} placeholder="np. T/001/2026" />
            </label>
            <p className="hint">Przerób musi być w dniu WZ lub wcześniej. FIFO dobiera PZ z datą ≤ data przerobu.</p>
          </>}
          {mode === 'bez_przerobu' && <>
            <label className="k03-wz-field">Czy surowiec był magazynowany (K02)?
              <select value={k03WzModal.rawStored ? 'tak' : 'nie'} onChange={e => setK03WzModal(m => ({ ...m, rawStored: e.target.value === 'tak' }))}>
                <option value="nie">Nie – gotowiec / prosto na samochód</option>
                <option value="tak">Tak – wymaga K02</option>
              </select>
            </label>
            <p className="hint">FIFO dobiera tylko PZ z datą ≤ data WZ.</p>
          </>}
        </div>
        <div className="k03-wz-modal-actions actions">
          <button className="secondary" onClick={refreshK03WzPreview} disabled={loading || saving}>{loading ? 'FIFO…' : 'Podgląd FIFO / PZ'}</button>
          <button onClick={() => confirmK03WzModal(confirmMismatch)} disabled={saving || loading || (!preview && !confirmMismatch) || (fifoSourcePicker && !(fifoSourceKeys || []).length)}>
            {saving ? (savingStep || 'Zapisywanie…') : confirmMismatch ? 'Zatwierdź mimo ostrzeżenia' : (editMode ? 'Zapisz zmianę' : 'Utwórz K03')}
          </button>
          <button className="secondary" onClick={() => setK03WzModal(null)} disabled={saving}>Anuluj</button>
        </div>
        {saving && savingStep && <p className="hint k03-wz-saving-step">{savingStep}</p>}
        {(error || preview) && <div className="k03-wz-modal-footer">
        {error && <p className="status danger">{error}</p>}
        {preview?.diagnostics && (
          <div className="hint fifo-diag-box">
            <b>Diagnostyka FIFO · klasa {preview.diagnostics.fifoClassLabel || preview.diagnostics.fifoVariant || preview.diagnostics.productGroup} · cutoff {preview.cutoffDate}:</b>{' '}
            {(preview.diagnostics.fifoSourceVariants || []).length > 1 && (
              <>Źródła PZ (ręczny wybór): {[...(preview.diagnostics.fifoSourceVariants || [])].join(', ')} · </>
            )}
            PZ łącznie {Number(preview.diagnostics.purchasedTotalKg || 0).toLocaleString('pl-PL')} kg
            ({preview.diagnostics.lotCountInGroup || 0} partii
            {Number(preview.diagnostics.lotsTotalLoaded || 0) > 0 ? ` / ${preview.diagnostics.lotsTotalLoaded} partii w bazie` : ''}),
            z datą ≤ {preview.cutoffDate}: {Number(preview.diagnostics.purchasedWithinCutoffKg || 0).toLocaleString('pl-PL')} kg
            ({preview.diagnostics.lotCountWithinCutoff || 0} partii),
            wolne w magazynie (≤ {preview.cutoffDate}): {Number(preview.diagnostics.remainingWithinCutoffKg || 0).toLocaleString('pl-PL')} kg,
            dostępne dla tego WZ: {Number(preview.diagnostics.remainingWithinCutoffAfterReserveKg || 0).toLocaleString('pl-PL')} kg
            {Number(preview.diagnostics.allocatedByOtherWzKg || 0) > 0 ? ` (inne WZ: ${Number(preview.diagnostics.allocatedByOtherWzKg).toLocaleString('pl-PL')} kg)` : ''}.
            {(preview.diagnostics.siblingClasses || []).length > 0 && (
              <> {(preview.diagnostics.siblingClasses || []).map((s, i) => (
                <span key={i}> Inna klasa ({s.classLabel}): {Number(s.purchasedWithinCutoffKg || 0).toLocaleString('pl-PL')} kg PZ ≤ {preview.cutoffDate}.</span>
              ))}</>
            )}
          </div>
        )}
        {mismatch && preview && <p className="status danger">
          Brak wystarczającego surowca: WZ {Number(preview.saleQty || 0).toLocaleString('pl-PL')} kg, przypisano PZ {rawTotal.toLocaleString('pl-PL')} kg
          {Number(preview.shortage || 0) > 0 ? ` – brakuje ${Number(preview.shortage).toLocaleString('pl-PL')} kg` : ''}.
          {Number(preview.excludedFuturePzQty || 0) > 0 ? ` PZ z późniejszą datą (${Number(preview.excludedFuturePzQty).toLocaleString('pl-PL')} kg) pominięto.` : ''}
          {Number(preview.diagnostics?.remainingAfterCutoffKg || 0) > 0.5 && (
            <> W magazynie jest jeszcze {Number(preview.diagnostics.remainingAfterCutoffKg).toLocaleString('pl-PL')} kg z PZ po dacie {preview.cutoffDate} – popraw datę PZ w zakładce PZ/FIFO, jeśli towar był wcześniej na magazynie.</>
          )}
          {(preview.diagnostics?.priorUnallocatedWzCount || 0) > 0 && (
            <> {preview.diagnostics.priorUnallocatedWzCount} wcześniejszych WZ bez K03 ({Number(preview.diagnostics.priorUnallocatedWzKg || 0).toLocaleString('pl-PL')} kg) – rozlicz je wcześniej.</>
          )}
        </p>}
        {preview?.pzRows?.length > 0 && <div className="table-wrap small"><table>
          <thead><tr><th>Nr PZ (z importu)</th><th>Partia mag.</th><th>Data PZ</th><th>Dostawca</th><th>Ilość kg</th></tr></thead>
          <tbody>{preview.pzRows.map((r, i) => <tr key={i}><td>{resolveK03PzNoFromRow(r) || '—'}</td><td>{r.source_lot_no || '—'}</td><td>{r.pz_date}</td><td>{r.supplier || resolveK03PzNoFromRow(r) || '—'}</td><td>{Number(r.qty || 0).toLocaleString('pl-PL')}</td></tr>)}</tbody>
        </table></div>}
        </div>}
      </div>
    </div>
  }

  function renderK03ActionDialog() {
    if (!k03ActionDialog) return null
    const { kind, busy, error } = k03ActionDialog
    const isUnfreeze = kind === 'unfreeze'
    const doc = k03ActionDialog.doc
    const line = k03ActionDialog.line
    const frozen = k03ActionDialog.frozen
    const wzNo = isUnfreeze ? (doc?.document_no || '') : (line?.document_no || '')
    const productName = isUnfreeze ? (doc?.product_name || '') : (line?.product_name || '')

    return <div className="modal-backdrop k03-wz-modal-backdrop" onClick={() => !busy && setK03ActionDialog(null)}>
      <div className="haccp-modal k03-wz-modal" onClick={e => e.stopPropagation()}>
        <div className="k03-wz-modal-header">
          <h3>{isUnfreeze ? 'Odmrożenie K03' : 'Cofnięcie decyzji K03'}</h3>
          <p className="k03-wz-modal-subtitle">
            <b>{productName}</b>{wzNo ? ` · WZ ${wzNo}` : ''}
          </p>
          {isUnfreeze && <p className="hint k03-wz-modal-note">Po odmrożeniu FIFO może ponownie zmienić rozliczenie tej kartoteki.</p>}
          {!isUnfreeze && frozen && <p className="hint k03-wz-modal-note">Kartoteka jest zamrożona – najpierw zostanie odmrożona, potem decyzja wróci do kolejki WZ.</p>}
          {!isUnfreeze && !frozen && <p className="hint k03-wz-modal-note">Pozycja wróci do kolejki WZ – możesz ponownie wybrać przerób lub brak przerobu.</p>}
        </div>
        <div className="k03-wz-modal-body">
          {(isUnfreeze || frozen) && <label className="k03-wz-field full-width">
            Powód odmrożenia (wymagane)
            <textarea
              rows={3}
              value={k03ActionDialog.reason || ''}
              onChange={e => setK03ActionDialog(d => ({ ...d, reason: e.target.value, error: '' }))}
              placeholder="np. korekta źródeł PZ, ponowne rozliczenie FIFO"
              disabled={busy}
            />
          </label>}
          {!isUnfreeze && <label className="k03-wz-field full-width">
            Powód cofnięcia (opcjonalnie)
            <input
              value={k03ActionDialog.revertReason || ''}
              onChange={e => setK03ActionDialog(d => ({ ...d, revertReason: e.target.value, error: '' }))}
              placeholder="Cofnięcie decyzji K03/WZ"
              disabled={busy}
            />
          </label>}
          {error && <p className="status danger">{error}</p>}
        </div>
        <div className="k03-wz-modal-actions actions">
          <button type="button" onClick={submitK03ActionDialog} disabled={busy}>
            {busy ? 'Zapisywanie…' : (isUnfreeze ? 'Odmroź' : 'Cofnij decyzję')}
          </button>
          <button type="button" className="secondary" onClick={() => setK03ActionDialog(null)} disabled={busy}>Anuluj</button>
        </div>
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
      const etap = live.data?.kontrola_etap || ''
      const existing = (haccpDocs || []).find(d => {
        if (d.document_type !== 'K07') return false
        const dOp = d.data?.operation_id || d.operation_id
        if (opId && etap) return dOp === opId && d.data?.kontrola_etap === etap
        if (opId) return dOp === opId && !d.data?.kontrola_etap
        return isPersistedHaccpDoc(d) && d.id === doc.id
      }) || (isPersistedHaccpDoc(doc) && !opId ? doc : null)

      if (!existing && isSyntheticK07Doc(doc)) {
        const { data: inserted, error } = await supabase.from('haccp_documents').insert(buildK07InsertPayload(live)).select('*').single()
        if (error) throw error
        const workingDoc = inserted
        setK07Overrides(prev => {
          const next = { ...prev }
          delete next[doc.id]
          return next
        })
        mergeHaccpDoc(workingDoc.id, workingDoc)
        return workingDoc
      }

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
      const workingDoc = { ...base, ...payload }
      if (doc.id !== base.id) {
        setK07Overrides(prev => {
          const next = { ...prev }
          delete next[doc.id]
          return next
        })
      }
      mergeHaccpDoc(workingDoc.id, workingDoc)
      return workingDoc
    } catch (err) {
      setMessage(`K07: błąd zapisu – ${err.message}`)
      return null
    }
  }

  function hideK07Row(doc) {
    const key = k07RowHideKey(doc)
    if (!key) return
    setK07HiddenKeys(prev => {
      const next = new Set(prev)
      next.add(key)
      try {
        localStorage.setItem(K07_HIDDEN_STORAGE_KEY, JSON.stringify([...next]))
      } catch { /* ignore quota */ }
      return next
    })
  }

  async function applyK07ColumnForGroup(group, field, value, onlyEmpty = false) {
    if (!group?.docs?.length) { setMessage('Brak wpisów K07.'); return }
    if (!supabase) { setMessage('Brak bazy – zapis K07 wymaga Supabase.'); return }
    const docs = (group.docs || []).map(d => getLiveK07Doc(d, k07Overrides))
    const targets = onlyEmpty
      ? docs.filter(d => {
        const data = normalizeK07Data(d.data || {}, d)
        if (field === 'godzina') return !String(data.godzina || '').trim()
        if (field === 'stan_sita') return !data.stan_sita
        if (field === 'podpis_kontrolujacego') return !(d.signed_by_operator || data.podpis_kontrolujacego)
        return true
      })
      : docs
    if (!targets.length) { setMessage(onlyEmpty ? 'Nie ma pustych pól w tej kolumnie.' : 'Brak wpisów K07.'); return }
    const label = field === 'godzina' ? 'godzinę' : field === 'stan_sita' ? 'stan sita' : 'podpis'
    if (!onlyEmpty && !window.confirm(`Ustawić ${label} dla ${targets.length} wierszy K07?`)) return
    try {
      for (const doc of targets) {
        await saveK07DocumentField(doc, { [field]: value })
      }
      await loadHaccpDocs()
      setMessage(`K07: uzupełniono kolumnę (${targets.length} wierszy).`)
    } catch (err) {
      setMessage(`K07: błąd uzupełniania kolumny – ${err.message}`)
    }
  }

  async function deleteK07Row(doc) {
    if (!doc) return
    const d = normalizeK07Data(doc.data || {}, doc)
    const label = [doc.document_date, d.kontrola_label, d.surowiec, d.numer_partii].filter(Boolean).join(' · ')
    if (isPersistedHaccpDoc(doc)) {
      if (!ensureCanDelete()) return
      if (!confirmDelete(`Wpis K07: ${label}.\n\nWpis trafi do historii.`)) {
        setK07DeletePending(null)
        return
      }
      if (!window.confirm('Ostateczne potwierdzenie: usunąć ten wiersz K07?')) {
        setK07DeletePending(null)
        return
      }
      try {
        await auditDeleteHaccpDocument(supabase, doc, getAuditActor())
        hideK07Row(doc)
        setK07DeletePending(null)
        if (selectedHaccpDoc?.groupPreview) {
          setSelectedHaccpDoc(prev => prev ? {
            ...prev,
            group: { ...prev.group, docs: (prev.group.docs || []).filter(x => x.id !== doc.id) }
          } : prev)
        }
        await loadHaccpDocs()
        setMessage('K07: usunięto wpis (zapis w historii).')
      } catch (err) {
        setMessage(`K07: błąd usuwania – ${err.message}`)
      }
      return
    }
    if (!window.confirm(`Ukryć wiersz K07: ${label}?\n\nWpis zniknie z kartoteki.`)) {
      setK07DeletePending(null)
      return
    }
    if (!window.confirm('Potwierdź ukrycie wiersza K07.')) {
      setK07DeletePending(null)
      return
    }
    hideK07Row(doc)
    setK07DeletePending(null)
    if (selectedHaccpDoc?.groupPreview) {
      setSelectedHaccpDoc(prev => prev ? {
        ...prev,
        group: {
          ...prev.group,
          docs: (prev.group.docs || []).filter(x => x.id !== doc.id && k07RowHideKey(x) !== k07RowHideKey(doc))
        }
      } : prev)
    }
    setMessage('K07: ukryto wiersz w kartotece.')
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
    if (!employeeName?.trim()) { setMessage('Wybierz pracownika z listy.'); return }
    await applyK07ColumnForGroup(group, 'podpis_kontrolujacego', employeeName.trim(), onlyEmpty)
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
    await deleteMonthHubGroup(group, 'R13')
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

  function resolveMonthHubGroupDocs(group, allDocs) {
    if (!group?.type || !group?.period) return group?.docs || []
    if (isRMonthlyReport(group.type)) return resolveRMonthlyGroupDeleteDocs(group.type, allDocs, group)
    return (allDocs || []).filter(d => {
      if (d.document_type !== group.type) return false
      const period = d.data?.month_key || String(d.document_date || '').slice(0, 7)
      return period === group.period
    })
  }

  async function deleteMonthHubGroup(group, codeLabel) {
    if (!supabase || !group?.period) return
    if (!ensureCanDelete()) return
    const docsToDelete = resolveMonthHubGroupDocs(group, haccpDocs)
    if (!docsToDelete.length) {
      setMessage(`${codeLabel}: brak wpisów do usunięcia. Odśwież listę i spróbuj ponownie.`)
      return
    }
    if (!confirmDelete(`Całą kartotekę ${codeLabel} za ${group.period} (${docsToDelete.length} wpisów).\n\nWpis trafi do historii.`)) return
    try {
      await auditDeleteHaccpDocuments(supabase, docsToDelete, getAuditActor(), `${codeLabel} ${group.period}`)
      const removedIds = docsToDelete.map(d => d.id)
      mergeHaccpDocsBatch([], removedIds)
      setSelectedHaccpDoc(null)
      setMessage(`${codeLabel}: usunięto kartotekę za ${group.period} (${docsToDelete.length} wpisów, zapis w historii).`)
      loadHaccpDocs({ force: true }).catch(() => {})
    } catch (err) {
      setMessage(`${codeLabel}: ${err.message}`)
    }
  }

  async function deleteR01Month(group) {
    await deleteMonthHubGroup(group, 'R01')
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
    await deleteMonthHubGroup(group, 'R02')
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
    if (!employeeName?.trim()) { setMessage('Wybierz pracownika z listy.'); return }
    const name = employeeName.trim()
    const docs = (group?.docs || []).map(d => getLiveK06Doc(d, k06Overrides))
    const targets = onlyEmpty
      ? docs.filter(d => !(d.signed_by_operator || normalizeK06Data(d.data || {}).podpis))
      : docs
    if (!targets.length) { setMessage(onlyEmpty ? 'Nie ma pustych podpisów K06.' : 'Brak wpisów K06.'); return }
    if (!supabase) { setMessage('Brak bazy – podpis K06 wymaga Supabase.'); return }
    if (!onlyEmpty && !window.confirm(`Ustawić podpis „${name}" dla ${targets.length} pozycji K06?`)) return
    try {
      for (const doc of targets) {
        await saveK06DocumentField(doc, { podpis: name })
      }
      await loadHaccpDocs()
      setMessage(`Ustawiono podpis K06 dla ${targets.length} pozycji.`)
    } catch (err) {
      setMessage(`Błąd podpisu K06: ${err.message}`)
    }
  }

  async function setEmployeeForVisibleK02Group(group, employeeName, onlyEmpty = false) {
    if (!employeeName?.trim()) { setMessage('Wybierz pracownika z listy.'); return }
    const docs = (group?.docs || [])
    const targets = onlyEmpty
      ? docs.filter(d => !k02FieldValue(getLiveK02Doc(d), 'podpis_kontrolujacego', ''))
      : docs
    if (!targets.length) { setMessage(onlyEmpty ? 'Nie ma pustych podpisów K02.' : 'Brak wpisów K02.'); return }
    if (!onlyEmpty && !window.confirm(`Ustawić podpis „${employeeName.trim()}" dla ${targets.length} pozycji K02?`)) return
    const name = employeeName.trim()
    for (const doc of targets) {
      setK02Override(doc, 'podpis_kontrolujacego', name)
    }
    setMessage(`Ustawiono podpis K02 dla ${targets.length} pozycji.`)
  }

  function shiftK02NewMonth(delta) {
    const [y, m] = k02NewMonth.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setK02NewMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  async function createK02MonthKartoteka() {
    if (haccpBusy) return
    if (!supabase) {
      setMessage('K02: brak połączenia z bazą (Supabase).')
      return
    }
    const yearMonth = k02NewMonth
    if (!yearMonth) {
      setMessage('K02: wybierz rok i miesiąc.')
      return
    }
    const existingMonth = (haccpDocs || []).filter(d =>
      d.document_type === 'K02' && (d.data?.month_key === yearMonth || String(d.document_date || '').slice(0, 7) === yearMonth)
    )
    if (existingMonth.length && !window.confirm(
      `Kartoteka K02 za ${yearMonth} ma już ${existingMonth.length} wpisów w bazie.\n\nDodać brakujące dni? (Istniejące wpisy nie zostaną zmienione.)`
    )) return
    const k01 = (haccpDocs || []).filter(d => d.document_type === 'K01' && String(d.document_date || '').slice(0, 7) === yearMonth)
    const payloads = buildK02MonthPayloads(yearMonth, {
      signedBy: defaultK02Employee || '',
      k01ByDay: k01DocsByDay(k01)
    })
    const existingDates = new Set(existingMonth.map(d => String(d.document_date).slice(0, 10)))
    const toInsert = payloads.filter(p => !existingDates.has(String(p.document_date).slice(0, 10)))
    if (!toInsert.length) {
      setMessage(`K02: wszystkie dni ${yearMonth} są już w kartotece.`)
      return
    }
    setHaccpBusy(true)
    try {
      const { rows } = await batchInsertHaccpDocuments(supabase, toInsert)
      mergeHaccpDocsBatch(rows)
      const sundays = toInsert.filter(p => p.data?.is_day_off).length
      setMessage(
        `K02: utworzono kartotekę za ${yearMonth} – ${rows.length} dni` +
        (sundays ? ` (${sundays} niedziel pustych)` : '') +
        (defaultK02Employee ? `, podpis: ${defaultK02Employee}` : '') +
        '. Zapis tylko w dokumentacji HACCP – FIFO bez zmian.'
      )
    } catch (err) {
      setMessage(`K02: błąd tworzenia – ${err.message}`)
    } finally {
      setHaccpBusy(false)
    }
  }

  function setK06Override(doc, field, value) {
    if (!doc?.id) return
    setK06Overrides(prev => ({
      ...prev,
      [doc.id]: { ...(prev[doc.id] || {}), [field]: value }
    }))
  }

  function hideK06Row(doc) {
    const key = k06RowHideKey(doc)
    if (!key) return
    setK06HiddenKeys(prev => {
      const next = new Set(prev)
      next.add(key)
      try {
        localStorage.setItem(K06_HIDDEN_STORAGE_KEY, JSON.stringify([...next]))
      } catch { /* ignore quota */ }
      return next
    })
  }

  async function saveK06DocumentField(doc, patch = {}) {
    if (!supabase || !doc) return null
    try {
      const mergedPatch = { ...patch }
      if (patch.podpis_kontrolujacego !== undefined && patch.podpis === undefined) {
        mergedPatch.podpis = patch.podpis_kontrolujacego
      }
      const ov = { ...(k06Overrides[doc.id] || {}), ...mergedPatch }
      const live = getLiveK06Doc(doc, { [doc.id]: ov })
      const k03Key = live.data?.k03_key
      const existing = k03Key
        ? (haccpDocs || []).find(d => d.document_type === 'K06' && d.data?.k03_key === k03Key && isPersistedHaccpDoc(d))
        : (isPersistedHaccpDoc(doc) ? doc : null)

      const signed = mergedPatch.podpis ?? mergedPatch.podpis_kontrolujacego ?? live.signed_by_operator ?? live.data?.podpis ?? ''
      let workingDoc = existing || doc

      if (!existing && isSyntheticK06Doc(doc)) {
        const nextData = normalizeK06Data({ ...(live.data || {}), ...mergedPatch, podpis: signed })
        const payload = buildK06InsertPayload({
          ...live,
          signed_by_operator: signed,
          data: nextData,
          status: ['barwa', 'zapach', 'twardosc_jablko', 'brak_plesni'].some(k => nextData[k] === 'N') ? 'N' : 'P'
        })
        const { data: inserted, error } = await supabase.from('haccp_documents').insert(payload).select('*').single()
        if (error) throw error
        workingDoc = inserted
        setK06Overrides(prev => {
          const next = { ...prev }
          delete next[doc.id]
          return next
        })
      } else {
        const base = existing || doc
        const nextData = normalizeK06Data({ ...(base.data || {}), ...mergedPatch, podpis: signed })
        const rowPatch = {}
        if (mergedPatch.document_date !== undefined || mergedPatch.przerob_date !== undefined) {
          rowPatch.document_date = mergedPatch.document_date ?? mergedPatch.przerob_date ?? base.document_date
        }
        if (mergedPatch.lot_no !== undefined) rowPatch.lot_no = mergedPatch.lot_no
        if (mergedPatch.product_name !== undefined) rowPatch.product_name = mergedPatch.product_name
        const payload = {
          ...rowPatch,
          data: nextData,
          status: ['barwa', 'zapach', 'twardosc_jablko', 'brak_plesni'].some(k => nextData[k] === 'N') ? 'N' : 'P',
          signed_by_operator: signed || null,
          updated_at: new Date().toISOString()
        }
        const { error } = await supabase.from('haccp_documents').update(payload).eq('id', base.id)
        if (error) throw error
        workingDoc = { ...base, ...payload }
        if (doc.id !== base.id) {
          setK06Overrides(prev => {
            const next = { ...prev }
            delete next[doc.id]
            return next
          })
        }
      }
      mergeHaccpDoc(workingDoc.id, workingDoc)
      return workingDoc
    } catch (err) {
      setMessage(`K06: błąd zapisu – ${err.message}`)
      return null
    }
  }

  async function setK06DocumentEmployee(doc, employeeName) {
    const name = String(employeeName || '').trim()
    if (!name) return
    const result = await saveK06DocumentField(doc, { podpis: name })
    if (result) {
      await loadHaccpDocs()
      setMessage('K06: zapisano podpis.')
    }
  }

  async function deleteK06Row(doc) {
    if (!doc) return
    const label = [doc.product_name, doc.lot_no, doc.document_date].filter(Boolean).join(' · ')
    if (isPersistedHaccpDoc(doc)) {
      if (!ensureCanDelete()) return
      if (!confirmDelete(`Wpis K06: ${label}.\n\nWpis trafi do historii.`)) {
        setK06DeletePending(null)
        return
      }
      if (!window.confirm('Ostateczne potwierdzenie: usunąć ten wiersz K06? Bez przywrócenia przez administratora zniknie na stałe.')) {
        setK06DeletePending(null)
        return
      }
      try {
        await auditDeleteHaccpDocument(supabase, doc, getAuditActor())
        hideK06Row(doc)
        setK06DeletePending(null)
        if (selectedHaccpDoc?.groupPreview) {
          setSelectedHaccpDoc(prev => prev ? {
            ...prev,
            group: {
              ...prev.group,
              docs: (prev.group.docs || []).filter(d => d.id !== doc.id)
            }
          } : prev)
        }
        await loadHaccpDocs()
        setMessage('K06: usunięto wpis (zapis w historii).')
      } catch (err) {
        setMessage(`K06: błąd usuwania – ${err.message}`)
      }
      return
    }
    if (!window.confirm(`Ukryć wiersz K06: ${label}?\n\nWpis zniknie z kartoteki. Powiązanie z K03 pozostaje – wiersz nie wróci, dopóki nie usuniesz ukrycia.`)) {
      setK06DeletePending(null)
      return
    }
    if (!window.confirm('Potwierdź ukrycie wiersza K06.')) {
      setK06DeletePending(null)
      return
    }
    hideK06Row(doc)
    setK06DeletePending(null)
    if (selectedHaccpDoc?.groupPreview) {
      setSelectedHaccpDoc(prev => prev ? {
        ...prev,
        group: {
          ...prev.group,
          docs: (prev.group.docs || []).filter(d => d.id !== doc.id && k06RowHideKey(d) !== k06RowHideKey(doc))
        }
      } : prev)
    }
    setMessage('K06: ukryto wiersz w kartotece.')
  }

  async function commitK06Override(doc, field, value) {
    if (!doc?.id || !supabase) return
    setK06Override(doc, field, value)
    const patch = {}
    if (field === 'document_date' || field === 'przerob_date') {
      patch.document_date = value
      patch.przerob_date = value
    } else if (field === 'lot_no') {
      patch.lot_no = value
    } else if (field === 'product_name') {
      patch.product_name = value
    } else if (['barwa', 'zapach', 'twardosc_jablko', 'brak_plesni', 'podpis'].includes(field)) {
      patch[field] = value
    }
    const result = await saveK06DocumentField(doc, patch)
    if (result) {
      await loadHaccpDocs()
      if (field !== 'podpis') setMessage('K06: zapisano wpis.')
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
    if (isPersistedHaccpDoc(doc)) saveK02FieldToDb(doc, field, value)
  }

  async function saveK02FieldToDb(doc, field, value) {
    if (!supabase || !isPersistedHaccpDoc(doc)) return
    const nextData = { ...(doc.data || {}), [field]: value }
    if (field === 'uwagi') nextData.uwagi = normalizePN(value)
    const payload = {
      data: nextData,
      updated_at: new Date().toISOString()
    }
    if (field === 'podpis_kontrolujacego') payload.signed_by_operator = value || null
    if (field === 'uwagi') payload.status = normalizePN(value)
    try {
      const { error } = await supabase.from('haccp_documents').update(payload).eq('id', doc.id)
      if (error) throw error
      mergeHaccpDoc(doc.id, payload)
    } catch (err) {
      setMessage(`K02: błąd zapisu – ${err.message}`)
    }
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
        if (docsFilter !== 'K03') return true
        const group = d.product_group || d.data?.product_group || productGroupForName(d.product_name || '')
        return matchesK03ClassFilter(d.product_name, group, k03AssortmentFilter)
      })
      .filter(d => matchesDocsDateRange(d.document_date))
      .filter(d => {
        if (docsFilter !== 'K03') {
          if (docsWorkflowFilter === 'all') return true
          if (docsWorkflowFilter === 'do_zatwierdzenia') return !d.signed_by_operator
          if (docsWorkflowFilter === 'czesciowo') return d.status === 'N'
          return true
        }
        return matchesK03WorkflowFilter(k03DocWorkflowModeTag(d), k03DocIsFrozen(d))
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

  const k03ClassCounts = useMemo(() => {
    const inRangeDocs = syntheticK03Docs.filter(d => matchesDocsDateRange(d.document_date))
    const inRangeWz = (wzQueueLines || []).filter(l => matchesDocsDateRange(l.wz_date))
    const items = [
      ...inRangeDocs.map(d => ({ product_name: d.product_name, product_group: d.product_group || d.data?.product_group })),
      ...inRangeWz.map(l => ({ product_name: l.product_name, product_group: l.product_group }))
    ]
    const counts = new Map([['all', items.length]])
    for (const item of items) {
      const group = item.product_group || productGroupForName(item.product_name || '')
      const variant = normalizeFifoProductKey(item.product_name)
      counts.set(`group:${group}`, (counts.get(`group:${group}`) || 0) + 1)
      counts.set(`variant:${variant}`, (counts.get(`variant:${variant}`) || 0) + 1)
    }
    return counts
  }, [syntheticK03Docs, wzQueueLines, docsDateFrom, docsDateTo])

  const k03ExtraVariants = useMemo(() => {
    const items = [
      ...syntheticK03Docs.filter(d => matchesDocsDateRange(d.document_date)),
      ...(wzQueueLines || []).filter(l => matchesDocsDateRange(l.wz_date))
    ]
    return collectExtraK03Variants(items)
  }, [syntheticK03Docs, wzQueueLines, docsDateFrom, docsDateTo])

  const k03AssortmentCounts = k03ClassCounts

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
      if (!map.has(key)) map.set(key, { key, type: doc.document_type, period, product: doc.document_type === 'K04' ? productGroup : (doc.document_type === 'K06' ? 'Produkt gotowy' : doc.document_type === 'K07' ? 'Kontrola sita CCP1' : product), chamber, docs: [] })
      map.get(key).docs.push(doc)
    }
    return Array.from(map.values()).map(g => {
      const docs = g.docs.sort((a,b) => String(a.document_date || '').localeCompare(String(b.document_date || '')) || String(a.document_no || '').localeCompare(String(b.document_no || '')))
      const products = Array.from(new Set(docs.map(d => d.product_name || '').filter(Boolean)))
      return {
        ...g,
        product: g.type === 'K04'
          ? (products.length === 1 ? products[0] : (docs[0]?.data?.produkty || g.product))
          : g.type === 'K06'
            ? (products.length <= 1 ? (products[0] || 'Produkt gotowy') : `${products.length} asortymentów`)
          : g.type === 'K07'
            ? `${Math.max(1, Math.ceil(docs.length / 2))} przerobów (przed/po)`
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
    if (code === 'R09') return []
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

  async function markGroupPrinted(group) {
    if (!group) return
    try {
      await markKartotekaPrinted(supabase, group, {
        printedBy: authDisplayName(authProfile, authSession),
        onMergeDoc: mergeHaccpDoc,
        onLocalUpdate: setKartotekaLocalPrints
      })
    } catch (_) {
      /* informacyjne – nie blokuj druku */
    }
  }

  async function toggleKartotekaPrintStatus(group) {
    if (!group) return
    const info = getKartotekaPrintInfo(group, kartotekaLocalPrints)
    if (!info.printed) return
    const nextStatus = info.status === PRINT_STATUS_NEEDS_REPRINT ? PRINT_STATUS_OK : PRINT_STATUS_NEEDS_REPRINT
    try {
      await setKartotekaPrintStatus(supabase, group, nextStatus, {
        onMergeDoc: mergeHaccpDoc,
        onLocalUpdate: setKartotekaLocalPrints
      })
    } catch (_) {
      /* informacyjne */
    }
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
    return cleanSupplierName(doc?.data?.faktyczny_dostawca || doc?.data?.dostawca_rzeczywisty || doc?.data?.dostawca || '')
  }

  function k01GroupTotalKg(group) {
    return (group?.docs || []).reduce((sum, doc) => sum + Number(doc.qty || 0), 0)
  }

  /** K01: domyślnie tylko nr PZ; ręczny dostawca opcjonalnie przez „Zmień dostawcę”. */
  function shortSupplier(nameOrDoc, docNo) {
    const isDoc = nameOrDoc && typeof nameOrDoc === 'object'
    const doc = isDoc ? nameOrDoc : null
    const pzNo = String(doc?.document_no || docNo || '').trim()
    const manual = doc ? getK01SupplierName(doc) : cleanSupplierName(nameOrDoc)
    if (manual && pzNo) return `${manual} / ${pzNo}`
    if (pzNo) return pzNo
    if (manual) return manual
    return 'Brak nr PZ'
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
      void markGroupPrinted(kartotekaGroupFromDoc(doc))
      return
    }
    setSelectedHaccpDoc(doc)
    setTimeout(() => window.print(), 250)
    void markGroupPrinted(kartotekaGroupFromDoc(doc))
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
    if (isSyntheticK06Doc(doc) && doc.document_type === 'K06') {
      const result = await saveK06DocumentField(doc, {})
      if (!result) return
      workingDoc = result
    }
    if (isSyntheticK07Doc(doc) && doc.document_type === 'K07') {
      const result = await saveK07DocumentField(doc, {})
      if (!result) return
      workingDoc = result
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
              <td><K01Value doc={doc} field="dane_dostawcy" label="Dane dostawcy / nr faktury">{shortSupplier(doc)}</K01Value><button type="button" className={`mini secondary no-print${k01SupplierBusyId === doc.id ? ' btn-busy' : ''}`} disabled={k01SupplierBusyId === doc.id} onClick={()=>promptK01Supplier(doc)}>{k01SupplierBusyId === doc.id ? 'Zapisuję…' : 'Zmień dostawcę'}</button></td>
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
    await markGroupPrinted(group)
  }

  function printHaccpDocument(doc) {
    const cfg = getDocFormCfg(doc?.document_type)
    if (!cfg || !doc) return
    const html = cfg.layout === 'document'
      ? buildDocumentHtml(doc, cfg)
      : buildManualMonthlyHtml({ type: doc.document_type, period: String(doc.document_date || '').slice(0, 7), docs: [doc] }, escapeHtml, cfg)
    printHtmlInIframe(html)
    void markGroupPrinted(kartotekaGroupFromDoc(doc))
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
    if (doc?.document_type === 'K06') {
      await setK06DocumentEmployee(getLiveK06Doc(doc, k06Overrides), employeeName)
      return
    }
    await setDocumentEmployee(doc, employeeName)
  }

  function resolvePreviewGroup(selection) {
    if (!selection?.groupPreview || !selection.group) {
      return hubManualGroups.find(g => g.key === selection?.group?.key)
        || haccpMonthlyGroups.find(g => g.key === selection?.group?.key)
        || selection?.group
        || null
    }
    const freshById = new Map((haccpDocs || []).map(d => [d.id, d]))
    const opened = selection.group
    const mergedDocs = (opened.docs || []).map(d => freshById.get(d.id) || d)
    const freshMeta = haccpMonthlyGroups.find(g => g.key === opened.key)
      || hubManualGroups.find(g => g.key === opened.key)
    return {
      ...(freshMeta || opened),
      ...opened,
      docs: mergedDocs.length ? mergedDocs : (freshMeta?.docs || opened.docs || [])
    }
  }

  async function setEmployeeForVisibleK01Group(group, employeeName, onlyEmpty = false) {
    if (!supabase || !group) return
    if (!employeeName?.trim()) { setMessage('Wybierz pracownika z listy.'); return }
    const name = employeeName.trim()
    const docs = (group.docs || []).filter(d => !onlyEmpty || !(d.signed_by_operator || d.data?.podpis_przyjmujacego))
    if (!docs.length) { setMessage(onlyEmpty ? 'Nie ma pustych podpisów do uzupełnienia.' : 'Brak pozycji do zmiany podpisu.'); return }
    if (!onlyEmpty && !window.confirm(`Ustawić podpis „${name}" dla ${docs.length} pozycji w tej kartotece K01? Poprzednie podpisy w tych wierszach zostaną zastąpione.`)) return
    try {
      for (const doc of docs) {
        const payload = {
          data: { ...(doc.data || {}), podpis_przyjmujacego: name },
          signed_by_operator: name,
          updated_at: new Date().toISOString()
        }
        const { error } = await supabase.from('haccp_documents').update(payload).eq('id', doc.id)
        if (error) throw error
        mergeHaccpDoc(doc.id, payload)
        supabase.from('haccp_document_history').insert({
          document_id: doc.id,
          action: 'wybor_pracownika_zbiorczy',
          field_name: 'signed_by_operator',
          old_value: doc.signed_by_operator || '',
          new_value: name,
          reason: 'Zbiorcze ustawienie podpisu przyjmującego w kartotece K01',
          changed_by: userRole
        }).then(() => {}).catch(() => {})
      }
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
              <td style={{textAlign:'left'}}><span>{shortSupplier(doc)}</span><button type="button" className={`mini secondary no-print${k01SupplierBusyId === doc.id ? ' btn-busy' : ''}`} disabled={k01SupplierBusyId === doc.id} onClick={()=>promptK01Supplier(doc)}>{k01SupplierBusyId === doc.id ? 'Zapisuję…' : 'Zmień dostawcę'}</button></td>
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
      const manualMonth = k02GroupHasManualMonth(docs)
      const maxRows = manualMonth ? docs.length : Math.max(16, docs.length)
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
        <p className="hint no-print">K02: wpisy z dni przyjęć (K01) uzupełniają się automatycznie. Możesz też utworzyć pełną kartotekę miesiąca ręcznie – zapis dotyczy tylko dokumentacji HACCP, bez wpływu na FIFO. Podpis wybierasz ręcznie. Temp.: jabłka/truskawki/wiśnie/porzeczki/aronie 2°C; maliny 1°C.</p>
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
          <button className="secondary" disabled={!defaultK06Employee} onClick={() => setEmployeeForVisibleK06Group(group, defaultK06Employee, false)}>Zastosuj do wszystkich</button>
          <button className="secondary" disabled={!defaultK06Employee} onClick={() => setEmployeeForVisibleK06Group(group, defaultK06Employee, true)}>Uzupełnij puste</button>
        </div>
        <table className="k02-head"><tbody>
          <tr>
            <td className="k02-company" rowSpan="2"><b>AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.<br/>24-335 ŁAZISKA,<br/>KOLONIA ŁAZISKA 30<br/>NIP: 7171839598</b></td>
            <td className="k02-title"><b>Karta K06 - Karta oceny jakości gotowego produktu</b></td>
            <td className="k02-meta"><b>Rok:</b> {group.period.slice(0,4)}<br/><b>Miesiąc:</b> {group.period.slice(5,7)}<br/><b>Strona:</b> 1 z 1</td>
          </tr>
          <tr><td></td><td className="k02-version">Wersja I/2024</td></tr>
        </tbody></table>
        <table className="k06-table"><thead><tr>
          <th className="col-date">Data</th><th className="col-product">Nazwa towaru</th><th className="col-lot">Numer partii</th><th className="col-pn">Barwa<br/>(P/N)*</th><th className="col-pn">Zapach<br/>(P/N)*</th><th className="col-pn">Twardość (jabłko)<br/>(P/N)*</th><th className="col-pn">Brak oznak pleśni<br/>(P/N)*</th><th className="col-sign">Podpis kontrolującego</th><th className="col-actions no-print">Akcje</th>
        </tr></thead><tbody>
          {Array.from({length: maxRows}).map((_,i) => {
            const baseDoc = docs[i]
            if (!baseDoc) return <tr className="blank-row" key={`k06-blank-${i}`}><td className="col-date"></td><td className="col-product"></td><td className="col-lot"></td><td className="col-pn"></td><td className="col-pn"></td><td className="col-pn"></td><td className="col-pn"></td><td className="col-sign"></td><td className="col-actions no-print"></td></tr>
            const doc = getLiveK06Doc(baseDoc, k06Overrides)
            const d = normalizeK06Data(doc.data || {})
            const pnCell = (field, label) => {
              const val = formNormalizePn(d[field] || 'P')
              return <td className={`col-pn${val==='N'?' pn-n':''}`} key={field}>
                <select className="mini-select no-print" value={val} onChange={e => editHaccpRowField(doc, field, label, val, { directValue: e.target.value, pn: true })}><option value="P">P</option><option value="N">N</option></select>
                <span className="print-only">{val}</span>
              </td>
            }
            const signed = doc.signed_by_operator || d.podpis || ''
            const modeHint = d.tryb_label ? ` · ${d.tryb_label}` : ''
            const wzHint = d.wz_no ? ` · WZ ${d.wz_no}${modeHint}` : modeHint
            return <tr key={doc.id}>
              <td className="col-date">
                <input className="cell-input no-print" type="date" defaultValue={doc.document_date} key={`k06-date-${doc.id}-${doc.document_date}`} title="Data oceny (przerób lub WZ bez przerobu)" onBlur={e => { if (e.target.value && e.target.value !== doc.document_date) void commitK06Override(doc, 'przerob_date', e.target.value) }} />
                <span className="print-only">{doc.document_date}</span>
              </td>
              <td className="col-product left">{doc.product_name}{wzHint ? <small className="hint no-print">{wzHint}</small> : null}</td>
              <td className="col-lot">
                <input className="cell-input no-print" type="text" defaultValue={doc.lot_no || ''} key={`k06-lot-${doc.id}-${doc.lot_no}`} onBlur={e => { if (e.target.value !== (doc.lot_no || '')) void commitK06Override(doc, 'lot_no', e.target.value.trim()) }} />
                <span className="print-only">{doc.lot_no}</span>
              </td>
              {pnCell('barwa', 'Barwa')}
              {pnCell('zapach', 'Zapach')}
              {pnCell('twardosc_jablko', 'Twardość (jabłko)')}
              {pnCell('brak_plesni', 'Brak oznak pleśni')}
              <td className="col-sign">
                <select className="mini-select no-print" value={signed} onChange={e => void setK06DocumentEmployee(doc, e.target.value)} title="Podpis kontrolującego"><option value="">Wybierz pracownika</option>{employees.map(emp=><option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}</select>
                <span className="print-only">{signed}</span>
              </td>
              <td className="col-actions no-print k06-actions">
                {k06DeletePending === doc.id ? (
                  <span className="k06-delete-confirm">
                    <button type="button" className="mini danger" onClick={() => void deleteK06Row(doc)}>Potwierdź usunięcie</button>
                    <button type="button" className="mini secondary" onClick={() => setK06DeletePending(null)}>Anuluj</button>
                  </span>
                ) : (
                  <button type="button" className="mini danger" onClick={() => setK06DeletePending(doc.id)} title="Usuń wiersz (wymaga potwierdzenia)">Usuń</button>
                )}
              </td>
            </tr>
          })}
        </tbody></table>
        <p className="hint no-print">K06: jedna kartoteka miesięczna – wpisy z K03 (WZ), nazwa towaru = produkt gotowy z faktury. U góry: podpis zbiorczy dla wszystkich wierszy. Usuwanie wiersza wymaga dwóch kliknięć (Usuń → Potwierdź).</p>
      </div>
    }

    if (group.type === 'K07') {
      const maxRows = Math.max(11, docs.length)
      return <div className="monthly-paper k02-original k07-original">
        <div className="no-print employee-signature-row k07-bulk-row" style={{marginBottom: '10px', flexWrap: 'wrap', gap: '10px'}}>
          <label>Podpis (cała kolumna)
            <select value={defaultK07Employee} onChange={e => setDefaultK07Employee(e.target.value)}>
              <option value="">Wybierz pracownika</option>
              {employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}
            </select>
          </label>
          <button className="secondary" disabled={!defaultK07Employee} onClick={() => setEmployeeForVisibleK07Group(group, defaultK07Employee, false)}>Podpis → wszystkie</button>
          <button className="secondary" disabled={!defaultK07Employee} onClick={() => setEmployeeForVisibleK07Group(group, defaultK07Employee, true)}>Podpis → puste</button>
          <label>Godzina (cała kolumna)
            <input type="time" value={k07BulkGodzina} onChange={e => setK07BulkGodzina(e.target.value)} />
          </label>
          <button className="secondary" disabled={!k07BulkGodzina} onClick={() => void applyK07ColumnForGroup(group, 'godzina', k07BulkGodzina, false)}>Godzina → wszystkie</button>
          <button className="secondary" disabled={!k07BulkGodzina} onClick={() => void applyK07ColumnForGroup(group, 'godzina', k07BulkGodzina, true)}>Godzina → puste</button>
          <label>Stan sita (cała kolumna)
            <select value={k07BulkStanSita} onChange={e => setK07BulkStanSita(e.target.value)}>
              <option value="P">P</option><option value="N">N</option>
            </select>
          </label>
          <button className="secondary" onClick={() => void applyK07ColumnForGroup(group, 'stan_sita', k07BulkStanSita, false)}>Stan sita → wszystkie</button>
          <button className="secondary" onClick={() => void applyK07ColumnForGroup(group, 'stan_sita', k07BulkStanSita, true)}>Stan sita → puste</button>
        </div>
        <table className="k02-head"><tbody>
          <tr>
            <td className="k02-company" rowSpan="2"><b>AGRO-MAR MARIUSZ BAŃKA SP. Z O.O.<br/>24-335 ŁAZISKA,<br/>KOLONIA ŁAZISKA 30<br/>NIP: 7171839598</b></td>
            <td className="k02-title"><b>Karta K07 - Karta kontroli stanu sita<br/>na linii do przerobu na pulpę (CCP1)</b></td>
            <td className="k02-meta"><b>Rok:</b> {group.period.slice(0,4)}<br/><b>Miesiąc:</b> {group.period.slice(5,7)}<br/><b>Strona:</b> 1 z 1</td>
          </tr>
          <tr><td className="k02-note">Godzina (kontrolę należy przeprowadzać przed i po zakończeniu procesu rozdrabniania)</td><td className="k02-version">Wersja I/2024</td></tr>
        </tbody></table>
        <table className="k07-table"><thead><tr>
          <th className="col-date">Data</th><th className="col-etap">Etap</th><th className="col-time">Godzina</th><th className="col-product">Rodzaj przerabianego surowca</th><th className="col-lot">Produkowany numer partii</th><th className="col-pn">Stan sita<br/>(P/N)*</th><th className="col-sign">Podpis kontrolującego</th><th className="col-actions no-print">Akcje</th>
        </tr></thead><tbody>
          {Array.from({length: maxRows}).map((_,i) => {
            const baseDoc = docs[i]
            if (!baseDoc) return <tr className="blank-row" key={`k07-blank-${i}`}><td className="col-date"></td><td className="col-etap"></td><td className="col-time"></td><td className="col-product"></td><td className="col-lot"></td><td className="col-pn"></td><td className="col-sign"></td><td className="col-actions no-print"></td></tr>
            const doc = getLiveK07Doc(baseDoc, k07Overrides)
            const d = normalizeK07Data(doc.data || {}, doc)
            const godzina = d.godzina || ''
            const surowiec = d.surowiec || doc.product_name || ''
            const numerPartii = d.numer_partii || doc.lot_no || ''
            const stan = formNormalizePn(d.stan_sita || 'P')
            const signed = doc.signed_by_operator || d.podpis_kontrolujacego || ''
            const etapLabel = d.kontrola_label || (d.kontrola_etap === 'przed' ? 'Przed przerobem' : d.kontrola_etap === 'po' ? 'Po przerobie' : '')
            return <tr key={doc.id}>
              <td className="col-date">{doc.document_date}</td>
              <td className="col-etap">{etapLabel || '—'}</td>
              <td className="col-time">
                <input className="cell-input no-print" type="time" value={godzina} onChange={e => setK07Override(doc, 'godzina', e.target.value)} onBlur={e => void commitK07Override(doc, 'godzina', e.target.value)} placeholder="--:--" />
                <span className="print-only">{godzina || '—'}</span>
              </td>
              <td className="col-product left">
                <input className="cell-input no-print wide" type="text" value={surowiec} onChange={e => setK07Override(doc, 'surowiec', e.target.value)} onBlur={e => void commitK07Override(doc, 'surowiec', e.target.value)} />
                <span className="print-only">{surowiec}</span>
              </td>
              <td className="col-lot">
                <input className="cell-input no-print" type="text" value={numerPartii} onChange={e => setK07Override(doc, 'numer_partii', e.target.value)} onBlur={e => void commitK07Override(doc, 'numer_partii', e.target.value)} />
                <span className="print-only">{numerPartii}</span>
              </td>
              <td className={`col-pn${stan === 'N' ? ' pn-n' : ''}`}>
                <select className="mini-select no-print" value={stan} onChange={e => void commitK07Override(doc, 'stan_sita', e.target.value)}><option value="P">P</option><option value="N">N</option></select>
                <span className="print-only">{stan}</span>
              </td>
              <td className="col-sign">
                <select className="mini-select no-print" value={signed} onChange={e => void commitK07Override(doc, 'podpis_kontrolujacego', e.target.value)}><option value="">Wybierz</option>{employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}</select>
                <span className="print-only">{signed}</span>
              </td>
              <td className="col-actions no-print k07-actions">
                {k07DeletePending === doc.id ? (
                  <span className="k07-delete-confirm">
                    <button type="button" className="mini danger" onClick={() => void deleteK07Row(doc)}>Potwierdź usunięcie</button>
                    <button type="button" className="mini secondary" onClick={() => setK07DeletePending(null)}>Anuluj</button>
                  </span>
                ) : (
                  <button type="button" className="mini danger" onClick={() => setK07DeletePending(doc.id)} title="Usuń wiersz (wymaga potwierdzenia)">Usuń</button>
                )}
              </td>
            </tr>
          })}
        </tbody></table>
        <p className="hint no-print">K07: jedna kartoteka miesięczna – 2 wpisy na każdy przerób na pulpę (przed i po). Godziny uzupełniasz ręcznie lub zbiorczo u góry. Usuwanie wiersza: Usuń → Potwierdź.</p>
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
        mergeHaccpDocsBatch={mergeHaccpDocsBatch}
        setMessage={setMessage}
        defaultEmployee=""
        allowDelete={isAdmin(authProfile)}
        setSelectedHaccpDoc={setSelectedHaccpDoc}
        onAuditDelete={async (docs, reason) => {
          if (!ensureCanDelete()) throw new Error('Tylko administrator może usuwać wpisy.')
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
            const rawPz = resolveK03PzNoFromRow(rawRows[i]) || rawRows[i]?.pz_no_display || ''
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
    if (type === 'K07' && !form.kontrola_etap) form.kontrola_etap = 'przed'
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
    if (type === 'K07') {
      const etap = data.kontrola_etap || manualHaccpForm.kontrola_etap || 'przed'
      data.kontrola_etap = etap
      data.kontrola_label = etap === 'po' ? 'Po przerobie' : 'Przed przerobem'
    }
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
    const registerGroup = { key: `${type}|register`, type, docs: docs || [] }
    if (type === 'W03') {
      printHtmlInIframe(buildW03PrintHtml(docs, w03Meta, escapeHtml))
      void markGroupPrinted(registerGroup)
      return
    }
    if (type === 'W06') {
      printHtmlInIframe(buildW06PrintHtml(docs, escapeHtml))
      void markGroupPrinted(registerGroup)
      return
    }
    if (type === 'K06') {
      const period = String(docs[0]?.document_date || haccpMonth).slice(0, 7)
      printHtmlInIframe(buildK06MonthlyHtml({ type, period, docs }, escapeHtml))
      void markGroupPrinted({ key: `${type}|${period}`, type, period, docs })
      return
    }
    if (type === 'K07') {
      const period = String(docs[0]?.document_date || haccpMonth).slice(0, 7)
      printHtmlInIframe(buildK07MonthlyHtml({ type, period, docs }, escapeHtml))
      void markGroupPrinted({ key: `${type}|${period}`, type, period, docs })
      return
    }
    const cfg = getDocFormCfg(type)
    if (!cfg || !docs.length) { setMessage('Brak wpisów do wydruku.'); return }
    const period = String(docs[0]?.document_date || haccpMonth).slice(0, cfg.periodMode === 'year' ? 4 : 7)
    printHtmlInIframe(buildManualMonthlyHtml({ type, period, docs }, escapeHtml, cfg))
    void markGroupPrinted({ key: `${type}|${period}`, type, period, docs })
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
        <KartotekaPrintBadge group={{ key: `${type}|${period}`, type, period, docs: periodDocs }} localPrints={kartotekaLocalPrints} onToggle={toggleKartotekaPrintStatus} />
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
        <button className="secondary" disabled={haccpBusy} onClick={() => clickRefreshHaccp()}><RefreshCcw size={16}/> {haccpBusy ? 'Odświeżanie…' : 'Odśwież'}</button>
        <button className="secondary" onClick={() => printManualHaccpPeriod('W06', w06Docs)}><Printer size={16}/> Druk / PDF</button>
        <KartotekaPrintBadge group={{ key: 'W06|register', type: 'W06', docs: w06Docs }} localPrints={kartotekaLocalPrints} onToggle={toggleKartotekaPrintStatus} />
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
        <button className="secondary" disabled={haccpBusy} onClick={() => clickRefreshHaccp()}><RefreshCcw size={16}/> {haccpBusy ? 'Odświeżanie…' : 'Odśwież'}</button>
        <button className="secondary" onClick={() => printManualHaccpPeriod('W03', w03Docs)}><Printer size={16}/> Druk / PDF</button>
        <KartotekaPrintBadge group={{ key: 'W03|register', type: 'W03', docs: w03Docs }} localPrints={kartotekaLocalPrints} onToggle={toggleKartotekaPrintStatus} />
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

  function renderK02Section() {
    return <>
      <div className="card inner-card no-print r13-add-panel">
        <h3>Utwórz kartotekę K02 za miesiąc</h3>
        <p className="hint">
          System utworzy <b>wpis na każdy dzień kalendarza</b> wybranego miesiąca (niedziele puste).
          Dni z przyjęciem PZ (K01) dostaną domyślną temperaturę wg asortymentu (maliny 1°C, pozostałe 2°C).
          Zapis trafia tylko do dokumentacji HACCP – <b>nie zmienia partii, operacji ani FIFO</b>.
        </p>
        <div className="k03-bulk-row">
          <label>Rok i miesiąc
            <div className="r13-month-picker">
              <button type="button" className="mini secondary" onClick={() => shiftK02NewMonth(-1)} title="Poprzedni miesiąc">◀</button>
              <input type="month" value={k02NewMonth} onChange={e => setK02NewMonth(e.target.value)} />
              <button type="button" className="mini secondary" onClick={() => shiftK02NewMonth(1)} title="Następny miesiąc">▶</button>
            </div>
          </label>
          <label>Podpis kontrolujący (domyślny)
            <select value={defaultK02Employee} onChange={e => {
              const v = e.target.value
              setDefaultK02Employee(v)
              try { localStorage.setItem(K02_DEFAULT_EMPLOYEE_KEY, v) } catch (_) {}
            }}>
              <option value="">Wybierz pracownika</option>
              {employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}
            </select>
          </label>
          <button onClick={createK02MonthKartoteka} disabled={haccpBusy}>{haccpBusy ? 'Tworzenie…' : 'Utwórz kartotekę miesiąca'}</button>
        </div>
        <p className="hint">Silnik K02: {K02_ENGINE_VERSION}. Bez K01 nadal działają wpisy auto z dni przyjęć; ręczna kartoteka uzupełnia cały miesiąc.</p>
      </div>
      {haccpMonthlyGroups.length === 0 && <p className="hint">Brak kartotek K02 w filtrze – utwórz miesiąc powyżej lub poczekaj na przyjęcia PZ (K01).</p>}
      {haccpMonthlyGroups.length > 0 && <>
        <h3>Lista kartotek K02</h3>
        <div className="table-wrap docs-table-wrap"><table className="docs-table">
          <thead><tr><th>Okres</th><th>Wpisy</th><th>Typ</th><th>N</th><th>Akcje</th></tr></thead>
          <tbody>{haccpMonthlyGroups.map(g => (
            <tr key={g.key}>
              <td><b>{periodLabel(g)}</b><KartotekaPrintBadge group={g} localPrints={kartotekaLocalPrints} onToggle={toggleKartotekaPrintStatus} /></td>
              <td>{g.docs.length}</td>
              <td>{k02GroupHasManualMonth(g.docs) ? 'ręczna / miesiąc' : 'auto z K01'}</td>
              <td>{g.docs.filter(d => normalizePN(d.data?.uwagi || d.status) === 'N').length || '—'}</td>
              <td className="row-actions">
                <button className="mini secondary" onClick={() => setSelectedHaccpDoc({ groupPreview: true, group: g })}><Eye size={14}/> Otwórz</button>
                <button className="mini secondary" onClick={() => printHaccpGroup(g)}><Printer size={14}/></button>
                <button className="mini secondary" onClick={() => exportHaccpGroupExcel(g)}>XLS</button>
                {isAdmin(authProfile) && g.docs.some(isPersistedHaccpDoc) && (
                  <button className="mini danger" onClick={() => deleteKartotekaGroup(g)} disabled={haccpBusy}><Trash2 size={14}/> Usuń</button>
                )}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      </>}
    </>
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
              <td><b>{g.period}</b> <span className="hint">({(g.columns || r02ColumnsFromDocs(g.docs)).length} maszyn)</span><KartotekaPrintBadge group={g} localPrints={kartotekaLocalPrints} onToggle={toggleKartotekaPrintStatus} /></td>
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
              <td><b>{g.period}</b> <span className="hint">({(g.columns || r01ColumnsFromDocs(g.docs)).length} obiektów)</span><KartotekaPrintBadge group={g} localPrints={kartotekaLocalPrints} onToggle={toggleKartotekaPrintStatus} /></td>
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
              <td><b>{g.period}</b> <span className="hint">({cols.map(c => c.label).join(', ')})</span><KartotekaPrintBadge group={g} localPrints={kartotekaLocalPrints} onToggle={toggleKartotekaPrintStatus} /></td>
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
              <button className="secondary" disabled={haccpBusy} onClick={() => clickRefreshHaccp()}><RefreshCcw size={16}/> {haccpBusy ? 'Odświeżanie…' : 'Odśwież'}</button>
            </div>
          </div>
          {code === 'W03' ? renderW03Section() : code === 'W06' ? renderW06Section() : code === 'R02' ? renderR02Section() : code === 'R01' ? renderR01Section() : code === 'R13' ? renderR13Section(          ) : code === 'R09' ? (
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
                if (!ensureCanDelete()) throw new Error('Tylko administrator może usuwać wpisy.')
                await auditDeleteHaccpDocuments(supabase, docs, getAuditActor(), reason)
              }}
              kartotekaLocalPrints={kartotekaLocalPrints}
              onTogglePrintStatus={toggleKartotekaPrintStatus}
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
                  <td><b>{hubPeriodLabel(g, gcfg)}</b><KartotekaPrintBadge group={g} localPrints={kartotekaLocalPrints} onToggle={toggleKartotekaPrintStatus} /></td>
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

  function printK011() {
    printHtmlInIframe(buildK011Html(auxVisibleRows))
    void markGroupPrinted({ key: `K01.1|${auxYear}|H${auxHalf}`, type: 'K01.1', docs: [] })
  }

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
            <td>K01.1</td><td>{row.year} – {row.label}<KartotekaPrintBadge group={{ key: `K01.1|${row.year}|H${row.half}`, type: 'K01.1', docs: [] }} localPrints={kartotekaLocalPrints} onToggle={toggleKartotekaPrintStatus} /></td><td>{row.count}</td>
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
      <div className="actions no-print"><button className="secondary" onClick={loadAuxMaterials}><RefreshCcw size={16}/> Odśwież</button><button className="secondary" onClick={printK011}><Printer size={16}/> Druk/PDF</button><KartotekaPrintBadge group={{ key: `K01.1|${auxYear}|H${auxHalf}`, type: 'K01.1', docs: [] }} localPrints={kartotekaLocalPrints} onToggle={toggleKartotekaPrintStatus} /><button className="secondary" onClick={exportK011Excel}>Pobierz Excel</button></div>
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
      const liveGroup = resolvePreviewGroup(doc)
      return <div className="modal-backdrop" onClick={() => setSelectedHaccpDoc(null)}><div className="haccp-modal wide" onClick={e => e.stopPropagation()}><div className="haccp-paper">{renderGroupPreviewTable(liveGroup)}</div><div className="modal-actions no-print">
        {liveGroup.type === 'K03' && (liveGroup.docs || [])[0] && (liveGroup.docs[0].frozen
          ? <>
            <span className="status ok">Zamrożony – FIFO nie zmieni tej kartoteki</span>
            <button className="secondary" onClick={() => unfreezeK03Document(liveGroup.docs[0])}>Odmroź</button>
          </>
          : <span className="pill">Roboczy – uzupełnij dane; prawidłowy K03 zamraża się automatycznie przy tworzeniu</span>)}
        <button className="secondary" onClick={() => printHaccpGroup(liveGroup)}><Printer size={16}/> Drukuj / PDF</button><KartotekaPrintBadge group={liveGroup} localPrints={kartotekaLocalPrints} onToggle={toggleKartotekaPrintStatus} /><button className="secondary" onClick={() => exportHaccpGroupExcel(liveGroup)}>Pobierz Excel</button>
        {isAdmin(authProfile) && liveGroup.type === 'R02' && <button className="secondary danger" onClick={() => deleteR02Month(liveGroup)}><Trash2 size={16}/> Usuń kartotekę</button>}
        {isAdmin(authProfile) && liveGroup.type === 'R01' && <button className="secondary danger" onClick={() => deleteR01Month(liveGroup)}><Trash2 size={16}/> Usuń kartotekę</button>}
        {isAdmin(authProfile) && liveGroup.type === 'R13' && <button className="secondary danger" onClick={() => deleteR13Month(liveGroup)}><Trash2 size={16}/> Usuń kartotekę</button>}
        {isAdmin(authProfile) && String(liveGroup.type || '').startsWith('K') && <>
          {liveGroup.type === 'K01' && (
            <span className="k01-group-total" title="Suma ilości z wpisów w kartotece">
              Σ <b>{k01GroupTotalKg(liveGroup).toLocaleString('pl-PL')} kg</b>
            </span>
          )}
          <button className="secondary danger" onClick={() => deleteKartotekaGroup(liveGroup)} disabled={haccpBusy}><Trash2 size={16}/> Usuń kartotekę</button>
        </>}
        {isAdmin(authProfile) && isRMonthlyReport(liveGroup.type) && <button className="secondary danger" onClick={async () => {
          const docsToDelete = resolveRMonthlyGroupDeleteDocs(liveGroup.type, haccpDocs, liveGroup)
          if (!docsToDelete.length) {
            setMessage(`${liveGroup.type}: brak wpisów do usunięcia. Odśwież listę i spróbuj ponownie.`)
            return
          }
          if (!supabase || !ensureCanDelete() || !confirmDelete(`Kartotekę ${liveGroup.type} za ${liveGroup.displayLabel || liveGroup.period} (${docsToDelete.length} wpisów).`)) return
          try {
            await auditDeleteHaccpDocuments(supabase, docsToDelete, getAuditActor(), `${liveGroup.type} ${liveGroup.period}`)
            mergeHaccpDocsBatch([], docsToDelete.map(d => d.id))
            setSelectedHaccpDoc(null)
            setMessage(`${liveGroup.type}: usunięto kartotekę (zapis w historii).`)
            loadHaccpDocs({ force: true }).catch(() => {})
          } catch (err) {
            setMessage(`${liveGroup.type}: ${err.message}`)
          }
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
      : group.type === 'K02'
        ? '\n\nFIFO, partie i operacje magazynowe NIE zostaną zmienione – usuwana jest tylko kartoteka pomiarów CP2.'
        : ''
    if (!confirmDelete(`Całą kartotekę ${group.type}${label ? `: ${label}` : ''} (${deletable.length} wpisów).\n\nWpis trafi do historii – administrator może przywrócić.${fifoNote}`)) return
    setHaccpBusy(true)
    try {
      await auditDeleteHaccpDocuments(supabase, deletable, getAuditActor(), `${group.type} ${label || group.period || ''}`.trim())
      mergeHaccpDocsBatch([], deletable.map(d => d.id))
      if (group.type === 'K03') await loadK03TraceData()
      setSelectedHaccpDoc(null)
      setMessage(`${group.type}: usunięto kartotekę (${deletable.length} wpisów) – zapis w Historii.`)
      loadHaccpDocs({ force: true }).catch(() => {})
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
    if (activeTab === 'stany' && supabase && authReady && (authProfile || skipAuth)) {
      loadStanyData()
    }
  }, [activeTab, stanyAsOfDate, authReady, authProfile?.auth_user_id, skipAuth])

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
    setFifoProgress({ phase: 'init', current: 0, total: 0, message: 'Przygotowanie przeliczenia FIFO…' })
    setMessage('Przeliczanie FIFO…')
    try {
      await repairAllIncomingLotRemainingFromAllocations(supabase, {
        onProgress: (msg) => setMessage(msg || 'Synchronizacja kg partii…')
      })
      const fifoResult = await recalculateFifoIncremental(supabase, {
        frozenKeys,
        onProgress: (p) => {
          setFifoProgress(p)
          if (p.phase === 'running' && p.total) {
            setMessage(`FIFO: ${p.current}/${p.total} WZ (${p.processed || 0} uzupełnionych, ${p.skippedComplete || 0} pominiętych)…`)
          } else if (p.phase === 'saving') {
            setMessage(p.message || 'Zapis partii magazynowych…')
          }
        }
      })
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
      setFifoProgress(null)
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

  function importGroupDateRange(groups) {
    const dates = (groups || [])
      .map(g => String(g.issueDate || '').slice(0, 10))
      .filter(Boolean)
      .sort()
    if (!dates.length) return ''
    return dates.length === 1 ? dates[0] : `${dates[0]} … ${dates[dates.length - 1]}`
  }

  function importDateRangeAfter(isoDate) {
    if (!isoDate) return ''
    const d = new Date(`${isoDate}T12:00:00`)
    if (Number.isNaN(d.getTime())) return ''
    d.setDate(d.getDate() + 1)
    return d.toISOString().slice(0, 10)
  }

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setMessage('')
    setImportDuplicates([])
    setImportDuplicateDetails(new Map())
    setImportOrphanCount(0)
    importCheckCacheRef.current = null
    try {
      const { rows: parsed, skippedMmCount } = await readAgromarExcel(file, { includeUnitPrice: false })
      setRows(parsed)
      let loadMsg = `Wczytano ${parsed.length} wierszy. Import HACCP/magazyn: nr PZ/WZ/FV, data, produkt, ilość — bez ceny netto.`
      loadMsg += ` Wartość magazynu (ceny) wgrywasz osobno: Raporty → Wartość magazynu.`
      if (skippedMmCount > 0) {
        loadMsg += ` Pominięto ${skippedMmCount} wierszy MM (przesunięcia magazynowe).`
      }
      if (supabase) {
        const classified = parsed
          .map(r => {
            const documentNo = normalizeDocumentNo(r.documentNo)
            const operation = classifyOperation(r.documentType, r.documentNo)
            return {
              ...r,
              documentNo,
              operation,
              issueDate: resolveDocumentIssueDate(r.issueDate, documentNo)
            }
          })
          .filter(r => r.operation !== 'pominiete_mm')
        const groups = groupImportRows(classified)
        const rowsInGroups = groups.reduce((s, g) => s + (g.items?.length || 0), 0)
        const fileDateRange = importGroupDateRange(groups)
        const { keys, details, orphanCount } = await getExistingOperationsForImport(supabase, groups)
        const { duplicates, fresh } = splitImportGroupsByExisting(groups, keys)
        setImportDuplicates(duplicates)
        setImportNewDocCount(fresh.length)
        setImportDuplicateDetails(details)
        setImportOrphanCount(orphanCount)
        importCheckCacheRef.current = { fileName: file.name, groupsCount: groups.length, keys, details, orphanCount }

        loadMsg += ` W pliku: ${groups.length} dokumentów (${rowsInGroups} wierszy operacyjnych).`
        if (fileDateRange) loadMsg += ` Zakres dat w całym pliku: ${fileDateRange}.`

        if (orphanCount > 0) {
          loadMsg += ` Wykryto ${orphanCount} operacji z usuniętych importów – zostaną wyczyszczone przed zapisem.`
        }
        if (duplicates.length) {
          const examples = duplicates.slice(0, 5).map(d => {
            const det = details.get(`${d.operation}|${normalizeDocumentNo(d.documentNo)}`)
            return `${d.documentNo}${det?.importFilename ? ` (${det.importFilename})` : ''}`
          }).join(', ')
          const dupRange = importGroupDateRange(duplicates)
          loadMsg += ` Już w bazie (pominięte): ${duplicates.length} dokumentów`
          if (dupRange) loadMsg += `, daty ${dupRange}`
          loadMsg += '.'
          if (fresh.length) {
            loadMsg += ` Do zapisu: ${fresh.length} nowych.`
            const freshRange = importGroupDateRange(fresh)
            if (freshRange) loadMsg += ` Daty nowych: ${freshRange}.`
          } else {
            loadMsg += ` Brak nowych numerów — przy Zapisz dokleimy brakujące pozycje z Excela do istniejących PZ/WZ.`
            try {
              const mergeEstimate = await estimateMergeNewItems(supabase, duplicates, details, {
                normalizeText,
                canonicalProductName,
                normalizeFifoProductKey
              })
              if (mergeEstimate > 0) {
                loadMsg = loadMsg.replace(
                  / Brak nowych numerów — przy Zapisz dokleimy brakujące pozycje z Excela do istniejących PZ\/WZ\./,
                  ` Do doklejenia z Excela: ok. ${mergeEstimate} pozycji w istniejących PZ/WZ.`
                )
              }
            } catch {
              /* szacunek opcjonalny */
            }
          }
          const fileMax = fileDateRange.split(' … ').pop()
          const freshMax = importGroupDateRange(fresh).split(' … ').pop()
          if (fresh.length && fileMax && freshMax && fileMax > freshMax) {
            loadMsg += ` Dokumenty od ${importDateRangeAfter(freshMax)} do ${fileMax} są już w bazie — usuń stary import lub duplikaty poniżej, aby wgrać je ponownie.`
          }
          loadMsg += ` Np. w bazie: ${examples}${duplicates.length > 5 ? '…' : ''}.`
        } else if (fresh.length) {
          loadMsg += ` Do zapisu: ${fresh.length} nowych dokumentów.`
          const freshRange = importGroupDateRange(fresh)
          if (freshRange) loadMsg += ` Daty: ${freshRange}.`
        }
        const freshPz = fresh.filter(g => g.operation === 'przyjecie').length
        if (fresh.length === 0 && groups.some(g => g.operation === 'przyjecie')) {
          loadMsg += ` Jeśli brakuje K01 po 06.07: kliknij Zapisz (uzupełni brakujące K01) lub Kartoteki → Odśwież.`
        } else if (freshPz === 0 && fresh.length > 0) {
          loadMsg += ` (same WZ/FV — bez nowych PZ.)`
        }
        void suggestFrozenK03UnfreezeAfterImport(supabase, groups, {
          existingDetails: details,
          deps: { normalizeText, canonicalProductName }
        })
          .then(suggestions => {
            setK03UnfreezeSuggestions(suggestions)
            setK03UnfreezeBannerHidden(false)
            setK03UnfreezeBannerOpen(suggestions.length > 0 && suggestions.length <= 3)
            if (suggestions.length) {
              setMessage(prev => `${prev}${prev ? ' ' : ''}${suggestions.length} K03 do sprawdzenia — wykryto zmiany na już rozpisanych PZ/WZ (Importy).`)
            } else {
              setK03UnfreezeBannerOpen(false)
            }
          })
          .catch(() => {})
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
    const docNo = normalizeDocumentNo(row.documentNo)
    const key = `${row.operation}|${docNo}`
    const rowDate = resolveDocumentIssueDate(row.issueDate, docNo)
    const dateFromNo = inferDateFromDocumentNo(docNo)
    const preferredDate = (documentNoHasExplicitDate(docNo) && dateFromNo) ? dateFromNo : rowDate
    if (!groups.has(key)) {
      groups.set(key, {
        operation: row.operation,
        documentNo: docNo,
        issueDate: preferredDate,
        invoiceNo: row.invoiceNo || null,
        contractorName: row.contractorName || null,
        notes: row.notes || null,
        items: []
      })
    } else {
      const g = groups.get(key)
      if (documentNoHasExplicitDate(docNo) && dateFromNo) g.issueDate = dateFromNo
      else if (preferredDate && !g.issueDate) g.issueDate = preferredDate
    }
    groups.get(key).items.push(row)
  }
  return [...groups.values()]
}

async function createIncomingLot(productId, operationId, operationDate, qty, productName) {
  const { data: lotNo, error: lotNoErr } = await supabase.rpc('generate_lot_no', {
    p_product_id: productId,
    p_date: operationDate
  })
  if (lotNoErr) throw lotNoErr

  const productGroup = productGroupForName(productName)

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
      storage_chamber_id: null
    })
    .select('id')
    .single()
  if (lotErr) throw lotErr
  return lot.id
}

function resolveProductGroup(product, productName = '', lotGroup = '') {
  return resolveFifoProductGroup(product, productName, lotGroup)
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
    supabase.from('products').select('id, name, code, product_group').limit(50000),
    supabase.from('lots').select('id, lot_no, product_id, product_group, production_date, created_at, initial_qty, remaining_qty, source_operation_id, status').limit(50000),
    supabase.from('operations').select('id, operation_type, operation_date, document_no, created_at').limit(50000),
    supabase.from('operation_items').select('id, operation_id, product_id, qty, direction, raw_product_name').eq('direction', 'rozchod').limit(50000)
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
    const rawName = String(item.raw_product_name || product?.name || '').trim()
    saleLines.push({
      operation_id: item.operation_id,
      product_id: item.product_id,
      sale_group: resolveProductGroup(product, rawName),
      matchSpec: resolveFifoMatchSpec(product, rawName),
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
        const receiptDate = String(opMap.get(lot.source_operation_id)?.operation_date || lot.production_date || '').slice(0, 10)
        return fifoLotMatchesMatchSpec(lot, productMap, sale.matchSpec) &&
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



  async function loadK03TraceData(options = {}) {
    setK03Loading(true)
    try {
      let forms = []
      let diag = { wzDocs: 0, saleLines: 0, forms: 0, allocations: 0, source: 'brak' }
      let note = ''

      if (supabase) {
        const queue = await loadWzQueue(supabase, { repairPz: options.repairPz !== false })
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
        .limit(50000)
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
        const traceOps = Array.from(opById.values())
        const k06Added = await syncAutoK06Documents()
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

      const outputLotId = await createIncomingLot(outputProductId, op.id, today, outputQty, productionOutputName)
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
      for (const etap of K07_KONTROLA_ETAPY) {
        await supabase.from('haccp_documents').insert(buildK07InsertPayload({
          document_type: 'K07',
          operation_id: op.id,
          document_date: today,
          product_name: sourceProductName,
          lot_no: outLot?.lot_no || '',
          document_no: `K07/${documentNo}/${etap.id}`,
          status: 'P',
          data: {
            godzina: '',
            surowiec: sourceProductName,
            numer_partii: outLot?.lot_no || '',
            stan_sita: 'P',
            podpis_kontrolujacego: '',
            operation_id: op.id,
            kontrola_etap: etap.id,
            kontrola_label: etap.label
          }
        }))
      }

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

  async function runImportDataCleanup() {
    if (!supabase) return
    if (!isAdmin(authProfile)) {
      setMessage('Tylko administrator może czyścić pozostałości importów.')
      return
    }
    if (!window.confirm('Usunąć z bazy operacje, partie i FIFO powiązane z importami oznaczonymi jako USUNIĘTE?\n\nTo naprawia sytuację, gdy po „Usuń import” dane nadal blokują ponowny zapis.')) return
    setImportCleaning(true)
    try {
      const cleanup = await cleanupOrphanedDeletedImports(supabase)
      const msg = formatCleanupResult(cleanup)
      setMessage(msg)
      if (cleanup?.needsMigration) return
      await Promise.all([
        loadImports(),
        loadFifoData(),
        loadHaccpDocs(),
        loadK03TraceData(),
        loadPzManagementData()
      ])
    } catch (err) {
      setMessage(`Błąd sprzątania: ${err?.message || err}. Uruchom w Supabase: JEDNORAZOWE-wyczysc-osierocone-importy.sql`)
    } finally {
      setImportCleaning(false)
    }
  }

  async function runResetAllWarehouseImports() {
    if (!supabase) return
    if (!isAdmin(authProfile)) {
      setMessage('Tylko administrator może zresetować magazyn z importu Excel.')
      return
    }
    if (!window.confirm(
      'RESET KOMPLETNY MAGAZYNU\n\n' +
      'Usunie WSZYSTKO z importu Excel:\n' +
      '• wszystkie importy (PZ, WZ)\n' +
      '• wszystkie kartoteki K03 i K01\n' +
      '• wszystkie rozliczenia FIFO\n' +
      '• wszystkie partie magazynowe\n\n' +
      'Zostaną: produkty, kontrahenci, konta użytkowników.\n\n' +
      'Po resecie: wczytaj Excel → Zapisz → K03 od najstarszej WZ (czerwiec przed lipcem).\n\n' +
      'Kontynuować?'
    )) return
    const typed = window.prompt('Potwierdź wpisując: RESET WSZYSTKO')
    if (normalizeText(typed) !== 'reset wszystko') {
      setMessage('Reset anulowany — wpisz dokładnie: RESET WSZYSTKO')
      return
    }
    setImportResetting(true)
    setMessage('Reset kompletny magazynu…')
    try {
      const result = await purgeCompleteWarehouseReset(supabase, {
        onProgress: setMessage,
        reason: 'Reset kompletny — magazyn od zera'
      })
      invalidateFifoBaseCache()
      setImportPreview([])
      setRows([])
      setFileName('')
      setImportDuplicates([])
      setImportNewDocCount(0)
      setK03FormsRaw([])
      setWzQueueLines([])
      setK03Snapshots([])
      importCheckCacheRef.current = null
      await loadImports()
      await loadHaccpDocs({ force: true, skipBusy: true })
      await loadK03TraceData({ repairPz: false })
      await loadFifoData()
      setMessage(formatPurgeAllImportsResult(result))
    } catch (err) {
      setMessage(`Błąd resetu magazynu: ${err?.message || err}`)
    } finally {
      setImportResetting(false)
    }
  }

  async function runRemoveImportDuplicates() {
    if (!supabase) return
    if (!isAdmin(authProfile)) {
      setMessage('Tylko administrator może usuwać zduplikowane pozycje importu.')
      return
    }
    if (!window.confirm(
      'Usunąć zduplikowane pozycje przyjęć i K01 (FIFO — zostaje najstarszy wpis)?\n\n' +
      'Skasujemy nadmiarowe partie, pozycje magazynowe i potrójne K01 tego samego PZ.'
    )) return
    setImportDeduping(true)
    setMessage('Usuwanie duplikatów w bazie…')
    try {
      const result = await repairWarehouseImportDuplicates(supabase, {
        onProgress: msg => setMessage(msg)
      })
      setMessage(formatRepairWarehouseResult(result) + ' Odświeżam kartoteki…')
      await loadHaccpDocs({ force: true })
      setMessage(formatRepairWarehouseResult(result) + ' Lista K01 zaktualizowana.')
    } catch (err) {
      setMessage(`Błąd usuwania duplikatów: ${err?.message || err}. Uruchom w Supabase SQL: supabase/2026-v46-remove-duplicate-import-items.sql`)
    } finally {
      setImportDeduping(false)
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
      let purgeResult = null
      const { data, error } = await supabase.rpc('delete_import_excel_admin', {
        p_imported_file_id: fileId,
        p_reason: String(reason).trim(),
        p_user_role: isAdmin(authProfile) ? 'admin' : (authProfile?.role || 'magazynier')
      })
      if (error) {
        if (/function.*does not exist/i.test(String(error.message || ''))) {
          purgeResult = await purgeImportDataClientSide(supabase, fileId)
          const { error: markErr } = await supabase.from('imported_files').update({
            deleted_at: new Date().toISOString(),
            deleted_by_role: isAdmin(authProfile) ? 'admin' : (authProfile?.role || 'magazynier'),
            delete_reason: String(reason).trim(),
            status: 'usuniety'
          }).eq('id', fileId)
          if (markErr) throw markErr
        } else {
          throw error
        }
      } else {
        purgeResult = data
      }

      const ops = purgeResult?.operations ?? '?'
      const lots = (purgeResult?.lots ?? 0) + (purgeResult?.orphan_lots ?? 0)
      setMessage(`Import usunięty. Skasowano ${ops} operacji i ${lots} partii. Czyszczenie duplikatów K01…`)
      setImportPreview([])
      setRows([])
      setFileName('')
      importCheckCacheRef.current = null
      try {
        await cleanupOrphanedDeletedImports(supabase)
      } catch (_) { /* v40 migration may not be deployed yet */ }
      await loadImports()
      try {
        const repair = await repairWarehouseImportDuplicates(supabase, { onProgress: setMessage })
        await loadHaccpDocs({ force: true })
        await loadFifoData()
        setMessage(
          `Import usunięty (operacje: ${ops}, partie: ${lots}). ${formatRepairWarehouseResult(repair)} Możesz wgrać ten sam plik od nowa.`
        )
      } catch (repairErr) {
        setMessage(`Import usunięty, ale czyszczenie K01 nie powiodło się: ${repairErr?.message || repairErr}. Kliknij „Odśwież” w kartotekach.`)
      }
    } catch (err) {
      const msg = String(err?.message || err)
      if (/permission denied|42501|function.*does not exist/i.test(msg)) {
        setMessage(`Błąd usuwania importu: ${msg}. Uruchom w Supabase SQL: 2026-v40-import-delete-full-purge.sql i 2026-v42-import-prepare-save.sql`)
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
    const name = String(employeeName || '').trim()
    const payload = {
      data: { ...(doc.data || {}), podpis_przyjmujacego: name },
      signed_by_operator: name || null,
      updated_at: new Date().toISOString()
    }
    try {
      const { error } = await supabase.from('haccp_documents').update(payload).eq('id', doc.id)
      if (error) throw error
      mergeHaccpDoc(doc.id, payload)
      supabase.from('haccp_document_history').insert({
        document_id: doc.id,
        action: 'wybor_pracownika',
        field_name: 'podpis_przyjmujacego',
        old_value: doc.signed_by_operator || doc.data?.podpis_przyjmujacego || '',
        new_value: name,
        reason: 'Wybór podpisu przyjmującego z listy pracowników',
        changed_by: userRole
      }).then(() => {}).catch(() => {})
      setMessage('Podpis przyjmującego zapisany.')
    } catch (err) {
      setMessage(`Błąd zapisu podpisu: ${err.message}`)
    }
  }


  async function setK01Supplier(doc, supplierName) {
    if (!supabase || !doc) return false
    const clean = cleanSupplierName(supplierName)
    if (!clean) { setMessage('Wpisz faktyczne imię i nazwisko / nazwę dostawcy.'); return false }
    const nextData = { ...(doc.data || {}), faktyczny_dostawca: clean }
    try {
      setMessage('Zapisywanie dostawcy K01…')
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
      setMessage(`Zapisano dostawcę „${clean}” dla ${doc.document_no || 'K01'}.`)
      return true
    } catch (err) {
      setMessage(`Błąd zapisu dostawcy: ${err.message}`)
      return false
    }
  }

  async function promptK01Supplier(doc) {
    const current = getK01SupplierName(doc)
    const next = window.prompt('Podaj faktycznego dostawcę dla tego PZ (np. Sałasiński Edward):', current || '')
    if (next === null) return
    if (!String(next).trim()) {
      setMessage('Anulowano — wpisz nazwę dostawcy.')
      return
    }
    setK01SupplierBusyId(doc.id)
    try {
      await setK01Supplier(doc, next)
    } finally {
      setK01SupplierBusyId(null)
    }
  }


  async function loadStanyData() {
    if (!supabase) return
    setStanyLoading(true)
    try {
      const result = await computeUnassignedPzStock(supabase, stanyAsOfDate)
      setStanyRows(result.rows || [])
      if (activeTab === 'stany') setMessage(result.message || '')
    } catch (err) {
      console.error('Stany load error', err)
      setMessage(`Błąd wczytywania stanów: ${err?.message || String(err)}`)
      setStanyRows([])
    } finally {
      setStanyLoading(false)
    }
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
    await clickRefreshHaccp()
    await loadK03TraceData()
    await loadFifoData()
    await loadPzManagementData()
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

  async function syncAutoK01Documents(lotsData = null, { minProductionDate = null } = {}) {
    if (!supabase) return 0

    let lots = lotsData
    if (!lots) {
      const since = minProductionDate || (() => {
        const d = new Date()
        d.setDate(d.getDate() - 120)
        return d.toISOString().slice(0, 10)
      })()
      const { data: lotsRaw, error: lotsErr } = await supabase
        .from('lots')
        .select('id, lot_no, product_id, product_group, production_date, created_at, initial_qty, remaining_qty, source_operation_id, storage_chamber_id')
        .gte('production_date', since)
        .order('id', { ascending: true })
        .limit(20000)
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

    const candidateLots = lots || []
    if (!candidateLots.length) return 0

    const lotIds = candidateLots.map(l => l.id).filter(Boolean)
    let k01Existing = []
    if (lotIds.length) {
      const rows = await fetchSupabaseInChunks(
        'haccp_documents',
        'id, document_type, lot_id, lot_no, operation_id, document_no, document_date, product_name, qty',
        'lot_id',
        lotIds
      )
      k01Existing = rows.filter(d => d.document_type === 'K01')
    } else {
      let k01Offset = 0
      const k01Page = 1000
      while (true) {
        const { data: chunk, error: k01Err } = await supabase
          .from('haccp_documents')
          .select('id, document_type, lot_id, lot_no, operation_id, document_no, document_date, product_name, qty')
          .eq('document_type', 'K01')
          .order('id', { ascending: true })
          .range(k01Offset, k01Offset + k01Page - 1)
        if (k01Err) throw k01Err
        k01Existing.push(...(chunk || []))
        if (!chunk?.length || chunk.length < k01Page) break
        k01Offset += k01Page
      }
    }
    const existingLotIds = new Set(k01Existing.map(d => d.lot_id).filter(Boolean))

    const pendingLots = candidateLots.filter(l => !existingLotIds.has(l.id))
    if (!pendingLots.length) return 0

    const opIds = Array.from(new Set(pendingLots.map(l => l.source_operation_id).filter(Boolean)))
    const operations = opIds.length
      ? await fetchSupabaseInChunks(
        'operations',
        'id, operation_type, operation_date, document_no, contractor_id, contractors(name)',
        'id',
        opIds
      )
      : []

    const trace = { lots: pendingLots, operations }
    const pending = buildSyntheticK01DocsFromTrace(trace, k01Existing, {
      defaultSignature: defaultK01Employee || ''
    })
    if (!pending.length) return 0

    let inserted = 0
    const insertErrors = []
    const payloads = pending.map(doc => buildK01InsertPayload(doc))
    for (let i = 0; i < payloads.length; i += 100) {
      const chunk = payloads.slice(i, i + 100)
      const { error } = await supabase.from('haccp_documents').insert(chunk)
      if (error) insertErrors.push(error.message || String(error))
      else inserted += chunk.length
    }
    if (insertErrors.length && !inserted) {
      throw new Error(`K01: zapis do bazy odrzucony (${insertErrors[0]})`)
    }
    if (insertErrors.length) {
      console.warn('K01 partial insert errors', insertErrors)
    }
    return inserted
  }

  async function syncAutoK01ForImportFile(importedFileId) {
    if (!supabase || !importedFileId) return syncAutoK01Documents()
    const { data: ops, error: opsErr } = await supabase
      .from('operations')
      .select('id')
      .eq('imported_file_id', importedFileId)
    if (opsErr) throw opsErr
    const opIds = (ops || []).map(o => o.id)
    if (!opIds.length) return 0

    const lotsRaw = await fetchSupabaseInChunks(
      'lots',
      'id, lot_no, product_id, product_group, production_date, created_at, initial_qty, remaining_qty, source_operation_id, storage_chamber_id',
      'source_operation_id',
      opIds
    )
    const productIds = Array.from(new Set(lotsRaw.map(l => l.product_id).filter(Boolean)))
    const chamberIds = Array.from(new Set(lotsRaw.map(l => l.storage_chamber_id).filter(Boolean)))
    const [productsRaw, chambersRaw] = await Promise.all([
      productIds.length ? fetchSupabaseInChunks('products', 'id, name, product_group', 'id', productIds) : Promise.resolve([]),
      chamberIds.length ? fetchSupabaseInChunks('storage_chambers', 'id, code', 'id', chamberIds) : Promise.resolve([])
    ])
    const productMap = new Map((productsRaw || []).map(p => [p.id, p]))
    const chamberMap = new Map((chambersRaw || []).map(c => [c.id, c]))
    const lots = lotsRaw.map(l => ({
      ...l,
      products: productMap.get(l.product_id) || null,
      chamber: chamberMap.get(l.storage_chamber_id) || null
    }))
    return syncAutoK01Documents(lots)
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

  async function syncAutoK06Documents() {
    // K06 pochodzi z K03 (produkt gotowy z WZ) – bez auto-insertu z partii surowca w CP3.
    return 0
  }

  async function clickRefreshHaccp(options = {}) {
    if (!supabase || haccpBusy) return
    const { syncK01 = true, repair = true } = options
    setHaccpBusy(true)
    setMessage('Odświeżanie kartotek HACCP…')
    try {
      if (repair) {
        const repairResult = await repairWarehouseImportDuplicates(supabase, { onProgress: setMessage })
        if ((repairResult?.k01_removed || 0) + (repairResult?.items_removed || 0) > 0) {
          setMessage(`${formatRepairWarehouseResult(repairResult)} Wczytywanie listy…`)
        }
      }
      await loadHaccpDocs({ syncK01, force: true, skipBusy: true })
      setMessage('Kartoteki odświeżone.')
    } catch (err) {
      setMessage(`Błąd odświeżania kartotek: ${err?.message || err}`)
    } finally {
      setHaccpBusy(false)
    }
  }

  async function loadHaccpDocs(options = {}) {
    if (!supabase) return
    const generation = ++haccpLoadGenerationRef.current
    if (haccpLoadInFlightRef.current && !options.force) return haccpLoadInFlightRef.current
    const manageBusy = !options.skipBusy
    if (manageBusy) setHaccpBusy(true)
    const run = (async () => {
      try {
        if (options.syncK01) {
          setMessage('Sprawdzanie brakujących kart K01…')
          const k01Added = await syncAutoK01Documents(null, { minProductionDate: options.minProductionDate })
          if (k01Added > 0 && generation === haccpLoadGenerationRef.current) {
            setMessage(`Uzupełniono ${k01Added} brakujących kart K01 (przyjęcia PZ/MM, ocena P).`)
          }
        }
        const data = await fetchAllHaccpDocuments(supabase)
        if (generation !== haccpLoadGenerationRef.current) return data
        setHaccpDocs(data)
        if (data.length >= HACCP_DOCS_LOAD_MAX) {
          setMessage(`Wczytano ${data.length.toLocaleString('pl-PL')} kartotek (górny limit). Użyj filtra dat w panelu bocznym, aby zawęzić widok.`)
        }
        return data
      } catch (err) {
        if (generation !== haccpLoadGenerationRef.current) throw err
        setHaccpDocs([])
        const msg = String(err?.message || err)
        if (/permission denied|row-level security|42501/i.test(msg)) {
          setMessage('Brak dostępu do kartotek po zalogowaniu. Uruchom w Supabase SQL: LOGOWANIE-KROK-5-haccp-rls-authenticated.sql')
        } else {
          setMessage(`Błąd wczytywania kartotek: ${msg}`)
        }
        throw err
      } finally {
        if (generation === haccpLoadGenerationRef.current) {
          haccpLoadInFlightRef.current = null
          if (manageBusy) setHaccpBusy(false)
        }
      }
    })()
    haccpLoadInFlightRef.current = run
    return run
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
    if (period !== group.period) return false
    if (group.type === 'R03') {
      const docKey = doc.data?.register_key || 'legacy'
      const groupKey = group.registerKey || 'legacy'
      return docKey === groupKey
    }
    return true
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
    ['stany', 'Stany', BarChart3],
    ['raporty', 'Wartość magazynu', Warehouse],
    ['magazyn', 'Magazyn', Warehouse],
    ['kartoteki', 'Dokumentacja HACCP', ClipboardList],
    ['archiwum-pdf', 'Archiwum PDF', FolderOpen],
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
    if (importSaving) return

    setImportSaving(true)
    setImportProgress('Start…')
    setMessage('Trwa import. Nie zamykaj karty – duże pliki zapisują się partiami…')

    try {
      const groups = groupImportRows(filteredRows)
      setImportProgress('Przygotowanie zapisu…')
      const prep = await prepareImportExcelSave(supabase, fileName)
      const prepMsg = formatPrepareImportResult(prep)
      if (prepMsg) setMessage(prepMsg)

      const prepChanged =
        (prep?.stale_in_progress_removed || 0) > 0 ||
        (prep?.deleted_imports_cleaned || 0) > 0 ||
        (prep?.orphan_lots_removed || 0) > 0 ||
        (prep?.deleted_lots_cleaned || 0) > 0

      let keys
      let details
      let orphanCount
      const cache = importCheckCacheRef.current
      const cacheHit = !prepChanged && cache && cache.fileName === fileName && cache.groupsCount === groups.length

      if (cacheHit) {
        keys = cache.keys
        details = cache.details
        orphanCount = cache.orphanCount
        setImportProgress('Przygotowanie zapisu (duplikaty z wczytania)…')
      } else {
        setImportProgress('Sprawdzanie duplikatów…')
        ;({ keys, details, orphanCount } = await getExistingOperationsForImport(supabase, groups))
      }

      const { duplicates, fresh: groupsToImport } = splitImportGroupsByExisting(groups, keys)
      const duplicateCount = duplicates.length
      setImportDuplicates(duplicates)
      setImportNewDocCount(groupsToImport.length)
      setImportDuplicateDetails(details)
      setImportOrphanCount(orphanCount)

      const importDeps = {
        normalizeText,
        productGroupForName,
        baseCodeForProduct,
        canonicalProductName,
        normalizeFifoProductKey
      }

      let mergeResult = { importedItems: 0, createdLots: 0, mergedDocuments: 0 }
      if (duplicateCount) {
        setImportProgress('Doklejanie brakujących pozycji do istniejących PZ/WZ…')
        mergeResult = await appendNewItemsFromExistingDocuments(supabase, duplicates, details, importDeps, {
          onProgress: setImportProgress
        })
      }

      let saveResult = null
      if (groupsToImport.length) {
        groupsToImport.sort((a, b) => String(a.issueDate || '').localeCompare(String(b.issueDate || '')) || String(a.documentNo || '').localeCompare(String(b.documentNo || '')))
        saveResult = await saveImportToSupabase(supabase, {
          groupsToImport,
          rowsCount: rows.length,
          fileName,
          duplicateCount,
          deps: importDeps,
          onProgress: setImportProgress
        })
      }

      setImportProgress('Naprawa PZ bez partii…')
      const repairedMissingLots = await repairMissingIncomingLots(supabase, importDeps, {
        onProgress: setImportProgress
      })

      const mergeMsg = formatMergeResult(mergeResult)
      const hadMergeOrSave = Boolean(mergeResult.importedItems || saveResult || repairedMissingLots)

      if (!hadMergeOrSave) {
        setImportProgress('Korygowanie dat WZ, czyszczenie duplikatów i K01…')
        let k01Added = 0
        let repairMsg = ''
        try {
          const repair = await repairWarehouseImportDuplicates(supabase, {
            onProgress: setImportProgress,
            importGroups: groups
          })
          repairMsg = formatRepairWarehouseResult(repair)
          k01Added = await syncAutoK01Documents(null, { minProductionDate: '2026-06-01' })
          await loadHaccpDocs({ force: true, skipBusy: true })
          await loadK03TraceData()
        } catch (k01Err) {
          setMessage(
            (duplicateCount
              ? `Brak nowych dokumentów do zapisu (${duplicateCount} duplikatów w pliku). `
              : 'Brak dokumentów do zapisu. ') +
            `K01/czyszczenie: błąd — ${k01Err?.message || k01Err}`
          )
          return
        }
        setMessage(
          duplicateCount
            ? `Brak nowych dokumentów do zapisu. W pliku ${duplicateCount} numerów PZ/WZ jest już w bazie — brak brakujących pozycji w Excelu.` +
              (repairMsg && repairMsg !== 'Duplikaty: brak do usunięcia.' ? ` ${repairMsg}` : '') +
              (k01Added
                ? ` Uzupełniono ${k01Added} brakujących kart K01 — sprawdź listę (wyczyść filtr dat Od/Do).`
                : ` K01 bez zmian.`)
            : 'Brak dokumentów do zapisu w wczytanym pliku.' +
              (repairMsg && repairMsg !== 'Duplikaty: brak do usunięcia.' ? ` ${repairMsg}` : '')
        )
        return
      }

      const importedFileId = saveResult?.importedFileId
      const importedOperations = saveResult?.importedOperations || 0
      const importedItems = (saveResult?.importedItems || 0) + (mergeResult.importedItems || 0)
      const createdLots = (saveResult?.createdLots || 0) + (mergeResult.createdLots || 0) + (repairedMissingLots || 0)

      const importMsgBase =
        (saveResult
          ? `Import zapisany: ${importedOperations} nowych dokumentów, ${saveResult.importedItems} pozycji, ${saveResult.createdLots} partii.`
          : '') +
        (mergeMsg ? (saveResult ? ' ' : '') + mergeMsg : '') +
        (repairedMissingLots && !mergeResult.createdLots
          ? ` Naprawiono ${repairedMissingLots} partii PZ bez lot_id.`
          : repairedMissingLots && mergeResult.createdLots
            ? ` (+ ${repairedMissingLots} naprawionych partii).`
            : '') +
        (duplicateCount && saveResult ? ` Pominięto duplikatów: ${duplicateCount}.` : '') +
        (orphanCount ? ` Wyczyszczono osierocone wpisy z usuniętych importów.` : '')

      setK03UnfreezeSuggestions([])
      setK03UnfreezeBannerOpen(false)

      importCheckCacheRef.current = null
      void loadImports()

      setImportProgress('')
      setImportSaving(false)
      setMessage(`${importMsgBase} Magazyn zapisany (ok. 1–3 min). K01 tworzy się w tle…`)

      void (async () => {
        try {
          setImportProgress('Przeliczanie remaining partii PZ…')
          await repairAllIncomingLotRemainingFromAllocations(supabase, { onProgress: setImportProgress })
          setImportProgress('Tworzenie kart K01…')
          const k01Added = importedFileId
            ? await syncAutoK01ForImportFile(importedFileId)
            : await syncAutoK01Documents(null, { minProductionDate: '2026-06-01' })
          setImportProgress('Korygowanie dat K01…')
          const repair = await repairWarehouseImportDuplicates(supabase, {
            onProgress: setImportProgress,
            importedFileId: importedFileId || undefined,
            light: Boolean(importedFileId),
            importGroups: groups
          })
          const repairMsg = formatRepairWarehouseResult(repair)
          await loadHaccpDocs({ force: true, skipBusy: true })
          await loadK03TraceData()
          invalidateFifoBaseCache()
          const k01Msg = k01Added > 0 ? ` Utworzono ${k01Added} kart K01.` : ''
          const dedupeNote = repairMsg !== 'Duplikaty: brak do usunięcia.' && repairMsg !== 'Naprawiono: brak do usunięcia.' ? ` ${repairMsg}` : ''
          setMessage(`${importMsgBase}${dedupeNote}${k01Msg} FIFO: PZ/FIFO → „Uzupełnij braki FIFO”.`)
        } catch (k01Err) {
          setMessage(`${importMsgBase} K01 w tle: ${k01Err?.message || k01Err} — Kartoteki → Odśwież.`)
        } finally {
          setImportProgress('')
        }
      })()
      return
    } catch (err) {
      setMessage(formatImportNetworkError(err))
    } finally {
      setImportSaving(false)
      setImportProgress('')
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
      <div className="badge"><ShieldCheck size={18}/> K03 {K03_ENGINE_VERSION} · WZ {K03_WZ_ENGINE_VERSION} · R13 {R13_ENGINE_VERSION} · R {RAPORTY_ENGINE_VERSION} · Rap. {EXCEL_REPORT_VERSION} · W {WYKAZY_ENGINE_VERSION} · F {FORMULARZE_ENGINE_VERSION} · PR {PROTOKOLY_ENGINE_VERSION} · S {SPECYFIKACJE_ENGINE_VERSION}</div>
    </header>

    <section className="warning">
      <AlertTriangle size={20}/>
      <div><strong>Ważne:</strong> ta aplikacja ma być podłączona wyłącznie do nowego projektu Supabase <b>AGRO-MAR-HACCP</b>, nigdy do starej bazy opakowań.</div>
    </section>

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
        <button className="secondary" disabled={haccpBusy} onClick={async () => { await clickRefreshHaccp(); loadFifoData(); loadK03TraceData(); loadAuxMaterials() }}><RefreshCcw size={16}/> {haccpBusy ? 'Odświeżanie…' : 'Odśwież dane'}</button>
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
      <div className="section-title"><Upload/><div><h2>Import Excel (HACCP / magazyn)</h2><p>PZ, WZ, ilości, daty, produkty — <b>bez ceny netto</b>. Kartoteki K01–K07 i FIFO. Ceny i wartość magazynu: <b>Raporty → Wartość magazynu</b> (osobny import).</p></div></div>
      <input className="file" type="file" accept=".xls,.xlsx,.csv" onChange={handleFile} />
      {message && <p className="message">{message}</p>}
      <div className="actions"><button onClick={saveToSupabase} disabled={importSaving || importResetting}>{importSaving ? `Zapisywanie… ${importProgress}` : 'Zapisz import do Supabase'}</button>{isAdmin(authProfile) && <button className="secondary" disabled={importCleaning || importDeduping || importSaving || importResetting} onClick={runImportDataCleanup}>{importCleaning ? 'Sprzątanie…' : 'Wyczyść pozostałości usuniętych importów'}</button>}{isAdmin(authProfile) && <button className="secondary" disabled={importCleaning || importDeduping || importSaving || importResetting} onClick={runRemoveImportDuplicates}>{importDeduping ? 'Usuwam duplikaty…' : 'Usuń zduplikowane PZ'}</button>}{isAdmin(authProfile) && <button className="danger" disabled={importCleaning || importDeduping || importSaving || importResetting} onClick={runResetAllWarehouseImports}>{importResetting ? 'Reset…' : 'RESET WSZYSTKO (import + K03 + FIFO)'}</button>}</div>

      {rows.length > 0 && <>
        <div className="summary">
          <span>Wiersze: <b>{rows.length}</b></span>
          <span>Przyjęcia/PZ: <b>{pzCount}</b></span>
          <span>Sprzedaż/WZ/FV: <b>{salesCount}</b></span>
          <span>Suma ilości: <b>{qtySum.toLocaleString('pl-PL')}</b></span>
          {importNewDocCount > 0 && <span>Do zapisu: <b>{importNewDocCount}</b> dokumentów</span>}
          {importDuplicates.length > 0 && <span>Pominięte duplikaty: <b>{importDuplicates.length}</b></span>}
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
      <div className="section-title"><Upload/><div><h2>Import Excel (HACCP / magazyn)</h2><p>Wgraj operacje magazynowe: <b>PZ/WZ, daty, ilości, produkty</b> — bez ceny netto. Numery już w bazie są pomijane. <b>Wartość magazynu (ceny)</b> → Raporty → Wartość magazynu.</p></div></div>
      <input className="file" type="file" accept=".xls,.xlsx,.csv" onChange={handleFile} />
      {message && <p className="message">{message}</p>}
      <div className="actions"><button onClick={saveToSupabase} disabled={importSaving || importResetting}>{importSaving ? `Zapisywanie… ${importProgress}` : 'Zapisz import do Supabase'}</button>{isAdmin(authProfile) && <button className="secondary" disabled={importCleaning || importDeduping || importSaving || importResetting} onClick={runImportDataCleanup}>{importCleaning ? 'Sprzątanie…' : 'Wyczyść pozostałości usuniętych importów'}</button>}{isAdmin(authProfile) && <button className="secondary" disabled={importCleaning || importDeduping || importSaving || importResetting} onClick={runRemoveImportDuplicates}>{importDeduping ? 'Usuwam duplikaty…' : 'Usuń zduplikowane PZ'}</button>}{isAdmin(authProfile) && <button className="danger" disabled={importCleaning || importDeduping || importSaving || importResetting} onClick={runResetAllWarehouseImports}>{importResetting ? 'Reset…' : 'RESET WSZYSTKO (import + K03 + FIFO)'}</button>}</div>
      {rows.length > 0 && <>
        <div className="summary">
          <span>Wiersze: <b>{rows.length}</b></span>
          <span>Przyjęcia/PZ: <b>{pzCount}</b></span>
          <span>Sprzedaż/WZ/FV: <b>{salesCount}</b></span>
          <span>Suma ilości: <b>{qtySum.toLocaleString('pl-PL')}</b></span>
          {importNewDocCount > 0 && <span>Do zapisu: <b>{importNewDocCount}</b> dokumentów</span>}
          {importDuplicates.length > 0 && <span>Pominięte duplikaty: <b>{importDuplicates.length}</b></span>}
        </div>
        <div className="table-wrap"><table>
          <thead><tr><th>Typ</th><th>Nr</th><th>Data</th><th>Produkt</th><th>Ilość</th><th>Kontrahent</th><th>Operacja</th></tr></thead>
          <tbody>{filteredRows.slice(0, 100).map((row, i) => <tr key={i}>
            <td>{row.documentType}</td><td>{row.documentNo}</td><td>{row.issueDate}</td><td>{row.productName}</td><td>{row.qty}</td><td>{row.contractorName}</td><td><span className="pill">{row.operation}</span></td>
          </tr>)}</tbody>
        </table></div>
      </>}
      {importDuplicates.length > 0 && <>
        <h3>Duplikaty — nie zostaną zapisane ({importDuplicates.length})</h3>
        <p className="hint">Te numery PZ/WZ są już w bazie. Program <b>odrzuca</b> je przy zapisie (bez doklejania). Nowe numery z pliku — np. uzupełniające PZ z wcześniejszą datą — zapisują się normalnie. Aby nadpisać dokument, usuń go z rejestru importów poniżej.</p>
        {importOrphanCount > 0 && <p className="hint">Wykryto {importOrphanCount} operacji z usuniętych importów – przy zapisie zostaną automatycznie wyczyszczone (migracja v40).</p>}
        <div className="table-wrap small"><table>
          <thead><tr><th>Typ</th><th>Nr dokumentu</th><th>Data w pliku</th><th>Pozycji</th><th>Źródło w bazie</th></tr></thead>
          <tbody>{importDuplicates.slice(0, 50).map((g, i) => {
            const det = importDuplicateDetails.get(`${g.operation}|${normalizeDocumentNo(g.documentNo)}`)
            const src = det?.importFilename
              ? `Import: ${det.importFilename}${det.createdAt ? ` (${String(det.createdAt).slice(0, 10)})` : ''}`
              : (det?.importedFileId ? 'Inny import' : 'Operacja ręczna / produkcja')
            return <tr key={`${g.documentNo}-${i}`}>
              <td>{g.documentType || (g.operation === 'sprzedaz' ? 'WZ/FV' : 'PZ')}</td>
              <td><b>{g.documentNo}</b></td>
              <td>{g.issueDate || '—'}</td>
              <td>{g.items?.length || 1}</td>
              <td className="hint">{src}</td>
            </tr>
          })}</tbody>
        </table></div>
        {importDuplicates.length > 50 && <p className="hint">Pokazano 50 z {importDuplicates.length} duplikatów.</p>}
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
      {renderFifoProgressBanner()}
      {message && <p className="message">{message}</p>}
      <div className="actions"><button className="secondary" onClick={loadPzManagementData}><RefreshCcw size={16}/> Odśwież PZ</button><button onClick={recalculateFifoFromPzTab} disabled={fifoRecalculating}><RefreshCcw size={16}/> {fifoRecalculating ? 'FIFO…' : 'Uzupełnij braki FIFO'}</button><button className="secondary" onClick={recalculateFifoFullFromPzTab} disabled={fifoRecalculating}>Pełne FIFO (admin)</button><button className="secondary" disabled={haccpBusy} onClick={refreshHaccpAfterFifo}><ClipboardList size={16}/> {haccpBusy ? 'Odświeżanie…' : 'Odśwież kartoteki'}</button></div>
      <div className="summary"><span>PZ razem: <b>{pzRows.length}</b></span><span>Nieprzypisane: <b>{pzRows.filter(r => r.status_key === 'wolna').length}</b></span><span>Częściowo: <b>{pzRows.filter(r => r.status_key === 'czesciowo').length}</b></span><span>Wykorzystane: <b>{pzRows.filter(r => r.status_key === 'wykorzystana').length}</b></span></div>
      <div className="form-grid compact"><label>Szukaj PZ / partii / produktu<input value={pzSearch} onChange={e => setPzSearch(e.target.value)} placeholder="np. PZ/001 albo Jab/001 albo truskawka" /></label><label>Status<select value={pzStatusFilter} onChange={e => setPzStatusFilter(e.target.value)}><option value="all">Wszystkie</option><option value="wolna">Nieprzypisane</option><option value="czesciowo">Częściowo</option><option value="wykorzystana">Wykorzystane</option></select></label></div>
      <div className="table-wrap small"><table><thead><tr><th>Data PZ</th><th>Nr PZ</th><th>Partia</th><th>Asortyment</th><th>Grupa</th><th>Ilość PZ</th><th>Przypisano</th><th>Pozostało</th><th>Status</th><th>Akcje</th></tr></thead><tbody>{visiblePzRows.map(row => { const editDate = pzEditDates[row.id] ?? String(row.production_date || row.operation_date || '').slice(0, 10); return <tr key={row.id}><td><input className="cell-input pz-date-input" type="date" value={editDate || ''} onChange={e => setPzEditDates(prev => ({ ...prev, [row.id]: e.target.value }))} /></td><td><b>{row.document_no || '-'}</b></td><td>{row.lot_no}</td><td>{row.product_name}</td><td>{row.product_group}</td><td>{Number(row.initial_qty || 0).toLocaleString('pl-PL')}</td><td>{Number(row.allocated_qty || 0).toLocaleString('pl-PL')}</td><td>{Number(row.calculated_remaining_qty || 0).toLocaleString('pl-PL')}</td><td><span className={`pill pz-status-${row.status_key}`}>{row.status_label}</span></td><td className="row-actions"><button className="mini secondary" onClick={() => savePzDate(row)}>Zapisz datę</button></td></tr> })}</tbody></table></div>
    </section>
    <section className="card"><div className="section-title"><ArrowRightLeft/><div><h2>Historia zmian PZ/FIFO</h2><p>Każda zmiana daty PZ jest zapisana. Możesz cofnąć wybraną zmianę jednym przyciskiem.</p></div></div>{pzHistoryRows.length === 0 && <p className="hint">Brak historii albo nie uruchomiono jeszcze SQL v31.</p>}{pzHistoryRows.length > 0 && <div className="table-wrap small"><table><thead><tr><th>Data zmiany</th><th>PZ</th><th>Stara data</th><th>Nowa data</th><th>Akcja</th><th>Powód</th><th>Cofnij</th></tr></thead><tbody>{pzHistoryRows.map(h => <tr key={h.id}><td>{h.created_at ? new Date(h.created_at).toLocaleString('pl-PL') : '-'}</td><td><b>{h.document_no || '-'}</b></td><td>{h.old_date || '-'}</td><td>{h.new_date || '-'}</td><td>{h.action_type || 'change_date'}</td><td>{h.change_reason || '-'}</td><td><button className="mini secondary" onClick={() => undoPzChange(h)}>Cofnij</button></td></tr>)}</tbody></table></div>}</section>
    <section className="card"><div className="section-title"><Database/><div><h2>Historia przeliczeń FIFO</h2><p>Pełne przeliczenia i operacje admina (wymaga SQL v34).</p></div></div>{fifoChangeLog.length === 0 && <p className="hint">Brak wpisów – uruchom migrację <b>2026-v34-fifo-incremental-k03-freeze.sql</b> w Supabase.</p>}{fifoChangeLog.length > 0 && <div className="table-wrap small"><table><thead><tr><th>Data</th><th>Typ</th><th>WZ</th><th>Powód</th><th>Szczegóły</th></tr></thead><tbody>{fifoChangeLog.map(h => <tr key={h.id}><td>{h.created_at ? new Date(h.created_at).toLocaleString('pl-PL') : '-'}</td><td>{h.change_type || '-'}</td><td>{h.wz_no || h.k03_key || '-'}</td><td>{h.change_reason || '-'}</td><td className="hint">{h.after_data ? JSON.stringify(h.after_data).slice(0, 120) : '-'}</td></tr>)}</tbody></table></div>}</section>
    </>}


    {activeTab === 'stany' && canSeeTab(authProfile, 'stany') && <>
    <section className="card">
      <div className="section-title"><BarChart3/><div><h2>Stany – PZ nieprzypisane do WZ</h2><p>Stan na koniec wybranego dnia: ile surowca z PZ (data przyjęcia ≤ dzień) nie zostało jeszcze rozliczone na WZ z tego samego okresu (symulacja FIFO). Wersja silnika: {STOCK_STATES_VERSION}.</p></div></div>
      <div className="form-grid compact">
        <label>Stan na dzień
          <input type="date" value={stanyAsOfDate} onChange={e => setStanyAsOfDate(e.target.value)} />
        </label>
        <label>Szukaj asortymentu
          <input value={stanySearch} onChange={e => setStanySearch(e.target.value)} placeholder="np. malina, truskawka" />
        </label>
        <label>Grupa
          <select value={stanyGroupFilter} onChange={e => setStanyGroupFilter(e.target.value)}>
            <option value="all">Wszystkie grupy</option>
            {stanyGroupOptions.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
      </div>
      <div className="actions">
        <button className="secondary" onClick={loadStanyData} disabled={stanyLoading}><RefreshCcw size={16}/> {stanyLoading ? 'Liczenie…' : 'Odśwież stany'}</button>
      </div>
      <div className="summary">
        <span>Asortymentów: <b>{visibleStanyRows.length}</b></span>
        <span>Nieprzypisane łącznie: <b>{visibleStanyRows.reduce((s, r) => s + Number(r.unassigned_kg || 0), 0).toLocaleString('pl-PL')} kg</b></span>
        <span>Partie PZ: <b>{visibleStanyRows.reduce((s, r) => s + (r.pz_lines?.length || 0), 0)}</b></span>
      </div>
      {stanyLoading && <p className="hint">Przeliczanie stanów na dzień {stanyAsOfDate}…</p>}
      {!stanyLoading && visibleStanyRows.length === 0 && <p className="hint">Brak nieprzypisanego surowca na {stanyAsOfDate} (albo brak PZ do tej daty).</p>}
      {visibleStanyRows.length > 0 && <div className="table-wrap small"><table>
        <thead><tr><th>Asortyment</th><th>Grupa</th><th>Nieprzypisane kg</th><th>Partie PZ</th><th>Podejrzyj</th></tr></thead>
        <tbody>{visibleStanyRows.map(row => <tr key={row.product_id || row.product_name}>
          <td><b>{row.product_name}</b></td>
          <td>{row.product_group}</td>
          <td><b>{Number(row.unassigned_kg || 0).toLocaleString('pl-PL')}</b></td>
          <td>{row.pz_lines?.length || 0}</td>
          <td className="row-actions">
            <button type="button" className="mini secondary stany-preview-btn" title="Pokaż PZ" onClick={() => setStanyDetailRow(row)}>
              <Eye size={16}/>
            </button>
          </td>
        </tr>)}</tbody>
      </table></div>}
    </section>
    {stanyDetailRow && <div className="modal-backdrop" onClick={() => setStanyDetailRow(null)}>
      <div className="haccp-modal stany-detail-modal" onClick={e => e.stopPropagation()}>
        <h3>{stanyDetailRow.product_name}</h3>
        <p className="hint">Nieprzypisane na <b>{stanyAsOfDate}</b>: <b>{Number(stanyDetailRow.unassigned_kg || 0).toLocaleString('pl-PL')} kg</b> · grupa {stanyDetailRow.product_group}</p>
        <div className="table-wrap small"><table>
          <thead><tr><th>Data PZ</th><th>Nr PZ</th><th>Partia</th><th>Dostawca</th><th>Nieprzypisane kg</th><th>PZ łącznie kg</th></tr></thead>
          <tbody>{(stanyDetailRow.pz_lines || []).map(line => <tr key={line.lot_id}>
            <td>{line.pz_date ? String(line.pz_date).slice(0, 10).split('-').reverse().join('.') : '—'}</td>
            <td><b>{line.pz_no || '—'}</b></td>
            <td>{line.lot_no}</td>
            <td>{line.supplier || '—'}</td>
            <td><b>{Number(line.qty || 0).toLocaleString('pl-PL')}</b></td>
            <td>{Number(line.initial_qty || 0).toLocaleString('pl-PL')}</td>
          </tr>)}</tbody>
        </table></div>
        <div className="actions"><button className="secondary" onClick={() => setStanyDetailRow(null)}>Zamknij</button></div>
      </div>
    </div>}
    </>}


    {activeTab === 'raporty' && canSeeTab(authProfile, 'raporty') && <>
    <section className="card">
      <div className="section-title"><Warehouse/><div><h2>Wartość magazynu</h2><p>Zestawienie ilościowo-wartościowe z Excela (FIFO, data PZ/WZ) — zapis w Supabase, osobno od magazynu HACCP. Silnik: {EXCEL_REPORT_VERSION}.</p></div></div>
      {message && <p className="message">{message}</p>}
      <StockValueReportSection
        supabase={supabase}
        savedBy={authDisplayName(authProfile, authSession)}
        escapeHtml={escapeHtml}
        printHtmlInIframe={printHtmlInIframe}
        setMessage={setMessage}
      />
    </section>
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
      {renderFifoProgressBanner()}
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
            <button className="secondary" disabled={haccpBusy} onClick={async () => { await clickRefreshHaccp(); loadK03TraceData(); loadFifoData() }}><RefreshCcw size={16}/> {haccpBusy ? 'Odświeżanie…' : 'Odśwież'}</button>
            {docsFilter === 'K03' && <>
              <button className="secondary" onClick={() => runResyncOpenK03(true)} disabled={fifoRecalculating}>{fifoRecalculating ? 'K03…' : 'Napraw otwarte K03'}</button>
              <button onClick={() => runFifoIncremental(true)} disabled={fifoRecalculating}>{fifoRecalculating ? 'FIFO…' : 'Uzupełnij FIFO'}</button>
              <button className="secondary" onClick={() => runFifoFullRecalculate(true)} disabled={fifoRecalculating}>Pełne FIFO</button>
            </>}
          </div>
        </div>

        {docsFilter === 'K02' && renderK02Section()}

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
            <details className="k03-reset-guide">
              <summary><b>Od nowa przeliczyć K03 za miesiąc?</b></summary>
              <ol className="hint k03-reset-steps">
                <li><b>Nie usuwaj importu</b> – PZ i WZ w bazie są poprawne. Import usuwałby też dane magazynowe.</li>
                <li>Magazyn → PZ/FIFO → <b>Pełne FIFO (admin)</b> – zeruje rozliczenia FIFO (zachowuje zamrożone K03).</li>
                <li>Tu wybierz miesiąc → <b>Odmroź miesiąc i przelicz K03</b> – odmraża kartoteki i zapisuje K03 wg zapisanych decyzji.</li>
                <li>Jeśli chcesz <b>decyzje od zera</b> (przerób/bez przerobu, klasy PZ): w Liście WZ użyj <b>Cofnij</b> (najpierw odmroź zamrożone), potem od najstarszej daty WZ wybierz <b>Przerób</b> lub <b>Bez przerobu</b> z właściwymi źródłami PZ.</li>
              </ol>
            </details>
          </section>
          <details className="docs-k03-wz" open>
            <summary><b>Lista WZ</b> – {filteredWzQueueLines.filter(l => l.status === 'pending').length} oczekuje · {syntheticK03Docs.length} K03</summary>
            {filteredWzQueueLines.length === 0 && !k03Loading && <p className="hint">Brak WZ. Import Excel → Zapisz do Supabase.</p>}
            {filteredWzQueueLines.length > 0 && <div className="table-wrap docs-table-wrap"><table className="docs-table">
              <thead><tr><th>Asortyment</th><th>Data WZ</th><th>Nr WZ</th><th>Ilość</th><th>Status</th><th>Akcje</th></tr></thead>
              <tbody>{filteredWzQueueLines.map(line => {
                const canDecide = line.status === 'pending'
                const hasK03 = line.status !== 'pending' && Boolean(line.k03Form)
                const frozen = k03LineIsFrozen(line)
                const modeTag = k03LineWorkflowModeTag(line)
                return <tr key={line.key} className={frozen ? 'row-frozen' : ''}>
                  <td><b>{line.product_name}</b></td>
                  <td>{line.wz_date || '-'}</td>
                  <td>{line.document_no || '-'}</td>
                  <td>{Number(line.qty || 0).toLocaleString('pl-PL')} kg</td>
                  <td>{renderWorkflowStatusPills(modeTag, frozen)}</td>
                  <td className="row-actions">
                    {canDecide && <>
                      <button className="mini" onClick={() => openK03WzModal(line, 'przerob')}>Przerób</button>
                      <button className="mini secondary" onClick={() => openK03WzModal(line, 'bez_przerobu')}>Bez przerobu</button>
                    </>}
                    {line.k03Form && (() => {
                      const k03Doc = syntheticK03Docs.find(d => d.id === line.formId) || line.k03Form
                      return <button className="mini secondary" onClick={() => setSelectedHaccpDoc({ groupPreview: true, group: { key: line.formId, type: 'K03', product: line.product_name, docs: [k03Doc] } })}><Eye size={14}/></button>
                    })()}
                    {hasK03 && <>
                      <button className="mini" onClick={() => openK03WzEditModal(line)}>Zmień decyzję</button>
                      {frozen && <button type="button" className="mini secondary" onClick={() => unfreezeK03Line(line)}>Odmroź</button>}
                      {isAdmin(authProfile) && <button type="button" className="mini danger" onClick={() => revertK03Line(line)}>Cofnij</button>}
                    </>}
                  </td>
                </tr>
              })}</tbody>
            </table></div>}
          </details>
        </>}

        {docsFilter === 'K01.1' && renderK011Section()}
        {getDocFormCfg(docsFilter) && docsHubSection === 'kartoteki' && renderManualHaccpEntrySection()}

        {!['K01.1', 'K04.1', 'K05', 'K02'].includes(docsFilter) && <>
          {haccpMonthlyGroups.length === 0 && docsFilter === 'K03' && <p className="hint">Brak kartotek K03 – wybierz WZ powyżej.</p>}
          {haccpMonthlyGroups.length === 0 && docsFilter === 'K04' && <p className="hint">Brak K04 – uzupełnij K03 (WZ) i odśwież magazyn, lub przypisz partie w CP3.</p>}
          {haccpMonthlyGroups.length === 0 && docsFilter === 'K06' && <p className="hint">Brak K06 – utwórz K03 dla WZ (przerób / bez przerobu), potem odśwież kartoteki.</p>}
          {haccpMonthlyGroups.length === 0 && docsFilter === 'K07' && <p className="hint">Brak K07 – po przerobie na pulpę pojawią się 2 wpisy (przed/po). Odśwież magazyn partii lub dodaj ręcznie poniżej.</p>}
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
                const wfTag = k03DocWorkflowModeTag(doc)
                const docFrozen = k03DocIsFrozen(doc)
                return <tr key={g.key} className={docFrozen ? 'row-frozen' : ''}>
                  <td>{doc.document_date || '-'}<KartotekaPrintBadge group={g} localPrints={kartotekaLocalPrints} onToggle={toggleKartotekaPrintStatus} /></td>
                  <td><b>{doc.document_no || '-'}</b></td>
                  <td>{doc.lot_no || '-'}</td>
                  <td>{doc.product_name || g.product}</td>
                  <td>{saleQty.toLocaleString('pl-PL')}</td>
                  <td>{pzQty.toLocaleString('pl-PL')}</td>
                  <td>{renderWorkflowStatusPills(wfTag, docFrozen)}</td>
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
                <td>{periodLabel(g)}<KartotekaPrintBadge group={g} localPrints={kartotekaLocalPrints} onToggle={toggleKartotekaPrintStatus} /></td>
                <td>{g.product}{g.chamber ? ` / ${g.chamber}` : ''}</td>
                <td>{g.docs.length}</td>
                <td>{g.docs.filter(d => d.status === 'N').length || '—'}</td>
                <td className="row-actions">
                  <button className="mini secondary" onClick={() => setSelectedHaccpDoc({ groupPreview: true, group: g })}><Eye size={14}/> Otwórz</button>
                  <button className="mini secondary" onClick={() => printHaccpGroup(g)}><Printer size={14}/></button>
                  <button className="mini secondary" onClick={() => exportHaccpGroupExcel(g)}>XLS</button>
                  {docsFilter === 'K01' && (
                    <span className="k01-group-total" title="Suma kg z wpisów w kartotece">
                      <b>{k01GroupTotalKg(g).toLocaleString('pl-PL')} kg</b>
                    </span>
                  )}
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
    {renderK03ActionDialog()}
    </>}

    {activeTab === 'archiwum-pdf' && canSeeTab(authProfile, 'archiwum-pdf') && (
      <PdfDocumentsSection
        supabase={supabase}
        employees={employees}
        authProfile={authProfile}
        authSession={authSession}
        setMessage={setMessage}
      />
    )}

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
