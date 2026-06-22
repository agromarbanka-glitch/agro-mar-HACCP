-- V8: czyszczenie błędnych ujemnych partii utworzonych z WZ/FV oraz reset FIFO do ponownego testu.
-- Uruchom tylko w projekcie AGRO-MAR-HACCP.

-- 1) Usuń błędne ujemne partie.
DELETE FROM public.lots
WHERE initial_qty < 0 OR remaining_qty < 0;

-- 2) Wyczyść rozliczenia FIFO, żeby po poprawce można było wykonać test od nowa.
DELETE FROM public.fifo_allocations;

-- 3) Przywróć stany dodatnich partii do wartości początkowej.
-- To jest bezpieczne na etapie testów, bo przed poprawką FIFO nie utworzyło rozliczeń.
UPDATE public.lots
SET remaining_qty = initial_qty,
    status = CASE WHEN initial_qty > 0 THEN 'aktywna' ELSE status END
WHERE initial_qty > 0;
