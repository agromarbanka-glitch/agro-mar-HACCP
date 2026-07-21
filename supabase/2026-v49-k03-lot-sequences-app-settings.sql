-- v49: sekwencje numerów partii K03 (atomowo) + ustawienia aplikacji (prefiksy, reguły).
-- Uruchom w Supabase SQL Editor po migracjach v36 (auth) i v22 (haccp_documents).

BEGIN;

-- === Sekwencje partii wyrobu gotowego K03 (Pcz/001/2026, Pczp/001/2026, …) ===
CREATE TABLE IF NOT EXISTS public.k03_lot_sequences (
  lot_code text NOT NULL,
  year int NOT NULL,
  next_number int NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lot_code, year)
);

COMMENT ON TABLE public.k03_lot_sequences IS 'Kolejne numery partii wyrobu gotowego K03 – osobna sekwencja na kod (Pcz, Pczp, Mp…) i rok.';

CREATE OR REPLACE FUNCTION public.sync_k03_lot_sequences_from_documents()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  INSERT INTO public.k03_lot_sequences (lot_code, year, next_number)
  SELECT
    upper(split_part(d.lot_no, '/', 1)) AS lot_code,
    split_part(d.lot_no, '/', 3)::int AS yr,
    MAX(NULLIF(regexp_replace(split_part(d.lot_no, '/', 2), '[^0-9]', '', 'g'), '')::int) + 1 AS next_num
  FROM public.haccp_documents d
  WHERE d.document_type = 'K03'
    AND d.lot_no ~ '^[^/]+/[0-9]+/[0-9]{4}$'
    AND split_part(d.lot_no, '/', 3) ~ '^[0-9]{4}$'
  GROUP BY upper(split_part(d.lot_no, '/', 1)), split_part(d.lot_no, '/', 3)::int
  ON CONFLICT (lot_code, year) DO UPDATE
  SET next_number = GREATEST(public.k03_lot_sequences.next_number, EXCLUDED.next_number),
      updated_at = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.allocate_k03_lot_no(p_code text, p_year int)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text := upper(trim(coalesce(p_code, '')));
  v_year int := coalesce(p_year, extract(year FROM CURRENT_DATE)::int);
  v_number int;
  v_lot_no text;
  v_max_existing int;
  v_guard int := 0;
BEGIN
  IF v_code = '' THEN
    RAISE EXCEPTION 'Brak kodu partii K03 (p_code)';
  END IF;
  IF v_year < 2000 OR v_year > 2100 THEN
    RAISE EXCEPTION 'Nieprawidłowy rok partii K03: %', v_year;
  END IF;

  SELECT coalesce(MAX(
    NULLIF(regexp_replace(split_part(d.lot_no, '/', 2), '[^0-9]', '', 'g'), '')::int
  ), 0)
  INTO v_max_existing
  FROM public.haccp_documents d
  WHERE d.document_type = 'K03'
    AND upper(split_part(d.lot_no, '/', 1)) = v_code
    AND split_part(d.lot_no, '/', 3) = v_year::text;

  INSERT INTO public.k03_lot_sequences (lot_code, year, next_number)
  VALUES (v_code, v_year, v_max_existing + 1)
  ON CONFLICT (lot_code, year) DO UPDATE
  SET next_number = GREATEST(public.k03_lot_sequences.next_number, v_max_existing + 1),
      updated_at = now();

  LOOP
    v_guard := v_guard + 1;
    IF v_guard > 200 THEN
      RAISE EXCEPTION 'Nie udało się wygenerować unikalnego numeru K03 dla %/%', v_code, v_year;
    END IF;

    UPDATE public.k03_lot_sequences
    SET next_number = next_number + 1, updated_at = now()
    WHERE lot_code = v_code AND year = v_year
    RETURNING next_number - 1 INTO v_number;

    IF NOT FOUND THEN
      INSERT INTO public.k03_lot_sequences (lot_code, year, next_number)
      VALUES (v_code, v_year, v_max_existing + 2)
      RETURNING next_number - 1 INTO v_number;
    END IF;

    v_lot_no := v_code || '/' || lpad(v_number::text, 3, '0') || '/' || v_year::text;

    IF NOT EXISTS (
      SELECT 1 FROM public.haccp_documents d
      WHERE d.document_type = 'K03' AND d.lot_no = v_lot_no
    ) THEN
      RETURN v_lot_no;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_k03_lot_sequences_from_documents() TO authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_k03_lot_no(text, int) TO authenticated;

-- === Ustawienia aplikacji (prefiksy partii, reguły bez deploy) ===
CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL
);

COMMENT ON TABLE public.app_settings IS 'Konfiguracja aplikacji HACCP – edytowalna z zakładki Ustawienia.';

INSERT INTO public.app_settings (key, value) VALUES
  ('k03_lot_prefix_rules', '{
    "porzeczka_czarna_bez_przerobu": "Pcz",
    "porzeczka_czarna_przerob": "Pczp",
    "porzeczka_kolorowa_bez_przerobu": "Pk",
    "porzeczka_kolorowa_przerob": "Pkp",
    "malina_przerob": "Mp",
    "malina_pw": "Mpw",
    "malina_klasa_i": "M1",
    "malina_extra": "Mex",
    "malina_pulpa": "Mp",
    "defaults": {
      "malina pulpa": "Mp",
      "porzeczka czarna": "Pcz",
      "porzeczka czarna pulpa": "Pczp",
      "porzeczka kolorowa": "Pk",
      "porzeczka kolorowa pulpa": "Pkp",
      "truskawka": "T"
    }
  }'::jsonb),
  ('magazynier_visible_tabs', '["kartoteki", "archiwum-pdf"]'::jsonb)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_settings_read_authenticated ON public.app_settings;
CREATE POLICY app_settings_read_authenticated ON public.app_settings
  FOR SELECT TO authenticated USING (public.is_active_app_user());

DROP POLICY IF EXISTS app_settings_write_admin ON public.app_settings;
CREATE POLICY app_settings_write_admin ON public.app_settings
  FOR ALL TO authenticated
  USING (public.is_app_admin())
  WITH CHECK (public.is_app_admin());

-- Inicjalna synchronizacja sekwencji z istniejących kart K03
SELECT public.sync_k03_lot_sequences_from_documents();

COMMIT;
