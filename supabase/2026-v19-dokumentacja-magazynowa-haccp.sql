-- v19: Dokumentacja magazynowa HACCP: K02, K04, K07, historia komór, panel zajętości

BEGIN;

-- Upewnij się, że istnieją podstawowe kolumny/tabele z poprzednich wersji
ALTER TABLE public.lots
ADD COLUMN IF NOT EXISTS chamber_id uuid REFERENCES public.storage_chambers(id),
ADD COLUMN IF NOT EXISTS product_group text;

UPDATE public.lots l
SET product_group = p.product_group
FROM public.products p
WHERE p.id = l.product_id
  AND (l.product_group IS NULL OR l.product_group <> p.product_group);

CREATE TABLE IF NOT EXISTS public.chamber_override_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id uuid REFERENCES public.lots(id) ON DELETE SET NULL,
  chamber_id uuid REFERENCES public.storage_chambers(id) ON DELETE SET NULL,
  previous_group text,
  new_group text,
  reason text NOT NULL,
  user_role text NOT NULL DEFAULT 'administrator',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.haccp_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type text NOT NULL,
  lot_id uuid REFERENCES public.lots(id) ON DELETE SET NULL,
  operation_id uuid REFERENCES public.operations(id) ON DELETE SET NULL,
  document_date date DEFAULT current_date,
  product_name text,
  lot_no text,
  supplier_name text,
  document_no text,
  chamber_code text,
  qty numeric DEFAULT 0,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.haccp_document_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid REFERENCES public.haccp_documents(id) ON DELETE CASCADE,
  action text NOT NULL,
  before_data jsonb,
  after_data jsonb,
  reason text,
  user_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.chamber_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chamber_id uuid REFERENCES public.storage_chambers(id) ON DELETE SET NULL,
  lot_id uuid REFERENCES public.lots(id) ON DELETE SET NULL,
  from_chamber_id uuid REFERENCES public.storage_chambers(id) ON DELETE SET NULL,
  to_chamber_id uuid REFERENCES public.storage_chambers(id) ON DELETE SET NULL,
  action text NOT NULL DEFAULT 'move',
  reason text,
  user_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

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

-- Widok zajętości komór
CREATE OR REPLACE VIEW public.v_chamber_occupancy AS
SELECT
  sc.id AS chamber_id,
  sc.code AS chamber_code,
  sc.name AS chamber_name,
  sc.control_point,
  COALESCE(COUNT(l.id) FILTER (WHERE l.remaining_qty > 0), 0) AS active_lots,
  COALESCE(SUM(l.remaining_qty) FILTER (WHERE l.remaining_qty > 0), 0) AS remaining_qty,
  COALESCE(string_agg(DISTINCT l.product_group, ', ')
    FILTER (WHERE l.remaining_qty > 0 AND l.product_group IS NOT NULL), '') AS product_groups,
  CASE
    WHEN COUNT(l.id) FILTER (WHERE l.remaining_qty > 0) = 0 THEN 'wolna'
    ELSE 'zajęta'
  END AS status
FROM public.storage_chambers sc
LEFT JOIN public.lots l ON l.chamber_id = sc.id
GROUP BY sc.id, sc.code, sc.name, sc.control_point
ORDER BY sc.code;

-- Widok historii komór
CREATE OR REPLACE VIEW public.v_chamber_history AS
SELECT
  ch.id,
  ch.created_at,
  sc_from.code AS from_chamber,
  sc_to.code AS to_chamber,
  sc.code AS chamber_code,
  l.lot_no,
  p.name AS product_name,
  l.product_group,
  ch.action,
  ch.reason,
  ch.user_name
FROM public.chamber_history ch
LEFT JOIN public.storage_chambers sc ON sc.id = ch.chamber_id
LEFT JOIN public.storage_chambers sc_from ON sc_from.id = ch.from_chamber_id
LEFT JOIN public.storage_chambers sc_to ON sc_to.id = ch.to_chamber_id
LEFT JOIN public.lots l ON l.id = ch.lot_id
LEFT JOIN public.products p ON p.id = l.product_id
ORDER BY ch.created_at DESC;

-- Pełniejsza identyfikowalność partii
CREATE OR REPLACE VIEW public.v_lot_traceability AS
SELECT
  l.id AS lot_id,
  l.lot_no,
  p.name AS product_name,
  l.product_group,
  l.production_date,
  l.initial_qty,
  l.remaining_qty,
  l.status,
  sc.code AS chamber_code,
  sc.name AS chamber_name,
  o.document_no,
  o.invoice_no,
  o.operation_date,
  c.name AS contractor_name
FROM public.lots l
LEFT JOIN public.products p ON p.id = l.product_id
LEFT JOIN public.storage_chambers sc ON sc.id = l.chamber_id
LEFT JOIN public.operations o ON o.id = l.source_operation_id
LEFT JOIN public.contractors c ON c.id = o.contractor_id;

-- K01: przyjęcia surowców / istniejące partie
INSERT INTO public.haccp_documents (
  document_type, lot_id, operation_id, document_date, product_name, lot_no,
  supplier_name, document_no, chamber_code, qty, data
)
SELECT
  'K01', l.id, l.source_operation_id,
  COALESCE(o.operation_date, l.production_date),
  p.name, l.lot_no, c.name, o.document_no, sc.code, l.initial_qty,
  public.default_haccp_pn_fields('K01')
FROM public.lots l
LEFT JOIN public.products p ON p.id = l.product_id
LEFT JOIN public.operations o ON o.id = l.source_operation_id
LEFT JOIN public.contractors c ON c.id = o.contractor_id
LEFT JOIN public.storage_chambers sc ON sc.id = l.chamber_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.haccp_documents d
  WHERE d.document_type = 'K01' AND d.lot_id = l.id
);

-- K02: magazyn surowca CP2
INSERT INTO public.haccp_documents (
  document_type, lot_id, operation_id, document_date, product_name, lot_no,
  supplier_name, document_no, chamber_code, qty, data
)
SELECT
  'K02', l.id, l.source_operation_id,
  COALESCE(o.operation_date, l.production_date),
  p.name, l.lot_no, c.name, o.document_no, sc.code, l.remaining_qty,
  public.default_haccp_pn_fields('K02')
FROM public.lots l
LEFT JOIN public.products p ON p.id = l.product_id
LEFT JOIN public.operations o ON o.id = l.source_operation_id
LEFT JOIN public.contractors c ON c.id = o.contractor_id
LEFT JOIN public.storage_chambers sc ON sc.id = l.chamber_id
WHERE sc.control_point = 'CP2'
  AND NOT EXISTS (
    SELECT 1 FROM public.haccp_documents d
    WHERE d.document_type = 'K02' AND d.lot_id = l.id
  );

-- K04: magazyn produktu gotowego CP3 i CCP1
INSERT INTO public.haccp_documents (
  document_type, lot_id, operation_id, document_date, product_name, lot_no,
  supplier_name, document_no, chamber_code, qty, data
)
SELECT
  'K04', l.id, l.source_operation_id,
  COALESCE(o.operation_date, l.production_date),
  p.name, l.lot_no, c.name, o.document_no, sc.code, l.remaining_qty,
  public.default_haccp_pn_fields('K04')
FROM public.lots l
LEFT JOIN public.products p ON p.id = l.product_id
LEFT JOIN public.operations o ON o.id = l.source_operation_id
LEFT JOIN public.contractors c ON c.id = o.contractor_id
LEFT JOIN public.storage_chambers sc ON sc.id = l.chamber_id
WHERE sc.control_point IN ('CP3', 'CCP1')
  AND NOT EXISTS (
    SELECT 1 FROM public.haccp_documents d
    WHERE d.document_type = 'K04' AND d.lot_id = l.id
  );

-- K07: kontrola sita dla partii produkcyjnych/przerobu, startowo dla partii w CCP1
INSERT INTO public.haccp_documents (
  document_type, lot_id, operation_id, document_date, product_name, lot_no,
  supplier_name, document_no, chamber_code, qty, data
)
SELECT
  'K07', l.id, l.source_operation_id,
  COALESCE(o.operation_date, l.production_date),
  p.name, l.lot_no, c.name, o.document_no, sc.code, l.remaining_qty,
  public.default_haccp_pn_fields('K07')
FROM public.lots l
LEFT JOIN public.products p ON p.id = l.product_id
LEFT JOIN public.operations o ON o.id = l.source_operation_id
LEFT JOIN public.contractors c ON c.id = o.contractor_id
LEFT JOIN public.storage_chambers sc ON sc.id = l.chamber_id
WHERE sc.control_point = 'CCP1'
  AND NOT EXISTS (
    SELECT 1 FROM public.haccp_documents d
    WHERE d.document_type = 'K07' AND d.lot_id = l.id
  );

COMMIT;

SELECT document_type, COUNT(*) AS liczba
FROM public.haccp_documents
GROUP BY document_type
ORDER BY document_type;
