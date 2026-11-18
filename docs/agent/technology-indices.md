# Normalizacja Indeksow Technologii

Zaleznosc [planowania](<planning.md>): jednorazowe uporzadkowanie zapisanej biblioteki, nie nowy matcher ani automatyczna migracja przy odczycie/zapisie aplikacji.

| Temat | Plik | Kotwice |
| --- | --- | --- |
| Jawne pary i kolizje | [logika](<../../src/lib/planowanie-zapotrzebowania/technologyMaterialIndices.ts>) | `buildTechnologyIndexCatalog`, `normalizeTechnologyMaterialIndices` |
| Preview/zapis/cofniecie | [CLI](<../../scripts/normalize-technology-material-indices.mjs>) | `planTechnologyIndexMigration`, `applyTechnologyIndexMigration`, `rollbackTechnologyIndexMigration` |

- Uruchamiaj z repo przez Node z `--experimental-strip-types`. Skrypt domyslnie tworzy tylko preview. Zapis wymaga `--apply <preview.json>`; cofniecie `--rollback <backup.json>`. Uzywa istniejacego RPC `save_material_planning_state`, bez nowego SQL.
- Rejestr dwoch kolumn jest nadrzedny wobec starych aliasow katalogu. Bez zgadywania po nazwie, sufiksie, magazynie i bez usuwania zer. Nazwa moze rozstrzygac tylko wsrod kartotek znalezionych po kodzie. Kolizja celu z innym indeksem 1/2 blokuje dana pozycje, bo grupowanie zapotrzebowania uzywa kodu/jednostki.
- Zakres: `main.technologies` (materials/surplusMaterials/emergencyMaterials/linkedProducts), takze warianty i zarchiwizowane. Naglowki/ID/zuzycia/jednostki/normy/ilosci bez zmian. Link zachowuje dawny klucz w sourceKeys. Bez edycji workspace, spisu i dokumentow.
- Odcisk raportu, generacja katalogu i rewizja chronia przed uzyciem starego preview. Kopia biblioteki musi byc zapisana i odczytana przed jednym CAS; sprawdzany jest caly zapisany stan. Brak slepych ponowien po utracie odpowiedzi.
- Wypisany dokument, reczne issueQuantityOverrides lub zakonczony zwrot pod starym kodem blokuja operacje. Roboczy/nieaktualny dokument bez wypisanych wierszy pozostaje niezmieniony; mozna go potem przeliczyc. Wykonuj bez rownoleglych edycji planow/kartotek.
- Raporty/kopie sa tylko lokalnie w ignorowanym `.runtime/technology-index2` (dane firmy, nigdy public/git). Rollback wymaga niezmienionej biblioteki i zachowuje inne dane z biezacego main; nie nadpisuje pozniejszych edycji ani nowych wypisan.
- Testy: [pary/niezmiennosc](<../../src/lib/planowanie-zapotrzebowania/technologyMaterialIndices.test.mjs>), [preview/kopia/CAS/rollback](<../../src/lib/planowanie-zapotrzebowania/technologyMaterialIndicesMigration.test.mjs>). Przy zmianie kontraktu takze [domena](<../../src/lib/planowanie-zapotrzebowania/domain.test.mjs>), [zakresy](<../../src/lib/planowanie-zapotrzebowania/stateScopes.test.mjs>), [Excel](<../../src/lib/planowanie-zapotrzebowania/technologyLibraryExport.test.mjs>).
