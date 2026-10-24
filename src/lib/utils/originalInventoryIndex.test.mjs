import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertOriginalInventoryImportIndices,
  hasOriginalInventoryReportTimestamp,
  isOriginalInventoryReportTimestamp,
  normalizeOriginalInventoryIndex,
  ORIGINAL_INVENTORY_INDEX_TIMESTAMP_ERROR
} from './originalInventoryIndex.ts';

test('report timestamps are rejected without stripping or rewriting material indices', () => {
  for (const indexCode of [
    '618 16.10.2026 6:58',
    'M-1-TW-BSHL-5607-00 9.10.2026 6:59',
    'A22154801 13.10.2026 6:55',
    '618\u00a016.10.2026\n06:58:09',
    '618 2026-10-16 06:58',
    '618 16/10/2026 6:58',
    '618 16-10-2026 6:58'
  ]) {
    assert.equal(hasOriginalInventoryReportTimestamp(indexCode), true, indexCode);
    assert.throws(() => assertOriginalInventoryImportIndices([{ indexCode }]),
      { message: ORIGINAL_INVENTORY_INDEX_TIMESTAMP_ERROR });
  }
  assert.equal(normalizeOriginalInventoryIndex('618 16.10.2026 6:58'), '618 16.10.2026 6:58');
});

test('legitimate indices, dates without times and distinct IRIS indices remain unchanged', () => {
  for (const indexCode of [
    '618', 'M-1-TW-BSHL-5607-00', '786-002-01', '006-00', '00012345678901234567',
    '002/03', 'A22154703', 'A22154704', 'ABC 16.10.2026', '176.8001', 'TP131301', '', null
  ]) {
    assert.equal(hasOriginalInventoryReportTimestamp(indexCode), false, String(indexCode));
    assert.doesNotThrow(() => assertOriginalInventoryImportIndices([{ indexCode }]));
  }
  assert.notEqual(normalizeOriginalInventoryIndex('A22154703'), normalizeOriginalInventoryIndex('A22154704'));
});

test('PDF footer detection matches a whole timestamp segment, not a combined index', () => {
  assert.equal(isOriginalInventoryReportTimestamp(' 16.10.2026 6:58 '), true);
  assert.equal(isOriginalInventoryReportTimestamp('618 16.10.2026 6:58'), false);
  assert.equal(isOriginalInventoryReportTimestamp('16.10.2026 6:58 EXTRA'), false);
  assert.equal(isOriginalInventoryReportTimestamp(''), false);
});
