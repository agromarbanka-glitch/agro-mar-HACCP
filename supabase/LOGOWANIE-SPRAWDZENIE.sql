-- =============================================================================
-- DIAGNOSTYKA logowania – uruchom w Supabase SQL Editor (całość → RUN)
-- =============================================================================

-- 1) Czy użytkownik istnieje w Authentication? (powinien być 1 wiersz)
SELECT id, email, email_confirmed_at, created_at
FROM auth.users
WHERE email ILIKE '%sanecka%'   -- ← zmień fragment na swój email jeśli inny
ORDER BY created_at DESC;

-- 2) Czy konto jest w app_users? (powinien być 1 wiersz, role = admin)
SELECT id, email, display_name, role, is_active, auth_user_id
FROM public.app_users
ORDER BY created_at DESC;

-- 3) Czy auth i app_users są powiązane? (powinien być 1 wiersz)
SELECT
  u.email AS auth_email,
  u.email_confirmed_at,
  a.email AS app_email,
  a.role,
  a.is_active
FROM auth.users u
LEFT JOIN public.app_users a ON a.auth_user_id = u.id
WHERE u.email ILIKE '%sanecka%';
