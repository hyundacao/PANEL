import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createSqlTestDatabase, loadSuppliedDatabase } from '../../../scripts/sql-test-database.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const require = createRequire(import.meta.url);
const ts = require('typescript');
const { PGlite } = require('@electric-sql/pglite');
const sql = readFileSync(join(root, 'supabase/12_wyszukiwanie_kartotek.sql'), 'utf8');
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const mod = new Module(file);
  cache.set(file, mod);
  mod.filename = file;
  mod.paths = Module._nodeModulePaths(dirname(file));
  const base = createRequire(file);
  mod.require = name => name.startsWith('.') ? load(resolve(dirname(file), `${name}.ts`)) : base(name);
  mod._compile(ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, file);
  return mod.exports;
}
const projection = load(join(here, 'originalInventorySearchProjection.ts'));
const { searchOriginalInventorySpisSuggestions: search } = load(join(here, 'originalInventorySpisSearch.ts'));

test('publication deletes only derived rows with an explicit predicate required by Supabase safe-update protection', () => {
  assert.match(sql, /delete from public\.original_inventory_search_items where ordinal > 0;/i);
  assert.doesNotMatch(sql, /delete from public\.original_inventory_search_items\s*;/i);
});

const fixture = async () => {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table original_inventory_catalog(id text primary key, name text, unit text, index_code text,
      index_code2 text, warehouse_code text, created_at text default '2026-11-17', previous_names text[] default '{}');
    create table material_planning_state(id text primary key, state jsonb, revision bigint default 0);
    create table original_inventory_entries(name text, qty numeric);
    insert into original_inventory_entries values ('Untouched stock', 123);`);
  await pg.exec(sql);
  const calls = [];
  const db = { async rpc(name, args = {}) {
    calls.push(name);
    const names = Object.keys(args);
    try {
      const result = await pg.query(`select public.${name}(${names.map((key, i) => `${key} => $${i + 1}`).join(',')}) result`,
        names.map(key => key === 'p_rows' ? JSON.stringify(args[key]) : args[key]));
      return { data: result.rows[0].result, error: null };
    } catch (error) { return { data: null, error }; }
  }};
  const add = async (id, name, index1, index2, warehouse = 'M-1', aliases = []) => pg.query(
    'insert into original_inventory_catalog(id,name,unit,index_code,index_code2,warehouse_code,previous_names) values ($1,$2,$3,$4,$5,$6,$7)',
    [id, name, 'szt.', index1, index2, warehouse, aliases]);
  return { pg, db, calls, add };
};

test('prepared search preserves both indices, aliases, numeric rules, strict display and counted priority before LIMIT', async () => {
  const { pg, db, calls, add } = await fixture();
  try {
    await pg.exec(`insert into original_inventory_catalog(id,name,unit,index_code,index_code2,warehouse_code)
      select 'bulk-' || n, 'KONCENTRAT A ' || lpad(n::text,4,'0'), 'kg', 'M-1-BAR-' || n, 'K-A-' || n, 'M-1'
      from generate_series(1,1100) n;`);
    await add('counted', 'KONCENTRAT Z SPISANY', 'M-55-BAR-XYZ', 'K-Z-001', 'M-55', ['DAWNY KONCENTRAT']);
    await add('iris-703', 'IRIS LR WHEEL', 'A22154703', 'M-1-703');
    await add('iris-704', 'IRIS LR WHEEL', 'A22154704', 'M-1-704');
    await add('carton', 'KARTON ROZMIAR 6 788X291X560', 'M-4-KAR-10606', '553-001', 'M-4');
    await add('hosta', 'HOSTACOM M2 N01 ŁÓDŹ', 'M-1-TW-BSHL-5607-00', 'Ł-618');
    await add('no-second', 'KONCENTRAT OLD', 'M-10-800123', null);
    await add('form', 'FORMA FW123 KONCENTRAT', 'FW-123', 'FW-123', 'FW');
    assert.equal(await projection.refreshOriginalInventorySearchProjection(db), true);
    const full = projection.buildOriginalInventorySearchProjection((await db.rpc('get_original_inventory_search_source')).data.rows, null).map(row => row.item);
    const queries = ['koncentrat', 'koncentrat 1', 'koncentrat 01', 'M-55-BAR-XYZ', 'K-Z-001', 'dawny',
      'iris', 'M2 h', 'rozm 6', 'rozm.6', 'łódź', 'Ł-618', '553-001', 'FW', '%', '_', 'xyz', '800123',
      ...full.filter(item => item.id !== 'no-second').slice(-7).flatMap(item => [item.indexCode, item.indexCode2]).filter(Boolean)];
    calls.length = 0;
    for (const query of queries) for (const strict of [true, false]) {
      const actual = await projection.readOriginalInventorySearchCandidates(db, query, strict);
      for (const counted of [[], ['KONCENTRAT Z SPISANY'], ['DAWNY KONCENTRAT']]) {
        assert.deepEqual(search(actual, query, counted, 24, strict), search(full, query, counted, 24, strict), `${query} / ${strict}`);
      }
    }
    assert.ok(calls.every(name => name === 'get_original_inventory_search_candidates'), 'warm search must not load catalog/register');
    const broad = await projection.readOriginalInventorySearchCandidates(db, 'koncentrat', true);
    assert.equal(broad.length, 1102, 'coarse SQL includes FW; JSON must not truncate at PostgREST row cap or server limit 24');
    assert.equal(search(broad, 'koncentrat', [], 2000, true).length, 1101, 'existing JS removes FW');
    assert.equal(search(broad, 'koncentrat', [], 24, true).some(item => item.id === 'counted'), false);
    const ranked = search(broad, 'koncentrat', ['KONCENTRAT Z SPISANY'], 24, true);
    assert.equal(ranked[0].id, 'counted');
    for (const query of ['M-55-BAR-XYZ', 'K-Z-001']) {
      assert.equal(search(await projection.readOriginalInventorySearchCandidates(db, query, true), query, [], 8, true)[0].id, 'counted');
    }
    assert.deepEqual((await pg.query('select * from original_inventory_entries')).rows, [{ name: 'Untouched stock', qty: '123' }]);
  } finally { await pg.close(); }
});

test('generation guards block stale publication; renames, pairing, blocks, deletion and rollback invalidate correctly', async () => {
  const { pg, db, add } = await fixture();
  try {
    await add('tray-old', 'TRAY HANDLE', 'M-10-PWY-BSHL-10012', null, 'M-10');
    await add('tray-second', 'TRAY HANDLE', 'M-10-8001103471', null, 'M-10');
    await add('blocked', 'BLOCKED MATERIAL', 'M-1-BLOCK', '999');
    const source = (await db.rpc('get_original_inventory_search_source')).data;
    const state = { version: 1, items: [{ name: 'TRAY HANDLE', unit: 'szt.', indexCode: 'M-10-PWY-BSHL-10012', indexCode2: 'M-10-8001103471', warehouseCode: 'M-10' }],
      blocked: [{ name: 'BLOCKED MATERIAL', unit: 'szt.', indexCode: 'M-1-BLOCK', indexCode2: '999', warehouseCode: 'M-1' }] };
    await pg.query('insert into material_planning_state(id,state) values ($1,$2)', ['original-inventory-catalog-register', state]);
    assert.equal((await db.rpc('publish_original_inventory_search', { p_generation: source.generation, p_format: 1,
      p_rows: projection.buildOriginalInventorySearchProjection(source.rows, null) })).data, false);
    assert.equal(await projection.refreshOriginalInventorySearchProjection(db), true);
    const paired = await projection.readOriginalInventorySearchCandidates(db, 'tray', true);
    assert.equal(paired.length, 1);
    assert.equal(paired[0].indexCode, 'M-10-PWY-BSHL-10012');
    assert.equal(paired[0].indexCode2, 'M-10-8001103471');
    assert.equal(paired[0].catalogIds.length, 2);
    assert.deepEqual(await projection.readOriginalInventorySearchCandidates(db, 'blocked', true), []);
    await pg.exec(sql);
    assert.equal((await db.rpc('get_original_inventory_search_candidates', {p_terms:[],p_only_index2:false,p_format:1})).data.ready, true);
    const generation = (await db.rpc('get_original_inventory_search_source')).data.generation;
    await pg.query('insert into material_planning_state(id,state) values ($1,$2)', ['other-plan', {}]);
    assert.equal((await db.rpc('get_original_inventory_search_source')).data.generation, generation, 'unrelated planning writes must not invalidate');
    state.items[0].previousNames = ['TRAY HANDLE'];
    state.items[0].name = 'TRAY RENAMED';
    await pg.query('update material_planning_state set state=$1,revision=revision+1 where id=$2', [state, 'original-inventory-catalog-register']);
    assert.equal(await projection.refreshOriginalInventorySearchProjection(db), true);
    const renamed = await projection.readOriginalInventorySearchCandidates(db, 'handle', true);
    assert.equal(renamed[0].name, 'TRAY RENAMED');
    assert.ok(renamed[0].previousNames.includes('TRAY HANDLE'));
    await pg.exec('begin; delete from original_inventory_catalog; rollback;');
    assert.deepEqual(await projection.readOriginalInventorySearchCandidates(db, 'handle', true), renamed);
    await pg.exec("delete from original_inventory_catalog where id in ('tray-old','tray-second');");
    assert.equal(await projection.refreshOriginalInventorySearchProjection(db), true);
    assert.deepEqual(await projection.readOriginalInventorySearchCandidates(db, 'handle', true), []);
    await pg.exec('delete from material_planning_state; truncate original_inventory_catalog;');
    assert.equal(await projection.refreshOriginalInventorySearchProjection(db), true);
    assert.deepEqual(await projection.readOriginalInventorySearchCandidates(db, 'blocked', false), []);
  } finally { await pg.close(); }
});

test('projection tables and RPCs deny public access; failed publication is atomic', async () => {
  const { pg, db, add } = await fixture();
  try {
    await add('one', 'ONE', 'M-1-ONE', '001');
    await projection.refreshOriginalInventorySearchProjection(db);
    const snapshot = (await pg.query('select * from original_inventory_search_items')).rows;
    await add('two', 'TWO', 'M-1-TWO', '002');
    const source = (await db.rpc('get_original_inventory_search_source')).data;
    const broken = await db.rpc('publish_original_inventory_search', {p_generation:source.generation,p_format:1,p_rows:[{}]});
    assert.ok(broken.error);
    assert.deepEqual((await pg.query('select * from original_inventory_search_items')).rows, snapshot);
    assert.equal((await db.rpc('get_original_inventory_search_candidates', {p_terms:['one'],p_only_index2:true,p_format:1})).data.ready, false);
    for (const role of ['anon','authenticated']) {
      for (const fn of ['get_original_inventory_search_source()', 'get_original_inventory_search_candidates(text[],boolean,integer)', 'publish_original_inventory_search(bigint,integer,jsonb)']) {
        assert.equal((await pg.query('select has_function_privilege($1,$2,$3) allowed',[role,fn,'execute'])).rows[0].allowed, false);
      }
      assert.equal((await pg.query("select has_table_privilege($1,'original_inventory_search_items','select') allowed",[role])).rows[0].allowed, false);
      await pg.exec(`set role ${role};`);
      await assert.rejects(pg.query('select get_original_inventory_search_source()'), /permission denied/);
      await pg.exec('reset role;');
    }
    const restartedClient = { rpc: db.rpc.bind(db) };
    assert.equal(await projection.refreshOriginalInventorySearchProjection(restartedClient), true);
    assert.equal((await projection.readOriginalInventorySearchCandidates(restartedClient, 'two', true))[0].id, 'two');
  } finally { await pg.close(); }
});

test('an unprepared catalog immediately selects fallback instead of loading or publishing the full catalog while typing', async () => {
  const calls = [];
  const db = { async rpc(name) { calls.push(name); return {data:{ready:false,generation:'17',items:[]},error:null}; } };
  const generations = [];
  assert.equal(await projection.readOriginalInventorySearchCandidates(db,'9203',true, generation => generations.push(generation)), null);
  assert.deepEqual(generations,['17']);
  assert.deepEqual(calls,['get_original_inventory_search_candidates']);
});

test('missing migration falls back, failures never masquerade as empty results and concurrent preparations coalesce', async () => {
  const absent = {rpc:async()=>({data:null,error:{code:'PGRST202'}})};
  assert.equal(await projection.readOriginalInventorySearchCandidates(absent, 'tray', true), null);
  assert.equal(await projection.refreshOriginalInventorySearchProjection(absent), false);
  const unavailable = {rpc:async()=>({data:null,error:new Error('OFFLINE')})};
  await assert.rejects(projection.readOriginalInventorySearchCandidates(unavailable, 'tray', true), /OFFLINE/);
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  let sourceReads = 0, publishes = 0;
  const concurrent = {async rpc(name) {
    if (name === 'get_original_inventory_search_candidates') return {data:{ready:false},error:null};
    if (name === 'get_original_inventory_search_source') { sourceReads++; await barrier; return {data:{generation:String(sourceReads),rows:[],register:null},error:null}; }
    publishes++;
    return {data:publishes > 1,error:null};
  }};
  const first = projection.refreshOriginalInventorySearchProjection(concurrent);
  const second = projection.refreshOriginalInventorySearchProjection(concurrent);
  assert.equal(first, second);
  release();
  assert.equal(await first, true);
  assert.equal(sourceReads, 2, 'one retry on concurrent generation change');
  assert.equal(publishes, 2);
});

test('search migration also runs twice on the supplied company schema without altering catalog or stock', async () => {
  const pg = await createSqlTestDatabase();
  try {
    await loadSuppliedDatabase(pg);
    await pg.exec("insert into warehouses(id,name) values ('search-compatibility','Test');");
    await pg.exec("insert into original_inventory_entries(warehouse_id,name,qty,unit,user_name) values ('search-compatibility','Existing stock',123,'szt.','Tester');");
    const before = (await pg.query('select * from original_inventory_entries')).rows;
    const catalog = (await pg.query('select * from original_inventory_catalog')).rows;
    await pg.exec(sql);
    await pg.exec(sql);
    assert.deepEqual((await pg.query('select * from original_inventory_entries')).rows, before);
    assert.deepEqual((await pg.query('select * from original_inventory_catalog')).rows, catalog);
    const source = (await pg.query('select get_original_inventory_search_source() value')).rows[0].value;
    assert.ok(Array.isArray(source.rows));
  } finally { await pg.close(); }
});
