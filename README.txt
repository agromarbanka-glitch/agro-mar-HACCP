K02 REAL FIX - instrukcja wgrania

Wgraj/ podmień tylko plik:
  src/main.jsx

Co poprawiono:
- K02 odświeża wartości w otwartym oknie od razu po wpisaniu.
- Temperaturę można całkowicie skasować.
- Wpisywanie temperatury nie dopisuje cyfr do starej wartości przez fallback 2/1.
- Podpis i P/N też korzystają z aktualnych danych w otwartym formularzu.

Jak wgrać przez GitHub Desktop:
1. Rozpakuj ten ZIP.
2. Skopiuj plik src/main.jsx z paczki.
3. Wklej go do folderu projektu: agro-mar-HACCP/src/main.jsx i zatwierdź zamianę.
4. Otwórz GitHub Desktop - po lewej powinien pokazać 1 changed file: src/main.jsx.
5. W Summary wpisz: K02 live edit fix.
6. Kliknij Commit to main.
7. Kliknij Push origin.
8. Poczekaj w Vercel aż będzie Ready.
9. W aplikacji zrób Ctrl+F5.

Build sprawdzony lokalnie: npm run build - OK.
