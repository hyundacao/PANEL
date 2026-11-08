# Przygotowanie Produkcji

## Punkty Wejscia

| Temat | Plik | Kotwice |
| --- | --- | --- |
| Glowny ekran i import | [page](<../../src/app/(main)/przygotowanie-produkcji/page.tsx>) / [API](<../../src/app/api/przygotowanie-produkcji/route.ts>) | |
| Dzien produkcyjny / arkusz planu | [productionPlanDate](<../../src/lib/utils/productionPlanDate.ts>) / [productionPlanWorkbook](<../../src/lib/utils/productionPlanWorkbook.ts>) | |
| Cykl zycia, kolejny dzien, ponowne zadanie | [productionTaskLifecycle](<../../src/lib/utils/productionTaskLifecycle.ts>) | `resetProductionTaskForNewDay`, `shouldCarryProductionTask`, `appendProductionWorkEvent` |
| Cykliczne | [productionRecurringTasks](<../../src/lib/utils/productionRecurringTasks.ts>) / [RecurringTasksSettings](<../../src/components/production-preparation/RecurringTasksSettings.tsx>) | |
| Osobiste zadania | [API](<../../src/app/api/przygotowanie-produkcji/personal-tasks/route.ts>) / [helper](<../../src/lib/utils/productionPersonalTasks.ts>) / [panel](<../../src/components/production-preparation/PersonalTasksPanel.tsx>) | |
| Narzedziownia / powrot formy | [productionToolroomTasks](<../../src/lib/utils/productionToolroomTasks.ts>) | |
| Historia, postep i przywracanie | [productionWorkPlan](<../../src/lib/utils/productionWorkPlan.ts>) / [productionWorkProgress](<../../src/lib/utils/productionWorkProgress.ts>) / [productionWorkRestore](<../../src/lib/utils/productionWorkRestore.ts>) | |
| Komentarze zespolu / rozliczajacego | [productionTeamComments](<../../src/lib/utils/productionTeamComments.ts>) / [productionWorkComments](<../../src/lib/utils/productionWorkComments.ts>) / [ustawienia](<../../src/components/production-preparation/TeamCommentsSettings.tsx>) | |
| Technologia zadania: API i projekcja | [reference API](<../../src/app/api/przygotowanie-produkcji/reference/route.ts>) / [productionTaskReference](<../../src/lib/utils/productionTaskReference.ts>) / [TaskTechnologyPreview](<../../src/components/production-preparation/TaskTechnologyPreview.tsx>) | |
| Hala i wykresy | [TaskHallSelect](<../../src/components/production-preparation/TaskHallSelect.tsx>) / [ProductionReportCharts](<../../src/components/production-preparation/ProductionReportCharts.tsx>) | |

## Dane I Zaleznosci

- Glowny endpoint GET/POST obsluguje sesje i akcje zadan; osobiste zadania i podglad maja osobne endpointy. Nie przenos ich do `api/app` bez potrzeby.
- Tabele: `przygotowanie_produkcji_sessions`, `przygotowanie_produkcji_tasks`, `przygotowanie_produkcji_history`. [SQL 06](<../../supabase/06_przygotowanie_produkcji.sql>).
- Reguly dzienne, historia wykonania i zadania cykliczne to rozne rzeczy. Reset dnia nie moze usuwac historii ani wylaczac cyklicznych.
- Kolejki: `productionWorkQueueForTeam` daje pierwszenstwo otwartym zadaniom dodatkowym; wykonane zostaja na koncu. `processTasksByEngineer` korzysta z tej samej kolejnosci. To uklad widoku, nie zmiana dat, uprawnien ani zapisu zadan.
- Podglad -> `productionTaskReference` -> `material_planning_state`: wspolna biblioteka i opublikowane projekcje planow uzytkownikow. To rzeczywista zaleznosc od [planowania](<planning.md>), nie niezalezna kopia technologii.
- Zmiany przypisan technologii/haly w planowaniu sprawdz takze w `reference API`; zmiany komentarzy sprawdz w [uprawnieniach](<security-data.md>).

## Testy

- Dzien/import: [productionPlanWorkbook](<../../src/lib/utils/productionPlanWorkbook.test.mjs>), [productionPlanView](<../../src/lib/utils/productionPlanView.test.mjs>).
- Zadania: [productionTaskLifecycle](<../../src/lib/utils/productionTaskLifecycle.test.mjs>), [productionTaskPreparation](<../../src/lib/utils/productionTaskPreparation.test.mjs>), [productionPersonalTasks](<../../src/lib/utils/productionPersonalTasks.test.mjs>), [productionToolroomTasks](<../../src/lib/utils/productionToolroomTasks.test.mjs>).
- Kolejnosc zadan: [productionWorkQueue](<../../src/lib/utils/productionWorkQueue.test.mjs>) oraz `productionPlanView` dla kolumn inzynierow.
- Podglad: [productionTaskReference](<../../src/lib/utils/productionTaskReference.test.mjs>), [productionTechnologyPreview](<../../src/lib/utils/productionTechnologyPreview.test.mjs>).
- Historia/komentarze: [productionWorkHistoryList](<../../src/lib/utils/productionWorkHistoryList.test.mjs>), [productionWorkComments](<../../src/lib/utils/productionWorkComments.test.mjs>), [productionTeamComments](<../../src/lib/utils/productionTeamComments.test.mjs>).
