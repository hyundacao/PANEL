import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { readSqlModule } from '../../../scripts/sql-files.mjs';
import { createSqlTestDatabase, loadSuppliedDatabase, withoutUnavailableTestExtension } from '../../../scripts/sql-test-database.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const load = (name) => {
  const mod = { exports: {} };
  const file = new URL(`./${name}.ts`, import.meta.url);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module: mod, exports: mod.exports, require: (path) => path.startsWith('@/lib/utils/') ? load(path.split('/').at(-1)) : require(path) });
  return mod.exports;
};
const { buildOriginalInventoryNameResolver, findOriginalInventoryCatalogMaterial } = load('originalInventoryErpMatch');
const { searchOriginalInventorySpisSuggestions } = load('originalInventorySpisSearch');
const shortName = 'KRATA STALOWA 1M IMPORT Z LOGO DOMELO';
const fullName = `${shortName} SYSTEM 1000X63X98X148`;
const id = '00000000-0000-4000-8000-000000000001';

test('SQL renames one catalog row atomically, preserves history, blocks stale writes and survives reruns', async () => {
  const db = await createSqlTestDatabase();
  try {
    await loadSuppliedDatabase(db);
    await db.query('insert into original_inventory_catalog(id,name,unit,index_code) values ($1,$2,$3,$4)', [id, shortName, 'szt.', '1598-7']);
    await db.exec("insert into warehouses(id,name) values ('rename-hall','Test');");
    await db.query('insert into original_inventory_entries(warehouse_id,name,qty,unit,user_name) values ($1,$2,690,$3,$4)', ['rename-hall', shortName, 'szt.', 'Tester']);
    const rawBefore = (await db.query('select * from original_inventory_entries')).rows;
    const migration = withoutUnavailableTestExtension(readSqlModule('04_spis_rzeczywisty_i_stany_erp.sql'));
    await db.exec(migration);
    assert.deepEqual((await db.query('select previous_names from original_inventory_catalog where id=$1', [id])).rows[0].previous_names, []);
    const rename = async (previousName, name, indexCode = '1598-7') => (await db.query(
      'select * from rename_original_inventory_catalog_items($1::jsonb)', [JSON.stringify([{ id, previousName, name, indexCode }])]
    )).rows[0];
    assert.deepEqual(await rename(shortName, fullName), { id, updated: true });
    assert.deepEqual(await rename(shortName, 'STALE NAME'), { id, updated: false });
    assert.deepEqual(await rename(fullName, 'WRONG INDEX', '1700'), { id, updated: false });
    assert.deepEqual(await rename(fullName, ''), { id, updated: false });
    let current = (await db.query('select * from original_inventory_catalog where id=$1', [id])).rows[0];
    assert.equal(current.name, fullName);
    assert.equal(current.index_code, '1598-7');
    assert.equal(current.unit, 'szt.');
    assert.deepEqual(current.previous_names, [shortName]);
    assert.equal((await db.query('select count(*)::int n from original_inventory_catalog where index_code=$1', ['1598-7'])).rows[0].n, 1);
    assert.deepEqual((await db.query('select * from original_inventory_entries')).rows, rawBefore);
    await db.exec(migration);
    assert.deepEqual((await db.query('select * from original_inventory_catalog where id=$1', [id])).rows[0], current);
    assert.deepEqual(await rename(fullName, 'THIRD NAME'), { id, updated: true });
    current = (await db.query('select * from original_inventory_catalog where id=$1', [id])).rows[0];
    assert.deepEqual(new Set(current.previous_names), new Set([shortName, fullName]));
    const rights = (await db.query("select has_function_privilege('anon','rename_original_inventory_catalog_items(jsonb)','execute') anon, has_function_privilege('authenticated','rename_original_inventory_catalog_items(jsonb)','execute') authenticated, has_function_privilege('service_role','rename_original_inventory_catalog_items(jsonb)','execute') service")).rows[0];
    assert.deepEqual(rights, { anon: false, authenticated: false, service: true });
  } finally { await db.close(); }
});

test('old and new names resolve to the same index without changing measurements or merging a different SYSTEM', () => {
  const catalog = [{ name: fullName, unit: 'szt.', indexCode: '1598-7', previousNames: [shortName] },
    { name: 'SYSTEM 1000X63X98X148', unit: 'szt.', indexCode: '1700' }];
  const resolveName = buildOriginalInventoryNameResolver(catalog);
  const entry = { name: shortName, unit: 'szt.', qty: 690 };
  assert.equal(resolveName(entry), fullName);
  assert.equal(entry.name, shortName);
  assert.equal(entry.qty, 690);
  assert.equal(resolveName({ name: 'ERP OLD LABEL', unit: 'szt.', indexCode: '1598-7' }), fullName);
  assert.equal(resolveName({ name: 'SYSTEM 1000X63X98X148', unit: 'szt.' }), 'SYSTEM 1000X63X98X148');
  assert.equal(resolveName({ name: shortName, unit: 'kg' }), shortName);
  assert.equal(findOriginalInventoryCatalogMaterial(catalog, entry).indexCode, '1598-7');
  assert.equal(searchOriginalInventorySpisSuggestions(catalog, shortName, [], 8)[0].name, fullName);
  const ambiguous = [...catalog, { name: 'OTHER', unit: 'szt.', indexCode: '1800', previousNames: [shortName] }];
  assert.equal(buildOriginalInventoryNameResolver(ambiguous)(entry), shortName);
  assert.equal(findOriginalInventoryCatalogMaterial(ambiguous, entry), null);
});
