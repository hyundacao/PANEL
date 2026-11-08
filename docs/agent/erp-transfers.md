# Dokumenty Przesuniec ERP

## Punkty Wejscia

| Temat | Plik | Kotwice |
| --- | --- | --- |
| Osobny modul ERP | [page](<../../src/app/(erp)/przesuniecia-magazynowe/page.tsx>) / [layout](<../../src/app/(erp)/layout.tsx>) | |
| Wspolny panel dokumentow | [WarehouseTransferDocumentsPanel](<../../src/app/(main)/przesuniecia/WarehouseTransferDocumentsPanel.tsx>) | |
| Wejscie przez zwykle przesuniecia | [przesuniecia page](<../../src/app/(main)/przesuniecia/page.tsx>) | |
| Klient i kontrakty | [api/index](<../../src/lib/api/index.ts>) / [api/types](<../../src/lib/api/types.ts>) | |
| Dokumenty, pozycje, wydania, przyjecia | [api/app](<../../src/app/api/app/route.ts>) | `handleAction`, `ensureActionAccess` |
| Nawigacja ERP | [ErpSidebar](<../../src/components/layout/ErpSidebar.tsx>) / [store UI](<../../src/lib/store/ui.ts>) | |

## Przeplyw I Wplyw

- W duzym backendzie szukaj nazw akcji z klienta: `getWarehouseTransferDocuments`, `getWarehouseTransferDocument`, `createWarehouseTransferDocument`, `addWarehouseTransferItemIssue`, `addWarehouseTransferItemReceipt`, `requestWarehouseTransferPackage`, `closeWarehouseTransferDocument`.
- Tabele: `warehouse_transfer_documents`, `warehouse_transfer_document_items`, `warehouse_transfer_item_issues`, `warehouse_transfer_item_receipts`, `erp_target_locations`, `warehouses`.
- Dwa wejscia UI uzywaja tego samego panelu i backendu. Zmiana widoku/walidacji dotyczy obu.
- Dokumenty ERP nie sa zwyklymi rekordami `transfers` przemialow ani dokumentem zapotrzebowania planu. Nie lacz tych trzech mechanizmow na podstawie nazwy "przesuniecie" / "dokument".
- Import panelu zawiera dwa indeksy, jednostke, partie, lokalizacje i planowana ilosc. Zmiana parsera lub DTO wymaga sprawdzenia pozycji, wydan i przyjec, nie tylko naglowka dokumentu.
- Lokalizacje docelowe/magazyny maja wspolna administracje; sprawdz [bezpieczenstwo](<security-data.md>) i [kontrakty](<contracts.md>).

## Weryfikacja

- [security](<../../src/lib/security/security.test.mjs>), [adminAccess](<../../src/lib/auth/adminAccess.test.mjs>) przy zmianie dostepu.
- [sqlModules](<../../src/lib/utils/sqlModules.test.mjs>) i [SQL 03](<../../supabase/03_przesuniecia_erp.sql>) przy zmianie schematu.
- Nie ma dedykowanego pelnego testu UI tego panelu w repo. Dla zmian biznesowych sprawdz na atrapach API: import -> dokument -> wydanie -> przyjecie -> zamkniecie oraz oba wejscia UI. Nie zastap tego samym buildem.
