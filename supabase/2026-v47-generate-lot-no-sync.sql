-- v47: naprawa generate_lot_no — synchronizacja z istniejącymi partiami (duży import lipca).
-- Błąd: „Nie udało się wygenerować unikalnego numeru partii dla produktu …”
-- Przyczyna: lot_sequences rozjechana względem tabeli lots (>5000 kolizji).
-- Uruchom w Supabase SQL Editor, potem ponów „Zapisz import”.

BEGIN;

CREATE OR REPLACE FUNCTION public.sync_lot_sequences_from_lots(p_product_ids uuid[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  INSERT INTO public.lot_sequences (product_id, year, next_number)
  SELECT
    l.product_id,
    split_part(l.lot_no, '/', 3)::int AS yr,
    MAX(NULLIF(regexp_replace(split_part(l.lot_no, '/', 2), '[^0-9]', '', 'g'), '')::int) + 1 AS next_num
  FROM public.lots l
  WHERE l.lot_no ~ '^[^/]+/[0-9]+/[0-9]{4}$'
    AND split_part(l.lot_no, '/', 3) ~ '^[0-9]{4}$'
    AND (p_product_ids IS NULL OR l.product_id = ANY(p_product_ids))
  GROUP BY l.product_id, split_part(l.lot_no, '/', 3)::int
  ON CONFLICT (product_id, year) DO UPDATE
  SET next_number = GREATEST(public.lot_sequences.next_number, EXCLUDED.next_number);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_lot_no(p_product_id uuid, p_date date)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_year int := extract(year FROM coalesce(p_date, CURRENT_DATE))::int;
  v_code text;
  v_number int;
  v_lot_no text;
  v_max_existing int;
  v_guard int := 0;
BEGIN
  SELECT code INTO v_code FROM public.products WHERE id = p_product_id;
  IF v_code IS NULL OR length(trim(v_code)) = 0 THEN
    RAISE EXCEPTION 'Nie znaleziono kodu produktu dla numeru partii';
  END IF;

  SELECT coalesce(MAX(
    NULLIF(regexp_replace(split_part(l.lot_no, '/', 2), '[^0-9]', '', 'g'), '')::int
  ), 0)
  INTO v_max_existing
  FROM public.lots l
  WHERE l.product_id = p_product_id
    AND split_part(l.lot_no, '/', 3) = v_year::text;

  INSERT INTO public.lot_sequences(product_id, year, next_number)
  VALUES (p_product_id, v_year, v_max_existing + 1)
  ON CONFLICT (product_id, year) DO UPDATE
  SET next_number = GREATEST(public.lot_sequences.next_number, v_max_existing + 1);

  LOOP
    v_guard := v_guard + 1;
    IF v_guard > 100 THEN
      RAISE EXCEPTION 'Nie udało się wygenerować unikalnego numeru partii dla produktu %', p_product_id;
    END IF;

    UPDATE public.lot_sequences
    SET next_number = next_number + 1
    WHERE product_id = p_product_id AND year = v_year
    RETURNING next_number - 1 INTO v_number;

    IF NOT FOUND THEN
      INSERT INTO public.lot_sequences(product_id, year, next_number)
      VALUES (p_product_id, v_year, v_max_existing + 2)
      RETURNING next_number - 1 INTO v_number;
    END IF;

    v_lot_no := v_code || '/'
      || lpad(v_number::text, GREATEST(3, length(v_number::text)), '0')
      || '/' || v_year::text;

    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.lots WHERE lot_no = v_lot_no);
  END LOOP;

  RETURN v_lot_no;
END;
$$;

-- Jednorazowa synchronizacja wszystkich produktów
SELECT public.sync_lot_sequences_from_lots(NULL);

REVOKE ALL ON FUNCTION public.sync_lot_sequences_from_lots(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_lot_sequences_from_lots(uuid[]) TO authenticated;

COMMIT;
