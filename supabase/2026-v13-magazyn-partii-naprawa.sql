-- AGRO-MAR HACCP/FIFO v13
-- Naprawa magazynu partii i kodu Jabłko na obierkę = Jabobier.
-- Uruchamiać wyłącznie w projekcie Supabase AGRO-MAR-HACCP.

BEGIN;

-- 1) Ujednolicenie kodu produktu „Jabłko na obierkę / Jabłko obierka”.
UPDATE public.products
SET code = 'Jabobier',
    product_group = COALESCE(product_group, 'jablko')
WHERE lower(name) LIKE '%obier%'
  AND code IS DISTINCT FROM 'Jabobier';

-- 2) Jabłko przemysłowe powinno mieć kod Jab.
UPDATE public.products
SET code = 'Jab',
    product_group = COALESCE(product_group, 'jablko')
WHERE (lower(name) LIKE '%jabłko przemysłowe%' OR lower(name) LIKE '%jablko przemyslowe%')
  AND code IS DISTINCT FROM 'Jab';

-- 3) Popraw stare numery partii, jeśli jeszcze gdzieś zostały.
UPDATE public.lots
SET lot_no = REPLACE(lot_no, 'Jablkona/', 'Jabobier/')
WHERE lot_no LIKE 'Jablkona/%';

-- 4) Uzupełnij grupy produktów w produktach.
UPDATE public.products
SET product_group = CASE
  WHEN lower(name) LIKE '%malin%' THEN 'malina'
  WHEN lower(name) LIKE '%wiś%' OR lower(name) LIKE '%wis%' THEN 'wisnia'
  WHEN lower(name) LIKE '%porzeczka czarna%' THEN 'porzeczka_czarna'
  WHEN lower(name) LIKE '%porzeczka czerwona%' THEN 'porzeczka_czerwona'
  WHEN lower(name) LIKE '%truskawk%' THEN 'truskawka'
  WHEN lower(name) LIKE '%aron%' THEN 'aronia'
  WHEN lower(name) LIKE '%śliw%' OR lower(name) LIKE '%sliw%' THEN 'sliwka'
  WHEN lower(name) LIKE '%jabł%' OR lower(name) LIKE '%jabl%' THEN 'jablko'
  ELSE COALESCE(product_group, 'inna')
END
WHERE product_group IS NULL OR product_group = '';

-- 5) Uzupełnij grupy produktów w partiach.
UPDATE public.lots l
SET product_group = p.product_group
FROM public.products p
WHERE p.id = l.product_id
  AND (l.product_group IS NULL OR l.product_group = '');

-- 6) Funkcja numeracji partii korzysta zawsze z aktualnego kodu produktu.
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

-- 7) Widok kontrolny aktywnych partii z produktami i komorami.
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

SELECT 'v13 magazyn partii naprawiony' AS status;
