import test from 'node:test';
import assert from 'node:assert/strict';
import {
  changeOriginalInventoryAlertExclusions,
  normalizeOriginalInventoryAlertExclusions
} from './originalInventoryAlertExclusions.ts';

const exclusion = {
  key: 'hinge|szt',
  name: 'HINGE LEFT',
  unit: 'szt.',
  createdAt: '2026-09-16T10:00:00.000Z',
  createdBy: 'operator'
};

test('ignore is persistent by material identity, not by report day or amount', () => {
  const ignored = changeOriginalInventoryAlertExclusions([], { action: 'ignore', exclusion });
  assert.equal(ignored.length, 1);
  assert.equal(ignored[0].key, 'hinge|szt');
  assert.equal(changeOriginalInventoryAlertExclusions(ignored, { action: 'ignore', exclusion }).length, 1);
  assert.equal(normalizeOriginalInventoryAlertExclusions({ items: ignored }).length, 0);
});

test('restoring one item leaves other ignored items untouched', () => {
  const other = { ...exclusion, key: 'foil|kg', name: 'FOLIA', unit: 'kg' };
  const ignored = normalizeOriginalInventoryAlertExclusions([exclusion, other]);
  const restored = changeOriginalInventoryAlertExclusions(ignored, { action: 'restore', key: exclusion.key });
  assert.deepEqual(restored.map((item) => item.key), ['foil|kg']);
});
