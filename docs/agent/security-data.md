# Bezpieczenstwo I Infrastruktura

## Punkty Wejscia

| Temat | Plik | Kotwice |
| --- | --- | --- |
| Cookie/sesja i uprawnienia | [session](<../../src/lib/auth/session.ts>) / [access](<../../src/lib/auth/access.ts>) | |
| Origin, chronione trasy | [proxy](<../../src/proxy.ts>) | |
| Hasla i limity logowania | [password](<../../src/lib/auth/password.ts>) / [rate-limit](<../../src/lib/auth/rate-limit.ts>) / [shared-rate-limit](<../../src/lib/auth/shared-rate-limit.ts>) | |
| Limity importu / arkuszy | [import-limits](<../../src/lib/security/import-limits.ts>) / [spreadsheetLimits](<../../src/lib/utils/spreadsheetLimits.ts>) | |
| Operacje domenowe i serwerowe ACL | [api/app](<../../src/app/api/app/route.ts>) | `ensureActionAccess`, `handleAction` |
| Supabase serwera | [admin](<../../src/lib/supabase/admin.ts>) / [users](<../../src/lib/supabase/users.ts>) / [permission-groups](<../../src/lib/supabase/permission-groups.ts>) | |

## Trasy I Powierzchnie

- Start/sesja UI: [root page](<../../src/app/page.tsx>), [root layout](<../../src/app/layout.tsx>), [providers](<../../src/app/providers.tsx>), [login](<../../src/app/login/page.tsx>), [wybor modulu](<../../src/app/magazyny/page.tsx>), [main layout](<../../src/app/(main)/layout.tsx>).
- API auth: [login](<../../src/app/api/auth/login/route.ts>), [session](<../../src/app/api/auth/session/route.ts>), [logout](<../../src/app/api/auth/logout/route.ts>), [password](<../../src/app/api/auth/password/route.ts>).
- Admin: [page](<../../src/app/(main)/admin/page.tsx>), [layout](<../../src/app/(main)/admin/layout.tsx>), [workspace](<../../src/components/admin/AdministrationWorkspace.tsx>).
- Uzytkownicy: [lista](<../../src/app/api/users/route.ts>), [konto](<../../src/app/api/users/[id]/route.ts>), [reset](<../../src/app/api/users/[id]/reset-password/route.ts>).
- Grupy dostepu: [lista](<../../src/app/api/permission-groups/route.ts>), [grupa](<../../src/app/api/permission-groups/[id]/route.ts>).
- Push: [subscribe](<../../src/app/api/push/subscribe/route.ts>), [unsubscribe](<../../src/app/api/push/unsubscribe/route.ts>), [status](<../../src/app/api/push/status/route.ts>), [helpery](<../../src/lib/push/server.ts>).
- Globalne UI: [Sidebar](<../../src/components/layout/Sidebar.tsx>), [Topbar](<../../src/components/layout/Topbar.tsx>), [PageHeader](<../../src/components/layout/PageHeader.tsx>), [store](<../../src/lib/store/ui.ts>), [DataTable](<../../src/components/ui/DataTable.tsx>), [Select](<../../src/components/ui/Select.tsx>), [Input](<../../src/components/ui/Input.tsx>), [Button](<../../src/components/ui/Button.tsx>).

## Reguly

- Uprawnienia sprawdzaj na serwerze, nie tylko w przycisku/layout. Sprawdz role HEAD_ADMIN, zwyklego autora, obcego autora i konto read-only dla danego modulu.
- Service-role nie trafia do klienta/logow/dokumentacji. Nie odczytuj ani nie drukuj `.env` dla zwyklej zmiany UI.
- Dla logowania/Origin petle lokalne i produkcyjny adres maja rozne warunki. Nie oslabiaj ochrony produkcji dla naprawy localhost.
- Wspolny komponent UI -> wszystkie jego uzycia. `SelectField` jest Radix, nie zwyklym HTML select; test przegladarki wybiera opcje przez combobox/listbox.
- Stan lokalny Zustand nie zastepuje autoryzacji sesji serwera. Stan zapisu planu jest opisany na [karcie planowania](<planning.md>).

## SQL I Wdrozenie

- Wejscie: [supabase/CZYTAJ_NAJPIERW](<../../supabase/CZYTAJ_NAJPIERW.md>). Nie uruchamiaj plikow historycznych ani calej instalacji dla poprawki jednego parametru.
- Moduly: [01](<../../supabase/01_konta_i_uprawnienia.sql>), [02](<../../supabase/02_magazyn_przemialow.sql>), [03](<../../supabase/03_przesuniecia_erp.sql>), [04](<../../supabase/04_spis_rzeczywisty_i_stany_erp.sql>), [05](<../../supabase/05_farby_i_tasmy.sql>), [06](<../../supabase/06_przygotowanie_produkcji.sql>), [07](<../../supabase/07_planowanie_zapotrzebowania.sql>), [08](<../../supabase/08_raporty.sql>), [09](<../../supabase/09_powiadomienia.sql>), [10](<../../supabase/10_zabezpieczenia.sql>), [11](<../../supabase/11_indeksy_kartotek.sql>).
- `IF NOT EXISTS` nie aktualizuje istniejacej definicji. Istnienie pliku nie potwierdza wykonania SQL w bazie.
- Kod lokalny, wdrozony frontend/backend i zapisane dane to oddzielne stany. Zmiana wspolnej bazy moze byc widoczna online bez wdrozenia kodu; zmiana UI nie.
- Zapis produkcyjny: potwierdz zakres, kopie i rewizje; wykonaj odczyt po zapisie. Dokumentacja nie jest zgoda na czyszczenie ani migracje danych.

## Testy

- [security](<../../src/lib/security/security.test.mjs>), [adminAccess](<../../src/lib/auth/adminAccess.test.mjs>), [securitySql](<../../src/lib/security/securitySql.test.mjs>), [sqlModules](<../../src/lib/utils/sqlModules.test.mjs>), [sqlFiles](<../../src/lib/utils/sqlFiles.test.mjs>).
- Runner: [scripts/run-tests](<../../scripts/run-tests.mjs>). Pelna instrukcja: [TESTOWANIE](<../../TESTOWANIE.md>).
