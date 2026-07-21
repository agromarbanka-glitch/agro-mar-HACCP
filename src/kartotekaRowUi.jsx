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

function cloneRowWithClass(row, extraClass) {
  if (!React.isValidElement(row)) return row
  const prev = row.props.className || ''
  const classes = `${prev} ${extraClass}`.trim()
  return React.cloneElement(row, { className: classes })
}

/** Delikatny „+” na krawędzi między wierszami – bez rozszerzania tabeli. */
export function KartotekaInsertRail({ colSpan, afterIndex, onInsertAt, placement = 'between' }) {
  const handleInsert = (e) => {
    e.preventDefault()
    e.stopPropagation()
    onInsertAt(afterIndex)
  }
  return (
    <tr
      className={`kartoteka-insert-rail no-print${placement === 'lead' ? ' kartoteka-insert-rail--lead' : ''}`}
      aria-hidden="true"
    >
      <td colSpan={colSpan} className="kartoteka-insert-rail-cell">
        <div className="kartoteka-insert-hit">
          <button
            type="button"
            className="kartoteka-insert-btn"
            onClick={handleInsert}
            onMouseDown={e => e.stopPropagation()}
            title="Dodaj wiersz tutaj"
            aria-label="Dodaj wiersz tutaj"
          >
            +
          </button>
        </div>
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
 * Wiersze kartoteki z „+” na krawędzi linii (Word-style).
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
    <KartotekaInsertRail
      key="rail-lead"
      colSpan={colSpan}
      afterIndex={-1}
      onInsertAt={onInsertAt}
      placement="lead"
    />
  )

  for (const item of interleaved) {
    if (item.kind === 'doc') {
      elements.push(cloneRowWithClass(renderDocRow(item.doc, item.index), 'kartoteka-editable-row'))
      elements.push(
        <KartotekaInsertRail
          key={`rail-after-doc-${item.index}`}
          colSpan={colSpan}
          afterIndex={item.index}
          onInsertAt={onInsertAt}
        />
      )
    } else {
      elements.push(cloneRowWithClass(renderPendingRow(item.pending), 'kartoteka-editable-row kartoteka-pending-row'))
      elements.push(
        <KartotekaInsertRail
          key={`rail-after-pending-${item.pending.id}`}
          colSpan={colSpan}
          afterIndex={item.pending.afterIndex}
          onInsertAt={onInsertAt}
        />
      )
    }
  }

  return elements
}
