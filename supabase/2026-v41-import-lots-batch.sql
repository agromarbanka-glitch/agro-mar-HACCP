-- v41 AGRO-MAR: szybszy import Excel – tworzenie partii w jednym wywołaniu RPC (serwer)
-- Uruchom w Supabase SQL Editor po v40.

BEGIN;

CREATE OR REPLACE FUNCTION public.create_incoming_lots_batch(p_items jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_lot_no text;
  v_lot_id uuid;
  v_count integer := 0;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT *
    FROM jsonb_to_recordset(p_items) AS x(
      item_id uuid,
      product_id uuid,
      operation_id uuid,
      operation_date date,
      qty numeric,
      product_group text
    )
  LOOP
    IF r.item_id IS NULL OR r.product_id IS NULL OR r.operation_id IS NULL THEN
      CONTINUE;
    END IF;
    IF COALESCE(r.qty, 0) <= 0 THEN
      CONTINUE;
    END IF;

    v_lot_no := public.generate_lot_no(r.product_id, COALESCE(r.operation_date, CURRENT_DATE));

    INSERT INTO public.lots (
      product_id,
      lot_no,
      source_operation_id,
      production_date,
      initial_qty,
      remaining_qty,
      unit,
      product_group,
      storage_chamber_id
    ) VALUES (
      r.product_id,
      v_lot_no,
      r.operation_id,
      COALESCE(r.operation_date, CURRENT_DATE),
      r.qty,
      r.qty,
      'kg',
      NULLIF(TRIM(COALESCE(r.product_group, '')), ''),
      NULL
    )
    RETURNING id INTO v_lot_id;

    UPDATE public.operation_items
    SET lot_id = v_lot_id
    WHERE id = r.item_id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.create_incoming_lots_batch(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_incoming_lots_batch(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_incoming_lots_batch(jsonb) TO anon;

COMMIT;
