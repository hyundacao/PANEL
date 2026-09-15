import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateOriginalInventoryByArea,
  buildOriginalInventoryExportRows,
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

test('inventory export keeps saved chambers and shows active uncounted chambers at zero percent', () => {
  const rows = buildOriginalInventoryExportRows([
    {
      name: 'HOSTACOM HBC 327L GREY',
      qty: 15680,
      unit: 'kg',
      warehouseId: 'fallback',
      sourceType: 'SILO',
      sourceId: 'silo:silo-e:2026-09-10'
    },
    {
      name: 'HOSTACOM HBC 327L GREY',
      qty: 50,
      unit: 'kg',
      warehouseId: 'hall-2'
    }
  ], [
    {
      id: 'silo-e',
      name: 'Silos główny',
      chamber: 'Komora E',
      materialName: 'HOSTACOM HBC 327L GREY',
      percentKg: 330,
      hopperKg: 500,
      isActive: true,
      orderNo: 5
    },
    {
      id: 'silo-f',
      name: 'Silos główny',
      chamber: 'Komora F',
      materialName: 'PP GF35',
      percentKg: 220,
      hopperKg: 350,
      isActive: true,
      orderNo: 6
    },
    {
      id: 'silo-old',
      name: 'Silos nieaktywny',
      chamber: 'Komora X',
      materialName: 'MATERIAŁ HISTORYCZNY',
      percentKg: 100,
      hopperKg: 200,
      isActive: false,
      orderNo: 99
    }
  ], [
    {
      configId: 'silo-e',
      percent: 46,
      hopperPresent: true,
      calculatedQty: 15680
    }
  ], hierarchy);

  assert.deepEqual(rows, [
    {
      materialName: 'HOSTACOM HBC 327L GREY',
      areaName: 'H2',
      qty: 50,
      unit: 'kg'
    },
    {
      materialName: 'HOSTACOM HBC 327L GREY',
      areaName: 'Silosy',
      qty: 15680,
      unit: 'kg',
      siloName: 'Silos główny',
      siloChamber: 'Komora E',
      siloPercent: 46,
      siloPercentKg: 330,
      siloHopperKg: 500,
      siloOrderNo: 5
    },
    {
      materialName: 'PP GF35',
      areaName: 'Silosy',
      qty: 0,
      unit: 'kg',
      siloName: 'Silos główny',
      siloChamber: 'Komora F',
      siloPercent: 0,
      siloPercentKg: 220,
      siloHopperKg: 0,
      siloOrderNo: 6
    }
  ]);
});
