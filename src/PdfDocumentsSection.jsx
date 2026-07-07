import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCcw, Upload, Eye, Download, Trash2, FolderOpen, Plus, X } from 'lucide-react'
import { confirmDelete, isAdmin } from './authEngine'
import {
  PDF_ARCHIVE_ENGINE_VERSION,
  loadPdfCategories,
  addPdfCategory,
  deletePdfCategory,
  loadPdfDocuments,
  uploadPdfDocument,
  updatePdfDocument,
  deletePdfDocument,
  getPdfSignedUrl,
  downloadPdfFile,
  formatPdfFileSize,
  titleFromFilename
} from './pdfDocumentsEngine'

export function PdfDocumentsSection({ supabase, employees, authProfile, authSession, setMessage }) {
  const [categories, setCategories] = useState([])
  const [files, setFiles] = useState([])
  const [allFilesForCounts, setAllFilesForCounts] = useState([])
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [uploadForm, setUploadForm] = useState({
    file: null,
    title: '',
    category_id: '',
    document_date: new Date().toISOString().slice(0, 10),
    signed_by_operator: '',
    notes: ''
  })
  const [preview, setPreview] = useState(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)

  const admin = isAdmin(authProfile)
  const uploaderName = authProfile?.display_name || authSession?.user?.email || ''

  const loadAll = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    try {
      const [cats, docs, allDocs] = await Promise.all([
        loadPdfCategories(supabase),
        loadPdfDocuments(supabase, { categoryId: categoryFilter, search }),
        loadPdfDocuments(supabase, { categoryId: 'all', search: '' })
      ])
      setCategories(cats)
      setFiles(docs)
      setAllFilesForCounts(allDocs)
      if (!uploadForm.category_id && cats.length) {
        setUploadForm(prev => ({ ...prev, category_id: cats[0].id }))
      }
    } catch (err) {
      setMessage(`Archiwum PDF: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [supabase, categoryFilter, search, setMessage, uploadForm.category_id])

  useEffect(() => { loadAll() }, [loadAll])

  const countsByCategory = useMemo(() => {
    const m = new Map()
    for (const f of allFilesForCounts) m.set(f.category_id, (m.get(f.category_id) || 0) + 1)
    return m
  }, [allFilesForCounts])

  async function handleAddCategory() {
    if (!supabase) return
    const name = newCategoryName.trim()
    if (!name) { setMessage('Podaj nazwę nowej kategorii.'); return }
    try {
      const cat = await addPdfCategory(supabase, name)
      setNewCategoryName('')
      setCategories(prev => [...prev, cat].sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name, 'pl')))
      setUploadForm(prev => ({ ...prev, category_id: cat.id }))
      setMessage(`Dodano kategorię „${cat.name}".`)
    } catch (err) {
      setMessage(`Kategoria: ${err.message}`)
    }
  }

  async function handleDeleteCategory(cat) {
    if (!supabase || !admin) return
    if (!confirmDelete(`Kategorię „${cat.name}".`)) return
    try {
      await deletePdfCategory(supabase, cat)
      if (categoryFilter === cat.id) setCategoryFilter('all')
      await loadAll()
      setMessage(`Usunięto kategorię „${cat.name}".`)
    } catch (err) {
      setMessage(`Kategoria: ${err.message}`)
    }
  }

  function onFilePick(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadForm(prev => ({
      ...prev,
      file,
      title: prev.title || titleFromFilename(file.name)
    }))
  }

  async function handleUpload(e) {
    e.preventDefault()
    if (!supabase || uploading) return
    if (!uploadForm.file) { setMessage('Wybierz plik PDF.'); return }
    if (!uploadForm.category_id) { setMessage('Wybierz kategorię.'); return }
    setUploading(true)
    try {
      await uploadPdfDocument(supabase, uploadForm.file, uploadForm, uploaderName)
      setUploadForm(prev => ({
        ...prev,
        file: null,
        title: '',
        notes: '',
        document_date: new Date().toISOString().slice(0, 10)
      }))
      const input = document.getElementById('pdf-archive-file-input')
      if (input) input.value = ''
      await loadAll()
      setMessage('PDF zapisany w archiwum.')
    } catch (err) {
      setMessage(`Upload PDF: ${err.message}`)
    } finally {
      setUploading(false)
    }
  }

  async function openPreview(doc) {
    if (!supabase) return
    setPreview(doc)
    setPreviewUrl('')
    setPreviewLoading(true)
    try {
      const url = await getPdfSignedUrl(supabase, doc.storage_path, 7200)
      setPreviewUrl(url || '')
      if (!url) setMessage('Nie udało się wygenerować podglądu.')
    } catch (err) {
      setMessage(`Podgląd: ${err.message}`)
    } finally {
      setPreviewLoading(false)
    }
  }

  function closePreview() {
    setPreview(null)
    setPreviewUrl('')
  }

  async function handleDownload(doc) {
    if (!supabase) return
    try {
      await downloadPdfFile(supabase, doc)
    } catch (err) {
      setMessage(`Pobieranie: ${err.message}`)
    }
  }

  async function handleCategoryChange(doc, categoryId) {
    if (!supabase || !categoryId || categoryId === doc.category_id) return
    try {
      const updated = await updatePdfDocument(supabase, doc.id, { category_id: categoryId })
      setFiles(prev => prev.map(f => f.id === doc.id ? updated : f))
      setAllFilesForCounts(prev => prev.map(f => f.id === doc.id ? updated : f))
      if (preview?.id === doc.id) setPreview(updated)
      setMessage('Zmieniono kategorię.')
    } catch (err) {
      setMessage(`Kategoria: ${err.message}`)
    }
  }

  async function handleSignChange(doc, signedBy) {
    if (!supabase) return
    try {
      await updatePdfDocument(supabase, doc.id, { signed_by_operator: signedBy })
      setFiles(prev => prev.map(f => f.id === doc.id ? { ...f, signed_by_operator: signedBy } : f))
      if (preview?.id === doc.id) setPreview(p => ({ ...p, signed_by_operator: signedBy }))
      setMessage('Zapisano podpis.')
    } catch (err) {
      setMessage(`Podpis: ${err.message}`)
    }
  }

  async function handleDelete(doc) {
    if (!supabase || !admin) return
    if (!confirmDelete(`Plik „${doc.title}" (${doc.original_filename}).`)) return
    try {
      await deletePdfDocument(supabase, doc)
      if (preview?.id === doc.id) closePreview()
      await loadAll()
      setMessage('Usunięto dokument PDF.')
    } catch (err) {
      setMessage(`Usuwanie: ${err.message}`)
    }
  }

  return (
    <>
      <section className="card pdf-archive-intro">
        <div className="section-title">
          <FolderOpen size={22} />
          <div>
            <h2>Archiwum dokumentów PDF</h2>
            <p>
              Badania, karty charakterystyki i inne dokumenty IFS/HACCP. Pliki są przechowywane w Supabase Storage –
              podgląd w przeglądarce i pobranie na dysk. Nie wpływa na FIFO ani magazyn partii.
            </p>
            <p className="hint">Silnik: {PDF_ARCHIVE_ENGINE_VERSION}. Uruchom migrację SQL: <code>2026-v38-haccp-pdf-archiwum.sql</code></p>
          </div>
        </div>
        <button type="button" className="secondary" onClick={loadAll} disabled={loading}>
          <RefreshCcw size={16} /> {loading ? 'Odświeżanie…' : 'Odśwież listę'}
        </button>
      </section>

      <div className="pdf-archive-layout">
        <aside className="card pdf-archive-sidebar">
          <h3>Kategorie</h3>
          <ul className="pdf-category-list">
            <li>
              <button
                type="button"
                className={categoryFilter === 'all' ? 'pdf-cat-btn active' : 'pdf-cat-btn'}
                onClick={() => setCategoryFilter('all')}
              >
                Wszystkie <span className="pdf-cat-count">{allFilesForCounts.length}</span>
              </button>
            </li>
            {categories.map(cat => (
              <li key={cat.id}>
                <button
                  type="button"
                  className={categoryFilter === cat.id ? 'pdf-cat-btn active' : 'pdf-cat-btn'}
                  onClick={() => setCategoryFilter(cat.id)}
                >
                  {cat.name}
                  <span className="pdf-cat-count">{countsByCategory.get(cat.id) || 0}</span>
                </button>
                {admin && !cat.is_system && (
                  <button type="button" className="mini danger pdf-cat-del" title="Usuń kategorię" onClick={() => handleDeleteCategory(cat)}>×</button>
                )}
              </li>
            ))}
          </ul>
          <div className="pdf-add-category">
            <input
              value={newCategoryName}
              onChange={e => setNewCategoryName(e.target.value)}
              placeholder="Nowy rodzaj dokumentu…"
              onKeyDown={e => { if (e.key === 'Enter') handleAddCategory() }}
            />
            <button type="button" className="secondary mini" onClick={handleAddCategory}><Plus size={14} /> Dodaj</button>
          </div>
        </aside>

        <div className="pdf-archive-main">
          <section className="card inner-card no-print">
            <h3><Upload size={18} /> Wgraj PDF</h3>
            <form className="pdf-upload-form" onSubmit={handleUpload}>
              <label className="full-width">Plik PDF *
                <input id="pdf-archive-file-input" type="file" accept="application/pdf,.pdf" onChange={onFilePick} />
              </label>
              <label>Tytuł / opis
                <input value={uploadForm.title} onChange={e => setUploadForm(p => ({ ...p, title: e.target.value }))} placeholder="np. Badanie wody – styczeń 2026" />
              </label>
              <label>Kategoria *
                <select value={uploadForm.category_id} onChange={e => setUploadForm(p => ({ ...p, category_id: e.target.value }))}>
                  <option value="">Wybierz…</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label>Data dokumentu
                <input type="date" value={uploadForm.document_date} onChange={e => setUploadForm(p => ({ ...p, document_date: e.target.value }))} />
              </label>
              <label>Podpis / odpowiedzialny
                <select value={uploadForm.signed_by_operator} onChange={e => setUploadForm(p => ({ ...p, signed_by_operator: e.target.value }))}>
                  <option value="">—</option>
                  {employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}
                </select>
              </label>
              <label className="full-width">Uwagi
                <input value={uploadForm.notes} onChange={e => setUploadForm(p => ({ ...p, notes: e.target.value }))} placeholder="Opcjonalnie" />
              </label>
              <div className="actions">
                <button type="submit" disabled={uploading}>{uploading ? 'Wgrywanie…' : 'Zapisz w archiwum'}</button>
              </div>
            </form>
          </section>

          <section className="card">
            <div className="pdf-list-head">
              <h3>Dokumenty ({files.length})</h3>
              <label>Szukaj
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="tytuł, plik, uwagi…" />
              </label>
            </div>
            {files.length === 0 && !loading && (
              <p className="hint">Brak plików w wybranej kategorii. Wgraj pierwszy PDF powyżej.</p>
            )}
            {files.length > 0 && (
              <div className="table-wrap docs-table-wrap">
                <table className="docs-table pdf-docs-table">
                  <thead>
                    <tr>
                      <th>Tytuł</th>
                      <th>Kategoria</th>
                      <th>Data</th>
                      <th>Plik</th>
                      <th>Rozmiar</th>
                      <th>Podpis</th>
                      <th>Akcje</th>
                    </tr>
                  </thead>
                  <tbody>
                    {files.map(doc => (
                      <tr key={doc.id}>
                        <td className="left"><b>{doc.title}</b>{doc.notes && <><br /><small className="hint">{doc.notes}</small></>}</td>
                        <td>
                          <select
                            className="mini-select"
                            value={doc.category_id || ''}
                            onChange={e => handleCategoryChange(doc, e.target.value)}
                          >
                            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </td>
                        <td>{doc.document_date || '—'}</td>
                        <td className="left"><small>{doc.original_filename}</small></td>
                        <td>{formatPdfFileSize(doc.file_size)}</td>
                        <td>
                          <select
                            className="mini-select"
                            value={doc.signed_by_operator || ''}
                            onChange={e => handleSignChange(doc, e.target.value)}
                          >
                            <option value="">—</option>
                            {employees.map(emp => <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>)}
                          </select>
                        </td>
                        <td className="row-actions">
                          <button type="button" className="mini secondary" onClick={() => openPreview(doc)} title="Podgląd"><Eye size={14} /></button>
                          <button type="button" className="mini secondary" onClick={() => handleDownload(doc)} title="Pobierz"><Download size={14} /></button>
                          {admin && (
                            <button type="button" className="mini danger" onClick={() => handleDelete(doc)} title="Usuń"><Trash2 size={14} /></button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>

      {preview && (
        <div className="modal-backdrop pdf-preview-backdrop" onClick={closePreview}>
          <div className="haccp-modal wide pdf-preview-modal" onClick={e => e.stopPropagation()}>
            <div className="pdf-preview-head">
              <div>
                <h3>{preview.title}</h3>
                <p className="hint">{preview.category_name} · {preview.original_filename} · {formatPdfFileSize(preview.file_size)}</p>
              </div>
              <div className="row-actions">
                <button type="button" className="secondary" onClick={() => handleDownload(preview)}><Download size={16} /> Pobierz</button>
                <button type="button" className="secondary" onClick={closePreview}><X size={16} /> Zamknij</button>
              </div>
            </div>
            {previewLoading && <p className="hint">Ładowanie podglądu…</p>}
            {!previewLoading && previewUrl && (
              <iframe className="pdf-preview-frame" src={previewUrl} title={preview.title} />
            )}
            {!previewLoading && !previewUrl && (
              <p className="hint">Podgląd niedostępny – użyj „Pobierz” lub sprawdź bucket Storage w Supabase.</p>
            )}
          </div>
        </div>
      )}
    </>
  )
}
