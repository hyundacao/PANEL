# Kartoteki I Spis

UI: `/planowanie-zapotrzebowania?view=spis`. [Stary adres](<../../src/app/(main)/spis-oryginalow/page.tsx>) tylko przekierowuje; nie naprawiaj tam formularza.

## Punkty Wejscia

| Zmiana | Plik | Kotwice |
| --- | --- | --- |
| Formularz, katalog, import, zestawienie i eksport spisu | [SpisRzeczywisty](<../../src/components/planowanie-zapotrzebowania/SpisRzeczywisty.tsx>) | `handleCatalogFileChange`, `handleCatalogImport`, `buildInventoryIndex2Resolver` |
| Podpowiedzi / indeks 2 | [originalInventorySpisSearch](<../../src/lib/utils/originalInventorySpisSearch.ts>) | `getOriginalInventorySpisIndex2`, `searchOriginalInventorySpisSuggestions`; formularz spisu wlacza onlyIndex2 przed limitem wynikow |
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
- Cache/nazwy na odczycie: `loadOriginalCatalog`, `invalidateOriginalCatalogCache`, `withCurrentInventoryNames`. Import odswieza tez katalog produktow planowania (zdarzenie `apka:catalog-updated` i rewizja rejestru).
- Formularz spisu pokazuje tylko nazwe i jawny indeks 2 (szukanie nadal po obu indeksach). `onlyIndex2` ma osobne klucze cache UI/API; domyslne szukanie skladnikow zestawow paletowych pozostaje bez zmian. Brak indeksu 2 nie usuwa kartoteki ani dawnych wpisow.
- Tabele: `original_inventory_catalog`, `original_inventory_entries`, `original_inventory_erp_snapshots`, `original_inventory_silos`, `original_inventory_silo_entries`. Rzeczywisty spis != stan ERP.
- Pary indeksow i lista zablokowanych sa rowniez w `material_planning_state`, ID `original-inventory-catalog-register`. Nie zakladaj obecnosci kolumny `index_code2` w produkcji tylko dlatego, ze jest SQL 11.
- Zablokowane kartoteki wypadaja z biezacego wyboru; historia i stare ID nie sa kasowane. `catalogIds` i `previousNames` podtrzymuja odwolania.
- Odbiorcy: [planowanie](<planning.md>), [mielenie/statystyki przemialow](<regrind.md>), [porownania ERP farb](<paint.md>), [zabezpieczenia importu](<security-data.md>).
- Przy indeksie/jednostce/retencji sprawdz [kontrakty](<contracts.md>). Zmiana nazwy przy odczycie nie jest zmiana zapisanej ilosci.

## Testy Wg Zmiany

- Import/rejestr: [catalogSync](<../../src/lib/utils/originalInventoryCatalogSync.test.mjs>), [indices](<../../src/lib/utils/originalInventoryIndices.test.mjs>), [index](<../../src/lib/utils/originalInventoryIndex.test.mjs>).
- Szukanie/nazwy: [SpisSearch](<../../src/lib/utils/originalInventorySpisSearch.test.mjs>), [catalogRename](<../../src/lib/utils/originalInventoryCatalogRename.test.mjs>), [SpisErpAvailability](<../../src/components/planowanie-zapotrzebowania/SpisErpAvailability.test.mjs>).
- Wpisy/strefy: [entryEditing](<../../src/lib/utils/originalInventoryEntryEditing.test.mjs>), [ownership](<../../src/lib/utils/originalInventoryOwnership.test.mjs>), [locationHierarchy](<../../src/lib/utils/originalInventoryLocationHierarchy.test.mjs>), [originalInventory](<../../src/lib/planowanie-zapotrzebowania/originalInventory.test.mjs>).
- Palety/Excel: [palletSets](<../../src/lib/planowanie-zapotrzebowania/palletSets.test.mjs>), [palletAccess](<../../src/lib/planowanie-zapotrzebowania/palletAccess.test.mjs>), [SpisInventoryExport](<../../src/components/planowanie-zapotrzebowania/SpisInventoryExport.test.mjs>).
