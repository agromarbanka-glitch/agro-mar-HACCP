-- AGRO-MAR HACCP/FIFO v20
-- Poprawka generowania dokumentów HACCP po v19.
-- Przyczyna: wcześniejszy SQL używał l.chamber_id, a baza pracuje na l.storage_chamber_id.
-- Efekt: K01 było utworzone, ale K02/K04/K07 nie powstawały.

BEGIN;

-- 1) Ujednolicenie kolumn komory: zostawiamy obie, ale synchronizujemy chamber_id ze storage_chamber_id.
ALTER TABLE public.lots
  ADD COLUMN IF NOT EXISTS storage_chamber_id uuid REFERENCES public.storage_chambers(id),
  ADD COLUMN IF NOT EXISTS chamber_id uuid REFERENCES public.storage_chambers(id),
  ADD COLUMN IF NOT EXISTS product_group text;

UPDATE public.lots
SET chamber_id = storage_chamber_id
WHERE chamber_id IS NULL AND storage_chamber_id IS NOT NULL;

UPDATE public.lots
SET storage_chamber_id = chamber_id
WHERE storage_chamber_id IS NULL AND chamber_id IS NOT NULL;

UPDATE public.lots l
SET product_group = p.product_group
FROM public.products p
WHERE p.id = l.product_id
  AND (l.product_group IS NULL OR l.product_group <> p.product_group);

-- 2) Funkcja pól P/N: zawsze domyślnie P, z możliwością zmiany na N w aplikacji.
CREATE OR REPLACE FUNCTION public.default_haccp_pn_fields(doc_type text)
RETURNS jsonb
LANGUAGE sql
AS $$
  SELECT CASE
    WHEN doc_type = 'K01' THEN jsonb_build_object(
      'stan_higieniczny_pojazdu', 'P',
      'wybarwienie_zapach_brak_uszkodzen', 'P',
      'brak_zgnilizny_zaplesnienia_zagrzybienia', 'P',
      'uwagi', '',
      'podpis', ''
    )
    WHEN doc_type = 'K02' THEN jsonb_build_object(
      'stan_komory', 'P',
      'temperatura_prawidlowa', 'P',
      'czystosc', 'P',
      'temperatura', '',
      'uwagi', '',
      'podpis', ''
    )
    WHEN doc_type = 'K04' THEN jsonb_build_object(
      'stan_komory', 'P',
      'temperatura_prawidlowa', 'P',
      'czystosc', 'P',
      'temperatura', '',
      'uwagi', '',
      'podpis', ''
    )
    WHEN doc_type = 'K07' THEN jsonb_build_object(
      'stan_sita', 'P',
      'sito_cale', 'P',
      'uwagi', '',
      'podpis', ''
    )
    ELSE '{}'::jsonb
  END;
$$;

-- 3) K02: magazynowanie surowca CP2.
-- Tworzymy dla partii znajdujących się w komorach CP2.
INSERT INTO public.haccp_documents (
  document_type, lot_id, operation_id, document_date, product_name, lot_no,
  supplier_name, document_no, chamber_code, qty, data
)
SELECT
  'K02', l.id, l.source_operation_id,
  COALESCE(o.operation_date, l.production_date, current_date),
  p.name, l.lot_no, c.name, o.document_no, sc.code,
  CASE WHEN l.remaining_qty > 0 THEN l.remaining_qty ELSE l.initial_qty END,
  public.default_haccp_pn_fields('K02')
FROM public.lots l
LEFT JOIN public.products p ON p.id = l.product_id
LEFT JOIN public.operations o ON o.id = l.source_operation_id
LEFT JOIN public.contractors c ON c.id = o.contractor_id
LEFT JOIN public.storage_chambers sc ON sc.id = COALESCE(l.storage_chamber_id, l.chamber_id)
WHERE sc.control_point = 'CP2'
  AND NOT EXISTS (
    SELECT 1 FROM public.haccp_documents d
    WHERE d.document_type = 'K02' AND d.lot_id = l.id
  );

-- 4) K04: magazynowanie produktu gotowego CP3/CCP1.
-- Pojawi się dla partii gotowych/pulpowych, gdy będą przypisane do CP3 albo CCP1.
INSERT INTO public.haccp_documents (
  document_type, lot_id, operation_id, document_date, product_name, lot_no,
  supplier_name, document_no, chamber_code, qty, data
)
SELECT
  'K04', l.id, l.source_operation_id,
  COALESCE(o.operation_date, l.production_date, current_date),
  p.name, l.lot_no, c.name, o.document_no, sc.code,
  CASE WHEN l.remaining_qty > 0 THEN l.remaining_qty ELSE l.initial_qty END,
  public.default_haccp_pn_fields('K04')
FROM public.lots l
LEFT JOIN public.products p ON p.id = l.product_id
LEFT JOIN public.operations o ON o.id = l.source_operation_id
LEFT JOIN public.contractors c ON c.id = o.contractor_id
LEFT JOIN public.storage_chambers sc ON sc.id = COALESCE(l.storage_chamber_id, l.chamber_id)
WHERE sc.control_point IN ('CP3', 'CCP1')
  AND NOT EXISTS (
    SELECT 1 FROM public.haccp_documents d
    WHERE d.document_type = 'K04' AND d.lot_id = l.id
  );

-- 5) K07: kontrola sita dla przerobu/CCP1.
-- Pojawi się dla partii w CCP1; po pierwszym realnym przerobie powinny powstać automatycznie.
INSERT INTO public.haccp_documents (
  document_type, lot_id, operation_id, document_date, product_name, lot_no,
  supplier_name, document_no, chamber_code, qty, data
)
SELECT
  'K07', l.id, l.source_operation_id,
  COALESCE(o.operation_date, l.production_date, current_date),
  p.name, l.lot_no, c.name, o.document_no, sc.code,
  CASE WHEN l.remaining_qty > 0 THEN l.remaining_qty ELSE l.initial_qty END,
  public.default_haccp_pn_fields('K07')
FROM public.lots l
LEFT JOIN public.products p ON p.id = l.product_id
LEFT JOIN public.operations o ON o.id = l.source_operation_id
LEFT JOIN public.contractors c ON c.id = o.contractor_id
LEFT JOIN public.storage_chambers sc ON sc.id = COALESCE(l.storage_chamber_id, l.chamber_id)
WHERE sc.control_point = 'CCP1'
  AND NOT EXISTS (
    SELECT 1 FROM public.haccp_documents d
    WHERE d.document_type = 'K07' AND d.lot_id = l.id
  );

-- 6) Widok liczników dokumentów.
CREATE OR REPLACE VIEW public.v_haccp_document_counts AS
SELECT document_type, COUNT(*) AS liczba
FROM public.haccp_documents
GROUP BY document_type
ORDER BY document_type;

COMMIT;

SELECT document_type, COUNT(*) AS liczba
FROM public.haccp_documents
GROUP BY document_type
ORDER BY document_type;
