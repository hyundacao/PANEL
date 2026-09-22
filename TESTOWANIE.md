# Testowanie aplikacji

## Szybka kontrola

Po instalacji zaleznosci (`npm ci`) uruchom:

```sh
npm run check
```

Polecenie wykonuje wszystkie testy w `src`, sprawdzanie typow i ESLint. Zwraca blad, jesli ktorykolwiek etap sie nie powiedzie. Nowe pliki `*.test.mjs` sa wykrywane automatycznie; nie trzeba dopisywac ich do listy.

Osobne kontrole:

```sh
npm test
npm run test:planning
npm run typecheck
npm run lint
npm run build
```

`test:planning` obejmuje wszystkie testy w `src/lib/planowanie-zapotrzebowania`. Pelny `npm test` obejmuje takze pozostale moduly, uprawnienia i testy SQL.

## Bezpieczenstwo danych

Test transakcji przesuniec uzywa PGlite, czyli jednorazowej bazy PostgreSQL w pamieci. Nie laczy sie z Supabase ani nie zmienia stanow magazynowych. Test SQL jest wymagany, a nie automatycznie pomijany. Zmienna `PGLITE_MODULE_PATH` moze wskazac inny lokalny runtime testowy; standardowo wystarcza zaleznosc developerska z `package.json`.

Produkcyjny build wymaga konfiguracji Supabase. Samo poprawne zbudowanie aplikacji nie dowodzi poprawnosci polaczenia z baza. Kontrole wdrozenia i migracji wykonuj na odizolowanym srodowisku testowym. Nie uruchamiaj builda w katalogu obslugiwanym jednoczesnie przez serwer developerski.

## Zakres kontroli regresji

- Plan: pojedyncze widoczne pozycje, poprawne indeksy i nazwy, filtrowanie stref.
- Technologie: wybor bazy, wariantu awaryjnego i odrebnej technologii roboczej.
- Obliczenia: jednostki, zaokraglenia, produkcja ciagla, TRAY i HANDLE powiazane z odbiorca.
- Stan planu: ponowne wczytanie, historia, korekty, oznaczenie przeliczenia osobno na kazdy dzien.
- Dokumenty: zmiany wlasnego planu nie uniewazniaja cudzych ani juz wydanych dokumentow.
- Wspolpraca: rewizje, scalanie i konflikty z `stateScopes.test.mjs` i `autosave.test.mjs`.
- SQL: cofanie ruchow, ponawianie anulowania, brak ujemnego stanu i pelny rollback nieudanej operacji.

Testy widoku licza elementy pozycji planu, a nie wszystkie wystapienia indeksu w HTML. Indeks moze poprawnie wystepowac zarowno jako tekst, jak i w opisie przycisku dla czytnika ekranu.

## Odbior w przegladarce

Testy automatyczne nie zastepuja ponizszych scenariuszy na danych testowych:

1. Dwa lub trzy konta: prywatne plany, rozne hale, wspolna biblioteka, zmiana tego samego pola i chwilowa utrata sieci.
2. Spis na telefonie: szukanie po indeksie, pojedyncze wybranie podpowiedzi, pelna nazwa i indeks po przejsciu do ilosci, zapis oraz edycja istniejacego wpisu.
3. Przewijanie podpowiedzi palcem bez przypadkowego wyboru; wykluczenie form FW; szybkie kasowanie i ponowne wpisywanie.
4. Wgranie aktualizacji planu tego samego dnia oraz przejscie na kolejny dzien.
5. Raporty i Excel: zgodnosc sum, jednostek, hal, rezerwacji i wariantow technologii.

Weryfikacja z 22.09.2026 objela takze odizolowany test prawdziwego komponentu wyszukiwarki w Edge: komputer oraz emulacje dotyku 390x844, dane katalogowe testowe. Sprawdzono wybor mysza/dotykiem i Enterem, przejscie do ilosci, zapis pelnej nazwy z indeksem, zewnetrzne wczytanie edycji, czyszczenie, minimalna dlugosc wyszukiwania i przewijanie bez wyboru. Emulacja nie jest pomiarem wydajnosci starego telefonu ani pelnym testem produkcyjnej bazy.
