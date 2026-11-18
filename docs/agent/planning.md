# Planowanie I Technologie

`/planowanie-zapotrzebowania`: plan, obliczenia, biblioteka, dokument, zwroty, ustawienia. `view=spis`: [spis](<inventory.md>).

## Punkty Wejscia

| Zmiana | Plik | Kotwice |
| --- | --- | --- |
| Produkt z podpowiedzi | [page.tsx](<../../src/app/(main)/planowanie-zapotrzebowania/page.tsx>) | `selectTechnologyEditorProduct`, `technologyMatchesProduct` |
| Kod/nazwa skladnika i jednostka | [page.tsx](<../../src/app/(main)/planowanie-zapotrzebowania/page.tsx>) | `catalogMaterialPatch`, `selectEditorMaterial`, `selectEditorLink` |
| Gramy w edytorze, ilosci/opakowania w wyniku | [page.tsx](<../../src/app/(main)/planowanie-zapotrzebowania/page.tsx>) | `technologyUsageForEditor`, `technologyUsageFromEditor`, `technologyMaterialWithUnit`, `roundTechnologyMaterialQuantity` |
| Zapis technologii / zamiana rol | [page.tsx](<../../src/app/(main)/planowanie-zapotrzebowania/page.tsx>) | `saveTechnologyEditor`, `makeTechnologyBase` |
| Naglowek/referencje | [technologyVariants.ts](<../../src/lib/planowanie-zapotrzebowania/technologyVariants.ts>) / [page.tsx](<../../src/app/(main)/planowanie-zapotrzebowania/page.tsx>) | `renameTechnologyProduct`, `linkedSourceSelectionForItem` |
| Zamiana rol, stale sklady/ID | [technologyVariants.ts](<../../src/lib/planowanie-zapotrzebowania/technologyVariants.ts>) | `promoteTechnologyToBase` |
| Preferowany indeks i szukanie po obu | [productCatalogSearch.ts](<../../src/lib/planowanie-zapotrzebowania/productCatalogSearch.ts>) | `productCatalogSelectionIndex`, `productCatalogIndexMatches`, `searchProductCatalog` |
| Zakres, korekty, obliczenia domeny | [domain.ts](<../../src/lib/planowanie-zapotrzebowania/domain.ts>) | `calculateScopedQuantity`, `effectiveTechnologyMaterials`, `calculateIssueBalance` |
| Cache obliczen/wariantow | [page.tsx](<../../src/app/(main)/planowanie-zapotrzebowania/page.tsx>) | `planningCalculations`, `technologiesFor` |
| Import ilosci planu | [planImport.ts](<../../src/lib/planowanie-zapotrzebowania/planImport.ts>) | `readPlanningRows`, `quantityNeedsReview` |
| Stan i podsumowanie strefy | [zoneStock.ts](<../../src/lib/planowanie-zapotrzebowania/zoneStock.ts>) | `buildZoneStockSummary`, `buildZonePlanSummary` |
| Ilosc reczna / laczenie dokumentu | [manualIssueQuantities.ts](<../../src/lib/planowanie-zapotrzebowania/manualIssueQuantities.ts>) / [pickingDocumentRows.ts](<../../src/lib/planowanie-zapotrzebowania/pickingDocumentRows.ts>) | |
| Widok stanu / podsumowania / ilosci | [ZoneStockCell](<../../src/components/planowanie-zapotrzebowania/ZoneStockCell.tsx>) / [ZonePlanSummary](<../../src/components/planowanie-zapotrzebowania/ZonePlanSummary.tsx>) / [IssueQuantityField](<../../src/components/planowanie-zapotrzebowania/IssueQuantityField.tsx>) | |
| Excel biblioteki: przycisk -> pary indeksow -> plik | [przycisk](<../../src/components/planowanie-zapotrzebowania/TechnologyLibraryExportButton.tsx>) / [logika](<../../src/lib/planowanie-zapotrzebowania/technologyLibraryExport.ts>) / [workbook](<../../src/lib/planowanie-zapotrzebowania/technologyLibraryWorkbook.ts>) | |
| Skrocona rozpiska skladu planu | [technologyQuickReference.ts](<../../src/lib/planowanie-zapotrzebowania/technologyQuickReference.ts>) | `buildTechnologyQuickReferenceRows` |

## Zapis I Wplyw

- Ekran -> [usePlanningAutosave](<../../src/lib/planowanie-zapotrzebowania/usePlanningAutosave.ts>) -> [silnik](<../../src/lib/planowanie-zapotrzebowania/autosave.ts>) -> [API GET/PUT](<../../src/app/api/planowanie-zapotrzebowania/route.ts>) -> `material_planning_state` przez RPC `save_material_planning_state`.
- Duze zapisy: [saveTransport](<../../src/lib/planowanie-zapotrzebowania/saveTransport.ts>) kompresuje JSON; [saveBody.server](<../../src/lib/planowanie-zapotrzebowania/saveBody.server.ts>) autoryzuje i limituje rozpakowanie; stary JSON, rewizje/scalanie bez zmian.
- [draftCache](<../../src/lib/planowanie-zapotrzebowania/draftCache.ts>): IndexedDB z migracja/fallbackiem localStorage. Sukces kopii dopiero po transakcji.
- [Retencja](<../../src/lib/planowanie-zapotrzebowania/historyRetention.ts>): dzis/wczoraj/przyszlosc, klient/zapis/scalanie. Zachowuje plan/receptury robocze/spis/ustawienia; inne moduly/projekcje poza zakresem.
- [stateScopes](<../../src/lib/planowanie-zapotrzebowania/stateScopes.ts>) rozdziela `main` (wspolna biblioteka/ustawienia/dokumenty) i `workspace:<userId>` (plan roboczy); pilnuje rewizji i scalania.
- `scope=technology-library`: osobny odczyt/zapis technologii, bez workspace/dokumentow. `scope=workspace`: `projectPlanningWorkspace`/`selectPlanningTechnologies` wybieraja receptury, warianty/zaleznosci planu. Bez scope pelny odczyt.
- Import: `handleImportSelectedSheet` -> `ensurePlanTechnologies` -> POST `plan-technologies` -> import. Oddzielne cache, wspolna bariera zapisu; stary draft odzyskiwany w pelnym trybie.
- Technologia -> plan/obliczenia -> strefa -> dokument -> zwroty/Excel. Nie zmieniaj ID przy zmianie roli bazowa/awaryjna.
- `planningCalculations`: cache po ilosci/recepturze/bibliotece/spisie/dokumentach/zakresie/strefie, nie zapisie/historii. `technologiesFor`: jedna wersja biblioteki. Bez mutacji planu/spisu.
- Biblioteka, robocza receptura i dokument to rozne zapisy; nie przepisuj archiwum przy zmianie biblioteki.
- Naglowek zmienia rodzine, nie ID; zajety indeks blokuje zapis. `linkedProducts.sourceKeys` zachowuje wybory zrodel, nie aliasy kartoteki. Plan trzyma ID; dokumenty/snapshoty bez zmian.
- Podglad planu/biblioteki: [przygotowanie](<preparation.md>).
- Jednorazowa normalizacja indeksow skladnikow, kopia i rollback: [osobna karta](<technology-indices.md>).
- Indeksy/jednostki/dopasowanie: [kontrakty](<contracts.md#indeksy-i-jednostki>) i [spis](<inventory.md>). Polwyrob/pakowanie nadwyzki nie oznacza ponownego rozchodu calego drzewa.
- Urzadzenia strefowe: [fixedInventoryDevices](<../../src/lib/planowanie-zapotrzebowania/fixedInventoryDevices.ts>); zestawy paletowe: [karta spisu](<inventory.md>).

## Testy Wg Zmiany

Wybrane testy domeny:

- Indeksy: [wybor](<../../src/lib/planowanie-zapotrzebowania/technologyProductSelection.test.mjs>), [szukanie](<../../src/lib/planowanie-zapotrzebowania/productCatalogSearch.test.mjs>).
- Zamiana bazowej: [technologyVariants](<../../src/lib/planowanie-zapotrzebowania/technologyVariants.test.mjs>), [stateScopes](<../../src/lib/planowanie-zapotrzebowania/stateScopes.test.mjs>).
- Przeliczenia/plan: [domain](<../../src/lib/planowanie-zapotrzebowania/domain.test.mjs>), [planImport.integration](<../../src/lib/planowanie-zapotrzebowania/planImport.integration.test.mjs>).
- Cache: [planningPerformance](<../../src/lib/planowanie-zapotrzebowania/planningPerformance.test.mjs>); import obejmuje tydzien receptury roboczej.
- Stany/dokument: [stany](<../../src/lib/planowanie-zapotrzebowania/zoneStock.test.mjs>), [strefa](<../../src/lib/planowanie-zapotrzebowania/zonePlanSummary.test.mjs>), [wiersze](<../../src/lib/planowanie-zapotrzebowania/pickingDocumentRows.test.mjs>), [reczne ilosci](<../../src/lib/planowanie-zapotrzebowania/manualIssueQuantities.test.mjs>).
- Excel: [technologyLibraryExport](<../../src/lib/planowanie-zapotrzebowania/technologyLibraryExport.test.mjs>), [technologyLibraryWorkbook](<../../src/lib/planowanie-zapotrzebowania/technologyLibraryWorkbook.test.mjs>).
- Autozapis: [autosave](<../../src/lib/planowanie-zapotrzebowania/autosave.test.mjs>), [stateScopes](<../../src/lib/planowanie-zapotrzebowania/stateScopes.test.mjs>); kontrakt wymaga pelnego zestawu.
- Zakresy: [scopedPlanningLoading](<../../src/lib/planowanie-zapotrzebowania/scopedPlanningLoading.test.mjs>), [productionTechnologyPreview](<../../src/lib/utils/productionTechnologyPreview.test.mjs>).
- Retencja: [historyRetention](<../../src/lib/planowanie-zapotrzebowania/historyRetention.test.mjs>), `planImport.integration` i [productionTechnologyPreview](<../../src/lib/utils/productionTechnologyPreview.test.mjs>).
- Rozmiar/backup: [saveTransport](<../../src/lib/planowanie-zapotrzebowania/saveTransport.test.mjs>), [draftCache](<../../src/lib/planowanie-zapotrzebowania/draftCache.test.mjs>).
