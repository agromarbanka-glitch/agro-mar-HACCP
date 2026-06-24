# AGRO-MAR HACCP/FIFO – v23.1

Poprawka wdrożeniowa po błędzie Vercel `npm install ETIMEDOUT`.

Zmiana: usunięto `package-lock.json`, który wskazywał na wewnętrzny rejestr pakietów niedostępny dla Vercel. Vercel pobierze paczki z publicznego npm.

SQL: użyj tego samego pliku co v23: `supabase/2026-v23-kartoteki-miesieczne-excel.sql`.
