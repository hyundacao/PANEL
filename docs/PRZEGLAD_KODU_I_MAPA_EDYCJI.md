# Przeglad kodu i mapa edycji

## 1. Co to za aplikacja
To monolit Next.js (App Router), ktory laczy:
- frontend panelu magazynowego,
- backend API (`/api/*`) w tym samym repo,
- baze danych Supabase/Postgres.

Najwazniejsze moduly biznesowe:
- `PRZEMIALY` (stany, spis, przesuniecia, raporty, suszarki, wymieszane),
- `CZESCI` (stany czesci, pobrania, uzupelnienia, historia),
- `RAPORT_ZMIANOWY`,
- `ADMIN`.

## 2. Warstwy i odpowiedzialnosc

### 2.1 Routing i layout
- Root layout: `src/app/layout.tsx`
- Layout aplikacji po zalogowaniu: `src/app/(main)/layout.tsx`
- Ekran logowania: `src/app/login/page.tsx`
- Wybor modulu po logowaniu: `src/app/magazyny/page.tsx`

`src/app/(main)/layout.tsx` jest kluczowy:
- pilnuje autoryzacji i dostepu do modulow/tabow,
- spina `Sidebar`, `Topbar`, mobilna nawigacje,
- utrzymuje stan "czy sidebar ma byc zwinięty".

### 2.2 Store UI i sesja
- `src/lib/store/ui.ts`

Store (Zustand + persist):
- `user` i `role`,
- `activeWarehouse` (aktywny modul),
- `rememberMe` i wybor storage (local/session),
- podstawowe filtry UI.

To jest centralne miejsce, jesli trzeba zmienic zachowanie sesji lub sposob persystencji.

### 2.3 Kontrakty i klient API
- Typy DTO: `src/lib/api/types.ts`
- Klient API: `src/lib/api/index.ts`

Zasada:
- UI nie robi zapytan SQL bezposrednio.
- UI woła funkcje z `src/lib/api/index.ts`.
- Klient API uderza w `POST /api/app` z `action`.

### 2.4 Backend API
- Glowny endpoint domenowy: `src/app/api/app/route.ts`
- Auth login: `src/app/api/auth/login/route.ts`
- Uzytkownicy admin: `src/app/api/users/route.ts`, `src/app/api/users/[id]/route.ts`
- Klient Supabase service-role: `src/lib/supabase/admin.ts`

`src/app/api/app/route.ts` to serce logiki biznesowej:
- walidacja payloadow,
- odczyt i zapis do tabel Supabase,
- agregacje do dashboardu i raportow,
- operacje magazynowe.

### 2.5 Schemat i migracje DB
- Pelny setup: `supabase/setup_full.sql`
- Migracje punktowe: `supabase/migrate_catalogs.sql`, `supabase/migrate_raport_zmianowy.sql`

Najwazniejsze tabele:
- `warehouses`, `locations`, `materials`, `material_catalogs`,
- `daily_entries`, `daily_location_status`,
- `transfers`, `inventory_adjustments`,
- `mixed_materials`, `dryers`,
- `spare_parts`, `spare_part_history`,
- `original_inventory_entries`, `original_inventory_catalog`,
- `raport_zmianowy_sessions`, `raport_zmianowy_items`, `raport_zmianowy_entries`,
- `audit_logs`.

## 3. Mapa folderow frontendu

### 3.1 Moduly w `src/app/(main)`
- `dashboard/` - KPI i wykresy dla przemialow.
- `spis/` - spis per magazyn/lokacja.
- `spis-oryginalow/` - ewidencja oryginalow.
- `przesuniecia/` - transfery miedzy lokacjami.
- `raporty/` - raport dzienny/okresowy/roczny.
- `kartoteka/` - stany magazynowe po przemialach i kartotekach.
- `suszarki/` - przypisania tworzyw do suszarek.
- `wymieszane/` - stany i transfery mieszanek.
- `czesci/` - modul czesci zamiennych (podstrony: `stany`, `historia`, `pobierz`, `uzupelnij`).
- `raport-zmianowy/` - import planu i praca zmianowa.
- `admin/` - zarzadzanie slownikami, uzytkownikami, inwentaryzacja, rejestr dzialan.

### 3.2 Wspolne komponenty
- Layout: `src/components/layout/*` (`Sidebar`, `Topbar`, `PageHeader`)
- UI atoms/molecules: `src/components/ui/*` (`DataTable`, `Card`, `Tabs`, `Input`, `Button`, `Toast`, itd.)

## 4. Jak idzie dane (end-to-end)

Przyklad: zapis przesuniecia:
1. Formularz w `src/app/(main)/przesuniecia/page.tsx`.
2. Wywolanie `addTransfer(...)` z `src/lib/api/index.ts`.
3. `POST /api/app` z `action: "addTransfer"`.
4. `case 'addTransfer'` w `src/app/api/app/route.ts`.
5. Zapis do `transfers` + ewentualne korekty dziennych stanow.
6. UI invaliduje query (`react-query`) i odswieza liste.

Ta sama zasada dotyczy pozostalych akcji (`upsertEntry`, raporty, czesci, suszarki itd.).

## 5. Lista akcji backendu (`/api/app`)

Plik: `src/app/api/app/route.ts` zawiera m.in.:
- Dashboard/statystyki: `getDashboard`, `getReports`, `getTotalsHistory`, `getMonthlyDelta`, `getMonthlyMaterialBreakdown`, `getDailyHistory`, `getPeriodReport`, `getYearlyReport`, `getTopCatalogTotal`.
- Spis i lokacje: `getLocationsOverview`, `getLocationDetail`, `upsertEntry`, `confirmNoChangeEntry`, `confirmNoChangeLocation`.
- Kartoteki/materialy: `getCatalog`, `getCatalogs`, `addCatalog`, `addMaterial`, `addMaterialBulk`, `updateMaterial`, `updateMaterialCatalog`, `removeMaterial`, `removeCatalog`.
- Magazyny/lokacje admin: `addWarehouse`, `updateWarehouse`, `removeWarehouse`, `addLocation`, `updateLocation`, `removeLocation`, `getLocationsAdmin`.
- Audyt/rejestr: `getAudit`.
- Przesuniecia/inwentaryzacja: `getTransfers`, `addTransfer`, `getInventoryAdjustments`, `applyInventoryAdjustment`.
- Wymieszane: `getMixedMaterials`, `addMixedMaterial`, `removeMixedMaterial`, `deleteMixedMaterial`, `transferMixedMaterial`.
- Suszarki: `getDryers`, `addDryer`, `updateDryer`, `removeDryer`, `setDryerMaterial`.
- Czesci i historia: `getSpareParts`, `getSparePartHistory`, `addSparePart`, `updateSparePart`, `removeSparePart`, `setSparePartQty`, `adjustSparePart`.
- Spis oryginalow: `getOriginalInventory`, `getOriginalInventoryCatalog`, `addOriginalInventory`, `addOriginalInventoryCatalog`, `addOriginalInventoryCatalogBulk`, `updateOriginalInventory`, `removeOriginalInventory`, `removeOriginalInventoryCatalog`.
- Raport zmianowy: `getRaportZmianowySessions`, `getRaportZmianowySession`, `getRaportZmianowyEntries`, `createRaportZmianowySession`, `removeRaportZmianowySession`, `addRaportZmianowyItem`, `updateRaportZmianowyItem`, `addRaportZmianowyEntry`, `updateRaportZmianowyEntry`, `removeRaportZmianowyEntry`.

## 6. Jak bezpiecznie edytowac

### 6.1 Gdzie edytowac co
- Zmiana UI tylko wizualna: `src/app/(main)/*/page.tsx` + `src/components/ui/*`.
- Zmiana kontraktu request/response: najpierw `src/lib/api/types.ts`, potem `src/lib/api/index.ts`, na koncu `src/app/api/app/route.ts`.
- Zmiana danych w DB: SQL w `supabase/*.sql` + dopasowanie `route.ts`.

### 6.2 Kolejnosc zmian
1. Typy (`types.ts`).
2. Klient API (`index.ts`).
3. Backend (`route.ts`).
4. Frontend (`page.tsx`).
5. Lint/test/build.

### 6.3 Najczestsze pułapki
- Rozjechanie nazw `action` miedzy frontendem i backendem.
- Aktualizacja tylko UI bez invalidacji query (stare dane na ekranie).
- Brak uwzglednienia `activeWarehouse` i uprawnien przy nowych trasach/tabach.
- Dodanie nowej tabeli bez indeksow i bez RLS.

## 7. Co zostalo zoptymalizowane w tym przegladzie

### 7.1 Usuniete rzeczy zbedne
- Martwa zmienna `ready` w dashboardzie:
  - `src/app/(main)/dashboard/page.tsx`
- Nieuzywany import typu:
  - `src/lib/api/index.ts` (`MaterialReportRow`)
- Nieuzywane importy w sidebarze:
  - `src/components/layout/Sidebar.tsx`

### 7.2 Usprawnienia pod lint i stabilnosc
- Stabilizacja localStorage/tab state (bez zbędnych efektow ustawiajacych stan) w kilku ekranach.
- Refaktor helperow dat na poziom modulu w raportach:
  - `src/app/(main)/raporty/page.tsx`
- Poprawa memo zaleznosci katalogu:
  - `src/app/(main)/spis/[warehouseId]/lokacja/[locationId]/page.tsx`

### 7.3 Frontend performance hygiene
- Zamiana `<img>` na `next/image` w miejscach krytykowanych przez ESLint:
  - `src/app/login/page.tsx`
  - `src/app/magazyny/page.tsx`
  - `src/components/layout/Sidebar.tsx`

## 8. Status jakosci po zmianach
- `npm run lint`: bez warningow i bez errorow.
- `npm run build`: fail przez brak dostepu do Google Fonts (`Space Grotesk`) w srodowisku bez internetu, nie przez logike aplikacji.
