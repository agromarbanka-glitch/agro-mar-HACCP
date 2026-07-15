-- v48: szybki import partii — alokacja numerów hurtowo (1500 partii w ~5 s zamiast godzin).
-- Uruchom w Supabase SQL Editor po v47.

BEGIN;

CREATE OR REPLACE FUNCTION public.allocate_lot_no_range(p_product_id uuid, p_year int, p_count int)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_start int;
  v_max int;
BEGIN
  IF p_count IS NULL OR p_count < 1 THEN
    RETURN 1;
  END IF;

  SELECT COALESCE(MAX(
    NULLIF(regexp_replace(split_part(l.lot_no, '/', 2), '[^0-9]', '', 'g'), '')::int
  ), 0)
  INTO v_max
  FROM public.lots l
  WHERE l.product_id = p_product_id
    AND split_part(l.lot_no, '/', 3) = p_year::text;

  INSERT INTO public.lot_sequences (product_id, year, next_number)
  VALUES (p_product_id, p_year, v_max + p_count + 1)
  ON CONFLICT (product_id, year) DO UPDATE
  SET next_number = GREATEST(public.lot_sequences.next_number, v_max + 1) + p_count
  RETURNING next_number - p_count INTO v_start;

  RETURN COALESCE(v_start, v_max + 1);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_incoming_lots_batch(p_items jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g record;
  v_start int;
  v_code text;
  v_count integer := 0;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN 0;
  END IF;

  CREATE TEMP TABLE _cli_items (
    item_id uuid PRIMARY KEY,
    product_id uuid NOT NULL,
    operation_id uuid NOT NULL,
    operation_date date NOT NULL,
    qty numeric NOT NULL,
    product_group text,
    lot_no text,
    lot_id uuid
  ) ON COMMIT DROP;

  INSERT INTO _cli_items (item_id, product_id, operation_id, operation_date, qty, product_group)
  SELECT
    x.item_id,
    x.product_id,
    x.operation_id,
    COALESCE(x.operation_date, CURRENT_DATE),
    x.qty,
    NULLIF(trim(COALESCE(x.product_group, '')), '')
  FROM jsonb_to_recordset(p_items) AS x(
    item_id uuid,
    product_id uuid,
    operation_id uuid,
    operation_date date,
    qty numeric,
    product_group text,
    unit_price_net numeric
  )
  WHERE x.item_id IS NOT NULL
    AND x.product_id IS NOT NULL
    AND x.operation_id IS NOT NULL
    AND COALESCE(x.qty, 0) > 0;

  INSERT INTO public.lot_sequences (product_id, year, next_number)
  SELECT DISTINCT product_id, extract(year FROM operation_date)::int, 1
  FROM _cli_items
  ON CONFLICT DO NOTHING;

  FOR g IN
    SELECT
      product_id,
      extract(year FROM operation_date)::int AS yr,
      count(*)::int AS cnt
    FROM _cli_items
    GROUP BY product_id, extract(year FROM operation_date)
  LOOP
    SELECT code INTO v_code FROM public.products WHERE id = g.product_id;
    IF v_code IS NULL THEN
      CONTINUE;
    END IF;

    v_start := public.allocate_lot_no_range(g.product_id, g.yr, g.cnt);

    UPDATE _cli_items i
    SET lot_no = v_code || '/'
      || lpad((v_start + sub.rn - 1)::text, GREATEST(3, length((v_start + g.cnt - 1)::text)), '0')
      || '/' || g.yr::text
    FROM (
      SELECT item_id, row_number() OVER (ORDER BY item_id) AS rn
      FROM _cli_items
      WHERE product_id = g.product_id
        AND extract(year FROM operation_date) = g.yr
    ) sub
    WHERE i.item_id = sub.item_id;
  END LOOP;

  WITH ins AS (
    INSERT INTO public.lots (
      product_id, lot_no, source_operation_id, production_date,
      initial_qty, remaining_qty, unit, product_group, storage_chamber_id
    )
    SELECT
      product_id, lot_no, operation_id, operation_date,
      qty, qty, 'kg', product_group, NULL
    FROM _cli_items
    WHERE lot_no IS NOT NULL
    RETURNING id, lot_no
  )
  UPDATE _cli_items i
  SET lot_id = ins.id
  FROM ins
  WHERE ins.lot_no = i.lot_no;

  UPDATE public.operation_items oi
  SET lot_id = i.lot_id
  FROM _cli_items i
  WHERE oi.id = i.item_id
    AND i.lot_id IS NOT NULL;

  SELECT count(*)::int INTO v_count FROM _cli_items WHERE lot_id IS NOT NULL;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_lot_no_range(uuid, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.allocate_lot_no_range(uuid, int, int) TO authenticated;

REVOKE ALL ON FUNCTION public.create_incoming_lots_batch(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_incoming_lots_batch(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_incoming_lots_batch(jsonb) TO anon;

COMMIT;
