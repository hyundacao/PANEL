import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const XLSX = require('xlsx');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const material = (extra = {}) => ({ name: 'METAL BOX 1230X830X730', unit: 'szt.', indexCode: 'M-4-BSHL-786-015', warehouseCode: 'M-4', ...extra });
const row = (item, id = 'old') => ({ id, name: item.name, unit: item.unit, index_code: item.indexCode, warehouse_code: item.warehouseCode });

function fixture() {
  const state = {
    user: { id: 'test', username: 'counter', name: 'Counter', role: 'USER', access: { warehouses: { PLANOWANIE_ZAPOTRZEBOWANIA: { readOnly: false, tabs: ['planowanie-zapotrzebowania'] } } } },
    tables: { original_inventory_catalog: [], original_inventory_erp_snapshots: [], audit_logs: [] },
    operations: [], failCatalogRead: false, failCatalogWriteFrom: Infinity, catalogWrites: 0,
    beforeCatalogWrite: null, pdfItems: [], holdCatalogRead: null
  };
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.mode = 'select'; }
    select() { return this; }
    order(column) { this.orderColumn = column; return this; }
    range(from, to) { this.page = [from, to]; return this; }
    eq(column, value) { this.filters.push((row) => row[column] === value); return this; }
    in(column, values) { this.filters.push((row) => values.includes(row[column])); return this; }
    abortSignal(signal) { this.signal = signal; return this; }
    insert(rows) { this.mode = 'insert'; this.rows = Array.isArray(rows) ? rows : [rows]; return this; }
    upsert(rows, options) { this.mode = 'upsert'; this.rows = rows; this.options = options; return this; }
    delete() { this.mode = 'delete'; return this; }
    maybeSingle() { return this.run(true); }
    then(yes, no) { return this.run().then(yes, no); }
    async run(single = false) {
      state.operations.push({ table: this.table, mode: this.mode, size: this.rows?.length, page: this.page });
      const catalog = this.table === 'original_inventory_catalog';
      if (this.signal?.aborted || (catalog && this.mode === 'select' && state.failCatalogRead)) return { data: null, error: { code: 'CATALOG_UNAVAILABLE' } };
      const table = state.tables[this.table];
      assert.ok(table, `Unexpected table: ${this.table}`);
      let data = table.filter((row) => this.filters.every((filter) => filter(row)));
      const count = data.length;
      if (this.mode === 'insert' || this.mode === 'upsert') {
        if (catalog) {
          state.catalogWrites++;
          if (state.catalogWrites >= state.failCatalogWriteFrom) return { data: null, error: { code: 'CATALOG_WRITE_FAILED' } };
          if (state.beforeCatalogWrite) { const callback = state.beforeCatalogWrite; state.beforeCatalogWrite = null; await callback(this.rows); }
          assert.equal(this.options?.ignoreDuplicates, true, 'Catalog sync must be insert-only');
          assert.equal(this.options?.onConflict, 'id');
        }
        data = this.rows.filter((candidate) => !catalog || !table.some((old) => old.id === candidate.id));
        if (catalog && data.some((candidate) => table.some((old) => old.name.toLowerCase() === candidate.name.toLowerCase() && old.index_code?.toLowerCase() === candidate.index_code?.toLowerCase()))) return { data: null, error: { code: '23505' } };
        table.push(...structuredClone(data));
      } else if (this.mode === 'delete') state.tables[this.table] = table.filter((row) => !data.includes(row));
      else {
        if (this.orderColumn) data = [...data].sort((a, b) => String(a[this.orderColumn]).localeCompare(String(b[this.orderColumn])));
        if (this.page) data = data.slice(this.page[0], this.page[1] + 1);
      }
      const response = { data: structuredClone(single ? data[0] ?? null : data), count, error: null };
      if (catalog && this.mode === 'select' && state.holdCatalogRead) {
        const wait = state.holdCatalogRead; state.holdCatalogRead = null; await wait();
      }
      return response;
    }
  }
  const db = { from: (table) => new Query(table) };
  const mocks = {
    '@/lib/auth/session': { getAuthenticatedUser: async () => ({ user: state.user, code: 'UNAUTHORIZED' }), clearSessionCookie() {} },
    '@/lib/supabase/admin': { supabaseAdmin: db },
    '@/lib/push/server': {},
    '@/lib/utils/originalInventoryErpPdf': {
      isOriginalInventoryErpSnapshotPdfFile: (file) => file.name.endsWith('.pdf'),
      parseOriginalInventoryErpSnapshotPdfFile: async () => state.pdfItems
    }
  };
  const cache = new Map();
  const load = (file) => {
    const fullPath = [file, `${file}.ts`, join(file, 'index.ts')].find(existsSync);
    assert.ok(fullPath, file);
    if (cache.has(fullPath)) return cache.get(fullPath).exports;
    const mod = new Module(fullPath); cache.set(fullPath, mod);
    mod.require = (name) => mocks[name] ?? (name.startsWith('@/') ? load(join(root, name.slice(2))) : name.startsWith('.') ? load(resolve(dirname(fullPath), name)) : require(name));
    mod._compile(ts.transpileModule(readFileSync(fullPath, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, fullPath);
    return mod.exports;
  };
  const importRoute = load(join(root, 'app/api/original-inventory-erp-snapshot/import/route.ts'));
  const sync = (items) => load(join(root, 'lib/utils/originalInventoryCatalogSync.ts')).syncOriginalInventoryCatalogFromSnapshot(db, items);
  const importFile = async (items, date = '2026-09-28', pdf = false) => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['Nazwa', 'Stan do dyspozycji ERP', 'Stan rzeczywisty ERP', 'Jednostka', 'Indeks'],
      ...items.map((item) => [item.name, item.availableQty ?? 250, item.realQty ?? 300, item.unit, item.indexCode ?? ''])
    ]), 'Stany');
    const file = pdf ? new File(['PDF fixture'], 'stany.pdf') : new File([XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })], 'stany.xlsx');
    const form = new FormData(); form.append('file', file); form.append('snapshotDate', date);
    const response = await importRoute.POST(new Request('http://test/api/import', { method: 'POST', body: form }));
    return { status: response.status, result: await response.json() };
  };
  const app = async (action, payload = {}) => {
    const route = load(join(root, 'app/api/app/route.ts'));
    const response = await route.POST(new Request('http://test/api/app', { method: 'POST', body: JSON.stringify({ action, payload }) }));
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  return { state, sync, importFile, app };
}

test('ERP import saves stock and permanently adds only new catalog identities', async () => {
  const f = fixture();
  f.state.tables.original_inventory_catalog.push(row(material()));
  const newer = material({ name: 'NOWE TWORZYWO', indexCode: 'M-1-NEW', warehouseCode: 'M-1', unit: 'kg' });
  const { status, result } = await f.importFile([material(), newer]);
  assert.equal(status, 200);
  assert.equal(result.inserted, 2);
  assert.equal(result.catalogSync.added, 1);
  assert.equal(result.catalogSync.existing, 1);
  assert.equal(result.catalogSync.warningCount, 0);
  assert.equal(f.state.tables.original_inventory_catalog.length, 2);
  assert.equal(f.state.tables.original_inventory_catalog[0].id, 'old');
  const saved = f.state.tables.original_inventory_catalog[1];
  assert.equal(saved.name, newer.name);
  assert.equal(saved.unit, 'kg');
  assert.equal(saved.warehouse_code, 'M-1');
  assert.equal(saved.qty, undefined);
  assert.equal(saved.snapshot_date, undefined);
});

test('repeat imports, day replacement and missing rows on later days never duplicate or remove catalog entries', async () => {
  const f = fixture();
  const one = material();
  const two = material({ name: 'DRUGI', indexCode: 'M-4-SECOND' });
  await f.importFile([one, two]);
  const second = await f.importFile([{ ...one, availableQty: 0 }]);
  assert.equal(second.result.catalogSync.added, 0);
  assert.equal(second.result.replaced, 2);
  assert.equal(f.state.tables.original_inventory_erp_snapshots.length, 1);
  assert.equal(f.state.tables.original_inventory_erp_snapshots[0].available_qty, 0);
  await f.importFile([one], '2026-09-29');
  await f.app('removeOriginalInventoryErpSnapshot', { snapshotDate: '2026-09-28' });
  assert.equal(f.state.tables.original_inventory_catalog.length, 2);
  assert.equal(f.state.operations.some((op) => op.table === 'original_inventory_catalog' && ['delete', 'update'].includes(op.mode)), false);
});

test('missing codes do not block stocks and produce a non-blocking catalog warning', async () => {
  const f = fixture();
  const { status, result } = await f.importFile([material({ indexCode: null }), material({ name: 'NOWY' })]);
  assert.equal(status, 200);
  assert.equal(result.inserted, 2);
  assert.equal(result.catalogSync.added, 1);
  assert.equal(result.catalogSync.warningCount, 1);
  assert.match(result.catalogSync.warnings[0].reason, /Brak indeksu/);
});

test('same code with changed name or unit never overwrites an existing catalog row', async () => {
  const f = fixture();
  f.state.tables.original_inventory_catalog.push(row(material()));
  const original = structuredClone(f.state.tables.original_inventory_catalog);
  for (const candidate of [material({ name: 'RENAMED' }), material({ unit: 'kg' })]) {
    const response = await f.importFile([candidate]);
    assert.equal(response.status, 200);
    assert.equal(response.result.catalogSync.added, 0);
    assert.equal(response.result.catalogSync.warningCount, 1);
  }
  assert.deepEqual(f.state.tables.original_inventory_catalog, original);
});

test('conflicts inside one file are isolated and valid new materials still get permanent catalog entries', async () => {
  const f = fixture();
  const { result } = await f.importFile([material(), material({ name: 'INNA NAZWA' }), material({ name: 'DOBRY', indexCode: 'M-4-OK' })]);
  assert.equal(result.inserted, 3);
  assert.equal(result.catalogSync.warningCount, 1);
  assert.equal(result.catalogSync.added, 1);
  assert.equal(f.state.tables.original_inventory_catalog[0].name, 'DOBRY');
});

test('missing and inconsistent unit metadata never creates guessed permanent catalog entries', async () => {
  const f = fixture();
  const missing = await f.importFile([material({ unit: '' })]);
  assert.equal(missing.status, 200);
  assert.equal(missing.result.inserted, 1);
  assert.equal(missing.result.catalogSync.added, 0);
  assert.equal(missing.result.catalogSync.warningCount, 1);
  const inconsistent = await f.importFile([material(), material({ unit: 'kg' })]);
  assert.equal(inconsistent.status, 200);
  assert.equal(inconsistent.result.catalogSync.added, 0);
  assert.match(inconsistent.result.catalogSync.warnings[0].reason, /Sprzeczne jednostki/);
});

test('duplicates and harmless formatting changes are recognized without merging different warehouses', async () => {
  const f = fixture();
  f.state.tables.original_inventory_catalog.push(row(material()));
  const result = await f.sync([
    material({ indexCode: ' m - 4 - BSHL - 786 - 015 ', name: '  metal box 1230x830x730 ', unit: 'szt' }),
    material({ indexCode: 'M-1-BSHL-786-015', warehouseCode: 'M-1' }),
    material({ indexCode: 'M-1-BSHL-786-015', warehouseCode: 'M-1' })
  ]);
  assert.equal(result.existing, 1);
  assert.equal(result.added, 1);
  assert.equal(result.warningCount, 0);
});

test('catalog database failures never turn an otherwise successful stock import into an error', async () => {
  for (const mode of ['read', 'write']) {
    const f = fixture();
    if (mode === 'read') f.state.failCatalogRead = true;
    else f.state.failCatalogWriteFrom = 1;
    const response = await f.importFile([material()]);
    assert.equal(response.status, 200);
    assert.equal(response.result.inserted, 1);
    assert.equal(response.result.catalogSync.failed, true);
    assert.equal(f.state.tables.original_inventory_erp_snapshots.length, 1);
    assert.match(response.result.catalogSync.warnings[0].reason, /Stany ERP zostały wgrane/);
  }
});

test('bulk writes and pagination handle more than a thousand rows without per-item requests', async () => {
  const f = fixture();
  for (let i = 0; i < 1205; i++) f.state.tables.original_inventory_catalog.push(row(material({ indexCode: `M-4-OLD-${i}`, name: `OLD ${i}` }), `old-${String(i).padStart(5, '0')}`));
  const items = Array.from({ length: 1201 }, (_, i) => material({ indexCode: `M-4-NEW-${i}`, name: `NEW ${i}` }));
  const result = await f.sync([...items, material({ indexCode: 'M-4-OLD-1204', name: 'OLD 1204' })]);
  assert.equal(result.added, 1201);
  assert.equal(result.existing, 1);
  assert.deepEqual(f.state.operations.filter((op) => op.mode === 'upsert').map((op) => op.size), [500, 500, 201]);
  assert.equal(f.state.operations.filter((op) => op.mode === 'select').length, 2);
});

test('partial catalog failure keeps imported stocks and retry inserts only the missing batch', async () => {
  const f = fixture();
  const items = Array.from({ length: 501 }, (_, i) => material({ indexCode: `M-4-NEW-${i}`, name: `NEW ${i}` }));
  f.state.failCatalogWriteFrom = 2;
  const first = await f.importFile(items);
  assert.equal(first.status, 200);
  assert.equal(first.result.inserted, 501);
  assert.equal(first.result.catalogSync.added, 500);
  assert.equal(first.result.catalogSync.failed, true);
  f.state.failCatalogWriteFrom = Infinity;
  const second = await f.importFile(items);
  assert.equal(second.result.catalogSync.added, 1);
  assert.equal(f.state.tables.original_inventory_catalog.length, 501);
});

test('concurrent ERP imports use stable insert-only IDs and detect conflicting descriptions', async () => {
  const f = fixture();
  const results = await Promise.all([f.sync([material()]), f.sync([material()])]);
  assert.equal(results.reduce((sum, result) => sum + result.added, 0), 1);
  assert.equal(f.state.tables.original_inventory_catalog.length, 1);
  const g = fixture();
  const conflicts = await Promise.all([g.sync([material()]), g.sync([material({ name: 'CHANGED' })])]);
  assert.equal(g.state.tables.original_inventory_catalog.length, 1);
  assert.equal(conflicts.reduce((sum, result) => sum + result.warningCount, 0), 1);
});

test('a simultaneous manual catalog insert with a different UUID is rechecked without losing other new rows', async () => {
  const f = fixture();
  f.state.beforeCatalogWrite = async () => f.state.tables.original_inventory_catalog.push(row(material(), 'manual-winner'));
  const result = await f.sync([material(), material({ name: 'OTHER', indexCode: 'M-4-OTHER' })]);
  assert.equal(result.failed, false);
  assert.equal(result.added, 1);
  assert.equal(result.existing, 1);
  assert.equal(f.state.tables.original_inventory_catalog.length, 2);
});

test('PDF parser output uses the same permanent catalog sync as spreadsheet input', async () => {
  const f = fixture();
  f.state.pdfItems = [{ ...material(), availableQty: 314, realQty: 400 }];
  const response = await f.importFile([], '2026-09-28', true);
  assert.equal(response.status, 200);
  assert.equal(response.result.catalogSync.added, 1);
  assert.equal(f.state.tables.original_inventory_erp_snapshots[0].available_qty, 314);
});

test('read-only and unauthenticated users cannot import either stock or catalog rows', async () => {
  const f = fixture();
  f.state.user.access.warehouses.PLANOWANIE_ZAPOTRZEBOWANIA.readOnly = true;
  assert.equal((await f.importFile([material()])).status, 403);
  f.state.user = null;
  assert.equal((await f.importFile([material()])).status, 401);
  assert.equal(f.state.operations.length, 0);
});

test('missing metadata warnings are capped without blocking any stock row', async () => {
  const f = fixture();
  const response = await f.importFile(Array.from({ length: 70 }, (_, i) => material({ name: `UNKNOWN ${i}`, indexCode: '' })));
  assert.equal(response.result.inserted, 70);
  assert.equal(response.result.catalogSync.warningCount, 70);
  assert.equal(response.result.catalogSync.warnings.length, 50);
  assert.equal(f.state.tables.original_inventory_catalog.length, 0);
});

test('previously cached empty search immediately finds newly imported catalog rows on each server read', async () => {
  const f = fixture();
  assert.deepEqual(await f.app('searchOriginalInventoryCatalog', { query: 'metal box' }), []);
  const imported = await f.importFile([material()]);
  const payload = { query: 'metal box', catalogRefreshToken: imported.result.catalogRefreshToken };
  assert.equal((await f.app('searchOriginalInventoryCatalog', payload)).length, 1);
  const reads = f.state.operations.filter((op) => op.table === 'original_inventory_catalog' && op.mode === 'select').length;
  assert.equal((await f.app('searchOriginalInventoryCatalog', payload)).length, 1);
  assert.equal((await f.app('getOriginalInventoryCatalog', payload)).length, 1);
  assert.equal(f.state.operations.filter((op) => op.table === 'original_inventory_catalog' && op.mode === 'select').length, reads);
});

test('a stale in-flight catalog read cannot repopulate cache after import invalidation', async () => {
  const f = fixture();
  let releaseRead;
  let started;
  const readStarted = new Promise((resolve) => { started = resolve; });
  const wait = new Promise((resolve) => { releaseRead = resolve; });
  f.state.holdCatalogRead = () => { started(); return wait; };
  const oldSearch = f.app('searchOriginalInventoryCatalog', { query: 'metal box' });
  await readStarted;
  const imported = await f.importFile([material()]);
  const payload = { query: 'metal box', catalogRefreshToken: imported.result.catalogRefreshToken };
  assert.equal((await f.app('searchOriginalInventoryCatalog', payload)).length, 1);
  releaseRead();
  assert.equal((await oldSearch).length, 1);
  assert.equal((await f.app('searchOriginalInventoryCatalog', payload)).length, 1);
});
