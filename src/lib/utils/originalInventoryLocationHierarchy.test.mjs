import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateOriginalInventoryByArea,
  getOriginalInventoryParentLocationName
} from './originalInventoryLocationHierarchy.ts';

const hierarchy = {
  warehouseNameById: new Map([
    ['hall-1', 'Hala 1'],
    ['hall-2', 'Hala 2'],
    ['fallback', 'Magazyn techniczny']
  ]),
  warehouseNameByPlanningAreaId: new Map([
    ['hala-1', 'Hala 1'],
    ['hala-2', 'Hala 2']
  ]),
  fixedDeviceAreaIdById: new Map([
    ['bufor-30', 'hala-2'],
    ['cs-2', 'hala-2']
  ])
};

test('fixed devices are grouped under their assigned hall', () => {
  assert.equal(
    getOriginalInventoryParentLocationName({
      warehouseId: 'fallback',
      sourceType: 'FIXED_DEVICE',
      sourceId: 'fixed-device:bufor-30:2026-09-09'
    }, hierarchy),
    'Hala 2'
  );
  assert.equal(
    getOriginalInventoryParentLocationName({
      warehouseId: 'fallback',
      sourceType: 'FIXED_DEVICE',
      sourceId: 'fixed-device:cs-2:2026-09-09'
    }, hierarchy),
    'Hala 2'
  );
});

test('silos are exported as a shared top-level area', () => {
  assert.equal(
    getOriginalInventoryParentLocationName({
      warehouseId: 'fallback',
      sourceType: 'SILO',
      sourceId: 'silo:silos-komora-b:2026-09-09'
    }, hierarchy),
    'Silosy'
  );
});

test('ordinary inventory entries retain their warehouse as the parent location', () => {
  assert.equal(
    getOriginalInventoryParentLocationName({ warehouseId: 'hall-1' }, hierarchy),
    'Hala 1'
  );
});

test('technical warehouse identifiers are never exposed as labels', () => {
  assert.equal(
    getOriginalInventoryParentLocationName({
      warehouseId: 'erp-wh-1771267679082-80cfa4af'
    }, hierarchy),
    'Nieprzypisana'
  );
});

test('inventory export sums every source of the same material within one area', () => {
  const rows = aggregateOriginalInventoryByArea([
    {
      name: 'ABS NOVODUR P2HP-AT Q202 WHITE 011236',
      qty: 300,
      unit: 'kg',
      warehouseId: 'hall-2',
      sourceType: 'FIXED_DEVICE',
      sourceId: 'fixed-device:bufor-30:2026-09-09'
    },
    {
      name: 'ABS NOVODUR P2HP-AT Q202 WHITE 011236',
      qty: 60,
      unit: 'kg',
      warehouseId: 'hall-2',
      sourceType: 'FIXED_DEVICE',
      sourceId: 'fixed-device:cs-2:2026-09-09'
    },
    {
      name: 'ABS NOVODUR P2HP-AT Q202 WHITE 011236',
      qty: 30,
      unit: 'kg',
      warehouseId: 'hall-2'
    },
    {
      name: 'ABS NOVODUR P2HP-AT Q202 WHITE 011236',
      qty: 400,
      unit: 'kg',
      warehouseId: 'hall-2'
    }
  ], hierarchy);

  assert.deepEqual(rows, [{
    materialName: 'ABS NOVODUR P2HP-AT Q202 WHITE 011236',
    areaName: 'H2',
    qty: 790,
    unit: 'kg'
  }]);
});
