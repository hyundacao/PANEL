# Panel planowania produkcji (wtryskownia + montaż + prace dodatkowe)

Data: 2026-02-07  
Status: dokument wdrożeniowy (MVP + architektura docelowa)

## 1. Cel i zakres

- Planowanie na poziomie operacji (nie tylko zleceń).
- Obsługa zależności technologicznych i półwyrobów (łańcuch operacji bez "rwanej" produkcji).
- Horyzont planowania: 7 dni.
- Obszary: wtryskownia, montaż, prace dodatkowe.
- Integracja zdarzeń hali przez TIG MES API (TIG jako źródło prawdy dla eventów wykonawczych).

Zakres poza MVP (etap późniejszy): pełna automatyczna optymalizacja bez udziału planisty.

## 2. Założenia operacyjne i kalendarz

- Zmiany: `07:00-15:00`, `15:00-23:00`, `23:00-07:00`.
- Docelowa publikacja planu bazowego: `08:00`.
- Weekend: plan z piątku obowiązuje do końca 3 zmiany niedzielnej.
- Plan bazowy służy rozliczeniom i KPI; plan wykonawczy jest korygowany na bieżąco, ale zmiany wymagają akceptacji planisty.

## 3. Model planu (3 warstwy)

### 3.1 Plan bazowy

- Powstaje po imporcie i zatwierdzeniu planisty.
- Jest niezmienny historycznie (wersjonowany), stanowi punkt odniesienia dla KPI.

### 3.2 Plan wykonawczy

- Aktualizowany zdarzeniami z hali (TIG), awariami, odchyłkami wydajności.
- System wylicza propozycje zmian, ale nie przepina automatycznie bez decyzji planisty.

### 3.3 Prognoza

- Liczona ciągle na podstawie: `plan_do_tej_chwili` vs `wykonanie_do_tej_chwili`.
- Uwzględnia realną lukę ilościową i bieżącą wydajność segmentową.

## 4. Reguły planowania

### 4.1 Ograniczenia twarde (hard constraints)

- Termin klienta (deadline) jako nadrzędny warunek wykonalności.
- Kompatybilność `forma -> maszyna` (tylko dozwolona pula).
- Zależności operacji (DAG): poprzednik musi dostarczyć wymagany półwyrób.
- Dostępność krytycznych materiałów i komponentów (tworzywo, barwnik, montaż, opakowania, etykiety).

### 4.2 Koszty miękkie (soft constraints / kary)

- Wysoka kara za trudne przejścia kolorów (np. czarny -> biały).
- Kara za ponowne wieszanie tej samej formy w tym samym dniu.
- Kara za kumulację przezbrojeń w krótkim oknie czasu.
- Premia za przeniesienie formy na alternatywną maszynę, jeśli minimalizuje łączny koszt (czas + ryzyko terminu + jakość).

### 4.3 Przezbrojenia

- Definicja czasu przezbrojenia: od "ostatniej dobrej sztuki" poprzedniego zlecenia do "pierwszej dobrej sztuki" nowego.
- Typy przezbrojeń: forma / kolor / tworzywo.
- Limit `6` przezbrojeń na zmianę = alert (nie blokada).
- Rozkład przezbrojeń preferowany równomiernie (heurystyka celu: okolice co 3h, zamiast klastrów naraz).

## 5. Prognoza wydajności i odchyłki

### 5.1 Zdarzenia wejściowe

- Operator raportuje po każdej pełnej, spakowanej palecie.
- TIG dostarcza statusy maszyn i powody przestojów.

### 5.2 Logika prognozy

- Dla każdej operacji liczony jest:
  - `qty_plan_to_now`
  - `qty_actual_to_now`
  - `gap_qty = qty_plan_to_now - qty_actual_to_now`
  - `eta_finish_exec` na bazie aktualnej wydajności segmentu.
- Jednorazowy słaby odcinek nie obniża trwale całego zlecenia: wydajność liczona oknami czasowymi (np. rolling 60-120 min), nie jedną średnią globalną.
- Jeżeli kolejna zmiana wraca do normy, system redukuje opóźnienie tylko o realnie odrobioną lukę ilościową.

## 6. Awarie i wpływ na łańcuch operacji

- Awarie są pierwszorzędnym eventem na osi Gantt.
- Priorytetowe zdarzenia: awarie godzinowo-dniowe forma/wtryskarka.
- Każda awaria aktualizuje:
  - plan wykonawczy,
  - ETA operacji,
  - ryzyko niedotrzymania terminu klienta,
  - ryzyko blokady operacji zależnych.
- System prezentuje wpływ kaskadowy (operacja źródłowa -> półwyrób -> operacje następcze).

## 7. Alerty (exception-based)

Alert musi zawierać: poziom ważności, przyczynę, wpływ biznesowy, proponowaną akcję planisty.

Kluczowe alerty:

- ryzyko terminu klienta,
- przekroczenie przezbrojeń/zmianę,
- konflikt kumulacji przezbrojeń,
- brak półwyrobu lub materiału,
- wpływ awarii na ścieżkę krytyczną.

## 8. Model danych (Supabase/Postgres)

Poniżej model docelowy kompatybilny ze stylem obecnego projektu (`src/app/api/app/route.ts`, action-based API).

### 8.1 Słowniki i zasoby

- `machines`
  - `id`, `code`, `name`, `tonnage`, `is_active`
- `molds`
  - `id`, `code`, `name`, `is_active`
- `mold_machine_compat`
  - `id`, `mold_id`, `machine_id`, `priority`, `is_allowed`
- `materials_catalog`
  - `id`, `type` (`polymer|colorant|component|packaging|label`), `code`, `name`

### 8.2 Zlecenia i operacje

- `production_orders`
  - `id`, `order_no`, `customer`, `due_at`, `priority`, `status`
- `production_operations`
  - `id`, `order_id`, `op_no`, `work_center_type` (`injection|assembly|additional`),
  - `target_qty`, `uom`, `std_rate_per_hour`,
  - `mold_id`, `material_id`, `color_code`,
  - `planned_start_base`, `planned_end_base`
- `operation_dependencies`
  - `id`, `predecessor_op_id`, `successor_op_id`, `min_transfer_qty`

### 8.3 Plany i wersjonowanie

- `plan_versions`
  - `id`, `horizon_from`, `horizon_to`, `kind` (`base|exec|scenario`),
  - `status` (`draft|published|archived`), `published_at`, `published_by`, `parent_plan_id`
- `plan_operations`
  - `id`, `plan_id`, `operation_id`, `machine_id`,
  - `start_at`, `end_at`, `seq_no`, `frozen`, `source` (`manual|suggested|imported`)

### 8.4 Zdarzenia wykonawcze i awarie

- `shopfloor_events`
  - `id`, `external_event_id` (unikalny), `source` (`TIG`), `event_type`,
  - `machine_id`, `mold_id`, `operation_id`, `started_at`, `ended_at`,
  - `payload_json`, `ingested_at`
- `operation_progress`
  - `id`, `operation_id`, `reported_at`, `good_qty`, `scrap_qty`, `pallet_no`, `operator_id`
- `setups`
  - `id`, `machine_id`, `operation_from_id`, `operation_to_id`,
  - `setup_type` (`mold|color|material`),
  - `last_good_at`, `first_good_at`, `duration_min`

### 8.5 Gotowość i alerty

- `material_readiness`
  - `id`, `operation_id`, `polymer_ok`, `colorant_ok`, `components_ok`, `packaging_ok`, `labels_ok`,
  - `workstation_ready`, `semifinished_reserved`, `checked_at`, `checked_by`
- `planning_alerts`
  - `id`, `plan_id`, `severity`, `alert_type`, `title`, `details`,
  - `operation_id`, `machine_id`, `due_at`, `status` (`open|ack|resolved`),
  - `suggested_action`, `resolved_by`, `resolved_at`

### 8.6 Audyt i decyzje

- `planning_decisions`
  - `id`, `plan_id`, `decision_type`, `reason`, `payload_before`, `payload_after`,
  - `approved_by`, `approved_at`
- `audit_log_planning`
  - `id`, `entity`, `entity_id`, `action`, `who`, `when_at`, `why`, `diff_json`

## 9. Integracja z TIG MES API (kierunek docelowy)

### 9.1 Minimalny kontrakt wejściowy

- Identyfikacja zdarzenia: `event_id` (idempotencja).
- Czas: `event_time` + jawna strefa (`Europe/Warsaw`) lub UTC + offset.
- Typ zdarzenia: `machine_status`, `downtime_start`, `downtime_end`, `good_count`, `scrap_count`, `setup_start`, `setup_end`.
- Powiązania: `machine_code`, opcjonalnie `mold_code`, `order_no`, `operation_ref`.
- Paginacja: cursor lub monotoniczny `event_id`.

### 9.2 Synchronizacja

- Tryb MVP: polling co 1-5 min + checkpoint kursora w DB.
- Docelowo: webhook/stream, jeśli TIG umożliwia.
- Retry z backoff i deduplikacja po `external_event_id`.

## 10. Ekrany aplikacji

1. `Plan Board (7 dni)`
- Gantt dla maszyn i operacji, warstwa base/exec/prognoza, widok awarii i przezbrojeń.

2. `Szczegóły operacji`
- KPI operacji, zależności, postęp paletowy, historia eventów, brakująca gotowość materiałowa.

3. `Centrum alertów`
- Kolejka exception-based z akcjami: "przenieś", "przesuń", "zaakceptuj ryzyko", "eskaluj".

4. `Publikacja i freeze`
- Publikacja planu bazowego (08:00), wersjonowanie, blokady zmian i workflow akceptacji.

5. `What-if scenariusze`
- Duplikacja planu, symulacja zmian (awaria, przeniesienie formy, zmiana sekwencji), porównanie KPI wariantów.

6. `Kompatybilność forma -> maszyna`
- Edycja puli dozwolonych maszyn, priorytety i walidacja spójności.

7. `Gotowość realizacji`
- Checklista kompletności materiałowej i stanowiskowej przed startem operacji.

8. `KPI i audit`
- Terminowość, zgodność planu, koszt przezbrojeń, wpływ awarii, brakowość, historia decyzji.

## 11. MVP w etapach

### Etap 1 (MVP Core)

- Model danych: zasoby, operacje, zależności, base/exec plan, setupy, alerty.
- Board 7-dniowy + ręczne decyzje planisty.
- Hard constraints: termin, kompatybilność forma->maszyna, zależności.
- Alerty: termin, przezbrojenia, braki materiałowe.

Kryterium akceptacji:
- Planista publikuje plan bazowy i prowadzi plan wykonawczy bez arkuszy zewnętrznych.

### Etap 2 (MVP+ TIG + prognoza)

- Integracja TIG (polling + cursor + idempotencja).
- Automatyczna prognoza "na teraz" i odchyłki segmentowe.
- Awarie na Gantt + kaskadowy wpływ na termin.

Kryterium akceptacji:
- Opóźnienie i ETA aktualizują się automatycznie po eventach hali.

### Etap 3 (Pro)

- What-if i porównanie scenariuszy.
- Workflow zatwierdzeń, pełny audit log.
- KPI przekrojowe i raportowanie zarządcze.

Kryterium akceptacji:
- Decyzje planistyczne są mierzalne, porównywalne i audytowalne.

## 12. Otwarte decyzje do domknięcia (z rekomendacją)

1. Reguła "co 3h przezbrojenie"  
Rekomendacja: liczona per maszyna (z dodatkowym alertem globalnym hali).

2. Tryb publikacji 07:00-08:00 vs 08:00  
Rekomendacja: plan bazowy publikowany o 08:00; 07:00-08:00 jedzie na "mostku" z planu poprzedniego dnia, automatycznie oznaczonym jako `bridge_window`.

3. Szczegóły API TIG (auth, endpointy, cursor, strefa czasu)  
Rekomendacja: formalny "API contract sheet" przed implementacją Etapu 2.

4. Zakres automatyki po awarii  
Rekomendacja: system tylko proponuje replan, każda zmiana krytyczna (`deadline impact`, `machine swap`, `sequence break`) wymaga twardej akceptacji planisty.

## 13. Mapowanie do istniejącego kodu w repo

- Frontend: nowy moduł obok `src/app/(main)/raport-zmianowy/page.tsx` (ten sam wzorzec tabs + React Query).
- API: rozszerzenie action-handlera w `src/app/api/app/route.ts` (spójnie z obecnym stylem `appRequest('action', payload)`).
- Typy: nowe kontrakty w `src/lib/api/types.ts` i wrappery w `src/lib/api/index.ts`.
- DB: nowa migracja SQL w `supabase/`.

## 14. Najbliższe kroki implementacyjne

1. Dodać migrację `supabase/migrate_production_planning.sql` (tabele z sekcji 8).
2. Dodać typy i endpointy API dla planu, operacji, alertów, event ingest.
3. Zbudować ekran `Plan Board` (read/write) i `Centrum alertów`.
4. Wpiąć synchronizator TIG (polling + cursor).
5. Domknąć 4 decyzje otwarte i ustawić politykę freeze/publikacji.
