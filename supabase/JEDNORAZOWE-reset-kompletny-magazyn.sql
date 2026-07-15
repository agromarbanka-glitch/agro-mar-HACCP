-- =============================================================================
-- JEDNORAZOWE: Reset kompletny magazynu (import + K03 + FIFO + partie)
-- Uruchom w Supabase SQL Editor gdy reset z aplikacji nie wystarczy.
-- ZOSTAWIA: produkty, kontrahentów, komory, konta użytkowników.
-- =============================================================================

BEGIN;

DELETE FROM public.haccp_document_history;
DELETE FROM public.haccp_documents;
DELETE FROM public.haccp_aux_materials;

DELETE FROM public.fifo_allocation_change_log;
DELETE FROM public.fifo_allocations;
DELETE FROM public.pz_fifo_change_log;

DELETE FROM public.lot_location_history;
DELETE FROM public.lot_change_history;
DELETE FROM public.operation_items;
DELETE FROM public.lots;
DELETE FROM public.operations;

UPDATE public.imported_files
SET deleted_at = COALESCE(deleted_at, NOW()),
    status = 'usuniety',
    delete_reason = COALESCE(delete_reason, 'Reset kompletny SQL');

COMMIT;

SELECT 'importy_aktywne' AS tabela, COUNT(*) AS pozostalo FROM public.imported_files WHERE deleted_at IS NULL
UNION ALL SELECT 'operacje', COUNT(*) FROM public.operations
UNION ALL SELECT 'partie', COUNT(*) FROM public.lots
UNION ALL SELECT 'fifo', COUNT(*) FROM public.fifo_allocations
UNION ALL SELECT 'kartoteki', COUNT(*) FROM public.haccp_documents;
