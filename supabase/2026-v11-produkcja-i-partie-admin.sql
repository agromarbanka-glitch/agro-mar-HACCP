-- AGRO-MAR HACCP/FIFO v11
-- Produkcja / przerób, historia zmiany numeru partii, uprawnienia admin/magazynier.
-- Uruchamiać wyłącznie w projekcie Supabase AGRO-MAR-HACCP.

ALTER TABLE public.operations
DROP CONSTRAINT IF EXISTS operations_operation_type_check;

ALTER TABLE public.operations
ADD CONSTRAINT operations_operation_type_check
CHECK (operation_type IN ('przyjecie','sprzedaz','produkcja'));

CREATE TABLE IF NOT EXISTS public.lot_change_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id uuid NOT NULL REFERENCES public.lots(id) ON DELETE CASCADE,
  old_lot_no text NOT NULL,
  new_lot_no text NOT NULL,
  reason text NOT NULL,
  changed_by_role text NOT NULL DEFAULT 'admin',
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lot_change_history_lot_id_idx ON public.lot_change_history(lot_id);

ALTER TABLE public.lot_change_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all lot_change_history" ON public.lot_change_history;
CREATE POLICY "Allow all lot_change_history"
ON public.lot_change_history FOR ALL TO anon
USING (true) WITH CHECK (true);

-- Aplikacja testowa używa anon key, dlatego na tym etapie dopuszczamy update lots.
-- Docelowo, po pełnym logowaniu, update numeru partii ograniczymy rolą admin po stronie RLS/auth.
DROP POLICY IF EXISTS "Allow update lots" ON public.lots;
CREATE POLICY "Allow update lots"
ON public.lots FOR UPDATE TO anon
USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all operations" ON public.operations;
CREATE POLICY "Allow all operations"
ON public.operations FOR ALL TO anon
USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all operation_items" ON public.operation_items;
CREATE POLICY "Allow all operation_items"
ON public.operation_items FOR ALL TO anon
USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all fifo_allocations" ON public.fifo_allocations;
CREATE POLICY "Allow all fifo_allocations"
ON public.fifo_allocations FOR ALL TO anon
USING (true) WITH CHECK (true);

-- Kontrola po wdrożeniu.
SELECT 'v11 ready' AS status;
