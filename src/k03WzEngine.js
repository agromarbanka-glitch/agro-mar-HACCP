/**
 * K03/WZ – kolejka WZ, decyzja przerób/brak przerobu, historia.
 */
import {
  loadK03Forms,
  loadK03Snapshots,
  mergeK03Snapshots,
  buildK03FormDoc,
  saveK03Snapshot,
  applyK03DocEdits,
  inferProductCode,
  inferK03LotCode,
  productGroupForName,
  K03_ENGINE_VERSION
} from './k03Engine'
import { previewFifoForSale, persistFifoForSale, revertFifoForSale } from './fifoEngine'
import { operationImportKey } from './importSaveEngine'

export const K03_WZ_ENGINE_VERSION = '1.3'

function fifoOptionsFromWorkflow(workflow = {}, options = {}) {
  const keys = options.fifoSourceKeys || options.fifo_source_keys || workflow.fifo_source_keys
  return keys?.length ? { fifoSourceKeys: keys } : {}
}

function wzMonthKey(dateStr) {
  return String(dateStr || '').slice(0, 7)
}

async function resyncK03Line(client, line, changedBy, logReason = 'Synchronizacja K03 z FIFO') {
  if (line.status === 'pending') return { skipped: 'pending' }
  if (line.frozen || line.status === 'frozen') return { skipped: 'frozen' }
  if (!line.operation_id || !line.product_id) throw new Error('Brak powiązania WZ z bazą.')

  const mode = line.workflow?.mode || 'bez_przerobu'
  const przerobDate = String(line.workflow?.przerob_date || line.workflow?.fifo_cutoff_date || '').slice(0, 10)
  const wzDate = String(line.wz_date || '').slice(0, 10)
  const cutoffDate = mode === 'przerob' ? przerobDate : wzDate
  if (!cutoffDate || cutoffDate === '0000-01-01') throw new Error('Brak daty granicznej (WZ / przerób).')
  if (mode === 'przerob' && !przerobDate) throw new Error('Brak daty przerobu w zapisie K03.')

  const k03Key = line.formId || `K03-${line.key}`
  const fifoOpts = fifoOptionsFromWorkflow(line.workflow, options)
  const fifoResult = await persistFifoForSale(client, line.operation_id, line.product_id, cutoffDate, {
    k03_key: k03Key,
    change_type: 'k03_resync_fifo',
    change_reason: logReason,
    changed_by: changedBy,
    ...fifoOpts
  })

  const productMap = new Map()
  if (line.product_id) {
    productMap.set(line.product_id, { name: line.product_name, product_group: line.product_group })
  }

  const workflow = line.workflow || {
    mode,
    przerob_date: mode === 'przerob' ? przerobDate : null,
    fifo_cutoff_date: cutoffDate
  }

  const existingEdits = line.k03Form?.data?.k03_edits || {}
  const preservedLotNo = existingEdits.lot_no ?? line.k03Form?.lot_no ?? workflow.lot_no ?? ''

  let doc = buildK03FormDoc(
    {
      key: line.key,
      operation_id: line.operation_id,
      product_id: line.product_id,
      raw_product_name: line.product_name,
      qty: line.qty,
      op: { document_no: line.document_no, operation_date: line.wz_date, contractor_id: null }
    },
    fifoResult.pzRows,
    productMap,
    new Map(),
    'baza',
    { fifoCutoffDate: cutoffDate, workflow, lotNo: preservedLotNo }
  )

  const saleQty = Number(line.qty || 0)
  const rawTotal = fifoResult.pzRows.reduce((s, r) => s + Number(r.qty || 0), 0)
  const shortage = Number(fifoResult.shortage || 0)
  const mismatch = shortage > 0.0005 || Math.abs(rawTotal - saleQty) >= 0.001

  doc = applyK03DocEdits({
    ...doc,
    lot_no: preservedLotNo || doc.lot_no,
    signed_by_operator: line.k03Form?.signed_by_operator || '',
    status: mismatch ? 'N' : 'P',
    data: {
      ...doc.data,
      shortage,
      rawTotal,
      quantitiesMatch: !mismatch,
      k03_workflow: workflow,
      k03_edits: existingEdits
    }
  }, {
    lot_no: existingEdits.lot_no,
    wz_date: existingEdits.wz_date,
    rawRowPatches: existingEdits.rawRowPatches
  })

  const canAutoFreeze = isK03CompleteAndValid(doc)
  await saveK03Snapshot(client, doc, { freeze: canAutoFreeze, userRole: changedBy })
  return { ok: true, autoFrozen: canAutoFreeze, doc, shortage }
}

/** K03 kompletny i prawidłowy – można zamrozić automatycznie. */
export function isK03CompleteAndValid(doc) {
  if (!doc) return false
  const shortage = Number(doc.data?.shortage || 0)
  if (shortage > 0.0005) return false
  if (doc.data?.invalidFuturePz === true) return false
  if (doc.data?.k03_workflow?.quantity_warning_accepted === true) return false
  if (doc.status === 'N') return false
  const saleQty = Number(doc.qty || doc.data?.saleQty || 0)
  const rawTotal = Number(doc.data?.rawTotal || 0)
  if (Math.abs(rawTotal - saleQty) >= 0.001) return false
  return true
}

function normalizeDocNo(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '')
}

function importGroupTouchesProduct(importGroup, snapProductName, snapGroup) {
  const items = importGroup?.items || []
  if (!items.length) return false
  const snapKey = normalizeKey(snapProductName)
  return items.some(item => {
    const name = item?.productName
    if (!name) return false
    if (normalizeKey(name) === snapKey) return true
    return productGroupForName(name) === snapGroup
  })
}

function isNewImportGroup(group, existingOpKeys) {
  if (!existingOpKeys?.size) return true
  return !existingOpKeys.has(operationImportKey(group))
}

/**
 * Po imporcie Excel sugeruje zamrożone K03, które mogą wymagać odmrożenia.
 * Uwzględnia tylko **nowe** dokumenty z pliku (pomija duplikaty już w bazie).
 */
export async function suggestFrozenK03UnfreezeAfterImport(client, importGroups = [], options = {}) {
  const existingOpKeys = options.existingOpKeys || new Set()
  const newGroups = (importGroups || []).filter(g => isNewImportGroup(g, existingOpKeys))
  if (!client || !newGroups.length) return []

  const snapshots = await loadK03Snapshots(client)
  const frozen = (snapshots || []).filter(s => s.data?.frozen === true)
  if (!frozen.length) return []

  const newPz = newGroups.filter(g => g.operation === 'przyjecie')
  const newSales = newGroups.filter(g => g.operation === 'sprzedaz')
  const suggestions = []

  for (const snap of frozen) {
    const reasons = []
    const group = snap.data?.product_group || productGroupForName(snap.product_name)
    const cutoff = String(
      snap.data?.fifo_cutoff_date ||
      snap.data?.k03_workflow?.fifo_cutoff_date ||
      snap.document_date ||
      ''
    ).slice(0, 10)
    const wzDate = String(snap.document_date || '').slice(0, 10)
    const frozenWzNo = normalizeDocNo(snap.document_no)
    const frozenPzNos = new Set(
      (snap.data?.rawRows || [])
        .map(r => normalizeDocNo(r.pz_no))
        .filter(Boolean)
    )

    for (const pz of newPz) {
      if (!importGroupTouchesProduct(pz, snap.product_name, group)) continue
      const pzDate = String(pz.issueDate || '').slice(0, 10)
      const docNo = normalizeDocNo(pz.documentNo)

      if (docNo && frozenPzNos.has(docNo)) {
        reasons.push(`nowy import PZ ${pz.documentNo} (możliwa zmiana daty lub ilości)`)
      } else if (pzDate && cutoff && pzDate <= cutoff) {
        reasons.push(`nowe PZ ${pz.documentNo || '?'} z ${pzDate} przed datą graniczną ${cutoff}`)
      }
    }

    for (const sale of newSales) {
      if (!importGroupTouchesProduct(sale, snap.product_name, group)) continue
      const saleDate = String(sale.issueDate || '').slice(0, 10)
      const saleDocNo = normalizeDocNo(sale.documentNo)
      if (saleDocNo && frozenWzNo && saleDocNo === frozenWzNo) continue
      if (saleDate && wzDate && saleDate <= wzDate) {
        reasons.push(`nowa sprzedaż ${sale.documentNo || '?'} z ${saleDate} przed WZ ${snap.document_no || wzDate}`)
      }
    }

    const uniqueReasons = [...new Set(reasons)].slice(0, 3)
    if (!uniqueReasons.length) continue

    suggestions.push({
      k03_key: snap.data?.k03_key || snap.data?.form_id,
      wz_no: snap.document_no || '',
      product_name: snap.product_name || '',
      lot_no: snap.lot_no || '',
      wz_date: wzDate,
      frozen_at: snap.data?.frozen_at || snap.updated_at,
      reasons: uniqueReasons,
      snap
    })
  }

  return suggestions.sort((a, b) =>
    String(b.wz_date || '').localeCompare(String(a.wz_date || '')) ||
    String(a.wz_no || '').localeCompare(String(b.wz_no || ''))
  )
}

export function wzStatusLabel(status) {
  const map = {
    pending: 'Oczekuje',
    k03_ready: 'K03 gotowy',
    legacy_auto: 'K03 (auto)',
    frozen: 'Zamrożony'
  }
  return map[status] || status
}

function suggestLotNo(existingForms, productName, productId, productMap, referenceDate, options = {}) {
  const year = String(referenceDate || '').slice(0, 4) || String(new Date().getFullYear())
  const product = productMap?.get?.(productId)
  const code = inferK03LotCode(productName, product, options)
  const sameProduct = (existingForms || []).filter(f =>
    (f.data?.product_id === productId || normalizeKey(f.product_name) === normalizeKey(productName)) &&
    String(f.lot_no || '').includes(`/${year}`)
  )
  const seq = sameProduct.length + 1
  return `${code}/${String(seq).padStart(3, '0')}/${year}`
}

/** Proponowany numer partii wyrobu gotowego dla K03 (przerób). */
export function suggestK03LotNo(existingForms, line, referenceDate, options = {}) {
  const productMap = new Map()
  if (line?.product_id) {
    productMap.set(line.product_id, { name: line.product_name, product_group: line.product_group })
  }
  const mode = options.mode || line?.workflow?.mode || 'przerob'
  return suggestLotNo(existingForms, line?.product_name, line?.product_id, productMap, referenceDate, { mode })
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase()
}

function resolveWzStatus(form, snap) {
  const frozen = snap?.data?.frozen === true
  const hasWorkflow = Boolean(snap?.data?.k03_workflow)
  const hasSnapshot = Boolean(snap)
  const hasAllocations = (form.data?.rawRows || []).some(r => !r.isShortage && Number(r.qty || 0) > 0)

  if (frozen) return 'frozen'
  if (hasWorkflow || (hasSnapshot && snap?.data?.rawRows?.length)) return 'k03_ready'
  if (hasAllocations) return 'legacy_auto'
  return 'pending'
}

async function logK03Workflow(client, entry) {
  try {
    await client.from('fifo_allocation_change_log').insert({
      wz_no: entry.wz_no || '',
      wz_date: entry.wz_date || null,
      product_name: entry.product_name || '',
      k03_key: entry.k03_key || '',
      change_type: entry.change_type || 'k03_workflow',
      before_data: entry.before_data || null,
      after_data: entry.after_data || null,
      change_reason: entry.change_reason || '',
      changed_by: entry.changed_by || 'operator'
    })
  } catch {
    // v34 migration may be missing
  }
}

/** Ładuje kolejkę WZ z statusem K03. */
export async function loadWzQueue(client) {
  if (!client) {
    return { lines: [], diag: {}, message: 'Brak połączenia z bazą.', snapshots: [] }
  }

  const [{ forms, diag, message }, snapshots] = await Promise.all([
    loadK03Forms(client),
    loadK03Snapshots(client)
  ])

  const snapByKey = new Map()
  for (const snap of snapshots) {
    const k = snap.data?.k03_key || snap.data?.form_id
    if (k) snapByKey.set(k, snap)
  }

  const mergedForms = mergeK03Snapshots(forms, snapshots)
  const productMap = new Map()
  for (const f of mergedForms) {
    if (f.data?.product_id) {
      productMap.set(f.data.product_id, { name: f.product_name, code: null, product_group: f.product_group })
    }
  }

  const lines = mergedForms.map(form => {
    const snap = snapByKey.get(form.id)
    const status = resolveWzStatus(form, snap)
    const showForm = status !== 'pending'
    return {
      key: form.id.replace(/^K03-/, ''),
      formId: form.id,
      operation_id: form.data?.sale_operation_id,
      product_id: form.data?.product_id,
      product_name: form.product_name,
      product_group: form.product_group || form.data?.product_group,
      document_no: form.document_no,
      wz_date: form.document_date,
      qty: Number(form.qty || 0),
      receiver: form.data?.odbiorca || '',
      status,
      frozen: status === 'frozen' || form.frozen === true,
      workflow: snap?.data?.k03_workflow || form.data?.k03_workflow || null,
      k03Form: showForm ? form : null,
      haccp_doc_id: snap?.id || form.haccp_doc_id || null
    }
  })

  return {
    lines,
    forms: lines.filter(l => l.k03Form).map(l => l.k03Form),
    diag,
    message,
    snapshots,
    productMap
  }
}

function validatePrzerobDate(mode, przerobDate, wzDate) {
  if (mode !== 'przerob') return null
  if (!przerobDate) return 'Podaj datę przerobu.'
  if (wzDate && przerobDate > wzDate) {
    return `Data przerobu (${przerobDate}) nie może być późniejsza niż data WZ (${wzDate}) – towar wyjechał najpóźniej w dniu sprzedaży.`
  }
  return null
}

function formatPostCutoffStockHint(remainingKg, cutoffDate, wzDate) {
  if (Number(remainingKg || 0) <= 0.5) return ''
  const wzNote = wzDate && cutoffDate !== wzDate ? ` (data WZ: ${wzDate})` : ''
  return ` W magazynie jest ${Number(remainingKg).toLocaleString('pl-PL')} kg PZ z datą po ${cutoffDate}${wzNote} – nie wchodzą do tego WZ. Jeśli towar był na magazynie wcześniej, popraw datę przyjęcia w zakładce PZ/FIFO (nie datę przerobu).`
}

function formatFifoDiagnosticNote(diag, cutoffDate, wzDate) {
  if (!diag) return ''
  let note = ''
  if (Number(diag.lotCountInGroup || 0) === 0) {
    note += ' Brak partii PZ dla tej grupy asortymentowej w bazie – sprawdź import (czy PZ truskawki zostały zapisane).'
  } else if (Number(diag.purchasedTotalKg || 0) > 0 && Number(diag.purchasedWithinCutoffKg || 0) <= 0) {
    note += ` W bazie jest ${Number(diag.purchasedTotalKg).toLocaleString('pl-PL')} kg PZ (${diag.lotCountInGroup} partii), ale żadna partia nie ma daty ≤ ${cutoffDate}.`
  }
  if (Number(diag.lotsMissingDateKg || 0) > 0.5) {
    note += ` ${Number(diag.lotsMissingDateKg).toLocaleString('pl-PL')} kg PZ bez poprawnej daty przyjęcia – uzupełnij datę w PZ/FIFO.`
  }
  if (Number(diag.remainingAfterCutoffKg || 0) > 0.5) {
    note += formatPostCutoffStockHint(diag.remainingAfterCutoffKg, cutoffDate, wzDate)
  }
  if ((diag.priorUnallocatedWzCount || 0) > 0) {
    note += ` ${diag.priorUnallocatedWzCount} wcześniejszych WZ (${Number(diag.priorUnallocatedWzKg || 0).toLocaleString('pl-PL')} kg) nie ma pełnego rozliczenia FIFO – rozlicz je najpierw (kolejność od najstarszej daty WZ).`
  }
  const soldBefore = Number(diag.soldBeforeTargetKg || 0)
  const pzCutoff = Number(diag.purchasedWithinCutoffKg || 0)
  const targetQty = Number(diag.targetSaleQty || 0)
  if (soldBefore > 0 && pzCutoff > 0 && soldBefore + targetQty > pzCutoff + 0.5) {
    note += ` Do ${cutoffDate} wcześniejsza sprzedaż tej grupy: ${soldBefore.toLocaleString('pl-PL')} kg + ta WZ ${targetQty.toLocaleString('pl-PL')} kg = ${(soldBefore + targetQty).toLocaleString('pl-PL')} kg, a PZ ≤ ${cutoffDate} to ${pzCutoff.toLocaleString('pl-PL')} kg.`
  }
  if (Number(diag.remainingWithinCutoffAfterReserveKg || 0) <= 0.5 &&
      Number(diag.purchasedWithinCutoffKg || 0) > 0 &&
      (diag.priorUnallocatedWzCount || 0) > 0) {
    note += ' Wcześniejsze WZ bez K03 rezerwują cały dostępny surowiec – rozlicz je po kolei od najstarszej daty.'
  }
  if (Number(diag.purchasedTotalKg || 0) > 0 && Number(diag.soldTotalKg || 0) > 0) {
    const delta = Math.round((Number(diag.purchasedTotalKg) - Number(diag.soldTotalKg)) * 1000) / 1000
    if (Math.abs(delta) >= 1) {
      note += ` Bilans grupy: zakup ${Number(diag.purchasedTotalKg).toLocaleString('pl-PL')} kg vs sprzedaż ${Number(diag.soldTotalKg).toLocaleString('pl-PL')} kg (różnica ${delta > 0 ? '+' : ''}${delta.toLocaleString('pl-PL')} kg).`
    }
  }
  return note
}

/** Podgląd FIFO przed zatwierdzeniem K03. */
export async function previewK03Workflow(client, line, options = {}) {
  const mode = options.mode || 'przerob'
  const wzDate = String(line.wz_date || '').slice(0, 10)
  const przerobDate = String(options.przerobDate || '').slice(0, 10)
  const cutoffDate = mode === 'przerob' ? przerobDate : wzDate

  const dateErr = validatePrzerobDate(mode, przerobDate, wzDate)
  if (dateErr) return { ok: false, error: dateErr }

  const fifoOpts = fifoOptionsFromWorkflow(line.workflow, options)
  return previewFifoForSale(client, line.operation_id, line.product_id, cutoffDate, fifoOpts)
}

/** Generuje K03 po decyzji użytkownika (przerób / brak przerobu). */
export async function generateK03Workflow(client, line, options = {}) {
  const mode = options.mode || 'przerob'
  const wzDate = String(line.wz_date || '').slice(0, 10)
  const przerobDate = String(options.przerobDate || '').slice(0, 10)
  const cutoffDate = mode === 'przerob' ? przerobDate : wzDate
  const acceptQuantityMismatch = options.acceptQuantityMismatch === true
  const changedBy = options.changedBy || 'operator'
  const k03Key = line.formId || `K03-${line.key}`

  if (line.frozen) throw new Error('K03 jest zamrożony – najpierw odmroź kartotekę.')
  const dateErr = validatePrzerobDate(mode, przerobDate, wzDate)
  if (dateErr) throw new Error(dateErr)

  const fifoOpts = fifoOptionsFromWorkflow(line.workflow, options)
  const onProgress = options.onProgress
  onProgress?.('fifo_preview')
  const preview = options.existingPreview?.ok &&
    String(options.existingPreview.cutoffDate || '').slice(0, 10) === cutoffDate
    ? options.existingPreview
    : await previewFifoForSale(client, line.operation_id, line.product_id, cutoffDate, fifoOpts)
  if (!preview.ok) throw new Error(preview.error || 'Błąd podglądu FIFO.')

  const rawTotal = preview.pzRows.reduce((s, r) => s + Number(r.qty || 0), 0)
  const saleQty = preview.saleQty
  const shortage = Number(preview.shortage || 0)
  const mismatch = Math.abs(rawTotal - saleQty) >= 0.001 || shortage > 0

  if (mismatch && !acceptQuantityMismatch) {
    const futureNote = Number(preview.excludedFuturePzQty || 0) > 0
      ? ` PZ z datą późniejszą niż ${cutoffDate} (${Number(preview.excludedFuturePzQty).toLocaleString('pl-PL')} kg) nie są przypisywane.`
      : ''
    const diag = preview.diagnostics || {}
    const diagNote = formatFifoDiagnosticNote(diag, cutoffDate, wzDate)
    return {
      ok: false,
      needConfirm: true,
      preview,
      message: `Brak wystarczającego surowca na dzień ${cutoffDate}: WZ ${saleQty.toLocaleString('pl-PL')} kg, przypisano PZ ${rawTotal.toLocaleString('pl-PL')} kg${shortage > 0 ? `, brakuje ${shortage.toLocaleString('pl-PL')} kg` : ''}.${futureNote}${diagNote}`
    }
  }

  const fifoResult = await persistFifoForSale(client, line.operation_id, line.product_id, cutoffDate, {
    k03_key: k03Key,
    change_type: mode === 'przerob' ? 'k03_created_przerob' : 'k03_created_bez_przerobu',
    change_reason: options.reason || (mode === 'przerob' ? 'Utworzenie K03 po przerobie' : 'Utworzenie K03 – brak przerobu'),
    changed_by: changedBy,
    ...fifoOpts
  })
  onProgress?.('k03_save')

  const { forms } = await loadK03Forms(client)
  const baseForm = forms.find(f => f.id === k03Key)
  if (!baseForm) throw new Error('Nie znaleziono pozycji WZ po zapisie FIFO.')

  const productMap = new Map()
  if (line.product_id) productMap.set(line.product_id, { name: line.product_name, product_group: line.product_group })

  const lotNo = String(options.lotNo || '').trim() ||
    suggestLotNo(forms, line.product_name, line.product_id, productMap, mode === 'przerob' ? przerobDate : wzDate, { mode })

  const fifoSourceKeys = options.fifoSourceKeys || options.fifo_source_keys || null
  const workflow = {
    mode,
    przerob_date: mode === 'przerob' ? przerobDate : null,
    fifo_cutoff_date: cutoffDate,
    raw_stored: mode === 'bez_przerobu' ? options.rawStored === true : null,
    skip_k04_k06: mode === 'bez_przerobu',
    lot_no: lotNo,
    lot_no_manual: Boolean(String(options.lotNo || '').trim()),
    fifo_source_keys: fifoSourceKeys?.length ? [...fifoSourceKeys] : null,
    quantity_warning_accepted: mismatch,
    created_at: line.workflow?.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    created_by: line.workflow?.created_by || changedBy,
    updated_by: changedBy,
    engine_version: K03_WZ_ENGINE_VERSION
  }

  const emptyContractors = new Map()
  let doc = buildK03FormDoc(
    {
      key: line.key,
      operation_id: line.operation_id,
      product_id: line.product_id,
      raw_product_name: line.product_name,
      qty: line.qty,
      op: { document_no: line.document_no, operation_date: line.wz_date, contractor_id: null }
    },
    fifoResult.pzRows,
    productMap,
    emptyContractors,
    'baza',
    { fifoCutoffDate: cutoffDate, workflow, lotNo }
  )

  doc = {
    ...doc,
    lot_no: lotNo,
    status: mismatch ? 'N' : 'P',
    data: {
      ...doc.data,
      shortage,
      rawTotal,
      quantitiesMatch: !mismatch,
      quantity_warning_accepted: mismatch && acceptQuantityMismatch
    }
  }

  const canAutoFreeze = isK03CompleteAndValid(doc)
  await saveK03Snapshot(client, doc, { freeze: canAutoFreeze, userRole: changedBy })

  await logK03Workflow(client, {
    wz_no: line.document_no,
    wz_date: wzDate,
    product_name: line.product_name,
    k03_key: k03Key,
    change_type: mismatch ? 'k03_quantity_warning_accepted' : (mode === 'przerob' ? 'k03_created_przerob' : 'k03_created_bez_przerobu'),
    after_data: { workflow, sale_qty: saleQty, raw_total: rawTotal, shortage, auto_frozen: canAutoFreeze },
    change_reason: options.reason || workflow.mode,
    changed_by: changedBy
  })

  if (canAutoFreeze) {
    doc = { ...doc, frozen: true, data: { ...doc.data, frozen: true, frozen_at: new Date().toISOString() } }
    await logK03Workflow(client, {
      wz_no: line.document_no,
      wz_date: wzDate,
      product_name: line.product_name,
      k03_key: k03Key,
      change_type: 'k03_frozen',
      change_reason: 'Automatyczne zamrożenie – kompletny i prawidłowy K03',
      changed_by: changedBy
    })
  }

  return { ok: true, doc, workflow, fifoResult, autoFrozen: canAutoFreeze }
}

/**
 * Zmiana decyzji przerób / brak przerobu dla istniejącego K03.
 * Odmraża zamrożoną kartotekę, cofa FIFO i generuje K03 od nowa.
 */
export async function changeK03Workflow(client, line, options = {}) {
  const changedBy = options.changedBy || 'operator'
  const reason = options.reason || 'Zmiana decyzji przerób / brak przerobu'
  const onProgress = options.onProgress
  const wasFrozen = line.frozen || line.status === 'frozen'

  onProgress?.('unfreeze')
  if (wasFrozen) {
    const doc = line.k03Form
    if (!doc?.id) throw new Error('Brak dokumentu K03 do odmrożenia.')
    await unfreezeK03Workflow(client, doc, reason, changedBy)
  }

  onProgress?.('fifo_revert')
  await revertFifoForSale(client, line.operation_id, line.product_id, {
    k03_key: line.formId || `K03-${line.key}`,
    change_type: 'k03_change_decision',
    change_reason: reason,
    changed_by: changedBy
  })

  onProgress?.('fifo_save')
  const freshLine = { ...line, frozen: false, status: line.status === 'pending' ? line.status : 'k03_ready' }
  return generateK03Workflow(client, freshLine, { ...options, changedBy, reason, onProgress })
}

/**
 * Przelicza otwarte (niezamrożone) K03 wg aktualnych reguł FIFO i daty granicznej.
 * Zamrożone K03 pomija – wymagają ręcznego odmrożenia.
 */
export async function resyncOpenK03FromFifo(client, options = {}) {
  const changedBy = options.changedBy || 'operator'
  const { lines } = await loadWzQueue(client)
  const results = { updated: 0, skippedFrozen: 0, skippedPending: 0, errors: [] }

  for (const line of lines) {
    try {
      const r = await resyncK03Line(client, line, changedBy)
      if (r.skipped === 'pending') {
        results.skippedPending++
        continue
      }
      if (r.skipped === 'frozen') {
        results.skippedFrozen++
        continue
      }
      results.updated++
    } catch (err) {
      results.errors.push(`${line.document_no || line.key}: ${err?.message || String(err)}`)
    }
  }

  return { ok: true, ...results }
}

/**
 * Odmraża wszystkie K03 z danego miesiąca (wg daty WZ) i przelicza FIFO + kartoteki.
 */
export async function unfreezeAndResyncK03ByWzMonth(client, yearMonth, options = {}) {
  const month = wzMonthKey(yearMonth)
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Wybierz miesiąc w formacie RRRR-MM.')

  const changedBy = options.changedBy || 'operator'
  const reason = options.reason || `Masowe odmrożenie K03 za ${month} – przeliczenie wg daty WZ`

  let { lines } = await loadWzQueue(client)
  const inMonth = lines.filter(l => wzMonthKey(l.wz_date) === month)
  const frozenInMonth = inMonth.filter(l => l.frozen || l.status === 'frozen')

  const results = {
    month,
    inMonth: inMonth.length,
    unfrozen: 0,
    resynced: 0,
    autoRefrozen: 0,
    skippedPending: 0,
    errors: []
  }

  for (const line of frozenInMonth) {
    const doc = line.k03Form
    if (!doc?.id) {
      results.errors.push(`${line.document_no || line.key}: brak zapisanego K03`)
      continue
    }
    try {
      await unfreezeK03Workflow(client, doc, reason, changedBy)
      results.unfrozen++
    } catch (err) {
      results.errors.push(`${line.document_no || line.key}: ${err?.message || String(err)}`)
    }
  }

  ;({ lines } = await loadWzQueue(client))
  const toResync = lines.filter(l => wzMonthKey(l.wz_date) === month && l.status !== 'pending')
  results.skippedPending = lines.filter(l => wzMonthKey(l.wz_date) === month && l.status === 'pending').length

  for (const line of toResync) {
    try {
      const r = await resyncK03Line(client, line, changedBy, `Przeliczenie K03 za ${month} po odmrożeniu miesiąca`)
      if (r.skipped) continue
      results.resynced++
      if (r.autoFrozen) results.autoRefrozen++
    } catch (err) {
      results.errors.push(`${line.document_no || line.key}: ${err?.message || String(err)}`)
    }
  }

  await logK03Workflow(client, {
    change_type: 'k03_month_unfreeze_resync',
    change_reason: reason,
    changed_by: changedBy,
    after_data: results
  })

  return { ok: true, ...results }
}

/** Obiekt WZ po odmrożeniu – bez flagi frozen w pamięci UI. */
export function k03LineAfterUnfreeze(line) {
  if (!line) return line
  return {
    ...line,
    frozen: false,
    status: line.status === 'frozen' ? 'k03_ready' : line.status,
    k03Form: line.k03Form ? {
      ...line.k03Form,
      frozen: false,
      data: {
        ...(line.k03Form.data || {}),
        frozen: false
      }
    } : line.k03Form
  }
}

/** Cofnięcie decyzji K03 (tylko gdy nie zamrożony). */
export async function revertK03Workflow(client, line, options = {}) {
  const k03Key = line.formId || `K03-${line.key}`
  const changedBy = options.changedBy || 'operator'

  const { data: snaps, error: findErr } = await client
    .from('haccp_documents')
    .select('id, data')
    .eq('document_type', 'K03')
  if (findErr) throw findErr

  const snap = (snaps || []).find(s => s.data?.k03_key === k03Key)
  if (snap?.data?.frozen && !options.alreadyUnfrozen) {
    throw new Error('K03 jest zamrożony – najpierw odmroź kartotekę.')
  }

  await revertFifoForSale(client, line.operation_id, line.product_id, {
    k03_key: k03Key,
    change_type: 'k03_reverted',
    change_reason: options.reason || 'Cofnięcie decyzji K03/WZ',
    changed_by: changedBy
  })

  if (snap?.id) {
    const { error: delErr } = await client.from('haccp_documents').delete().eq('id', snap.id)
    if (delErr) throw delErr
  }

  await logK03Workflow(client, {
    wz_no: line.document_no,
    wz_date: line.wz_date,
    product_name: line.product_name,
    k03_key: k03Key,
    change_type: 'k03_reverted',
    before_data: snap?.data || null,
    change_reason: options.reason || 'Cofnięcie decyzji K03/WZ',
    changed_by: changedBy
  })

  return { ok: true }
}

/** Odmrożenie K03 z powodem. */
export async function unfreezeK03Workflow(client, doc, reason, changedBy = 'operator') {
  if (!doc?.id) throw new Error('Brak dokumentu K03.')
  if (!doc.frozen && doc.data?.frozen !== true) return { ok: true, already: true }

  const nextDoc = {
    ...doc,
    frozen: false,
    data: {
      ...(doc.data || {}),
      frozen: false,
      unfreeze_reason: reason,
      unfrozen_at: new Date().toISOString()
    }
  }

  await saveK03Snapshot(client, nextDoc, { unfreeze: true, userRole: changedBy })

  await logK03Workflow(client, {
    wz_no: doc.document_no,
    wz_date: doc.document_date,
    product_name: doc.product_name,
    k03_key: doc.id,
    change_type: 'k03_unfrozen',
    change_reason: reason,
    changed_by: changedBy
  })

  return { ok: true }
}

/** Zamrożenie K03 z logiem. */
export async function freezeK03Workflow(client, doc, reason, changedBy = 'operator') {
  await saveK03Snapshot(client, doc, { freeze: true, userRole: changedBy })
  await logK03Workflow(client, {
    wz_no: doc.document_no,
    wz_date: doc.document_date,
    product_name: doc.product_name,
    k03_key: doc.id,
    change_type: 'k03_frozen',
    change_reason: reason,
    changed_by: changedBy
  })
  return { ok: true }
}

export { K03_ENGINE_VERSION }
