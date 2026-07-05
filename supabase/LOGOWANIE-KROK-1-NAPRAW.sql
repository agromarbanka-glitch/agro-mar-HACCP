-- =============================================================================
-- NAPRAWA błędu: column "auth_user_id" does not exist
-- Uruchom TEN plik w Supabase SQL Editor → Run (całość)
-- Bezpieczne PRZED dodaniem kont admina (tabele puste lub uszkodzone)
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS public.app_audit_log CASCADE;
DROP TABLE IF EXISTS public.app_users CASCADE;

CREATE TABLE public.app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid UNIQUE NOT NULL,
  email text NOT NULL,
  display_name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'magazynier' CHECK (role IN ('admin', 'magazynier')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_app_users_auth ON public.app_users(auth_user_id);
CREATE INDEX idx_app_users_email ON public.app_users(email);

CREATE TABLE public.app_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid,
  action text NOT NULL CHECK (action IN ('create', 'update', 'delete', 'restore')),
  summary text,
  before_data jsonb,
  after_data jsonb,
  changed_by text,
  changed_by_email text,
  can_restore boolean NOT NULL DEFAULT false,
  restored_at timestamptz,
  restored_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_app_audit_created ON public.app_audit_log(created_at DESC);
CREATE INDEX idx_app_audit_entity ON public.app_audit_log(entity_type, entity_id);
CREATE INDEX idx_app_audit_action ON public.app_audit_log(action);

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_audit_log ENABLE ROW LEVEL SECURITY;

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

DROP POLICY IF EXISTS "app_users_read_authenticated" ON public.app_users;
CREATE POLICY "app_users_read_authenticated" ON public.app_users
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "app_users_admin_write" ON public.app_users;
DROP POLICY IF EXISTS "app_users_admin_insert" ON public.app_users;
DROP POLICY IF EXISTS "app_users_admin_update" ON public.app_users;
DROP POLICY IF EXISTS "app_users_admin_delete" ON public.app_users;

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

DROP POLICY IF EXISTS "app_users_read_own" ON public.app_users;
CREATE POLICY "app_users_read_own" ON public.app_users
  FOR SELECT TO authenticated USING (auth_user_id = auth.uid());

DROP POLICY IF EXISTS "app_audit_admin_all" ON public.app_audit_log;
CREATE POLICY "app_audit_admin_all" ON public.app_audit_log
  FOR ALL TO authenticated
  USING (public.is_app_admin())
  WITH CHECK (public.is_app_admin());

DROP POLICY IF EXISTS "app_audit_insert_authenticated" ON public.app_audit_log;
CREATE POLICY "app_audit_insert_authenticated" ON public.app_audit_log
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "app_users_anon_all" ON public.app_users;
CREATE POLICY "app_users_anon_all" ON public.app_users FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "app_audit_anon_all" ON public.app_audit_log;
CREATE POLICY "app_audit_anon_all" ON public.app_audit_log FOR ALL TO anon USING (true) WITH CHECK (true);

COMMIT;

-- Po sukcesie: kontynuuj KROK 2 (Authentication → Add user) i KROK 3 (LOGOWANIE-KROK-3-admin.sql)
