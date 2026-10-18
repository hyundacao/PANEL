# Weryfikacja uporządkowanych plików SQL

Data: 18.10.2026. Cel: dziewięć plików uruchamianych w całości w SQL Editor, bez powtarzania historycznych zmian danych i bez nadpisywania działających definicji.

## Wynik

- Pełny zestaw testów aplikacji: **716 zaliczonych, 0 błędów, 0 pominiętych**.
- Testy SQL i archiwizacji objęte bezpośrednią weryfikacją: **46 zaliczonych**; są częścią powyższej liczby.
- TypeScript: `npm run typecheck` zakończony bez błędów.
- ESLint dla zmienionych plików aplikacji, narzędzi testowych i testów: bez błędów.
- Nie uruchamiano migracji ani zapisów w produkcyjnej bazie. Do rzeczywistej bazy wysłano wyłącznie odczyty API.

## Odczyt Działającej Bazy

Przez połączenie aplikacji z Supabase pobrano schemat REST/OpenAPI. Widocznych jest **48 tabel i 9 funkcji RPC**. Sprawdzono nazwy i typy wszystkich kolumn, dopuszczalność NULL oraz nazwy i typy argumentów RPC. Wzorzec bez danych i kluczy zapisano w `src/lib/utils/fixtures/supabase-schema-2026-10-18.json`.

Odczyt liczników tabel:

| Tabela | Liczba rekordów |
| --- | ---: |
| `paint_tape_inventory_sessions` | 2 |
| `paint_tape_inventory_entries` | 181 |
| `paint_tape_settlements` | 132 |
| `original_inventory_erp_snapshots` | 53 710 |

W działającej bazie nadal istnieją historyczna tabela `halls` i kolumna `original_inventory_erp_snapshots.qty`. Nowe pliki ich nie usuwają ani nie przeliczają. Stwierdzono brak kolumn `erp_comparison` i `erp_archive` oraz RPC archiwizacji ERP. Ich instalację zawiera moduł 05, zgodnie z wcześniejszym zleceniem.

API nie udostępnia pełnej treści funkcji, polityk RLS, triggerów i wszystkich definicji indeksów. Panel SQL nie był zalogowany w dostępnej przeglądarce. Nie przedstawiamy więc tego odczytu jako pełnego zrzutu działającej bazy. Zamiast zastępować nieznane definicje, pliki sprawdzają istnienie obiektów w katalogach PostgreSQL i zachowują je bez zmian.

## Testy Na Osobnej Bazie

Testy używają PostgreSQL/PGlite działającego lokalnie w pamięci. Nie korzystają z kluczy aplikacji ani sieci.

1. Odtworzono schemat z dostarczonej pełnej instalacji i zakładek farb/taśm, planowania oraz anulowania przesunięć. Dodano dwa historyczne elementy widoczne w rzeczywistym API. Wszystkie kolumny i sygnatury RPC zgadzają się z odczytem bazy.
2. Uruchomiono wszystkie dziewięć modułów dwukrotnie na pustym schemacie. Nie powstały przykładowe konta, grupy, magazyny ani inne rekordy. Nowe tabele mają RLS, a nowe funkcje operacyjne dostęp wyłącznie dla backendu.
3. Uruchomiono wszystkie moduły dwukrotnie na bazie z danymi startowymi i dodatkowymi danymi kontrolnymi. Porównano wszystkie istniejące rekordy, funkcje i ich uprawnienia, RLS/polityki, ograniczenia oraz istniejące indeksy przed i po. Nie stwierdzono zmian, poza dwoma nowymi pustymi polami archiwum i nowymi obiektami instalowanymi przez moduł 05.
4. Dane kontrolne obejmują zmienione ustawienia Bakomy i Lakierni, dawną lokalizację WTR, stan i pomiary, korekty, anulowane przesunięcie, niestandardowe uprawnienia użytkownika i grupy, technologię roboczą, wykonane zadanie, podsumowanie raportu prac, stare ERP, zamknięty spis i rozliczenie farby.
5. Podmieniono jedną funkcję w bazie testowej na inną wersję i nadano dodatkowe uprawnienia. Uruchomienie nowych plików jej nie nadpisało i nie zmieniło uprawnień.
6. Wymuszono błąd pod koniec instalacji modułu 05. Transakcja wycofała wszystkie utworzone w tym pliku obiekty.
7. Sprawdzono archiwizację, zachowanie porównań po usunięciu starego ERP, blokadę zapisu do zamkniętego spisu, ochronę niezarchiwizowanych spisów, ponowne zamknięcie, wyścig zapisów, granicę 90 dni, ograniczone partie czyszczenia oraz brak dostępu do funkcji czyszczenia z ról publicznych.
8. Sprawdzono tworzenie i cofanie przesunięć, zachowanie późniejszych przyjęć i historycznych stanów, brak częściowego zapisu przy błędzie oraz powtórne cofnięcie.

PGlite nie zawiera rozszerzenia `pgcrypto`; w lokalnym teście pomijana jest wyłącznie instrukcja jego instalacji. Test nie udaje ponownego zalogowania wszystkich użytkowników produkcyjnych. Istniejące funkcje logowania i hasła nie są zmieniane przez nowe pliki.

## Co Zmieniono W Plikach

- Usunięto z aktywnego zestawu historyczne seedy, przeliczanie magazynów, migrację uprawnień użytkowników, nadpisywanie nazw/aktywności magazynów i usuwanie starych tabel.
- Definicje tabel i funkcji zebrano bez powtórzeń; istniejące obiekty są pomijane w całości.
- Moduł 05 instaluje ochronę archiwum, lecz sam nie wywołuje czyszczenia ERP. Po instalacji dotychczasowy kod aplikacji może wykonywać uzgodnioną retencję po zabezpieczeniu spisów.
- Każdy plik ma transakcję, limit oczekiwania na blokadę oraz końcowy wynik `OK`.
- Zaktualizowano komunikaty o brakujących SQL-ach, aby wskazywały cały plik modułu. Nie zmieniano obliczeń, interfejsu ani logiki zadań aplikacji.

Wspólne pliki to punkt odniesienia dla obecnej bazy, a nie ogólny naprawiacz dowolnej starej instalacji. Kolejne rzeczywiste zmiany schematu trzeba dopisywać i testować jawnie; nie wystarczy edytować definicji pomijanej dla istniejącego obiektu.

## Archiwum

`docs/archiwum-sql-przed-porzadkowaniem.zip` zawiera dawne pliki oraz wszystkie sześć dostarczonych zakładek. Testy weryfikują długość i SHA-256 zapisanych źródeł oraz kompletność 60 historycznych fragmentów. Nowe pliki nie są deklarowane jako identyczne bajtowo z dawnymi instalatorami: celowo usunięto z nich operacje niebezpieczne przy ponownym wykonaniu. Oryginały pozostają w archiwum.

Stare zapytania można usunąć z SQL Editor po poprawnym wykonaniu nowego zestawu. Nie oznacza to usuwania obiektów bazy.
