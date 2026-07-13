import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Printer, RefreshCcw, Upload } from 'lucide-react'
import * as XLSX from 'xlsx'
import {
  MONTHLY_STOCK_VALUE_VERSION,
  computeMonthlyStockValueReport,
  formatPlMoney,
  buildR14PrintHtml,
  buildR14ExcelRows
} from './monthlyStockValueEngine'
import {
  UNIT_PRICE_BACKFILL_VERSION,
  backfillUnitPricesFromExcelFiles,
  listImportedFilesForMonth
} from './unitPriceBackfillEngine'

function shiftMonth(ym, delta) {
  const [y, m] = String(ym || '').split('-').map(Number)
  if (!y || !m) return new Date().toISOString().slice(0, 7)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function StockValueReportSection({ supabase, escapeHtml, printHtmlInIframe, setMessage, canonicalProductName }) {
  const [yearMonth, setYearMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [loading, setLoading] = useState(false)
  const [backfilling, setBackfilling] = useState(false)
  const [report, setReport] = useState(null)
  const [expanded, setExpanded] = useState(() => new Set())
  const [importedFiles, setImportedFiles] = useState([])
  const [filterBackfillMonth, setFilterBackfillMonth] = useState(true)
  const fileInputRef = useRef(null)

  const loadReport = useCallback(async () => {
    if (!supabase) {
      setMessage?.('Raporty: brak połączenia z bazą (Supabase).')
      return
    }
    setLoading(true)
    try {
      const result = await computeMonthlyStockValueReport(supabase, yearMonth)
      setReport(result)
      setExpanded(new Set())
      setMessage?.(result.message || '')
    } catch (err) {
      console.error('Stock report load error', err)
      setReport(null)
      setMessage?.(`Raporty: błąd wczytywania – ${err?.message || String(err)}`)
    } finally {
      setLoading(false)
    }
  }, [supabase, yearMonth, setMessage])

  const loadImports = useCallback(async () => {
    if (!supabase) return
    try {
      const rows = await listImportedFilesForMonth(supabase, yearMonth)
      setImportedFiles(rows)
    } catch (err) {
      console.error('Import list error', err)
      setImportedFiles([])
    }
  }, [supabase, yearMonth])

  useEffect(() => {
    void loadReport()
    void loadImports()
  }, [loadReport, loadImports])

  async function handleBackfillFiles(fileList) {
    const files = [...(fileList || [])].filter(Boolean)
    if (!files.length || !supabase) return
    setBackfilling(true)
    try {
      const result = await backfillUnitPricesFromExcelFiles(supabase, files, {
        yearMonth: filterBackfillMonth ? yearMonth : undefined,
        canonicalProductName,
        overwrite: true
      })
      setMessage?.(result.message || 'Uzupełniono ceny.')
      await loadReport()
    } catch (err) {
      setMessage?.(`Uzupełnianie cen: ${err?.message || String(err)}`)
    } finally {
      setBackfilling(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function toggleExpand(productId) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(productId)) next.delete(productId)
      else next.add(productId)
      return next
    })
  }

  function printReport() {
    if (!report) return
    printHtmlInIframe(buildR14PrintHtml(report, escapeHtml))
  }

  function exportExcel() {
    if (!report) return
    const rows = buildR14ExcelRows(report)
    const ws = XLSX.utils.aoa_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Magazyn')
    XLSX.writeFile(wb, `Raport_magazyn_${report.yearMonth || 'raport'}.xlsx`)
  }

  const rows = report?.rows || []
  const diag = report?.diagnostics

  return (
    <div className="stock-value-report">
      <p className="hint">
        Stan magazynu na koniec miesiąca (<b>FIFO</b>): przyjęcia wg <b>daty PZ</b>, sprzedaż wg <b>daty WZ</b> — nie daty przerobu K03.
        WZ wystawione 01.07 z przerobem w czerwcu na stanie 30.06 nadal jest w magazynie.
        <b>Ilość końcowa</b> = FIFO do ostatniego dnia miesiąca; <b>przybyło/ubyło</b> = ruch w samym miesiącu (informacyjnie).
        Wartość = ilość × cena netto z PZ. Silnik: {MONTHLY_STOCK_VALUE_VERSION} (osobny od HACCP/FIFO).
      </p>

      <div className="form-grid compact r14-controls">
        <label>
          Miesiąc raportu
          <div className="month-nav">
            <button type="button" className="mini secondary" onClick={() => setYearMonth(m => shiftMonth(m, -1))}>‹</button>
            <input type="month" value={yearMonth} onChange={e => setYearMonth(e.target.value)} />
            <button type="button" className="mini secondary" onClick={() => setYearMonth(m => shiftMonth(m, 1))}>›</button>
          </div>
        </label>
        <div className="actions">
          <button type="button" className="secondary" onClick={loadReport} disabled={loading}>
            <RefreshCcw size={16} /> {loading ? 'Wczytywanie…' : 'Odśwież'}
          </button>
          <button type="button" className="secondary" onClick={printReport} disabled={!rows.length}>
            <Printer size={16} /> Drukuj
          </button>
          <button type="button" className="secondary" onClick={exportExcel} disabled={!rows.length}>Excel</button>
        </div>
      </div>

      <section className="card stock-backfill-panel">
        <h3>Uzupełnij ceny netto z plików Excel</h3>
        <p className="hint">
          Wskaż ponownie te same pliki Excel, które już wcześniej wgrałaś (np. zestawienie za czerwiec).
          Program dopasuje pozycje PZ po nr dokumentu, produkcie i ilości – <b>bez duplikowania importu</b> – i zapisze ceny netto.
          Wersja: {UNIT_PRICE_BACKFILL_VERSION}.
        </p>
        <label className="checkbox-inline">
          <input type="checkbox" checked={filterBackfillMonth} onChange={e => setFilterBackfillMonth(e.target.checked)} />
          Tylko dokumenty z wybranego miesiąca ({yearMonth})
        </label>
        <div className="actions">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            multiple
            className="file-input-hidden"
            onChange={e => handleBackfillFiles(e.target.files)}
          />
          <button type="button" disabled={backfilling} onClick={() => fileInputRef.current?.click()}>
            <Upload size={16} /> {backfilling ? 'Przypisywanie cen…' : 'Wybierz plik(i) Excel'}
          </button>
        </div>
        {importedFiles.length > 0 && (
          <div className="table-wrap small">
            <p className="hint">Zapisane importy powiązane z {yearMonth} – wskaż te same pliki z dysku:</p>
            <table>
              <thead><tr><th>Plik</th><th>Data importu</th><th>Wiersze</th><th>Status</th></tr></thead>
              <tbody>
                {importedFiles.map(f => (
                  <tr key={f.id}>
                    <td><b>{f.filename || f.file_name || 'import.xlsx'}</b></td>
                    <td>{f.created_at ? new Date(f.created_at).toLocaleString('pl-PL') : '—'}</td>
                    <td>{f.rows_count || f.row_count || '—'}</td>
                    <td>{f.status || 'wczytany'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {report && (
        <div className="summary r14-summary">
          <span>Okres: <b>{report.monthStart} – {report.monthEnd}</b></span>
          <span>Przybyło: <b>{Number(report.totals?.purchased_kg || 0).toLocaleString('pl-PL')} kg</b> · {formatPlMoney(report.totals?.purchased_value)} zł</span>
          <span>Ubyło: <b>{Number(report.totals?.sold_kg || 0).toLocaleString('pl-PL')} kg</b></span>
          <span>Ilość końcowa: <b>{Number(report.totals?.remaining_kg || 0).toLocaleString('pl-PL')} kg</b> · {formatPlMoney(report.totals?.remaining_value)} zł netto</span>
          {diag && (
            <span className="hint">
              {diag.lotsInScope} partii PZ do {report.monthEnd} · {diag.pzInMonth} PZ / {diag.wzInMonth} WZ w miesiącu
              {diag.wzAfterMonthEnd > 0 ? ` · ${diag.wzAfterMonthEnd} WZ po ${report.monthEnd} pominięte` : ''}
            </span>
          )}
          {report.hasPriceColumn === false && (
            <span className="warning-text">Brak kolumny cen w bazie – uruchom migrację v44 w Supabase.</span>
          )}
          {(report.missingPriceLines > 0 || (report.totals?.purchased_kg > 0 && report.totals?.purchased_value === 0)) && report.hasPriceColumn !== false && (
            <span className="warning-text">Brak ceny na pozycjach PZ – wskaż pliki Excel poniżej (Wybierz plik).</span>
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
                <th className="num">Ilość końcowa<br /><small>(FIFO na {report?.monthEnd || '…'})</small></th>
                <th className="num">Wartość zakupu<br /><small>netto</small></th>
                <th className="num">Wartość końcowa<br /><small>netto</small></th>
                <th>Szczegóły</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const key = row.product_key || row.product_id || row.product_name
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
                        {formatPlMoney(row.remaining_value)}
                        {row.remaining_missing_price_kg > 0 && (
                          <small className="hint"> ({Number(row.remaining_missing_price_kg).toLocaleString('pl-PL')} kg bez ceny)</small>
                        )}
                      </td>
                      <td>
                        {row.pz_lines?.length > 0 && (
                          <button type="button" className="mini secondary" onClick={() => toggleExpand(key)}>
                            {open ? 'Ukryj PZ' : `${row.pz_lines.length} PZ`}
                          </button>
                        )}
                      </td>
                    </tr>
                    {open && row.pz_lines?.length > 0 && (
                      <tr className="r14-detail-row">
                        <td colSpan={7}>
                          <table className="r14-lot-table">
                            <thead>
                              <tr>
                                <th>Nr PZ</th>
                                <th>Data</th>
                                <th className="num">Ilość kg</th>
                                <th className="num">Cena netto</th>
                                <th className="num">Wartość netto</th>
                              </tr>
                            </thead>
                            <tbody>
                              {row.pz_lines.map(line => (
                                <tr key={`${line.item_id}-${line.pz_no}-${line.qty}`}>
                                  <td>{line.pz_no}</td>
                                  <td>{line.pz_date}</td>
                                  <td className="num">{Number(line.qty || 0).toLocaleString('pl-PL')}</td>
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
      ) : !loading && report && (
        <p className="hint">{report.message || 'Brak danych za wybrany miesiąc.'}</p>
      )}
    </div>
  )
}

/** @deprecated alias */
export const R14StockValueSection = StockValueReportSection
