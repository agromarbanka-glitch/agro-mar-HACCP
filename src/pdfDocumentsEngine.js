/**
 * Archiwum PDF – kategorie, upload do Supabase Storage, podpis, podgląd, pobranie.
 * Wyłącznie dokumentacja – bez wpływu na FIFO / magazyn.
 */

export const PDF_ARCHIVE_ENGINE_VERSION = '1.1'
export const PDF_STORAGE_BUCKET = 'haccp-pdf-files'

const FILE_SELECT = 'id, category_id, title, document_date, original_filename, storage_path, file_size, mime_type, signed_by_operator, notes, uploaded_by_name, created_at, updated_at, haccp_pdf_categories(id, name, sort_order, is_system)'

export function slugifyCategoryName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'kategoria'
}

export function titleFromFilename(filename) {
  return String(filename || '')
    .replace(/\.pdf$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim() || 'Dokument PDF'
}

export function formatPdfFileSize(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export async function loadPdfCategories(client) {
  if (!client) return []
  const { data, error } = await client
    .from('haccp_pdf_categories')
    .select('id, name, sort_order, is_system, created_at')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error
  return data || []
}

export async function addPdfCategory(client, name) {
  const trimmed = String(name || '').trim()
  if (!trimmed) throw new Error('Podaj nazwę kategorii.')
  const existing = await loadPdfCategories(client)
  const maxOrder = existing.reduce((m, c) => Math.max(m, Number(c.sort_order) || 0), 0)
  const { data, error } = await client
    .from('haccp_pdf_categories')
    .insert({ name: trimmed, sort_order: maxOrder + 1, is_system: false })
    .select('id, name, sort_order, is_system, created_at')
    .single()
  if (error) {
    if (/duplicate|unique/i.test(error.message || '')) throw new Error('Taka kategoria już istnieje.')
    throw error
  }
  return data
}

export async function deletePdfCategory(client, category) {
  if (!client || !category?.id) return
  if (category.is_system) throw new Error('Nie można usunąć kategorii systemowej.')
  const { count, error: cntErr } = await client
    .from('haccp_pdf_files')
    .select('id', { count: 'exact', head: true })
    .eq('category_id', category.id)
  if (cntErr) throw cntErr
  if (count > 0) throw new Error('Kategoria zawiera pliki – najpierw przenieś lub usuń dokumenty.')
  const { error } = await client.from('haccp_pdf_categories').delete().eq('id', category.id)
  if (error) throw error
}

export async function loadPdfDocuments(client, { categoryId = 'all', search = '' } = {}) {
  if (!client) return []
  let q = client.from('haccp_pdf_files').select(FILE_SELECT)
  if (categoryId && categoryId !== 'all') q = q.eq('category_id', categoryId)
  const { data, error } = await q
    .order('document_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  const rows = (data || []).map(normalizePdfFileRow)
  const qNorm = String(search || '').trim().toLowerCase()
  if (!qNorm) return rows
  return rows.filter(r =>
    [r.title, r.original_filename, r.notes, r.signed_by_operator, r.category_name]
      .join(' ')
      .toLowerCase()
      .includes(qNorm)
  )
}

function normalizePdfFileRow(row) {
  const cat = row.haccp_pdf_categories || {}
  return {
    ...row,
    category_name: cat.name || '',
    category_sort: cat.sort_order ?? 0
  }
}

function buildStoragePath(categoryId, fileId, originalFilename) {
  const ext = String(originalFilename || '').toLowerCase().endsWith('.pdf') ? 'pdf' : 'pdf'
  return `${categoryId}/${fileId}.${ext}`
}

export function formatPdfUploadError(err) {
  const msg = String(err?.message || err || 'Nieznany błąd')
  const status = err?.statusCode || err?.status || ''
  const code = err?.error || err?.code || ''
  const blob = `${msg} ${code} ${status}`.toLowerCase()

  if (/does not exist|relation.*haccp_pdf|42p01/i.test(blob)) {
    return 'Brak tabel archiwum PDF w Supabase. Uruchom SQL: 2026-v38-haccp-pdf-archiwum.sql (lub 2026-v39-haccp-pdf-storage-fix.sql).'
  }
  if (/bucket not found|invalid bucket|404.*bucket/i.test(blob)) {
    return 'Brak bucketa Storage „haccp-pdf-files”. Uruchom migrację SQL v38 lub v39 w Supabase.'
  }
  if (/mime|content.type|invalid file type|415/i.test(blob)) {
    return 'Storage odrzucił typ pliku. Uruchom w Supabase SQL: 2026-v39-haccp-pdf-storage-fix.sql (usuwa restrykcję MIME).'
  }
  if (/row-level security|policy|42501|403|jwt|not authenticated|session/i.test(blob)) {
    return 'Brak uprawnień (sesja lub RLS). Wyloguj się i zaloguj ponownie. Sprawdź też LOGOWANIE-KROK-5 w Supabase.'
  }
  if (/payload too large|413|file_size_limit/i.test(blob)) {
    return 'Plik za duży (max 50 MB na plik w archiwum PDF).'
  }
  if (/duplicate|unique|already exists/i.test(blob)) {
    return 'Ten plik już istnieje w archiwum – spróbuj ponownie.'
  }
  if (/timeout|network|failed to fetch|aborted/i.test(blob)) {
    return 'Przekroczono czas wysyłania – sprawdź internet i rozmiar pliku, spróbuj ponownie.'
  }
  return msg
}

/** Sprawdza czy migracja SQL i bucket Storage są gotowe. */
export async function checkPdfArchiveSetup(client) {
  if (!client) {
    return { ok: false, tablesOk: false, storageOk: false, categoriesCount: 0, hint: 'Brak połączenia z Supabase (.env).' }
  }
  let tablesOk = false
  let categoriesCount = 0
  let tablesError = ''
  try {
    const { count, error } = await client
      .from('haccp_pdf_categories')
      .select('id', { count: 'exact', head: true })
    if (error) throw error
    tablesOk = true
    categoriesCount = count ?? 0
  } catch (err) {
    tablesError = formatPdfUploadError(err)
  }

  let storageOk = false
  let storageError = ''
  if (tablesOk) {
    try {
      const { error } = await client.storage.from(PDF_STORAGE_BUCKET).list('', { limit: 1 })
      if (error) throw error
      storageOk = true
    } catch (err) {
      storageError = formatPdfUploadError(err)
    }
  }

  const ok = tablesOk && storageOk
  let hint = ''
  if (!tablesOk) hint = tablesError || 'Uruchom migrację SQL archiwum PDF w Supabase.'
  else if (!storageOk) hint = storageError || 'Bucket Storage nie jest skonfigurowany – uruchom migrację v39.'
  return { ok, tablesOk, storageOk, categoriesCount, hint }
}

async function ensurePdfUploadSession(client) {
  const { data, error } = await client.auth.getSession()
  if (error) throw error
  if (!data?.session) {
    throw new Error('Sesja wygasła – wyloguj się i zaloguj ponownie.')
  }
  return data.session
}

export async function uploadPdfDocument(client, file, meta, uploadedByName = '', { onProgress } = {}) {
  if (!client) throw new Error('Brak połączenia z bazą.')
  if (!file) throw new Error('Wybierz plik PDF.')
  const name = String(file.name || '')
  if (!/\.pdf$/i.test(name)) {
    throw new Error('Dozwolone są tylko pliki z rozszerzeniem .pdf')
  }
  if (!meta?.category_id) throw new Error('Wybierz kategorię dokumentu.')

  await ensurePdfUploadSession(client)

  const fileId = crypto.randomUUID()
  const storagePath = buildStoragePath(meta.category_id, fileId, file.name)
  const title = String(meta.title || '').trim() || titleFromFilename(file.name)

  onProgress?.('Wysyłanie pliku do Storage…')
  let body = file
  try {
    if (typeof file.arrayBuffer === 'function') {
      body = await file.arrayBuffer()
    }
  } catch (_) {
    body = file
  }

  const { error: upErr } = await client.storage
    .from(PDF_STORAGE_BUCKET)
    .upload(storagePath, body, {
      contentType: 'application/pdf',
      cacheControl: '3600',
      upsert: false
    })
  if (upErr) {
    const friendly = formatPdfUploadError(upErr)
    throw new Error(friendly)
  }

  onProgress?.('Zapisywanie metadanych…')
  const payload = {
    id: fileId,
    category_id: meta.category_id,
    title,
    document_date: meta.document_date || new Date().toISOString().slice(0, 10),
    original_filename: file.name,
    storage_path: storagePath,
    file_size: file.size || 0,
    mime_type: 'application/pdf',
    signed_by_operator: meta.signed_by_operator || null,
    notes: meta.notes || null,
    uploaded_by_name: uploadedByName || null,
    updated_at: new Date().toISOString()
  }

  const { data, error } = await client
    .from('haccp_pdf_files')
    .insert(payload)
    .select(FILE_SELECT)
    .single()
  if (error) {
    await client.storage.from(PDF_STORAGE_BUCKET).remove([storagePath]).catch(() => {})
    throw new Error(formatPdfUploadError(error))
  }
  return normalizePdfFileRow(data)
}

export async function updatePdfDocument(client, id, patch) {
  if (!client || !id) return null
  const allowed = {}
  if (patch.title !== undefined) allowed.title = String(patch.title || '').trim()
  if (patch.category_id !== undefined) allowed.category_id = patch.category_id
  if (patch.document_date !== undefined) allowed.document_date = patch.document_date || null
  if (patch.signed_by_operator !== undefined) allowed.signed_by_operator = patch.signed_by_operator || null
  if (patch.notes !== undefined) allowed.notes = patch.notes || null
  allowed.updated_at = new Date().toISOString()

  const { data, error } = await client
    .from('haccp_pdf_files')
    .update(allowed)
    .eq('id', id)
    .select(FILE_SELECT)
    .single()
  if (error) throw error
  return normalizePdfFileRow(data)
}

export async function deletePdfDocument(client, doc) {
  if (!client || !doc?.id) return
  if (doc.storage_path) {
    const { error: stErr } = await client.storage.from(PDF_STORAGE_BUCKET).remove([doc.storage_path])
    if (stErr) throw stErr
  }
  const { error } = await client.from('haccp_pdf_files').delete().eq('id', doc.id)
  if (error) throw error
}

export async function getPdfSignedUrl(client, storagePath, expiresIn = 3600) {
  if (!client || !storagePath) return null
  const { data, error } = await client.storage
    .from(PDF_STORAGE_BUCKET)
    .createSignedUrl(storagePath, expiresIn)
  if (error) throw error
  return data?.signedUrl || null
}

export async function downloadPdfFile(client, doc) {
  if (!client || !doc?.storage_path) throw new Error('Brak pliku.')
  const { data, error } = await client.storage.from(PDF_STORAGE_BUCKET).download(doc.storage_path)
  if (error) throw error
  const blob = data
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = doc.original_filename || `${doc.title || 'dokument'}.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
