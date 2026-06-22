# AGRO-MAR HACCP / IFS / FIFO - v8

Zmiany v8:
- MM traktowane jako przyjęcie magazynowe.
- WZ/FV/FS traktowane jako sprzedaż/rozchód.
- Ujemne ilości z WZ/FV są zapisywane jako dodatni rozchód, żeby FIFO mogło je rozliczyć.
- Importer nie tworzy ujemnych partii dla sprzedaży.
- Dołączony SQL: `supabase/2026-v8-clean-negative-lots.sql` czyści błędne ujemne partie z testów.
