import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dedupeOriginalInventorySpisSuggestions,
  getOriginalInventorySpisWarehousePriority,
  getOriginalInventorySpisIndex2,
  matchesOriginalInventorySpisSearch,
  prioritizeOriginalInventorySpisSuggestions
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
  assert.equal(getOriginalInventorySpisIndex2('M-1-BA-BSHTR-001 -00'), '001-00');
  assert.equal(getOriginalInventorySpisIndex2('M-1-BA-BSHTR- 001 - 00'), '001-00');
  assert.equal(getOriginalInventorySpisIndex2('5949'), '5949');
  assert.equal(getOriginalInventorySpisIndex2('M-10-8001228788'), '8001228788');
});

test('the full index wins for duplicate material and warehouse suggestions', () => {
  const suggestions = dedupeOriginalInventorySpisSuggestions([
    {
      name: 'TRAY HANDLE ASSEMBLY WELDED WHITE',
      warehouseCode: 'M-10',
      indexCode: 'M-10-8001228788',
      indexCode2: '8001228788'
    },
    {
      name: 'TRAY HANDLE ASSEMBLY WELDED WHITE',
      warehouseCode: 'M-10',
      indexCode: 'M-10-8001228788',
      indexCode2: '10006'
    }
  ]);

  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].indexCode2, '8001228788');
});

test('a long ERP index wins over a short secondary value', () => {
  assert.equal(
    getOriginalInventorySpisIndex2('M-10-8001103471', '10012'),
    '8001103471'
  );
});

test('spis search still matches names and normalized index 2 formatting', () => {
  assert.equal(matchesOriginalInventorySpisSearch('starex', 'ABS STAREX AS 0151', '8178'), true);
  assert.equal(matchesOriginalInventorySpisSearch('50 32-00', 'TARNOFORM 300', '5032-00'), true);
  assert.equal(matchesOriginalInventorySpisSearch('m-1-tw', 'TARNOFORM 300', '5032-00'), false);
});

test('only a real space combines independent search fragments', () => {
  assert.equal(
    matchesOriginalInventorySpisSearch('rozm.6', 'KARTON 600X400X300 Z NADR. ROZM.6', '758-001'),
    true
  );
  assert.equal(
    matchesOriginalInventorySpisSearch('rozm.6', 'KARTON ZEWNĘTRZNY ROZMIAR 6 BEZ NADRUKU', '553'),
    false
  );
  assert.equal(
    matchesOriginalInventorySpisSearch('rozm 6', 'KARTON ZEWNĘTRZNY ROZMIAR 6 BEZ NADRUKU', '553'),
    true
  );
  assert.equal(
    matchesOriginalInventorySpisSearch('kon 505', 'KONCENTRAT CZARNY 505', '886'),
    true
  );
  assert.equal(
    matchesOriginalInventorySpisSearch('rozm 6', 'KARTON NADR. ROZM. 788X291X560 Z NADRUKIEM FSC', '10606'),
    false
  );
});

test('a query without spaces must occur as one continuous fragment', () => {
  assert.equal(
    matchesOriginalInventorySpisSearch('5864', 'KARTON DO PRODUKTU 5864 CZARNY', '8124'),
    true
  );
  assert.equal(
    matchesOriginalInventorySpisSearch('5864', 'KARTON DO PRODUKTU 58 CZARNY 64', '8124'),
    false
  );
  assert.equal(matchesOriginalInventorySpisSearch('5864', 'INNY MATERIAŁ', '15864-00'), true);
});

test('already inventoried suggestions always precede database matches and are not duplicated', () => {
  const suggestions = prioritizeOriginalInventorySpisSuggestions([
    { name: 'ABS ELIX 505', warehouseCode: 'M-1', indexCode: 'M-1-TW-505', indexCode2: '505' },
    { name: 'KONCENTRAT CZARNY 505', warehouseCode: 'M-55', indexCode: 'M-55-BAR-505', indexCode2: '505' },
    { name: 'KONCENTRAT CZARNY 505', warehouseCode: null, indexCode: null, indexCode2: null }
  ], ['KONCENTRAT CZARNY 505']);

  assert.equal(suggestions[0].name, 'KONCENTRAT CZARNY 505');
  assert.equal(suggestions.filter((item) => item.name === 'KONCENTRAT CZARNY 505').length, 1);
  assert.equal(suggestions[1].warehouseCode, 'M-1');
});

test('unassigned catalog rows precede warehouses outside M1 M4 M10 and M11', () => {
  assert.ok(getOriginalInventorySpisWarehousePriority('') < getOriginalInventorySpisWarehousePriority('M-55'));
  assert.ok(getOriginalInventorySpisWarehousePriority(null) < getOriginalInventorySpisWarehousePriority('M-89'));

  const suggestions = prioritizeOriginalInventorySpisSuggestions([
    { name: 'M55', warehouseCode: 'M-55' },
    { name: 'BRAK', warehouseCode: null },
    { name: 'M11', warehouseCode: 'M-11' },
    { name: 'M10', warehouseCode: 'M-10' },
    { name: 'M4', warehouseCode: 'M-4' },
    { name: 'M1', warehouseCode: 'M-1' },
    { name: 'M89', warehouseCode: 'M-89' }
  ], []);

  assert.deepEqual(
    suggestions.map((item) => item.name),
    ['M1', 'M4', 'M10', 'M11', 'BRAK', 'M55', 'M89']
  );
});
