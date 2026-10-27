# SQL do wklejenia w Supabase

To jedyny bieżący katalog SQL. Każdy plik można wkleić i uruchomić **w całości**. Nie trzeba wybierać fragmentów ani uruchamiać dodatkowych narzędzi.

## Kolejność

### Aktualizacja zabezpieczeń 27.10.2026

Na działającej bazie z modułami 01–09 uruchom dodatkowo **[10_zabezpieczenia.sql](10_zabezpieczenia.sql)**, a dopiero potem wdrażaj kod aktualizacji bezpieczeństwa. Nie uruchamiaj ponownie starych instalatorów i nie usuwaj danych.

Plik 10 dodaje atomowy import stanów ERP, wspólny limit prób logowania i unieważnianie sesji przy zmianie hasła. Nie zmienia istniejących haseł ani stanów. Bez niego nowy backend celowo odmówi logowania/importu zamiast użyć niezabezpieczonej ścieżki. Najpierw zachowaj odtwarzalną kopię bazy. Testy migracji na izolowanym PostgreSQL obejmują ponowne uruchomienie i wycofanie błędnego importu.

Po wyniku `OK` z pliku 10 można wdrożyć aktualizację aplikacji. Plik jest zgodny z poprzednim kodem; samo jego uruchomienie nie wylogowuje użytkowników. Przy wycofaniu kodu nie usuwaj tabeli limitów ani funkcji z tego pliku.

Zgodnie z decyzją właściciela reset nadal ustawia dotychczasowe hasło domyślne. Po resecie użytkownik ma 24 godziny na jego zmianę; do tej chwili API nie udostępnia danych modułów. Nowe własne hasło wymaga co najmniej 12 znaków i maksymalnie 72 bajtów. Zmiana hasła wymaga ponownego logowania. Wspólne hasło resetu nadal wiąże się z ryzykiem przejęcia konta przed zmianą hasła przez właściciela.

Weryfikacja kodu 27.10.2026: 892/892 testów, TypeScript i kompilacja produkcyjna zakończone powodzeniem. Test HTTP potwierdził odmowę odczytu/zapisu raportu bez logowania oraz blokadę zapisu z obcego origin. Audyt npm zależności produkcyjnych: 0 zgłoszonych podatności. Linter nadal zgłasza 51 istniejących błędów, bez nowych diagnostyk względem poprzedniego kodu przy tej samej wersji narzędzia. Nie wykonano tej migracji ani wdrożenia na produkcji podczas przygotowania aktualizacji. Polityki działającej bazy, kopie zapasowe i MFA kont hostingowych wymagają osobnej weryfikacji administracyjnej.

### Instalacja podstawowych modułów

1. [Konta i uprawnienia](01_konta_i_uprawnienia.sql)
2. [Magazyn przemiałów](02_magazyn_przemialow.sql)
3. [Przesunięcia ERP](03_przesuniecia_erp.sql)
4. [Spis rzeczywisty i stany ERP](04_spis_rzeczywisty_i_stany_erp.sql)
5. [Farby i taśmy](05_farby_i_tasmy.sql)
6. [Przygotowanie produkcji](06_przygotowanie_produkcji.sql)
7. [Planowanie zapotrzebowania](07_planowanie_zapotrzebowania.sql)
8. [Raporty](08_raporty.sql)
9. [Powiadomienia](09_powiadomienia.sql)

W SQL Editor utwórz po jednej zakładce o powyższej nazwie. Wklej cały odpowiadający jej plik, wybierz **Save**, następnie **Run**. Przy instalacji podstawowej uruchamiaj po kolei 01–09, a następnie aktualizację 10 opisaną powyżej. Na końcu każdego pliku pojawia się nazwa modułu i wynik `OK`.

Po udanym uruchomieniu nowych plików możesz usunąć **stare zapisane zapytania z SQL Editor**. Nie usuwaj tabel, funkcji, polityk ani danych w innych częściach Supabase. Usunięcie zakładki nie cofa wcześniej wykonanych zmian w bazie.

## Co Zostaje Bez Zmian

Istniejące tabele, indeksy, ograniczenia, polityki RLS, uprawnienia i funkcje są zachowywane. Pliki nie nadpisują kont, grup, nazw magazynów, ustawień Bakomy/Lakierni, ilości, lokalizacji, planów ani raportów. Nie powtarzają dawnych przeliczeń magazynów, przenoszenia lokalizacji, wstawiania danych startowych ani usuwania starych tabel.

Jeżeli obiekt istnieje, jego definicja nie jest zastępowana starszą wersją. Jeżeli go brakuje, plik zawiera jego definicję do utworzenia. To zestaw dla obecnej aplikacji, nie reset bazy i nie instalator przykładowych danych lub pierwszego administratora.

## Jedna Uzgodniona Zmiana

Plik **05 – Farby i taśmy** dodatkowo instaluje wcześniej zamówioną archiwizację porównań ERP: dwie kolumny, funkcje, indeksy i zabezpieczenia zapisu. Nie zmienia istniejących pomiarów i nie wykonuje czyszczenia danych podczas `Run`.

Po instalacji kod aplikacji może zapisywać trwałe porównania spisów oraz usuwać ogólne stany ERP starsze niż 90 dni według dotychczas przygotowanej logiki. Dni z otwartym lub jeszcze niezarchiwizowanym spisem są chronione. Wykresy raportu prac i historia przygotowania produkcji nie są objęte tym czyszczeniem.

## Sprawdzenie I Kopia

Weryfikacja z 18.10.2026: odczyt schematu API działającej bazy (48 tabel i 9 funkcji RPC), porównanie kolumn i argumentów oraz testy na osobnej bazie PostgreSQL/PGlite. Testy obejmują dwukrotne uruchomienie całego zestawu, zachowanie danych i zabezpieczeń, archiwizację oraz wycofanie nieudanej transakcji. Szczegóły: [raport weryfikacji](../docs/WERYFIKACJA_SQL_2026-10-18.md).

Nie wykonywano migracji na działającej bazie podczas przygotowywania plików. Odczyt API nie udostępnia treści funkcji i polityk RLS; dlatego istniejące definicje są celowo pomijane, a nie zgadywane i nadpisywane.

Każdy plik działa w jednej transakcji. W razie błędu jego zmiany nie zostają zatwierdzone. Limit oczekiwania na blokadę wynosi 5 sekund, aby nie zatrzymywać na długo bieżącej pracy aplikacji. Wynik błędu nie oznacza udanej instalacji.

Jedyna kopia dawnych plików oraz wszystkich sześciu dostarczonych zakładek: [archiwum ZIP](../docs/archiwum-sql-przed-porzadkowaniem.zip). Sumy kontrolne zawartości są sprawdzane w testach. Archiwum służy do odtworzenia źródeł, nie do ponownego uruchamiania dawnych pełnych instalacji.

## Dalsze Zmiany Dla Programisty

Oznaczenia `SQL_SOURCE_BEGIN`/`SQL_SOURCE_END` identyfikują bieżące sekcje testów, nie kopie historycznych migracji. Przyszła zmiana istniejącej kolumny lub funkcji wymaga jawnej, przetestowanej aktualizacji w odpowiednim pliku. Zmiana definicji wewnątrz bloku „utwórz, jeśli brak” nie aktualizuje już istniejącego obiektu.
