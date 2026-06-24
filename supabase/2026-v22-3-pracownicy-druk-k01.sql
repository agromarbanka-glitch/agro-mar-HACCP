-- v22.3 - pracownicy do podpisów, krótsze dane dostawcy i poprawiony druk K01

CREATE TABLE IF NOT EXISTS public.haccp_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  role_name text DEFAULT 'przyjmujący',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.haccp_employees ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'haccp_employees'
      AND policyname = 'Allow all haccp_employees v22_3'
  ) THEN
    CREATE POLICY "Allow all haccp_employees v22_3"
    ON public.haccp_employees
    FOR ALL TO anon
    USING (true)
    WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.haccp_documents
ADD COLUMN IF NOT EXISTS signed_by_operator text,
ADD COLUMN IF NOT EXISTS signed_by_admin text,
ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

ALTER TABLE public.haccp_document_history
ADD COLUMN IF NOT EXISTS changed_by text,
ADD COLUMN IF NOT EXISTS reason text;

-- Przepisz podpis z danych JSON, jeżeli był już uzupełniony wcześniej.
UPDATE public.haccp_documents
SET signed_by_operator = COALESCE(signed_by_operator, data->>'podpis_przyjmujacego')
WHERE document_type = 'K01';

SELECT COUNT(*) AS aktywni_pracownicy
FROM public.haccp_employees
WHERE is_active = true;
