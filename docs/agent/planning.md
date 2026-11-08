# Planowanie I Technologie

Dotyczy `/planowanie-zapotrzebowania` z widokami planu, obliczen, biblioteki, dokumentu, zwrotow i ustawien. Dla `view=spis` przejdz do [spisu](<inventory.md>).

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
| Import ilosci planu | [planImport.ts](<../../src/lib/planowanie-zapotrzebowania/planImport.ts>) | `readPlanningRows`, `quantityNeedsReview` |
| Stan i podsumowanie strefy | [zoneStock.ts](<../../src/lib/planowanie-zapotrzebowania/zoneStock.ts>) | `buildZoneStockSummary`, `buildZonePlanSummary` |
| Ilosc reczna / laczenie dokumentu | [manualIssueQuantities.ts](<../../src/lib/planowanie-zapotrzebowania/manualIssueQuantities.ts>) / [pickingDocumentRows.ts](<../../src/lib/planowanie-zapotrzebowania/pickingDocumentRows.ts>) | |
| Widok stanu / podsumowania / ilosci | [ZoneStockCell](<../../src/components/planowanie-zapotrzebowania/ZoneStockCell.tsx>) / [ZonePlanSummary](<../../src/components/planowanie-zapotrzebowania/ZonePlanSummary.tsx>) / [IssueQuantityField](<../../src/components/planowanie-zapotrzebowania/IssueQuantityField.tsx>) | |
| Excel biblioteki: przycisk -> pary indeksow -> plik | [przycisk](<../../src/components/planowanie-zapotrzebowania/TechnologyLibraryExportButton.tsx>) / [logika](<../../src/lib/planowanie-zapotrzebowania/technologyLibraryExport.ts>) / [workbook](<../../src/lib/planowanie-zapotrzebowania/technologyLibraryWorkbook.ts>) | |
| Skrocona rozpiska skladu planu | [technologyQuickReference.ts](<../../src/lib/planowanie-zapotrzebowania/technologyQuickReference.ts>) | `buildTechnologyQuickReferenceRows` |

## Zapis I Wplyw

- Ekran -> [usePlanningAutosave](<../../src/lib/planowanie-zapotrzebowania/usePlanningAutosave.ts>) -> [silnik](<../../src/lib/planowanie-zapotrzebowania/autosave.ts>) -> [API GET/PUT](<../../src/app/api/planowanie-zapotrzebowania/route.ts>) -> `material_planning_state` przez RPC `save_material_planning_state`.
- [stateScopes](<../../src/lib/planowanie-zapotrzebowania/stateScopes.ts>) rozdziela `main` (wspolna biblioteka/ustawienia/dokumenty) i `workspace:<userId>` (plan roboczy); pilnuje rewizji i scalania.
- Technologia -> plan/obliczenia -> strefa -> dokument -> zwroty/Excel. Nie zmieniaj ID przy zmianie roli bazowa/awaryjna.
- Zapisana technologia, reczna kopia robocza i wygenerowany dokument to rozne zapisy. Zmiana biblioteki nie upowaznia do przepisywania archiwum.
- Naglowek edytuje cala rodzine wariantow bez zmiany ID; zajety indeks blokuje laczenie produktow. Referencje `linkedProducts` zachowuja stare klucze wyboru zrodel w `sourceKeys`, nie jako aliasy kartoteki. Plan po zmianie indeksu zachowuje jawne przypisanie po ID; dokumenty i snapshoty nie sa przepisywane.
- Podglad technologii w zadaniu przygotowania produkcji czyta plan/biblioteke: [karta przygotowania](<preparation.md>).
- Zmiana indeksow, jednostek lub dopasowania do stanu wymaga [kontraktow](<contracts.md#indeksy-i-jednostki>) i [spisu](<inventory.md>). Receptura polwyrobu i pakowanie nadwyzki nie sa ponownym biezacym rozchodem wszystkich poziomow drzewa.
- Urzadzenia strefowe: [fixedInventoryDevices](<../../src/lib/planowanie-zapotrzebowania/fixedInventoryDevices.ts>); zestawy paletowe: [karta spisu](<inventory.md>).

## Testy Wg Zmiany

W katalogu `src/lib/planowanie-zapotrzebowania/` wybierz tylko powiazane:

- Wybor indeksu/skladnika: [technologyProductSelection](<../../src/lib/planowanie-zapotrzebowania/technologyProductSelection.test.mjs>), [productCatalogSearch](<../../src/lib/planowanie-zapotrzebowania/productCatalogSearch.test.mjs>).
- Zamiana bazowej: [technologyVariants](<../../src/lib/planowanie-zapotrzebowania/technologyVariants.test.mjs>), [stateScopes](<../../src/lib/planowanie-zapotrzebowania/stateScopes.test.mjs>).
- Przeliczenia/plan: [domain](<../../src/lib/planowanie-zapotrzebowania/domain.test.mjs>), [planImport.integration](<../../src/lib/planowanie-zapotrzebowania/planImport.integration.test.mjs>).
- Stany/dokument: [zoneStock](<../../src/lib/planowanie-zapotrzebowania/zoneStock.test.mjs>), [zonePlanSummary](<../../src/lib/planowanie-zapotrzebowania/zonePlanSummary.test.mjs>), [pickingDocumentRows](<../../src/lib/planowanie-zapotrzebowania/pickingDocumentRows.test.mjs>), [manualIssueQuantities](<../../src/lib/planowanie-zapotrzebowania/manualIssueQuantities.test.mjs>).
- Excel: [technologyLibraryExport](<../../src/lib/planowanie-zapotrzebowania/technologyLibraryExport.test.mjs>), [technologyLibraryWorkbook](<../../src/lib/planowanie-zapotrzebowania/technologyLibraryWorkbook.test.mjs>).
- Autozapis: [autosave](<../../src/lib/planowanie-zapotrzebowania/autosave.test.mjs>), [stateScopes](<../../src/lib/planowanie-zapotrzebowania/stateScopes.test.mjs>). Przy zmianie kontraktu takze pelny zestaw.
