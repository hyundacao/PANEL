import assert from 'node:assert/strict';
import test from 'node:test';
import { searchProductCatalog } from './productCatalogSearch.ts';

const item = (id, name, index, warehouseCode = '') => ({ id, name, index, warehouseCode, unit: 'kg' });

test('product search requires every typed fragment and keeps the primary-field match first', () => {
  const items = [
    item('other', 'PANEL 772 BLACK', 'A200'),
    item('match', '772 BODY PANEL', 'A100'),
    item('missing-token', '772 COVER', 'A300')
  ];
  assert.deepEqual(
    searchProductCatalog(items, '772 bo', 'product-name').map((row) => row.id),
    ['match']
  );
});

test('material search preserves preferred warehouse order and excludes FW rows', () => {
  const items = [
    item('m55', 'KONCENTRAT 505', '55', 'M-55'),
    item('m4', 'KONCENTRAT 505', '4', 'M-4'),
    item('m1', 'KONCENTRAT 505', '1', 'M-1'),
    item('fw', 'FW - KONCENTRAT 505', 'FW', 'M-1')
  ];
  assert.deepEqual(
    searchProductCatalog(items, 'kon 505', 'material-name').map((row) => row.id),
    ['m1', 'm4', 'm55']
  );
});

test('catalog search returns only the requested small result set', () => {
  const items = Array.from({ length: 40 }, (_, index) => item(String(index), `PANEL ${index}`, `A${index}`));
  assert.equal(searchProductCatalog(items, 'panel', 'product-name', 8).length, 8);
  assert.equal(searchProductCatalog(items, '', 'product-name', 8).length, 0);
});
