import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Printer, RefreshCcw, Upload, FileSpreadsheet, Save, Trash2, Database } from 'lucide-react'
import * as XLSX from 'xlsx'
import {
  formatPlMoney,
  buildR14PrintHtml,
  buildR14ExcelRows
} from './monthlyStockValueEngine'
import {
  EXCEL_REPORT_VERSION,
  computeMonthlyStockValueReportFromExcel,
  parseExcelFilesForReport,
  formatReportTitleDate,
  buildReportTitle,
  compareStockValueReports
} from './monthlyStockValueFromExcel'
import {
  fetchAllWarehouseValueLines,
  fetchWarehouseValueMeta,
  fetchWarehouseValueStats,
  appendWarehouseValueFromParsedFiles,
  deleteWarehouseValueBatch,
  saveWarehouseValueSnapshot,
  fetchWarehouseValueSnapshots,
  deleteWarehouseValueSnapshot,
  clearAllWarehouseValueData,
  summarizeBatchRow,
  invalidateWarehouseValueLinesCache,
  WAREHOUSE_VALUE_STORE_VERSION
} from './warehouseValueStore'
import { isSupabaseConfigured } from './supabaseClient'
import { confirmDelete } from './authEngine'

function defaultAsOfDate() {
  const d = new Date()
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const last = new Date(y, m, 0).getDate()
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`
}

function parseIsoDate(iso) {
  const m = String(iso || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) }
}

function buildIsoDate(y, mo, d) {
  const last = new Date(y, mo, 0).getDate()
  const day = Math.min(Math.max(1, d), last)
  return `${y}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function ReportDatePicker({ value, onChange, disabled }) {
  const parts = parseIsoDate(value) || parseIsoDate(defaultAsOfDate())
  const { y, mo, d } = parts
  const daysInMonth = new Date(y, mo, 0).getDate()
  const monthValue = `${y}-${String(mo).padStart(2, '0')}`

  function setMonth(monthStr) {
    const mm = String(monthStr || '').match(/^(\d{4})-(\d{2})$/)
    if (!mm) return
    onChange(buildIsoDate(Number(mm[1]), Number(mm[2]), d))
  }

  function setDay(day) {
    onChange(buildIsoDate(y, mo, Number(day)))
  }

  function preset(kind) {
    const now = new Date()
    if (kind === 'today') {
      onChange(now.toISOString().slice(0, 10))
      return
    }
    if (kind === 'monthStart') {
      onChange(`${y}-${String(mo).padStart(2, '0')}-01`)
      return
    }
    if (kind === 'monthEnd') {
      onChange(buildIsoDate(y, mo, daysInMonth))
    }
  }

  const dayOptions = useMemo(() => Array.from({ length: daysInMonth }, (_, i) => i + 1), [daysInMonth])

  return (
    <div className="report-date-picker">
      <div className="report-date-row">
        <label className="report-date-field">
          <span className="report-date-label">Miesiąc</span>
          <input type="month" value={monthValue} onChange={e => setMonth(e.target.value)} disabled={disabled} />
        </label>
        <label className="report-date-field report-date-day">
          <span className="report-date-label">Dzień</span>
          <select value={Math.min(d, daysInMonth)} onChange={e => setDay(e.target.value)} disabled={disabled}>
            {dayOptions.map(day => (
              <option key={day} value={day}>{day}</option>
            ))}
          </select>
        </label>
        <label className="report-date-field report-date-native">
          <span className="report-date-label">Kalendarz</span>
          <input type="date" value={value} onChange={e => onChange(e.target.value)} disabled={disabled} />
        </label>
      </div>
      <div className="report-date-presets">
        <button type="button" className="mini secondary" disabled={disabled} onClick={() => preset('monthEnd')}>Koniec miesiąca</button>
        <button type="button" className="mini secondary" disabled={disabled} onClick={() => preset('monthStart')}>Pierwszy dzień</button>
        <button type="button" className="mini secondary" disabled={disabled} onClick={() => preset('today')}>Dziś</button>
      </div>
    </div>
  )
}

export function StockValueReportSection({ supabase, savedBy = '', escapeHtml, printHtmlInIframe, setMessage }) {
  const [asOfDate, setAsOfDate] = useState(defaultAsOfDate)
  const [loading, setLoading] = useState(false)
  const [storeLoading, setStoreLoading] = useState(false)
  const [calcLoading, setCalcLoading] = useState(false)
  const [loadProgress, setLoadProgress] = useState({ loaded: 0, total: 0 })
  const [lineCountHint, setLineCountHint] = useState(0)
  const [integrityNote, setIntegrityNote] = useState('')
  const [report, setReport] = useState(null)
  const [expanded, setExpanded] = useState(() => new Set())
  const [excelRows, setExcelRows] = useState([])
  const [batches, setBatches] = useState([])
  const [snapshots, setSnapshots] = useState([])
  const fileInputRef = useRef(null)
  const asOfDateRef = useRef(asOfDate)
  asOfDateRef.current = asOfDate

  const fileNames = useMemo(() => batches.map(b => b.file_name).filter(Boolean), [batches])

  const recalculate = useCallback((rows, names, date) => {
    const result = computeMonthlyStockValueReportFromExcel(rows, date, { fileNames: names })
    setReport(result)
    setExpanded(new Set())
    return result
  }, [])

  const reloadFromSupabase = useCallback(async (silent = false, { forceRefresh = false } = {}) => {
    if (!supabase) {
      setExcelRows([])
      setBatches([])
      setReport(null)
      setLineCountHint(0)
      return
    }
    setStoreLoading(true)
    setLoadProgress({ loaded: 0, total: 0 })
    try {
      const meta = await fetchWarehouseValueMeta(supabase)
      setBatches(meta.batches || [])
      setSnapshots(meta.snapshots || [])
      setLineCountHint(meta.lineCount || 0)

      if (!meta.lineCount) {
        setExcelRows([])
        setReport(null)
        setIntegrityNote('')
        return
      }

      const rows = await fetchAllWarehouseValueLines(supabase, {
        forceRefresh,
        onProgress: (loaded, total) => setLoadProgress({ loaded, total })
      })
      setExcelRows(rows)
      const skipped = rows.length - (computeMonthlyStockValueReportFromExcel(rows, asOfDateRef.current).diagnostics?.excelLines || 0)
      setIntegrityNote(
        rows.length !== meta.lineCount
          ? `Uwaga: w bazie ${meta.lineCount} wierszy, wczytano ${rows.length} — odśwież ponownie.`
          : skipped > 0
            ? `${skipped} wierszy w bazie pominięto przy przeliczeniu (MM, brak daty lub ilości).`
            : ''
      )
      if (!silent && rows.length) {
        setMessage?.(`Wczytano ${rows.length} wierszy PZ/WZ z Supabase (${meta.batchCount} importów).`)
      }
    } catch (err) {
      console.error('warehouse value load', err)
      const msg = String(err?.message || err)
      if (/warehouse_value|relation.*does not exist|42P01/i.test(msg)) {
        setMessage?.('Brak tabel magazynu wartości w Supabase. Uruchom SQL: supabase/2026-v45-warehouse-value-magazyn.sql')
      } else if (/permission denied|row-level security|42501/i.test(msg)) {
        setMessage?.('Brak dostępu do magazynu wartości — zaloguj się lub uruchom polityki RLS.')
      } else {
        setMessage?.(`Błąd wczytywania z Supabase: ${msg}`)
      }
    } finally {
      setStoreLoading(false)
      setLoadProgress({ loaded: 0, total: 0 })
    }
  }, [supabase, setMessage])

  useEffect(() => {
    void reloadFromSupabase(true)
  }, [reloadFromSupabase])

  useEffect(() => {
    if (!excelRows.length) {
      setReport(null)
      setCalcLoading(false)
      setIntegrityNote('')
      return
    }
    setCalcLoading(true)
    const timer = window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        recalculate(excelRows, fileNames, asOfDate)
        setCalcLoading(false)
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [asOfDate, excelRows, fileNames, recalculate])

  async function handleExcelUpload(fileList) {
    const files = [...(fileList || [])].filter(Boolean)
    if (!files.length) return
    if (!supabase) {
      setMessage?.('Brak Supabase — skonfiguruj .env i uruchom migrację SQL magazynu wartości.')
      return
    }
    setLoading(true)
    try {
      const parsedFiles = []
      let skippedMm = 0
      for (const file of files) {
        const part = await parseExcelFilesForReport([file])
        parsedFiles.push({ fileName: file.name, rows: part.rows })
        skippedMm += part.skippedMm || 0
      }
      const flatRows = parsedFiles.flatMap(f => f.rows)
      const fileReport = computeMonthlyStockValueReportFromExcel(flatRows, asOfDateRef.current, {
        fileNames: parsedFiles.map(f => f.fileName)
      })
      const fileLineCount = fileReport.diagnostics?.excelLines || 0
      const { totalAdded, totalDuplicates } = await appendWarehouseValueFromParsedFiles(
        supabase,
        parsedFiles,
        { uploadedBy: savedBy }
      )
      await reloadFromSupabase(true, { forceRefresh: true })
      const [dbRows, stats] = await Promise.all([
        fetchAllWarehouseValueLines(supabase, { forceRefresh: true }),
        fetchWarehouseValueStats(supabase)
      ])
      const dbReport = computeMonthlyStockValueReportFromExcel(dbRows, asOfDateRef.current, {
        fileNames: (stats.batches || []).map(b => b.file_name).filter(Boolean)
      })
      const verify = stats.batchCount === 1
        ? compareStockValueReports(fileReport, dbReport)
        : { ok: true, diffs: [] }
      const linesWithPrice = flatRows.filter(r => Number(r.unitNetPrice) > 0).length
      const priceHint = linesWithPrice ? ` · ${linesWithPrice} linii w pliku z ceną netto` : ''
      const dupHint = totalDuplicates ? ` · ${totalDuplicates} duplikatów pominięto` : ''
      const fileHint = `Plik: ${fileLineCount} linii raportowych`
      const verifyHint = !verify.ok && totalAdded > 0
        ? ' · UWAGA: wynik z bazy różni się od pliku — wyczyść magazyn wartości i wgraj Excel ponownie.'
        : ''
      setMessage?.(
        `Zapisano w Supabase: +${totalAdded} wierszy z ${files.length} pliku(ów)${skippedMm ? ` (pominięto ${skippedMm} MM)` : ''}${dupHint}${priceHint}. ${fileHint}${verifyHint}. ` +
        (totalAdded === 0 ? 'Wszystkie wiersze były już w bazie.' : 'Kolejne miesiące doklejaj — nie trzeba wgrywać historii od nowa.')
      )
    } catch (err) {
      console.error('Excel report upload', err)
      setMessage?.(`Błąd importu do Supabase: ${err?.message || String(err)}`)
    } finally {
      setLoading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleDeleteBatch(batchId) {
    if (!supabase || !batchId) return
    const batch = batches.find(b => b.id === batchId)
    if (!confirmDelete(`Import: ${batch?.file_name || batchId}\n\nUsunie ${batch?.row_count || 0} wierszy z magazynu wartości (nie dotyka HACCP).`)) return
    setLoading(true)
    try {
      await deleteWarehouseValueBatch(supabase, batchId)
      await reloadFromSupabase(true, { forceRefresh: true })
      setMessage?.('Usunięto import z magazynu wartości.')
    } catch (err) {
      setMessage?.(`Błąd usuwania: ${err?.message || String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveSnapshot() {
    if (!supabase || !report?.rows?.length) return
    setLoading(true)
    try {
      await saveWarehouseValueSnapshot(supabase, report, { savedBy })
      const snaps = await fetchWarehouseValueSnapshots(supabase)
      setSnapshots(snaps)
      setMessage?.(`Zapisano snapshot stanu na ${formatReportTitleDate(report.asOfDate)} w Supabase.`)
    } catch (err) {
      setMessage?.(`Błąd zapisu snapshotu: ${err?.message || String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  async function handleDeleteSnapshot(snap) {
    if (!supabase || !snap?.id) return
    if (!confirmDelete(`Snapshot stanu na ${formatReportTitleDate(snap.as_of_date)}.`)) return
    try {
      await deleteWarehouseValueSnapshot(supabase, snap.id)
      setSnapshots(await fetchWarehouseValueSnapshots(supabase))
      setMessage?.('Usunięto snapshot.')
    } catch (err) {
      setMessage?.(`Błąd: ${err?.message || String(err)}`)
    }
  }

  async function handleClearAll() {
    if (!supabase) return
    if (!confirmDelete('CAŁY magazyn wartości (wszystkie importy Excel i snapshoty).\n\nNie dotyka magazynu HACCP / FIFO partii.')) return
    if (!window.confirm('Ostateczne potwierdzenie: wyczyścić wszystkie dane magazynu wartości?')) return
    setLoading(true)
    try {
      await clearAllWarehouseValueData(supabase)
      await reloadFromSupabase(true, { forceRefresh: true })
      setMessage?.('Wyczyszczono magazyn wartości w Supabase.')
    } catch (err) {
      setMessage?.(`Błąd: ${err?.message || String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  function toggleExpand(key) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function printReport() {
    if (!report) return
    printHtmlInIframe(buildR14PrintHtml(report, escapeHtml))
  }

  function exportExcel() {
    if (!report) return
    const out = buildR14ExcelRows(report)
    const ws = XLSX.utils.aoa_to_sheet(out)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Magazyn')
    const day = String(report.asOfDate || asOfDate).slice(0, 10).replace(/-/g, '')
    XLSX.writeFile(wb, `Raport_magazyn_${day}.xlsx`)
  }

  const rows = report?.rows || []
  const diag = report?.diagnostics
  const reportTitle = report?.reportTitle || buildReportTitle({ asOfDate })

  return (
    <div className="stock-value-report">
      <p className="hint">
        <b>Wartość magazynu</b> — osobne narzędzie od HACCP. FIFO {EXCEL_REPORT_VERSION} · dane w Supabase ({WAREHOUSE_VALUE_STORE_VERSION}).
        WZ rozlicza PZ o <b>tej samej nazwie produktu</b> co w Excelu (normalizacja spacji i polskich znaków). Silnik {EXCEL_REPORT_VERSION} — identyczny wynik z pliku i z Supabase. Importy się <b>doklejają</b>.
      </p>

      {!isSupabaseConfigured && (
        <p className="hint inline-warning">Brak Supabase w .env — raport wymaga bazy. Skopiuj .env.example i uruchom migrację SQL.</p>
      )}

      {integrityNote && <p className="hint inline-warning">{integrityNote}</p>}

      <section className="card stock-excel-panel">
        <h3><Database size={18} /> Magazyn danych (Supabase)</h3>
        <p className="hint">
          {storeLoading ? (
            loadProgress.total > 0
              ? <>Wczytywanie wierszy z Supabase… <b>{loadProgress.loaded.toLocaleString('pl-PL')}</b> / {loadProgress.total.toLocaleString('pl-PL')}</>
              : lineCountHint > 0
                ? <>Łączenie z Supabase… <b>{lineCountHint.toLocaleString('pl-PL')}</b> wierszy do pobrania</>
                : 'Wczytywanie…'
          ) : calcLoading ? (
            <>Przeliczam FIFO… {lineCountHint ? `(${lineCountHint.toLocaleString('pl-PL')} wierszy)` : ''}</>
          ) : (
            excelRows.length
              ? <><b>{excelRows.length}</b> wierszy PZ/WZ · <b>{batches.length}</b> import(ów)</>
              : 'Brak danych — wgraj pierwszy Excel poniżej.'
          )}
        </p>
        {batches.length > 0 && (
          <ul className="warehouse-batch-list hint">
            {batches.map(b => (
              <li key={b.id}>
                {summarizeBatchRow(b)}
                <button type="button" className="mini danger" disabled={loading} onClick={() => void handleDeleteBatch(b.id)} title="Usuń ten import">
                  <Trash2 size={12} /> Usuń
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="actions">
          <button type="button" className="secondary" disabled={!supabase || storeLoading} onClick={() => { invalidateWarehouseValueLinesCache(); void reloadFromSupabase(false, { forceRefresh: true }) }}>
            <RefreshCcw size={16} /> Odśwież z bazy
          </button>
          <button type="button" className="secondary danger" disabled={!supabase || !excelRows.length || loading} onClick={() => void handleClearAll()}>
            Wyczyść cały magazyn wartości
          </button>
        </div>
      </section>

      <section className="card stock-excel-panel">
        <h3><FileSpreadsheet size={18} /> 1. Wgraj plik Excel (doklej do bazy)</h3>
        <p className="hint">
          Eksport szczegółowy PZ/WZ z kolumną „Cena netto”. Pierwszy raz — pełna historia. Kolejne miesiące — tylko nowy export; duplikaty są pomijane.
        </p>
        <div className="actions">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            multiple
            className="file-input-hidden"
            onChange={e => void handleExcelUpload(e.target.files)}
          />
          <button type="button" disabled={loading || !supabase} onClick={() => fileInputRef.current?.click()}>
            <Upload size={16} /> {loading ? 'Zapisuję…' : 'Wybierz Excel i zapisz w Supabase'}
          </button>
        </div>
      </section>

      <section className="card stock-excel-panel">
        <h3>2. Wybierz datę stanu</h3>
        <div className="form-grid compact r14-controls">
          <label>
            Stan na dzień
            <ReportDatePicker value={asOfDate} onChange={setAsOfDate} disabled={!excelRows.length || loading} />
          </label>
          <div className="actions">
            <button
              type="button"
              className="secondary"
              disabled={!excelRows.length || loading}
              onClick={() => recalculate(excelRows, fileNames, asOfDate)}
            >
              <RefreshCcw size={16} /> Przelicz
            </button>
            <button type="button" className="secondary" disabled={!rows.length} onClick={printReport}>
              <Printer size={16} /> Drukuj
            </button>
            <button type="button" className="secondary" disabled={!rows.length} onClick={exportExcel}>Excel</button>
            <button type="button" className="secondary" disabled={!rows.length || !supabase || loading} onClick={() => void handleSaveSnapshot()}>
              <Save size={16} /> Zapisz snapshot
            </button>
          </div>
        </div>
        {excelRows.length > 0 && (
          <p className="hint report-title-preview">{reportTitle}</p>
        )}
      </section>

      {snapshots.length > 0 && (
        <section className="card stock-excel-panel">
          <h3>Zapisane snapshoty (archiwum)</h3>
          <ul className="warehouse-batch-list hint">
            {snapshots.map(s => (
              <li key={s.id}>
                {formatReportTitleDate(s.as_of_date)} · {Number(s.totals?.remaining_kg || 0).toLocaleString('pl-PL')} kg · {formatPlMoney(s.totals?.remaining_value)} zł
                {s.saved_at ? ` · ${new Date(s.saved_at).toLocaleString('pl-PL')}` : ''}
                <button type="button" className="mini secondary" onClick={() => setAsOfDate(String(s.as_of_date).slice(0, 10))}>Pokaż datę</button>
                <button type="button" className="mini danger" onClick={() => void handleDeleteSnapshot(s)}><Trash2 size={12} /></button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!excelRows.length && !loading && !storeLoading && !lineCountHint && (
        <p className="hint">Wgraj plik Excel — dane zostaną w Supabase i będą dostępne przy kolejnych logowaniach.</p>
      )}

      {report && excelRows.length > 0 && (
        <div className="summary r14-summary">
          <span>Stan na: <b>{report.asOfDatePl || formatReportTitleDate(asOfDate)}</b></span>
          <span>Przybyło (01.–{report.asOfDatePl?.replace(/r\.$/, '') || '…'}): <b>{Number(report.totals?.purchased_kg || 0).toLocaleString('pl-PL')} kg</b></span>
          <span>Ubyło: <b>{Number(report.totals?.sold_kg || 0).toLocaleString('pl-PL')} kg</b></span>
          <span>Ilość końcowa FIFO: <b>{Number(report.totals?.remaining_kg || 0).toLocaleString('pl-PL')} kg</b> · <b>{formatPlMoney(report.totals?.remaining_value)} zł</b></span>
          {diag && (
            <span className="hint">
              {diag.pzLines} PZ, {diag.wzLines} WZ w bazie · {diag.linesWithPrice} z ceną
              {diag.wzAfterCutoff > 0 ? ` · ${diag.wzAfterCutoff} WZ po dacie stanu pominięte` : ''}
            </span>
          )}
        </div>
      )}

      {rows.length > 0 ? (
        <div className="table-wrap docs-table-wrap">
          <table className="docs-table r14-table">
            <thead>
              <tr>
                <th>Produkt</th>
                <th className="num">Przybyło kg</th>
                <th className="num">Ubyło kg</th>
                <th className="num">Ilość końcowa<br /><small>FIFO · {report?.asOfDatePl || ''}</small></th>
                <th className="num">Wartość zakupu<br /><small>netto</small></th>
                <th className="num">Wartość końcowa<br /><small>netto</small></th>
                <th>Szczegóły</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const key = row.product_key || row.product_name
                const open = expanded.has(key)
                return (
                  <React.Fragment key={key}>
                    <tr>
                      <td><b>{row.product_name}</b>{row.product_group ? <small className="hint"> · {row.product_group}</small> : null}</td>
                      <td className="num">{Number(row.purchased_kg || 0).toLocaleString('pl-PL')}</td>
                      <td className="num">{Number(row.sold_kg || 0).toLocaleString('pl-PL')}</td>
                      <td className="num">{Number(row.remaining_kg || 0).toLocaleString('pl-PL')}</td>
                      <td className="num">{formatPlMoney(row.purchased_value)}</td>
                      <td className="num">
                        <b>{formatPlMoney(row.remaining_value)}</b>
                        {row.remaining_missing_price_kg > 0 && (
                          <small className="hint"> ({Number(row.remaining_missing_price_kg).toLocaleString('pl-PL')} kg bez ceny)</small>
                        )}
                      </td>
                      <td>
                        {row.lot_lines?.length > 0 && (
                          <button type="button" className="mini secondary" onClick={() => toggleExpand(key)}>
                            {open ? 'Ukryj' : `${row.lot_lines.length} PZ`}
                          </button>
                        )}
                      </td>
                    </tr>
                    {open && row.lot_lines?.length > 0 && (
                      <tr className="r14-detail-row">
                        <td colSpan={7}>
                          <table className="r14-lot-table">
                            <thead>
                              <tr>
                                <th>Nr PZ</th>
                                <th>Data</th>
                                <th className="num">Pozostało kg</th>
                                <th className="num">Cena netto</th>
                                <th className="num">Wartość netto</th>
                              </tr>
                            </thead>
                            <tbody>
                              {row.lot_lines.map(line => (
                                <tr key={`${line.pz_no}-${line.pz_date}-${line.remaining_kg}`}>
                                  <td>{line.pz_no}</td>
                                  <td>{line.pz_date}</td>
                                  <td className="num">{Number(line.remaining_kg || 0).toLocaleString('pl-PL')}</td>
                                  <td className="num">{line.unit_price_net != null ? formatPlMoney(line.unit_price_net) : '—'}</td>
                                  <td className="num">{line.line_value != null ? formatPlMoney(line.line_value) : '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <td><b>Razem</b></td>
                <td className="num"><b>{Number(report?.totals?.purchased_kg || 0).toLocaleString('pl-PL')}</b></td>
                <td className="num"><b>{Number(report?.totals?.sold_kg || 0).toLocaleString('pl-PL')}</b></td>
                <td className="num"><b>{Number(report?.totals?.remaining_kg || 0).toLocaleString('pl-PL')}</b></td>
                <td className="num"><b>{formatPlMoney(report?.totals?.purchased_value)}</b></td>
                <td className="num"><b>{formatPlMoney(report?.totals?.remaining_value)}</b></td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      ) : excelRows.length > 0 && !loading && report && (
        <p className="hint">{report.message}</p>
      )}
    </div>
  )
}

export const R14StockValueSection = StockValueReportSection
