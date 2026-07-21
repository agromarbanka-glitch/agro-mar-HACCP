import React from 'react'

export function kartotekaGroupRowKey(group) {
  return group?.key || `${group?.type || '?'}|${group?.period || ''}`
}

export function newPendingRowId() {
  return `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

export function addKartotekaPendingRow(setPendingRows, groupKey, afterIndex, draft = {}) {
  const id = newPendingRowId()
  setPendingRows(prev => ({
    ...prev,
    [groupKey]: [...(prev[groupKey] || []), { id, afterIndex, draft: { ...draft } }]
  }))
  return id
}

export function patchKartotekaPendingRow(setPendingRows, groupKey, pendingId, draftPatch) {
  setPendingRows(prev => ({
    ...prev,
    [groupKey]: (prev[groupKey] || []).map(p =>
      p.id === pendingId ? { ...p, draft: { ...p.draft, ...draftPatch } } : p
    )
  }))
}

export function removeKartotekaPendingRow(setPendingRows, groupKey, pendingId) {
  setPendingRows(prev => ({
    ...prev,
    [groupKey]: (prev[groupKey] || []).filter(p => p.id !== pendingId)
  }))
}

export function buildInterleavedKartotekaRows(docs, groupKey, pendingRows) {
  const pending = pendingRows[groupKey] || []
  const rows = []
  for (const p of pending.filter(x => x.afterIndex === -1)) {
    rows.push({ kind: 'pending', pending: p })
  }
  for (let i = 0; i < docs.length; i++) {
    rows.push({ kind: 'doc', doc: docs[i], index: i })
    for (const p of pending.filter(x => x.afterIndex === i)) {
      rows.push({ kind: 'pending', pending: p })
    }
  }
  return rows
}

export function kartotekaEndAfterIndex(docs) {
  return docs.length > 0 ? docs.length - 1 : -1
}

export function KartotekaInsertGap({ colSpan, onInsert, title = 'Dodaj wiersz tutaj' }) {
  return (
    <tr className="kartoteka-insert-gap no-print" aria-hidden="true">
      <td colSpan={colSpan}>
        <button type="button" className="kartoteka-insert-btn" onClick={onInsert} title={title} aria-label={title}>+</button>
      </td>
    </tr>
  )
}

export function KartotekaRowDeleteButton({ active, onRequest, onConfirm, onCancel, label = 'Usuń' }) {
  if (active) {
    return (
      <span className="kartoteka-delete-confirm">
        <button type="button" className="mini danger" onClick={onConfirm}>Potwierdź</button>
        <button type="button" className="mini secondary" onClick={onCancel}>Anuluj</button>
      </span>
    )
  }
  return <button type="button" className="mini danger" onClick={onRequest}>{label}</button>
}

/**
 * Wiersze kartoteki z „plusikami” między liniami (najedź na wiersz lub przerwę).
 */
export function renderKartotekaTableBody({
  docs,
  groupKey,
  pendingRows,
  colSpan,
  onInsertAt,
  renderDocRow,
  renderPendingRow
}) {
  const interleaved = buildInterleavedKartotekaRows(docs, groupKey, pendingRows)
  const elements = []
  elements.push(
    <KartotekaInsertGap key="gap-lead" colSpan={colSpan} onInsert={() => onInsertAt(-1)} />
  )
  let lastDocIndex = -1
  for (const item of interleaved) {
    if (item.kind === 'doc') {
      elements.push(renderDocRow(item.doc, item.index))
      lastDocIndex = item.index
    } else {
      elements.push(renderPendingRow(item.pending))
    }
    elements.push(
      <KartotekaInsertGap
        key={`gap-after-${item.kind === 'doc' ? `doc-${item.index}` : `pending-${item.pending.id}`}`}
        colSpan={colSpan}
        onInsert={() => onInsertAt(lastDocIndex)}
      />
    )
  }
  return elements
}
