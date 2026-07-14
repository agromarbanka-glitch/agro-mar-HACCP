-- v45: Wartość magazynu (raport Excel FIFO) — osobno od HACCP / magazynu partii
-- Uruchom w Supabase SQL Editor → Run
-- Nie dotyka: operations, lots, fifo_allocations, haccp_documents

BEGIN;

CREATE TABLE IF NOT EXISTS public.warehouse_value_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name text NOT NULL DEFAULT 'import.xlsx',
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  uploaded_by text,
  row_count integer NOT NULL DEFAULT 0,
  duplicate_count integer NOT NULL DEFAULT 0,
  engine_version text NOT NULL DEFAULT '2.5',
  notes text
);

CREATE TABLE IF NOT EXISTS public.warehouse_value_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.warehouse_value_batches(id) ON DELETE CASCADE,
  dedup_key text NOT NULL,
  document_type text,
  document_no text NOT NULL,
  issue_date date NOT NULL,
  qty numeric(14, 3) NOT NULL,
  unit_net_price numeric(14, 4),
  product_name text NOT NULL,
  row_no integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT warehouse_value_lines_dedup_key_unique UNIQUE (dedup_key)
);

CREATE INDEX IF NOT EXISTS warehouse_value_lines_issue_date_idx
  ON public.warehouse_value_lines (issue_date);

CREATE INDEX IF NOT EXISTS warehouse_value_lines_batch_id_idx
  ON public.warehouse_value_lines (batch_id);

CREATE TABLE IF NOT EXISTS public.warehouse_value_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  as_of_date date NOT NULL,
  year_month text NOT NULL,
  engine_version text NOT NULL DEFAULT '2.5',
  report_title text,
  totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb,
  saved_at timestamptz NOT NULL DEFAULT now(),
  saved_by text,
  CONSTRAINT warehouse_value_snapshots_as_of_unique UNIQUE (as_of_date)
);

ALTER TABLE public.warehouse_value_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_value_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_value_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "warehouse_value_batches_auth" ON public.warehouse_value_batches;
CREATE POLICY "warehouse_value_batches_auth" ON public.warehouse_value_batches
  FOR ALL TO authenticated
  USING (public.is_active_app_user())
  WITH CHECK (public.is_active_app_user());

DROP POLICY IF EXISTS "warehouse_value_lines_auth" ON public.warehouse_value_lines;
CREATE POLICY "warehouse_value_lines_auth" ON public.warehouse_value_lines
  FOR ALL TO authenticated
  USING (public.is_active_app_user())
  WITH CHECK (public.is_active_app_user());

DROP POLICY IF EXISTS "warehouse_value_snapshots_auth" ON public.warehouse_value_snapshots;
CREATE POLICY "warehouse_value_snapshots_auth" ON public.warehouse_value_snapshots
  FOR ALL TO authenticated
  USING (public.is_active_app_user())
  WITH CHECK (public.is_active_app_user());

-- Fallback anon (dev bez logowania)
DROP POLICY IF EXISTS "warehouse_value_batches_anon" ON public.warehouse_value_batches;
CREATE POLICY "warehouse_value_batches_anon" ON public.warehouse_value_batches
  FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "warehouse_value_lines_anon" ON public.warehouse_value_lines;
CREATE POLICY "warehouse_value_lines_anon" ON public.warehouse_value_lines
  FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "warehouse_value_snapshots_anon" ON public.warehouse_value_snapshots;
CREATE POLICY "warehouse_value_snapshots_anon" ON public.warehouse_value_snapshots
  FOR ALL TO anon USING (true) WITH CHECK (true);

COMMIT;
