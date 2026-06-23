# AGRO-MAR HACCP/FIFO v11

Dodano moduł Produkcja / Przerób oraz zmianę numeru partii tylko dla administratora z historią zmian.

Po wgraniu plików do GitHub uruchom w Supabase plik:
`supabase/2026-v11-produkcja-i-partie-admin.sql`

# AGRO-MAR HACCP / IFS / FIFO — v10 KOMORY CP/CCP

Wersja v10 dodaje logikę komór i beczek:

- CP2: 2 komory surowca,
- CP3: 2 komory produktu gotowego,
- CCP1: 4 beczki pulpy,
- blokada mieszania różnych grup asortymentów w jednej komorze,
- Malina extra / Malina klasa I / Malina pulpa są traktowane jako jedna grupa: `malina`,
- MM i PZ są przyjęciem,
- WZ/FV rozlicza FIFO i nie tworzy ujemnych partii.

Po wgraniu do GitHub uruchom w Supabase:

`supabase/2026-v10-komory-cp-ccp.sql`

Potem w aplikacji odśwież `Ctrl+F5` i kliknij `Odśwież stany FIFO`.
