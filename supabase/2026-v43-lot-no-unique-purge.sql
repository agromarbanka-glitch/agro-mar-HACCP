-- v43 AGRO-MAR: unikalne numery partii + pełniejsze sprzątanie osieroconych partii importu
-- Uruchom w Supabase SQL Editor po v40 + v42.

BEGIN;

-- 1) Numer partii zawsze unikalny (pomija istniejące numery, naprawia rozjazd lot_sequences)
CREATE OR REPLACE FUNCTION public.generate_lot_no(p_product_id uuid, p_date date)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_year int := extract(year from p_date)::int;
  v_code text;
  v_number int;
  v_lot_no text;
  v_guard int := 0;
BEGIN
  SELECT code INTO v_code FROM public.products WHERE id = p_product_id;
  IF v_code IS NULL OR length(trim(v_code)) = 0 THEN
    RAISE EXCEPTION 'Nie znaleziono kodu produktu dla numeru partii';
  END IF;

  INSERT INTO public.lot_sequences(product_id, year, next_number)
  VALUES (p_product_id, v_year, 1)
  ON CONFLICT (product_id, year) DO NOTHING;

  LOOP
    v_guard := v_guard + 1;
    IF v_guard > 5000 THEN
      RAISE EXCEPTION 'Nie udało się wygenerować unikalnego numeru partii dla produktu %', p_product_id;
    END IF;

    UPDATE public.lot_sequences
    SET next_number = next_number + 1
    WHERE product_id = p_product_id AND year = v_year
    RETURNING next_number - 1 INTO v_number;

    IF NOT FOUND THEN
      INSERT INTO public.lot_sequences(product_id, year, next_number)
      VALUES (p_product_id, v_year, 2)
      RETURNING next_number - 1 INTO v_number;
    END IF;

    v_lot_no := v_code || '/' || lpad(v_number::text, 3, '0') || '/' || v_year::text;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.lots WHERE lot_no = v_lot_no);
  END LOOP;

  RETURN v_lot_no;
END;
$$;

-- 2) Szersze wykrywanie osieroconych partii z importu Excel
CREATE OR REPLACE FUNCTION public.purge_orphan_import_lots()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lot_ids uuid[];
  v_count integer := 0;
BEGIN
  SELECT COALESCE(array_agg(DISTINCT lot_id), ARRAY[]::uuid[]) INTO v_lot_ids
  FROM (
    SELECT l.id AS lot_id
    FROM public.lots l
    WHERE l.source_operation_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.operations o WHERE o.id = l.source_operation_id)
    UNION
    SELECT l.id
    FROM public.lots l
    JOIN public.operations o ON o.id = l.source_operation_id
    JOIN public.imported_files f ON f.id = o.imported_file_id
    WHERE f.deleted_at IS NOT NULL
    UNION
    SELECT oi.lot_id
    FROM public.operation_items oi
    JOIN public.operations o ON o.id = oi.operation_id
    JOIN public.imported_files f ON f.id = o.imported_file_id
    WHERE f.deleted_at IS NOT NULL
      AND oi.lot_id IS NOT NULL
    UNION
    SELECT l.id
    FROM public.lots l
    JOIN public.operations o ON o.id = l.source_operation_id
    WHERE o.imported_file_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.imported_files f WHERE f.id = o.imported_file_id)
    UNION
    SELECT oi.lot_id
    FROM public.operation_items oi
    JOIN public.operations o ON o.id = oi.operation_id
    WHERE o.imported_file_id IS NOT NULL
      AND oi.lot_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.imported_files f WHERE f.id = o.imported_file_id)
  ) q;

  IF COALESCE(array_length(v_lot_ids, 1), 0) = 0 THEN
    RETURN 0;
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.lots WHERE id = ANY(v_lot_ids);

  DELETE FROM public.haccp_document_history
  WHERE document_id IN (SELECT id FROM public.haccp_documents WHERE lot_id = ANY(v_lot_ids));

  DELETE FROM public.haccp_documents WHERE lot_id = ANY(v_lot_ids);

  DELETE FROM public.fifo_allocations
  WHERE source_lot_id = ANY(v_lot_ids) OR output_lot_id = ANY(v_lot_ids);

  DELETE FROM public.pz_fifo_change_log WHERE lot_id = ANY(v_lot_ids);
  UPDATE public.operation_items SET lot_id = NULL WHERE lot_id = ANY(v_lot_ids);
  DELETE FROM public.lot_location_history WHERE lot_id = ANY(v_lot_ids);
  DELETE FROM public.lot_change_history WHERE lot_id = ANY(v_lot_ids);
  DELETE FROM public.lots WHERE id = ANY(v_lot_ids);

  RETURN v_count;
END;
$$;

COMMIT;

-- Kontrola: ile partii importowych jest osieroconych (powinno być 0 po cleanup)
SELECT COUNT(*) AS osierocone_partie_importu
FROM public.lots l
WHERE (
  l.source_operation_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.operations o WHERE o.id = l.source_operation_id)
)
OR EXISTS (
  SELECT 1 FROM public.operations o
  JOIN public.imported_files f ON f.id = o.imported_file_id
  WHERE o.id = l.source_operation_id AND f.deleted_at IS NOT NULL
);
