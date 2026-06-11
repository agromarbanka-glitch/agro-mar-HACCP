# AGRO-MAR HACCP / IFS / FIFO

To jest pierwszy plik projektu do nowej aplikacji HACCP/FIFO. Projekt jest przygotowany jako osobna aplikacja, żeby nie pomieszać danych z aplikacją opakowań.

## Bardzo ważne

Nie używać starego projektu Supabase `AGRO-MAR` od opakowań.
Ten projekt podłączamy wyłącznie do nowego Supabase `AGRO-MAR-HACCP`.

## Co jest w paczce

- aplikacja React/Vite,
- import przykładowego Excela `.xls/.xlsx`,
- pobieranie z Excela tylko potrzebnych danych: nr dokumentu, typ/PZ, data wystawienia, ilość, produkt,
- przygotowana struktura bazy Supabase,
- produkty i kody partii,
- role: admin i magazynier,
- zakładki dokumentów: Karty, Raporty, Formularze, Protokoły, Wykazy, Karty stanowiskowe, Pozostałe IFS, Specyfikacje.

## Kolejność bez mieszania projektów

1. Wejdź w GitHub i otwórz nowe repozytorium `agro-mar-haccp`.
2. Wgraj wszystkie pliki z tej paczki do repozytorium `agro-mar-haccp`.
3. Wejdź w Supabase i otwórz tylko nowy projekt `AGRO-MAR-HACCP`.
4. Supabase -> SQL Editor -> New query.
5. Wklej zawartość pliku `supabase/schema.sql`.
6. Kliknij Run.
7. Dopiero potem podłączymy Vercel.

## Zmienne środowiskowe

Skopiuj `.env.example` jako `.env` lokalnie albo ustaw te wartości w Vercel:

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

Dane znajdziesz w nowym Supabase: Project Settings -> API.

## Uruchomienie lokalne

```bash
npm install
npm run dev
```

## Status wersji

To jest wersja startowa. Jeszcze nie jest pełnym systemem produkcyjnym. Ma sprawdzić:

- czy import Excel odczytuje właściwe kolumny,
- czy struktura bazy działa,
- czy nie mieszamy projektu z aplikacją opakowań.

Kolejny etap: pełne FIFO, automatyczne generowanie K01/K03/K06/R01/R02 oraz wydruki identyczne z dokumentami Word.
