import assert from 'node:assert/strict';
import test from 'node:test';
import { isRegrindStatsWarehouse } from './regrindStats.ts';

const warehouse = (id, overrides = {}) => ({
  id,
  name: id,
  orderNo: 1,
  isActive: true,
  includeInStats: true,
  includeInSpis: true,
  ...overrides
});

test('planning areas do not create regrind tiles even with legacy statistics flags', () => {
  const warehouses = ['hall-1', 'hall-2', 'hall-3', 'mill-pp', 'bakoma', 'lakiernia']
    .map((id) => warehouse(id));

  assert.deepEqual(warehouses.filter(isRegrindStatsWarehouse).map((item) => item.id), [
    'hall-1', 'hall-2', 'hall-3', 'mill-pp'
  ]);
});

test('custom regrind warehouses keep their existing statistics settings', () => {
  assert.equal(isRegrindStatsWarehouse(warehouse('custom-warehouse')), true);
  assert.equal(isRegrindStatsWarehouse(warehouse('custom-warehouse', { isActive: false })), false);
  assert.equal(isRegrindStatsWarehouse(warehouse('custom-warehouse', { includeInStats: false })), false);
});

test('excluding planning areas from statistics does not change inventory data or flags', () => {
  const warehouses = ['bakoma', 'lakiernia'].map((id) => warehouse(id));
  const before = structuredClone(warehouses);

  assert.deepEqual(warehouses.filter(isRegrindStatsWarehouse), []);
  assert.deepEqual(warehouses, before);
  assert.equal(warehouses.every((item) => item.includeInSpis && item.isActive), true);
});
