-- v22.1 – bezpieczna migracja HACCP / kartoteki i podgląd dokumentów
-- Działa na obecnej bazie: dodaje brakujące kolumny, nie usuwa danych.

BEGIN;

-- 1) Tabele bazowe, jeśli jeszcze ich nie ma
CREATE TABLE IF NOT EXISTS public.haccp_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type text NOT NULL,
  lot_id uuid,
  document_date date DEFAULT current_date,
  product_name text,
  lot_no text,
  supplier_name text,
  document_no text,
  chamber_code text,
  qty numeric DEFAULT 0,
  data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.haccp_document_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid,
  action text,
  field_name text,
  old_value text,
  new_value text,
  reason text,
  changed_by text,
  created_at timestamptz DEFAULT now()
);

-- 2) Brakujące kolumny w haccp_documents
ALTER TABLE public.haccp_documents
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'P',
  ADD COLUMN IF NOT EXISTS document_version text DEFAULT 'I/2024',
  ADD COLUMN IF NOT EXISTS signed_by_operator text,
  ADD COLUMN IF NOT EXISTS signed_by_admin text,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS nonconformity_note text,
  ADD COLUMN IF NOT EXISTS operator_name text;

-- 3) Brakujące kolumny w haccp_document_history
ALTER TABLE public.haccp_document_history
  ADD COLUMN IF NOT EXISTS document_id uuid,
  ADD COLUMN IF NOT EXISTS action text,
  ADD COLUMN IF NOT EXISTS field_name text,
  ADD COLUMN IF NOT EXISTS old_value text,
  ADD COLUMN IF NOT EXISTS new_value text,
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS changed_by text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- 4) Brakujące kolumny w lots pod komory i grupy
ALTER TABLE public.lots
  ADD COLUMN IF NOT EXISTS chamber_id uuid REFERENCES public.storage_chambers(id),
  ADD COLUMN IF NOT EXISTS product_group text;

-- Ujednolicenie, jeśli w starszych wersjach była kolumna storage_chamber_id
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='lots' AND column_name='storage_chamber_id'
  ) THEN
    EXECUTE 'UPDATE public.lots SET chamber_id = COALESCE(chamber_id, storage_chamber_id) WHERE chamber_id IS NULL';
  END IF;
END $$;

-- 5) Uzupełnij product_group w partiach z produktów
UPDATE public.lots l
SET product_group = COALESCE(l.product_group, p.product_group)
FROM public.products p
WHERE p.id = l.product_id;

-- 6) Uzupełnij statusy i domyślne pola P/N
UPDATE public.haccp_documents
SET status = COALESCE(NULLIF(status, ''), 'P'),
    document_version = COALESCE(document_version, 'I/2024'),
    data = COALESCE(data, '{}'::jsonb) || jsonb_build_object(
      'ocena_higieny', COALESCE(data->>'ocena_higieny', 'P'),
      'ocena_surowca', COALESCE(data->>'ocena_surowca', 'P'),
      'temperatura_ok', COALESCE(data->>'temperatura_ok', 'P'),
      'sito_ok', COALESCE(data->>'sito_ok', 'P')
    ),
    updated_at = COALESCE(updated_at, now());

-- 7) Wygeneruj brakujące K01 z partii, jeśli nie istnieją
INSERT INTO public.haccp_documents (
  document_type, lot_id, document_date, product_name, lot_no, supplier_name,
  document_no, chamber_code, qty, status, document_version, data
)
SELECT
  'K01',
  l.id,
  l.production_date,
  p.name,
  l.lot_no,
  COALESCE(c.name, ''),
  COALESCE(o.document_no, ''),
  COALESCE(sc.code, ''),
  COALESCE(l.initial_qty, 0),
  'P',
  'I/2024',
  jsonb_build_object(
    'ocena_higieny', 'P',
    'ocena_surowca', 'P',
    'uwagi', ''
  )
FROM public.lots l
LEFT JOIN public.products p ON p.id = l.product_id
LEFT JOIN public.operations o ON o.id = l.source_operation_id
LEFT JOIN public.contractors c ON c.id = o.contractor_id
LEFT JOIN public.storage_chambers sc ON sc.id = l.chamber_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.haccp_documents d
  WHERE d.document_type = 'K01' AND d.lot_id = l.id
);

-- 8) Wygeneruj K02 dla aktywnych partii surowca w CP2
INSERT INTO public.haccp_documents (
  document_type, lot_id, document_date, product_name, lot_no, supplier_name,
  document_no, chamber_code, qty, status, document_version, data
)
SELECT
  'K02',
  l.id,
  current_date,
  p.name,
  l.lot_no,
  COALESCE(c.name, ''),
  COALESCE(o.document_no, ''),
  COALESCE(sc.code, ''),
  COALESCE(l.remaining_qty, 0),
  'P',
  'I/2024',
  jsonb_build_object(
    'temperatura_ok', 'P',
    'higiena_komory', 'P',
    'uwagi', ''
  )
FROM public.lots l
LEFT JOIN public.products p ON p.id = l.product_id
LEFT JOIN public.operations o ON o.id = l.source_operation_id
LEFT JOIN public.contractors c ON c.id = o.contractor_id
LEFT JOIN public.storage_chambers sc ON sc.id = l.chamber_id
WHERE l.remaining_qty > 0
  AND COALESCE(sc.control_point, '') = 'CP2'
  AND NOT EXISTS (
    SELECT 1 FROM public.haccp_documents d
    WHERE d.document_type = 'K02' AND d.lot_id = l.id
  );

-- 9) K04 dla produktów gotowych / pulpy w CP3 albo CCP1
INSERT INTO public.haccp_documents (
  document_type, lot_id, document_date, product_name, lot_no, supplier_name,
  document_no, chamber_code, qty, status, document_version, data
)
SELECT
  'K04',
  l.id,
  current_date,
  p.name,
  l.lot_no,
  COALESCE(c.name, ''),
  COALESCE(o.document_no, ''),
  COALESCE(sc.code, ''),
  COALESCE(l.remaining_qty, 0),
  'P',
  'I/2024',
  jsonb_build_object(
    'temperatura_ok', 'P',
    'higiena_komory', 'P',
    'uwagi', ''
  )
FROM public.lots l
LEFT JOIN public.products p ON p.id = l.product_id
LEFT JOIN public.operations o ON o.id = l.source_operation_id
LEFT JOIN public.contractors c ON c.id = o.contractor_id
LEFT JOIN public.storage_chambers sc ON sc.id = l.chamber_id
WHERE l.remaining_qty > 0
  AND COALESCE(sc.control_point, '') IN ('CP3', 'CCP1')
  AND NOT EXISTS (
    SELECT 1 FROM public.haccp_documents d
    WHERE d.document_type = 'K04' AND d.lot_id = l.id
  );

-- 10) K07 – kontrola sita dla partii w CCP1 / produkcji pulpy
INSERT INTO public.haccp_documents (
  document_type, lot_id, document_date, product_name, lot_no, supplier_name,
  document_no, chamber_code, qty, status, document_version, data
)
SELECT
  'K07',
  l.id,
  current_date,
  p.name,
  l.lot_no,
  COALESCE(c.name, ''),
  COALESCE(o.document_no, ''),
  COALESCE(sc.code, ''),
  COALESCE(l.remaining_qty, 0),
  'P',
  'I/2024',
  jsonb_build_object(
    'sito_ok', 'P',
    'uwagi', ''
  )
FROM public.lots l
LEFT JOIN public.products p ON p.id = l.product_id
LEFT JOIN public.operations o ON o.id = l.source_operation_id
LEFT JOIN public.contractors c ON c.id = o.contractor_id
LEFT JOIN public.storage_chambers sc ON sc.id = l.chamber_id
WHERE l.remaining_qty > 0
  AND COALESCE(sc.control_point, '') = 'CCP1'
  AND NOT EXISTS (
    SELECT 1 FROM public.haccp_documents d
    WHERE d.document_type = 'K07' AND d.lot_id = l.id
  );

-- 11) RLS i polityki
ALTER TABLE public.haccp_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.haccp_document_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all haccp_documents v22" ON public.haccp_documents;
DROP POLICY IF EXISTS "Allow all haccp_document_history v22" ON public.haccp_document_history;
DROP POLICY IF EXISTS "Allow all haccp_documents v22_1" ON public.haccp_documents;
DROP POLICY IF EXISTS "Allow all haccp_document_history v22_1" ON public.haccp_document_history;

CREATE POLICY "Allow all haccp_documents v22_1"
ON public.haccp_documents
FOR ALL TO anon
USING (true)
WITH CHECK (true);

CREATE POLICY "Allow all haccp_document_history v22_1"
ON public.haccp_document_history
FOR ALL TO anon
USING (true)
WITH CHECK (true);

COMMIT;

SELECT document_type, COUNT(*) AS liczba
FROM public.haccp_documents
GROUP BY document_type
ORDER BY document_type;
