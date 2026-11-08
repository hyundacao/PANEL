# Audyt Dodawania Technologii

Data: 2026-11-08. Repo: `C:/APKA DLA KAMILA`.
Zakres: biblioteka technologii, stan klienta, import planu, autozapis, API, podzial danych i historia.
Tryb: odczyt kodu i bazy Supabase oraz izolowane symulacje w pamieci. Bez zapisow i usuwania danych aplikacji. Bez zmian jej kodu.

## Wniosek

Tak: ekran biblioteki wczytuje i trzyma takze plan roboczy, jego dzienne kopie, wersje oraz archiwum produkcji. Dodanie jednej technologii nie jest osobnym, malym zapisem. Jest zmiana duzego dokumentu JSON obejmujacego rozne funkcje aplikacji.

Najwazniejsza optymalizacja to rozdzielenie zakresow odczytu i zapisu, nie kasowanie historii. Kompresja HTTP i IndexedDB zmniejszaja odpowiednio przesylke i problem limitu kopii lokalnej, lecz nie usuwaja serializowania calego stanu, jego parsowania ani przepisywania duzych rekordow bazy.

## Ustalenia Wedlug Wplywu

### 1. Wysoki priorytet: jedna technologia uruchamia zapis planu i historii

- `saveTechnologyEditor` zmienia tablice `technologies` przez ogolny `updateState`.
- `updateState` ponownie mapuje aktualny plan, przypisuje technologie domyslne i klonuje plan do `dailyPlans[selectedPlanDate]`, takze przy zmianie samej biblioteki.
- Autozapis wysyla caly prywatny stan uzytkownika, cala zmieniona biblioteke oraz jej poprzednia wersje jako baze scalania. Nie wysyla tylko dodanej technologii.
- `savePlanningWorkspace` zapisuje caly rekord `main`, a nastepnie caly prywatny workspace. Serwer przebudowuje takze podglad technologii planu dla przygotowania produkcji.
- W symulacji na najwiekszym obecnym workspace dodanie receptury wielkosci 1222 B daje 4 535 597 B JSON-u zadania, okolo 588 833 B po gzip. Dwa logiczne zapisy rekordow obejmuja lacznie okolo 6,14 MB JSON-u. Nie jest to pomiar fizycznego I/O PostgreSQL.

Skutek: niezwiazana z biblioteka historia zwieksza koszt edycji technologii i zakres potencjalnego bledu zapisu. Nie potwierdzono, ze caly ten czas zuzywa CPU; siec, baza i ograniczenia wdrozenia pozostaja osobnymi skladnikami.

Kod: [zapis edytora](../src/app/(main)/planowanie-zapotrzebowania/page.tsx#L3209), [wspolny updateState](../src/app/(main)/planowanie-zapotrzebowania/page.tsx#L2144), [payload autozapisu](../src/lib/planowanie-zapotrzebowania/usePlanningAutosave.ts#L155), [dwa zapisy](../src/lib/planowanie-zapotrzebowania/stateScopes.ts#L315).

### 2. Wysoki priorytet: pelne archiwum jest ladowane takze do biblioteki

- Domyslny GET pobiera caly `main` i caly workspace, a nie projekcje dopasowana do widoku biblioteki.
- Parser normalizuje wszystkie dzienne plany, pozycje wersji oraz pozycje archiwum. Ukrycie widoku historii nie usuwa ich z obiektu stanu.
- Najwiekszy workspace zawiera 1128 wpisow archiwum, okolo 1,72 MB JSON-u. 991 wpisow ma date sprzed 2026-11-01; najstarsze sa z 2026-08-27.
- Wszystkie te wpisy maja w bazie status `suspended`, a nie `completed`. Sam wiek nie dowodzi, ze sa niepotrzebne: import szuka w nich kandydatow do kontynuacji produkcji.
- Widok historii renderuje cale `archive.map`, bez stronicowania. To dodatkowy koszt po otwarciu historii, nie dowod, ze DOM calej historii istnieje w bibliotece.

Kod: [ladowanie workspace](../src/lib/planowanie-zapotrzebowania/stateScopes.ts#L292), [parser](../src/app/(main)/planowanie-zapotrzebowania/page.tsx#L1199), [normalizacja archiwum](../src/app/(main)/planowanie-zapotrzebowania/page.tsx#L1362), [kontynuacja przy imporcie](../src/app/(main)/planowanie-zapotrzebowania/page.tsx#L2863), [widok historii](../src/app/(main)/planowanie-zapotrzebowania/page.tsx#L5402).

### 3. Sredni priorytet: stare prywatne dane pozostaja rowniez w rekordzie wspolnym

- `main` ma okolo 2,86 MB, z czego okolo 2,08 MB to pola spoza aktualnego kontraktu wspolnego.
- Zawiera m.in. 15 wersji planu z wrzesnia (1057 pozycji lacznie), osiem dziennych planow i 295 dawnych wpisow archiwum.
- Aktualizacja biblioteki zachowuje te pola i ponownie zapisuje je razem z `main`.
- Istniejace workspaces NIE dostaja wszystkich tych starych pol z `main`: laczenie wybiera tylko pola wspolne i zgodnosciowy snapshot spisu. Koszt starych pol `main` dotyczy przede wszystkim odczytu/zapisu serwera. Dla nowego workspace caly stary stan jest nadal zgodnosciowym punktem startowym.
- Obecna retencja siedmiodniowa obejmuje dzienne plany, wersje, dokumenty i czesc slownikow datowanych, lecz NIE `archive`. Uruchamia ja klient po zaladowaniu/zmianie dnia; nie jest globalnym sprzataniem bazy. Starsze zapisy nieaktywnych workspace moga pozostawac w bazie do otwarcia aplikacji.

Nie wykonywano funkcji retencji w dzialajacej aplikacji podczas audytu. Nie usuwac tych danych bez osobnego projektu migracji i sprawdzenia odtwarzania oraz inicjalizacji nowych kont.

Kod: [pola wspolne i laczenie](../src/lib/planowanie-zapotrzebowania/stateScopes.ts#L14), [zachowanie starego main](../src/lib/planowanie-zapotrzebowania/stateScopes.ts#L209), [retencja](../src/lib/planowanie-zapotrzebowania/historyRetention.ts#L65), [uruchomienie retencji](../src/app/(main)/planowanie-zapotrzebowania/page.tsx#L2126).

### 4. Sredni priorytet: wielokrotna serializacja pelnej kopii lokalnej

- W izolowanej symulacji rzeczywistego silnika autozapisu jedna zmiana zakonczona sukcesem wywolala cztery kopie przed zamknieciem silnika.
- Kopie mialy po okolo 4,67 MB; lacznie serializowano 18 700 631 B. To suma pracy, NIE dowod jednoczesnego zajecia tylu bajtow RAM.
- Kazda kopia zawiera stan oraz baze pol wspolnych do rozwiazywania konfliktow. Przy zmianach w czasie trwajacego zapisu moze dojsc tez starszy `lastAttempt`; jesli wskazuje ten sam stan, hook juz go pomija.
- IndexedDB pozwala uniknac malego limitu localStorage, ale nadal zapisuje caly serializowany dokument. Kolejka zapisow nie scala zastapionych snapshotow.
- `state`, `stateRef` i stan silnika czesto wskazuja ten sam obiekt. Nie sa automatycznie trzema pelnymi kopiami RAM. Koszt dodatkowy powstaje m.in. przy klonowaniu planow, odczycie JSON-u, stringifikacji i kodowaniu/kompresji.

Kod: [cykl persist/flush](../src/lib/planowanie-zapotrzebowania/autosave.ts#L123), [serializacja cache](../src/lib/planowanie-zapotrzebowania/usePlanningAutosave.ts#L208), [kolejka IndexedDB](../src/lib/planowanie-zapotrzebowania/draftCache.ts#L75), [serializacja transportu](../src/lib/planowanie-zapotrzebowania/saveTransport.ts#L9).

### 5. Sredni priorytet: skoroszyt Excela pozostaje w RAM po imporcie

- Import odczytuje caly plik, wszystkie arkusze i style (`cellStyles: true`).
- Po imporcie przechowuje obiekt w `lastPlanWorkbook`, aby umozliwic pozniejszy wybor arkusza. Przejscie do technologii nie czysci tej referencji w obrebie tego samego ekranu.
- Podczas wyboru kolejnego pliku moga wspolistniec stary `lastPlanWorkbook` i nowy `pending`.
- Nie jest to zawartosc zapisywana w JSON-ie planu. Jest to osobny, warunkowy koszt RAM sesji po imporcie; nie zmierzono jego wielkosci dla obecnie otwartego pliku uzytkownika.

Kod: [stany skoroszytu](../src/app/(main)/planowanie-zapotrzebowania/page.tsx#L1958), [odczyt Excela](../src/app/(main)/planowanie-zapotrzebowania/page.tsx#L2813), [zachowanie po imporcie](../src/app/(main)/planowanie-zapotrzebowania/page.tsx#L2954), [ponowny wybor arkusza](../src/app/(main)/planowanie-zapotrzebowania/page.tsx#L3490).

### 6. Sredni priorytet: komunikat dodania nie potwierdza jeszcze zapisu w bazie

- Edytor od razu po zmianie lokalnego stanu wyswietla, ze technologie dodano/zapisano. Asynchroniczny autozapis dopiero pozniej potwierdza baze.
- Istnieje osobny wskaznik autozapisu i komunikat bledu, lecz krotki sukces moze sugerowac wiecej, niz faktycznie potwierdzono.
- Zapis `main` i workspace to dwa oddzielne wywolania RPC, nie jedna transakcja. Po sukcesie pierwszego i konflikcie drugiego kod zwraca `PARTIAL_SAVE_CONFLICT`. Technologia moze byc juz wspolnie zapisana, mimo niepowodzenia calej operacji. Kod rozpoznaje ten stan; nie oznacza to automatycznego uszkodzenia danych.

Kod: [natychmiastowy komunikat](../src/app/(main)/planowanie-zapotrzebowania/page.tsx#L3292), [osobne zapisy i konflikt czesciowy](../src/lib/planowanie-zapotrzebowania/stateScopes.ts#L353).

## Pomiar Rzeczywistych Danych

Snapshot odczytowy: rewizja `main` 2350; dziewiec workspace. W trakcie audytu inni klienci aktualizowali baze, dlatego wyniki sa snapshotem, a nie stalymi parametrami aplikacji. MB ponizej oznacza 1 000 000 bajtow serializowanego JSON-u UTF-8.

| Element | Wynik |
| --- | ---: |
| Warianty technologii | 596 |
| Unikalne wartosci indeksu produktu w technologiach | 489 |
| Cala biblioteka technologii | 0,711 MB |
| Najwiekszy workspace w bazie, z wewnetrznym podgladem | 3,285 MB |
| Jego polaczony stan API przed normalizacja klienta, bez wewnetrznego podgladu | 3,893 MB |
| Jego archiwum produkcji | 1128 wpisow / 1,724 MB |
| Jego wersje planu | 13 wersji / 863 pozycje / 0,822 MB |
| W tym wersje zastapione nowszym importem | 8 |
| Jego dzienne plany | 8 dni / 542 pozycje / 0,496 MB |
| Model dodania jednej technologii: zadanie JSON | 4,536 MB |
| Ten sam model po gzip w Node | 0,589 MB |
| Model kopii lokalnej bez starszej proby zapisu | 4,675 MB |

Wielokrotne identyczne bloki planu wystepuja w `plan`, `dailyPlans` i wersjach. W najwiekszym workspace znaleziono okolo 0,202 MB powtorzen dokladnie identycznych blokow. To nie dowod duplikatow biznesowych do usuniecia: snapshot i plan edytowalny maja inne przeznaczenie.

## Co Juz Ogranicza Obciazenie

- Edytor trzyma mala kopie wybranej receptury; samo wpisywanie w polach nie wysyla calego stanu do bazy przy kazdym znaku.
- Glowny autozapis jest opozniony i grupowany, domyslnie 700 ms; kopia lokalna ma opoznienie 200 ms.
- Najciezsze obliczenia bilansow materialowych sa pomijane w widoku biblioteki (`needsMaterialBalances`). Nie stwierdzono pelnego przeliczania MRP przy kazdym znaku w edytorze.
- Podpowiedzi kartotek maja opoznienie, anulowanie poprzedniego zadania i ograniczony cache 80 zapytan. Klient podpowiedzi nie pobiera calego katalogu jako stanu biblioteki.
- Odswiezanie wspolnego stanu sprawdza rewizje, dziala przy bezczynnosci i nie pobiera pelnych danych, jesli rewizja sie nie zmienila.
- Wewnetrzny `__technologyPreview` jest usuwany z odpowiedzi stanu dla klienta. Nie doliczano go drugi raz do modelu zadania.
- Sa rewizje, scalanie zmian i odzyskiwanie niedokonczonego zapisu. Optymalizacja nie moze ich obchodzic.

## Kolejnosc Usprawnien Bez Kasowania Historii

1. Osobny odczyt i zapis biblioteki: jedna zmieniona technologia/rodzina zamiast calego prywatnego workspace i dwoch pelnych bibliotek. Zachowac autoryzacje, konflikty i semantyke bazowa/awaryjna. Punkt odniesienia do scalania powinien byc ograniczony do zmienianych rekordow/pol.
2. Historia przechowywana po stronie serwera, lista metadanych ladowana na zadanie, szczegoly konkretnego dnia/importu dopiero po otwarciu. Zachowac wszystkie snapshoty i eksporty.
3. Oddzielic archiwum od aktywnego planu; dla kontynuacji przygotowac maly indeks kandydatow. Nie uznawac starych `suspended` za zakonczone tylko na podstawie daty.
4. Zlikwidowac niepotrzebne przebudowy planu przy zmianach niezwiazanych z nim. Zachowac obecne automatyczne przypisanie nowej technologii do pasujacej, dotad nieprzypisanej pozycji planu.
5. Ograniczyc powtorne serializacje kopii lokalnej, zachowujac ostatni trwaly punkt odzyskania. Ewentualne scalanie kolejki musi respektowac trwajace transakcje, bledy i zamkniecie karty.
6. Skrocic zycie surowego skoroszytu lub przechowywac lzejsza reprezentacje potrzebna do wyboru arkuszy. Nie odbierac obecnej funkcji bez uzgodnienia.
7. Pokazywac osobno przyjecie zmiany lokalnej i potwierdzenie bazy. Migracje starych pol `main` planowac dopiero po wydzieleniu historii, z kopia i testem odtworzenia.

Regresje konieczne przed wdrozeniem: przypisanie nowej technologii do planu, zachowanie recznych receptur, zamiana bazowej/awaryjnej, edycja naglowka i powiazan polwyrobow, konflikt dwoch osob, utracona odpowiedz serwera, odzyskanie po przeladowaniu, historia/eksport, podglad technologii w przygotowaniu produkcji, import i zmiana arkusza.

## Granice Pewnosci

- Ponownie uruchomiono 56 testow autozapisu, zakresow stanu i retencji: wszystkie przeszly. Testy uzywaja danych/atrap lokalnych, nie zapisow produkcyjnych. Nie jest to test obciazeniowy ani pelny audyt pozostalych modulow.
- Nie mierzono sterty pamieci przegladarki uzytkownika. Rozmiar JSON-u nie jest zuzyciem RAM i nie potwierdza wycieku pamieci.
- Model wielkosci zapisu uzywa rzeczywistych danych po zlozeniu zakresow API, ale nie wykonuje parsera i retencji strony. Nie jest zarejestrowanym zadaniem HTTP uzytkownika.
- Symulacja autozapisu wykonala rzeczywisty silnik z atrapami odczytu/zapisu i kopii; nie mierzy predkosci realnego IndexedDB ani opoznien Supabase.
- Nie wykonano zapisu produkcyjnego ani otwarcia uwierzytelnionej strony, aby nie uruchomic istniejacej retencji/autozapisu. Nie zmieniono zasad przechowywania.
- Nie potwierdzono wersji wdrozonej online ani kodu HTTP pierwotnego bledu. Obecne pomiary potwierdzaja nadmiar danych, nie rozstrzygaja samodzielnie konkretnego bledu Vercel.
