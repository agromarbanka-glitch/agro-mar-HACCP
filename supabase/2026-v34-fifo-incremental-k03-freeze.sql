-- v34 AGRO-MAR: FIFO przyrostowy + zamrożone K03 + historia zmian rozliczeń
BEGIN;

CREATE TABLE IF NOT EXISTS public.fifo_allocation_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wz_no text,
  wz_date date,
  product_name text,
  k03_key text,
  change_type text NOT NULL DEFAULT 'allocation_changed',
  before_data jsonb,
  after_data jsonb,
  change_reason text,
  changed_by text DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fifo_allocation_change_log_created_idx
  ON public.fifo_allocation_change_log (created_at DESC);

CREATE INDEX IF NOT EXISTS haccp_documents_k03_key_idx
  ON public.haccp_documents ((data->>'k03_key'))
  WHERE document_type = 'K03';

ALTER TABLE public.fifo_allocation_change_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all fifo_allocation_change_log" ON public.fifo_allocation_change_log;
CREATE POLICY "Allow all fifo_allocation_change_log"
  ON public.fifo_allocation_change_log FOR ALL TO anon
  USING (true) WITH CHECK (true);

COMMIT;
