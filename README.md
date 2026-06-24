# AGRO-MAR HACCP/FIFO v24

Stabilizacja wdrożenia Vercel po błędach npm `ETIMEDOUT`.

Zmiany:
- dodany `.npmrc` wymuszający oficjalny registry npm,
- dodany `vercel.json` z jawnym install/build command,
- zastąpiony błędny `package-lock.json` zawierający wewnętrzne adresy OpenAI,
- zachowane funkcje v23: kartoteki miesięczne, druk, Excel, pracownicy, edycja wierszy.

Instrukcja:
1. Rozpakuj ZIP.
2. Wgraj całą zawartość do GitHub.
3. Upewnij się, że w repozytorium został nadpisany stary `package-lock.json`.
4. Wdróż w Vercel.
5. SQL: użyj skryptu v23 tylko jeśli nie był jeszcze uruchomiony.
