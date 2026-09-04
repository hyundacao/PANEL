import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getOriginalInventorySpisIndex2,
  matchesOriginalInventorySpisSearch
} from './originalInventorySpisSearch.ts';

test('spis search uses the explicit second index and ignores the first index', () => {
  const index1 = 'M-1-TW-RSHWR-8178';
  const index2 = getOriginalInventorySpisIndex2(index1, '8178');
  assert.equal(index2, '8178');
  assert.equal(matchesOriginalInventorySpisSearch('8178', 'ABS STAREX', index2), true);
  assert.equal(matchesOriginalInventorySpisSearch('RSHWR', 'ABS STAREX', index2), false);
  assert.equal(matchesOriginalInventorySpisSearch(index1, 'ABS STAREX', index2), false);
});

test('legacy catalog rows expose only the trailing index 2 instead of the warehouse index', () => {
  assert.equal(getOriginalInventorySpisIndex2('M-1-TW-RSHWR-8178'), '8178');
  assert.equal(getOriginalInventorySpisIndex2('M-1-TW-SID-5032-00'), '5032-00');
  assert.equal(getOriginalInventorySpisIndex2('5949'), '5949');
});

test('spis search still matches names and normalized index 2 formatting', () => {
  assert.equal(matchesOriginalInventorySpisSearch('starex', 'ABS STAREX AS 0151', '8178'), true);
  assert.equal(matchesOriginalInventorySpisSearch('50 32-00', 'TARNOFORM 300', '5032-00'), true);
  assert.equal(matchesOriginalInventorySpisSearch('m-1-tw', 'TARNOFORM 300', '5032-00'), false);
});
