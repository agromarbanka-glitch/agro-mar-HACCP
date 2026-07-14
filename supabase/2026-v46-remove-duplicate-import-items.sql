-- v46: usuwa zduplikowane pozycje przyjęć (operation_items) i powiązane partie/K01.
-- Uruchom w Supabase SQL Editor po wykryciu potrójnych K01 / PZ z tego samego importu.

CREATE OR REPLACE FUNCTION public.remove_duplicate_incoming_items()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item_ids uuid[];
  v_lot_ids uuid[];
  v_k01_ids uuid[];
  v_items int := 0;
  v_lots int := 0;
  v_k01 int := 0;
BEGIN
  SELECT array_agg(id ORDER BY id)
  INTO v_item_ids
  FROM (
    SELECT oi.id,
      ROW_NUMBER() OVER (
        PARTITION BY oi.operation_id, oi.product_id, ROUND(oi.qty::numeric, 3)
        ORDER BY oi.id
      ) AS rn
    FROM operation_items oi
    WHERE oi.direction = 'przychod'
  ) ranked
  WHERE rn > 1;

  IF v_item_ids IS NULL OR array_length(v_item_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('items_removed', 0, 'lots_removed', 0, 'k01_removed', 0);
  END IF;

  SELECT array_agg(DISTINCT lot_id)
  INTO v_lot_ids
  FROM operation_items
  WHERE id = ANY(v_item_ids) AND lot_id IS NOT NULL;

  IF v_lot_ids IS NOT NULL AND array_length(v_lot_ids, 1) > 0 THEN
    SELECT array_agg(id)
    INTO v_k01_ids
    FROM haccp_documents
    WHERE document_type = 'K01' AND lot_id = ANY(v_lot_ids);

    IF v_k01_ids IS NOT NULL AND array_length(v_k01_ids, 1) > 0 THEN
      DELETE FROM haccp_document_history WHERE document_id = ANY(v_k01_ids);
      DELETE FROM haccp_documents WHERE id = ANY(v_k01_ids);
      v_k01 := array_length(v_k01_ids, 1);
    END IF;

    DELETE FROM fifo_allocations
    WHERE source_lot_id = ANY(v_lot_ids) OR output_lot_id = ANY(v_lot_ids);

    DELETE FROM pz_fifo_change_log WHERE lot_id = ANY(v_lot_ids);
    DELETE FROM lot_location_history WHERE lot_id = ANY(v_lot_ids);
    DELETE FROM lot_change_history WHERE lot_id = ANY(v_lot_ids);
    DELETE FROM lots WHERE id = ANY(v_lot_ids);
    v_lots := array_length(v_lot_ids, 1);
  END IF;

  DELETE FROM operation_items WHERE id = ANY(v_item_ids);
  v_items := array_length(v_item_ids, 1);

  RETURN jsonb_build_object(
    'items_removed', v_items,
    'lots_removed', COALESCE(v_lots, 0),
    'k01_removed', COALESCE(v_k01, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.remove_duplicate_incoming_items() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_duplicate_incoming_items() TO authenticated;
