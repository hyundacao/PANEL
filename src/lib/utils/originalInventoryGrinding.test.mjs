import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPieceGrindingReservations, getPendingGrindingQuantities, grindingMaterialKey, groupGrindingTasksByMaterial, isPieceGrindingUnit } from './originalInventoryGrinding.ts';

const normalize = (name) => name.trim().toLowerCase();
const entry = (name, unit, availableQty, importedAt = '2026-09-17T07:00:00.000Z') => ({
  name, unit, availableQty, importedAt
});
const task = (name, unit, qty, status = 'PENDING', completedAt = null) => ({
  materialName: name, unit, qty, status,
  sourceReportDate: '2026-09-17', createdAt: '2026-09-17T08:00:00.000Z', completedAt
});

test('recognizes pieces but not thousand-piece units', () => {
  assert.equal(isPieceGrindingUnit('szt.'), true);
  assert.equal(isPieceGrindingUnit('szt'), true);
  assert.equal(isPieceGrindingUnit('1000szt.'), false);
  assert.equal(isPieceGrindingUnit('kg'), false);
});

test('shows repeated detail entries as one summed quantity without losing their ids', () => {
  const tasks = [
    { id: '1', materialName: 'DETAL A', unit: 'szt.', qty: 1 },
    { id: '2', materialName: 'detal a', unit: 'szt', qty: 1 },
    { id: '3', materialName: 'DETAL A', unit: 'szt.', qty: 1 },
    { id: '4', materialName: 'DETAL B', unit: 'szt.', qty: 2 },
    { id: '5', materialName: 'DETAL A', unit: 'kg', qty: 4 }
  ];
  const groups = groupGrindingTasksByMaterial(tasks, normalize);
  assert.deepEqual(groups.map((group) => [group.qty, group.tasks.map((item) => item.id)]), [
    [3, ['1', '2', '3']],
    [2, ['4']],
    [4, ['5']]
  ]);
  assert.deepEqual(tasks.map((item) => item.qty), [1, 1, 1, 2, 4]);
});

test('reserves only pieces and leaves the original ERP snapshot untouched', () => {
  const source = [entry('DETAL A', 'szt.', 500), entry('TWORZYWO', 'kg', 800)];
  const result = applyPieceGrindingReservations(source, [task('DETAL A', 'szt.', 300), task('TWORZYWO', 'kg', 200)], '2026-09-17', normalize);
  assert.equal(result[0].availableQty, 200);
  assert.equal(result[0].reservedGrindingQty, 300);
  assert.equal(result[1].availableQty, 800);
  assert.equal(source[0].availableQty, 500);
});

test('does not subtract the same reservation twice from duplicate ERP rows', () => {
  const rows = [entry('DETAL A', 'szt.', 200), entry('DETAL A', 'szt.', 300)];
  const result = applyPieceGrindingReservations(rows, [task('DETAL A', 'szt.', 100)], '2026-09-17', normalize);
  assert.equal(result.reduce((sum, row) => sum + row.availableQty, 0), 400);
  assert.equal(result.reduce((sum, row) => sum + row.reservedGrindingQty, 0), 100);
});

test('completed pieces stay unavailable until ERP is imported after completion', () => {
  const done = task('DETAL A', 'szt.', 100, 'DONE', '2026-09-17T09:00:00.000Z');
  assert.equal(applyPieceGrindingReservations([entry('DETAL A', 'szt.', 500)], [done], '2026-09-17', normalize)[0].availableQty, 400);
  assert.equal(applyPieceGrindingReservations([entry('DETAL A', 'szt.', 400, '2026-09-17T10:00:00.000Z')], [done], '2026-09-17', normalize)[0].availableQty, 400);
});

test('does not apply a later reservation to an earlier snapshot date', () => {
  const result = applyPieceGrindingReservations([entry('DETAL A', 'szt.', 500)], [task('DETAL A', 'szt.', 100)], '2026-09-16', normalize);
  assert.equal(result[0].availableQty, 500);
});

test('a pending piece reservation remains active on following plan days', () => {
  const previousDayTask = { ...task('DETAL A', 'szt.', 120), sourceReportDate: '2026-09-16' };
  const result = applyPieceGrindingReservations([entry('DETAL A', 'szt.', 500)], [previousDayTask], '2026-09-17', normalize);
  assert.equal(result[0].availableQty, 380);
});

test('does not reserve kg or a different unit with the same name', () => {
  const rows = [entry('DETAL A', 'kg', 500), entry('DETAL A', 'szt.', 800)];
  const result = applyPieceGrindingReservations(rows, [task('DETAL A', 'szt.', 200)], '2026-09-17', normalize);
  assert.equal(result[0].availableQty, 500);
  assert.equal(result[1].availableQty, 600);
});

test('pending report highlights survive reloads, later days and repeated ERP imports for kg and pieces', () => {
  const tasks = [task('TWORZYWO', 'kg', 25), task('DETAL A', 'szt.', 120)];
  for (const date of ['2026-09-17', '2026-09-18', '2026-09-21', '2026-09-24', '2026-10-17']) {
    const reloaded = JSON.parse(JSON.stringify(tasks));
    const expected = [['tworzywo|kg', 25], ['detal a|szt', 120]];
    assert.deepEqual([...getPendingGrindingQuantities(reloaded, date, normalize)], expected);
    applyPieceGrindingReservations([entry('DETAL A', 'szt.', 800, `${date}T09:00:00.000Z`)], reloaded, date, normalize);
    assert.deepEqual([...getPendingGrindingQuantities(reloaded, date, normalize)], expected);
  }
});

test('completion removes the highlight immediately, even while ERP still awaits an updated import', () => {
  const done = task('DETAL A', 'szt.', 100, 'DONE', '2026-09-17T09:00:00.000Z');
  assert.equal(applyPieceGrindingReservations([entry('DETAL A', 'szt.', 500)], [done], '2026-09-17', normalize)[0].reservedGrindingQty, 100);
  assert.equal(getPendingGrindingQuantities([done, task('TWORZYWO', 'kg', 25, 'DONE')], '2026-09-17', normalize).size, 0);
});

test('partial completion keeps the remaining work highlighted and reopening restores it', () => {
  const tasks = [task('DETAL A', 'szt.', 40), task('detal a', 'szt', 60)];
  const key = grindingMaterialKey('DETAL A', 'sztuki', normalize);
  assert.equal(getPendingGrindingQuantities(tasks, '2026-09-24', normalize).get(key), 100);
  tasks[0].status = 'DONE';
  assert.equal(getPendingGrindingQuantities(tasks, '2026-09-24', normalize).get(key), 60);
  tasks[1].status = 'DONE';
  assert.equal(getPendingGrindingQuantities(tasks, '2026-09-24', normalize).has(key), false);
  tasks[1].status = 'PENDING';
  assert.equal(getPendingGrindingQuantities(tasks, '2026-09-24', normalize).get(key), 60);
});

test('highlights keep kilograms and pieces separate and accept equivalent unit spellings', () => {
  const tasks = [task('DETAIL', ' KG. ', 2), task('detail', 'kg', 3), task('DETAIL', 'sztuki', 7), task('detail', 'pcs', 4)];
  assert.deepEqual([...getPendingGrindingQuantities(tasks, '2026-09-24', normalize)], [['detail|kg', 5], ['detail|szt', 11]]);
});

test('historical reports exclude later work but old tasks without a source date remain highlighted', () => {
  const later = task('DETAL A', 'szt.', 100);
  const legacy = { ...task('TWORZYWO', 'kg', 25), sourceReportDate: null };
  assert.deepEqual([...getPendingGrindingQuantities([later, legacy], '2026-09-16', normalize)], [['tworzywo|kg', 25]]);
});

test('invalid, completed and unsupported entries cannot create report highlights', () => {
  const tasks = [task('TWORZYWO', 'kg', 0), task('TWORZYWO', 'kg', -1), task('TWORZYWO', 'kg', NaN), task('TWORZYWO', 'l', 3), task('  ', 'kg', 3), task('TWORZYWO', 'kg', 25, 'DONE')];
  assert.equal(getPendingGrindingQuantities(tasks, '2026-09-24', normalize).size, 0);
});
