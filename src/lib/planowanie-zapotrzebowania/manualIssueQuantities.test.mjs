import assert from 'node:assert/strict';
import test from 'node:test';
import { allocateIssueQuantities, committedIssueQuantity, normalizeManualIssueQuantities, remainingManualIssueQuantity } from './manualIssueQuantities.ts';

const override = { quantity: 100, committedBaseline: 20, planDate: '2026-10-19', areaId: 'hala-2' };
const source = (id, demand, toIssue) => ({ planItemId: id, demand, ...(toIssue === undefined ? {} : { toIssue }) });
const document = (status, sources) => ({ planDate: override.planDate, areaId: override.areaId, status,
  rows: [{ key: 'mat|kg', toIssue: 120, confirmed: false, sources }] });
const committed = (documents) => committedIssueQuantity(documents, override.planDate, override.areaId, 'mat|kg', 'A', key => key);

test('manual quantity is scoped to the selected plan day and area', () => {
  assert.equal(remainingManualIssueQuantity(override, override.planDate, override.areaId, 20), 100);
  assert.equal(remainingManualIssueQuantity(override, '2026-10-20', override.areaId, 20), null);
  assert.equal(remainingManualIssueQuantity(override, override.planDate, 'hala-1', 20), null);
  assert.equal(remainingManualIssueQuantity(undefined, override.planDate, override.areaId, 20), null);
});

test('manual reserve does not repeat after it was issued; earlier issues are not deducted twice', () => {
  assert.equal(remainingManualIssueQuantity(override, override.planDate, override.areaId, 20), 100);
  assert.equal(remainingManualIssueQuantity(override, override.planDate, override.areaId, 60), 60);
  assert.equal(remainingManualIssueQuantity(override, override.planDate, override.areaId, 120), 0);
  assert.equal(remainingManualIssueQuantity(override, override.planDate, override.areaId, 220), 0);
});

test('explicit source issue amounts retain reserves independently of technology demand shares', () => {
  const doc = document('issued', [source('A', 20, 100), source('B', 20, 20)]);
  assert.equal(committed([doc]), 100);
  assert.equal(committed([{ ...doc, status: 'cancelled' }]), 0);
  assert.equal(committed([{ ...doc, status: 'draft' }]), 0);
  assert.equal(committed([{ ...doc, status: 'handed' }]), 100);
  assert.equal(committed([{ ...doc, status: 'draft', rows: doc.rows.map(row => ({ ...row, confirmed: true })) }]), 100);
  assert.equal(committed([{ ...doc, areaId: 'hala-3' }]), 0);
  assert.equal(committed([{ ...doc, planDate: '2026-10-18' }]), 0);
});

test('legacy documents still credit their issue quantities using source proportions', () => {
  assert.equal(committed([document('issued', [source('A', 10), source('B', 20)])]), 40);
  assert.equal(committed([document('issued', [])]), 0);
});

test('manual issue replaces only its product share; untouched products stay automatic', () => {
  const sources = [source('A', 20), source('B', 20)];
  const result = allocateIssueQuantities(sources, 40, row => row.planItemId === 'A' ? 100 : null, value => value);
  assert.equal(result.toIssue, 120);
  assert.deepEqual(result.sources.map(row => row.toIssue), [100, 20]);
  assert.deepEqual(sources.map(row => row.toIssue), [undefined, undefined]);
  assert.equal(allocateIssueQuantities(sources, 0, row => row.planItemId === 'A' ? 100 : null, value => value).toIssue, 100);
  assert.equal(allocateIssueQuantities(sources, 40, () => 0, value => value).toIssue, 0);
});

test('fractional source allocation preserves the exact total of discrete units', () => {
  const result = allocateIssueQuantities([source('A', 1), source('B', 2)], 7, () => null, Math.ceil);
  assert.equal(result.toIssue, 7);
  assert.equal(result.sources.reduce((sum, row) => sum + row.toIssue, 0), 7);
});

test('stored overrides reject invalid numbers and clone their entries', () => {
  const original = { 'mat|kg': override, negative: { ...override, quantity: -1 }, infinite: { ...override, quantity: Infinity }, missing: {} };
  const normalized = normalizeManualIssueQuantities(original);
  assert.deepEqual(Object.keys(normalized), ['mat|kg']);
  assert.notEqual(normalized['mat|kg'], override);
  assert.deepEqual(normalizeManualIssueQuantities(null), {});
});
