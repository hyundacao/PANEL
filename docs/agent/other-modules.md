# Pozostale Moduly

## Czesci Zamienne

- Ekrany: [wejscie](<../../src/app/(main)/czesci/page.tsx>), [stany](<../../src/app/(main)/czesci/stany/page.tsx>), [pobierz](<../../src/app/(main)/czesci/pobierz/page.tsx>), [uzupelnij](<../../src/app/(main)/czesci/uzupelnij/page.tsx>), [historia](<../../src/app/(main)/czesci/historia/page.tsx>), [zarzadzanie](<../../src/app/(main)/czesci/zarzadzanie/page.tsx>).
- [api/index](<../../src/lib/api/index.ts>) -> [api/app](<../../src/app/api/app/route.ts>): `getSpareParts`, `getSparePartHistory`, `setSparePartQty`, `adjustSparePart`, `addSparePart`, `updateSparePart`.
- Tabele `spare_parts`, `spare_part_history`. Zmiana ilosci powinna zachowac historie ruchow; nie poprawiaj samego widoku stanu.
- Brak osobnego pelnego zestawu domeny czesci w repo. Sprawdz typy, uprawnienia, pobranie/uzupelnienie i historie na danych testowych.

## Raport Zmianowy

- [Ekran](<../../src/app/(main)/raport-zmianowy/page.tsx>) -> klient API -> `api/app`.
- Kotwice akcji: `getRaportZmianowySessions`, `createRaportZmianowySession`, `addRaportZmianowyItem`, `addRaportZmianowyEntry`, `updateRaportZmianowyEntry`.
- Tabele `raport_zmianowy_sessions`, `raport_zmianowy_items`, `raport_zmianowy_entries`. Nie myl tego modulu z zadaniami [przygotowania produkcji](<preparation.md>) ani raportami magazynowymi [przemialow](<regrind.md>).
- Przy zmianie importu lub daty sprawdz arkusz, sesje, wpisy i historie. [SQL 08](<../../supabase/08_raporty.sql>).

## Raport Brakowosci

| Temat | Plik | Kotwice |
| --- | --- | --- |
| Ekran i endpoint | [page](<../../src/app/(main)/raport-brakowosci/page.tsx>) / [route](<../../src/app/api/raport-brakowosci/route.ts>) | |
| Excel/PDF i progi analizy | [analyzer](<../../src/lib/brakowosc/analyzer.ts>) | `analyzeBrakowosc`, `extractMesMachines`, `getWorkbookSheets` |

- Tabela `raport_brakowosci_latest`. Import jest chroniony przez sesje, uprawnienia i limity; parsowanie po stronie serwera.
- [security](<../../src/lib/security/security.test.mjs>) obejmuje zabezpieczenia endpointu, nie kazdy przypadek obliczen raportu. Dla zmiany progu/przelicznika dodaj celowany przypadek liczbowy.

## Bilans Przezbrojen

- [Ekran](<../../src/app/(main)/bilans-przezbrojen/page.tsx>). Zacznij od importow i lokalnych funkcji tego pliku, a nie od calego `api/app`.
- Nie ma dedykowanego zestawu testow domeny bilansu w repo. Sprawdz zestawienia na testowym pliku i oba widoki ekranu; nie uzywaj produkcyjnego uploadu jako testu.

## Wspolne Zaleznosci

Wszystkie te moduly korzystaja z [uprawnien i layoutu](<security-data.md>). Zmiana komponentu UI, typow klienta, dnia produkcyjnego lub uprawnien moze miec szerszy zasieg niz pojedynczy raport.
