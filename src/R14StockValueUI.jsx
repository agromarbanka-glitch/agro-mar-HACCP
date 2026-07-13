import React, { useCallback, useEffect, useRef, useState } from 'react'
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
  parseExcelFilesForReport
} from './monthlyStockValueFromExcel'

function shiftMonth(ym, delta) {
  const [y, m] = String(ym || '').split('-').map(Number)
  if (!y || !m) return new Date().toISOString().slice(0, 7)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function StockValueReportSection({ escapeHtml, printHtmlInIframe, setMessage }) {
  const [yearMonth, setYearMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState(null)
  const [expanded, setExpanded] = useState(() => new Set())
  const [excelRows, setExcelRows] = useState([])
  const [fileNames, setFileNames] = useState([])
  const fileInputRef = useRef(null)

  const recalculate = useCallback((rows, names, ym) => {
    const result = computeMonthlyStockValueReportFromExcel(rows, ym, { fileNames: names })
    setReport(result)
    setExpanded(new Set())
    setMessage?.(result.message || '')
    return result
  }, [setMessage])

  useEffect(() => {
    if (excelRows.length) recalculate(excelRows, fileNames, yearMonth)
  }, [yearMonth, excelRows, fileNames, recalculate])

  async function handleExcelUpload(fileList) {
    const files = [...(fileList || [])].filter(Boolean)
    if (!files.length) return
    setLoading(true)
    try {
      const { rows, fileNames: names, skippedMm } = await parseExcelFilesForReport(files)
      setExcelRows(rows)
      setFileNames(names)
      const result = recalculate(rows, names, yearMonth)
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
    XLSX.writeFile(wb, `Raport_magazyn_${report.yearMonth || 'raport'}.xlsx`)
  }

  const rows = report?.rows || []
  const diag = report?.diagnostics

  return (
    <div className="stock-value-report">
      <p className="hint">
        Raport liczy się <b>bezpośrednio z pliku Excel</b> — nie używa bazy importu ani dat przerobu K03.
        Wgraj eksport PZ/WZ z Fakturowni (wiersze z produktem, ilością i <b>ostatnią kolumną „Cena netto”</b>).
        FIFO do końca miesiąca · sprzedaż wg <b>daty WZ</b>. Wersja: {EXCEL_REPORT_VERSION}.
      </p>

      <section className="card stock-excel-panel">
        <h3><FileSpreadsheet size={18} /> 1. Wgraj plik Excel</h3>
        <p className="hint">
          Ten sam plik, który wgrywasz w Importy (szczegółowy eksport operacji, nie zestawienie zbiorcze bez cen).
          Możesz wskazać kilka plików naraz.
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
          </p>
        )}
      </section>

      <section className="card stock-excel-panel">
        <h3>2. Wybierz miesiąc</h3>
        <div className="form-grid compact r14-controls">
          <label>
            Miesiąc raportu
            <div className="month-nav">
              <button type="button" className="mini secondary" onClick={() => setYearMonth(m => shiftMonth(m, -1))}>‹</button>
              <input type="month" value={yearMonth} onChange={e => setYearMonth(e.target.value)} disabled={!excelRows.length} />
              <button type="button" className="mini secondary" onClick={() => setYearMonth(m => shiftMonth(m, 1))}>›</button>
            </div>
          </label>
          <div className="actions">
            <button
              type="button"
              className="secondary"
              disabled={!excelRows.length || loading}
              onClick={() => recalculate(excelRows, fileNames, yearMonth)}
            >
              <RefreshCcw size={16} /> Przelicz
            </button>
            <button type="button" className="secondary" onClick={printReport} disabled={!rows.length}>
              <Printer size={16} /> Drukuj
            </button>
            <button type="button" className="secondary" onClick={exportExcel} disabled={!rows.length}>Excel</button>
          </div>
        </div>
      </section>

      {!excelRows.length && !loading && (
        <p className="hint">Wgraj plik Excel, aby zobaczyć zestawienie ilościowo-wartościowe.</p>
      )}

      {report && excelRows.length > 0 && (
        <div className="summary r14-summary">
          <span>Okres: <b>{report.monthStart} – {report.monthEnd}</b></span>
          <span>Przybyło (miesiąc): <b>{Number(report.totals?.purchased_kg || 0).toLocaleString('pl-PL')} kg</b> · {formatPlMoney(report.totals?.purchased_value)} zł</span>
          <span>Ubyło (miesiąc): <b>{Number(report.totals?.sold_kg || 0).toLocaleString('pl-PL')} kg</b></span>
          <span>Ilość końcowa FIFO: <b>{Number(report.totals?.remaining_kg || 0).toLocaleString('pl-PL')} kg</b> · <b>{formatPlMoney(report.totals?.remaining_value)} zł</b> netto</span>
          {diag && (
            <span className="hint">
              Excel: {diag.pzLines} PZ, {diag.wzLines} WZ · {diag.linesWithPrice} linii z ceną
              {diag.wzAfterMonthEnd > 0 ? ` · ${diag.wzAfterMonthEnd} WZ po ${report.monthEnd} pominięte` : ''}
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
                <th className="num">Przybyło kg<br /><small>(miesiąc)</small></th>
                <th className="num">Ubyło kg<br /><small>(miesiąc)</small></th>
                <th className="num">Ilość końcowa<br /><small>FIFO {report?.monthEnd}</small></th>
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
