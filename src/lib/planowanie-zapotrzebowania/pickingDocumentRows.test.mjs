import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalPlanningUnit, canonicalPlanningMaterialKey, groupPickingDocumentRows, mergePickingSources } from './pickingDocumentRows.ts';

const materialKey = (row) => `${row.code.toLowerCase()}|${canonicalPlanningUnit(row.unit)}`;
const group = (rows) => groupPickingDocumentRows(rows, materialKey, (row) => row.warehouseCode);
const row = (overrides = {}) => ({
  key: 'metal|szt', code: 'METAL', name: 'METAL BOX', unit: 'szt', warehouseCode: 'M-4',
  demand: 6, areaStock: 0, issuedBefore: 0, pendingBefore: 0, toIssue: 6, confirmed: false,
  sources: [{ planItemId: 'A', index: 'A100', name: 'Detail A', demand: 6 }], ...overrides
});

test('unit aliases normalize without converting different quantity scales', () => {
  for (const unit of ['szt', 'SZT.', ' szt. ', 'sztuki']) assert.equal(canonicalPlanningUnit(unit), 'szt.');
  assert.equal(canonicalPlanningUnit('KG.'), 'kg');
  assert.equal(canonicalPlanningUnit('opak'), 'opak.');
  assert.notEqual(canonicalPlanningUnit('kg'), canonicalPlanningUnit('g'));
  assert.notEqual(canonicalPlanningUnit('szt'), canonicalPlanningUnit('1000szt.'));
  assert.equal(canonicalPlanningMaterialKey('m-4-metal|szt'), 'm-4-metal|szt.');
  assert.equal(canonicalPlanningMaterialKey('legacy-id'), 'legacy-id');
});

test('saved metal box rows become one line with 18 to issue and two product sources', () => {
  const rows = [row(), row({ key: 'metal|szt.', unit: 'szt.', demand: 18, areaStock: 6, toIssue: 12,
    sources: [{ planItemId: 'B', index: 'B200', name: 'Detail B', demand: 18 }] })];
  const original = structuredClone(rows);
  const [result] = group(rows);
  assert.equal(group(rows).length, 1);
  assert.deepEqual([result.demand, result.areaStock, result.toIssue, result.unit], [24, 6, 18, 'szt.']);
  assert.deepEqual(result.sources.map(source => source.demand), [6, 18]);
  assert.deepEqual(result.memberKeys, ['metal|szt', 'metal|szt.']);
  assert.deepEqual(rows, original, 'display grouping must not rewrite stored rows');
});

test('confirmation requires all original rows and historical quantities are preserved', () => {
  const rows = [row({ confirmed: true, issuedBefore: 2 }), row({ key: 'metal|szt.', unit: 'szt.', pendingBefore: 3 })];
  assert.equal(group(rows)[0].confirmed, false);
  assert.equal(group(rows)[0].issuedBefore, 2);
  assert.equal(group(rows)[0].pendingBefore, 3);
  rows[1].confirmed = true;
  assert.equal(group(rows)[0].confirmed, true);
});

test('different warehouses, material indices and quantity scales remain separate', () => {
  assert.equal(group([row(), row({ warehouseCode: 'M-1' })]).length, 2);
  assert.equal(group([row(), row({ code: 'OTHER' })]).length, 2);
  assert.equal(group([row(), row({ unit: '1000szt.' })]).length, 2);
});

test('one detail appears once in expanded sources, with its contributions summed', () => {
  const source = row().sources[0];
  assert.deepEqual(mergePickingSources([source, { ...source, demand: 18 }]), [{ ...source, demand: 24 }]);
  assert.equal(mergePickingSources([source, { ...source, planItemId: 'other-machine' }]).length, 2);
  assert.equal(source.demand, 6);
});
