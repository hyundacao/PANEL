import assert from 'node:assert/strict';
import test from 'node:test';
import { buildZonePlanSummary } from './zoneStock.ts';
import { createHeaderFixture } from './planHeader.fixture.mjs';

const panel = { code: 'M-10-CP-VG1', name: 'CONTROL PANEL VG1 BO COAST IRON', unit: 'szt.' };
const source = (id, demand, overrides = {}) => ({
  id, index: `PRODUCT-${id}`, name: `Produkt ${id}`, station: 'ST 1', areaId: 'hala-1', included: true,
  contributions: [{ material: panel, demand }], ...overrides
});
const stock = (qty, overrides = {}) => ({ ...panel, qty, areaId: 'hala-1', ...overrides });
const summarize = (overrides = {}) => buildZonePlanSummary({
  areaId: 'hala-1', inventory: [stock(510)], sources: [source('A', 200), source('B', 305)], stockReady: true,
  sharedAreaIds: new Set(['silosy']), ...overrides
});

test('all orders for a material share one physical stock and expose a small surplus', () => {
  const rows = summarize();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].demand, 505);
  assert.equal(rows[0].stock, 510);
  assert.equal(rows[0].balance, 5);
  assert.equal(rows[0].marginPercent, 5 / 505 * 100);
  assert.deepEqual(rows[0].sources.map(row => row.id), ['A', 'B']);
});

test('one-piece shortfalls, zero buffer and fully covered materials remain visible', () => {
  assert.equal(summarize({ sources: [source('A', 511)] })[0].balance, -1);
  assert.equal(summarize({ inventory: [stock(501)] })[0].balance, -4);
  assert.equal(summarize({ inventory: [stock(505)] })[0].balance, 0);
  assert.equal(summarize({ inventory: [stock(1000)] }).length, 1);
});

test('excluded orders and other zones are not counted in the current zone', () => {
  const [row] = summarize({ sources: [source('A', 505), source('B', 800, { included: false }), source('C', 900, { areaId: 'hala-2' })],
    inventory: [stock(510), stock(7000, { areaId: 'hala-2' }), stock(8000, { areaId: 'warehouse' })] });
  assert.equal(row.demand, 505);
  assert.equal(row.stock, 510);
  assert.equal(row.sources.length, 1);
});

test('silos are shown separately and never added to every local balance', () => {
  const [row] = summarize({ inventory: [stock(510), stock(5000, { areaId: 'silosy' })], sources: [source('A', 511)] });
  assert.equal(row.sharedStock, 5000);
  assert.equal(row.balance, -1);
});

test('missing or stale measurements are not zero stock; recorded zero stays zero', () => {
  for (const options of [{ inventory: [] }, { stockReady: false }]) {
    const [row] = summarize(options);
    assert.equal(row.stock, null);
    assert.equal(row.balance, null);
    assert.equal(row.marginPercent, null);
  }
  assert.equal(summarize({ inventory: [stock(0)] })[0].balance, -505);
});

test('different known indices are never matched by their identical name', () => {
  const other = { ...panel, code: 'M-10-OTHER' };
  const rows = summarize({ sources: [source('A', 505), source('B', 30, { contributions: [{ material: other, demand: 30 }] })] });
  assert.equal(rows.length, 2);
  assert.equal(rows.find(row => row.code === other.code).stock, null);
  assert.equal(rows.find(row => row.code === panel.code).demand, 505);
});

test('compatible quantity scales aggregate into one row without counting stock twice', () => {
  const [row] = summarize({ sources: [source('A', 5), source('B', 0, {
    contributions: [{ material: { ...panel, unit: '1000szt.' }, demand: 0.5 }]
  })], inventory: [stock(0.51, { unit: '1000szt.' })] });
  assert.equal(row.unit, 'szt.');
  assert.equal(row.demand, 505);
  assert.equal(row.stock, 510);
  assert.equal(row.balance, 5);
});

test('unambiguous name-only demand joins its index without duplicating physical stock', () => {
  const rows = summarize({ sources: [source('A', 200), source('B', 305, {
    contributions: [{ material: { ...panel, code: '' }, demand: 305 }]
  })], inventory: [stock(510, { code: '' })] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code, panel.code);
  assert.equal(rows[0].demand, 505);
  assert.equal(rows[0].stock, 510);
  assert.equal(rows[0].balance, 5);
});

test('ambiguous name-only inventory cannot supply two different indices', () => {
  const other = { ...panel, code: 'M-10-OTHER' };
  const rows = summarize({ sources: [source('A', 505), source('B', 30, {
    contributions: [{ material: other, demand: 30 }]
  })], inventory: [stock(510, { code: '' })] });
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.stock === null && row.balance === null));
});

test('ambiguous name-only demand remains separate from both known indices', () => {
  const other = { ...panel, code: 'M-10-OTHER' };
  const rows = summarize({ sources: [source('A', 200), source('B', 30, {
    contributions: [{ material: other, demand: 30 }]
  }), source('C', 40, { contributions: [{ material: { ...panel, code: '' }, demand: 40 }] })],
  inventory: [stock(510), stock(50, { code: other.code })] });
  assert.equal(rows.length, 3);
  assert.equal(rows.find(row => row.code === panel.code).demand, 200);
  assert.equal(rows.find(row => row.code === other.code).demand, 30);
  assert.equal(rows.find(row => !row.code).stock, null);
});

test('catalog-inferred legacy index cannot hide a named TRAY HANDLE count', () => {
  const material = { code: 'M-10-PWY-BSHL-10008', name: 'TRAY HANDLE ASSEMBLY WELDED COST IRON', unit: 'szt.' };
  const [row] = summarize({ sources: [200, 200, 110].map((demand, i) => source(`tray-${i}`, demand, {
    contributions: [{ material, demand }]
  })), inventory: [{ ...material, code: 'M-10-8001236303', identitySource: 'name', qty: 510, areaId: 'hala-1' }] });
  assert.equal(row.stock, 510);
  assert.equal(row.demand, 510);
  assert.equal(row.balance, 0);
  assert.equal(row.stockMatchedByName, true);
  assert.equal(row.stockStatus, 'ready');
  assert.equal(row.sources.length, 3);
});

test('a named count is not promised to two distinct indices used in the same zone', () => {
  const materials = ['A22154703', 'A22154704'].map(code => ({ code, name: 'IRIS LR WHEEL', unit: 'szt.' }));
  const rows = summarize({ sources: materials.map(material => source(material.code, 100, { contributions: [{ material, demand: 100 }] })),
    inventory: [{ ...materials[0], qty: 510, areaId: 'hala-1', identitySource: 'name' }] });
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.stock === null && row.balance === null && row.stockStatus === 'ambiguous'));
});

test('an actual counted index remains authoritative even when another index has the same name', () => {
  const [row] = summarize({ inventory: [stock(510, { code: 'OTHER-INDEX' })] });
  assert.equal(row.stock, null);
  assert.equal(row.balance, null);
});

test('a unique matching index hint still links renamed stock to its material', () => {
  const [row] = summarize({ inventory: [stock(510, { name: 'OLD CONTROL PANEL NAME', identitySource: 'name' })] });
  assert.equal(row.stock, 510);
  assert.equal(row.balance, 5);
  assert.equal(row.stockMatchedByName, true);
});

test('name-based stock is never borrowed from a different zone or unrelated product name', () => {
  const rows = summarize({ inventory: [stock(510, { code: 'OLD', identitySource: 'name', areaId: 'hala-2' }),
    stock(900, { code: 'UNRELATED', name: 'OTHER SYSTEM', identitySource: 'name' })] });
  assert.equal(rows[0].stock, null);
});

test('kilograms and grams combine, incompatible stock units stay unknown', () => {
  const material = { code: 'PP', name: 'PP', unit: 'kg' };
  const sources = [source('A', 0, { contributions: [{ material, demand: 20 }, { material: { ...material, unit: 'g' }, demand: 3000 }] })];
  const rows = summarize({ sources, inventory: [{ ...material, qty: 25000, unit: 'g', areaId: 'hala-1' }] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].demand, 23);
  assert.equal(rows[0].stock, 25);
  assert.equal(rows[0].balance, 2);
  const [unknown] = summarize({ sources, inventory: [{ ...material, qty: 25, unit: 'l', areaId: 'hala-1' }] });
  assert.equal(unknown.stockStatus, 'incompatible');
  assert.equal(unknown.balance, null);
});

test('unknown demand stays unknown while incomplete plan comparisons are explicitly provisional', () => {
  assert.equal(summarize({ sources: [source('A', null)] })[0].demand, null);
  assert.equal(summarize({ sources: [source('A', null)] })[0].balance, null);
  assert.equal(summarize({ incompletePlan: true })[0].balance, 5);
  assert.equal(summarize({ incompletePlan: true })[0].balancePartial, true);
  assert.equal(summarize()[0].balancePartial, false);
  assert.equal(summarize({ incompletePlan: true, sources: [source('A', null)] })[0].balancePartial, false);
});

test('known shortage, surplus and exact coverage remain visible despite unrelated plan issues', () => {
  for (const [demand, qty, balance] of [[1170, 265, -905], [510, 184, -326], [2000, 12200, 10200], [2000, 2000, 0], [2, 7, 5]]) {
    const [row] = summarize({ sources: [source('A', demand)], inventory: [stock(qty)], incompletePlan: true });
    assert.equal(row.balance, balance);
    assert.equal(row.balancePartial, true);
  }
});

test('summary is read-only and shortages sort ahead of small and large surpluses', () => {
  const materials = ['short', 'small', 'large'].map(code => ({ ...panel, code }));
  const sources = materials.map(material => source(material.code, 0, { contributions: [{ material, demand: 500 }] }));
  const inventory = materials.map((material, i) => ({ ...stock([490, 505, 1000][i]), ...material }));
  const before = JSON.stringify({ sources, inventory });
  assert.deepEqual(summarize({ sources, inventory }).map(row => row.code), ['short', 'small', 'large']);
  assert.equal(JSON.stringify({ sources, inventory }), before);
});

const fixture = (overrides = {}) => createHeaderFixture({
  technologyForItem: () => ({ id: 'tech' }), linkedSourceIssuesForArea: () => [],
  materialDemandContributionsForItem: item => [{ material: panel, demand: item.id === 'item-0' ? 200 : 305 }],
  state: { selectedAreaId: 'bakoma', inventorySourceDate: '2026-08-31', inventory: [stock(510, { areaId: 'bakoma' })], ...overrides }
});

test('actual document view shows the summary even when no picking document is needed', () => {
  const h = fixture();
  const before = JSON.stringify(h.ctx.state);
  const html = h.html('dokument');
  assert.match(html, /Brak zapisanych dokumentów/);
  assert.match(html, /Podsumowanie strefy/);
  assert.match(html, /CONTROL PANEL VG1 BO COAST IRON/);
  assert.match(html, />505</);
  assert.match(html, />510</);
  assert.match(html, />\+5</);
  assert.match(html, /\+0,99%/);
  assert.equal(JSON.stringify(h.ctx.state), before);
});

test('actual document view distinguishes stale stock and incomplete production norms', () => {
  assert.match(fixture({ inventorySourceDate: '2026-08-30' }).html('dokument'), /Brak spisu/);
  const h = fixture();
  h.ctx.state.plan[0].shiftNorm = 0;
  const html = h.html('dokument');
  assert.match(html, /Niepełne dane w planie/);
  assert.match(html, /900197690 · MAX CP\+TH PRINTED F1_WQ35G2D0ES_A · ST 1: brak normy na zmianę/);
  assert.match(html, /Brak pełnego zapotrzebowania/);
  assert.doesNotMatch(html, /\+0,99%/);
});

test('an unrelated position without technology no longer erases known row comparisons', () => {
  const h = fixture();
  h.ctx.state.plan.push({ ...h.ctx.state.plan[0], id: 'missing-tech', index: 'UNKNOWN', name: 'Nieuzupełniona pozycja' });
  h.ctx.technologyForItem = item => item.id === 'missing-tech' ? undefined : { id: 'tech' };
  h.ctx.materialDemandContributionsForItem = item => item.id === 'missing-tech' ? [] : [{ material: panel, demand: item.id === 'item-0' ? 200 : 305 }];
  const html = h.html('dokument');
  assert.match(html, /UNKNOWN · Nieuzupełniona pozycja · ST 1: brak technologii/);
  assert.match(html, />\+5</);
  assert.match(html, /Wstępnie/);
});

test('linked-source issues identify the affected item instead of blocking the whole table', () => {
  const h = fixture();
  h.ctx.linkedSourceIssuesForArea = () => ['PRODUCT-A: wybierz źródło półwyrobu PART-B.'];
  const html = h.html('dokument');
  assert.match(html, /PRODUCT-A: wybierz źródło półwyrobu PART-B/);
  assert.match(html, />\+5</);
  assert.match(html, /Wstępnie/);
});
