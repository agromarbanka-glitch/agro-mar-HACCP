-- v49: rozdzielenie pozycji WZ w FIFO/K03 – każda pozycja operation_items = osobna partia.
-- Uruchom w Supabase SQL Editor po v48.

BEGIN;

ALTER TABLE public.fifo_allocations
  ADD COLUMN IF NOT EXISTS operation_item_id uuid REFERENCES public.operation_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS fifo_allocations_operation_item_idx
  ON public.fifo_allocations (operation_item_id)
  WHERE operation_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS fifo_allocations_op_product_item_idx
  ON public.fifo_allocations (operation_id, product_id, operation_item_id);

COMMIT;
