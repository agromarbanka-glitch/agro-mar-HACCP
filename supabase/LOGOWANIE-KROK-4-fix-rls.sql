-- =============================================================================
-- KROK 4: Naprawa błędu "infinite recursion detected in policy for app_users"
-- Uruchom w Supabase SQL Editor → Run (całość)
-- NIE usuwa kont – tylko poprawia polityki RLS
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_app_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_users
    WHERE auth_user_id = auth.uid()
      AND role = 'admin'
      AND is_active = true
  );
$$;

REVOKE ALL ON FUNCTION public.is_app_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_app_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_app_admin() TO anon;

DROP POLICY IF EXISTS "app_users_admin_write" ON public.app_users;

CREATE POLICY "app_users_admin_insert" ON public.app_users
  FOR INSERT TO authenticated
  WITH CHECK (public.is_app_admin());

CREATE POLICY "app_users_admin_update" ON public.app_users
  FOR UPDATE TO authenticated
  USING (public.is_app_admin())
  WITH CHECK (public.is_app_admin());

CREATE POLICY "app_users_admin_delete" ON public.app_users
  FOR DELETE TO authenticated
  USING (public.is_app_admin());

DROP POLICY IF EXISTS "app_audit_admin_all" ON public.app_audit_log;

CREATE POLICY "app_audit_admin_all" ON public.app_audit_log
  FOR ALL TO authenticated
  USING (public.is_app_admin())
  WITH CHECK (public.is_app_admin());

-- Sprawdzenie – powinien być wiersz admina (jak w kroku 3):
SELECT email, role, is_active FROM public.app_users;
