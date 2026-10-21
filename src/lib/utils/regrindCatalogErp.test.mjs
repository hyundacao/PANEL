import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
function loader(mocks = {}) {
  const cache = new Map();
  function load(file) {
    const path = [file, `${file}.ts`, join(file, 'index.ts')].find(existsSync);
    assert.ok(path, file);
    if (cache.has(path)) return cache.get(path).exports;
    const mod = new Module(path); cache.set(path, mod);
    mod.require = (name) => Object.hasOwn(mocks, name) ? mocks[name] : name.startsWith('@/') ? load(join(root, name.slice(2))) : name.startsWith('.') ? load(resolve(dirname(path), name)) : require(name);
    mod._compile(ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, path);
    return mod.exports;
  }
  return load;
}
const { matchRegrindCatalogErpStocks: match } = loader()(join(root, 'lib/utils/regrindCatalogErp.ts'));
const stock = (name, realQty, extra = {}) => ({ name, realQty, availableQty: realQty - 10, unit: 'kg', indexCode: 'M-40-1', ...extra });

test('ERP is matched once per catalog, with exact names and normalized hyphens', () => {
  assert.deepEqual(match(['PRZEMIAŁ ABS BLACK - 9203', ' PRZEMIAŁ ABS BLACK - 9203 '], [stock('PRZEMIAŁ ABS BLACK-9203', 1544.204)], []), [
    { catalog: 'PRZEMIAŁ ABS BLACK - 9203', erpQty: 1544.204, indexCode: 'M-40-1' }
  ]);
});

test('missing, different and ambiguous indices are never shown as zero or fuzzy-matched', () => {
  const rows = [stock('ABS', 0), stock('ABS Z GRAFIKA', 70, { indexCode: 'M-40-2' })];
  assert.equal(match(['ABS'], rows, [])[0].erpQty, 0);
  assert.equal(match(['ABS CZARNY'], rows, [])[0].erpQty, null);
  assert.equal(match([''], rows, [])[0].erpQty, null);
  assert.equal(match(['ABS'], [...rows, stock('ABS', 20, { indexCode: 'M-40-3' })], [])[0].erpQty, null);
  assert.equal(match(['ABS'], [stock('ABS', 3, { unit: 'szt.' })], [])[0].erpQty, null);
  assert.equal(match(['ABS'], [stock('ABS', NaN)], [])[0].erpQty, null);
});

test('saved aliases resolve an ERP index, never another index with the same old name', () => {
  const catalog = [{ name: 'NEW ABS', previousNames: ['OLD ABS'], unit: 'kg', indexCode: 'M-40-1' }];
  assert.equal(match(['OLD ABS'], [stock('NEW ABS', 45)], catalog)[0].erpQty, 45);
  assert.equal(match(['OLD ABS'], [stock('OLD ABS', 99, { indexCode: 'OTHER' })], catalog)[0].erpQty, null);
  assert.equal(match(['M-40-1'], [stock('NEW ABS', 45)], [])[0].erpQty, 45);
});

test('quantities of the same index across warehouses sum once, but different indices do not', () => {
  const rows = [stock('ABS', 10), stock('ABS', 15)];
  assert.equal(match(['ABS', 'ABS'], rows, [])[0].erpQty, 25);
  rows[1].indexCode = 'OTHER';
  assert.equal(match(['ABS'], rows, [])[0].erpQty, null);
});

function fixture() {
  const state = {
    user: { id: 'viewer', name: 'Viewer', role: 'VIEWER', access: { warehouses: { PRZEMIALY: { tabs: ['kartoteka'], readOnly: true } } } },
    fail: false, reads: [],
    materials: [{ id: 'one', name: 'Detail one', is_active: true, material_catalogs: { name: 'ABS' } },
      { id: 'two', name: 'Detail two', is_active: true, material_catalogs: { name: 'ABS' } },
      { id: 'old', name: 'Inactive', is_active: false, material_catalogs: { name: 'INACTIVE' } }],
    snapshots: [{ id: 'latest', snapshot_date: '2026-10-21', name: 'ABS', unit: 'kg', index_code: 'M-40-1', real_qty: 44, available_qty: 22, imported_at: '2026-10-21T09:00:00Z' },
      { id: 'older', snapshot_date: '2026-10-20', name: 'ABS', unit: 'kg', index_code: 'M-40-1', real_qty: 999, available_qty: 888, imported_at: '2026-10-20T10:00:00Z' }]
  };
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.orders = []; this.page = null; this.size = null; }
    select(columns) { this.columns = columns; return this; }
    order(key, options) { this.orders.push([key, options.ascending]); return this; }
    limit(size) { this.size = size; return this; }
    in(key, values) { this.filters.push([key, values]); return this; }
    range(start, end) { this.page = [start, end]; return this; }
    then(a, b) { return this.run().then(a, b); }
    async maybeSingle() { const result = await this.run(); return { ...result, data: result.data?.[0] ?? null }; }
    async run() {
      state.reads.push({ table: this.table, filters: this.filters, page: this.page });
      if (state.fail) return { data: null, error: { message: 'Simulated read failure' } };
      assert.ok(['materials', 'original_inventory_erp_snapshots', 'original_inventory_catalog'].includes(this.table));
      let rows = structuredClone(this.table === 'materials' ? state.materials : this.table === 'original_inventory_erp_snapshots' ? state.snapshots : []);
      for (const [key, values] of this.filters) rows = rows.filter(row => values.includes(row[key]));
      rows.sort((a, b) => { for (const [key, ascending] of this.orders) { const diff = String(a[key]).localeCompare(String(b[key])); if (diff) return ascending ? diff : -diff; } return 0; });
      const count = rows.length;
      if (this.page) rows = rows.slice(this.page[0], this.page[1] + 1);
      if (this.size) rows = rows.slice(0, this.size);
      return { data: rows, error: null, count };
    }
  }
  const load = loader({
    '@/lib/auth/session': { getAuthenticatedUser: async () => ({ user: state.user, code: 'UNAUTHORIZED' }), clearSessionCookie() {} },
    '@/lib/supabase/admin': { supabaseAdmin: { from: table => new Query(table) } },
    '@/lib/push/server': {}
  });
  const route = load(join(root, 'app/api/app/route.ts'));
  return { state, get: (action = 'getRegrindCatalogErpComparison') => route.POST(new Request('http://test/api/app', {
    method: 'POST', body: JSON.stringify({ action, payload: {} })
  })) };
}

test('API returns latest ERP real quantities only for active regrind catalogs, including read-only catalog users', async () => {
  const f = fixture();
  const response = await f.get();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    snapshotDate: '2026-10-21', importedAt: '2026-10-21T09:00:00Z', items: [{ catalog: 'ABS', erpQty: 44, indexCode: 'M-40-1' }]
  });
  assert.equal((await f.get('getOriginalInventoryErpSnapshot')).status, 403, 'this feature does not grant full ERP access');
  assert.ok(f.state.reads.every(read => ['materials', 'original_inventory_catalog', 'original_inventory_erp_snapshots'].includes(read.table)));
});

test('latest snapshot read is paginated and never falls back to an older stock for a missing material', async () => {
  const f = fixture();
  const latest = f.state.snapshots[0];
  f.state.snapshots = [...Array.from({ length: 1001 }, (_, i) => ({ ...latest, id: `a-${i}`, name: `A ${i}`, index_code: `irrelevant-${i}` })),
    { ...latest, name: 'ZZ LAST', real_qty: 60 }, f.state.snapshots[1]];
  f.state.materials.push({ id: 'last', is_active: true, material_catalogs: { name: 'ZZ LAST' } });
  const response = await f.get();
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.items.map(item => item.erpQty), [null, 60]);
  assert.ok(f.state.reads.some(read => read.table === 'original_inventory_erp_snapshots' && read.page?.[0] === 1000));
});

test('no import is distinct from a read failure', async () => {
  const f = fixture(); f.state.snapshots = [];
  assert.deepEqual(await (await f.get()).json(), { snapshotDate: null, importedAt: null, items: [] });
  f.state.fail = true;
  assert.ok((await f.get()).status >= 400);
});

test('anonymous and users without stock catalog access cannot read the comparison', async () => {
  const f = fixture();
  f.state.user = null;
  assert.equal((await f.get()).status, 401);
  f.state.user = { role: 'USER', access: { warehouses: { PRZEMIALY: { tabs: ['spis'] } } } };
  assert.equal((await f.get()).status, 403);
  assert.deepEqual(f.state.reads, []);
});
