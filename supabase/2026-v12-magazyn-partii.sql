-- AGRO-MAR HACCP/FIFO v12
-- Moduł magazynowy partii: przypisanie/przeniesienie partii do komór CP/CCP,
-- historia lokalizacji oraz zabezpieczenie przed mieszaniem grup asortymentowych.
-- Uruchamiać wyłącznie w projekcie Supabase AGRO-MAR-HACCP.

BEGIN;

ALTER TABLE public.lots
ADD COLUMN IF NOT EXISTS storage_chamber_id uuid REFERENCES public.storage_chambers(id),
ADD COLUMN IF NOT EXISTS product_group text;

CREATE TABLE IF NOT EXISTS public.lot_location_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id uuid NOT NULL REFERENCES public.lots(id) ON DELETE CASCADE,
  old_chamber_id uuid REFERENCES public.storage_chambers(id),
  new_chamber_id uuid REFERENCES public.storage_chambers(id),
  product_group text,
  reason text NOT NULL,
  changed_by_role text NOT NULL DEFAULT 'admin',
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lot_location_history_lot_id_idx ON public.lot_location_history(lot_id);
CREATE INDEX IF NOT EXISTS lot_location_history_new_chamber_idx ON public.lot_location_history(new_chamber_id);

ALTER TABLE public.lot_location_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all lot_location_history" ON public.lot_location_history;
CREATE POLICY "Allow all lot_location_history"
ON public.lot_location_history FOR ALL TO anon
USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update lots" ON public.lots;
CREATE POLICY "Allow update lots"
ON public.lots FOR UPDATE TO anon
USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all storage_chambers" ON public.storage_chambers;
CREATE POLICY "Allow all storage_chambers"
ON public.storage_chambers FOR ALL TO anon
USING (true) WITH CHECK (true);

-- Uzupełnij product_group dla istniejących partii na podstawie produktów.
UPDATE public.lots l
SET product_group = COALESCE(l.product_group, p.product_group,
  CASE
    WHEN lower(p.name) LIKE '%malin%' THEN 'malina'
    WHEN lower(p.name) LIKE '%wiś%' OR lower(p.name) LIKE '%wis%' THEN 'wisnia'
    WHEN lower(p.name) LIKE '%porzeczka czarna%' THEN 'porzeczka_czarna'
    WHEN lower(p.name) LIKE '%porzeczka czerwona%' THEN 'porzeczka_czerwona'
    WHEN lower(p.name) LIKE '%truskawk%' THEN 'truskawka'
    WHEN lower(p.name) LIKE '%aron%' THEN 'aronia'
    WHEN lower(p.name) LIKE '%śliw%' OR lower(p.name) LIKE '%sliw%' THEN 'sliwka'
    WHEN lower(p.name) LIKE '%jabł%' OR lower(p.name) LIKE '%jabl%' THEN 'jablko'
    ELSE 'inna'
  END)
FROM public.products p
WHERE p.id = l.product_id
  AND l.product_group IS NULL;

COMMIT;

SELECT 'v12 magazyn partii ready' AS status;
