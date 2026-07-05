-- =============================================================================
-- Ustawienie roli magazynier dla konta (np. m_banka@op.pl)
-- Uruchom w Supabase SQL Editor → Run
-- =============================================================================

UPDATE public.app_users
SET role = 'magazynier', updated_at = now()
WHERE email = 'm_banka@op.pl';   -- ← zmień na właściwy email

SELECT email, display_name, role, is_active FROM public.app_users ORDER BY email;
