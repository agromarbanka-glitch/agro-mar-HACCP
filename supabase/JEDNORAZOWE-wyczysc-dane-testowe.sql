-- =============================================================================
-- JEDNORAZOWE: Wyczyść dane testowe przed produkcyjnym sezonem HACCP
-- Uruchom TYLKO RAZ w Supabase SQL Editor, gdy jesteś pewien!
--
-- USUWA: importy, operacje, partie, FIFO, kartoteki HACCP, K01.1
-- ZOSTAWIA: pracowników, produkty, kontrahentów, komory, konta użytkowników
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

DELETE FROM public.import_deletion_log;
DELETE FROM public.imported_files;

-- Opcjonalnie wyczyść historię audytu testów (odkomentuj jeśli chcesz):
-- DELETE FROM public.app_audit_log;

COMMIT;

SELECT 'importy' AS tabela, COUNT(*) AS pozostalo FROM public.imported_files WHERE deleted_at IS NULL
UNION ALL SELECT 'operacje', COUNT(*) FROM public.operations
UNION ALL SELECT 'partie', COUNT(*) FROM public.lots
UNION ALL SELECT 'kartoteki', COUNT(*) FROM public.haccp_documents
UNION ALL SELECT 'K01.1', COUNT(*) FROM public.haccp_aux_materials;
