-- Archiwum PDF: kategorie (Badania, Karty Charakterystyki, Inne + własne) + pliki w Storage.
-- Nie dotyka FIFO, partii ani operacji magazynowych.

BEGIN;

CREATE TABLE IF NOT EXISTS public.haccp_pdf_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  sort_order int NOT NULL DEFAULT 0,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.haccp_pdf_categories (name, sort_order, is_system) VALUES
  ('Badania', 1, true),
  ('Karty Charakterystyki', 2, true),
  ('Inne', 99, true)
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.haccp_pdf_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES public.haccp_pdf_categories(id) ON DELETE RESTRICT,
  title text NOT NULL,
  document_date date,
  original_filename text NOT NULL,
  storage_path text NOT NULL UNIQUE,
  file_size bigint,
  mime_type text NOT NULL DEFAULT 'application/pdf',
  signed_by_operator text,
  notes text,
  uploaded_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_haccp_pdf_files_category ON public.haccp_pdf_files(category_id);
CREATE INDEX IF NOT EXISTS idx_haccp_pdf_files_date ON public.haccp_pdf_files(document_date DESC NULLS LAST);

ALTER TABLE public.haccp_pdf_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.haccp_pdf_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "haccp_pdf_categories_auth" ON public.haccp_pdf_categories;
CREATE POLICY "haccp_pdf_categories_auth" ON public.haccp_pdf_categories
  FOR ALL TO authenticated
  USING (public.is_active_app_user())
  WITH CHECK (public.is_active_app_user());

DROP POLICY IF EXISTS "haccp_pdf_files_auth" ON public.haccp_pdf_files;
CREATE POLICY "haccp_pdf_files_auth" ON public.haccp_pdf_files
  FOR ALL TO authenticated
  USING (public.is_active_app_user())
  WITH CHECK (public.is_active_app_user());

-- Bucket Storage (prywatny – podgląd/pobranie przez signed URL)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'haccp-pdf-files',
  'haccp-pdf-files',
  false,
  52428800,
  ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 52428800,
  allowed_mime_types = ARRAY['application/pdf']::text[];

DROP POLICY IF EXISTS "haccp_pdf_storage_select" ON storage.objects;
CREATE POLICY "haccp_pdf_storage_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'haccp-pdf-files' AND public.is_active_app_user());

DROP POLICY IF EXISTS "haccp_pdf_storage_insert" ON storage.objects;
CREATE POLICY "haccp_pdf_storage_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'haccp-pdf-files' AND public.is_active_app_user());

DROP POLICY IF EXISTS "haccp_pdf_storage_update" ON storage.objects;
CREATE POLICY "haccp_pdf_storage_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'haccp-pdf-files' AND public.is_active_app_user())
  WITH CHECK (bucket_id = 'haccp-pdf-files' AND public.is_active_app_user());

DROP POLICY IF EXISTS "haccp_pdf_storage_delete" ON storage.objects;
CREATE POLICY "haccp_pdf_storage_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'haccp-pdf-files' AND public.is_active_app_user());

COMMIT;
