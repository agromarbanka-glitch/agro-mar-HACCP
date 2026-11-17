-- =============================================================================
-- Błąd logowania: "Database error querying schema"
-- Przyczyna (Supabase Auth): NULL w kolumnach tekstowych auth.users zamiast ''.
-- Często po ręcznym INSERT do auth.users lub starym imporcie kont.
-- Uruchom w Supabase → SQL Editor → Run (projekt AGRO-MAR-HACCP).
-- =============================================================================

-- 1) Diagnostyka – ile wierszy ma NULL w polach tokenów
SELECT
  count(*) FILTER (WHERE confirmation_token IS NULL) AS confirmation_token_null,
  count(*) FILTER (WHERE recovery_token IS NULL) AS recovery_token_null,
  count(*) FILTER (WHERE email_change_token_new IS NULL) AS email_change_token_new_null,
  count(*) FILTER (WHERE email_change IS NULL) AS email_change_null,
  count(*) FILTER (WHERE email_change_token_current IS NULL) AS email_change_token_current_null,
  count(*) FILTER (WHERE phone_change_token IS NULL) AS phone_change_token_null,
  count(*) FILTER (WHERE phone_change IS NULL) AS phone_change_null,
  count(*) FILTER (WHERE reauthentication_token IS NULL) AS reauthentication_token_null
FROM auth.users;

-- 2) Naprawa – zamień NULL na pusty string (bezpieczne dla wszystkich kont)
UPDATE auth.users SET
  confirmation_token = COALESCE(confirmation_token, ''),
  recovery_token = COALESCE(recovery_token, ''),
  email_change_token_new = COALESCE(email_change_token_new, ''),
  email_change = COALESCE(email_change, ''),
  email_change_token_current = COALESCE(email_change_token_current, ''),
  phone_change_token = COALESCE(phone_change_token, ''),
  phone_change = COALESCE(phone_change, ''),
  reauthentication_token = COALESCE(reauthentication_token, '')
WHERE confirmation_token IS NULL
   OR recovery_token IS NULL
   OR email_change_token_new IS NULL
   OR email_change IS NULL
   OR email_change_token_current IS NULL
   OR phone_change_token IS NULL
   OR phone_change IS NULL
   OR reauthentication_token IS NULL;