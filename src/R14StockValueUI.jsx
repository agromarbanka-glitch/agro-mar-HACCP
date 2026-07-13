import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Printer, RefreshCcw, Upload, FileSpreadsheet } from 'lucide-react'
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
  buildReportTitle
} from './monthlyStockValueFromExcel'
import { clearReportExcelStore } from './reportExcelStore'

const SESSION_KEY = 'agro-mar-report-session-v2.5'

function defaultAsOfDate() {
  const d = new Date()
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const last = new Date(y, m, 0).getDate()
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed?.engineVersion !== EXCEL_REPORT_VERSION) return null
    if (!Array.isArray(parsed.rows) || !parsed.rows.length) return null
    return parsed
  } catch {
    return null
  }
}

function saveSession(rows, fileNames) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      engineVersion: EXCEL_REPORT_VERSION,
      savedAt: new Date().toISOString(),
      rows,
      fileNames
    }))
  } catch (err) {
    console.warn('saveSession failed', err)
  }
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

export function StockValueReportSection({ escapeHtml, printHtmlInIframe, setMessage }) {
  const [asOfDate, setAsOfDate] = useState(defaultAsOfDate)
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState(null)
  const [expanded, setExpanded] = useState(() => new Set())
  const [excelRows, setExcelRows] = useState([])
  const [fileNames, setFileNames] = useState([])
  const fileInputRef = useRef(null)

  const recalculate = useCallback((rows, names, date) => {
    const result = computeMonthlyStockValueReportFromExcel(rows, date, { fileNames: names })
    setReport(result)
    setExpanded(new Set())
    return result
  }, [])

  useEffect(() => {
    clearReportExcelStore().catch(() => {})
    const session = loadSession()
    if (session) {
      setExcelRows(session.rows)
      setFileNames(session.fileNames || [])
      setMessage?.(`Przywrócono ostatni wczytany Excel (${session.rows.length} wierszy). Wgraj plik ponownie, jeśli wynik się nie zgadza.`)
    }
  }, [setMessage])

  useEffect(() => {
    if (excelRows.length) recalculate(excelRows, fileNames, asOfDate)
    else setReport(null)
  }, [asOfDate, excelRows, fileNames, recalculate])

  async function handleExcelUpload(fileList) {
    const files = [...(fileList || [])].filter(Boolean)
    if (!files.length) return
    setLoading(true)
    try {
      const { rows, fileNames: names, skippedMm } = await parseExcelFilesForReport(files)
      setExcelRows(rows)
      setFileNames(names)
      saveSession(rows, names)
      const result = recalculate(rows, names, asOfDate)
      const priceHint = result.diagnostics?.linesWithPrice
        ? ` · ${result.diagnostics.linesWithPrice} linii PZ z ceną netto`
        : ''
      setMessage?.(
        `Wczytano ${rows.length} wierszy z ${names.length} pliku(ów)${skippedMm ? ` (pominięto ${skippedMm} MM)` : ''}${priceHint}. ${result.message || ''}`
      )
    } catch (err) {
      console.error('Excel report error', err)
      setMessage?.(`Błąd wczytywania Excel: ${err?.message || String(err)}`)
    } finally {
      setLoading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
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
        Raport z pliku Excel · FIFO · data PZ / data WZ · wersja {EXCEL_REPORT_VERSION} (silnik oryginalny 2.1).
        WZ rozlicza PZ o <b>tej samej nazwie produktu</b> co w imporcie. Możesz wskazać <b>kilka plików naraz</b> (np. dwie paczki po 1000 wierszy).
      </p>

      <section className="card stock-excel-panel">
        <h3><FileSpreadsheet size={18} /> 1. Wgraj plik Excel</h3>
        <p className="hint">
          Eksport szczegółowy PZ/WZ z ostatnią kolumną „Cena netto”. Każde wgrywanie <b>zastępuje</b> poprzednie dane — tak jak na początku, gdy raport działał poprawnie.
        </p>
        <div className="actions">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            multiple
            className="file-input-hidden"
            onChange={e => handleExcelUpload(e.target.files)}
          />
          <button type="button" disabled={loading} onClick={() => fileInputRef.current?.click()}>
            <Upload size={16} /> {loading ? 'Wczytywanie…' : 'Wybierz plik Excel i przelicz'}
          </button>
        </div>
        {fileNames.length > 0 && (
          <p className="hint loaded-files">
            Wczytane: <b>{fileNames.join(', ')}</b> · {excelRows.length} wierszy
            {diag ? <> · {diag.pzLines} PZ, {diag.wzLines} WZ</> : null}
          </p>
        )}
      </section>

      <section className="card stock-excel-panel">
        <h3>2. Wybierz datę stanu</h3>
        <div className="form-grid compact r14-controls">
          <label>
            Stan na dzień
            <ReportDatePicker value={asOfDate} onChange={setAsOfDate} disabled={!excelRows.length} />
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
            <button type="button" className="secondary" onClick={printReport} disabled={!rows.length}>
              <Printer size={16} /> Drukuj
            </button>
            <button type="button" className="secondary" onClick={exportExcel} disabled={!rows.length}>Excel</button>
          </div>
        </div>
        {excelRows.length > 0 && (
          <p className="hint report-title-preview">{reportTitle}</p>
        )}
      </section>

      {!excelRows.length && !loading && (
        <p className="hint">Wgraj plik Excel, aby zobaczyć zestawienie ilościowo-wartościowe.</p>
      )}

      {report && excelRows.length > 0 && (
        <div className="summary r14-summary">
          <span>Stan na: <b>{report.asOfDatePl || formatReportTitleDate(asOfDate)}</b></span>
          <span>Przybyło (01.–{report.asOfDatePl?.replace(/r\.$/, '') || '…'}): <b>{Number(report.totals?.purchased_kg || 0).toLocaleString('pl-PL')} kg</b></span>
          <span>Ubyło: <b>{Number(report.totals?.sold_kg || 0).toLocaleString('pl-PL')} kg</b></span>
          <span>Ilość końcowa FIFO: <b>{Number(report.totals?.remaining_kg || 0).toLocaleString('pl-PL')} kg</b> · <b>{formatPlMoney(report.totals?.remaining_value)} zł</b></span>
          {diag && (
            <span className="hint">
              {diag.pzLines} PZ, {diag.wzLines} WZ w pliku · {diag.linesWithPrice} z ceną
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
