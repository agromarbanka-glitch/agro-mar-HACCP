import React, { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Upload, Database, FileText, Package, Printer, ShieldCheck, AlertTriangle, RefreshCcw, Warehouse } from 'lucide-react'
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
  [normalizeText('Jabłko na obierkę'), 'Jo'],
  [normalizeText('Jabłko obierka'), 'Jo']
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
    .select('id, name, code')
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
      .select('id, name, code')
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
    .insert({ name, code, product_type: 'surowiec_lub_produkt' })
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

async function createIncomingLot(productId, operationId, operationDate, qty) {
  const { data: lotNo, error: lotNoErr } = await supabase.rpc('generate_lot_no', {
    p_product_id: productId,
    p_date: operationDate
  })
  if (lotNoErr) throw lotNoErr

  const { data: lot, error: lotErr } = await supabase
    .from('lots')
    .insert({
      product_id: productId,
      lot_no: lotNo,
      source_operation_id: operationId,
      production_date: operationDate,
      initial_qty: qty,
      remaining_qty: qty,
      unit: 'kg'
    })
    .select('id')
    .single()
  if (lotErr) throw lotErr
  return lot.id
}

async function allocateFifo(operationId, productId, qtyNeeded) {
  let remainingToAllocate = Number(qtyNeeded) || 0
  const allocations = []

  const { data: lots, error } = await supabase
    .from('lots')
    .select('id, remaining_qty, production_date, created_at')
    .eq('product_id', productId)
    .gt('remaining_qty', 0)
    .order('production_date', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error

  for (const lot of lots || []) {
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


  async function loadFifoData() {
    if (!supabase) return
    setLoadingStock(true)
    try {
      const { data: lotsData, error: lotsErr } = await supabase
        .from('lots')
        .select('id, lot_no, production_date, initial_qty, remaining_qty, status, products(name, code)')
        .order('production_date', { ascending: true })
        .order('created_at', { ascending: true })
      if (lotsErr) throw lotsErr

      const { data: allocationsData, error: allocErr } = await supabase
        .from('fifo_allocations')
        .select('id, qty, products(name, code), lots(lot_no), operations(document_no, operation_date)')
        .order('created_at', { ascending: false })
        .limit(80)
      if (allocErr) throw allocErr

      setStockRows(lotsData || [])
      setFifoRows(allocationsData || [])
    } catch (err) {
      setMessage(`Błąd odczytu stanów FIFO: ${err.message}`)
    } finally {
      setLoadingStock(false)
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

    setMessage('Trwa import. Nie klikaj ponownie przycisku zapisu...')

    try {
      const productCache = new Map()
      const contractorCache = new Map()
      const groups = groupImportRows(filteredRows)
      const existingKeys = await getExistingOperationKeys(groups)
      const groupsToImport = groups.filter(g => !existingKeys.has(`${g.operation}|${g.documentNo}`))
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
      let fifoAllocations = 0
      let shortageCount = 0
      let shortageKg = 0

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
          let lotId = null

          const { data: item, error: itemErr } = await supabase
            .from('operation_items')
            .insert({
              operation_id: op.id,
              product_id: productId,
              qty: row.qty,
              unit: 'kg',
              direction,
              raw_product_name: row.productName
            })
            .select('id')
            .single()
          if (itemErr) throw itemErr
          importedItems += 1

          if (direction === 'przychod') {
            lotId = await createIncomingLot(productId, op.id, group.issueDate, row.qty)
            createdLots += 1
            const { error: itemLotErr } = await supabase
              .from('operation_items')
              .update({ lot_id: lotId })
              .eq('id', item.id)
            if (itemLotErr) throw itemLotErr
          } else {
            const result = await allocateFifo(op.id, productId, row.qty)
            fifoAllocations += result.allocations.length
            if (result.shortage > 0) {
              shortageCount += 1
              shortageKg += result.shortage
            }
          }
        }
      }

      setMessage(
        `Import zakończony. Zaimportowano dokumentów: ${importedOperations}, pozycji: ${importedItems}, utworzono partii: ${createdLots}, rozliczeń FIFO: ${fifoAllocations}. Pominięto duplikatów: ${duplicateCount}.` +
        (shortageCount ? ` Uwaga: brakło towaru FIFO w ${shortageCount} pozycjach, razem ${shortageKg.toLocaleString('pl-PL')} kg.` : '')
      )
      await loadFifoData()
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

    <section className="card">
      <div className="section-title"><Warehouse/><div><h2>Stany partii i FIFO</h2><p>Podgląd pozostałych kilogramów z PZ oraz ostatnich rozliczeń WZ/FV według FIFO.</p></div></div>
      <div className="actions"><button className="secondary" onClick={loadFifoData} disabled={loadingStock}><RefreshCcw size={16}/> {loadingStock ? 'Odświeżanie...' : 'Odśwież stany FIFO'}</button></div>
      <div className="summary">
        <span>Partie: <b>{stockRows.length}</b></span>
        <span>Pozostało kg: <b>{stockRows.reduce((s, l) => s + (Number(l.remaining_qty) || 0), 0).toLocaleString('pl-PL')}</b></span>
        <span>Rozliczenia FIFO: <b>{fifoRows.length}</b></span>
      </div>
      {stockRows.length > 0 && <div className="table-wrap small"><table>
        <thead><tr><th>Produkt</th><th>Kod</th><th>Partia</th><th>Data</th><th>Ilość pocz.</th><th>Pozostało</th><th>Status</th></tr></thead>
        <tbody>{stockRows.slice(0, 120).map(l => <tr key={l.id}>
          <td>{l.products?.name}</td><td>{l.products?.code}</td><td>{l.lot_no}</td><td>{l.production_date}</td><td>{Number(l.initial_qty || 0).toLocaleString('pl-PL')}</td><td><b>{Number(l.remaining_qty || 0).toLocaleString('pl-PL')}</b></td><td><span className="pill">{l.status}</span></td>
        </tr>)}</tbody>
      </table></div>}
      {fifoRows.length > 0 && <><h3>Ostatnie rozliczenia FIFO</h3><div className="table-wrap small"><table>
        <thead><tr><th>WZ/FV</th><th>Data</th><th>Produkt</th><th>Partia PZ</th><th>Ilość zdjęta</th></tr></thead>
        <tbody>{fifoRows.map(a => <tr key={a.id}>
          <td>{a.operations?.document_no}</td><td>{a.operations?.operation_date}</td><td>{a.products?.name}</td><td>{a.lots?.lot_no}</td><td>{Number(a.qty || 0).toLocaleString('pl-PL')}</td>
        </tr>)}</tbody>
      </table></div></>}
    </section>

    <section className="two">
      <div className="card"><h2>Produkty i kody partii</h2><div className="chips">{PRODUCTS.map(([n,c]) => <span key={c}>{n} <b>{c}/001/2026</b></span>)}</div></div>
      <div className="card"><h2>Zakładki dokumentów</h2>{DOCS.map(d => <div className="doc" key={d[0]}><b>{d[0]}</b><span>{d[1]}</span><small>{d[2]}</small></div>)}</div>
    </section>
  </div>
}

createRoot(document.getElementById('root')).render(<App />)
