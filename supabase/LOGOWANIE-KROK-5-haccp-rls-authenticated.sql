-- =============================================================================
-- KROK 5: Dostęp zalogowanych użytkowników do kartotek HACCP i magazynu
-- Uruchom w Supabase SQL Editor → Run (całość)
--
-- PROBLEM: Tabele miały polityki RLS tylko dla roli "anon".
-- Po włączeniu logowania aplikacja używa roli "authenticated" → puste listy,
-- brak reakcji na „Utwórz kartotekę” (INSERT blokowany przez RLS).
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.is_active_app_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_users
    WHERE auth_user_id = auth.uid()
      AND is_active = true
  );
$$;

REVOKE ALL ON FUNCTION public.is_active_app_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_app_user() TO authenticated;

-- haccp_documents
DROP POLICY IF EXISTS "haccp_documents_auth" ON public.haccp_documents;
CREATE POLICY "haccp_documents_auth" ON public.haccp_documents
  FOR ALL TO authenticated
  USING (public.is_active_app_user())
  WITH CHECK (public.is_active_app_user());

-- haccp_document_history
DROP POLICY IF EXISTS "haccp_document_history_auth" ON public.haccp_document_history;
CREATE POLICY "haccp_document_history_auth" ON public.haccp_document_history
  FOR ALL TO authenticated
  USING (public.is_active_app_user())
  WITH CHECK (public.is_active_app_user());

-- haccp_employees
DROP POLICY IF EXISTS "haccp_employees_auth" ON public.haccp_employees;
CREATE POLICY "haccp_employees_auth" ON public.haccp_employees
  FOR ALL TO authenticated
  USING (public.is_active_app_user())
  WITH CHECK (public.is_active_app_user());

-- haccp_aux_materials
DROP POLICY IF EXISTS "haccp_aux_materials_auth" ON public.haccp_aux_materials;
CREATE POLICY "haccp_aux_materials_auth" ON public.haccp_aux_materials
  FOR ALL TO authenticated
  USING (public.is_active_app_user())
  WITH CHECK (public.is_active_app_user());

-- imported_files
DROP POLICY IF EXISTS "imported_files_auth" ON public.imported_files;
CREATE POLICY "imported_files_auth" ON public.imported_files
  FOR ALL TO authenticated
  USING (public.is_active_app_user())
  WITH CHECK (public.is_active_app_user());

-- contractors
DROP POLICY IF EXISTS "contractors_auth" ON public.contractors;
CREATE POLICY "contractors_auth" ON public.contractors
  FOR ALL TO authenticated
  USING (public.is_active_app_user())
  WITH CHECK (public.is_active_app_user());

-- products
DROP POLICY IF EXISTS "products_auth" ON public.products;
CREATE POLICY "products_auth" ON public.products
  FOR ALL TO authenticated
  USING (public.is_active_app_user())
  WITH CHECK (public.is_active_app_user());

-- operations
DROP POLICY IF EXISTS "operations_auth" ON public.operations;
CREATE POLICY "operations_auth" ON public.operations
  FOR ALL TO authenticated
  USING (public.is_active_app_user())
  WITH CHECK (public.is_active_app_user());

-- operation_items
DROP POLICY IF EXISTS "operation_items_auth" ON public.operation_items;
CREATE POLICY "operation_items_auth" ON public.operation_items
  FOR ALL TO authenticated
  USING (public.is_active_app_user())
  WITH CHECK (public.is_active_app_user());

-- lots
DROP POLICY IF EXISTS "lots_auth" ON public.lots;
CREATE POLICY "lots_auth" ON public.lots
  FOR ALL TO authenticated
  USING (public.is_active_app_user())
  WITH CHECK (public.is_active_app_user());

-- lot_sequences
DROP POLICY IF EXISTS "lot_sequences_auth" ON public.lot_sequences;
CREATE POLICY "lot_sequences_auth" ON public.lot_sequences
  FOR ALL TO authenticated
  USING (public.is_active_app_user())
  WITH CHECK (public.is_active_app_user());

-- fifo_allocations
DROP POLICY IF EXISTS "fifo_allocations_auth" ON public.fifo_allocations;
CREATE POLICY "fifo_allocations_auth" ON public.fifo_allocations
  FOR ALL TO authenticated
  USING (public.is_active_app_user())
  WITH CHECK (public.is_active_app_user());

-- storage_chambers
DROP POLICY IF EXISTS "storage_chambers_auth" ON public.storage_chambers;
CREATE POLICY "storage_chambers_auth" ON public.storage_chambers
  FOR ALL TO authenticated
  USING (public.is_active_app_user())
  WITH CHECK (public.is_active_app_user());

-- lot_location_history
DROP POLICY IF EXISTS "lot_location_history_auth" ON public.lot_location_history;
CREATE POLICY "lot_location_history_auth" ON public.lot_location_history
  FOR ALL TO authenticated
  USING (public.is_active_app_user())
  WITH CHECK (public.is_active_app_user());

-- lot_change_history
DROP POLICY IF EXISTS "lot_change_history_auth" ON public.lot_change_history;
CREATE POLICY "lot_change_history_auth" ON public.lot_change_history
  FOR ALL TO authenticated
  USING (public.is_active_app_user())
  WITH CHECK (public.is_active_app_user());

-- fifo_allocation_change_log
DROP POLICY IF EXISTS "fifo_allocation_change_log_auth" ON public.fifo_allocation_change_log;
CREATE POLICY "fifo_allocation_change_log_auth" ON public.fifo_allocation_change_log
  FOR ALL TO authenticated
  USING (public.is_active_app_user())
  WITH CHECK (public.is_active_app_user());

-- pz_fifo_change_log
ALTER TABLE public.pz_fifo_change_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pz_fifo_change_log_auth" ON public.pz_fifo_change_log;
CREATE POLICY "pz_fifo_change_log_auth" ON public.pz_fifo_change_log
  FOR ALL TO authenticated
  USING (public.is_active_app_user())
  WITH CHECK (public.is_active_app_user());

COMMIT;

-- Diagnostyka – powinny być liczby > 0 jeśli dane istnieją w bazie:
SELECT document_type, COUNT(*) AS liczba
FROM public.haccp_documents
GROUP BY document_type
ORDER BY document_type;

SELECT COUNT(*) AS wszystkie_kartoteki FROM public.haccp_documents;
