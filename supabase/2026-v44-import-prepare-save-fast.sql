-- v44 AGRO-MAR: szybki zapis importu — bez pełnego skanowania bazy przy każdym pliku
-- Uruchom w Supabase SQL Editor po v42.
--
-- Domyślnie prepare_import_excel_save(p_full_cleanup := false) usuwa tylko przerwany
-- import tego samego pliku. Pełne sprzątanie (usunięte importy + osierocone partie)
-- tylko gdy p_full_cleanup = true (przycisk „Wyczyść pozostałości usuniętych importów”).

BEGIN;

DROP FUNCTION IF EXISTS public.prepare_import_excel_save(text);
DROP FUNCTION IF EXISTS public.prepare_import_excel_save(text, uuid);
DROP FUNCTION IF EXISTS public.prepare_import_excel_save(text, uuid, boolean);

CREATE OR REPLACE FUNCTION public.prepare_import_excel_save(
  p_filename text DEFAULT NULL,
  p_exclude_import_id uuid DEFAULT NULL,
  p_full_cleanup boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_import record;
  v_cleanup jsonb := '{}'::jsonb;
  v_stale_count integer := 0;
  v_stale_ops integer := 0;
  v_stale_lots integer := 0;
  v_purge jsonb;
  v_orphan_lots integer := 0;
BEGIN
  IF COALESCE(p_full_cleanup, false) THEN
    v_cleanup := public.cleanup_orphaned_deleted_import_data();
  END IF;

  IF p_filename IS NOT NULL AND length(trim(p_filename)) > 0 THEN
    FOR v_import IN
      SELECT f.id
      FROM public.imported_files f
      WHERE f.deleted_at IS NULL
        AND f.status = 'w_trakcie'
        AND lower(trim(f.filename)) = lower(trim(p_filename))
        AND (p_exclude_import_id IS NULL OR f.id <> p_exclude_import_id)
    LOOP
      v_purge := public.purge_import_excel_data(v_import.id);
      v_stale_count := v_stale_count + 1;
      v_stale_ops := v_stale_ops + COALESCE((v_purge->>'operations')::integer, 0);
      v_stale_lots := v_stale_lots + COALESCE((v_purge->>'lots')::integer, 0);
      DELETE FROM public.imported_files WHERE id = v_import.id;
    END LOOP;
  END IF;

  IF COALESCE(p_full_cleanup, false) OR v_stale_count > 0 THEN
    v_orphan_lots := public.purge_orphan_import_lots();
  END IF;

  RETURN jsonb_build_object(
    'deleted_imports_cleaned', COALESCE((v_cleanup->>'imports_purged')::integer, 0),
    'deleted_ops_cleaned', COALESCE((v_cleanup->>'operations_removed')::integer, 0),
    'deleted_lots_cleaned', COALESCE((v_cleanup->>'lots_removed')::integer, 0),
    'stale_in_progress_removed', v_stale_count,
    'stale_operations_removed', v_stale_ops,
    'stale_lots_removed', v_stale_lots,
    'orphan_lots_removed', COALESCE(v_orphan_lots, 0),
    'fast', NOT COALESCE(p_full_cleanup, false)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_import_excel_save(text, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prepare_import_excel_save(text, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_import_excel_save(text, uuid, boolean) TO anon;

COMMIT;
