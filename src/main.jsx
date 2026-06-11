import React, { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Upload, Database, FileText, Package, Printer, ShieldCheck, AlertTriangle } from 'lucide-react'
import { supabase, isSupabaseConfigured } from './supabaseClient'
import { readAgromarExcel, classifyOperation } from './excelImport'
import './style.css'

const PRODUCTS = [
  ['Malina pulpa', 'Mp'], ['Porzeczka czarna', 'Pcz'], ['Porzeczka czerwona', 'Pk'], ['Truskawka', 'T'],
  ['Truskawka z szypułką', 'Tsz'], ['Aronia', 'A'], ['Śliwka', 'S'], ['Wiśnia', 'W'],
  ['Malina klasa I', 'M1'], ['Malina extra', 'Mex'], ['Jabłko obierka', 'Jo']
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

function StatCard({ icon: Icon, label, value }) {
  return <div className="stat"><Icon size={22}/><div><strong>{value}</strong><span>{label}</span></div></div>
}

function App() {
  const [rows, setRows] = useState([])
  const [fileName, setFileName] = useState('')
  const [message, setMessage] = useState('')

  const filteredRows = useMemo(() => rows.map(r => ({ ...r, operation: classifyOperation(r.documentType, r.documentNo) })), [rows])
  const pzCount = filteredRows.filter(r => r.operation === 'przyjecie').length
  const salesCount = filteredRows.filter(r => r.operation === 'sprzedaz_bez_produkcji').length
  const qtySum = filteredRows.reduce((s, r) => s + (Number(r.qty) || 0), 0)

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

  async function saveToSupabase() {
    if (!supabase) {
      setMessage('Brak konfiguracji Supabase. Uzupełnij plik .env na podstawie .env.example.')
      return
    }
    if (!rows.length) {
      setMessage('Najpierw wczytaj plik Excel.')
      return
    }
    try {
      const { data: imported, error: fileError } = await supabase
        .from('imported_files')
        .insert({ filename: fileName || 'import.xlsx', rows_count: rows.length })
        .select('id')
        .single()
      if (fileError) throw fileError

      for (const row of filteredRows) {
        let contractorId = null
        if (row.contractorName) {
          const { data: contractor, error: cErr } = await supabase
            .from('contractors')
            .upsert({ name: row.contractorName, contractor_type: 'oba' }, { onConflict: 'name' })
            .select('id')
            .single()
          if (cErr) throw cErr
          contractorId = contractor.id
        }

        const { data: op, error: opErr } = await supabase
          .from('operations')
          .insert({
            operation_type: row.operation,
            operation_date: row.issueDate || new Date().toISOString().slice(0, 10),
            document_no: row.documentNo,
            invoice_no: row.invoiceNo,
            contractor_id: contractorId,
            imported_file_id: imported.id,
            notes: row.notes || null
          })
          .select('id')
          .single()
        if (opErr) throw opErr

        const productName = row.productName || 'Produkt do dopasowania'
        const { data: product, error: pErr } = await supabase
          .from('products')
          .upsert({ name: productName, code: productName.slice(0, 3).replace(/\W/g, '') || 'X', product_type: 'surowiec_lub_produkt' }, { onConflict: 'name' })
          .select('id')
          .single()
        if (pErr) throw pErr

        const direction = row.operation === 'przyjecie' ? 'przychod' : 'rozchod'
        const { error: itemErr } = await supabase.from('operation_items').insert({
          operation_id: op.id,
          product_id: product.id,
          qty: row.qty,
          unit: 'kg',
          direction,
          raw_product_name: row.productName
        })
        if (itemErr) throw itemErr
      }
      setMessage('Zapisano import do nowego Supabase HACCP. To jeszcze nie uruchamia pełnego FIFO — to baza pod kolejną wersję.')
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
      <div className="badge"><ShieldCheck size={18}/> Osobny projekt od opakowań</div>
    </header>

    <section className="warning">
      <AlertTriangle size={20}/>
      <div><strong>Ważne:</strong> ta aplikacja ma być podłączona wyłącznie do nowego projektu Supabase <b>AGRO-MAR-HACCP</b>, nigdy do starej bazy opakowań.</div>
    </section>

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

    <section className="two">
      <div className="card"><h2>Produkty i kody partii</h2><div className="chips">{PRODUCTS.map(([n,c]) => <span key={c}>{n} <b>{c}/001/2026</b></span>)}</div></div>
      <div className="card"><h2>Zakładki dokumentów</h2>{DOCS.map(d => <div className="doc" key={d[0]}><b>{d[0]}</b><span>{d[1]}</span><small>{d[2]}</small></div>)}</div>
    </section>
  </div>
}

createRoot(document.getElementById('root')).render(<App />)
