import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProductCatalogChoices, productCatalogIndexMatches, searchProductCatalog } from './productCatalogSearch.ts';

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

const trayName = 'TRAY HANDLE INSERT BO CLIPPED + HS';
const trayPair = () => [
  { ...item('primary', trayName, 'M-10-PWY-BSHL-10012', 'M-10'), index2: '10012', unit: 'szt.' },
  { ...item('secondary', trayName, 'M-10-8001103471', 'M-10'), index2: '8001103471', unit: 'szt.' }
];

test('both source indices refer to the same suggestion in every warehouse', () => {
  for (const warehouse of ['M-1', 'M-4', 'M-10', 'M-11', 'M-51']) {
    const index = `${warehouse}-PWY-BSHL-10012`;
    const input = [{...item('primary', trayName, index, warehouse), index2: '8001103471', unit: 'szt.'}];
    const before = structuredClone(input);
    const choices = buildProductCatalogChoices(input);
    assert.equal(choices.length, 1);
    assert.equal(choices[0].index, index);
    assert.equal(choices[0].index2, '8001103471');
    assert.deepEqual(input, before, 'catalog source records must not be modified');
    for (const mode of ['material-name', 'material-code', 'product-name', 'product-index']) {
      for (const query of [trayName, 'TRAY CLIPPED HS', index, '10012', '8001103471']) {
        const matches = searchProductCatalog(choices, query, mode);
        assert.equal(matches.length, 1, `${mode}: ${query}`);
        assert.equal(matches[0].id, 'primary');
      }
    }
    assert.equal(productCatalogIndexMatches(choices[0], `${warehouse}-PWY-BSHL- 10012`), true);
    assert.equal(productCatalogIndexMatches(choices[0], '8001103471'), true);
    assert.equal(productCatalogIndexMatches(choices[0], 'M-10-PWY-BSHL-10005'), false);
    assert.deepEqual(buildProductCatalogChoices(choices), choices);
  }
});

test('different units, warehouses, names and technical prefixes cannot create an alias pair', () => {
  for (const patch of [{unit:'kg'}, {warehouseCode:'M-11',index:'M-11-8001103471'}, {name:trayName+' OTHER'}, {index:'M-10-OTHER-SUPPLIER-8001103471'}]) {
    const pair = trayPair();
    pair[1] = { ...pair[1], ...patch };
    assert.equal(buildProductCatalogChoices(pair).length, 2);
  }
});

test('ambiguous secondary indices and independent MAX indices remain separate', () => {
  const pair = trayPair();
  assert.equal(buildProductCatalogChoices([...pair, {...pair[1],id:'third',index:'M-10-8001103472',index2:'8001103472'}]).length,3);
  assert.equal(buildProductCatalogChoices([...pair, {...pair[0],id:'third',index:'M-10-PWY-BSHL-10013'}]).length,3);
  const name = 'MAX CP+TH PRINTED F1_WQ33G2D00';
  for (const prefix of ['', 'M-10-']) {
    const values = ['9001970413','9001972083'].map((code,i)=>item(String(i),name,prefix+code,prefix ? 'M-10' : ''));
    assert.equal(buildProductCatalogChoices(values).length,2);
  }
});

test('same names and numeric-looking indices never establish a pair without source columns', () => {
  const choices = buildProductCatalogChoices([
    item('other', '10012 OTHER', 'OTHER'), ...trayPair(), item('unrelated', 'TRAY OTHER', 'OTHER2')
  ]);
  assert.equal(searchProductCatalog(choices, 'M-10-PWY-BSHL-10012', 'material-code', 1)[0].id, 'primary');
  assert.equal(searchProductCatalog(choices, trayName, 'material-name').length, 2);
});
