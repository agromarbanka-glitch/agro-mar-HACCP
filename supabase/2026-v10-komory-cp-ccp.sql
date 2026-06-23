-- AGRO-MAR HACCP/FIFO v10
-- Komory CP2/CP3 i beczki CCP1 + grupy produktow.
-- Uruchomic w projekcie Supabase AGRO-MAR-HACCP po wdrozeniu paczki v10.

BEGIN;


-- 0) Upewnij się, że baza dopuszcza poprawne typy operacji.
ALTER TABLE public.operations
  DROP CONSTRAINT IF EXISTS operations_operation_type_check;
ALTER TABLE public.operations
  ADD CONSTRAINT operations_operation_type_check
  CHECK (operation_type IN ('przyjecie','sprzedaz'));

-- 1) Grupy produktow.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS product_group text;

UPDATE public.products
SET product_group = CASE
  WHEN lower(name) LIKE '%malin%' THEN 'malina'
  WHEN lower(name) LIKE '%wisn%' OR lower(name) LIKE '%wiśn%' THEN 'wisnia'
  WHEN lower(name) LIKE '%porzeczka czarna%' THEN 'porzeczka_czarna'
  WHEN lower(name) LIKE '%porzeczka czerwona%' THEN 'porzeczka_czerwona'
  WHEN lower(name) LIKE '%truskawk%' THEN 'truskawka'
  WHEN lower(name) LIKE '%aronia%' THEN 'aronia'
  WHEN lower(name) LIKE '%sliw%' OR lower(name) LIKE '%śliw%' THEN 'sliwka'
  WHEN lower(name) LIKE '%jabl%' OR lower(name) LIKE '%jabł%' THEN 'jablko'
  ELSE coalesce(product_group, 'inna')
END
WHERE product_group IS NULL OR product_group = '';

-- 2) Komory i beczki.
CREATE TABLE IF NOT EXISTS public.storage_chambers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  control_point text NOT NULL CHECK (control_point IN ('CP2','CP3','CCP1')),
  chamber_type text NOT NULL CHECK (chamber_type IN ('komora_surowca','komora_gotowego','beczka_pulpy')),
  allowed_product_group text,
  temperature_min numeric(6,2),
  temperature_max numeric(6,2),
  capacity_kg numeric(12,3),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.storage_chambers(code, name, control_point, chamber_type, temperature_min, temperature_max, capacity_kg)
VALUES
  ('CP2-1','Komora CP2-1 - surowce','CP2','komora_surowca',NULL,NULL,NULL),
  ('CP2-2','Komora CP2-2 - surowce','CP2','komora_surowca',NULL,NULL,NULL),
  ('CP3-1','Komora CP3-1 - produkty gotowe','CP3','komora_gotowego',NULL,NULL,NULL),
  ('CP3-2','Komora CP3-2 - produkty gotowe','CP3','komora_gotowego',NULL,NULL,NULL),
  ('CCP1-1','Beczka CCP1-1 - pulpa','CCP1','beczka_pulpy',NULL,NULL,NULL),
  ('CCP1-2','Beczka CCP1-2 - pulpa','CCP1','beczka_pulpy',NULL,NULL,NULL),
  ('CCP1-3','Beczka CCP1-3 - pulpa','CCP1','beczka_pulpy',NULL,NULL,NULL),
  ('CCP1-4','Beczka CCP1-4 - pulpa','CCP1','beczka_pulpy',NULL,NULL,NULL)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  control_point = EXCLUDED.control_point,
  chamber_type = EXCLUDED.chamber_type,
  is_active = true;

-- 3) Przypisanie partii do komory/beczki.
ALTER TABLE public.lots
  ADD COLUMN IF NOT EXISTS storage_chamber_id uuid REFERENCES public.storage_chambers(id),
  ADD COLUMN IF NOT EXISTS product_group text;

UPDATE public.lots l
SET product_group = p.product_group
FROM public.products p
WHERE p.id = l.product_id
  AND (l.product_group IS NULL OR l.product_group = '');


-- 3a) Przypisz istniejące aktywne partie bez komory do bezpiecznych komór według grupy.
-- Nie miesza różnych grup w jednej komorze: jedna grupa = jedna komora.
WITH active_groups AS (
  SELECT DISTINCT product_group
  FROM public.lots
  WHERE storage_chamber_id IS NULL
    AND remaining_qty > 0
    AND product_group IS NOT NULL
), ranked AS (
  SELECT product_group, row_number() OVER (ORDER BY product_group) AS rn
  FROM active_groups
  WHERE product_group NOT LIKE '%pulpa%'
), cp2_chambers AS (
  SELECT id, row_number() OVER (ORDER BY code) AS rn
  FROM public.storage_chambers
  WHERE control_point = 'CP2'
), assignments AS (
  SELECT r.product_group, c.id AS chamber_id
  FROM ranked r
  JOIN cp2_chambers c ON c.rn = r.rn
)
UPDATE public.lots l
SET storage_chamber_id = a.chamber_id
FROM assignments a
WHERE l.storage_chamber_id IS NULL
  AND l.remaining_qty > 0
  AND l.product_group = a.product_group;

-- Pulpy domyślnie kieruj do pierwszej beczki CCP1, jeśli nie mają komory.
UPDATE public.lots l
SET storage_chamber_id = c.id
FROM public.storage_chambers c
WHERE l.storage_chamber_id IS NULL
  AND l.remaining_qty > 0
  AND l.product_group LIKE '%malina%'
  AND lower(coalesce((SELECT p.name FROM public.products p WHERE p.id = l.product_id), '')) LIKE '%pulpa%'
  AND c.code = 'CCP1-1';

-- 4) Widok kontroli komor.
CREATE OR REPLACE VIEW public.v_chamber_status AS
SELECT
  c.id AS chamber_id,
  c.code,
  c.name,
  c.control_point,
  c.chamber_type,
  COALESCE(string_agg(DISTINCT p.product_group, ', '), '') AS product_groups,
  COALESCE(string_agg(DISTINCT p.name, ', '), '') AS products,
  COALESCE(SUM(l.remaining_qty), 0) AS remaining_qty,
  COUNT(l.id) FILTER (WHERE l.remaining_qty > 0) AS active_lots
FROM public.storage_chambers c
LEFT JOIN public.lots l ON l.storage_chamber_id = c.id AND l.remaining_qty > 0
LEFT JOIN public.products p ON p.id = l.product_id
GROUP BY c.id, c.code, c.name, c.control_point, c.chamber_type
ORDER BY c.control_point, c.code;

-- 5) RLS / polityki dla anon tak jak reszta aplikacji testowej.
ALTER TABLE public.storage_chambers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all storage_chambers" ON public.storage_chambers;
CREATE POLICY "Allow all storage_chambers" ON public.storage_chambers
  FOR ALL TO anon USING (true) WITH CHECK (true);

COMMIT;

-- Kontrola po migracji.
SELECT code, name, control_point, chamber_type
FROM public.storage_chambers
ORDER BY code;
