-- v42 AGRO-MAR: przygotowanie zapisu importu + pewne usuwanie (przerwane importy, osierocone partie)
-- Uruchom w Supabase SQL Editor po 2026-v40-import-delete-full-purge.sql
--
-- Naprawia: po przerwaniu importu (status w_trakcie) lub po „Usuń import” zostają partie
-- i ponowny zapis tego samego pliku kończy się błędem lots_lot_no_key.

BEGIN;

-- Kasuje dane importu Excel (wymaga v40 – jeśli brak, uruchom najpierw v40).
CREATE OR REPLACE FUNCTION public.prepare_import_excel_save(p_filename text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_import record;
  v_cleanup jsonb;
  v_stale_count integer := 0;
  v_stale_ops integer := 0;
  v_stale_lots integer := 0;
  v_purge jsonb;
  v_orphan_lots integer := 0;
BEGIN
  v_cleanup := public.cleanup_orphaned_deleted_import_data();

  IF p_filename IS NOT NULL AND length(trim(p_filename)) > 0 THEN
    FOR v_import IN
      SELECT f.id
      FROM public.imported_files f
      WHERE f.deleted_at IS NULL
        AND f.status = 'w_trakcie'
        AND lower(trim(f.filename)) = lower(trim(p_filename))
    LOOP
      v_purge := public.purge_import_excel_data(v_import.id);
      v_stale_count := v_stale_count + 1;
      v_stale_ops := v_stale_ops + COALESCE((v_purge->>'operations')::integer, 0);
      v_stale_lots := v_stale_lots + COALESCE((v_purge->>'lots')::integer, 0);
      DELETE FROM public.imported_files WHERE id = v_import.id;
    END LOOP;
  END IF;

  v_orphan_lots := public.purge_orphan_import_lots();

  RETURN jsonb_build_object(
    'deleted_imports_cleaned', COALESCE((v_cleanup->>'imports_purged')::integer, 0),
    'deleted_ops_cleaned', COALESCE((v_cleanup->>'operations_removed')::integer, 0),
    'deleted_lots_cleaned', COALESCE((v_cleanup->>'lots_removed')::integer, 0),
    'stale_in_progress_removed', v_stale_count,
    'stale_operations_removed', v_stale_ops,
    'stale_lots_removed', v_stale_lots,
    'orphan_lots_removed', COALESCE(v_orphan_lots, 0)
  );
END;
$$;

-- Po każdym usunięciu importu: dodatkowe sprzątanie osieroconych partii
-- (DROP wymagany: stara wersja zwracała void, nowa zwraca jsonb)
DROP FUNCTION IF EXISTS public.delete_import_excel_admin(uuid, text, text);

CREATE OR REPLACE FUNCTION public.delete_import_excel_admin(
  p_imported_file_id uuid,
  p_reason text,
  p_user_role text DEFAULT 'admin'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_filename text;
  v_purge jsonb;
  v_orphan_lots integer := 0;
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

  v_orphan_lots := public.purge_orphan_import_lots();

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
    v_operations_count, v_items_count, v_lots_count + COALESCE(v_orphan_lots, 0), v_fifo_count
  );

  RETURN jsonb_build_object(
    'operations', v_operations_count,
    'items', v_items_count,
    'lots', v_lots_count,
    'orphan_lots', COALESCE(v_orphan_lots, 0),
    'fifo', v_fifo_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_import_excel_save(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prepare_import_excel_save(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_import_excel_save(text) TO anon;

REVOKE ALL ON FUNCTION public.delete_import_excel_admin(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_import_excel_admin(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_import_excel_admin(uuid, text, text) TO anon;

COMMIT;
