import assert from 'node:assert/strict';
import test from 'node:test';
import { createOriginalInventoryFixture } from './originalInventory.fixture.mjs';
import { buildZonePlanSummary } from './zoneStock.ts';
import { searchProductCatalog } from './productCatalogSearch.ts';

const black = { code: 'M-4-BSHŁ-786-014', name: 'BLACK BOX 200X400X265', unit: 'szt.' };
const cam = { code: 'M-1-WTO-ELUX-8703', name: 'CAM PIN D0013497', unit: 'szt.' };
const foil = { code: 'M-51-FO-3325', name: 'FOLIA PET 12/PE100 SZEROKOŚĆ 510MM AUTOMAT DO KOTWY', unit: 'kg' };
const date = '2026-10-28';
const catalogRow = (id, material, warehouse_code = 'M-1') => ({ id, name: material.name, index_code: material.code, unit: material.unit, warehouse_code });
const entry = (id, material, qty, extra = {}) => ({ id, name: material.name, qty, unit: material.unit,
  at: `${date}T06:00:00Z`, warehouse_id: 'hall-1', source_type: null, ...extra });
const fillers = Array.from({ length: 1205 }, (_, i) => catalogRow(`f-${i}`, { code: `F-${i}`, name: `A filler ${i}`, unit: 'kg' }));

function database(catalog, entries, options = {}) {
  const calls = [];
  const tables = { original_inventory_catalog: catalog, original_inventory_entries: entries,
    warehouses: [{ id: 'hall-1', name: 'Hala 1', is_active: true }, { id: 'hall-2', name: 'Hala 2', is_active: true }] };
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.orders = []; this.bounds = [0, 999]; }
    select(_fields, config) { this.count = config?.count; return this; }
    eq(key, value) { this.filters.push(row => row[key] === value); return this; }
    gte(key, value) { this.filters.push(row => new Date(row[key]) >= new Date(value)); return this; }
    lte(key, value) { this.filters.push(row => new Date(row[key]) <= new Date(value)); return this; }
    order(key) { this.orders.push(key); return this; }
    range(from, to) { this.bounds = [from, to]; return this; }
    then(a, b) { return this.run().then(a, b); }
    async run() {
      calls.push({ table: this.table, bounds: this.bounds, orders: this.orders });
      if (options.failTable === this.table && this.bounds[0] >= 1000) return { error: new Error('LATER_PAGE_FAILED'), data: null };
      const rows = tables[this.table].filter(row => this.filters.every(filter => filter(row))).sort((a, b) => {
        for (const key of this.orders) { const delta = String(a[key]).localeCompare(String(b[key])); if (delta) return delta; }
        return 0;
      });
      return { data: structuredClone(rows.slice(this.bounds[0], Math.min(this.bounds[1] + 1, this.bounds[0] + 1000))),
        error: null, count: this.count && !options.unknownCount ? rows.length : null };
    }
  }
  return { db: { from: table => new Query(table) }, calls };
}

test('inventory resolves full ERP indices beyond the first 1000 catalog rows', async () => {
  const catalog = [...fillers, ...[black, cam, foil].flatMap((material, i) => [
    catalogRow(`short-${i}`, { ...material, code: ['9577', '8703', '3325'][i] }, null),
    catalogRow(`full-${i}`, material, ['M-4', 'M-1', 'M-51'][i])
  ])];
  const entries = [entry('b1', black, 3), entry('b2', black, 36, { source_type: 'PALLET_SET' }),
    entry('c1', cam, 10000), entry('c2', cam, 45000), entry('f', foil, 37)];
  const { db, calls } = database(catalog, entries);
  const result = await createOriginalInventoryFixture(db).load(date);
  const summary = buildZonePlanSummary({ areaId: 'hala-1', inventory: result.rows, stockReady: true,
    sources: [black, cam, foil].map((material, i) => ({ id: `order-${i}`, index: `P-${i}`, name: '', station: 'WTR 1',
      areaId: 'hala-1', included: true, contributions: [{ material, demand: [154, 39480, 0.105][i] }] })) });
  assert.equal(summary.find(row => row.code === black.code).stock, 39);
  assert.equal(summary.find(row => row.code === black.code).balance, -115);
  assert.equal(summary.find(row => row.code === cam.code).stock, 55000);
  assert.equal(summary.find(row => row.code === cam.code).balance, 15520);
  assert.equal(summary.find(row => row.code === foil.code).stock, 37);
  assert.ok(summary.every(row => row.stockStatus === 'ready'));
  assert.ok(result.rows.every(row => row.identitySource === 'name'));
  assert.ok(calls.some(call => call.table === 'original_inventory_catalog' && call.bounds[0] >= 1000));
  assert.ok(calls.filter(call => call.table === 'original_inventory_catalog').every(call => call.orders.includes('id')));
});

test('same-named catalog indices remain hints, not identities recorded in the physical count', async () => {
  const material = { code: 'M-10-PWY-BSHL-10008', name: 'TRAY HANDLE ASSEMBLY WELDED COST IRON', unit: 'szt.' };
  const { db } = database([catalogRow('a-legacy', { ...material, code: 'M-10-8001236303' }, 'M-10'),
    catalogRow('b-current', material, 'M-10')], [entry('count', material, 510)]);
  const { rows } = await createOriginalInventoryFixture(db).load(date);
  assert.equal(rows[0].code, 'M-10-8001236303');
  assert.equal(rows[0].identitySource, 'name');
  const [summary] = buildZonePlanSummary({ areaId: 'hala-1', inventory: rows, stockReady: true,
    sources: [200, 200, 110].map((demand, i) => ({ id: `order-${i}`, index: `P-${i}`, name: '', station: 'WTR 1',
      areaId: 'hala-1', included: true, contributions: [{ material, demand }] })) });
  assert.equal(summary.stock, 510);
  assert.equal(summary.demand, 510);
  assert.equal(summary.balance, 0);
});

test('catalog hints do not collapse measurements recorded under distinct names', async () => {
  const other = { ...cam, name: 'OTHER CAM PIN' };
  const { db } = database([catalogRow('a', cam), catalogRow('b', other)], [entry('a', cam, 10), entry('b', other, 20)]);
  const { rows } = await createOriginalInventoryFixture(db).load(date);
  assert.equal(rows.length, 2);
  assert.equal(rows.find(row => row.name === cam.name).qty, 10);
  assert.equal(rows.find(row => row.name === other.name).qty, 20);
});

test('all measurement pages are loaded, including quantities and protected stock on the last page', async () => {
  const entries = Array.from({ length: 1002 }, (_, i) => entry(`entry-${String(i).padStart(4, '0')}`, cam, 1,
    i === 1001 ? { source_type: 'FIXED_DEVICE' } : {}));
  const { db, calls } = database([catalogRow('full', cam)], entries);
  const { rows } = await createOriginalInventoryFixture(db).load(date);
  assert.equal(rows[0].qty, 1002);
  assert.equal(rows[0].protectedQty, 1);
  assert.equal(calls.filter(call => call.table === 'original_inventory_entries').length, 2);
});

test('date, zone and shared silo boundaries are preserved and missing measurements are not zero', async () => {
  const { db } = database([catalogRow('b', black), catalogRow('c', cam)], [
    entry('before', black, 999, { at: '2026-10-27T22:59:59Z' }), entry('start', black, 3, { at: '2026-10-27T23:00:00Z' }),
    entry('end', black, 4, { at: '2026-10-28T22:59:59Z' }), entry('after', black, 999, { at: '2026-10-28T23:00:00Z' }),
    entry('hall2', black, 20, { warehouse_id: 'hall-2' }), entry('silo', black, 500, { source_type: 'SILO' }),
    entry('warehouse', black, 800, { warehouse_id: 'main-stock' })
  ]);
  const { rows } = await createOriginalInventoryFixture(db).load(date);
  assert.equal(rows.length, 3);
  assert.equal(rows.find(row => row.areaId === 'hala-1').qty, 7);
  assert.equal(rows.find(row => row.areaId === 'hala-2').qty, 20);
  assert.equal(rows.find(row => row.areaId === 'silosy').qty, 500);
  assert.ok(rows.every(row => row.code !== cam.code));
});

test('missing catalog count still loads every page and keeps catalog search enrichment', async () => {
  const { db } = database([...fillers, catalogRow('c', cam)], [], { unknownCount: true });
  const result = await createOriginalInventoryFixture(db).catalog();
  assert.equal(result.length, fillers.length + 1);
  assert.equal(result.find(row => row.name === cam.name).index, cam.code);
});

test('catalog choices preserve different indices with the same product name', async () => {
  const name = 'MAX CP+TH PRINTED F1_WQ33G2D00';
  for (const warehouse of [null, 'M-10']) {
    const codes = ['9001970413', '9001972083'];
    const { db } = database(codes.map(code => catalogRow(code, { name, code, unit: 'szt.' }, warehouse)), []);
    const items = await createOriginalInventoryFixture(db).catalog();
    assert.deepEqual(searchProductCatalog(items, name, 'product-name').map(row => row.index).sort(), codes);
    for (const code of codes) {
      assert.deepEqual(searchProductCatalog(items, code, 'product-index').map(row => row.index), [code]);
    }
  }
});

test('warehouse enrichment hides only the same indexed identity, not another same-named product', async () => {
  const name = 'MAX CP+TH PRINTED F1_WQ33G2D00';
  const { db } = database([
    catalogRow('old', { name, code: '9001970413', unit: 'szt.' }, null),
    catalogRow('new', { name, code: '9001972083', unit: 'szt.' }, null),
    catalogRow('enriched', { name, code: '9001972083', unit: 'szt.' }, 'M-10'),
    catalogRow('fallback', { name, code: '', unit: 'szt.' }, null)
  ], []);
  const items = await createOriginalInventoryFixture(db).catalog();
  assert.deepEqual(items.map(row => row.id).sort(), ['enriched', 'old']);
});

test('catalog search still deduplicates identical name, index and warehouse rows', async () => {
  const material = { name: 'MAX CP+TH PRINTED F1_WQ33G2D00', code: '9001972083', unit: 'szt.' };
  const { db } = database([catalogRow('first', material, null), catalogRow('second', material, null)], []);
  const items = await createOriginalInventoryFixture(db).catalog();
  assert.equal(items.length, 1);
  assert.equal(items[0].index, material.code);
});

test('paged catalog presents a primary/secondary pair once without changing inventory matching', async () => {
  const name = 'TRAY HANDLE INSERT BO CLIPPED + HS';
  const primary = { name, code: 'M-10-PWY-BSHL-10012', unit: 'szt.' };
  const { db } = database([...fillers, {...catalogRow('a', primary, 'M-10'), index_code2: '8001103471'}], [entry('count', primary, 2371)]);
  const fixture = createOriginalInventoryFixture(db);
  const catalog = await fixture.catalog();
  const choices = searchProductCatalog(catalog, name, 'material-name');
  assert.equal(choices.length, 1);
  assert.equal(choices[0].index2, '8001103471');
  assert.equal(searchProductCatalog(catalog, primary.code, 'material-code')[0].id, choices[0].id);
  const { rows } = await fixture.load(date);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code, primary.code);
  assert.equal(rows[0].qty, 2371);
});

test('later-page failures never return a misleading partial inventory', async () => {
  for (const failTable of ['original_inventory_catalog', 'original_inventory_entries']) {
    const { db } = database([...fillers, catalogRow('c', cam)], Array.from({ length: 1002 }, (_, i) => entry(`entry-${i}`, cam, 1)), { failTable });
    await assert.rejects(createOriginalInventoryFixture(db).load(date), /LATER_PAGE_FAILED/);
  }
});

test('legacy M-10 rows become one planning choice with both full indices, without changing counted stock', async () => {
  const name='TRAY HANDLE ASSEMBLY WELDED COST IRON';
  const primary={name,code:'M-10-PWY-BSHL-10008',unit:'szt.'};
  const secondary={...primary,code:'M-10-8001236303'};
  const {db}=database([...fillers,catalogRow('primary',primary,'M-10'),catalogRow('secondary',secondary,'M-10')],[entry('count',primary,184)]);
  const fixture=createOriginalInventoryFixture(db);
  const catalog=await fixture.catalog();
  for(const query of [name,primary.code,secondary.code]) {
    const results=searchProductCatalog(catalog,query,'material-code');
    assert.equal(results.length,1);
    assert.equal(results[0].index,primary.code);
    assert.equal(results[0].index2,secondary.code);
  }
  const {rows}=await fixture.load(date);
  assert.equal(rows.length,1);
  assert.equal(rows[0].qty,184);
});
