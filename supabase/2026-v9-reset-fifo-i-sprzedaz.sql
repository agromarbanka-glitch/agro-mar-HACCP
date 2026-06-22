-- v9: czyszczenie błędnych importów sprzedaży bez produkcji i reset FIFO
-- Uruchom tylko w projekcie AGRO-MAR-HACCP.

BEGIN;

-- Usuń stare rozliczenia FIFO z testów
DELETE FROM public.fifo_allocations;

-- Usuń pozycje operacji zapisane poprzednim błędnym importerem jako sprzedaz_bez_produkcji
DELETE FROM public.operation_items
WHERE operation_id IN (
    SELECT id FROM public.operations WHERE operation_type = 'sprzedaz_bez_produkcji'
);

-- Usuń stare błędne operacje sprzedaży bez produkcji
DELETE FROM public.operations
WHERE operation_type = 'sprzedaz_bez_produkcji';

-- Usuń ewentualne pozycje powiązane z ujemnymi partiami
DELETE FROM public.operation_items
WHERE lot_id IN (
    SELECT id FROM public.lots WHERE initial_qty < 0 OR remaining_qty < 0
);

-- Usuń ewentualne ujemne partie z błędnych testów
DELETE FROM public.lots
WHERE initial_qty < 0 OR remaining_qty < 0;

-- Przywróć dodatnie partie do stanu wyjściowego, żeby test WZ/FV wykonał FIFO od nowa
UPDATE public.lots
SET remaining_qty = initial_qty,
    status = CASE WHEN initial_qty > 0 THEN 'aktywna' ELSE status END
WHERE initial_qty > 0;

COMMIT;

-- Kontrola po czyszczeniu
SELECT COUNT(*) AS rozliczenia_fifo_po_czyszczeniu FROM public.fifo_allocations;
SELECT COUNT(*) AS ujemne_partie_po_czyszczeniu FROM public.lots WHERE initial_qty < 0 OR remaining_qty < 0;
SELECT operation_type, COUNT(*) AS liczba FROM public.operations GROUP BY operation_type ORDER BY operation_type;
