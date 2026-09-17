import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTechnologyQuickReferenceRows } from './technologyQuickReference.ts';

test('exports only included products with their direct materials and linked semi-finished goods', () => {
  const rows = buildTechnologyQuickReferenceRows([
    {
      included: true,
      productIndex: '01830',
      productName: 'Wycieraczka z kratą',
      technologyName: 'Bazowa',
      materials: [
        { code: '01838', name: 'Obudowa wycieraczki' },
        { code: '01355', name: 'Karton 640x410x400' },
        { code: '01838', name: 'Obudowa wycieraczki' }
      ],
      linkedProducts: [{ productIndex: '01839', productName: 'Krata wycieraczki' }]
    },
    {
      included: false,
      productIndex: '99999',
      productName: 'Pominięty wyrób',
      technologyName: 'Bazowa',
      materials: [{ code: 'X', name: 'Nie eksportuj' }],
      linkedProducts: []
    }
  ]);

  assert.deepEqual(rows.map((row) => [row.productIndex, row.componentCode, row.componentName]), [
    ['01830', '01838', 'Obudowa wycieraczki'],
    ['01830', '01355', 'Karton 640x410x400'],
    ['01830', '01839', 'Krata wycieraczki']
  ]);
  assert.ok(rows.every((row) => row.technologyName === 'Bazowa'));
  assert.ok(rows.every((row) => !Object.hasOwn(row, 'qty') && !Object.hasOwn(row, 'demand')));
});

test('keeps distinct product indexes separate and marks missing recipes without inventing components', () => {
  const rows = buildTechnologyQuickReferenceRows([
    { included: true, productIndex: 'A', productName: 'Panel', technologyName: 'Bazowa', materials: [{ code: '001', name: 'Zatrzask' }], linkedProducts: [] },
    { included: true, productIndex: 'B', productName: 'Panel', technologyName: 'Awaryjna 1', materials: [{ code: '002', name: 'Zatrzask' }], linkedProducts: [] },
    { included: true, productIndex: 'C', productName: 'Inny wyrób', technologyName: 'Brak technologii', materials: [], linkedProducts: [] }
  ]);

  assert.deepEqual(rows.map((row) => [row.productIndex, row.technologyName, row.componentCode]), [
    ['A', 'Bazowa', '001'],
    ['B', 'Awaryjna 1', '002'],
    ['C', 'Brak technologii', '']
  ]);
});
