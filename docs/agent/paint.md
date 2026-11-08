# Farby I Tasmy

## Punkty Wejscia

| Temat | Plik | Kotwice |
| --- | --- | --- |
| Zlecenia, pobrania, rozliczenia i ich Excel | [rozliczanie](<../../src/app/(main)/rozliczanie-farb-rozcienczalnikow/page.tsx>) | |
| Biezacy spis / historia | [PaintTapeInventoryPanel](<../../src/app/(main)/rozliczanie-farb-rozcienczalnikow/PaintTapeInventoryPanel.tsx>) | |
| Wejscie do modulu spisu | [spis-farb-tasm](<../../src/app/(main)/spis-farb-tasm/page.tsx>) | |
| Zarzadzanie kartotekami / sesjami | [zarzadzanie](<../../src/app/(main)/spis-farb-tasm/zarzadzanie/page.tsx>) | |
| Komentarze | [komponent](<../../src/app/(main)/rozliczanie-farb-rozcienczalnikow/PaintTapeInventoryComment.tsx>) / [serwer](<../../src/lib/utils/paintTapeInventoryCommentsServer.ts>) | |
| Archiwizacja ERP / czyszczenie | [archive server](<../../src/lib/utils/paintTapeInventoryArchiveServer.ts>) | `archivePaintTapeInventorySession`, `purgeOriginalErpHistory` |
| Porownanie z ERP | [paintTapeInventoryErp](<../../src/lib/utils/paintTapeInventoryErp.ts>) | `buildPaintTapeInventoryErpLookup`, `findPaintTapeInventoryErpSnapshot` |
| Excel historii spisu | [paintTapeInventoryWorkbook](<../../src/lib/utils/paintTapeInventoryWorkbook.ts>) | `buildPaintTapeInventoryExport`, `createPaintTapeInventoryWorkbook` |

## Przeplyw I Wplyw

- UI -> [api/index](<../../src/lib/api/index.ts>) -> [api/app](<../../src/app/api/app/route.ts>).
- W backendzie: `getPaintTapeSettlements`, `updatePaintTapeSettlement`, `getPaintTapeInventory`, `closePaintTapeInventorySession`, `reopenPaintTapeInventorySession`, `removePaintTapeInventorySession`, `getPaintTapeInventoryComments`, `savePaintTapeInventoryComment`.
- Tabele: `paint_tape_inventory_catalog`, `paint_tape_inventory_sessions`, `paint_tape_inventory_entries`, `paint_tape_settlements`, `paint_tape_settlement_issues`, `paint_tape_technology_usages`; komentarze/archiwum maja tez dedykowane helpery i SQL.
- Zamkniety spis zachowuje porownanie ERP. Nie zastap archiwalnego snapshotu dzisiejszym odczytem ani samym filtrem aktualnych kartotek.
- ERP jest wspolne ze [spisem rzeczywistym](<inventory.md>). Zmiana dopasowania indeksu/jednostki lub retencji wplywa na oba moduly.
- Komentarze i usuwanie sesji maja osobne kontrole uprawnien. Ukrycie pola w UI nie jest zabezpieczeniem API.
- Seed [paintTapeInventorySeed](<../../src/lib/data/paintTapeInventorySeed.ts>) nie jest lista aktualnych rekordow produkcyjnych.

## Testy

- Archiwum: [paintTapeInventoryArchive](<../../src/lib/utils/paintTapeInventoryArchive.test.mjs>).
- ERP: [paintTapeInventoryErp](<../../src/lib/utils/paintTapeInventoryErp.test.mjs>).
- Komentarze/usuwanie: [comments](<../../src/lib/utils/paintTapeInventoryComments.test.mjs>), [removal](<../../src/lib/utils/paintTapeInventoryRemoval.test.mjs>).
- Excel: [workbook](<../../src/lib/utils/paintTapeInventoryWorkbook.test.mjs>).
- Zmiana dostepu: dodatkowo [adminAccess](<../../src/lib/auth/adminAccess.test.mjs>) i [security](<../../src/lib/security/security.test.mjs>).
- SQL: [05_farby_i_tasmy](<../../supabase/05_farby_i_tasmy.sql>); zasady wdrozenia na [karcie danych](<security-data.md>).
