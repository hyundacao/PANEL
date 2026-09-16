import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOriginalInventoryAlerts,
  passesOriginalInventoryAlertThreshold
} from './originalInventoryAlerts.ts';

const thresholds = { szt: 100, kg: 300, l: 0 };
const line = (key, qty, unit, name = key) => ({ key, name, qty, unit });
const erpLine = (key, availableQty, unit, name = key) => ({ key, name, availableQty, unit });

test('uncounted ERP balance is not mistaken for a confirmed shortage', () => {
  const rows = buildOriginalInventoryAlerts([erpLine('hinge', 200, 'szt.')], []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].countedQty, null);
  assert.equal(rows[0].differenceQty, null);
  assert.equal(passesOriginalInventoryAlertThreshold(rows[0], thresholds), true);
});

test('manual thresholds are inclusive and unit-specific', () => {
  const rows = buildOriginalInventoryAlerts([
    erpLine('a', 99, 'szt.'), erpLine('b', 100, 'szt.'),
    erpLine('c', 299, 'kg'), erpLine('d', 300, 'kg'),
    erpLine('e', 99, 'l'), erpLine('f', 100, 'l')
  ], []);
  assert.deepEqual(rows.filter((row) => passesOriginalInventoryAlertThreshold(row, { ...thresholds, l: 100 })).map((row) => row.name).sort(), ['b', 'd', 'f']);
  assert.equal(rows.filter((row) => passesOriginalInventoryAlertThreshold(row, { ...thresholds, kg: 250, l: 100 })).length, 4);
});

test('spis minus available ERP is negative for shortage and positive for surplus', () => {
  const rows = buildOriginalInventoryAlerts(
    [erpLine('a', 500, 'szt.'), erpLine('b', 0, 'kg')],
    [line('a', 300, 'szt.'), line('b', 350, 'kg')]
  );
  assert.equal(rows.find((row) => row.name === 'a')?.differenceQty, -200);
  assert.equal(rows.find((row) => row.name === 'b')?.differenceQty, 350);
  assert.equal(rows.every((row) => passesOriginalInventoryAlertThreshold(row, thresholds)), true);
});

test('real ERP stock is ignored when available ERP stock differs', () => {
  const rows = buildOriginalInventoryAlerts(
    [{ ...erpLine('a', 300, 'kg'), realQty: 500 }],
    [line('a', 200, 'kg')]
  );
  assert.equal(rows[0].availableErpQty, 300);
  assert.equal(rows[0].differenceQty, -100);
});

test('names and compatible units aggregate; incompatible units never subtract', () => {
  const rows = buildOriginalInventoryAlerts(
    [erpLine('x', 1, '1000szt.'), erpLine('x', 500, 'szt.'), erpLine('y', 300, 'kg')],
    [line('x', 1400, 'szt.'), line('y', 300, 'l')]
  );
  assert.equal(rows.find((row) => row.name === 'x')?.differenceQty, -100);
  assert.equal(rows.find((row) => row.name === 'y')?.differenceQty, null);
  assert.equal(rows.find((row) => row.name === 'y')?.hasIncompatibleCount, true);
});
