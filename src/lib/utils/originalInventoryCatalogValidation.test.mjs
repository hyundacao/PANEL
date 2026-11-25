import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { readSqlModule } from '../../../scripts/sql-files.mjs';
import { createSqlTestDatabase } from '../../../scripts/sql-test-database.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ts = require('typescript');
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const mod = new Module(file);
  cache.set(file, mod);
  mod.filename = file;
  const base = createRequire(file);
  mod.require = name => {
    if (name.startsWith('./')) return load(resolve(dirname(file), `${name}.ts`));
    if (name.startsWith('@/')) return load(resolve(here, '../..', `${name.slice(2)}.ts`));
    return base(name);
  };
  mod._compile(ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, file);
  return mod.exports;
}

const { assertOriginalInventoryCatalogAllowed: validate, CATALOG_REGISTER_MODULE_ID: registerId } =
  load(join(here, 'originalInventoryCatalogRegisterServer.ts'));
const sql = readFileSync(join(here, '../../../supabase/13_weryfikacja_kartotek_spisu.sql'), 'utf8');
const product = (name, indexCode, indexCode2, extra = {}) => ({
  name, indexCode, indexCode2, unit: 'szt.', warehouseCode: 'M-1', ...extra
});
const stockItem = product('CARTON A', 'M-1-A', '0001', { previousNames: ['OLD CARTON A'] });
const blockedItem = product('BLOCKED CARTON', 'M-1-B', '0002');
const ambiguous = product('CARTON C', 'M-1-C', '0003');
const state = (items, blocked = []) => ({ version: 1, items, blocked });

test('server checks the register in one SQL read and sends a small response when unchanged', async (t) => {
  const pg = await createSqlTestDatabase();
  t.after(() => pg.close());
  await pg.exec(readSqlModule('07_planowanie_zapotrzebowania.sql'));
  const filler = Array.from({ length: 10_000 }, (_, i) => product(`MATERIAL ${i}`, `M-1-TEST-${i}`, `L-${i}`));
  const initial = state([stockItem, ambiguous, product('CARTON D', 'M-1-D', '0003'), ...filler], [blockedItem]);
  const save = (register, revision) => pg.query(
    'select * from public.save_material_planning_state($1, $2, $3, $4)', [registerId, register, revision, 'Test']
  );
  await save(initial, 0);
  await pg.query("insert into public.material_planning_state (id, state) values ('main', $1)", [{ untouched: true }]);
  const before = (await pg.query('select * from public.material_planning_state order by id')).rows;
  await pg.exec(sql);
  await pg.exec(sql);
  assert.deepEqual((await pg.query('select * from public.material_planning_state order by id')).rows, before);

  for (const role of ['anon', 'authenticated']) {
    await pg.exec(`set role ${role}`);
    await assert.rejects(pg.query('select * from public.get_original_inventory_validation_register(null)'), { code: '42501' });
    await pg.exec('reset role');
  }

  const responses = [];
  const db = { async rpc(name, args) {
    assert.equal(name, 'get_original_inventory_validation_register');
    await pg.exec('set role service_role');
    try {
      const data = (await pg.query('select * from public.get_original_inventory_validation_register($1)', [args.p_known_version])).rows;
      responses.push({ data, known: args.p_known_version });
      return { data, error: null };
    } finally { await pg.exec('reset role'); }
  } };
  await validate(db, stockItem);
  assert.deepEqual(responses[0].data[0].state, initial);
  assert.equal(responses[0].known, null);
  await validate(db, { name: 'OLD CARTON A', indexCode: '0001', unit: 'pcs' });
  await validate(db, { ...stockItem, indexCode: '0001', indexCode2: null });
  await validate(db, { name: 'Manual unregistered material', unit: 'kg' });
  await assert.rejects(validate(db, { name: blockedItem.name }), /CATALOG_BLOCKED/);
  await assert.rejects(validate(db, { name: 'Other name', indexCode2: '0002' }), /CATALOG_BLOCKED/);
  await assert.rejects(validate(db, { name: 'Other name', indexCode2: '0003' }), /CATALOG_AMBIGUOUS/);
  assert.equal(responses.length, 7);
  assert.ok(responses.slice(1).every(r => r.known === responses[0].data[0].version &&
    r.data[0].unchanged && r.data[0].state === null));
  const full = gzipSync(JSON.stringify(responses[0].data)).length;
  const small = gzipSync(JSON.stringify(responses[1].data)).length;
  assert.ok(small < 150 && small * 100 < full);
  t.diagnostic(`synthetic register response: ${full} gzip bytes -> ${small} on an unchanged read`);

  await save(state([], [stockItem]), 1);
  await assert.rejects(validate(db, stockItem), /CATALOG_BLOCKED/);
  assert.equal(responses.at(-1).data[0].unchanged, false, 'import is visible on the next write');
  await pg.query('update public.material_planning_state set state = $1 where id = $2', [state([stockItem]), registerId]);
  await validate(db, stockItem);
  assert.equal(responses.at(-1).data[0].unchanged, false, 'direct update is visible without a revision increment');
  await pg.query('delete from public.material_planning_state where id = $1', [registerId]);
  await validate(db, blockedItem);
  assert.deepEqual(responses.at(-1).data, [], 'deleted register is not replaced by an old cache entry');
  await save(state([], [blockedItem]), 0);
  await assert.rejects(validate(db, blockedItem), /CATALOG_BLOCKED/);
  assert.equal(responses.at(-1).known, null);
});

test('deploying code without SQL keeps the old checks; other database errors are not ignored', async () => {
  let fallbackReads = 0;
  let error = { code: 'PGRST202' };
  const db = {
    rpc: async () => ({ data: null, error }),
    from(table) {
      assert.equal(table, 'material_planning_state');
      fallbackReads++;
      return {
        select(value) {
          assert.equal(value, 'state,revision');
          return {
            eq(column, value) {
              assert.equal(column, 'id');
              assert.equal(value, registerId);
              return { maybeSingle: async () => ({
                data: { state: state([stockItem], [blockedItem]), revision: 4 }, error: null
              }) };
            }
          };
        }
      };
    }
  };
  await validate(db, stockItem);
  await assert.rejects(validate(db, blockedItem), /CATALOG_BLOCKED/);
  assert.equal(fallbackReads, 2);
  error = { code: '42501' };
  await assert.rejects(validate(db, stockItem), error);
  assert.equal(fallbackReads, 2);
});
