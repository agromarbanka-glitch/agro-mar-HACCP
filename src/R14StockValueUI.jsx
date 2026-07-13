import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Printer, RefreshCcw, Upload, FileSpreadsheet, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
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
  auditProductFifoBalance
} from './monthlyStockValueFromExcel'
import {
  loadReportExcelStoreAsync,
  saveReportExcelStoreAsync,
  appendExcelRowsToStore,
  replaceExcelRowsInStore,
  removeBatchFromStore,
  removeLineFromStore,
  findDuplicateGroups,
  getStoredExcelRows,
  getStoredFileNames,
  formatRowSummary,
  clearReportExcelStore,
  storeStats,
  sanitizeStoreDuplicates
} from './reportExcelStore'

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

function formatBatchDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })
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

  const dayOptions = useMemo(() => {
    return Array.from({ length: daysInMonth }, (_, i) => i + 1)
  }, [daysInMonth])

  return (
    <div className="report-date-picker">
      <div className="report-date-row">
        <label className="report-date-field">
          <span className="report-date-label">Miesiąc</span>
          <input
            type="month"
            value={monthValue}
            onChange={e => setMonth(e.target.value)}
            disabled={disabled}
          />
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
          <input
            type="date"
            value={value}
            onChange={e => onChange(e.target.value)}
            disabled={disabled}
          />
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

export function StockValueReportSection({ escapeHtml, printHtmlInIframe, setMessage, confirmDelete }) {
  const [asOfDate, setAsOfDate] = useState(defaultAsOfDate)
  const [loading, setLoading] = useState(true)
  const [storeReady, setStoreReady] = useState(false)
  const [report, setReport] = useState(null)
  const [expanded, setExpanded] = useState(() => new Set())
  const [store, setStore] = useState(() => ({ version: 2, batches: [], rows: [] }))
  const [showDuplicates, setShowDuplicates] = useState(false)
  const [uploadMode, setUploadMode] = useState('append')
  const [storageBackend, setStorageBackend] = useState('')
  const fileInputRef = useRef(null)
  const didShowStoredHint = useRef(false)

  const excelRows = useMemo(() => getStoredExcelRows(store), [store])
  const fileNames = useMemo(() => getStoredFileNames(store), [store])
  const duplicateGroups = useMemo(() => findDuplicateGroups(store), [store])

  const persistStore = useCallback(async (nextStore) => {
    setStore(nextStore)
    const result = await saveReportExcelStoreAsync(nextStore)
    if (result.backend) setStorageBackend(result.backend)
    if (!result.ok) setMessage?.('Nie udało się zapisać danych w przeglądarce (limit pamięci?).')
    return result.ok
  }, [setMessage])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const loaded = await loadReportExcelStoreAsync()
        if (cancelled) return
        setStore(loaded)
        setStoreReady(true)
        const stats = storeStats(loaded)
        if (stats.totalRows > 0) {
          setMessage?.(
            `Przywrócono ${stats.totalRows} wierszy (${stats.pz} PZ, ${stats.wz} WZ) z ${stats.batchCount} partii. Silnik FIFO bez zmian (wersja ${EXCEL_REPORT_VERSION}).`
          )
        }
      } catch (err) {
        console.error('loadReportExcelStoreAsync', err)
        if (!cancelled) setStoreReady(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [setMessage])

  const recalculate = useCallback((rows, names, date) => {
    const result = computeMonthlyStockValueReportFromExcel(rows, date, { fileNames: names })
    setReport(result)
    setExpanded(new Set())
    return result
  }, [])

  useEffect(() => {
    if (!storeReady) return
    if (excelRows.length) recalculate(excelRows, fileNames, asOfDate)
    else setReport(null)
  }, [asOfDate, excelRows, fileNames, recalculate, storeReady])

  useEffect(() => {
    if (excelRows.length && !loading && !didShowStoredHint.current) {
      didShowStoredHint.current = true
      setMessage?.(
        `W pamięci: ${excelRows.length} wierszy z ${store.batches.length} partii. Zmień datę lub wgraj kolejną paczkę Excel.`
      )
    }
  }, [excelRows.length, loading, setMessage, store.batches.length])

  async function handleExcelUpload(fileList) {
    const files = [...(fileList || [])].filter(Boolean)
    if (!files.length) return
    setLoading(true)
    try {
      const parsedByFile = []
      for (const file of files) {
        const { rows, skippedMmCount } = await parseExcelFilesForReport([file])
        parsedByFile.push({ fileName: file.name, rows, skippedMm: skippedMmCount || 0 })
      }

      const mergeFn = uploadMode === 'replace' ? replaceExcelRowsInStore : appendExcelRowsToStore
      const { store: nextStore, results } = mergeFn(store, parsedByFile)
      const totalAdded = results.reduce((s, r) => s + r.added, 0)
      const totalDup = results.reduce((s, r) => s + r.duplicates, 0)
      const skippedMm = parsedByFile.reduce((s, f) => s + (f.skippedMm || 0), 0)

      if (totalAdded === 0) {
        setMessage?.(
          totalDup > 0
            ? `Wszystkie ${totalDup} wierszy z pliku już są w pamięci (duplikaty pominięte).`
            : 'W pliku nie znaleziono nowych operacji PZ/WZ.'
        )
      } else {
        await persistStore(nextStore)
        const names = getStoredFileNames(nextStore)
        const rows = getStoredExcelRows(nextStore)
        const result = recalculate(rows, names, asOfDate)
        const detail = results.map(r =>
          `„${r.fileName}”: +${r.added}${r.duplicates ? `, pominięto ${r.duplicates} dupl.` : ''}`
        ).join(' · ')
        const priceHint = result.diagnostics?.linesWithPrice
          ? ` · ${result.diagnostics.linesWithPrice} linii PZ z ceną netto`
          : ''
        setMessage?.(
          `Dodano ${totalAdded} wierszy${totalDup ? ` (pominięto ${totalDup} duplikatów)` : ''}${skippedMm ? ` · pominięto ${skippedMm} MM` : ''}. ${detail}${priceHint}. Łącznie w pamięci: ${rows.length} wierszy.`
        )
      }
    } catch (err) {
      console.error('Excel report error', err)
      setMessage?.(`Błąd wczytywania Excel: ${err?.message || String(err)}`)
    } finally {
      setLoading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleRemoveBatch(batch) {
    const ask = confirmDelete || ((msg) => window.confirm(`Czy na pewno usunąć?\n\n${msg}`))
    if (!ask(`Partię importu: „${batch.fileName}" (${batch.rowCount} wierszy).\n\nDane zostaną usunięte z pamięci przeglądarki.`)) return
    const next = removeBatchFromStore(store, batch.id)
    await persistStore(next)
    setMessage?.(`Usunięto partię „${batch.fileName}" (${batch.rowCount} wierszy).`)
  }

  async function handleRemoveDuplicateLine(row) {
    const ask = confirmDelete || ((msg) => window.confirm(`Czy na pewno usunąć?\n\n${msg}`))
    if (!ask(`Duplikat operacji:\n${formatRowSummary(row)}\n\nPozostałe kopie tej samej operacji zostaną w pamięci.`)) return
    const next = removeLineFromStore(store, row._lineId)
    await persistStore(next)
    setMessage?.(`Usunięto duplikat: ${formatRowSummary(row)}`)
  }

  async function handleClearAll() {
    const ask = confirmDelete || ((msg) => window.confirm(`Czy na pewno usunąć?\n\n${msg}`))
    if (!ask(`Wszystkie ${excelRows.length} wierszy z ${store.batches.length} partii.\n\nTrzeba będzie ponownie wgrać pliki Excel.`)) return
    await persistStore(await clearReportExcelStore())
    setReport(null)
    setShowDuplicates(false)
    setMessage?.('Wyczyszczono wszystkie dane raportu z pamięci przeglądarki.')
  }

  async function handleSanitizeDuplicates() {
    const { store: cleaned, removed } = sanitizeStoreDuplicates(store)
    if (!removed) {
      setMessage?.('Nie znaleziono duplikatów do usunięcia.')
      return
    }
    await persistStore(cleaned)
    setMessage?.(`Usunięto ${removed} zduplikowanych wierszy (ta sama operacja wgrana więcej niż raz). Przelicz raport ponownie.`)
  }

  const productAudits = useMemo(() => {
    if (!excelRows.length || !report?.rows) return new Map()
    const m = new Map()
    for (const row of report.rows) {
      if (row.remaining_kg > 0.5) {
        m.set(row.product_key, auditProductFifoBalance(excelRows, row.product_name, asOfDate))
      }
    }
    return m
  }, [excelRows, report?.rows, asOfDate])

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
        Raport z pliku Excel · FIFO · data PZ / data WZ · wersja {EXCEL_REPORT_VERSION}.
        <b> Sposób liczenia nie zmienia się</b> — wynik zależy wyłącznie od wierszy zapisanych w pamięci.
        {storageBackend ? ` Magazyn danych: ${storageBackend === 'indexeddb' ? 'IndexedDB' : 'localStorage'}.` : null}
      </p>

      <section className="card stock-excel-panel">
        <h3><FileSpreadsheet size={18} /> 1. Wgraj plik Excel</h3>
        <p className="hint">
          Eksport szczegółowy PZ/WZ z ostatnią kolumną „Cena netto”. Przy eksporcie partiami (np. 1000 wierszy) wybierz <b>Dodaj partię</b>.
          Jeśli wgrywasz od zera jeden komplet — <b>Zastąp wszystko</b>.
        </p>
        <label className="checkbox-inline report-upload-mode">
          <span>Tryb wgrywania:</span>
          <select value={uploadMode} onChange={e => setUploadMode(e.target.value)} disabled={loading}>
            <option value="append">Dodaj partię (łączy z pamięcią, pomija duplikaty)</option>
            <option value="replace">Zastąp wszystko (czyści pamięć, nowy komplet plików)</option>
          </select>
        </label>
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
            <Upload size={16} /> {loading ? 'Wczytywanie…' : 'Dodaj plik Excel'}
          </button>
          {duplicateGroups.length > 0 && (
            <button type="button" className="secondary" disabled={loading} onClick={handleSanitizeDuplicates}>
              Usuń duplikaty ({duplicateGroups.reduce((s, g) => s + g.rows.length - 1, 0)})
            </button>
          )}
          {store.batches.length > 0 && (
            <button type="button" className="secondary" disabled={loading} onClick={handleClearAll}>
              <Trash2 size={16} /> Wyczyść wszystko
            </button>
          )}
        </div>

        {store.batches.length > 0 && (
          <div className="report-batches">
            <p className="hint"><b>W pamięci:</b> {excelRows.length} wierszy · {store.batches.length} partii</p>
            <ul className="report-batch-list">
              {[...store.batches].reverse().map(batch => (
                <li key={batch.id} className="report-batch-item">
                  <span>
                    <b>{batch.fileName}</b>
                    <small className="hint"> · {batch.rowCount} wierszy · {formatBatchDate(batch.uploadedAt)}</small>
                    {batch.duplicateCount > 0 && (
                      <small className="hint"> · pominięto {batch.duplicateCount} dupl. przy wgrywaniu</small>
                    )}
                  </span>
                  <button type="button" className="mini secondary danger" title="Usuń partię" onClick={() => handleRemoveBatch(batch)}>
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {duplicateGroups.length > 0 && (
          <div className="report-duplicates-panel">
            <button type="button" className="linkish" onClick={() => setShowDuplicates(v => !v)}>
              {showDuplicates ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {duplicateGroups.length} grup duplikatów ({duplicateGroups.reduce((s, g) => s + g.rows.length - 1, 0)} nadmiarowych wierszy)
            </button>
            {showDuplicates && (
              <div className="report-duplicates-list">
                <p className="hint">Te same operacje wgrane więcej niż raz. Usuń nadmiarowe kopie po potwierdzeniu.</p>
                {duplicateGroups.map(group => (
                  <div key={group.key} className="report-dup-group">
                    <div className="report-dup-header">{formatRowSummary(group.rows[0])}</div>
                    <ul>
                      {group.rows.map(row => {
                        const batch = store.batches.find(b => b.id === row._batchId)
                        return (
                          <li key={row._lineId} className="report-dup-line">
                            <span>
                              <small className="hint">{batch?.fileName || '—'}</small>
                              {row.rowNo != null && <small className="hint"> · wiersz {row.rowNo}</small>}
                            </span>
                            <button type="button" className="mini secondary danger" onClick={() => handleRemoveDuplicateLine(row)}>
                              Usuń tę kopię
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="card stock-excel-panel">
        <h3>2. Wybierz datę stanu</h3>
        <div className="form-grid compact r14-controls">
          <label>
            Stan na dzień
            <ReportDatePicker
              value={asOfDate}
              onChange={setAsOfDate}
              disabled={!excelRows.length}
            />
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
        <p className="hint">Wgraj plik Excel, aby zobaczyć zestawienie ilościowo-wartościowe. Dane zostaną zapisane w przeglądarce.</p>
      )}

      {report && excelRows.length > 0 && (
        <div className="summary r14-summary">
          <span>Stan na: <b>{report.asOfDatePl || formatReportTitleDate(asOfDate)}</b></span>
          <span>Przybyło (01.–{report.asOfDatePl?.replace(/r\.$/, '') || '…'}): <b>{Number(report.totals?.purchased_kg || 0).toLocaleString('pl-PL')} kg</b></span>
          <span>Ubyło: <b>{Number(report.totals?.sold_kg || 0).toLocaleString('pl-PL')} kg</b></span>
          <span>Ilość końcowa FIFO: <b>{Number(report.totals?.remaining_kg || 0).toLocaleString('pl-PL')} kg</b> · <b>{formatPlMoney(report.totals?.remaining_value)} zł</b></span>
          {diag && (
            <span className="hint">
              {diag.pzLines} PZ, {diag.wzLines} WZ w pamięci · {diag.linesWithPrice} z ceną
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
                      <td>
                        <b>{row.product_name}</b>
                        {row.product_group ? <small className="hint"> · {row.product_group}</small> : null}
                        {(() => {
                          const audit = productAudits.get(key)
                          if (!audit || row.remaining_kg <= 0.5) return null
                          return (
                            <small className="hint report-audit-hint">
                              {' '}· PZ do daty: {audit.pzKg.toLocaleString('pl-PL')} kg · WZ: {audit.wzKg.toLocaleString('pl-PL')} kg
                            </small>
                          )
                        })()}
                      </td>
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
