-- =============================================================================
-- AGRO-MAR HACCP – Diagnostyka przed migracją v45 (Wartość magazynu)
-- =============================================================================
-- Gdzie uruchomić: Supabase → SQL Editor → New query → wklej CAŁOŚĆ → Run
--
-- Co robi:
--   Sprawdza KROKI logowania 1–5 oraz czy v45 jest już wdrożone.
--   Na końcu widać podsumowanie: co OK, czego brakuje i jaki plik uruchomić.
--
-- Nie modyfikuje bazy – tylko odczyt (bezpieczne do wielokrotnego uruchomienia).
-- =============================================================================

WITH
checks AS (
  -- ---------------------------------------------------------------------------
  -- KROK 0 – Połączenie (zawsze OK jeśli skrypt się wykonał)
  -- ---------------------------------------------------------------------------
  SELECT
    0 AS sort_order,
    'KROK 0' AS krok,
    'Połączenie z bazą' AS element,
    'OK'::text AS status,
    'Skrypt wykonany w SQL Editor – projekt Supabase odpowiada.' AS szczegoly,
    '—'::text AS co_dalej

  UNION ALL

  -- ---------------------------------------------------------------------------
  -- KROK 1 – Tabele app_users / app_audit_log
  -- ---------------------------------------------------------------------------
  SELECT
    1,
    'KROK 1',
    'Tabela app_users',
    CASE WHEN to_regclass('public.app_users') IS NOT NULL THEN 'OK' ELSE 'BRAK' END,
    CASE
      WHEN to_regclass('public.app_users') IS NULL THEN 'Brak tabeli użytkowników aplikacji.'
      ELSE 'Tabela istnieje · aktywnych użytkowników: ' ||
        COALESCE((
          SELECT COUNT(*)::text FROM public.app_users WHERE is_active = true
        ), '0')
    END,
    CASE
      WHEN to_regclass('public.app_users') IS NULL
        THEN 'Uruchom: LOGOWANIE-KROK-1-tablery.sql (lub LOGOWANIE-KROK-1-NAPRAW.sql przy błędzie kolumny auth_user_id)'
      ELSE '—'
    END

  UNION ALL

  SELECT
    1,
    'KROK 1',
    'Tabela app_audit_log',
    CASE WHEN to_regclass('public.app_audit_log') IS NOT NULL THEN 'OK' ELSE 'BRAK' END,
    CASE
      WHEN to_regclass('public.app_audit_log') IS NULL THEN 'Brak tabeli historii zmian.'
      ELSE 'Tabela istnieje · wpisów: ' ||
        COALESCE((SELECT COUNT(*)::text FROM public.app_audit_log), '0')
    END,
    CASE
      WHEN to_regclass('public.app_audit_log') IS NULL
        THEN 'Uruchom: LOGOWANIE-KROK-1-tablery.sql'
      ELSE '—'
    END

  UNION ALL

  SELECT
    1,
    'KROK 1',
    'Kolumna app_users.auth_user_id',
    CASE
      WHEN to_regclass('public.app_users') IS NULL THEN 'BRAK'
      WHEN EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'app_users' AND column_name = 'auth_user_id'
      ) THEN 'OK'
      ELSE 'BRAK'
    END,
    CASE
      WHEN to_regclass('public.app_users') IS NULL THEN 'Najpierw utwórz app_users (KROK 1).'
      WHEN EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'app_users' AND column_name = 'auth_user_id'
      ) THEN 'Struktura tabeli poprawna.'
      ELSE 'Stara/wadliwa wersja tabeli – brak auth_user_id.'
    END,
    CASE
      WHEN to_regclass('public.app_users') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'app_users' AND column_name = 'auth_user_id'
        )
        THEN 'Uruchom: LOGOWANIE-KROK-1-NAPRAW.sql'
      ELSE '—'
    END

  UNION ALL

  -- ---------------------------------------------------------------------------
  -- KROK 2 – Konto w Authentication (auth.users)
  -- ---------------------------------------------------------------------------
  SELECT
    2,
    'KROK 2',
    'Użytkownicy w Authentication',
    CASE
      WHEN to_regclass('auth.users') IS NULL THEN 'BRAK'
      WHEN (SELECT COUNT(*) FROM auth.users) > 0 THEN 'OK'
      ELSE 'BRAK'
    END,
    CASE
      WHEN (SELECT COUNT(*) FROM auth.users) = 0
        THEN 'Brak kont w Authentication → Users.'
      ELSE 'Kont w Authentication: ' || (SELECT COUNT(*)::text FROM auth.users) ||
        ' · przykładowe emaile: ' ||
        COALESCE((
          SELECT string_agg(email, ', ' ORDER BY email)
          FROM (SELECT email FROM auth.users ORDER BY created_at LIMIT 3) s
        ), '—')
    END,
    CASE
      WHEN (SELECT COUNT(*) FROM auth.users) = 0
        THEN 'Supabase → Authentication → Users → Add user (zaznacz Auto Confirm User)'
      ELSE '—'
    END

  UNION ALL

  -- ---------------------------------------------------------------------------
  -- KROK 3 – Powiązanie auth.users ↔ app_users
  -- ---------------------------------------------------------------------------
  SELECT
    3,
    'KROK 3',
    'Administrator w app_users',
    CASE
      WHEN to_regclass('public.app_users') IS NULL THEN 'BRAK'
      WHEN (SELECT COUNT(*) FROM public.app_users WHERE role = 'admin' AND is_active = true) > 0 THEN 'OK'
      WHEN (SELECT COUNT(*) FROM public.app_users) > 0 THEN 'OSTRZEŻENIE'
      ELSE 'BRAK'
    END,
    CASE
      WHEN to_regclass('public.app_users') IS NULL THEN 'Brak tabeli app_users.'
      WHEN (SELECT COUNT(*) FROM public.app_users WHERE role = 'admin' AND is_active = true) > 0
        THEN 'Adminów aktywnych: ' ||
          (SELECT COUNT(*)::text FROM public.app_users WHERE role = 'admin' AND is_active = true)
      WHEN (SELECT COUNT(*) FROM public.app_users) > 0
        THEN 'Są użytkownicy app_users, ale brak aktywnego admina.'
      ELSE 'Brak wpisów w app_users – konto Auth nie jest powiązane z aplikacją.'
    END,
    CASE
      WHEN to_regclass('public.app_users') IS NOT NULL
        AND (SELECT COUNT(*) FROM public.app_users WHERE role = 'admin' AND is_active = true) = 0
        THEN 'Uruchom: LOGOWANIE-KROK-3-admin.sql (popraw email w pliku na ten z Authentication)'
      ELSE '—'
    END

  UNION ALL

  SELECT
    3,
    'KROK 3',
    'Lista kont app_users',
    CASE
      WHEN to_regclass('public.app_users') IS NULL THEN 'BRAK'
      WHEN (SELECT COUNT(*) FROM public.app_users) = 0 THEN 'BRAK'
      ELSE 'OK'
    END,
    CASE
      WHEN to_regclass('public.app_users') IS NULL THEN 'Brak tabeli.'
      WHEN (SELECT COUNT(*) FROM public.app_users) = 0 THEN 'Tabela pusta.'
      ELSE COALESCE((
        SELECT string_agg(
          email || ' · ' || role || CASE WHEN is_active THEN '' ELSE ' (nieaktywny)' END,
          ' | ' ORDER BY role, email
        )
        FROM public.app_users
      ), '—')
    END,
    CASE
      WHEN to_regclass('public.app_users') IS NOT NULL AND (SELECT COUNT(*) FROM public.app_users) = 0
        THEN 'Uruchom: LOGOWANIE-KROK-3-admin.sql'
      ELSE '—'
    END

  UNION ALL

  SELECT
    3,
    'KROK 3',
    'Powiązanie auth_user_id',
    CASE
      WHEN to_regclass('public.app_users') IS NULL THEN 'BRAK'
      WHEN (
        SELECT COUNT(*)
        FROM public.app_users au
        JOIN auth.users u ON u.id = au.auth_user_id
      ) > 0 THEN 'OK'
      ELSE 'BRAK'
    END,
    CASE
      WHEN to_regclass('public.app_users') IS NULL THEN 'Brak tabeli app_users.'
      WHEN (
        SELECT COUNT(*)
        FROM public.app_users au
        JOIN auth.users u ON u.id = au.auth_user_id
      ) = 0
        THEN 'Żaden wpis app_users nie ma poprawnego auth_user_id z auth.users.'
      ELSE 'Poprawnie powiązanych kont: ' || (
        SELECT COUNT(*)::text
        FROM public.app_users au
        JOIN auth.users u ON u.id = au.auth_user_id
      )
    END,
    CASE
      WHEN to_regclass('public.app_users') IS NOT NULL
        AND (
          SELECT COUNT(*)
          FROM public.app_users au
          JOIN auth.users u ON u.id = au.auth_user_id
        ) = 0
        THEN 'Uruchom: LOGOWANIE-KROK-3-admin.sql'
      ELSE '—'
    END

  UNION ALL

  -- ---------------------------------------------------------------------------
  -- KROK 4 – Naprawa RLS app_users (is_app_admin)
  -- ---------------------------------------------------------------------------
  SELECT
    4,
    'KROK 4',
    'Funkcja is_app_admin()',
    CASE
      WHEN EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'is_app_admin'
      ) THEN 'OK'
      ELSE 'OSTRZEŻENIE'
    END,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'is_app_admin'
      ) THEN 'Funkcja istnieje (naprawa infinite recursion na app_users).'
      ELSE 'Funkcja nie znaleziona – może działać, ale przy błędzie „infinite recursion” uruchom KROK 4.'
    END,
    CASE
      WHEN NOT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'is_app_admin'
      )
        THEN 'Opcjonalnie / przy błędzie RLS: LOGOWANIE-KROK-4-fix-rls.sql'
      ELSE '—'
    END

  UNION ALL

  -- ---------------------------------------------------------------------------
  -- KROK 5 – is_active_app_user + polityki authenticated (HACCP / magazyn partii)
  -- ---------------------------------------------------------------------------
  SELECT
    5,
    'KROK 5',
    'Funkcja is_active_app_user()',
    CASE
      WHEN EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'is_active_app_user'
      ) THEN 'OK'
      ELSE 'BRAK'
    END,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'is_active_app_user'
      ) THEN 'Funkcja wymagana przez v45 i dostęp zalogowanych do HACCP.'
      ELSE 'BEZ TEGO v45 się nie wykona i po zalogowaniu mogą być puste listy.'
    END,
    CASE
      WHEN NOT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'is_active_app_user'
      )
        THEN 'OBOWIĄZKOWO przed v45: LOGOWANIE-KROK-5-haccp-rls-authenticated.sql'
      ELSE '—'
    END

  UNION ALL

  SELECT
    5,
    'KROK 5',
    'Polityka haccp_documents_auth',
    CASE
      WHEN EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'haccp_documents' AND policyname = 'haccp_documents_auth'
      ) THEN 'OK'
      WHEN to_regclass('public.haccp_documents') IS NULL THEN 'OSTRZEŻENIE'
      ELSE 'BRAK'
    END,
    CASE
      WHEN to_regclass('public.haccp_documents') IS NULL
        THEN 'Tabela haccp_documents nie istnieje (inny problem niż logowanie).'
      WHEN EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'haccp_documents' AND policyname = 'haccp_documents_auth'
      ) THEN 'RLS dla zalogowanych na kartoteki HACCP – OK.'
      ELSE 'Brak polityki authenticated – po logowaniu kartoteki mogą być puste.'
    END,
    CASE
      WHEN to_regclass('public.haccp_documents') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'haccp_documents' AND policyname = 'haccp_documents_auth'
        )
        THEN 'Uruchom: LOGOWANIE-KROK-5-haccp-rls-authenticated.sql'
      ELSE '—'
    END

  UNION ALL

  SELECT
    5,
    'KROK 5',
    'Polityka operations_auth (magazyn HACCP)',
    CASE
      WHEN EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'operations' AND policyname = 'operations_auth'
      ) THEN 'OK'
      WHEN to_regclass('public.operations') IS NULL THEN 'OSTRZEŻENIE'
      ELSE 'BRAK'
    END,
    CASE
      WHEN to_regclass('public.operations') IS NULL THEN 'Tabela operations nie istnieje.'
      WHEN EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'operations' AND policyname = 'operations_auth'
      ) THEN 'RLS magazynu partii (HACCP FIFO) dla zalogowanych – OK.'
      ELSE 'Brak polityki – importy/magazyn HACCP mogą nie działać po logowaniu.'
    END,
    CASE
      WHEN to_regclass('public.operations') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'operations' AND policyname = 'operations_auth'
        )
        THEN 'Uruchom: LOGOWANIE-KROK-5-haccp-rls-authenticated.sql'
      ELSE '—'
    END

  UNION ALL

  SELECT
    5,
    'KROK 5',
    'Dane HACCP (sanity check)',
    CASE
      WHEN to_regclass('public.haccp_documents') IS NULL THEN 'OSTRZEŻENIE'
      WHEN (SELECT COUNT(*) FROM public.haccp_documents) > 0 THEN 'OK'
      ELSE 'OSTRZEŻENIE'
    END,
    CASE
      WHEN to_regclass('public.haccp_documents') IS NULL THEN 'Brak tabeli kartotek.'
      ELSE 'Kartotek w bazie: ' || (SELECT COUNT(*)::text FROM public.haccp_documents)
    END,
    CASE
      WHEN to_regclass('public.haccp_documents') IS NOT NULL
        AND (SELECT COUNT(*) FROM public.haccp_documents) = 0
        THEN 'Baza pusta lub brak dostępu – po KROKU 5 zaloguj się w aplikacji i odśwież (Ctrl+F5)'
      ELSE '—'
    END

  UNION ALL

  -- ---------------------------------------------------------------------------
  -- v45 – Wartość magazynu (osobne tabele, nie HACCP FIFO)
  -- ---------------------------------------------------------------------------
  SELECT
    45,
    'v45',
    'Tabela warehouse_value_batches',
    CASE WHEN to_regclass('public.warehouse_value_batches') IS NOT NULL THEN 'OK' ELSE 'BRAK' END,
    CASE
      WHEN to_regclass('public.warehouse_value_batches') IS NULL THEN 'Magazyn wartości (Excel FIFO) jeszcze nie utworzony.'
      ELSE 'Importów Excel: ' || (SELECT COUNT(*)::text FROM public.warehouse_value_batches)
    END,
    CASE
      WHEN to_regclass('public.warehouse_value_batches') IS NULL
        THEN 'Po KROKU 5 uruchom: 2026-v45-warehouse-value-magazyn.sql'
      ELSE '—'
    END

  UNION ALL

  SELECT
    45,
    'v45',
    'Tabela warehouse_value_lines',
    CASE WHEN to_regclass('public.warehouse_value_lines') IS NOT NULL THEN 'OK' ELSE 'BRAK' END,
    CASE
      WHEN to_regclass('public.warehouse_value_lines') IS NULL THEN 'Brak wierszy PZ/WZ magazynu wartości.'
      ELSE 'Wierszy PZ/WZ: ' || (SELECT COUNT(*)::text FROM public.warehouse_value_lines)
    END,
    CASE
      WHEN to_regclass('public.warehouse_value_lines') IS NULL
        THEN 'Uruchom: 2026-v45-warehouse-value-magazyn.sql'
      ELSE '—'
    END

  UNION ALL

  SELECT
    45,
    'v45',
    'Tabela warehouse_value_snapshots',
    CASE WHEN to_regclass('public.warehouse_value_snapshots') IS NOT NULL THEN 'OK' ELSE 'BRAK' END,
    CASE
      WHEN to_regclass('public.warehouse_value_snapshots') IS NULL THEN 'Brak tabeli snapshotów.'
      ELSE 'Snapshotów: ' || (SELECT COUNT(*)::text FROM public.warehouse_value_snapshots)
    END,
    CASE
      WHEN to_regclass('public.warehouse_value_snapshots') IS NULL
        THEN 'Uruchom: 2026-v45-warehouse-value-magazyn.sql'
      ELSE '—'
    END

  UNION ALL

  SELECT
    45,
    'v45',
    'Polityka warehouse_value_lines_auth',
    CASE
      WHEN to_regclass('public.warehouse_value_lines') IS NULL THEN 'BRAK'
      WHEN EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'warehouse_value_lines' AND policyname = 'warehouse_value_lines_auth'
      ) THEN 'OK'
      ELSE 'BRAK'
    END,
    CASE
      WHEN to_regclass('public.warehouse_value_lines') IS NULL THEN 'Najpierw uruchom migrację v45.'
      WHEN EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'warehouse_value_lines' AND policyname = 'warehouse_value_lines_auth'
      ) THEN 'RLS dla zalogowanych na magazyn wartości – OK.'
      ELSE 'Brak polityki authenticated – zapis Excel może nie działać po logowaniu.'
    END,
    CASE
      WHEN to_regclass('public.warehouse_value_lines') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'warehouse_value_lines' AND policyname = 'warehouse_value_lines_auth'
        )
        THEN 'Ponownie uruchom: 2026-v45-warehouse-value-magazyn.sql'
      ELSE '—'
    END
),

summary AS (
  SELECT
    CASE
      WHEN EXISTS (SELECT 1 FROM checks WHERE krok = 'KROK 5' AND element = 'Funkcja is_active_app_user()' AND status = 'BRAK')
        THEN 'STOP – najpierw KROK 5 (is_active_app_user). v45 się nie wykona bez tej funkcji.'
      WHEN EXISTS (SELECT 1 FROM checks WHERE krok = 'KROK 1' AND status = 'BRAK')
        THEN 'STOP – najpierw KROK 1 (tabele app_users).'
      WHEN EXISTS (SELECT 1 FROM checks WHERE krok = 'KROK 3' AND status = 'BRAK')
        THEN 'STOP – brak powiązania konta (KROK 2 + KROK 3).'
      WHEN EXISTS (SELECT 1 FROM checks WHERE krok = 'v45' AND element LIKE 'Tabela warehouse_value%' AND status = 'BRAK')
        THEN 'GOTOWE do v45 – uruchom: supabase/2026-v45-warehouse-value-magazyn.sql'
      WHEN EXISTS (SELECT 1 FROM checks WHERE krok = 'v45' AND element = 'Tabela warehouse_value_batches' AND status = 'OK')
        THEN 'v45 już wdrożone – możesz używać zakładki „Wartość magazynu” w aplikacji.'
      ELSE 'Sprawdź wiersze ze statusem BRAK / OSTRZEŻENIE poniżej.'
    END AS werdykt
)

-- Wynik 1: szczegółowa lista kontrolna
SELECT
  krok,
  element,
  status,
  szczegoly,
  co_dalej
FROM checks
ORDER BY sort_order, element;

-- Wynik 2: jedno zdanie podsumowania (druga zakładka wyników w SQL Editor)
SELECT werdykt AS podsumowanie FROM summary;
