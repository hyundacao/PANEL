# Planowanie I Technologie

`/planowanie-zapotrzebowania`: plan, obliczenia, biblioteka, dokument, zwroty, ustawienia. `view=spis`: [spis](<inventory.md>).

## Punkty Wejscia

| Zmiana | Plik | Kotwice |
| --- | --- | --- |
| Produkt z podpowiedzi | [page.tsx](<../../src/app/(main)/planowanie-zapotrzebowania/page.tsx>) | `selectTechnologyEditorProduct`, `technologyMatchesProduct` |
| Kod/nazwa skladnika i jednostka | [page.tsx](<../../src/app/(main)/planowanie-zapotrzebowania/page.tsx>) | `catalogMaterialPatch`, `selectEditorMaterial`, `selectEditorLink` |
| Gramy w edytorze, ilosci/opakowania w wyniku | [page.tsx](<../../src/app/(main)/planowanie-zapotrzebowania/page.tsx>) | `technologyUsageForEditor`, `technologyUsageFromEditor`, `technologyMaterialWithUnit`, `roundTechnologyMaterialQuantity` |
| Zapis technologii / zamiana rol | [page.tsx](<../../src/app/(main)/planowanie-zapotrzebowania/page.tsx>) | `saveTechnologyEditor`, `makeTechnologyBase` |
| Edycja zapisanego naglowka i referencji polwyrobu | [technologyVariants.ts](<../../src/lib/planowanie-zapotrzebowania/technologyVariants.ts>) / [page.tsx](<../../src/app/(main)/planowanie-zapotrzebowania/page.tsx>) | `renameTechnologyProduct`, `linkedSourceSelectionForItem` |
| Czysta zamiana rol bez zmiany skladow i ID | [technologyVariants.ts](<../../src/lib/planowanie-zapotrzebowania/technologyVariants.ts>) | `promoteTechnologyToBase` |
| Preferowany indeks i szukanie po obu | [productCatalogSearch.ts](<../../src/lib/planowanie-zapotrzebowania/productCatalogSearch.ts>) | `productCatalogSelectionIndex`, `productCatalogIndexMatches`, `searchProductCatalog` |
| Zakres, korekty, obliczenia domeny | [domain.ts](<../../src/lib/planowanie-zapotrzebowania/domain.ts>) | `calculateScopedQuantity`, `effectiveTechnologyMaterials`, `calculateIssueBalance` |
| Koszt przeliczania ekranu, cache wariantow i zaleznosci | [page.tsx](<../../src/app/(main)/planowanie-zapotrzebowania/page.tsx>) | `planningCalculations`, `technologiesFor` |
| Import ilosci planu | [planImport.ts](<../../src/lib/planowanie-zapotrzebowania/planImport.ts>) | `readPlanningRows`, `quantityNeedsReview` |
| Stan i podsumowanie strefy | [zoneStock.ts](<../../src/lib/planowanie-zapotrzebowania/zoneStock.ts>) | `buildZoneStockSummary`, `buildZonePlanSummary` |
| Ilosc reczna / laczenie dokumentu | [manualIssueQuantities.ts](<../../src/lib/planowanie-zapotrzebowania/manualIssueQuantities.ts>) / [pickingDocumentRows.ts](<../../src/lib/planowanie-zapotrzebowania/pickingDocumentRows.ts>) | |
| Widok stanu / podsumowania / ilosci | [ZoneStockCell](<../../src/components/planowanie-zapotrzebowania/ZoneStockCell.tsx>) / [ZonePlanSummary](<../../src/components/planowanie-zapotrzebowania/ZonePlanSummary.tsx>) / [IssueQuantityField](<../../src/components/planowanie-zapotrzebowania/IssueQuantityField.tsx>) | |
| Excel biblioteki: przycisk -> pary indeksow -> plik | [przycisk](<../../src/components/planowanie-zapotrzebowania/TechnologyLibraryExportButton.tsx>) / [logika](<../../src/lib/planowanie-zapotrzebowania/technologyLibraryExport.ts>) / [workbook](<../../src/lib/planowanie-zapotrzebowania/technologyLibraryWorkbook.ts>) | |
| Skrocona rozpiska skladu planu | [technologyQuickReference.ts](<../../src/lib/planowanie-zapotrzebowania/technologyQuickReference.ts>) | `buildTechnologyQuickReferenceRows` |

## Zapis I Wplyw

- Ekran -> [usePlanningAutosave](<../../src/lib/planowanie-zapotrzebowania/usePlanningAutosave.ts>) -> [silnik](<../../src/lib/planowanie-zapotrzebowania/autosave.ts>) -> [API GET/PUT](<../../src/app/api/planowanie-zapotrzebowania/route.ts>) -> `material_planning_state` przez RPC `save_material_planning_state`.
- Duze zapisy: [saveTransport](<../../src/lib/planowanie-zapotrzebowania/saveTransport.ts>) kompresuje JSON; [saveBody.server](<../../src/lib/planowanie-zapotrzebowania/saveBody.server.ts>) po autoryzacji limituje rozpakowanie. Stary JSON nadal dziala; rewizje/scalanie bez zmian.
- [draftCache](<../../src/lib/planowanie-zapotrzebowania/draftCache.ts>): IndexedDB z migracja/fallbackiem localStorage. Sukces kopii dopiero po transakcji.
- [Retencja](<../../src/lib/planowanie-zapotrzebowania/historyRetention.ts>): dzis/wczoraj/przyszlosc; filtr na kliencie, zapisie i obu stronach scalania. Chroni aktywny plan, receptury robocze, spis i ustawienia; nie dotyczy innych modulow/projekcji.
- [stateScopes](<../../src/lib/planowanie-zapotrzebowania/stateScopes.ts>) rozdziela `main` (wspolna biblioteka/ustawienia/dokumenty) i `workspace:<userId>` (plan roboczy); pilnuje rewizji i scalania.
- `scope=technology-library`: tylko kolumna technologii, osobny zapis bez nadpisywania workspace/dokumentow. `scope=workspace`: `projectPlanningWorkspace`/`selectPlanningTechnologies` wybieraja receptury planu, warianty i zaleznosci. Bez scope stary pelny odczyt.
- Import: `handleImportSelectedSheet` -> `ensurePlanTechnologies` -> POST `plan-technologies`, potem zwykly import. Oddzielne cache, wspolna bariera zapisu przy przejsciu. Stary niezapisany draft odzyskiwany w pelnym trybie.
- Technologia -> plan/obliczenia -> strefa -> dokument -> zwroty/Excel. Nie zmieniaj ID przy zmianie roli bazowa/awaryjna.
- `planningCalculations`: cache po wejsciu (ilosc, receptura, biblioteka, spis, dokumenty, zakres, strefa), nie statusie zapisu/historii. `technologiesFor`: ograniczony cache jednej wersji biblioteki. Bez mutacji planu/spisu w miejscu.
- Zapisana technologia, reczna kopia robocza i wygenerowany dokument to rozne zapisy. Zmiana biblioteki nie upowaznia do przepisywania archiwum.
- Naglowek zmienia rodzine bez zmiany ID; zajety indeks blokuje zapis. `linkedProducts.sourceKeys` zachowuje stare wybory zrodel (nie aliasy kartoteki). Plan trzyma ID; dokumenty/snapshoty bez zmian.
- Podglad technologii w zadaniu przygotowania produkcji czyta plan/biblioteke: [karta przygotowania](<preparation.md>).
- Indeksy/jednostki/dopasowanie: [kontrakty](<contracts.md#indeksy-i-jednostki>) i [spis](<inventory.md>). Polwyrob/pakowanie nadwyzki nie oznacza ponownego rozchodu calego drzewa.
- Urzadzenia strefowe: [fixedInventoryDevices](<../../src/lib/planowanie-zapotrzebowania/fixedInventoryDevices.ts>); zestawy paletowe: [karta spisu](<inventory.md>).

## Testy Wg Zmiany

Wybrane testy domeny:

- Wybor indeksu/skladnika: [technologyProductSelection](<../../src/lib/planowanie-zapotrzebowania/technologyProductSelection.test.mjs>), [productCatalogSearch](<../../src/lib/planowanie-zapotrzebowania/productCatalogSearch.test.mjs>).
- Zamiana bazowej: [technologyVariants](<../../src/lib/planowanie-zapotrzebowania/technologyVariants.test.mjs>), [stateScopes](<../../src/lib/planowanie-zapotrzebowania/stateScopes.test.mjs>).
- Przeliczenia/plan: [domain](<../../src/lib/planowanie-zapotrzebowania/domain.test.mjs>), [planImport.integration](<../../src/lib/planowanie-zapotrzebowania/planImport.integration.test.mjs>).
- Cache: [planningPerformance](<../../src/lib/planowanie-zapotrzebowania/planningPerformance.test.mjs>); import integracyjny obejmuje tydzien z receptura robocza.
- Stany/dokument: [zoneStock](<../../src/lib/planowanie-zapotrzebowania/zoneStock.test.mjs>), [zonePlanSummary](<../../src/lib/planowanie-zapotrzebowania/zonePlanSummary.test.mjs>), [pickingDocumentRows](<../../src/lib/planowanie-zapotrzebowania/pickingDocumentRows.test.mjs>), [manualIssueQuantities](<../../src/lib/planowanie-zapotrzebowania/manualIssueQuantities.test.mjs>).
- Excel: [technologyLibraryExport](<../../src/lib/planowanie-zapotrzebowania/technologyLibraryExport.test.mjs>), [technologyLibraryWorkbook](<../../src/lib/planowanie-zapotrzebowania/technologyLibraryWorkbook.test.mjs>).
- Autozapis: [autosave](<../../src/lib/planowanie-zapotrzebowania/autosave.test.mjs>), [stateScopes](<../../src/lib/planowanie-zapotrzebowania/stateScopes.test.mjs>). Przy zmianie kontraktu takze pelny zestaw.
- Odczyt/zapis zakresow: [scopedPlanningLoading](<../../src/lib/planowanie-zapotrzebowania/scopedPlanningLoading.test.mjs>), [productionTechnologyPreview](<../../src/lib/utils/productionTechnologyPreview.test.mjs>).
- Retencja: [historyRetention](<../../src/lib/planowanie-zapotrzebowania/historyRetention.test.mjs>), `planImport.integration` i [productionTechnologyPreview](<../../src/lib/utils/productionTechnologyPreview.test.mjs>).
- Rozmiar/backup: [saveTransport](<../../src/lib/planowanie-zapotrzebowania/saveTransport.test.mjs>), [draftCache](<../../src/lib/planowanie-zapotrzebowania/draftCache.test.mjs>).
