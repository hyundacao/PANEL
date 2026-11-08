# Przemialy I Magazyn

Nie myl zwyklych transferow przemialow z [dokumentami ERP](<erp-transfers.md>) ani magazynu ze [spisem stref](<inventory.md>).

## Ekrany

- KPI: [dashboard](<../../src/app/(main)/dashboard/page.tsx>).
- Spis magazynu/lokacji: [lista](<../../src/app/(main)/spis/page.tsx>), [magazyn](<../../src/app/(main)/spis/[warehouseId]/page.tsx>), [lokacja](<../../src/app/(main)/spis/[warehouseId]/lokacja/[locationId]/page.tsx>).
- Stany/przemialy i kartoteki: [kartoteka](<../../src/app/(main)/kartoteka/page.tsx>), [zarzadzanie](<../../src/app/(main)/przemialy/zarzadzanie/page.tsx>).
- Transfery/raporty: [przesuniecia](<../../src/app/(main)/przesuniecia/page.tsx>), [raporty](<../../src/app/(main)/raporty/page.tsx>).
- Pozostale stany: [suszarki](<../../src/app/(main)/suszarki/page.tsx>), [wymieszane](<../../src/app/(main)/wymieszane/page.tsx>).

## Punkty Logiki

| Temat | Plik | Kotwice |
| --- | --- | --- |
| API: stan, raport, transfer | [api/app](<../../src/app/api/app/route.ts>) | `handleAction`, `ensureActionAccess` |
| Jednostki / ilosci wejscia | [regrindStockInput](<../../src/lib/utils/regrindStockInput.ts>) | |
| Anulowanie transferu | [transferCancellation](<../../src/lib/utils/transferCancellation.ts>) | |
| Statystyki / ERP kartotek | [regrindStats](<../../src/lib/utils/regrindStats.ts>) / [regrindCatalogErp](<../../src/lib/utils/regrindCatalogErp.ts>) | |
| Wykresy raportow: Wyrobiono nad Przybylo, duze kola, stale etykiety wokol | [raporty](<../../src/app/(main)/raporty/page.tsx>) / [RegrindDonutChart](<../../src/components/reports/RegrindDonutChart.tsx>) / [regrindDonutLayout](<../../src/lib/utils/regrindDonutLayout.ts>) | `DonutPanel`, `buildPieItems`, `regrindDonutLayout`; katy z Recharts, wysokosci z DOM, lagodne radialne odnosniki, uporzadkowany wariant dla gestych etykiet |
| Mielenie ze spisu: limit, sugestia, masa | [originalInventoryGrinding](<../../src/lib/utils/originalInventoryGrinding.ts>) / [grindingTargetSuggestions](<../../src/lib/utils/grindingTargetSuggestions.ts>) / [grindingTechnologyMass](<../../src/lib/utils/grindingTechnologyMass.ts>) | |
| Formularz celu mielenia | [GrindingTargetInput](<../../src/components/planowanie-zapotrzebowania/GrindingTargetInput.tsx>) | |

## Przeplyw I Wplyw

- Ekrany -> [klient API](<../../src/lib/api/index.ts>) -> `POST /api/app` -> tabele `materials`, `material_catalogs`, `warehouses`, `locations`, `daily_entries`, `daily_location_status`, `transfers`, `inventory_adjustments`, `mixed_materials`, `dryers`.
- Akcje nawigacyjne w backendzie: `getDashboard`, `getReports`, `getLocationsOverview`, `upsertEntry`, `addTransfer`, `getInventoryAdjustments`, `getMixedMaterials`, `getDryers`, `getRegrindCatalogErpComparison`.
- Transfer moze zmieniac stany obu lokacji i pozniejsze dni. RPC `create_regrind_transfer` / `cancel_regrind_transfer` zapewniaja transakcje; nie zastepuj ich pojedynczymi update.
- "Do zmielenia" jest w [SpisRzeczywisty](<../../src/components/planowanie-zapotrzebowania/SpisRzeczywisty.tsx>), a akcje `addOriginalInventoryGrindTask` / `completeOriginalInventoryGrindTasks` w `api/app`; dane w `original_inventory_grind_tasks`.
- Technologie masy sa odczytywane przez [grinding-technologies API](<../../src/app/api/original-inventory-grinding-technologies/route.ts>) z biblioteki planowania. Zmiana skladu technologii moze wiec zmienic przeliczenie sztuk do zmielenia na kg.
- Wycofane sugestie celow: [grind-target-exclusions API](<../../src/app/api/original-inventory-grind-target-exclusions/route.ts>), osobny rekord stanu; nie usuwaj historii zadan dla usuniecia sugestii.
- Porownania ERP korzystaja z tych samych kartotek/snapshotow co [spis](<inventory.md>). Roznica fizyczny minus ERP: dodatnia = wiecej fizycznie.

## Testy

- Stan/transfer: [regrindStockInput](<../../src/lib/utils/regrindStockInput.test.mjs>), [transferCancellation](<../../src/lib/utils/transferCancellation.test.mjs>), [regrindStats](<../../src/lib/utils/regrindStats.test.mjs>).
- Kartoteka/ERP: [regrindCatalogErp](<../../src/lib/utils/regrindCatalogErp.test.mjs>).
- Wykresy raportow: [regrindDonutLayout](<../../src/lib/utils/regrindDonutLayout.test.mjs>) - kolejnosc pionowa obu raportow, stale nazwy/kg bez hover, duze zaokraglone kola, brak kolizji etykiet i krzyzowania odnosnikow.
- Mielenie: [originalInventoryGrinding](<../../src/lib/utils/originalInventoryGrinding.test.mjs>), [grindingDocumentSplit](<../../src/lib/utils/grindingDocumentSplit.test.mjs>), [grindingTargetSuggestions](<../../src/lib/utils/grindingTargetSuggestions.test.mjs>), [grindingTechnologyMass](<../../src/lib/utils/grindingTechnologyMass.test.mjs>).
- DB/RPC: [SQL 02](<../../supabase/02_magazyn_przemialow.sql>) i [SQL 04](<../../supabase/04_spis_rzeczywisty_i_stany_erp.sql>); testy [sqlModules](<../../src/lib/utils/sqlModules.test.mjs>) na bazie izolowanej.
