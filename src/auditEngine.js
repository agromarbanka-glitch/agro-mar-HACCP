/**
 * Centralna historia edycji i usunięć z możliwością przywrócenia (admin).
 */

export const AUDIT_ENGINE_VERSION = '1.0'

export function auditActor(profile, session) {
  return {
    changedBy: profile?.display_name || profile?.email || session?.user?.email || 'system',
    changedByEmail: profile?.email || session?.user?.email || ''
  }
}

export async function logAudit(client, entry) {
  if (!client) return null
  const payload = {
    entity_type: entry.entity_type,
    entity_id: entry.entity_id || null,
    action: entry.action,
    summary: entry.summary || '',
    before_data: entry.before_data ?? null,
    after_data: entry.after_data ?? null,
    changed_by: entry.changed_by || 'system',
    changed_by_email: entry.changed_by_email || '',
    can_restore: Boolean(entry.can_restore)
  }
  const { data, error } = await client.from('app_audit_log').insert(payload).select('id').single()
  if (error) throw error
  return data
}

export async function auditDeleteHaccpDocument(client, doc, actor, reason = '') {
  const summary = [
    doc.document_type,
    doc.document_date || '',
    doc.document_no || doc.lot_no || '',
    doc.product_name || ''
  ].filter(Boolean).join(' · ')
  await logAudit(client, {
    entity_type: 'haccp_document',
    entity_id: doc.id,
    action: 'delete',
    summary: reason ? `${summary} (${reason})` : summary,
    before_data: { ...doc },
    after_data: null,
    changed_by: actor.changedBy,
    changed_by_email: actor.changedByEmail,
    can_restore: true
  })
  const { error } = await client.from('haccp_documents').delete().eq('id', doc.id)
  if (error) throw error
}

export async function auditDeleteHaccpDocuments(client, docs, actor, reason = '') {
  for (const doc of docs || []) {
    await auditDeleteHaccpDocument(client, doc, actor, reason)
  }
}

export async function auditUpdateHaccpDocument(client, beforeDoc, afterDoc, actor, summary = '') {
  await logAudit(client, {
    entity_type: 'haccp_document',
    entity_id: beforeDoc.id,
    action: 'update',
    summary: summary || `${beforeDoc.document_type} ${beforeDoc.document_date || ''}`,
    before_data: { ...beforeDoc },
    after_data: { ...afterDoc },
    changed_by: actor.changedBy,
    changed_by_email: actor.changedByEmail,
    can_restore: false
  })
}

export async function auditDeleteGeneric(client, table, row, entityType, actor, summary = '') {
  await logAudit(client, {
    entity_type: entityType,
    entity_id: row.id,
    action: 'delete',
    summary: summary || entityType,
    before_data: { ...row },
    after_data: null,
    changed_by: actor.changedBy,
    changed_by_email: actor.changedByEmail,
    can_restore: table === 'haccp_documents'
  })
  const { error } = await client.from(table).delete().eq('id', row.id)
  if (error) throw error
}

export async function loadAuditLog(client, { limit = 200, action = 'all' } = {}) {
  let q = client
    .from('app_audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (action && action !== 'all') q = q.eq('action', action)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function loadLegacyDocHistory(client, limit = 100) {
  const { data, error } = await client
    .from('haccp_document_history')
    .select('*, haccp_documents(document_type, document_date, document_no, lot_no, product_name)')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) return []
  return data || []
}

export async function restoreAuditEntry(client, entry, actor) {
  if (!entry?.can_restore || entry.restored_at) {
    throw new Error('Ten wpis nie podlega przywróceniu.')
  }
  if (entry.action !== 'delete' || !entry.before_data) {
    throw new Error('Przywracanie dostępne tylko dla usuniętych rekordów.')
  }

  const row = { ...entry.before_data }
  const table = entry.entity_type === 'haccp_document' ? 'haccp_documents'
    : entry.entity_type === 'haccp_employee' ? 'haccp_employees'
    : entry.entity_type === 'haccp_aux_material' ? 'haccp_aux_materials'
    : null
  if (!table) throw new Error(`Nieobsługiwany typ: ${entry.entity_type}`)

  const { error: insErr } = await client.from(table).insert(row)
  if (insErr) throw insErr

  await logAudit(client, {
    entity_type: entry.entity_type,
    entity_id: entry.entity_id,
    action: 'restore',
    summary: `Przywrócono: ${entry.summary || entry.entity_id}`,
    before_data: entry.before_data,
    after_data: row,
    changed_by: actor.changedBy,
    changed_by_email: actor.changedByEmail,
    can_restore: false
  })

  const { error: updErr } = await client.from('app_audit_log').update({
    restored_at: new Date().toISOString(),
    restored_by: actor.changedBy
  }).eq('id', entry.id)
  if (updErr) throw updErr
}

export function auditActionLabel(action) {
  const map = {
    create: 'Utworzenie',
    update: 'Edycja',
    delete: 'Usunięcie',
    restore: 'Przywrócenie'
  }
  return map[action] || action
}
