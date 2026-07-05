import React, { useMemo, useState } from 'react'
import { Printer } from 'lucide-react'
import * as XLSX from 'xlsx'
import {
  R09_ENGINE_VERSION, loadR09Range, saveR09Range, aggregateR04ForTrend,
  buildR09PrintHtml, buildR09ExcelRows, formatR09Period, formatR09PeriodFooter,
  monthLabelPl, R09_MONTH_COLORS
} from './r09Engine'

function trapDisplayLabel(label) {
  const n = String(label).replace(/\D/g, '')
  return n || label
}

function monthColor(i) {
  return R09_MONTH_COLORS[i % R09_MONTH_COLORS.length]
}

function R09DataTable({ kind, trend }) {
  const stations = kind === 'derat' ? trend.deratStations : trend.trapStations
  const rowHeader = kind === 'derat' ? 'nr stacji deratyzacyjnej' : 'nr pułapki żywołownej'
  return (
    <table className="r09-data-table">
      <thead>
        <tr>
          <th rowSpan={2}>{rowHeader}</th>
          <th colSpan={Math.max(trend.months.length, 1)}>ilość gryzoni</th>
        </tr>
        <tr>
          {trend.months.length
            ? trend.months.map(mk => <th key={mk}>{monthLabelPl(mk)}</th>)
            : <th>—</th>}
        </tr>
      </thead>
      <tbody>
        {stations.map(st => {
          const label = kind === 'trap' ? trapDisplayLabel(st.label) : st.label
          return (
            <tr key={`${kind}-${st.label}`}>
              <td>{label}</td>
              {trend.months.length
                ? trend.months.map(mk => (
                  <td key={mk}>{trend.getValue(kind, st.label, mk)}</td>
                ))
                : <td>0</td>}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function R09BarChart({ kind, trend }) {
  const stations = kind === 'derat' ? trend.deratStations : trend.trapStations
  const maxY = kind === 'derat' ? trend.chartMaxDerat : trend.chartMaxTrap
  const xLabel = kind === 'derat' ? 'STACJA DERATYZACYJNA' : 'nr pułapki żywołownej'
  const title = kind === 'derat'
    ? `Statystyka aktywności gryzoni w stacjach deratyzacyjnych na terenie firmy AGRO-MAR Mariusz Bańka Sp. z o.o. za okres ${formatR09Period(trend.dateFrom, trend.dateTo)}`
    : `Statystyka aktywności gryzoni w pułapkach żywołownych na terenie firmy AGRO-MAR Mariusz Bańka Sp. z o.o. za okres ${formatR09Period(trend.dateFrom, trend.dateTo)}`
  const total = kind === 'derat' ? trend.totalDerat : trend.totalTrap
  const footerZero = kind === 'trap'
    ? `na terenie firmy AGRO-MAR Mariusz Bańka Sp. z o.o. w okresie ${formatR09PeriodFooter(trend.dateFrom, trend.dateTo)} nie odnotowano gryzoni w pułapkach żywołownych`
    : ''
  const yTicks = Array.from({ length: maxY + 1 }, (_, i) => maxY - i)

  return (
    <div className="r09-chart-block">
      <h3 className="r09-chart-title">{title}</h3>
      <div className="r09-chart-area">
        <div className="r09-y-title">ILOŚĆ GRYZONI</div>
        <div className="r09-chart-inner">
          <div className="r09-y-axis">
            {yTicks.map(v => <div key={v} className="r09-y-tick"><span>{v}</span></div>)}
          </div>
          <div className="r09-plot">
            {stations.map(st => {
              const label = kind === 'trap' ? trapDisplayLabel(st.label) : st.label
              return (
                <div key={st.label} className="r09-bar-group">
                  <div className="r09-bars">
                    {trend.months.length ? trend.months.map((mk, mi) => {
                      const v = trend.getValue(kind, st.label, mk)
                      const h = maxY ? (v / maxY) * 100 : 0
                      return (
                        <div
                          key={mk}
                          className="r09-bar"
                          style={{ height: `${h}%`, background: monthColor(mi) }}
                          title={`${monthLabelPl(mk)}: ${v}`}
                        />
                      )
                    }) : <div className="r09-bar r09-bar-empty" />}
                  </div>
                  <div className="r09-x-label">{label}</div>
                </div>
              )
            })}
          </div>
        </div>
        <div className="r09-x-title">{xLabel}</div>
        <div className="r09-legend">
          {trend.months.map((mk, i) => (
            <span key={mk} className="r09-legend-item">
              <i style={{ background: monthColor(i) }} />{monthLabelPl(mk)}
            </span>
          ))}
        </div>
      </div>
      {footerZero && total === 0 && <p className="r09-chart-footer">{footerZero}</p>}
    </div>
  )
}

export function R09TrendSection({ haccpDocs, escapeHtml, printHtmlInIframe }) {
  const init = loadR09Range()
  const [dateFrom, setDateFrom] = useState(init.dateFrom)
  const [dateTo, setDateTo] = useState(init.dateTo)

  const r04Docs = useMemo(() => (haccpDocs || []).filter(d => d.document_type === 'R04'), [haccpDocs])
  const trend = useMemo(() => {
    saveR09Range(dateFrom, dateTo)
    return aggregateR04ForTrend(r04Docs, dateFrom, dateTo)
  }, [r04Docs, dateFrom, dateTo])

  function printReport() {
    printHtmlInIframe(buildR09PrintHtml(trend, escapeHtml))
  }

  function exportExcel() {
    const rows = buildR09ExcelRows(trend)
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = (rows[rows.length - 1] || []).map(() => ({ wch: 18 }))
    XLSX.utils.book_append_sheet(wb, ws, 'R09')
    XLSX.writeFile(wb, `R09_trend_${dateFrom}_${dateTo}.xlsx`)
  }

  return (
    <>
      <div className="card inner-card no-print r09-range-panel">
        <h3>Trend aktywności szkodników (R09) – na podstawie kartoteki R04</h3>
        <p className="hint">Wybierz zakres dat – tabele i wykresy budują się automatycznie z kontroli R04 (pole „Obecność gryzoni”).</p>
        <div className="k03-bulk-row">
          <label>Data od<input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></label>
          <label>Data do<input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} /></label>
          <button type="button" className="secondary" onClick={printReport}><Printer size={16}/> Drukuj / PDF</button>
          <button type="button" className="secondary" onClick={exportExcel}>Pobierz Excel</button>
        </div>
        <p className="hint">
          Kontrole R04 w zakresie: <b>{trend.controlsCount}</b> · Okres: <b>{formatR09Period(dateFrom, dateTo)}</b> · Silnik R09: {R09_ENGINE_VERSION}
        </p>
        {!trend.controlsCount && <p className="hint">Brak kontroli R04 w wybranym zakresie – utwórz kartotekę R04 i uzupełnij kontrole.</p>}
      </div>
      <div className="monthly-paper r09-paper">
        <div className="r09-tables-row">
          <R09DataTable kind="derat" trend={trend} />
          <R09DataTable kind="trap" trend={trend} />
        </div>
        <R09BarChart kind="derat" trend={trend} />
        <R09BarChart kind="trap" trend={trend} />
      </div>
    </>
  )
}
