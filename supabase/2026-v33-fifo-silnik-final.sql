-- v33 AGRO-MAR HACCP/FIFO
-- FINALNY SILNIK FIFO DLA K03:
-- 1) PZ może być użyte tylko wtedy, gdy data PZ <= data WZ.
-- 2) FIFO liczy po grupie asortymentowej, nie tylko po product_id.
-- 3) PZ są pobierane chronologicznie: data PZ, kolejność utworzenia, numer partii.
-- 4) K03 ma korzystać z tabeli fifo_allocations po tym przeliczeniu.

BEGIN;

-- Historia zmian PZ/FIFO, jeżeli jeszcze nie istnieje.
CREATE TABLE IF NOT EXISTS public.pz_fifo_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id uuid REFERENCES public.lots(id),
  source_operation_id uuid REFERENCES public.operations(id),
  document_no text,
  old_date date,
  new_date date,
  change_reason text,
  changed_by text DEFAULT 'admin',
  action_type text DEFAULT 'change_date',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Widok dla zakładki PZ/FIFO.
CREATE OR REPLACE VIEW public.pz_fifo_overview AS
WITH alloc AS (
  SELECT
    source_lot_id,
    SUM(qty)::numeric(14,3) AS allocated_qty
  FROM public.fifo_allocations
  GROUP BY source_lot_id
)
SELECT
  l.id,
  l.source_operation_id,
  l.product_id,
  l.lot_no,
  l.production_date,
  o.operation_date,
  o.document_no,
  p.name AS product_name,
  COALESCE(l.product_group, p.product_group, p.code, p.name) AS product_group,
  l.initial_qty::numeric(14,3) AS initial_qty,
  COALESCE(a.allocated_qty, 0)::numeric(14,3) AS allocated_qty,
  GREATEST(l.initial_qty - COALESCE(a.allocated_qty, 0), 0)::numeric(14,3) AS calculated_remaining_qty,
  CASE
    WHEN COALESCE(a.allocated_qty, 0) <= 0 THEN 'wolna'
    WHEN COALESCE(a.allocated_qty, 0) + 0.001 >= l.initial_qty THEN 'wykorzystana'
    ELSE 'czesciowo'
  END AS status_key,
  CASE
    WHEN COALESCE(a.allocated_qty, 0) <= 0 THEN 'Nieprzypisana'
    WHEN COALESCE(a.allocated_qty, 0) + 0.001 >= l.initial_qty THEN 'Wykorzystana'
    ELSE 'Częściowo wykorzystana'
  END AS status_label
FROM public.lots l
LEFT JOIN public.operations o ON o.id = l.source_operation_id
LEFT JOIN public.products p ON p.id = l.product_id
LEFT JOIN alloc a ON a.source_lot_id = l.id
WHERE l.initial_qty > 0;

-- Główna funkcja przeliczenia FIFO.
CREATE OR REPLACE FUNCTION public.recalculate_fifo_strict_by_group_date()
RETURNS TABLE(
  wz_no text,
  wz_date date,
  product_group text,
  wz_qty numeric,
  allocated_qty numeric,
  shortage numeric
)
LANGUAGE plpgsql
AS $$
DECLARE
  sale_rec record;
  lot_rec record;
  v_remaining numeric(14,3);
  v_take numeric(14,3);
  v_allocated numeric(14,3);
BEGIN
  -- Czyścimy tylko rozliczenia sprzedaży/WZ. Nie ruszamy historii zmian PZ.
  DELETE FROM public.fifo_allocations fa
  USING public.operations o
  WHERE fa.operation_id = o.id
    AND (
      o.operation_type IN ('sprzedaz', 'sprzedaz_bez_produkcji')
      OR UPPER(COALESCE(o.document_no, '')) LIKE 'WZ%'
    );

  -- Przywracamy stany partii przyjęciowych. Partie produkcyjne zostawiamy poza tym przeliczeniem.
  UPDATE public.lots l
  SET
    remaining_qty = initial_qty,
    status = CASE WHEN initial_qty > 0 THEN 'aktywna' ELSE status END
  WHERE COALESCE(l.initial_qty, 0) > 0
    AND (
      l.source_operation_id IS NULL
      OR l.source_operation_id IN (
        SELECT id
        FROM public.operations
        WHERE operation_type = 'przyjecie'
           OR UPPER(COALESCE(document_no, '')) LIKE 'PZ%'
           OR UPPER(COALESCE(document_no, '')) LIKE 'MM%'
      )
    );

  CREATE TEMP TABLE IF NOT EXISTS tmp_fifo_result (
    wz_no text,
    wz_date date,
    product_group text,
    wz_qty numeric,
    allocated_qty numeric,
    shortage numeric
  ) ON COMMIT DROP;
  TRUNCATE tmp_fifo_result;

  -- Każda pozycja WZ/FV jest rozliczana po grupie asortymentowej.
  FOR sale_rec IN
    SELECT
      oi.operation_id,
      oi.product_id AS sale_product_id,
      COALESCE(p.product_group, p.code, p.name) AS sale_group,
      o.operation_date AS sale_date,
      o.document_no AS sale_doc_no,
      o.created_at AS sale_created_at,
      SUM(ABS(COALESCE(oi.qty, 0)))::numeric(14,3) AS sale_qty
    FROM public.operation_items oi
    JOIN public.operations o ON o.id = oi.operation_id
    JOIN public.products p ON p.id = oi.product_id
    WHERE oi.direction = 'rozchod'
      AND (
        o.operation_type IN ('sprzedaz', 'sprzedaz_bez_produkcji')
        OR UPPER(COALESCE(o.document_no, '')) LIKE 'WZ%'
      )
    GROUP BY oi.operation_id, oi.product_id, COALESCE(p.product_group, p.code, p.name), o.operation_date, o.document_no, o.created_at
    HAVING SUM(ABS(COALESCE(oi.qty, 0))) > 0
    ORDER BY o.operation_date ASC, o.created_at ASC, o.document_no ASC, oi.product_id ASC
  LOOP
    v_remaining := sale_rec.sale_qty;
    v_allocated := 0;

    -- Twarda zasada: PZ może mieć datę tylko <= data WZ.
    FOR lot_rec IN
      SELECT
        l.id,
        l.product_id,
        l.remaining_qty,
        l.production_date,
        l.created_at,
        l.lot_no
      FROM public.lots l
      JOIN public.products lp ON lp.id = l.product_id
      WHERE COALESCE(l.product_group, lp.product_group, lp.code, lp.name) = sale_rec.sale_group
        AND COALESCE(l.remaining_qty, 0) > 0
        AND l.production_date IS NOT NULL
        AND l.production_date <= sale_rec.sale_date
      ORDER BY l.production_date ASC, l.created_at ASC, l.lot_no ASC
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_take := LEAST(COALESCE(lot_rec.remaining_qty, 0), v_remaining);
      IF v_take <= 0 THEN
        CONTINUE;
      END IF;

      UPDATE public.lots
      SET
        remaining_qty = remaining_qty - v_take,
        status = CASE WHEN remaining_qty - v_take <= 0.0005 THEN 'zuzyta' ELSE 'aktywna' END
      WHERE id = lot_rec.id;

      INSERT INTO public.fifo_allocations(operation_id, source_lot_id, product_id, qty)
      VALUES (sale_rec.operation_id, lot_rec.id, sale_rec.sale_product_id, v_take);

      v_remaining := v_remaining - v_take;
      v_allocated := v_allocated + v_take;
    END LOOP;

    INSERT INTO tmp_fifo_result(wz_no, wz_date, product_group, wz_qty, allocated_qty, shortage)
    VALUES (
      sale_rec.sale_doc_no,
      sale_rec.sale_date,
      sale_rec.sale_group,
      sale_rec.sale_qty,
      v_allocated,
      GREATEST(v_remaining, 0)
    );
  END LOOP;

  -- Porządkujemy status po przeliczeniu.
  UPDATE public.lots
  SET status = CASE WHEN COALESCE(remaining_qty, 0) <= 0.0005 THEN 'zuzyta' ELSE 'aktywna' END
  WHERE COALESCE(initial_qty, 0) > 0;

  RETURN QUERY
  SELECT r.wz_no, r.wz_date, r.product_group, r.wz_qty, r.allocated_qty, r.shortage
  FROM tmp_fifo_result r
  WHERE r.shortage > 0.0005
  ORDER BY r.wz_date, r.wz_no, r.product_group;
END;
$$;

COMMIT;

-- Uruchomienie przeliczenia. Jeżeli wynik zwróci 0 wierszy, FIFO jest kompletne.
-- Jeżeli zwróci wiersze, oznacza realny brak PZ dostępnego na dzień WZ.
SELECT * FROM public.recalculate_fifo_strict_by_group_date();
