import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allocateAmountByDemand,
  calculateIssueBalance,
  calculateScopedQuantity,
  coalesceQuantityCorrection,
  correctedQuantity,
  diffPlanItems,
  latestPlanVersion,
  nextPlanVersionNumber,
  setRemainingQuantity
} from './domain.ts';

const item = (patch = {}) => ({
  id: patch.id ?? 'plan-1',
  index: patch.index ?? 'A-100',
  name: patch.name ?? 'Detal testowy',
  station: patch.station ?? 'WTR 1',
  totalQty: patch.totalQty ?? 3000,
  remainingQty: patch.remainingQty ?? patch.totalQty ?? 3000,
  shiftNorm: patch.shiftNorm ?? 1000,
  planGroup: patch.planGroup ?? 'standard',
  plannedDate: patch.plannedDate ?? ''
});

test('liczy zakres 3,5 oraz cały pozostały plan', () => {
  assert.equal(calculateScopedQuantity(7000, 1000, { mode: 'shifts', shifts: 3.5 }), 3500);
  assert.equal(calculateScopedQuantity(3000, 1000, { mode: 'shifts', shifts: 3.5 }), 3000);
  assert.equal(calculateScopedQuantity(7000, 1000, { mode: 'all' }), 7000);
  assert.equal(calculateScopedQuantity(7000, 1000, { mode: 'quantity', quantity: 500 }), 500);
});

test('kolejne importy tej samej daty dostają rosnące numery', () => {
  const versions = [
    { planDate: '2026-08-27', versionNo: 1 },
    { planDate: '2026-08-27', versionNo: 2 },
    { planDate: '2026-08-28', versionNo: 1 }
  ];
  assert.equal(nextPlanVersionNumber(versions, '2026-08-27'), 3);
  assert.equal(nextPlanVersionNumber(versions, '2026-08-29'), 1);
});

test('wykrywa zwiększenie 3000 -> 7000, stanowisko i normę', () => {
  const changes = diffPlanItems(
    [item()],
    [item({ totalQty: 7000, station: 'WTR 2', shiftNorm: 1200 })]
  );
  assert.deepEqual(changes.map((change) => change.kind), [
    'quantity_increased',
    'station_changed',
    'norm_changed'
  ]);
  assert.equal(changes[0].difference, 4000);
});

test('wykrywa nowy i usunięty indeks', () => {
  const changes = diffPlanItems(
    [item({ id: 'old', index: 'OLD' })],
    [item({ id: 'new', index: 'NEW' })]
  );
  assert.deepEqual(new Set(changes.map((change) => change.kind)), new Set(['new', 'removed']));
});

test('planowana zmiana form jest porównywana niezależnie od planu bieżącego', () => {
  const changes = diffPlanItems(
    [item({ id: 'standard', planGroup: 'standard' })],
    [item({ id: 'planned', planGroup: 'planned' })]
  );
  assert.deepEqual(new Set(changes.map((change) => change.kind)), new Set(['new', 'removed']));
});

test('ręczne +200, -200 i wartość dokładna nie schodzą poniżej zera', () => {
  assert.equal(correctedQuantity(3000, 'increase', 200), 3200);
  assert.equal(correctedQuantity(3000, 'decrease', 200), 2800);
  assert.equal(correctedQuantity(100, 'decrease', 200), 0);
  assert.equal(correctedQuantity(100, 'exact', 7000), 7000);
});

test('bieżąca wersja wynika z numeru i dnia, a nie dawnego ręcznego statusu', () => {
  const versions = [
    { id: 'old', planDate: '2026-08-31', versionNo: 1, status: 'active' },
    { id: 'tomorrow', planDate: '2026-09-01', versionNo: 1, status: 'draft' },
    { id: 'latest', planDate: '2026-08-31', versionNo: 3, status: 'superseded' },
    { id: 'middle', planDate: '2026-08-31', versionNo: 2, status: 'ready' }
  ];
  const before = JSON.stringify(versions);
  assert.equal(latestPlanVersion(versions, '2026-08-31')?.id, 'latest');
  assert.equal(latestPlanVersion(versions, '2026-09-01')?.id, 'tomorrow');
  assert.equal(latestPlanVersion(versions, '2026-09-02'), undefined);
  assert.equal(latestPlanVersion([], '2026-08-31'), undefined);
  assert.equal(JSON.stringify(versions), before);
});

test('bezpośrednia zmiana 90 na 120 przelicza ilość i zapotrzebowanie', () => {
  const original = { ...item({ totalQty: 90, shiftNorm: 380 }), sourceQuantity: '90', scopeMode: 'global' };
  const updated = setRemainingQuantity(original, 120);
  assert.equal(updated.totalQty, 120);
  assert.equal(updated.remainingQty, 120);
  assert.equal(calculateScopedQuantity(updated.remainingQty, updated.shiftNorm, { mode: 'shifts', shifts: 3.5 }), 120);
  assert.equal(updated.remainingQty * 0.25, 30);
  assert.equal(updated.sourceQuantity, '90');
  assert.equal(original.totalQty, 90);
});

test('edycja ilości do zrobienia zachowuje sztuki wykonane wcześniej', () => {
  const updated = setRemainingQuantity(item({ totalQty: 300, remainingQty: 90 }), 120);
  assert.equal(updated.remainingQty, 120);
  assert.equal(updated.totalQty, 330);
  assert.equal(updated.totalQty - updated.remainingQty, 210);
  const finished = setRemainingQuantity(updated, 0);
  assert.equal(finished.totalQty, 210);
  assert.equal(calculateScopedQuantity(finished.remainingQty, 380, { mode: 'all' }), 0);
  assert.equal(calculateScopedQuantity(finished.remainingQty, 380, { mode: 'shifts', shifts: 3.5 }), 0);
});

test('jedna sesja wpisywania daje jedną korektę 90 na 120 i zachowuje podstawę cofnięcia', () => {
  let current = item({ totalQty: 90 });
  let corrections = [];
  for (const quantity of [1, 12, 120]) {
    const next = setRemainingQuantity(current, quantity);
    corrections = coalesceQuantityCorrection(corrections, {
      id: 'edit-1', previousValue: current.totalQty, newValue: next.totalQty,
      difference: next.totalQty - current.totalQty
    });
    current = next;
  }
  assert.deepEqual(corrections, [{ id: 'edit-1', previousValue: 90, newValue: 120, difference: 30 }]);
  corrections = coalesceQuantityCorrection(corrections, {
    id: 'edit-2', previousValue: 120, newValue: 200, difference: 80
  });
  assert.equal(corrections.length, 2);
  assert.equal(corrections[1].previousValue, 90);
  const reverted = setRemainingQuantity(current, corrections[1].previousValue);
  assert.equal(reverted.remainingQty, 90);
});

test('potwierdzenie brakującej ilości jako zero pozostaje w historii', () => {
  const corrections = coalesceQuantityCorrection([], {
    id: 'edit-zero', previousValue: 0, newValue: 0, difference: 0, previousQuantityStatus: 'missing'
  });
  assert.equal(corrections.length, 1);
  assert.equal(corrections[0].newValue, 0);
  assert.equal(corrections[0].previousQuantityStatus, 'missing');
});

test('edycja normy zmienia zakres zmian, ale nie ilość całej produkcji', () => {
  assert.equal(calculateScopedQuantity(3000, 380, { mode: 'shifts', shifts: 3.5 }), 1330);
  assert.equal(calculateScopedQuantity(3000, 500, { mode: 'shifts', shifts: 3.5 }), 1750);
  assert.equal(calculateScopedQuantity(3000, 0, { mode: 'shifts', shifts: 3.5 }), 0);
  assert.equal(calculateScopedQuantity(3000, 0, { mode: 'all' }), 3000);
});

test('wydanie uwzględnia stan, wydane i oczekujące bez wartości ujemnych', () => {
  assert.deepEqual(calculateIssueBalance({
    demand: 700,
    areaStock: 100,
    sharedCoverage: 50,
    issued: 300,
    pending: 100
  }), {
    openDemand: 300,
    toIssue: 150,
    shortage: 150,
    surplus: 0
  });
  assert.equal(calculateIssueBalance({
    demand: 100,
    areaStock: 200,
    sharedCoverage: 0,
    issued: 300,
    pending: 0
  }).toIssue, 0);
});

test('korekta po wzroście 3000 -> 7000 wydaje wyłącznie brakujące 4000', () => {
  const balance = calculateIssueBalance({
    demand: 7000,
    areaStock: 0,
    sharedCoverage: 0,
    issued: 3000,
    pending: 0
  });
  assert.equal(balance.toIssue, 4000);
  assert.equal(balance.surplus, 0);
});

test('zmniejszenie po wcześniejszym wydaniu nie tworzy ujemnego dokumentu', () => {
  const balance = calculateIssueBalance({
    demand: 2000,
    areaStock: 0,
    sharedCoverage: 0,
    issued: 3000,
    pending: 0
  });
  assert.equal(balance.toIssue, 0);
});

test('agregowane wydanie jest rozdzielane proporcjonalnie na indeksy źródłowe', () => {
  const allocation = allocateAmountByDemand(600, [
    { id: 'A', demand: 100 },
    { id: 'B', demand: 200 }
  ]);
  assert.deepEqual(allocation, [
    { id: 'A', demand: 100, allocated: 200 },
    { id: 'B', demand: 200, allocated: 400 }
  ]);
});
