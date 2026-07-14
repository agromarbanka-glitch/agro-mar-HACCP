-- =============================================================================
-- AGRO-MAR HACCP – Diagnostyka przed migracją v45 (Wartość magazynu)
-- =============================================================================
-- Gdzie uruchomić: Supabase → SQL Editor → New query → wklej CAŁOŚĆ → Run
--
-- Co robi:
--   Sprawdza KROKI logowania 1–5 oraz czy v45 jest już wdrożone.
--   Działa także gdy tabel v45 / app_users jeszcze NIE istnieją.
--
-- Nie modyfikuje trwałych obiektów bazy – tylko odczyt + tymczasowa tabela w sesji.
-- =============================================================================

DROP TABLE IF EXISTS diag_checks;

CREATE TEMP TABLE diag_checks (
  sort_order integer NOT NULL,
  krok text NOT NULL,
  element text NOT NULL,
  status text NOT NULL,
  szczegoly text NOT NULL,
  co_dalej text NOT NULL
);

CREATE OR REPLACE FUNCTION pg_temp.diag_table_count(qualified_name text)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  rel regclass;
  result bigint;
BEGIN
  rel := to_regclass(qualified_name);
  IF rel IS NULL THEN
    RETURN NULL;
  END IF;
  EXECUTE format('SELECT count(*)::bigint FROM %s', rel) INTO result;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.diag_table_count_where(qualified_name text, where_sql text)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  rel regclass;
  result bigint;
BEGIN
  rel := to_regclass(qualified_name);
  IF rel IS NULL THEN
    RETURN NULL;
  END IF;
  EXECUTE format('SELECT count(*)::bigint FROM %s WHERE %s', rel, where_sql) INTO result;
  RETURN result;
END;
$$;

DO $$
DECLARE
  cnt bigint;
  detail text;
  has_app_users boolean := to_regclass('public.app_users') IS NOT NULL;
  has_audit boolean := to_regclass('public.app_audit_log') IS NOT NULL;
  has_haccp_docs boolean := to_regclass('public.haccp_documents') IS NOT NULL;
  has_operations boolean := to_regclass('public.operations') IS NOT NULL;
  has_wv_batches boolean := to_regclass('public.warehouse_value_batches') IS NOT NULL;
  has_wv_lines boolean := to_regclass('public.warehouse_value_lines') IS NOT NULL;
  has_wv_snaps boolean := to_regclass('public.warehouse_value_snapshots') IS NOT NULL;
  has_is_active boolean := EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_active_app_user'
  );
  has_is_admin boolean := EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_app_admin'
  );
BEGIN
  -- KROK 0
  INSERT INTO diag_checks VALUES (
    0, 'KROK 0', 'Połączenie z bazą', 'OK',
    'Skrypt wykonany w SQL Editor – projekt Supabase odpowiada.', '—'
  );

  -- KROK 1: app_users
  IF has_app_users THEN
    cnt := pg_temp.diag_table_count_where('public.app_users', 'is_active = true');
    INSERT INTO diag_checks VALUES (
      1, 'KROK 1', 'Tabela app_users', 'OK',
      'Tabela istnieje · aktywnych użytkowników: ' || COALESCE(cnt::text, '0'), '—'
    );
  ELSE
    INSERT INTO diag_checks VALUES (
      1, 'KROK 1', 'Tabela app_users', 'BRAK',
      'Brak tabeli użytkowników aplikacji.',
      'Uruchom: LOGOWANIE-KROK-1-tablery.sql (lub LOGOWANIE-KROK-1-NAPRAW.sql przy błędzie auth_user_id)'
    );
  END IF;

  -- KROK 1: app_audit_log
  IF has_audit THEN
    cnt := pg_temp.diag_table_count('public.app_audit_log');
    INSERT INTO diag_checks VALUES (
      1, 'KROK 1', 'Tabela app_audit_log', 'OK',
      'Tabela istnieje · wpisów: ' || COALESCE(cnt::text, '0'), '—'
    );
  ELSE
    INSERT INTO diag_checks VALUES (
      1, 'KROK 1', 'Tabela app_audit_log', 'BRAK',
      'Brak tabeli historii zmian.',
      'Uruchom: LOGOWANIE-KROK-1-tablery.sql'
    );
  END IF;

  -- KROK 1: auth_user_id column
  IF NOT has_app_users THEN
    INSERT INTO diag_checks VALUES (
      1, 'KROK 1', 'Kolumna app_users.auth_user_id', 'BRAK',
      'Najpierw utwórz app_users (KROK 1).', '—'
    );
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'app_users' AND column_name = 'auth_user_id'
  ) THEN
    INSERT INTO diag_checks VALUES (
      1, 'KROK 1', 'Kolumna app_users.auth_user_id', 'OK',
      'Struktura tabeli poprawna.', '—'
    );
  ELSE
    INSERT INTO diag_checks VALUES (
      1, 'KROK 1', 'Kolumna app_users.auth_user_id', 'BRAK',
      'Stara/wadliwa wersja tabeli – brak auth_user_id.',
      'Uruchom: LOGOWANIE-KROK-1-NAPRAW.sql'
    );
  END IF;

  -- KROK 2: auth.users
  cnt := pg_temp.diag_table_count('auth.users');
  IF COALESCE(cnt, 0) = 0 THEN
    INSERT INTO diag_checks VALUES (
      2, 'KROK 2', 'Użytkownicy w Authentication', 'BRAK',
      'Brak kont w Authentication → Users.',
      'Supabase → Authentication → Users → Add user (zaznacz Auto Confirm User)'
    );
  ELSE
    SELECT string_agg(email, ', ' ORDER BY email)
    INTO detail
    FROM (SELECT email FROM auth.users ORDER BY created_at LIMIT 3) s;

    INSERT INTO diag_checks VALUES (
      2, 'KROK 2', 'Użytkownicy w Authentication', 'OK',
      'Kont w Authentication: ' || cnt::text || ' · przykładowe emaile: ' || COALESCE(detail, '—'),
      '—'
    );
  END IF;

  -- KROK 3: admin
  IF NOT has_app_users THEN
    INSERT INTO diag_checks VALUES (
      3, 'KROK 3', 'Administrator w app_users', 'BRAK',
      'Brak tabeli app_users.', '—'
    );
  ELSIF pg_temp.diag_table_count_where('public.app_users', 'role = ''admin'' AND is_active = true') > 0 THEN
    cnt := pg_temp.diag_table_count_where('public.app_users', 'role = ''admin'' AND is_active = true');
    INSERT INTO diag_checks VALUES (
      3, 'KROK 3', 'Administrator w app_users', 'OK',
      'Adminów aktywnych: ' || cnt::text, '—'
    );
  ELSIF pg_temp.diag_table_count('public.app_users') > 0 THEN
    INSERT INTO diag_checks VALUES (
      3, 'KROK 3', 'Administrator w app_users', 'OSTRZEŻENIE',
      'Są użytkownicy app_users, ale brak aktywnego admina.',
      'Uruchom: LOGOWANIE-KROK-3-admin.sql (popraw email w pliku na ten z Authentication)'
    );
  ELSE
    INSERT INTO diag_checks VALUES (
      3, 'KROK 3', 'Administrator w app_users', 'BRAK',
      'Brak wpisów w app_users – konto Auth nie jest powiązane z aplikacją.',
      'Uruchom: LOGOWANIE-KROK-3-admin.sql (popraw email w pliku na ten z Authentication)'
    );
  END IF;

  -- KROK 3: lista kont
  IF NOT has_app_users THEN
    INSERT INTO diag_checks VALUES (
      3, 'KROK 3', 'Lista kont app_users', 'BRAK', 'Brak tabeli.', '—'
    );
  ELSIF pg_temp.diag_table_count('public.app_users') = 0 THEN
    INSERT INTO diag_checks VALUES (
      3, 'KROK 3', 'Lista kont app_users', 'BRAK',
      'Tabela pusta.', 'Uruchom: LOGOWANIE-KROK-3-admin.sql'
    );
  ELSE
    EXECUTE $q$
      SELECT string_agg(
        email || ' · ' || role || CASE WHEN is_active THEN '' ELSE ' (nieaktywny)' END,
        ' | ' ORDER BY role, email
      )
      FROM public.app_users
    $q$ INTO detail;

    INSERT INTO diag_checks VALUES (
      3, 'KROK 3', 'Lista kont app_users', 'OK', COALESCE(detail, '—'), '—'
    );
  END IF;

  -- KROK 3: powiązanie auth_user_id
  IF NOT has_app_users THEN
    INSERT INTO diag_checks VALUES (
      3, 'KROK 3', 'Powiązanie auth_user_id', 'BRAK', 'Brak tabeli app_users.', '—'
    );
  ELSE
    EXECUTE $q$
      SELECT count(*)::bigint
      FROM public.app_users au
      JOIN auth.users u ON u.id = au.auth_user_id
    $q$ INTO cnt;

    IF COALESCE(cnt, 0) = 0 THEN
      INSERT INTO diag_checks VALUES (
        3, 'KROK 3', 'Powiązanie auth_user_id', 'BRAK',
        'Żaden wpis app_users nie ma poprawnego auth_user_id z auth.users.',
        'Uruchom: LOGOWANIE-KROK-3-admin.sql'
      );
    ELSE
      INSERT INTO diag_checks VALUES (
        3, 'KROK 3', 'Powiązanie auth_user_id', 'OK',
        'Poprawnie powiązanych kont: ' || cnt::text, '—'
      );
    END IF;
  END IF;

  -- KROK 4
  IF has_is_admin THEN
    INSERT INTO diag_checks VALUES (
      4, 'KROK 4', 'Funkcja is_app_admin()', 'OK',
      'Funkcja istnieje (naprawa infinite recursion na app_users).', '—'
    );
  ELSE
    INSERT INTO diag_checks VALUES (
      4, 'KROK 4', 'Funkcja is_app_admin()', 'OSTRZEŻENIE',
      'Funkcja nie znaleziona – może działać, ale przy błędzie „infinite recursion” uruchom KROK 4.',
      'Opcjonalnie / przy błędzie RLS: LOGOWANIE-KROK-4-fix-rls.sql'
    );
  END IF;

  -- KROK 5: funkcja
  IF has_is_active THEN
    INSERT INTO diag_checks VALUES (
      5, 'KROK 5', 'Funkcja is_active_app_user()', 'OK',
      'Funkcja wymagana przez v45 i dostęp zalogowanych do HACCP.', '—'
    );
  ELSE
    INSERT INTO diag_checks VALUES (
      5, 'KROK 5', 'Funkcja is_active_app_user()', 'BRAK',
      'BEZ TEGO v45 się nie wykona i po zalogowaniu mogą być puste listy.',
      'OBOWIĄZKOWO przed v45: LOGOWANIE-KROK-5-haccp-rls-authenticated.sql'
    );
  END IF;

  -- KROK 5: haccp_documents_auth
  IF NOT has_haccp_docs THEN
    INSERT INTO diag_checks VALUES (
      5, 'KROK 5', 'Polityka haccp_documents_auth', 'OSTRZEŻENIE',
      'Tabela haccp_documents nie istnieje (inny problem niż logowanie).', '—'
    );
  ELSIF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'haccp_documents' AND policyname = 'haccp_documents_auth'
  ) THEN
    INSERT INTO diag_checks VALUES (
      5, 'KROK 5', 'Polityka haccp_documents_auth', 'OK',
      'RLS dla zalogowanych na kartoteki HACCP – OK.', '—'
    );
  ELSE
    INSERT INTO diag_checks VALUES (
      5, 'KROK 5', 'Polityka haccp_documents_auth', 'BRAK',
      'Brak polityki authenticated – po logowaniu kartoteki mogą być puste.',
      'Uruchom: LOGOWANIE-KROK-5-haccp-rls-authenticated.sql'
    );
  END IF;

  -- KROK 5: operations_auth
  IF NOT has_operations THEN
    INSERT INTO diag_checks VALUES (
      5, 'KROK 5', 'Polityka operations_auth (magazyn HACCP)', 'OSTRZEŻENIE',
      'Tabela operations nie istnieje.', '—'
    );
  ELSIF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'operations' AND policyname = 'operations_auth'
  ) THEN
    INSERT INTO diag_checks VALUES (
      5, 'KROK 5', 'Polityka operations_auth (magazyn HACCP)', 'OK',
      'RLS magazynu partii (HACCP FIFO) dla zalogowanych – OK.', '—'
    );
  ELSE
    INSERT INTO diag_checks VALUES (
      5, 'KROK 5', 'Polityka operations_auth (magazyn HACCP)', 'BRAK',
      'Brak polityki – importy/magazyn HACCP mogą nie działać po logowaniu.',
      'Uruchom: LOGOWANIE-KROK-5-haccp-rls-authenticated.sql'
    );
  END IF;

  -- KROK 5: sanity HACCP data
  IF NOT has_haccp_docs THEN
    INSERT INTO diag_checks VALUES (
      5, 'KROK 5', 'Dane HACCP (sanity check)', 'OSTRZEŻENIE',
      'Brak tabeli kartotek.', '—'
    );
  ELSE
    cnt := pg_temp.diag_table_count('public.haccp_documents');
    INSERT INTO diag_checks VALUES (
      5, 'KROK 5', 'Dane HACCP (sanity check)',
      CASE WHEN COALESCE(cnt, 0) > 0 THEN 'OK' ELSE 'OSTRZEŻENIE' END,
      'Kartotek w bazie: ' || COALESCE(cnt::text, '0'),
      CASE WHEN COALESCE(cnt, 0) = 0
        THEN 'Baza pusta lub brak dostępu – po KROKU 5 zaloguj się w aplikacji i odśwież (Ctrl+F5)'
        ELSE '—'
      END
    );
  END IF;

  -- v45: batches
  IF has_wv_batches THEN
    cnt := pg_temp.diag_table_count('public.warehouse_value_batches');
    INSERT INTO diag_checks VALUES (
      45, 'v45', 'Tabela warehouse_value_batches', 'OK',
      'Importów Excel: ' || COALESCE(cnt::text, '0'), '—'
    );
  ELSE
    INSERT INTO diag_checks VALUES (
      45, 'v45', 'Tabela warehouse_value_batches', 'BRAK',
      'Magazyn wartości (Excel FIFO) jeszcze nie utworzony.',
      'Po KROKU 5 uruchom: 2026-v45-warehouse-value-magazyn.sql'
    );
  END IF;

  -- v45: lines
  IF has_wv_lines THEN
    cnt := pg_temp.diag_table_count('public.warehouse_value_lines');
    INSERT INTO diag_checks VALUES (
      45, 'v45', 'Tabela warehouse_value_lines', 'OK',
      'Wierszy PZ/WZ: ' || COALESCE(cnt::text, '0'), '—'
    );
  ELSE
    INSERT INTO diag_checks VALUES (
      45, 'v45', 'Tabela warehouse_value_lines', 'BRAK',
      'Brak wierszy PZ/WZ magazynu wartości.',
      'Uruchom: 2026-v45-warehouse-value-magazyn.sql'
    );
  END IF;

  -- v45: snapshots
  IF has_wv_snaps THEN
    cnt := pg_temp.diag_table_count('public.warehouse_value_snapshots');
    INSERT INTO diag_checks VALUES (
      45, 'v45', 'Tabela warehouse_value_snapshots', 'OK',
      'Snapshotów: ' || COALESCE(cnt::text, '0'), '—'
    );
  ELSE
    INSERT INTO diag_checks VALUES (
      45, 'v45', 'Tabela warehouse_value_snapshots', 'BRAK',
      'Brak tabeli snapshotów.',
      'Uruchom: 2026-v45-warehouse-value-magazyn.sql'
    );
  END IF;

  -- v45: policy
  IF NOT has_wv_lines THEN
    INSERT INTO diag_checks VALUES (
      45, 'v45', 'Polityka warehouse_value_lines_auth', 'BRAK',
      'Najpierw uruchom migrację v45.',
      'Uruchom: 2026-v45-warehouse-value-magazyn.sql'
    );
  ELSIF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'warehouse_value_lines' AND policyname = 'warehouse_value_lines_auth'
  ) THEN
    INSERT INTO diag_checks VALUES (
      45, 'v45', 'Polityka warehouse_value_lines_auth', 'OK',
      'RLS dla zalogowanych na magazyn wartości – OK.', '—'
    );
  ELSE
    INSERT INTO diag_checks VALUES (
      45, 'v45', 'Polityka warehouse_value_lines_auth', 'BRAK',
      'Brak polityki authenticated – zapis Excel może nie działać po logowaniu.',
      'Ponownie uruchom: 2026-v45-warehouse-value-magazyn.sql'
    );
  END IF;
END;
$$;

-- Wynik 1: szczegółowa lista kontrolna
SELECT krok, element, status, szczegoly, co_dalej
FROM diag_checks
ORDER BY sort_order, element;

-- Wynik 2: podsumowanie (druga zakładka w SQL Editor)
SELECT
  CASE
    WHEN EXISTS (
      SELECT 1 FROM diag_checks
      WHERE krok = 'KROK 5' AND element = 'Funkcja is_active_app_user()' AND status = 'BRAK'
    )
      THEN 'STOP – najpierw KROK 5 (is_active_app_user). v45 się nie wykona bez tej funkcji.'
    WHEN EXISTS (SELECT 1 FROM diag_checks WHERE krok = 'KROK 1' AND status = 'BRAK')
      THEN 'STOP – najpierw KROK 1 (tabele app_users).'
    WHEN EXISTS (SELECT 1 FROM diag_checks WHERE krok = 'KROK 3' AND status = 'BRAK')
      THEN 'STOP – brak powiązania konta (KROK 2 + KROK 3).'
    WHEN EXISTS (
      SELECT 1 FROM diag_checks
      WHERE krok = 'v45' AND element LIKE 'Tabela warehouse_value%' AND status = 'BRAK'
    )
      THEN 'GOTOWE do v45 – uruchom: supabase/2026-v45-warehouse-value-magazyn.sql'
    WHEN EXISTS (
      SELECT 1 FROM diag_checks
      WHERE krok = 'v45' AND element = 'Tabela warehouse_value_batches' AND status = 'OK'
    )
      THEN 'v45 już wdrożone – możesz używać zakładki „Wartość magazynu” w aplikacji.'
    ELSE 'Sprawdź wiersze ze statusem BRAK / OSTRZEŻENIE powyżej.'
  END AS podsumowanie;
