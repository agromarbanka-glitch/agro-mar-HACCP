-- =============================================================================
-- AGRO-MAR HACCP – KROK 3: Powiązanie konta admina z aplikacją
--
-- ZRÓB NAJPIERW KROK 2 w panelu Supabase (Authentication → Add user)!
--
-- Poniżej ZMIEŃ tylko email i ewentualnie imię – reszty nie ruszaj.
-- =============================================================================

INSERT INTO public.app_users (auth_user_id, email, display_name, role, is_active)
SELECT
  id,
  email,
  'Administrator',   -- ← możesz zmienić na np. 'Mariusz Bańka'
  'admin',
  true
FROM auth.users
WHERE email = 'admin@agro-mar.pl'   -- ← WPISZ TEN SAM EMAIL CO W KROKU 2
ON CONFLICT (auth_user_id) DO UPDATE SET
  email = EXCLUDED.email,
  display_name = EXCLUDED.display_name,
  role = 'admin',
  is_active = true,
  updated_at = now();

-- Sprawdzenie – powinien być 1 wiersz z role = admin:
SELECT id, email, display_name, role, is_active FROM public.app_users;
