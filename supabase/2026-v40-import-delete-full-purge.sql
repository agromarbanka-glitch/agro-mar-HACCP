-- v40 AGRO-MAR: pełne kasowanie danych importu Excel (partie, FIFO, K03)
-- Uruchom w Supabase SQL Editor po 2026-v37-fix-delete-import.sql
--
-- Problem: po usunięciu importu z panelu czasem zostawały partie (lots_lot_no_key
-- przy ponownym wgrywaniu) albo operacje z usuniętych importów.

BEGIN;

CREATE OR REPLACE FUNCTION public.purge_import_excel_data(p_imported_file_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_operation_ids uuid[];
  v_lot_ids uuid[];
  v_operations_count integer := 0;
  v_items_count integer := 0;
  v_lots_count integer := 0;
  v_fifo_count integer := 0;
  v_haccp_count integer := 0;
BEGIN
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_operation_ids
  FROM public.operations
  WHERE imported_file_id = p_imported_file_id;

  IF COALESCE(array_length(v_operation_ids, 1), 0) = 0 THEN
    RETURN jsonb_build_object(
      'import_id', p_imported_file_id,
      'operations', 0,
      'items', 0,
      'lots', 0,
      'fifo', 0,
      'haccp', 0
    );
  END IF;

  SELECT COUNT(*) INTO v_operations_count FROM public.operations WHERE id = ANY(v_operation_ids);
  SELECT COUNT(*) INTO v_items_count FROM public.operation_items WHERE operation_id = ANY(v_operation_ids);

  SELECT COALESCE(array_agg(DISTINCT lot_id), ARRAY[]::uuid[]) INTO v_lot_ids
  FROM (
    SELECT l.id AS lot_id
    FROM public.lots l
    WHERE l.source_operation_id = ANY(v_operation_ids)
    UNION
    SELECT oi.lot_id
    FROM public.operation_items oi
    WHERE oi.operation_id = ANY(v_operation_ids)
      AND oi.lot_id IS NOT NULL
  ) q;

  SELECT COUNT(*) INTO v_lots_count FROM public.lots WHERE id = ANY(v_lot_ids);

  SELECT COUNT(*) INTO v_fifo_count
  FROM public.fifo_allocations
  WHERE operation_id = ANY(v_operation_ids)
     OR source_lot_id = ANY(v_lot_ids)
     OR output_lot_id = ANY(v_lot_ids);

  DELETE FROM public.haccp_document_history
  WHERE document_id IN (
    SELECT id FROM public.haccp_documents
    WHERE operation_id = ANY(v_operation_ids)
       OR lot_id = ANY(v_lot_ids)
       OR data->>'sale_operation_id' IN (SELECT oid::text FROM unnest(v_operation_ids) AS oid)
  );

  DELETE FROM public.haccp_documents
  WHERE operation_id = ANY(v_operation_ids)
     OR lot_id = ANY(v_lot_ids)
     OR data->>'sale_operation_id' IN (SELECT oid::text FROM unnest(v_operation_ids) AS oid);

  GET DIAGNOSTICS v_haccp_count = ROW_COUNT;

  DELETE FROM public.fifo_allocation_change_log
  WHERE wz_no IN (SELECT document_no FROM public.operations WHERE id = ANY(v_operation_ids));

  DELETE FROM public.fifo_allocations
  WHERE operation_id = ANY(v_operation_ids)
     OR source_lot_id = ANY(v_lot_ids)
     OR output_lot_id = ANY(v_lot_ids);

  DELETE FROM public.pz_fifo_change_log WHERE lot_id = ANY(v_lot_ids);

  UPDATE public.operation_items
  SET lot_id = NULL
  WHERE lot_id = ANY(v_lot_ids);

  DELETE FROM public.operation_items WHERE operation_id = ANY(v_operation_ids);
  DELETE FROM public.lot_location_history WHERE lot_id = ANY(v_lot_ids);
  DELETE FROM public.lot_change_history WHERE lot_id = ANY(v_lot_ids);
  DELETE FROM public.lots WHERE id = ANY(v_lot_ids);
  DELETE FROM public.operations WHERE id = ANY(v_operation_ids);

  RETURN jsonb_build_object(
    'import_id', p_imported_file_id,
    'operations', v_operations_count,
    'items', v_items_count,
    'lots', v_lots_count,
    'fifo', v_fifo_count,
    'haccp', v_haccp_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_orphaned_deleted_import_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_import record;
  v_result jsonb;
  v_total_ops integer := 0;
  v_total_lots integer := 0;
  v_imports integer := 0;
BEGIN
  FOR v_import IN
    SELECT f.id
    FROM public.imported_files f
    WHERE f.deleted_at IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.operations o WHERE o.imported_file_id = f.id
      )
  LOOP
    v_result := public.purge_import_excel_data(v_import.id);
    v_imports := v_imports + 1;
    v_total_ops := v_total_ops + COALESCE((v_result->>'operations')::integer, 0);
    v_total_lots := v_total_lots + COALESCE((v_result->>'lots')::integer, 0);
  END LOOP;

  RETURN jsonb_build_object(
    'imports_purged', v_imports,
    'operations_removed', v_total_ops,
    'lots_removed', v_total_lots
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_import_excel_admin(
  p_imported_file_id uuid,
  p_reason text,
  p_user_role text DEFAULT 'admin'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_filename text;
  v_purge jsonb;
  v_operations_count integer := 0;
  v_items_count integer := 0;
  v_lots_count integer := 0;
  v_fifo_count integer := 0;
BEGIN
  IF NOT public.is_app_admin() AND COALESCE(p_user_role, '') <> 'admin' THEN
    RAISE EXCEPTION 'Tylko administrator może usuwać import Excel.';
  END IF;

  IF NULLIF(TRIM(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Powód usunięcia importu jest wymagany.';
  END IF;

  SELECT COALESCE(NULLIF(TRIM(filename), ''), 'import.xlsx')
  INTO v_filename
  FROM public.imported_files
  WHERE id = p_imported_file_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nie znaleziono importu Excel (id: %).', p_imported_file_id;
  END IF;

  v_purge := public.purge_import_excel_data(p_imported_file_id);
  v_operations_count := COALESCE((v_purge->>'operations')::integer, 0);
  v_items_count := COALESCE((v_purge->>'items')::integer, 0);
  v_lots_count := COALESCE((v_purge->>'lots')::integer, 0);
  v_fifo_count := COALESCE((v_purge->>'fifo')::integer, 0);

  UPDATE public.imported_files
  SET deleted_at = now(),
      deleted_by_role = COALESCE(NULLIF(p_user_role, ''), 'admin'),
      delete_reason = p_reason,
      status = 'usuniety'
  WHERE id = p_imported_file_id;

  INSERT INTO public.import_deletion_log (
    imported_file_id, filename, deleted_by_role, delete_reason,
    deleted_operations, deleted_items, deleted_lots, deleted_fifo_allocations
  ) VALUES (
    p_imported_file_id, v_filename, COALESCE(NULLIF(p_user_role, ''), 'admin'), p_reason,
    v_operations_count, v_items_count, v_lots_count, v_fifo_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_import_excel_data(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_orphaned_deleted_import_data() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_import_excel_admin(uuid, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.purge_import_excel_data(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_orphaned_deleted_import_data() TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_import_excel_admin(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purge_import_excel_data(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.cleanup_orphaned_deleted_import_data() TO anon;
GRANT EXECUTE ON FUNCTION public.delete_import_excel_admin(uuid, text, text) TO anon;

COMMIT;

-- Kontrola: osierocone operacje przy usuniętych importach (powinno być 0 po cleanup)
SELECT f.id, f.filename, f.deleted_at, COUNT(o.id) AS pozostale_operacje
FROM public.imported_files f
JOIN public.operations o ON o.imported_file_id = f.id
WHERE f.deleted_at IS NOT NULL
GROUP BY f.id, f.filename, f.deleted_at;
