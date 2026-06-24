-- v24.2 - bezpieczne uzupełnienie pracowników i podpisów dla K01

CREATE TABLE IF NOT EXISTS public.haccp_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  role_name text DEFAULT 'przyjmujący',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.haccp_documents
  ADD COLUMN IF NOT EXISTS signed_by_operator text,
  ADD COLUMN IF NOT EXISTS signed_by_admin text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE TABLE IF NOT EXISTS public.haccp_document_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid,
  action text NOT NULL,
  field_name text,
  old_value text,
  new_value text,
  reason text,
  created_by text DEFAULT 'system',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.haccp_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.haccp_document_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all haccp_employees" ON public.haccp_employees;
CREATE POLICY "Allow all haccp_employees" ON public.haccp_employees
FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all haccp_document_history" ON public.haccp_document_history;
CREATE POLICY "Allow all haccp_document_history" ON public.haccp_document_history
FOR ALL TO anon USING (true) WITH CHECK (true);

-- Ustaw domyślne P/N dla K01, jeśli brakuje
UPDATE public.haccp_documents
SET data = COALESCE(data, '{}'::jsonb)
  || jsonb_build_object(
    'stan_higieniczny_pojazdu', COALESCE(data->>'stan_higieniczny_pojazdu', 'P'),
    'wybarwienie_zapach_brak_uszkodzen', COALESCE(data->>'wybarwienie_zapach_brak_uszkodzen', 'P'),
    'brak_zgnilizny_zaplesnienia_zagrzybienia', COALESCE(data->>'brak_zgnilizny_zaplesnienia_zagrzybienia', 'P')
  )
WHERE document_type = 'K01';

SELECT 'v24.2 ok' AS status;
