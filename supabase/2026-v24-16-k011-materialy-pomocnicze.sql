CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.haccp_aux_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_date date NOT NULL,
  item_name text NOT NULL,
  supplier_invoice text NOT NULL,
  vehicle_hygiene text NOT NULL DEFAULT 'P' CHECK (vehicle_hygiene IN ('P','N')),
  qty text,
  lot_no text,
  notes text,
  signed_by text,
  source_filename text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.haccp_aux_materials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all haccp_aux_materials v2416" ON public.haccp_aux_materials;
CREATE POLICY "Allow all haccp_aux_materials v2416"
ON public.haccp_aux_materials
FOR ALL TO anon
USING (true)
WITH CHECK (true);

SELECT COUNT(*) AS k011_materialy_pomocnicze FROM public.haccp_aux_materials;
