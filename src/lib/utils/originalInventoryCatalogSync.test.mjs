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
const row = (item, id = 'old') => ({ id, name: item.name, unit: item.unit, index_code: item.indexCode, ...(item.indexCode2 ? {index_code2:item.indexCode2} : {}), warehouse_code: item.warehouseCode });

function fixture() {
  const state = {
    user: { id: 'test', username: 'counter', name: 'Counter', role: 'USER', access: { warehouses: { PLANOWANIE_ZAPOTRZEBOWANIA: { readOnly: false, tabs: ['planowanie-zapotrzebowania'] } } } },
    tables: { original_inventory_catalog: [], original_inventory_erp_snapshots: [], paint_tape_inventory_sessions: [], audit_logs: [], material_planning_state: [] },
    operations: [], failCatalogRead: false, failCatalogWriteFrom: Infinity, catalogWrites: 0,
    beforeCatalogWrite: null, beforeRegisterSave: null, pdfItems: [], holdCatalogRead: null, afterWork: [], purgeError: null, renameError: null, indicesMigrationMissing: false
  };
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.mode = 'select'; }
    select(fields) { this.fields = fields; return this; }
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
      if (catalog && this.fields === 'index_code2' && state.indicesMigrationMissing) return {data:null,error:{code:'42703'}};
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
  const db = {
    from: (table) => new Query(table),
    rpc(name, payload) {
      state.operations.push({ rpc: name, payload });
      if (name === 'save_material_planning_state') {
        const rows = state.tables.material_planning_state;
        if (state.beforeRegisterSave) { const callback = state.beforeRegisterSave; state.beforeRegisterSave = null; callback(rows); }
        let current = rows.find(row => row.id === payload.p_module_id);
        const revision = current?.revision ?? 0;
        if (revision !== payload.p_expected_revision) return Promise.resolve({data:[{has_conflict:true,new_revision:revision}],error:null});
        if (!current) { current = {id:payload.p_module_id}; rows.push(current); }
        Object.assign(current, {state:structuredClone(payload.p_state),revision:revision+1});
        return Promise.resolve({data:[{has_conflict:false,new_revision:revision+1}],error:null});
      }
      if (name === 'replace_original_inventory_erp_snapshot_v2' && state.indicesMigrationMissing) return Promise.resolve({data:null,error:{code:'PGRST202'}});
      if (name === 'replace_original_inventory_erp_snapshot' || name === 'replace_original_inventory_erp_snapshot_v2') {
        const before = state.tables.original_inventory_erp_snapshots;
        const replaced = before.filter(row => row.snapshot_date === payload.p_date).length;
        state.tables.original_inventory_erp_snapshots = [
          ...before.filter(row => row.snapshot_date !== payload.p_date),
          ...payload.p_rows.map((row, i) => ({ ...row, id: `snapshot-${i}`, snapshot_date: payload.p_date }))
        ];
        return Promise.resolve({ data: [{ inserted: payload.p_rows.length, replaced }], error: null });
      }
      const result = name === 'rename_original_inventory_catalog_items' || name === 'update_original_inventory_catalog_items_v2'
        ? { data: state.renameError ? null : payload.p_changes.map((change) => {
          const item = state.tables.original_inventory_catalog.find((row) => row.id === change.id && row.name === change.previousName && row.index_code === change.indexCode && (name !== 'update_original_inventory_catalog_items_v2' || (row.index_code2 ?? null) === change.previousIndexCode2));
          if (item) { item.previous_names = [...new Set([...(item.previous_names ?? []), item.name])]; item.name = change.name; if (change.indexCode2) item.index_code2 = change.indexCode2; }
          return { id: change.id, updated: Boolean(item) };
        }), error: state.renameError }
        : { data: 0, error: state.purgeError };
      const promise = Promise.resolve(result);
      promise.abortSignal = () => promise;
      return promise;
    }
  };
  const mocks = {
    'next/server': { ...require('next/server'), after: (callback) => state.afterWork.push(callback) },
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
  const importFile = async (items, date = '2026-09-28', pdf = false, catalogOnly = false, customRows = null) => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(customRows ?? [
      ...(catalogOnly ? [
        ['Nazwa', 'Jednostka', 'Indeks 1', 'Indeks 2'], ...items.map((item) => [item.name, item.unit, item.indexCode ?? '', item.indexCode2 ?? ''])
      ] : [
        ['Nazwa', 'Stan do dyspozycji ERP', 'Stan rzeczywisty ERP', 'Jednostka', 'Indeks 1', 'Indeks 2'],
        ...items.map((item) => [item.name, item.availableQty ?? 250, item.realQty ?? 300, item.unit, item.indexCode ?? '', item.indexCode2 ?? ''])
      ])
    ]), 'Stany');
    const file = pdf ? new File(['%PDF-1.7 fixture'], 'stany.pdf') : new File([XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })], 'stany.xlsx');
    const form = new FormData(); form.append('file', file); form.append('snapshotDate', date);
    const route = catalogOnly ? load(join(root, 'app/api/original-inventory-catalog/import/route.ts')) : importRoute;
    const response = await route.POST(new Request('http://test/api/import', { method: 'POST', body: form }));
    return { status: response.status, result: await response.json() };
  };
  const app = async (action, payload = {}, expectedStatus = 200) => {
    const route = load(join(root, 'app/api/app/route.ts'));
    const response = await route.POST(new Request('http://test/api/app', { method: 'POST', body: JSON.stringify({ action, payload }) }));
    assert.equal(response.status, expectedStatus, await response.clone().text());
    return response.json();
  };
  const parseCatalog = rows => load(join(root, 'lib/utils/originalInventoryCatalog.ts')).parseOriginalInventoryCatalogRows(rows);
  return { state, sync, importFile, app, parseCatalog,
    register: load(join(root, 'lib/utils/originalInventoryCatalogRegister.ts')),
    normalizeRegister: load(join(root, 'lib/utils/originalInventoryCatalogRegisterServer.ts')).normalizeCatalogRegisterItem };
}

const REGISTER_ID = 'original-inventory-catalog-register';
const registerRow = (name, indexCode, indexCode2 = indexCode, unit = 'szt.') => ({name,indexCode,indexCode2,unit,warehouseCode:indexCode.match(/^M-\d+/)?.[0] ?? null});
const saveRegisterFixture = (f, items, blocked = []) => {
  f.state.tables.material_planning_state.push({id:REGISTER_ID,revision:1,state:{version:1,items,blocked,importedAt:'2026-10-31',sourceFileName:'master.xlsx'}});
};

test('the explicit register joins every index format, preserves source IDs and does not mutate stored stock', async () => {
  const f = fixture();
  const items = [registerRow('TRAY WHITE','M-10-PWY-BSHL-9001516433','M-10-9001516433'),
    registerRow('HOSTACOM','M-1-TW-BSHL-5607-00','527-002','kg'), registerRow('LABEL','INTERNAL/A','000007')];
  saveRegisterFixture(f, items);
  for (const [i,item] of items.entries()) for (const [j,index] of [item.indexCode,item.indexCode2].entries()) {
    f.state.tables.original_inventory_catalog.push(row(material({...item,indexCode:index}), `id-${i}-${j}`));
  }
  const before = structuredClone(f.state.tables);
  const catalog = await f.app('getOriginalInventoryCatalog');
  assert.equal(catalog.length,3);
  for (const [i,item] of items.entries()) {
    const saved = catalog.find(row => row.indexCode === item.indexCode);
    assert.equal(saved.indexCode2,item.indexCode2);
    assert.deepEqual(saved.catalogIds,[`id-${i}-0`,`id-${i}-1`]);
    const found = await f.app('searchOriginalInventoryCatalog',{query:item.indexCode2});
    assert.equal(found.length,1);
  }
  assert.deepEqual(f.state.tables,before);
});

test('blocked indices disappear without hiding the valid -01 or a different product reusing the same number', async () => {
  const f = fixture();
  const name = 'ARTPYLEN CP 30TA POPIEL 99007';
  const active = [registerRow(name,'1365-1-1-01',undefined,'kg'),registerRow('ACTIVE SYSTEM','1759')];
  const blocked = [registerRow(name,'1365-1-1',undefined,'kg'),registerRow('OLD BROWN PART','1759')];
  saveRegisterFixture(f,active,blocked);
  for (const [i,item] of [...active,...blocked].entries()) f.state.tables.original_inventory_catalog.push(row(material(item),`row-${i}`));
  const before = structuredClone(f.state.tables);
  const catalog = await f.app('getOriginalInventoryCatalog');
  assert.deepEqual(catalog.map(item=>item.indexCode).sort(),['1365-1-1-01','1759']);
  assert.equal((await f.app('searchOriginalInventoryCatalog',{query:'OLD BROWN'})).length,0);
  assert.equal((await f.app('searchOriginalInventoryCatalog',{query:'ARTPYLEN'}))[0].indexCode2,'1365-1-1-01');
  const restrictions = await f.app('getOriginalInventoryCatalogRestrictions');
  assert.deepEqual(restrictions.blockedNames,['OLD BROWN PART']);
  await f.app('addOriginalInventory',{warehouseId:'hall-1',name,indexCode:'1365-1-1',qty:5,unit:'kg'},400);
  assert.deepEqual(f.state.tables,before);
});

test('new master-format imports need no index-2 schema migration, are repeatable and retain permanent exclusions', async () => {
  const f = fixture(); f.state.indicesMigrationMissing = true;
  const active = registerRow('ARTPYLEN','1365-1-1-01',undefined,'kg');
  const blocked = registerRow('ARTPYLEN','1365-1-1',undefined,'kg');
  saveRegisterFixture(f,[active],[blocked]);
  const rows = [['Indeks [+]','Indeks 2','Nazwa artyku\u0142u (materia\u0142u)','J.M.'],
    [active.indexCode,active.indexCode2,active.name,active.unit],[blocked.indexCode,blocked.indexCode2,blocked.name,blocked.unit]];
  const first = await f.importFile([],undefined,false,true,rows);
  assert.equal(first.status,200);
  assert.equal(first.result.blocked,1);
  assert.equal(first.result.inserted,1);
  assert.equal(f.state.tables.original_inventory_catalog[0].index_code,active.indexCode);
  const again = await f.importFile([],undefined,false,true,rows);
  assert.equal(again.status,200);
  assert.equal(again.result.inserted,0);
  assert.equal(f.state.tables.original_inventory_catalog.length,1);
  assert.equal(f.state.tables.material_planning_state[0].state.blocked.length,1);
  assert.equal(f.state.tables.original_inventory_erp_snapshots.length,0);
});

test('an incomplete blocked-list table is not accepted as a master catalog import', async () => {
  const f = fixture();
  const response = await f.importFile([],undefined,false,true,[
    ['Indeks [+]','Indeks 2','Nazwa artyku\u0142u (materia\u0142u)'],['OLD','OLD','BLOCKED']
  ]);
  assert.equal(response.status,400);
  assert.equal(response.result.code,'CATALOG_REGISTER_UNIT_REQUIRED');
  assert.equal(f.state.operations.length,0);
});

test('contradictory indices or units in the master table stop before any catalog or registry write', async () => {
  for (const other of [['ONE','OTHER','MATERIAL','kg'],['ONE','SECOND','MATERIAL','litr']]) {
    const f = fixture();
    const response = await f.importFile([],undefined,false,true,[
      ['Indeks [+]','Indeks 2','Nazwa artyku\u0142u (materia\u0142u)','J.M.'],['ONE','SECOND','MATERIAL','kg'],other
    ]);
    assert.equal(response.status,400);
    assert.equal(response.result.code,'CONFLICTING_INDEX_COLUMNS');
    assert.equal(f.state.operations.length,0);
  }
});

test('old stock imports cannot restore a blocked catalog and keep actual stock import independent', async () => {
  const f = fixture();
  const blocked = registerRow('BLOCKED MATERIAL','OLD',undefined,'kg');
  saveRegisterFixture(f,[],[blocked]);
  const response = await f.importFile([material(blocked)]);
  assert.equal(response.status,200);
  assert.equal(f.state.tables.original_inventory_erp_snapshots.length,1);
  assert.equal(f.state.tables.original_inventory_catalog.length,0);
  assert.equal(response.result.catalogSync.warningCount,1);
});

test('master import retries a revision conflict and retains a concurrently added exclusion', async () => {
  const f = fixture();
  const first = registerRow('FIRST','ONE','SECOND');
  saveRegisterFixture(f,[first]);
  f.state.beforeRegisterSave = rows => {
    rows[0].revision++;
    rows[0].state.blocked.push(registerRow('BLOCKED','CANCELLED'));
  };
  const response = await f.importFile([],undefined,false,true,[
    ['Indeks [+]','Indeks 2','Nazwa artyku\u0142u (materia\u0142u)','J.M.'],['ONE','SECOND','FIRST','szt.']
  ]);
  assert.equal(response.status,200);
  assert.equal(f.state.tables.material_planning_state[0].state.blocked[0].indexCode,'CANCELLED');
  assert.equal(f.state.tables.original_inventory_catalog.length,1);
});

test('a partial master file updates its indices without removing unrelated registered pairs', async () => {
  const f = fixture();
  saveRegisterFixture(f,[registerRow('OLD NAME','ONE','SECOND'),registerRow('UNRELATED','TWO','OTHER')]);
  f.state.tables.original_inventory_catalog.push(row(material({name:'OLD NAME',indexCode:'ONE'}),'one'));
  const response = await f.importFile([],undefined,false,true,[
    ['Indeks [+]','Indeks 2','Nazwa artyku\u0142u (materia\u0142u)','J.M.'],['ONE','SECOND','NEW NAME','szt.']
  ]);
  assert.equal(response.status,200);
  const registered = f.state.tables.material_planning_state[0].state.items;
  assert.equal(registered.length,2);
  assert.ok(registered.some(row=>row.name==='UNRELATED'));
  assert.equal((await f.app('searchOriginalInventoryCatalog',{query:'OLD NAME'}))[0].name,'NEW NAME');
  const again = await f.importFile([],undefined,false,true,[
    ['Indeks [+]','Indeks 2','Nazwa artyku\u0142u (materia\u0142u)','J.M.'],['ONE','SECOND','THIRD NAME','szt.']
  ]);
  assert.equal(again.status,200);
  assert.equal((await f.app('searchOriginalInventoryCatalog',{query:'NEW NAME',catalogRefreshToken:again.result.catalogRefreshToken}))[0].name,'THIRD NAME');
});

test('ordinary ERP name changes update register labels but never exchange the two index columns', async () => {
  const f = fixture();
  saveRegisterFixture(f,[registerRow('OLD NAME','ONE','SECOND')]);
  f.state.tables.original_inventory_catalog.push(row(material({name:'OLD NAME',indexCode:'ONE'}),'one'));
  const result = await f.sync([material({name:'NEW NAME',indexCode:'ONE'})]);
  assert.equal(result.failed,false);
  const registered = f.state.tables.material_planning_state[0].state.items[0];
  assert.equal(registered.name,'NEW NAME');
  assert.equal(registered.indexCode,'ONE');
  assert.equal(registered.indexCode2,'SECOND');
  assert.deepEqual(registered.previousNames,['OLD NAME']);
});

test('catalog columns, not value shape or warehouse, classify both indices', () => {
  const f = fixture();
  const pairs = [['M-10-PWY-BSHL-10012', '8001103471'], ['M-1-TW-111', '000023'], ['123456789', 'M-51-ABC'], ['M-4-KAR-111', 'ABC/12']];
  const rows = f.parseCatalog([
    ['Indeks 2', 'Kod', 'Nazwa', 'J.m.', 'Indeks 1'],
    ...pairs.map(([one,two], i) => [two, 'INTERNAL-99', `Material ${i}`, 'szt.', one])
  ]);
  assert.deepEqual(rows.map(item => [item.indexCode,item.indexCode2]), pairs);
  const legacy = f.parseCatalog([['Kod','Indeks','Nazwa','Jm.'], ['10012','M-10-PWY-BSHL-10012','TRAY','szt.']]);
  assert.equal(legacy[0].indexCode, 'M-10-PWY-BSHL-10012');
  assert.equal(legacy[0].indexCode2, undefined, 'Kod is not index 2');
});

test('ERP article register headers keep Indeks [+] as index 1 and the separate index 2', async () => {
  const f = fixture();
  const headers = ['Indeks [+]', 'Indeks 2', 'Nazwa artyku\u0142u (materia\u0142u)', 'J.M.'];
  const source = [
    ['M-10-PWY-BSHL-10008', 'M-10-8001236303', 'TRAY HANDLE ASSEMBLY WELDED COST IRON', 'szt.'],
    ['M-1-TW-BSHL-5607-00', '527-002', 'HOSTACOM M2 N01 L304698', 'kg'],
    ['0004-323', '0004-323', 'BLACHA OCYNK 1.35', 'kg'],
    ['B-AKC-7-005', '', 'CLIP 50MM', 'szt.']
  ];
  const parsed = f.parseCatalog([headers, ...source]);
  assert.deepEqual(parsed.map(item => [item.indexCode, item.indexCode2 ?? '', item.name, item.unit]), source);
  const response = await f.importFile([], undefined, false, true, [headers, ...source]);
  assert.equal(response.status, 200);
  assert.equal(f.state.tables.original_inventory_catalog.length, 4);
  assert.equal(f.state.tables.original_inventory_erp_snapshots.length, 0, 'A register contains no stock quantities');
  for (const [one, two, name, unit] of source) {
    const saved = f.state.tables.original_inventory_catalog.find(item => item.index_code === one);
    assert.equal(saved.name, name);
    assert.equal(saved.unit, unit);
    const registered = f.state.tables.material_planning_state.find(row => row.id === 'original-inventory-catalog-register').state.items;
    assert.equal(registered.find(item => item.indexCode === one).indexCode2 ?? '', two);
  }
});

test('catalog import strips invisible ERP control characters but preserves identifiers and whitespace separators', () => {
  const f = fixture();
  const rows = f.parseCatalog([
    ['Indeks [+]', 'Indeks 2', 'Nazwa artyku\u0142u (materia\u0142u)', 'J.M.'],
    ['FWP-BSHLODZ-0037', '303019506\u001f\u001f', 'FW-CONTROL PANEL BODY VG1 BO #08 NR 8', 'szt.'],
    ['0004-323', '0004-323', 'ADAPTER AIR HOSE D60\u001f\u001f', 'kg'],
    ['0004-670', '0004-670', 'NAME\tWITH\nSPACES', 'kg']
  ]);
  assert.equal(rows[0].indexCode, 'FWP-BSHLODZ-0037');
  assert.equal(rows[0].indexCode2, '303019506');
  assert.equal(rows[1].indexCode2, '0004-323');
  assert.equal(rows[1].name, 'ADAPTER AIR HOSE D60');
  assert.equal(rows[2].name, 'NAME WITH SPACES');
});

test('both catalog and stock imports save two indices in one row and preserve index 2 on a later one-index import', async () => {
  for (const catalogOnly of [false,true]) {
    const f = fixture();
    const item = material({indexCode2:'00008001103471'});
    const response = await f.importFile([item], undefined, false, catalogOnly);
    assert.equal(response.status,200);
    assert.equal(f.state.tables.original_inventory_catalog.length,1);
    assert.equal(f.state.tables.original_inventory_catalog[0].index_code2,item.indexCode2);
    if (!catalogOnly) {
      assert.equal(f.state.tables.original_inventory_erp_snapshots[0].index_code2,item.indexCode2);
      assert.equal(f.state.tables.original_inventory_erp_snapshots[0].real_qty,300);
    }
    await f.importFile([material()], undefined, false, catalogOnly);
    assert.equal(f.state.tables.original_inventory_catalog[0].index_code2,item.indexCode2);
    await f.importFile([material({indexCode2:'ABC/NEW',name:'RENAMED'})], undefined, false, catalogOnly);
    assert.equal(f.state.tables.original_inventory_catalog.length,1);
    assert.equal(f.state.tables.original_inventory_catalog[0].index_code2,'ABC/NEW');
    assert.equal(f.state.tables.original_inventory_catalog[0].name,'RENAMED');
  }
});

test('snapshot header order may change without swapping the two indices or quantities', async () => {
  const f = fixture();
  const response = await f.importFile([], undefined, false, false, [
    ['Indeks 2','Nazwa','Stan rzeczywisty','Indeks 1','Jm.','Stan do dyspozycji'],
    ['8001103471','TRAY',5190,'M-10-PWY-BSHL-10012','szt.',5000]
  ]);
  assert.equal(response.status,200);
  const saved = f.state.tables.original_inventory_erp_snapshots[0];
  assert.equal(saved.index_code,'M-10-PWY-BSHL-10012');
  assert.equal(saved.index_code2,'8001103471');
  assert.equal(saved.real_qty,5190);
  assert.equal(saved.available_qty,5000);
});

test('missing two-index migration rejects the import before any existing data changes', async () => {
  for (const catalogOnly of [false,true]) {
    const f = fixture(); f.state.indicesMigrationMissing = true;
    f.state.tables.original_inventory_catalog.push(row(material()));
    f.state.tables.original_inventory_erp_snapshots.push({id:'old',snapshot_date:'2026-09-28',real_qty:42});
    const before = structuredClone(f.state.tables);
    const response = await f.importFile([material({indexCode2:'8001103471'})], undefined, false, catalogOnly);
    assert.equal(response.status,503);
    assert.equal(response.result.code,'MIGRATION_REQUIRED_INVENTORY_INDICES');
    assert.deepEqual(f.state.tables,before);
  }
});

test('ambiguous or contaminated secondary indices cannot silently change stock', async () => {
  const f = fixture();
  const bad = await f.importFile([material({indexCode2:'8001103471 30.10.2026 6:58'})]);
  assert.equal(bad.status,400);
  assert.equal(f.state.operations.length,0);
  const conflict = await f.importFile([material({indexCode2:'ONE'}),material({indexCode2:'TWO'})]);
  assert.equal(conflict.status,400);
  assert.equal(conflict.result.code,'CONFLICTING_INDEX_COLUMNS');
  const headers = await f.importFile([], undefined, false, true, [
    ['Nazwa','Indeks','Indeks 1','Indeks 2','Jednostka'], ['TRAY','A','B','C','szt.']
  ]);
  assert.equal(headers.status,400);
  assert.equal(headers.result.code,'AMBIGUOUS_INDEX_COLUMNS');
  assert.equal(f.state.operations.length,0);
});

test('successful ERP import schedules guarded retention after responding, not during the import', async () => {
  const f = fixture();
  const response = await f.importFile([material()]);
  assert.equal(response.status, 200);
  assert.equal(f.state.afterWork.length, 1);
  assert.equal(f.state.operations.some((op) => op.rpc === 'purge_original_inventory_erp_snapshots'), false);
  await f.state.afterWork[0]();
  const operation = f.state.operations.find((op) => op.rpc === 'purge_original_inventory_erp_snapshots');
  assert.equal(operation.rpc, 'purge_original_inventory_erp_snapshots');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date());
  const date = new Date(`${today}T12:00:00Z`); date.setUTCDate(date.getUTCDate() - 90);
  assert.equal(operation.payload.p_cutoff_date, date.toISOString().slice(0, 10));
});

test('ERP XLSX and parsed PDF imports reject timestamp indices before replacing any existing stock', async () => {
  for (const pdf of [false, true]) {
    const f = fixture();
    const existingCatalog = row(material());
    const existingStock = { id: 'existing-stock', snapshot_date: '2026-09-28', name: 'PP MOPLEN HP548R',
      index_code: '618', real_qty: 300, available_qty: 200, unit: 'kg' };
    f.state.tables.original_inventory_catalog.push(existingCatalog);
    f.state.tables.original_inventory_erp_snapshots.push(existingStock);
    const items = [material(), material({ name: 'PP MOPLEN HP548R', indexCode: '618 16.10.2026 6:58', unit: 'kg' })];
    f.state.pdfItems = items;
    const response = await f.importFile(items, '2026-09-28', pdf);
    assert.equal(response.status, 400);
    assert.equal(response.result.code, 'INDEX_CONTAINS_REPORT_TIMESTAMP');
    assert.deepEqual(f.state.tables.original_inventory_catalog, [existingCatalog]);
    assert.deepEqual(f.state.tables.original_inventory_erp_snapshots, [existingStock]);
    assert.deepEqual(f.state.operations, []);
    assert.deepEqual(f.state.afterWork, []);
  }
});

test('catalog file import rejects the whole contaminated batch without renames or partial inserts', async () => {
  const f = fixture();
  const existing = row(material());
  f.state.tables.original_inventory_catalog.push(existing);
  const response = await f.importFile([
    material({ name: 'RENAMED' }), material({ name: 'BAD', indexCode: 'A22154801 13.10.2026 6:55' })
  ], '2026-09-28', false, true);
  assert.equal(response.status, 400);
  assert.equal(response.result.code, 'INDEX_CONTAINS_REPORT_TIMESTAMP');
  assert.deepEqual(f.state.tables.original_inventory_catalog, [existing]);
  assert.deepEqual(f.state.operations, []);
});

test('single and bulk catalog API writes cannot bypass the report timestamp guard', async () => {
  for (const bulk of [false, true]) {
    const f = fixture();
    const item = material({ indexCode: 'M-1-TW-BSHL-5607-00 9.10.2026 6:59' });
    const result = await f.app(bulk ? 'addOriginalInventoryCatalogBulk' : 'addOriginalInventoryCatalog',
      bulk ? { items: [material(), item] } : item, 400);
    assert.equal(result.code, 'INDEX_CONTAINS_REPORT_TIMESTAMP');
    assert.equal(f.state.tables.original_inventory_catalog.length, 0);
    assert.equal(f.state.operations.some(op => op.table === 'original_inventory_catalog' || op.rpc), false);
  }
});

test('direct catalog synchronization warns and never persists a timestamp identity', async () => {
  const f = fixture();
  const result = await f.sync([material({ indexCode: '618 16.10.2026 6:58' }), material()]);
  assert.equal(result.added, 1);
  assert.equal(result.warningCount, 1);
  assert.equal(result.warnings[0].indexCode, '618 16.10.2026 6:58');
  assert.equal(f.state.tables.original_inventory_catalog.length, 1);
  assert.equal(f.state.tables.original_inventory_catalog[0].index_code, material().indexCode);
});

test('missing retention migration cannot change a successful import into a failure', async () => {
  const f = fixture(); f.state.purgeError = { code: 'PGRST202', message: 'missing RPC' };
  const response = await f.importFile([material()]);
  assert.equal(response.status, 200);
  await f.state.afterWork[0]();
  assert.equal(f.state.tables.original_inventory_erp_snapshots.length, 1);
});

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

test('same code updates its name in place, retains the old name and never changes units', async () => {
  const f = fixture();
  f.state.tables.original_inventory_catalog.push(row(material()));
  const renamed = await f.importFile([material({ name: 'RENAMED' })]);
  assert.equal(renamed.status, 200);
  assert.equal(renamed.result.catalogSync.added, 0);
  assert.equal(renamed.result.catalogSync.updated, 1);
  assert.equal(renamed.result.catalogSync.warningCount, 0);
  assert.equal(f.state.tables.original_inventory_catalog.length, 1);
  assert.deepEqual(f.state.tables.original_inventory_catalog[0], { ...row(material({ name: 'RENAMED' })), previous_names: [material().name] });
  const unchanged = await f.importFile([material({ name: 'RENAMED' })]);
  assert.equal(unchanged.result.catalogSync.updated, 0);
  assert.equal(unchanged.result.catalogSync.existing, 1);
  const unitChanged = await f.importFile([material({ name: 'RENAMED', unit: 'kg' })]);
  assert.equal(unitChanged.result.catalogSync.warningCount, 1);
  assert.equal(f.state.tables.original_inventory_catalog[0].unit, 'szt.');
});

test('PDF and spreadsheet catalog imports use the same indexed rename and refresh old cached searches', async () => {
  for (const source of ['pdf', 'catalog']) {
    const f = fixture();
    const oldName = 'KRATA STALOWA 1M IMPORT Z LOGO DOMELO';
    const name = oldName + ' SYSTEM 1000X63X98X148';
    const item = material({ name: oldName, indexCode: '1598-7', warehouseCode: null });
    f.state.tables.original_inventory_catalog.push(row(item));
    assert.equal((await f.app('searchOriginalInventoryCatalog', { query: oldName }))[0].name, oldName);
    f.state.pdfItems = [{ ...item, name, realQty: 740, availableQty: 740 }];
    const response = await f.importFile([{ ...item, name }], '2026-10-21', source === 'pdf', source === 'catalog');
    assert.equal(response.status, 200);
    assert.equal(response.result.catalogSync.updated, 1);
    assert.equal(response.result.catalogSync.added, 0);
    const payload = { query: oldName, catalogRefreshToken: response.result.catalogRefreshToken };
    const suggestions = await f.app('searchOriginalInventoryCatalog', payload);
    assert.equal(suggestions.length, 1);
    assert.equal(suggestions[0].name, name);
    assert.equal(suggestions[0].id, 'old');
    assert.equal((await f.app('resolveOriginalInventoryCatalogMaterial', { name: oldName, unit: 'szt.' })).name, name);
    assert.equal(f.state.tables.original_inventory_catalog.length, 1);
  }
});

test('missing rename migration leaves names intact and reports the required SQL without losing ERP quantities', async () => {
  const f = fixture();
  f.state.tables.original_inventory_catalog.push(row(material()));
  f.state.renameError = { code: 'PGRST202' };
  const response = await f.importFile([material({ name: 'NEW NAME', availableQty: 740 })]);
  assert.equal(response.status, 200);
  assert.equal(response.result.catalogSync.failed, true);
  assert.match(response.result.catalogSync.warnings[0].reason, /04_spis_rzeczywisty_i_stany_erp.sql/);
  assert.equal(f.state.tables.original_inventory_catalog[0].name, material().name);
  assert.equal(f.state.tables.original_inventory_erp_snapshots[0].available_qty, 740);
});

test('two contradictory names in one import and duplicate catalog indices are not resolved arbitrarily', async () => {
  const f = fixture();
  f.state.tables.original_inventory_catalog.push(row(material()), row(material({ name: 'DUPLICATE' }), 'duplicate'));
  const original = structuredClone(f.state.tables.original_inventory_catalog);
  assert.equal((await f.sync([material({ name: 'NEW' })])).updated, 0);
  assert.equal((await f.sync([material({ name: 'ONE' }), material({ name: 'TWO' })])).updated, 0);
  assert.deepEqual(f.state.tables.original_inventory_catalog, original);
});

test('full ERP index is identity even when the warehouse label differs, without changing warehouse metadata', async () => {
  const f = fixture();
  f.state.tables.original_inventory_catalog.push(row(material()));
  const result = await f.sync([material({ name: 'UPDATED', warehouseCode: 'M-40' })]);
  assert.equal(result.updated, 1);
  assert.equal(result.added, 0);
  assert.equal(f.state.tables.original_inventory_catalog[0].warehouse_code, 'M-4');
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
  assert.equal(f.state.operations.filter((op) => op.mode === 'select' && op.table === 'original_inventory_catalog').length, 2);
  assert.equal(f.state.operations.filter((op) => op.mode === 'select' && op.table === 'material_planning_state').length, 1);
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

test('concurrent ERP imports use stable IDs and update a renamed index without inserting a second row', async () => {
  const f = fixture();
  const results = await Promise.all([f.sync([material()]), f.sync([material()])]);
  assert.equal(results.reduce((sum, result) => sum + result.added, 0), 1);
  assert.equal(f.state.tables.original_inventory_catalog.length, 1);
  const g = fixture();
  const conflicts = await Promise.all([g.sync([material()]), g.sync([material({ name: 'CHANGED' })])]);
  assert.equal(g.state.tables.original_inventory_catalog.length, 1);
  assert.equal(conflicts.reduce((sum, result) => sum + result.warningCount, 0), 0);
  assert.equal(conflicts.reduce((sum, result) => sum + result.updated, 0), 1);
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

test('catalog API finds M2 name fragments in any order without writing or merging distinct indices', async () => {
  const f = fixture();
  f.state.tables.original_inventory_catalog.push(
    row(material({ name: 'HOSTACOM M2 N01 L304698', unit: 'kg', indexCode: 'M-1-TW-BSHL-5607-00', warehouseCode: 'M-1' }), 'hostacom-1'),
    row(material({ name: 'HOSTACOM M2 N01 L304698', unit: 'kg', indexCode: '527-002', warehouseCode: null }), 'hostacom-2'),
    row(material({ name: 'HOSTACOM OTHER', unit: 'kg', indexCode: 'M-2-TW-123', warehouseCode: 'M-2' }), 'other')
  );
  for (const query of ['M2 h', 'h M2', 'm2 host', 'M2 h']) {
    const results = await f.app('searchOriginalInventoryCatalog', { query, limit: 24 });
    assert.deepEqual(results.map(item => item.indexCode).sort(), ['527-002', 'M-1-TW-BSHL-5607-00']);
  }
  assert.ok(f.state.operations.every(operation => operation.mode === 'select'));
});

test('spis-only index-2 filtering is before the limit and isolated from pallet catalog caches', async () => {
  for (const modes of [[false, true, false], [true, false, true]]) {
    const f = fixture();
    const name = 'KOSZ STUDZIENKI RYNNY 01826';
    f.state.tables.original_inventory_catalog.push(
      row(material({ name, indexCode: 'M-1-OLD-KOSZ', warehouseCode: 'M-1' }), 'legacy-kosz'),
      row(material({ name, indexCode: 'M-1-NEW-KOSZ', indexCode2: '1826', warehouseCode: 'M-1' }), 'current-kosz')
    );
    const before = structuredClone(f.state.tables);
    for (const onlyIndex2 of modes) {
      const results = await f.app('searchOriginalInventoryCatalog', { query: name, limit: 24, onlyIndex2 });
      assert.deepEqual(results.map(item => item.id).sort(), onlyIndex2 ? ['current-kosz'] : ['current-kosz', 'legacy-kosz']);
    }
    const limited = await f.app('searchOriginalInventoryCatalog', { query: name, limit: 1, onlyIndex2: true });
    assert.equal(limited.length, 1);
    assert.equal(limited[0].id, 'current-kosz');
    assert.equal(limited[0].indexCode2, '1826');
    const byIndex1 = await f.app('searchOriginalInventoryCatalog', { query: 'M-1-NEW-KOSZ', onlyIndex2: true });
    assert.equal(byIndex1[0].id, 'current-kosz');
    assert.deepEqual(f.state.tables, before);
    assert.ok(f.state.operations.every(operation => operation.mode === 'select'));
  }
});

test('catalog API links confirmed M-10 pairs for search and Excel without database writes or lost record IDs', async () => {
  const f=fixture();
  const name='TRAY HANDLE ASSEMBLY WELDED COST IRON';
  f.state.tables.original_inventory_catalog.push(
    row(material({name,indexCode:'M-10-PWY-BSHL-10008',warehouseCode:'M-10'}),'primary'),
    row(material({name,indexCode:'M-10-8001236303',warehouseCode:'M-10'}),'secondary')
  );
  const before=structuredClone(f.state.tables);
  const catalog=await f.app('getOriginalInventoryCatalog');
  assert.equal(catalog.length,2);
  assert.deepEqual(new Set(catalog.map(item=>item.id)),new Set(['primary','secondary']));
  assert.ok(catalog.every(item=>item.indexCode==='M-10-PWY-BSHL-10008'&&item.indexCode2==='M-10-8001236303'));
  for(const query of [name,'M-10-PWY-BSHL-10008','M-10-8001236303']) {
    const results=await f.app('searchOriginalInventoryCatalog',{query,limit:24});
    assert.equal(results.length,1);
    assert.equal(results[0].indexCode2,'M-10-8001236303');
  }
  const resolved=await f.app('resolveOriginalInventoryCatalogMaterial',{name,unit:'szt.',indexCode:'M-10-8001236303'});
  assert.equal(resolved.indexCode,'M-10-PWY-BSHL-10008');
  assert.deepEqual(f.state.tables,before);
  assert.ok(f.state.operations.every(op=>op.mode==='select'));
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

test('exact material resolution reads cached catalog without writes and does not merge different indices', async () => {
  const f = fixture();
  const name = 'KRATA STALOWA 1M IMPORT Z LOGO DOMELO';
  const item = material({ name, indexCode: '1598-7', warehouseCode: null });
  f.state.tables.original_inventory_catalog.push(row(item));
  const payload = { name, unit: 'szt.' };
  assert.equal((await f.app('resolveOriginalInventoryCatalogMaterial', payload)).indexCode, '1598-7');
  const reads = f.state.operations.length;
  assert.equal((await f.app('resolveOriginalInventoryCatalogMaterial', payload)).indexCode, '1598-7');
  assert.equal(f.state.operations.length, reads, 'uses the existing server catalog cache');
  assert.equal(await f.app('resolveOriginalInventoryCatalogMaterial', { ...payload, unit: 'kg' }), null);
  assert.equal(await f.app('resolveOriginalInventoryCatalogMaterial', { ...payload, name: 'KRATA STALOWA' }), null);
  f.state.tables.original_inventory_catalog.push(row({ ...item, indexCode: '1700' }, 'other'));
  assert.equal(await f.app('resolveOriginalInventoryCatalogMaterial', {
    ...payload, catalogRefreshToken: '00000000-0000-4000-8000-000000000001'
  }), null);
  assert.ok(f.state.operations.every((operation) => operation.mode === 'select'));
});

test('exact material resolution requires the existing catalog read permission', async () => {
  const f = fixture();
  const payload = { name: 'KRATA', unit: 'szt.' };
  f.state.user.access = { warehouses: {} };
  await f.app('resolveOriginalInventoryCatalogMaterial', payload, 403);
  f.state.user = null;
  await f.app('resolveOriginalInventoryCatalogMaterial', payload, 401);
  assert.equal(f.state.operations.length, 0);
});
