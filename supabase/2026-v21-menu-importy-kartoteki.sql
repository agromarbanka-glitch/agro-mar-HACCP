-- AGRO-MAR HACCP/FIFO v21
-- Rejestr importów Excel, bezpieczne usuwanie importu przez administratora,
-- katalog kartotek HACCP i przygotowanie danych pod nowy układ aplikacji.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) Uzupełnienie tabeli importów.
CREATE TABLE IF NOT EXISTS public.imported_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text,
  rows_count integer DEFAULT 0,
  status text DEFAULT 'wczytany',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.imported_files
  ADD COLUMN IF NOT EXISTS filename text,
  ADD COLUMN IF NOT EXISTS rows_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'wczytany',
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by_role text,
  ADD COLUMN IF NOT EXISTS delete_reason text;

-- jeżeli starsza baza miała file_name/row_count, nie psujemy ich, tylko synchronizujemy do filename/rows_count.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='imported_files' AND column_name='file_name') THEN
    EXECUTE 'UPDATE public.imported_files SET filename = COALESCE(filename, file_name)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='imported_files' AND column_name='row_count') THEN
    EXECUTE 'UPDATE public.imported_files SET rows_count = COALESCE(rows_count, row_count)';
  END IF;
END $$;

-- 2) Powiązanie operacji z importem.
ALTER TABLE public.operations
  ADD COLUMN IF NOT EXISTS imported_file_id uuid REFERENCES public.imported_files(id),
  ADD COLUMN IF NOT EXISTS notes text;

-- 3) Log usuniętych importów.
CREATE TABLE IF NOT EXISTS public.import_deletion_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  imported_file_id uuid,
  filename text,
  deleted_at timestamptz DEFAULT now(),
  deleted_by_role text,
  delete_reason text NOT NULL,
  deleted_operations integer DEFAULT 0,
  deleted_items integer DEFAULT 0,
  deleted_lots integer DEFAULT 0,
  deleted_fifo_allocations integer DEFAULT 0
);

-- 4) Funkcja usuwania importu: tylko administrator, po stronie aplikacji są dwa potwierdzenia.
CREATE OR REPLACE FUNCTION public.delete_import_excel_admin(
  p_imported_file_id uuid,
  p_reason text,
  p_user_role text DEFAULT 'admin'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_filename text;
  v_operation_ids uuid[];
  v_lot_ids uuid[];
  v_operations_count integer := 0;
  v_items_count integer := 0;
  v_lots_count integer := 0;
  v_fifo_count integer := 0;
BEGIN
  IF COALESCE(p_user_role, '') <> 'admin' THEN
    RAISE EXCEPTION 'Tylko administrator może usuwać import Excel.';
  END IF;
  IF NULLIF(TRIM(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Powód usunięcia importu jest wymagany.';
  END IF;

  SELECT filename INTO v_filename
  FROM public.imported_files
  WHERE id = p_imported_file_id;

  IF v_filename IS NULL THEN
    RAISE EXCEPTION 'Nie znaleziono importu Excel.';
  END IF;

  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_operation_ids
  FROM public.operations
  WHERE imported_file_id = p_imported_file_id;

  SELECT COUNT(*) INTO v_operations_count FROM public.operations WHERE imported_file_id = p_imported_file_id;
  SELECT COUNT(*) INTO v_items_count FROM public.operation_items WHERE operation_id = ANY(v_operation_ids);
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_lot_ids FROM public.lots WHERE source_operation_id = ANY(v_operation_ids);
  SELECT COUNT(*) INTO v_lots_count FROM public.lots WHERE source_operation_id = ANY(v_operation_ids);

  SELECT COUNT(*) INTO v_fifo_count
  FROM public.fifo_allocations
  WHERE operation_id = ANY(v_operation_ids)
     OR source_lot_id = ANY(v_lot_ids)
     OR output_lot_id = ANY(v_lot_ids);

  DELETE FROM public.haccp_document_history
  WHERE document_id IN (
    SELECT id FROM public.haccp_documents
    WHERE operation_id = ANY(v_operation_ids) OR lot_id = ANY(v_lot_ids)
  );

  DELETE FROM public.haccp_documents
  WHERE operation_id = ANY(v_operation_ids) OR lot_id = ANY(v_lot_ids);

  DELETE FROM public.fifo_allocations
  WHERE operation_id = ANY(v_operation_ids)
     OR source_lot_id = ANY(v_lot_ids)
     OR output_lot_id = ANY(v_lot_ids);

  DELETE FROM public.operation_items
  WHERE operation_id = ANY(v_operation_ids);

  DELETE FROM public.lot_location_history WHERE lot_id = ANY(v_lot_ids);
  DELETE FROM public.lot_change_history WHERE lot_id = ANY(v_lot_ids);

  DELETE FROM public.lots
  WHERE id = ANY(v_lot_ids);

  DELETE FROM public.operations
  WHERE id = ANY(v_operation_ids);

  UPDATE public.imported_files
  SET deleted_at = now(),
      deleted_by_role = p_user_role,
      delete_reason = p_reason,
      status = 'usuniety'
  WHERE id = p_imported_file_id;

  INSERT INTO public.import_deletion_log (
    imported_file_id, filename, deleted_by_role, delete_reason,
    deleted_operations, deleted_items, deleted_lots, deleted_fifo_allocations
  ) VALUES (
    p_imported_file_id, v_filename, p_user_role, p_reason,
    v_operations_count, v_items_count, v_lots_count, v_fifo_count
  );
END;
$$;

-- 5) Widok rejestru importów z podsumowaniem.
CREATE OR REPLACE VIEW public.v_import_excel_register AS
SELECT
  f.id,
  f.filename,
  f.rows_count,
  f.status,
  f.created_at,
  f.deleted_at,
  f.deleted_by_role,
  f.delete_reason,
  COUNT(DISTINCT o.id) AS operations_count,
  COUNT(oi.id) AS items_count,
  COALESCE(SUM(ABS(oi.qty)), 0) AS total_qty,
  COUNT(DISTINCT CASE WHEN o.operation_type = 'przyjecie' THEN o.id END) AS przyjecia_count,
  COUNT(DISTINCT CASE WHEN o.operation_type = 'sprzedaz' THEN o.id END) AS sprzedaz_count,
  COUNT(DISTINCT CASE WHEN o.document_no ILIKE 'MM%' THEN o.id END) AS mm_count
FROM public.imported_files f
LEFT JOIN public.operations o ON o.imported_file_id = f.id
LEFT JOIN public.operation_items oi ON oi.operation_id = o.id
GROUP BY f.id;

-- 6) Katalog kartotek HACCP dla menu.
CREATE TABLE IF NOT EXISTS public.haccp_card_catalog (
  code text PRIMARY KEY,
  title text NOT NULL,
  category text NOT NULL,
  description text,
  sort_order integer DEFAULT 0,
  is_active boolean DEFAULT true
);

INSERT INTO public.haccp_card_catalog (code, title, category, description, sort_order, is_active)
VALUES
('K01', 'K01 – Karta kontroli przyjęcia surowców', 'Karty kontrolne', 'CP1: przyjęcie surowca, P/N domyślnie P', 10, true),
('K02', 'K02 – Karta kontroli magazynowania surowców', 'Karty kontrolne', 'CP2: komory surowca, temperatura, czystość, P/N', 20, true),
('K04', 'K04 – Karta kontroli magazynowania produktów gotowych', 'Karty kontrolne', 'CP3/CCP1: produkty gotowe i pulpy', 40, true),
('K07', 'K07 – Karta kontroli sita / identyfikowalność', 'Karty kontrolne', 'Kontrola sita i partii przed przerobem', 70, true),
('R01', 'R01 – Raport mycia i czyszczenia pomieszczeń', 'Raporty', 'Do wdrożenia w kolejnym etapie', 101, true),
('R02', 'R02 – Raport mycia/czyszczenia maszyn i urządzeń', 'Raporty', 'Do wdrożenia w kolejnym etapie', 102, true),
('R06', 'R06 – Raport miesięcznego przeglądu CCP', 'Raporty', 'Do wdrożenia w kolejnym etapie', 106, true)
ON CONFLICT (code) DO UPDATE
SET title = EXCLUDED.title,
    category = EXCLUDED.category,
    description = EXCLUDED.description,
    sort_order = EXCLUDED.sort_order,
    is_active = EXCLUDED.is_active;

COMMIT;

SELECT 'imported_files' AS element, COUNT(*) AS liczba FROM public.imported_files
UNION ALL
SELECT 'aktywne_importy', COUNT(*) FROM public.imported_files WHERE deleted_at IS NULL
UNION ALL
SELECT 'katalog_kartotek', COUNT(*) FROM public.haccp_card_catalog;
