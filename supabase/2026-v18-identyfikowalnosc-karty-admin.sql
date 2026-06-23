-- v18: Identyfikowalność + dokumenty K01/K02/K04 + admin override mieszania komór

BEGIN;

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

-- Domyślne wartości P/N dla K01/K02/K04: P, ale użytkownik może zmienić na N.
CREATE OR REPLACE FUNCTION public.default_haccp_pn_fields(doc_type text)
RETURNS jsonb
LANGUAGE sql
AS $$
  SELECT CASE
    WHEN doc_type = 'K01' THEN jsonb_build_object(
      'stan_higieniczny_pojazdu', 'P',
      'wybarwienie_zapach_brak_uszkodzen', 'P',
      'brak_zgnilizny_zaplesnienia_zagrzybienia', 'P',
      'uwagi', ''
    )
    WHEN doc_type = 'K02' THEN jsonb_build_object(
      'stan_komory', 'P',
      'temperatura_prawidlowa', 'P',
      'czystosc', 'P',
      'uwagi', ''
    )
    WHEN doc_type = 'K04' THEN jsonb_build_object(
      'stan_komory', 'P',
      'temperatura_prawidlowa', 'P',
      'czystosc', 'P',
      'uwagi', ''
    )
    ELSE '{}'::jsonb
  END;
$$;

-- Widok identyfikowalności partii
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

-- Startowe dokumenty K01 dla przyjęć, bez duplikowania istniejących
INSERT INTO public.haccp_documents (
  document_type, lot_id, operation_id, document_date, product_name, lot_no,
  supplier_name, document_no, chamber_code, qty, data
)
SELECT
  'K01',
  l.id,
  l.source_operation_id,
  COALESCE(o.operation_date, l.production_date),
  p.name,
  l.lot_no,
  c.name,
  o.document_no,
  sc.code,
  l.initial_qty,
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

COMMIT;

SELECT document_type, COUNT(*) AS liczba
FROM public.haccp_documents
GROUP BY document_type
ORDER BY document_type;
