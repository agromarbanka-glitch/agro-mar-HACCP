-- AGRO-MAR HACCP/FIFO v14
-- Uporządkowanie grup magazynowych i przygotowanie dalszej produkcji/przerobu.
-- Uruchamiać wyłącznie w projekcie Supabase AGRO-MAR-HACCP.

BEGIN;

-- 1) Rozdziel grupy magazynowe jabłek:
--    Jabłko przemysłowe i Jabłko na obierkę NIE są już jedną grupą „jablko”.
UPDATE public.products
SET product_group = CASE
  WHEN lower(name) LIKE '%obier%' THEN 'jab_obier'
  WHEN lower(name) LIKE '%jabł%' OR lower(name) LIKE '%jabl%' THEN 'jab_przem'
  ELSE product_group
END
WHERE lower(name) LIKE '%jabł%' OR lower(name) LIKE '%jabl%' OR lower(name) LIKE '%obier%';

-- 2) Ustal prawidłowe kody produktów.
UPDATE public.products
SET code = 'Jabobier'
WHERE lower(name) LIKE '%obier%';

UPDATE public.products
SET code = 'Jab'
WHERE (lower(name) LIKE '%jabł%' OR lower(name) LIKE '%jabl%')
  AND lower(name) NOT LIKE '%obier%';

-- 3) Przenieś nowe grupy do istniejących partii.
UPDATE public.lots l
SET product_group = p.product_group
FROM public.products p
WHERE p.id = l.product_id;

-- 4) Upewnij się, że produkcja jest dozwolonym typem operacji.
ALTER TABLE public.operations
DROP CONSTRAINT IF EXISTS operations_operation_type_check;

ALTER TABLE public.operations
ADD CONSTRAINT operations_operation_type_check
CHECK (operation_type IN ('przyjecie','sprzedaz','produkcja'));

-- 5) Funkcja numeracji partii po aktualnym kodzie produktu.
CREATE OR REPLACE FUNCTION public.generate_lot_no(p_product_id uuid, p_date date)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_year int := extract(year from p_date)::int;
  v_code text;
  v_number int;
BEGIN
  SELECT code INTO v_code FROM public.products WHERE id = p_product_id;
  IF v_code IS NULL OR length(trim(v_code)) = 0 THEN
    RAISE EXCEPTION 'Nie znaleziono kodu produktu dla numeru partii';
  END IF;

  INSERT INTO public.lot_sequences(product_id, year, next_number)
  VALUES (p_product_id, v_year, 2)
  ON CONFLICT (product_id, year)
  DO UPDATE SET next_number = public.lot_sequences.next_number + 1
  RETURNING next_number - 1 INTO v_number;

  RETURN v_code || '/' || lpad(v_number::text, 3, '0') || '/' || v_year::text;
END;
$$;

-- 6) Widok kontrolny magazynu partii.
CREATE OR REPLACE VIEW public.v_active_lots_magazyn AS
SELECT
  l.id,
  l.lot_no,
  l.production_date,
  l.initial_qty,
  l.remaining_qty,
  l.status,
  l.product_group,
  p.name AS product_name,
  p.code AS product_code,
  sc.code AS chamber_code,
  sc.name AS chamber_name,
  sc.control_point
FROM public.lots l
JOIN public.products p ON p.id = l.product_id
LEFT JOIN public.storage_chambers sc ON sc.id = l.storage_chamber_id
WHERE l.remaining_qty > 0
ORDER BY l.production_date, l.created_at;

COMMIT;

-- Kontrola po wdrożeniu.
SELECT product_group, COUNT(*) AS aktywne_partie, SUM(remaining_qty) AS pozostalo_kg
FROM public.lots
WHERE remaining_qty > 0
GROUP BY product_group
ORDER BY product_group;
