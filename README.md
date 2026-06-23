# AGRO-MAR HACCP / IFS / FIFO — v13 Magazyn partii naprawiony

Zmiany v13:
- ekran Magazyn partii automatycznie pobiera aktywne partie po wejściu na stronę,
- licznik aktywnych partii i pozostałych kg działa na danych z `lots.remaining_qty`,
- widok pokazuje partię, produkt, grupę, komorę, datę przyjęcia, pozostałą ilość i status,
- poprawiono kod produktu „Jabłko na obierkę” na `Jabobier`,
- zachowano FIFO po dacie przyjęcia i partii,
- zachowano blokadę mieszania grup w komorach,
- przygotowano SQL ujednolicający kody produktów i stare numery `Jablkona/` → `Jabobier/`.

Kolejność:
1. Wgraj ZIP do GitHub.
2. Poczekaj na Ready w Vercel.
3. Uruchom SQL `supabase/2026-v13-magazyn-partii-naprawa.sql` w Supabase.
4. Otwórz aplikację i zrób Ctrl+F5.
5. Sprawdź sekcję Magazyn partii.
