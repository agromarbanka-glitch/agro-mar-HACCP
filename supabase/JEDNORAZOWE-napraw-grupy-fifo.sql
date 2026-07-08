-- =============================================================================
-- JEDNORAZOWE: naprawa grup asortymentowych + reset FIFO (bez kasowania importu)
-- Supabase → SQL Editor → wklej CAŁOŚĆ → Run
--
-- Gdy diagnostyka K03 pokazuje grupę typu „2026-07-01” zamiast „truskawka”
-- albo „PZ łącznie 156 t, z datą ≤ WZ: 0 kg”.
-- =============================================================================

BEGIN;

-- 1) Napraw product_group w products (daty / kody → grupa z nazwy)
UPDATE public.products p
SET product_group = CASE
  WHEN lower(replace(replace(p.name, 'ł', 'l'), 'Ł', 'L')) LIKE '%truskawk%' THEN 'truskawka'
  WHEN lower(replace(replace(p.name, 'ł', 'l'), 'Ł', 'L')) LIKE '%malin%' THEN 'malina'
  WHEN lower(replace(replace(p.name, 'ł', 'l'), 'Ł', 'L')) LIKE '%wisn%' THEN 'wisnia'
  WHEN lower(replace(replace(p.name, 'ł', 'l'), 'Ł', 'L')) LIKE '%porzeczka czarna%' THEN 'porzeczka_czarna'
  WHEN lower(replace(replace(p.name, 'ł', 'l'), 'Ł', 'L')) LIKE '%porzeczka czerwona%' THEN 'porzeczka_czerwona'
  WHEN lower(replace(replace(p.name, 'ł', 'l'), 'Ł', 'L')) LIKE '%aronia%' THEN 'aronia'
  WHEN lower(replace(replace(p.name, 'ł', 'l'), 'Ł', 'L')) LIKE '%sliw%' OR lower(p.name) LIKE '%śliw%' THEN 'sliwka'
  WHEN lower(replace(replace(p.name, 'ł', 'l'), 'Ł', 'L')) LIKE '%obier%' THEN 'jab_obier'
  WHEN lower(replace(replace(p.name, 'ł', 'l'), 'Ł', 'L')) LIKE '%jabl%' OR lower(p.name) LIKE '%jabł%' THEN 'jab_przem'
  ELSE COALESCE(NULLIF(trim(p.product_group), ''), 'inna')
END
WHERE p.product_group IS NULL
   OR p.product_group ~ '^\d{4}-\d{2}-\d{2}$'
   OR p.product_group IN ('T', 'Tsz', 'M1', 'Mex', 'Mp', 'A', 'S', 'W', 'Jab', 'Jabobier', 'Pcz', 'Pk');

-- 2) Partie – grupa z produktu
UPDATE public.lots l
SET product_group = p.product_group
FROM public.products p
WHERE p.id = l.product_id
  AND (
    l.product_group IS NULL
    OR l.product_group ~ '^\d{4}-\d{2}-\d{2}$'
    OR l.product_group <> p.product_group
  );

-- 3) Reset rozliczeń FIFO (zostawia PZ/WZ i partie)
DELETE FROM public.fifo_allocations;

UPDATE public.lots l
SET
  remaining_qty = l.initial_qty,
  status = CASE WHEN COALESCE(l.initial_qty, 0) > 0 THEN 'aktywna' ELSE l.status END
WHERE COALESCE(l.initial_qty, 0) > 0
  AND (
    l.source_operation_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.operations o
      WHERE o.id = l.source_operation_id
        AND (
          o.operation_type = 'przyjecie'
          OR upper(COALESCE(o.document_no, '')) LIKE 'PZ%'
          OR upper(COALESCE(o.document_no, '')) LIKE 'MM%'
        )
    )
  );

COMMIT;

-- =============================================================================
-- KONTROLA – truskawka (powinno być truskawka, nie data)
-- =============================================================================
SELECT 'produkty_truskawka_zle_grupy' AS test, COUNT(*)::bigint
FROM public.products
WHERE lower(name) LIKE '%truskawk%'
  AND COALESCE(product_group, '') <> 'truskawka'

UNION ALL

SELECT 'partie_truskawka', COUNT(*)::bigint
FROM public.lots l
JOIN public.products p ON p.id = l.product_id
WHERE lower(p.name) LIKE '%truskawk%'

UNION ALL

SELECT 'pz_truskawka_do_30_06', COALESCE(SUM(l.initial_qty), 0)::bigint
FROM public.lots l
JOIN public.products p ON p.id = l.product_id
JOIN public.operations o ON o.id = l.source_operation_id
WHERE lower(p.name) LIKE '%truskawk%'
  AND COALESCE(o.operation_date, l.production_date) <= DATE '2026-06-30'

UNION ALL

SELECT 'pz_truskawka_po_30_06', COALESCE(SUM(l.initial_qty), 0)::bigint
FROM public.lots l
JOIN public.products p ON p.id = l.product_id
JOIN public.operations o ON o.id = l.source_operation_id
WHERE lower(p.name) LIKE '%truskawk%'
  AND COALESCE(o.operation_date, l.production_date) > DATE '2026-06-30';

-- Jeśli pz_truskawka_do_30_06 = 0 a pz_truskawka_po_30_06 > 0:
-- w aplikacji Magazyn → PZ/FIFO popraw daty PZ (faktyczna data przyjęcia ≤ data WZ).

-- Sprzedaż truskawki do 30.06 (czy mieści się w 156 t PZ):
SELECT 'sprzedaz_truskawka_do_30_06' AS test, COALESCE(SUM(ABS(oi.qty)), 0)::bigint AS kg
FROM public.operation_items oi
JOIN public.operations o ON o.id = oi.operation_id
JOIN public.products p ON p.id = oi.product_id
WHERE oi.direction = 'rozchod'
  AND lower(p.name) LIKE '%truskawk%'
  AND o.operation_date <= DATE '2026-06-30';
