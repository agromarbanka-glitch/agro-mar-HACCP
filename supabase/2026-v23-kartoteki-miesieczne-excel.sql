-- v23: bezpieczne uzupełnienie pól pod kartoteki miesięczne, podpisy, edycję i eksport.
ALTER TABLE public.haccp_documents ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE public.haccp_documents ADD COLUMN IF NOT EXISTS signed_by_operator text;
ALTER TABLE public.haccp_documents ADD COLUMN IF NOT EXISTS signed_by_admin text;
ALTER TABLE public.haccp_documents ADD COLUMN IF NOT EXISTS document_version text DEFAULT 'I/2024';
ALTER TABLE public.haccp_documents ADD COLUMN IF NOT EXISTS status text DEFAULT 'P';
ALTER TABLE public.haccp_documents ADD COLUMN IF NOT EXISTS data jsonb DEFAULT '{}'::jsonb;
UPDATE public.haccp_documents
SET status = COALESCE(status, 'P'),
    data = COALESCE(data, '{}'::jsonb),
    document_version = COALESCE(document_version, 'I/2024')
WHERE status IS NULL OR data IS NULL OR document_version IS NULL;
CREATE TABLE IF NOT EXISTS public.haccp_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  role_name text DEFAULT 'przyjmujący',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.haccp_document_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid REFERENCES public.haccp_documents(id) ON DELETE CASCADE,
  action text NOT NULL,
  field_name text,
  old_value text,
  new_value text,
  reason text,
  changed_by text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.haccp_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.haccp_document_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all haccp_employees" ON public.haccp_employees;
CREATE POLICY "Allow all haccp_employees" ON public.haccp_employees FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow all haccp_document_history" ON public.haccp_document_history;
CREATE POLICY "Allow all haccp_document_history" ON public.haccp_document_history FOR ALL TO anon USING (true) WITH CHECK (true);
SELECT document_type, COUNT(*) FROM public.haccp_documents GROUP BY document_type ORDER BY document_type;
