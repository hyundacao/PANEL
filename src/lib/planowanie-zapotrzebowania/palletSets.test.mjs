import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import * as domain from './palletSets.ts';
import * as dates from '../utils/productionPlanDate.ts';
import { sharedPlanningState, privatePlanningState, rebaseSharedPlanningChanges } from './stateScopes.ts';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const serverFile = fileURLToPath(new URL('./palletInventoryServer.ts', import.meta.url));
const mod = new Module(serverFile);
mod.require = (id) => id === './palletSets' ? domain : id === '@/lib/utils/productionPlanDate' ? dates : require(id);
mod._compile(ts.transpileModule(readFileSync(serverFile, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, serverFile);
const api = mod.exports;
const BATCH = 'e3043001-18c5-4ed2-9d89-e24d0c225818';
const part = (catalogId, qty) => ({ catalogId, name: catalogId, indexCode: catalogId, indexCode2: catalogId, warehouseCode: 'M-4', unit: 'szt.', qty });
const profile = () => ({ id: 'test-set', name: 'Test only: container set', primaryCatalogId: 'container', active: true,
  components: [part('container', 40), part('lid', 1), part('pallet', 1)] });
const request = (set = profile(), overrides = {}) => ({ batchId: BATCH, setId: set.id, fingerprint: domain.palletSetFingerprint(set), dateKey: '2026-09-19', warehouseId: 'hall-2', count: 3, ...overrides });

function database() {
  const state = { profile: profile(), rows: [], writes: [], failInsert: false, catalogMissing: false };
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.mode = 'select'; }
    select() { return this; }
    eq(key, value) { this.filters.push((row) => row[key] === value); return this; }
    like(key, value) { this.filters.push((row) => row[key]?.startsWith(value.slice(0, -1))); return this; }
    in(key, values) { this.filters.push((row) => values.includes(row[key])); return this; }
    insert(rows) { this.mode = 'insert'; this.rows = structuredClone(rows); return this; }
    upsert(rows) { this.mode = 'upsert'; this.rows = structuredClone(rows); return this; }
    delete() { this.mode = 'delete'; return this; }
    maybeSingle() { return this.run(true); }
    then(a, b) { return this.run(false).then(a, b); }
    async run(single) {
      let rows;
      if (this.table === 'material_planning_state') rows = [{ id: 'main', pallet_sets: [state.profile] }];
      else if (this.table === 'warehouses') rows = [{ id: 'hall-2', name: 'Hala 2', is_active: true }, { id: 'hall-1', name: 'Hala 1', is_active: true }];
      else if (this.table === 'original_inventory_catalog') rows = state.catalogMissing ? [] : state.profile.components.map((p) => ({ id: p.catalogId, name: p.name, unit: p.unit }));
      else { assert.equal(this.table, 'original_inventory_entries'); rows = state.rows; }
      let result = rows.filter((row) => this.filters.every((filter) => filter(row)));
      if (this.mode !== 'select') {
        state.writes.push({ mode: this.mode, rows: this.rows });
        if (this.mode === 'insert') {
          if (state.failInsert) return { data: null, error: { code: '23503' } };
          if (this.rows.some((row) => rows.some((existing) => existing.id === row.id))) return { data: null, error: { code: '23505' } };
          rows.push(...this.rows); result = this.rows;
        } else if (this.mode === 'upsert') {
          for (const row of this.rows) { const index = rows.findIndex((entry) => entry.id === row.id); if (index < 0) rows.push(row); else rows[index] = row; }
          result = this.rows;
        } else { state.rows = rows.filter((row) => !result.includes(row)); }
      }
      return { data: structuredClone(single ? result[0] ?? null : result), error: null };
    }
  }
  return { state, db: { from: (table) => new Query(table) } };
}

test('full pallets expand to ordinary stock quantities, never fractional wrappers', () => {
  assert.deepEqual(domain.palletSetTotals(profile(), 3).map((part) => part.total), [120, 3, 3]);
  for (const count of [0, -1, 0.5, NaN, Infinity, '3']) assert.deepEqual(domain.palletSetTotals(profile(), count), []);
});

test('profiles require precise catalog identities, piece units and positive whole quantities', () => {
  assert.equal(domain.palletSetError(profile()), null);
  for (const set of [ { ...profile(), primaryCatalogId: 'unknown' }, { ...profile(), name: '' },
    { ...profile(), components: [part('x', 0)] }, { ...profile(), components: [part('container', 2), part('container', 3)] },
    { ...profile(), components: [{ ...part('container', 2), unit: 'kg' }] } ]) assert.ok(domain.palletSetError(set));
  assert.equal(domain.validPalletSetsState([profile()]), true);
  assert.equal(domain.validPalletSetsState([profile(), profile()]), false);
});

test('snapshot source keys preserve original ratios and tolerate complex catalog identifiers', () => {
  const source = { batchId: BATCH, catalogId: 'M-4:test/one', qtyPerSet: 40 };
  assert.deepEqual(domain.parsePalletSource(domain.palletSourceId(source)), source);
  for (const value of ['', 'silo:x:2026-09-19', `pallet:v1:${BATCH}:%BAD`, `pallet:v1:${BATCH}:null`]) assert.equal(domain.parsePalletSource(value), null);
  assert.throws(() => domain.palletBatchPrefix('%'), /INVALID_PALLET_BATCH/);
});

test('pallet definitions are shared and independent edits to different definitions merge', () => {
  const one = profile(); const two = { ...profile(), id: 'second' };
  const state = { plan: [{ id: 'private' }], palletSets: [one, two] };
  assert.deepEqual(sharedPlanningState(state), { palletSets: [one, two] });
  assert.deepEqual(privatePlanningState(state), { plan: state.plan });
  const result = rebaseSharedPlanningChanges(state, { ...state, palletSets: [{ ...one, name: 'A' }, two] }, { ...state, palletSets: [one, { ...two, name: 'B' }] });
  assert.deepEqual(result.palletSets.map((set) => set.name), ['A', 'B']);
});

test('one inventory operation atomically inserts all components into the selected hall and day', async () => {
  const { db, state } = database();
  await api.addPalletInventory(db, request(), 'counter');
  assert.equal(state.writes.length, 1);
  assert.equal(state.rows.length, 3);
  assert.deepEqual(state.rows.map((row) => row.qty), [120, 3, 3]);
  assert.ok(state.rows.every((row) => row.warehouse_id === 'hall-2' && row.at.startsWith('2026-09-19') && row.user_name === 'counter' && row.unit === 'szt.'));
});

test('lost-response retries and simultaneous duplicate submits do not double stock', async () => {
  const { db, state } = database();
  await Promise.all([api.addPalletInventory(db, request(), 'a'), api.addPalletInventory(db, request(), 'a')]);
  await api.addPalletInventory(db, request(), 'a');
  assert.equal(state.rows.length, 3);
  assert.equal(state.rows.reduce((sum, row) => sum + row.qty, 0), 126);
});

test('invalid quantities, inactive/stale definitions and missing catalog rows cannot write stock', async () => {
  for (const overrides of [{ count: 1.5 }, { count: 0 }, { count: '3' }, { dateKey: '2026-02-30' }, { warehouseId: 'unknown' }, { fingerprint: 'old' }]) {
    const { db, state } = database();
    await assert.rejects(api.addPalletInventory(db, request(profile(), overrides), 'counter'));
    assert.equal(state.writes.length, 0);
  }
  const { db, state } = database(); state.profile.active = false;
  await assert.rejects(api.addPalletInventory(db, request(), 'counter'), /PALLET_SET_NOT_FOUND/);
  state.profile.active = true; state.catalogMissing = true;
  await assert.rejects(api.addPalletInventory(db, request(), 'counter'), /PALLET_CATALOG_CHANGED/);
  assert.equal(state.writes.length, 0);
});

test('reusing a batch key with a different count, hall or day fails without changing stock', async () => {
  const { db, state } = database();
  await api.addPalletInventory(db, request(), 'counter');
  for (const change of [{ count: 4 }, { warehouseId: 'hall-1' }, { dateKey: '2026-09-20' }]) {
    await assert.rejects(api.addPalletInventory(db, request(profile(), change), 'counter'), /PALLET_BATCH_CONFLICT/);
  }
  assert.deepEqual(state.rows.map((row) => row.qty), [120, 3, 3]);
  assert.equal(state.writes.length, 1);
});

test('failure during a batch does not leave partial stock', async () => {
  const { db, state } = database(); state.failInsert = true;
  await assert.rejects(api.addPalletInventory(db, request(), 'counter'));
  assert.equal(state.rows.length, 0);
});

test('editing a saved batch uses its snapshot, not a changed or disabled definition', async () => {
  const { db, state } = database();
  await api.addPalletInventory(db, request(), 'counter');
  state.profile.components[0].qty = 200; state.profile.active = false;
  await api.updatePalletInventory(db, { batchId: BATCH, count: 2, warehouseId: 'hall-1' }, 'editor');
  assert.deepEqual(state.rows.map((row) => row.qty), [80, 2, 2]);
  assert.ok(state.rows.every((row) => row.warehouse_id === 'hall-1' && row.at.startsWith('2026-09-19')));
  assert.equal(state.writes.at(-1).mode, 'upsert');
  assert.equal(state.writes.at(-1).rows.length, 3);
});

test('deleting a batch removes only its components, preserving other days and halls', async () => {
  const { db, state } = database();
  await api.addPalletInventory(db, request(), 'counter');
  await api.addPalletInventory(db, request(profile(), { batchId: 'e3043001-18c5-4ed2-9d89-e24d0c225819', dateKey: '2026-09-20', warehouseId: 'hall-1' }), 'other');
  await api.removePalletInventory(db, BATCH);
  assert.equal(state.rows.length, 3);
  assert.ok(state.rows.every((row) => row.at.startsWith('2026-09-20') && row.warehouse_id === 'hall-1'));
});

test('no extra pallet counting panel is added; the existing search exposes set mode', () => {
  const source = readFileSync(new URL('../../components/planowanie-zapotrzebowania/SpisRzeczywisty.tsx', import.meta.url), 'utf8');
  assert.match(source, /aria-label="Sposób spisu"/);
  assert.match(source, /set\.primaryCatalogId === selectedCatalogId/);
  assert.doesNotMatch(source, /Stałe zestawy paletowe/);
});
