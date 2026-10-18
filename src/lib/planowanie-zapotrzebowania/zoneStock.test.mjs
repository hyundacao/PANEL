import assert from 'node:assert/strict';
import test from 'node:test';
import { buildZoneStockSummary } from './zoneStock.ts';
import { createHeaderFixture } from './planHeader.fixture.mjs';

const material = { code: 'PP', name: 'Regranulat PP', unit: 'kg' };
const source = (id, demand, overrides = {}) => ({
  id, index: id, name: `Detal ${id}`, station: 'WTR 1', areaId: 'hala-1', included: true,
  contributions: [{ material, demand }], ...overrides
});
const summarize = (overrides = {}) => buildZoneStockSummary({
  material, areaId: 'hala-1', currentItemId: 'A', inventory: [], sources: [],
  matchesMaterial: (a, b) => Boolean(a.code && a.code === b.code || a.name && a.name === b.name),
  ...overrides
});

test('zone stock excludes other halls, central warehouses and shared silos', () => {
  const result = summarize({ inventory: [
    { ...material, areaId: 'hala-1', qty: 20 },
    { ...material, areaId: 'hala-1', qty: 3 },
    { ...material, areaId: 'hala-2', qty: 100 },
    { ...material, areaId: 'magazyn', qty: 500 },
    { ...material, areaId: 'silosy', qty: 1000 },
    { code: 'ABS', name: 'ABS', unit: 'kg', areaId: 'hala-1', qty: 50 }
  ] });
  assert.equal(result.stock, 23);
});

test('silos are one shared stock for halls 1, 2 and 3, separate from each local stock', () => {
  const inventory = [
    { ...material, areaId: 'hala-1', qty: 50 }, { ...material, areaId: 'hala-2', qty: 999 },
    { ...material, areaId: 'silosy', qty: 100 }, { ...material, areaId: 'silosy', qty: 200 },
    { ...material, areaId: 'magazyn', qty: 4000 }
  ];
  const sources = [source('A', 20), source('B', 48), source('C', 10, { areaId: 'hala-2', areaName: 'Hala 2' }),
    source('D', 900, { included: false }), source('E', 30, { areaId: 'hala-3', areaName: 'Hala 3' }),
    source('F', 500, { areaId: '' })];
  const before = JSON.stringify({ inventory, sources });
  const result = summarize({ inventory, sources, sharedAreaIds: new Set(['silosy']) });
  assert.equal(result.stock, 50);
  assert.equal(result.sharedStock, 300);
  assert.equal(result.otherDemand, 48);
  assert.equal(result.allOtherDemand, 88);
  assert.deepEqual(result.allOthers.map(row => row.id), ['B', 'C', 'E']);
  assert.equal(result.allOthers[2].areaName, 'Hala 3');
  for (const areaId of ['hala-2', 'hala-3']) {
    assert.equal(summarize({ inventory, sources, areaId, sharedAreaIds: new Set(['silosy']) }).sharedStock, 300);
  }
  assert.equal(JSON.stringify({ inventory, sources }), before);
});

test('shared stock supports units, zero and missing measurements independently of local stock', () => {
  const base = { sharedAreaIds: new Set(['silosy']) };
  assert.equal(summarize(base).sharedStock, null);
  assert.equal(summarize({ ...base, inventory: [{ ...material, areaId: 'silosy', qty: 0 }] }).sharedStock, 0);
  assert.equal(summarize({ ...base, inventory: [{ ...material, areaId: 'silosy', qty: 5000, unit: 'g' }] }).sharedStock, 5);
  const incompatible = summarize({ ...base, inventory: [
    { ...material, areaId: 'hala-1', qty: 25 }, { ...material, areaId: 'silosy', qty: 5, unit: 'l' }
  ] });
  assert.equal(incompatible.stock, 25);
  assert.equal(incompatible.sharedStock, null);
  assert.equal(incompatible.incompatibleSharedStock, true);
});

test('unresolved demand in another hall does not become a complete shared-stock demand', () => {
  const result = summarize({ sources: [source('B', 48), source('C', null, { areaId: 'hala-3' })] });
  assert.equal(result.otherDemand, 48);
  assert.equal(result.allOtherDemand, null);
});

test('missing measurement is not zero; an explicit zero is preserved', () => {
  assert.equal(summarize().stock, null);
  assert.equal(summarize({ inventory: [{ ...material, areaId: 'hala-1', qty: 0 }] }).stock, 0);
  assert.equal(summarize({ areaId: '', inventory: [{ ...material, areaId: '', qty: 40 }] }).stock, null);
});

test('shared demand is counted once per other included plan position in the same zone', () => {
  const sources = [source('A', 20), source('B', 48), source('C', 10, { areaId: 'hala-2' }),
    source('D', 90, { included: false }), source('E', 0)];
  const before = JSON.stringify(sources);
  const result = summarize({ sources });
  assert.equal(result.otherDemand, 48);
  assert.deepEqual(result.others.map((row) => row.id), ['B']);
  assert.equal(JSON.stringify(sources), before);
});

test('compatible units are converted; kilograms never add to liters', () => {
  const result = summarize({ inventory: [
    { ...material, areaId: 'hala-1', qty: 2 }, { ...material, areaId: 'hala-1', qty: 3000, unit: 'g' }
  ], sources: [source('B', 0, { contributions: [{ material: { ...material, unit: 'g' }, demand: 4000 }] })] });
  assert.equal(result.stock, 5);
  assert.equal(result.otherDemand, 4);
  const incompatible = summarize({ inventory: [{ ...material, areaId: 'hala-1', qty: 20, unit: 'l' }] });
  assert.equal(incompatible.stock, null);
  assert.equal(incompatible.incompatibleStock, true);
  assert.equal(summarize({ material: { ...material, unit: '1000szt.' },
    inventory: [{ ...material, areaId: 'hala-1', qty: 200, unit: 'szt.' }] }).stock, 0.2);
});

test('combines direct and linked contributions without duplicating product rows', () => {
  const result = summarize({ sources: [source('B', 0, { contributions: [
    { material, demand: 10 }, { material, demand: 5 },
    { material: { code: 'OTHER', name: 'Inny', unit: 'kg' }, demand: 100 }
  ] })] });
  assert.equal(result.otherDemand, 15);
  assert.equal(result.others.length, 1);
});

test('unresolved demand or incompatible units are not presented as a complete zero demand', () => {
  assert.equal(summarize({ sources: [source('B', null)] }).otherDemand, null);
  assert.equal(summarize({ sources: [source('B', 0, {
    contributions: [{ material: { ...material, unit: 'l' }, demand: 3 }]
  })] }).otherDemand, null);
});

const fixture = (overrides = {}) => {
  const tech = { id: 'tech', productIndex: 'A', variant: 'base', materials: [{ ...material, id: 'pp', usage: 0.02, category: 'Tworzywo', logisticQty: 1 }] };
  const h = createHeaderFixture({
    technologyForItem: () => tech, technologiesFor: () => [tech], materialsForItem: () => tech.materials,
    itemProductionQty: (item) => item.id === 'item-0' ? 1000 : 2400,
    materialDemandContributionsForItem: (item) => [{ material, demand: item.id === 'item-0' ? 20 : 48 }],
    materialSupply: () => ({ demand: 68, toIssue: 18 }), technologyUsageInputUnit: () => 'g',
    technologyUsageForEditor: () => 20,
    state: { selectedAreaId: 'hala-2', inventorySourceDate: '2026-08-31',
      inventory: [{ ...material, areaId: 'hala-1', qty: 50 }, { ...material, areaId: 'hala-2', qty: 999 }], ...overrides }
  });
  h.ctx.state.plan = h.ctx.state.plan.slice(0, 2).map((item) => ({ ...item, areaId: 'hala-1', technologyId: 'tech' }));
  h.ctx.showAllPlanAreas = true;
  h.ctx.expandedPlan = 'item-0';
  return h;
};

test('expanded plan keeps units and shows item zone stock and the other detail demand', () => {
  const h = fixture();
  const html = h.html();
  assert.match(html, /Stan strefy/);
  assert.match(html, /J.m. wyniku/);
  assert.match(html, /Stan strefy Hala 1: 50 kg/);
  assert.match(html, /Ten detal · wybrany zakres/);
  assert.match(html, />20 kg</);
  assert.match(html, />48 kg</);
  assert.match(html, /31.08.2026/);
  assert.doesNotMatch(html, /999 kg/);
  assert.match(html, /popover="auto"/);
  assert.match(html, /popovertarget=/i);
});

test('changing the plan date never labels the previous stock as the new day measurement', () => {
  const html = fixture({ inventorySourceDate: '2026-08-30' }).html();
  assert.match(html, /Stan strefy Hala 1: Brak spisu/);
  assert.doesNotMatch(html, /50 kg/);
});

test('plan cell shows silo quantity separately and the hint includes other halls', () => {
  const h = fixture({ inventory: [
    { ...material, areaId: 'hala-1', qty: 50 },
    { ...material, areaId: 'shared', qty: 5000 },
    { ...material, areaId: 'hala-2', qty: 999 }
  ] });
  h.ctx.state.plan.push({ ...h.ctx.state.plan[1], id: 'item-2', index: 'OTHER-HALL', areaId: 'hala-2' });
  const html = h.html();
  assert.match(html, /Stan strefy Hala 1: 50 kg\. Silosy wspólne: 5000 kg/);
  assert.match(html, /Silosy: 5000 kg/);
  assert.match(html, /Silosy · wspólne dla wszystkich stref/);
  assert.match(html, /Inne detale · wszystkie strefy/);
  assert.match(html, />96 kg</);
  assert.match(html, /OTHER-HALL/);
  assert.match(html, /Hala 2/);
  assert.doesNotMatch(html, /999 kg/);
  h.ctx.state.inventorySourceDate = '2026-08-30';
  assert.doesNotMatch(h.html(), /5000 kg/);
});
