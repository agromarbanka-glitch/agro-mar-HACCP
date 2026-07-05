-- =============================================================================
-- Naprawa usuwania importów Excel (delete_import_excel_admin)
-- Uruchom w Supabase SQL Editor → Run (całość)
--
-- Problemy: brak GRANT EXECUTE dla zalogowanych, błędny test filename IS NULL,
-- brak weryfikacji admina przez is_app_admin().
-- =============================================================================

BEGIN;

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
  v_operation_ids uuid[];
  v_lot_ids uuid[];
  v_operations_count integer := 0;
  v_items_count integer := 0;
  v_lots_count integer := 0;
  v_fifo_count integer := 0;
  v_haccp_count integer := 0;
BEGIN
  -- Zalogowany admin (Auth) lub legacy: p_user_role = admin z aplikacji
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

  -- Kartoteki powiązane z operacjami/partiami tego importu (w tym K03)
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

  DELETE FROM public.operation_items WHERE operation_id = ANY(v_operation_ids);
  DELETE FROM public.lot_location_history WHERE lot_id = ANY(v_lot_ids);
  DELETE FROM public.lot_change_history WHERE lot_id = ANY(v_lot_ids);
  DELETE FROM public.lots WHERE id = ANY(v_lot_ids);
  DELETE FROM public.operations WHERE id = ANY(v_operation_ids);

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

REVOKE ALL ON FUNCTION public.delete_import_excel_admin(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_import_excel_admin(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_import_excel_admin(uuid, text, text) TO anon;

ALTER TABLE public.import_deletion_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "import_deletion_log_auth" ON public.import_deletion_log;
CREATE POLICY "import_deletion_log_auth" ON public.import_deletion_log
  FOR ALL TO authenticated
  USING (public.is_active_app_user())
  WITH CHECK (public.is_active_app_user());

COMMIT;

-- Test: lista aktywnych importów
SELECT id, filename AS nazwa, rows_count, created_at
FROM public.imported_files
WHERE deleted_at IS NULL
ORDER BY created_at DESC;
