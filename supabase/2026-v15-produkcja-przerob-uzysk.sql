-- AGRO-MAR HACCP/FIFO v15
-- Produkcja/przerób: uzysk, pulpy, historia powiązania partii wejściowej z wyjściową.
-- Uruchamiać wyłącznie w projekcie Supabase AGRO-MAR-HACCP.

BEGIN;

-- Produkcja musi być dozwolonym typem operacji.
ALTER TABLE public.operations
DROP CONSTRAINT IF EXISTS operations_operation_type_check;

ALTER TABLE public.operations
ADD CONSTRAINT operations_operation_type_check
CHECK (operation_type IN ('przyjecie','sprzedaz','produkcja'));

-- Uzupełnij/ustaw produkty gotowe pulpowe i kody partii.
INSERT INTO public.products (name, code, product_type, product_group, is_active)
VALUES
  ('Malina pulpa', 'Mp', 'produkt_gotowy', 'malina', true),
  ('Porzeczka czarna pulpa', 'Pczp', 'produkt_gotowy', 'porzeczka_czarna', true),
  ('Porzeczka czerwona pulpa', 'Pkp', 'produkt_gotowy', 'porzeczka_czerwona', true),
  ('Jabłko pulpa', 'Jp', 'produkt_gotowy', 'jab_pulpa', true)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    product_type = EXCLUDED.product_type,
    product_group = EXCLUDED.product_group,
    is_active = true;

UPDATE public.products SET code = 'Jabobier', product_group = 'jab_obier'
WHERE lower(name) LIKE '%obier%';

UPDATE public.products SET code = 'Jab', product_group = 'jab_przem'
WHERE (lower(name) LIKE '%jabł%' OR lower(name) LIKE '%jabl%')
  AND lower(name) NOT LIKE '%obier%'
  AND lower(name) NOT LIKE '%pulpa%';

UPDATE public.lots l
SET product_group = p.product_group
FROM public.products p
WHERE p.id = l.product_id;

-- Widok śledzenia produkcji: partia wejściowa -> partia wyjściowa.
CREATE OR REPLACE VIEW public.v_production_trace AS
SELECT
  fa.id AS trace_id,
  o.document_no,
  o.operation_date,
  src.lot_no AS source_lot_no,
  srcp.name AS source_product,
  fa.qty AS input_qty,
  outl.lot_no AS output_lot_no,
  outp.name AS output_product,
  outl.initial_qty AS output_qty,
  CASE WHEN fa.qty > 0 THEN round((outl.initial_qty / fa.qty) * 100, 2) ELSE NULL END AS yield_percent
FROM public.fifo_allocations fa
JOIN public.operations o ON o.id = fa.operation_id
LEFT JOIN public.lots src ON src.id = fa.source_lot_id
LEFT JOIN public.products srcp ON srcp.id = src.product_id
LEFT JOIN public.lots outl ON outl.id = fa.output_lot_id
LEFT JOIN public.products outp ON outp.id = outl.product_id
WHERE o.operation_type = 'produkcja'
ORDER BY o.operation_date DESC, o.created_at DESC;

COMMIT;

SELECT 'v15 ready - produkcja/przerób/uzysk' AS status;
