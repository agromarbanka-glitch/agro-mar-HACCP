-- =============================================================================
-- JEDNORAZOWE: wyczyść WSZYSTKIE pozostałości partii z importów Excel
-- Supabase → SQL Editor → wklej CAŁOŚĆ → Run
-- Uruchom gdy import nadal zgłasza „numer partii już istnieje”.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE tmp_purge_lots ON COMMIT DROP AS
SELECT DISTINCT lot_id FROM (
  SELECT l.id AS lot_id
  FROM public.lots l
  LEFT JOIN public.operations o ON o.id = l.source_operation_id
  LEFT JOIN public.imported_files f ON f.id = o.imported_file_id
  WHERE (
    l.source_operation_id IS NOT NULL AND o.id IS NULL
  )
  OR f.deleted_at IS NOT NULL
  OR (o.imported_file_id IS NOT NULL AND f.id IS NULL)
  UNION
  SELECT oi.lot_id
  FROM public.operation_items oi
  JOIN public.operations o ON o.id = oi.operation_id
  LEFT JOIN public.imported_files f ON f.id = o.imported_file_id
  WHERE oi.lot_id IS NOT NULL
    AND (
      f.deleted_at IS NOT NULL
      OR (o.imported_file_id IS NOT NULL AND f.id IS NULL)
    )
) q;

CREATE TEMP TABLE tmp_purge_ops ON COMMIT DROP AS
SELECT o.id AS operation_id
FROM public.operations o
LEFT JOIN public.imported_files f ON f.id = o.imported_file_id
WHERE f.deleted_at IS NOT NULL
   OR (o.imported_file_id IS NOT NULL AND f.id IS NULL);

DELETE FROM public.haccp_document_history
WHERE document_id IN (
  SELECT id FROM public.haccp_documents
  WHERE operation_id IN (SELECT operation_id FROM tmp_purge_ops)
     OR lot_id IN (SELECT lot_id FROM tmp_purge_lots)
);

DELETE FROM public.haccp_documents
WHERE operation_id IN (SELECT operation_id FROM tmp_purge_ops)
   OR lot_id IN (SELECT lot_id FROM tmp_purge_lots);

DELETE FROM public.fifo_allocation_change_log
WHERE wz_no IN (SELECT document_no FROM public.operations WHERE id IN (SELECT operation_id FROM tmp_purge_ops));

DELETE FROM public.fifo_allocations
WHERE operation_id IN (SELECT operation_id FROM tmp_purge_ops)
   OR source_lot_id IN (SELECT lot_id FROM tmp_purge_lots)
   OR output_lot_id IN (SELECT lot_id FROM tmp_purge_lots);

DELETE FROM public.pz_fifo_change_log WHERE lot_id IN (SELECT lot_id FROM tmp_purge_lots);
UPDATE public.operation_items SET lot_id = NULL WHERE lot_id IN (SELECT lot_id FROM tmp_purge_lots);
DELETE FROM public.operation_items WHERE operation_id IN (SELECT operation_id FROM tmp_purge_ops);
DELETE FROM public.lot_location_history WHERE lot_id IN (SELECT lot_id FROM tmp_purge_lots);
DELETE FROM public.lot_change_history WHERE lot_id IN (SELECT lot_id FROM tmp_purge_lots);
DELETE FROM public.lots WHERE id IN (SELECT lot_id FROM tmp_purge_lots);
DELETE FROM public.operations WHERE id IN (SELECT operation_id FROM tmp_purge_ops);

COMMIT;

SELECT 'osierocone_partie' AS test, COUNT(*)::bigint AS liczba
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

-- Potem: Ctrl+F5 → wgraj lipiec → Zapisz import.
-- Zalecane migracje: v40 + v42 + v43.
