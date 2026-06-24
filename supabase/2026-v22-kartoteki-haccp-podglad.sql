-- v22 – kartoteki HACCP: podgląd, wersje dokumentów, status P/N i historia zmian
-- Bezpieczna migracja: nie usuwa danych.

ALTER TABLE public.haccp_documents
  ADD COLUMN IF NOT EXISTS document_version text DEFAULT 'I/2024',
  ADD COLUMN IF NOT EXISTS signed_by_operator text,
  ADD COLUMN IF NOT EXISTS signed_by_admin text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

ALTER TABLE public.haccp_document_history
  ADD COLUMN IF NOT EXISTS document_id uuid,
  ADD COLUMN IF NOT EXISTS action text,
  ADD COLUMN IF NOT EXISTS field_name text,
  ADD COLUMN IF NOT EXISTS old_value text,
  ADD COLUMN IF NOT EXISTS new_value text,
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS changed_by text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- Ustaw domyślny status P tam, gdzie brakuje statusu.
UPDATE public.haccp_documents
SET status = 'P'
WHERE status IS NULL OR status = '';

-- Uzupełnij wersję dokumentu dla starych wpisów.
UPDATE public.haccp_documents
SET document_version = COALESCE(document_version, 'I/2024');

-- RLS/polityki dla wersji testowej aplikacji.
ALTER TABLE public.haccp_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.haccp_document_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all haccp_documents v22" ON public.haccp_documents;
DROP POLICY IF EXISTS "Allow all haccp_document_history v22" ON public.haccp_document_history;

CREATE POLICY "Allow all haccp_documents v22"
ON public.haccp_documents
FOR ALL TO anon
USING (true)
WITH CHECK (true);

CREATE POLICY "Allow all haccp_document_history v22"
ON public.haccp_document_history
FOR ALL TO anon
USING (true)
WITH CHECK (true);

SELECT document_type, COUNT(*) AS liczba
FROM public.haccp_documents
GROUP BY document_type
ORDER BY document_type;
