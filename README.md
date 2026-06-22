# AGRO-MAR HACCP / IFS / FIFO — v9 naprawa FIFO

Zmiany v9:
- WZ/FV/FS zapisywane jako `sprzedaz`, nie `sprzedaz_bez_produkcji`.
- Ilość sprzedaży do FIFO liczona jako wartość bezwzględna, więc ujemne ilości z Excela rozliczają się poprawnie.
- PZ i MM traktowane jako przyjęcia.
- WZ/FV nie tworzą ujemnych partii.
- Dołączony SQL: `supabase/2026-v9-reset-fifo-i-sprzedaz.sql`.
