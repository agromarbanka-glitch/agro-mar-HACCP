-- =============================================================================
-- AGRO-MAR HACCP – KROK 1: Tabele logowania i historii
-- Uruchom RAZ w Supabase → SQL Editor → New query → wklej → Run
-- Projekt: AGRO-MAR-HACCP (NIE stara baza opakowań!)
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid UNIQUE NOT NULL,
  email text NOT NULL,
  display_name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'magazynier' CHECK (role IN ('admin', 'magazynier')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_users_auth ON public.app_users(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_app_users_email ON public.app_users(email);

CREATE TABLE IF NOT EXISTS public.app_audit_log (
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

CREATE INDEX IF NOT EXISTS idx_app_audit_created ON public.app_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_audit_entity ON public.app_audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_app_audit_action ON public.app_audit_log(action);

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_users_read_authenticated" ON public.app_users;
CREATE POLICY "app_users_read_authenticated" ON public.app_users
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "app_users_admin_write" ON public.app_users;
CREATE POLICY "app_users_admin_write" ON public.app_users
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.app_users u WHERE u.auth_user_id = auth.uid() AND u.role = 'admin' AND u.is_active)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.app_users u WHERE u.auth_user_id = auth.uid() AND u.role = 'admin' AND u.is_active)
  );

DROP POLICY IF EXISTS "app_users_read_own" ON public.app_users;
CREATE POLICY "app_users_read_own" ON public.app_users
  FOR SELECT TO authenticated USING (auth_user_id = auth.uid());

DROP POLICY IF EXISTS "app_audit_admin_all" ON public.app_audit_log;
CREATE POLICY "app_audit_admin_all" ON public.app_audit_log
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.app_users u WHERE u.auth_user_id = auth.uid() AND u.role = 'admin' AND u.is_active)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.app_users u WHERE u.auth_user_id = auth.uid() AND u.role = 'admin' AND u.is_active)
  );

DROP POLICY IF EXISTS "app_audit_insert_authenticated" ON public.app_audit_log;
CREATE POLICY "app_audit_insert_authenticated" ON public.app_audit_log
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "app_users_anon_all" ON public.app_users;
CREATE POLICY "app_users_anon_all" ON public.app_users FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "app_audit_anon_all" ON public.app_audit_log;
CREATE POLICY "app_audit_anon_all" ON public.app_audit_log FOR ALL TO anon USING (true) WITH CHECK (true);

COMMIT;

-- Sprawdzenie (powinno zwrócić 0 wierszy – to normalne przed krokiem 3):
-- SELECT * FROM public.app_users;
