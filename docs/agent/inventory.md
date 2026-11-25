# Kartoteki I Spis

UI: `/planowanie-zapotrzebowania?view=spis`. [Stary adres](<../../src/app/(main)/spis-oryginalow/page.tsx>) tylko przekierowuje; nie naprawiaj tam formularza.

## Punkty Wejscia

| Zmiana | Plik | Kotwice |
| --- | --- | --- |
| Formularz, katalog, import, zestawienie i eksport spisu | [SpisRzeczywisty](<../../src/components/planowanie-zapotrzebowania/SpisRzeczywisty.tsx>) | `handleCatalogFileChange`, `handleCatalogImport`, `buildInventoryIndex2Resolver` |
| Podpowiedzi / indeks 2 | [originalInventorySpisSearch](<../../src/lib/utils/originalInventorySpisSearch.ts>) | `getOriginalInventorySpisIndex2`, `searchOriginalInventorySpisSuggestions`; indeks 2 lub sama nazwa przed limitem |
| Przygotowany katalog szukania / SQL 12 | [search projection](<../../src/lib/utils/originalInventorySearchProjection.ts>) | `readOriginalInventorySearchCandidates`, `refreshOriginalInventorySearchProjection` |
| Naglowki Excel i odczyt wierszy | [kolumny](<../../src/lib/utils/originalInventoryImportColumns.ts>) / [parser](<../../src/lib/utils/originalInventoryCatalog.ts>) | |
| Zapis importu kartotek | [import route](<../../src/app/api/original-inventory-catalog/import/route.ts>) | |
| Rejestr par i zablokowane kartoteki | [register](<../../src/lib/utils/originalInventoryCatalogRegister.ts>) | `createCatalogRegisterResolver`, `applyOriginalInventoryCatalogRegister` |
| Odczyt/zapis rejestru, blokady | [register server](<../../src/lib/utils/originalInventoryCatalogRegisterServer.ts>) | `readOriginalInventoryCatalogRegister`, `importOriginalInventoryCatalogRegister`, `assertOriginalInventoryCatalogAllowed` |
| Aktualizacja nazw / synchronizacja z ERP | [catalog sync](<../../src/lib/utils/originalInventoryCatalogSync.ts>) | `syncOriginalInventoryCatalogFromSnapshot` |
| Import stanow ERP i PDF | [import route](<../../src/app/api/original-inventory-erp-snapshot/import/route.ts>) / [PDF parser](<../../src/lib/utils/originalInventoryErpPdf.ts>) | |
| Dopasowanie obu indeksow, dawnych nazw i jednostek | [ERP match](<../../src/lib/utils/originalInventoryErpMatch.ts>) | `findOriginalInventoryCatalogMaterial`, `buildOriginalInventoryNameResolver`, `matchOriginalInventoryErpStock` |
| Podpowiedz stanu ERP / alerty | [SpisErpAvailability](<../../src/components/planowanie-zapotrzebowania/SpisErpAvailability.tsx>) / [alerty](<../../src/lib/utils/originalInventoryAlerts.ts>) / [API wyjatkow](<../../src/app/api/original-inventory-alert-exclusions/route.ts>) | |
| Dostep do wlasnych wpisow | [ownership](<../../src/lib/utils/originalInventoryOwnership.ts>) | |
| Stan stref / silosy wspolne | [hierarchia](<../../src/lib/utils/originalInventoryLocationHierarchy.ts>) / [zoneStock](<../../src/lib/planowanie-zapotrzebowania/zoneStock.ts>) | |
| Zestawy paletowe: ustawienia, edycja, zapis | [PalletSetSettings](<../../src/components/planowanie-zapotrzebowania/PalletSetSettings.tsx>) / [PalletInventoryEditor](<../../src/components/planowanie-zapotrzebowania/PalletInventoryEditor.tsx>) / [palletInventoryServer](<../../src/lib/planowanie-zapotrzebowania/palletInventoryServer.ts>) / [palletSets](<../../src/lib/planowanie-zapotrzebowania/palletSets.ts>) | |

## Backend I Wplyw

- Klient/typy: [api/index](<../../src/lib/api/index.ts>), [api/types](<../../src/lib/api/types.ts>). Backend: [api/app](<../../src/app/api/app/route.ts>).
- W duzym backendzie szukaj `case 'getOriginalInventory'`, `case 'getOriginalInventoryCatalog'`, `case 'searchOriginalInventoryCatalog'`, `case 'getOriginalInventoryCatalogRestrictions'`, `case 'addOriginalInventory'`, `case 'saveOriginalInventorySiloEntry'`, `case 'saveOriginalInventoryFixedDeviceEntry'`.
- Cache/nazwy: `loadOriginalCatalog`, `invalidateOriginalCatalogCache`, `withCurrentInventoryNames`. Import odswieza tez katalog planowania (`apka:catalog-updated`, rewizja).
- Spis: nazwa i jawny indeks 2 albo sama nazwa. `onlyIndex2` + `allowMissingIndex2` preferuje pasujaca nazwe/jednostke z indeksem 2 przed limitem. Szuka po obu indeksach, z priorytetem spisanych. Osobny cache `index2-or-name` UI/API; tryb scisly i zestawy paletowe bez zmian.
- Fraza: debounce, zmiana anuluje odczyt. Pobiera po otwarciu listy (tez klik pola). Jedno ponowienie; `networkMode: always`. Pusty wynik: komunikat, staleTime 0. Po bledzie projekcji wspoldzielony odczyt do 30 s; import/token go zeruje.
- Dotyk: [scroll](<../../src/lib/utils/suggestionListTouchScroll.ts>) z niepasywnym touchmove i overflow/maxHeight dla starego Androida. [Zamykanie](<../../src/lib/utils/suggestionListDismissal.ts>): tap poza formularzem, nie touchstart/scroll/pinch/blur; takze mysz/Tab/Escape.
- SQL 12: trwala projekcja; triggery uniewazniaja, import/sync publikuje atomowo. Brak projekcji: stary odczyt i `after` (raz/30 s/generacje/proces). RPC 2 s, klient 10 s. Publikacja wymaga `WHERE ordinal > 0`. SQL filtruje bez LIMIT; matcher JS stosuje `inventoriedNames` przed limitem 24 oraz w kluczach cache.
- Raport ERP pobiera 4 poprzednie daty spisu; `handleExportDaily` doczytuje do 60 dni na klik XLSX, bez szerokiego cache. Obliczenia: [originalInventoryReport](<../../src/lib/utils/originalInventoryReport.ts>). Wybor dat spisu i retencja bez zmian.
- Tabele: `original_inventory_catalog`, `original_inventory_entries`, `original_inventory_erp_snapshots`, `original_inventory_silos`, `original_inventory_silo_entries`. Rzeczywisty spis != stan ERP.
- Pary indeksow i lista zablokowanych sa rowniez w `material_planning_state`, ID `original-inventory-catalog-register`. Nie zakladaj obecnosci kolumny `index_code2` w produkcji tylko dlatego, ze jest SQL 11.
- SQL 13: zapis/edycja spisu sprawdza wersje rejestru; pelny odczyt przy zmianie, braku kopii lub RPC. Ten sam resolver, bez zmian podpowiedzi.
- Zablokowane kartoteki wypadaja z biezacego wyboru; historia i stare ID nie sa kasowane. `catalogIds` i `previousNames` podtrzymuja odwolania.
- Odbiorcy: [planowanie](<planning.md>), [mielenie/statystyki przemialow](<regrind.md>), [porownania ERP farb](<paint.md>), [zabezpieczenia importu](<security-data.md>).
- Przy indeksie/jednostce/retencji sprawdz [kontrakty](<contracts.md>). Zmiana nazwy przy odczycie nie jest zmiana zapisanej ilosci.

## Testy Wg Zmiany

- Import/rejestr: [catalogSync](<../../src/lib/utils/originalInventoryCatalogSync.test.mjs>), [indices](<../../src/lib/utils/originalInventoryIndices.test.mjs>), [index](<../../src/lib/utils/originalInventoryIndex.test.mjs>).
- [Walidacja rejestru](<../../src/lib/utils/originalInventoryCatalogValidation.test.mjs>): wersja, zgodnosc decyzji, uprawnienia.
- Szukanie/nazwy: [SpisSearch](<../../src/lib/utils/originalInventorySpisSearch.test.mjs>), [catalogRename](<../../src/lib/utils/originalInventoryCatalogRename.test.mjs>), [SpisErpAvailability](<../../src/components/planowanie-zapotrzebowania/SpisErpAvailability.test.mjs>).
- Gesty: [scroll](<../../src/lib/utils/suggestionListTouchScroll.test.mjs>), [zamykanie](<../../src/lib/utils/suggestionListDismissal.test.mjs>) (tap/scroll/fokus/anulowanie/Android).
- Fraza/cache/ponowienia/blur: [nameSearchRequests](<../../src/components/planowanie-zapotrzebowania/SpisNameSearchRequests.test.mjs>); opcje UI + QueryObserver, bez sieci/bazy.
- Projekcja/triggery/priorytet przed limitem: [searchProjection](<../../src/lib/utils/originalInventorySearchProjection.test.mjs>); izolowany PostgreSQL, bez firmowej bazy.
- Zawieszone zapytania/anulowanie: [searchTimeout](<../../src/lib/utils/originalInventorySearchTimeout.test.mjs>) / [deadline](<../../src/lib/utils/originalInventorySearchTimeout.ts>).
- Wpisy/strefy: [entryEditing](<../../src/lib/utils/originalInventoryEntryEditing.test.mjs>), [ownership](<../../src/lib/utils/originalInventoryOwnership.test.mjs>), [locationHierarchy](<../../src/lib/utils/originalInventoryLocationHierarchy.test.mjs>), [originalInventory](<../../src/lib/planowanie-zapotrzebowania/originalInventory.test.mjs>).
- Palety: aktywny zestaw po ID/aliasie domyslny, sztuki recznie; wpisana ilosc blokuje automatyczna zmiane trybu. Testy: `SpisErpAvailability`, [zestawy](<../../src/lib/planowanie-zapotrzebowania/palletSets.test.mjs>), [dostep](<../../src/lib/planowanie-zapotrzebowania/palletAccess.test.mjs>). [Eksport](<../../src/components/planowanie-zapotrzebowania/SpisInventoryExport.test.mjs>).
- Historia raportu / XLSX na zadanie: [SpisReportExport](<../../src/components/planowanie-zapotrzebowania/SpisReportExport.test.mjs>).
