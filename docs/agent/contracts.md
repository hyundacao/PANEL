# Kontrakty Wspolne

Czytaj tylko sekcje zwiazana ze zmiana; karty podaja jej odbiorcow. To reguly nawigacji, nie opis kazdego pola DTO.

## Indeksy I Jednostki

- Indeks 1 i 2 wynikaja z dwoch kolumn zrodla, nie z ksztaltu numeru, nazwy ani samego prefiksu M-10. Zera poczatkowe i znaczace znaki sa czescia indeksu.
- Oba indeksy prowadza do tej samej kartoteki. Szukanie obsluguje oba; wybor w technologii preferuje drugi, a eksport biblioteki ma obie kolumny.
- Brak pary nie upowaznia do zgadywania. Stare identyfikatory i poprzednie nazwy moga byc aliasami; nie kasuj historii przy usuwaniu podpowiedzi.
- Jednostka kartoteki, jednostka zapisanego zuzycia oraz jednostka widoczna w edytorze to rozne pojecia. `kg` bywa prezentowane jako `g/szt.` przez mnozenie razy 1000. Sama zamiana etykiety moze zepsuc ilosc.
- Gramatura w nazwie kartonu nie jest jednostka jego rozchodu. Opakowanie, komplet, sztuka i 1000 sztuk nie sa automatycznie tym samym.
- Sztuki/kg wymagaja liczby lub masy sztuki; kg/litry wymagaja gestosci. Uzgodniona jednostka konkretnej technologii moze roznic sie od ERP. Nie poprawiaj jej automatycznie samym importem.
- Odbiorcy zmiany: parser -> rejestr -> szukanie -> technologia -> zapotrzebowanie -> stan strefy -> dokument -> Excel; dodatkowo farby i przemialy przy wspolnych snapshotach ERP.
- Wejscia: [inventory](<inventory.md>), [planning](<planning.md>), [paint](<paint.md>), [regrind](<regrind.md>).

## Stan I Wspolpraca

- [stateScopes](<../../src/lib/planowanie-zapotrzebowania/stateScopes.ts>) jest zrodlem podzialu danych wspolnych/prywatnych, rewizji i rebase. Nie zapisuj calego `main` stara kopia planu uzytkownika.
- [autosave](<../../src/lib/planowanie-zapotrzebowania/autosave.ts>) i [hook](<../../src/lib/planowanie-zapotrzebowania/usePlanningAutosave.ts>) odpowiadaja za draft, oczekujacy zapis, ponowienia i konflikty. Zielony komunikat lokalny nie jest dowodem zapisu do bazy.
- Role technologii zmieniaja domyslny wybor, nie identyfikator receptury. Jawne przypisania po ID powinny wskazywac ten sam sklad po zamianie bazowej z awaryjna.
- Biblioteka, reczna kopia robocza, zapisany dokument, dzienny snapshot i archiwum sa oddzielne. Ustal zakres, zanim poprawisz dane.
- Publikowana projekcja planu jest czytana przez [przygotowanie produkcji](<preparation.md>); nie usuwaj jej przy uproszczeniu zapisu workspace.

## Zrodla Stanu

- Spis fizyczny, stan ERP, stan calego magazynu i stan konkretnej strefy nie sa wymienne.
- Dostepnosc silosu i wczesniejsze przydzielenie materialu innym pozycjom planu sa czescia obliczen strefy; nie dodawaj tego samego stanu osobno do kazdego detalu.
- Podsumowanie dokumentu laczy powtorzenia materialu, zachowujac zrodla pozycji. Wielopoziomowy Excel technologii nie oznacza sumowania calego drzewa do biezacego pobrania.
- Cache trzeba odswiezyc u wszystkich odbiorcow zmiany kartoteki; sam komunikat o udanym imporcie nie odswieza juz otwartych widokow.

## Dzien I Historia

- Dzien produkcyjny i data UTC nie musza sie pokrywac: sprawdz [productionPlanDate](<../../src/lib/utils/productionPlanDate.ts>), nie kopiuj lokalnej funkcji daty z innego modulu.
- [historyRetention](<../../src/lib/planowanie-zapotrzebowania/historyRetention.ts>) dotyczy planowania; historia zadan i archiwa farb maja inne reguly. Nie przenos okresu czyszczenia pomiedzy modulami.
- Zamkniety spis farb zachowuje porownanie ERP. Usuniecie starych snapshotow ERP wymaga ochrony otwartych/niewyarchiwizowanych spisow.
- Raport historyczny moze przechowywac snapshot albo odczytywac obecna nazwe z aliasu. Ustal, ktory wariant obsluguje dany ekran, zanim obiecasz niezmiennosc eksportu.

## API I Dostep

- Klient [api/index](<../../src/lib/api/index.ts>), DTO [api/types](<../../src/lib/api/types.ts>), [api/app](<../../src/app/api/app/route.ts>) oraz osobne endpointy planowania/przygotowania/importu maja wspolnych odbiorcow.
- Zmiana nazwy `action`, DTO, limitu, roli lub jednostki wymaga sprawdzenia wywolujacych. Importy plikow nie pokazuja zaleznosci przez nazwy akcji, klucze JSON, query cache ani tabele DB.
- Nie traktuj konta read-only, administratora modulu i HEAD_ADMIN jako tej samej roli. UI + API + SQL/RLS to oddzielne kontrole.
