import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { readSqlSource } from '../../../scripts/sql-files.mjs';

const require = createRequire(import.meta.url), ts = require('typescript');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const cache = new Map();
function load(path) {
  const file = path.endsWith('.ts') ? path : `${path}.ts`;
  if (cache.has(file)) return cache.get(file).exports;
  const mod = new Module(file);
  cache.set(file, mod);
  mod.require = name => name.startsWith('@/') ? load(resolve(root, name.slice(2)))
    : name.startsWith('.') ? load(resolve(dirname(file), name)) : require(name);
  mod._compile(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
  return mod.exports;
}
const access = load(resolve(root, 'lib/auth/access.ts'));
const users = load(resolve(root, 'lib/supabase/users.ts'));
const { fetchPaintTapeInventoryComments: fetchComments, savePaintTapeInventoryComment: saveComment } = load(resolve(root, 'lib/utils/paintTapeInventoryCommentsServer.ts'));
const routeText = readFileSync(resolve(root, 'app/api/app/route.ts'), 'utf8');
const routeAst = ts.createSourceFile('route.ts', routeText, ts.ScriptTarget.ES2022, true);
const declarations = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) declarations.set(node.name.text, node.getText(routeAst));
  ts.forEachChild(node, visit);
}
visit(routeAst);
const context = { exports: {}, ...access };
const functions = ['requireWarehouseAccess', 'requireAnyTabAccess', 'requireTabWriteAccess', 'requireWarehouseAdminAccess', 'ensureActionAccess'];
vm.runInNewContext(ts.transpileModule(functions.map(name => `const ${declarations.get(name)};`).join('\n') + '\nexports.check = ensureActionAccess;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
const user = (role = 'USER', flag, readOnly = false) => ({ role, access: { admin: false, warehouses: {
  FARBY_TASMY: { role: 'ROZDZIELCA', readOnly, admin: role === 'ADMIN', tabs: ['rozliczanie-farb-tasm'] }
}, paintTapePermissions: flag === undefined ? undefined : { inventoryComments: flag } } });

test('private comments default to hidden, including existing module administrators, and require explicit permission', () => {
  for (const role of ['USER', 'ADMIN', 'VIEWER']) {
    for (const flag of [undefined, false, 'true', 1]) {
      const current = user(role, flag);
      assert.equal(access.getPaintTapePermissions(current).inventoryComments, false);
      assert.throws(() => context.exports.check('getPaintTapeInventoryComments', current, {}), /FORBIDDEN/);
      assert.throws(() => context.exports.check('savePaintTapeInventoryComment', current, {}), /FORBIDDEN/);
    }
  }
  for (const current of [user('USER', true), user('ADMIN', true), user('HEAD_ADMIN')]) {
    assert.equal(access.getPaintTapePermissions(current).inventoryComments, true);
    assert.doesNotThrow(() => context.exports.check('getPaintTapeInventoryComments', current, {}));
    assert.doesNotThrow(() => context.exports.check('savePaintTapeInventoryComment', current, {}));
  }
  assert.equal(access.getPaintTapePermissions(null).inventoryComments, false);
});

test('read-only users can read enabled comments but cannot save them; no module access still denies reading', () => {
  const reader = user('USER', true, true);
  assert.doesNotThrow(() => context.exports.check('getPaintTapeInventoryComments', reader, {}));
  assert.throws(() => context.exports.check('savePaintTapeInventoryComment', reader, {}), /FORBIDDEN/);
  const noModule = user('USER', true);
  noModule.access.warehouses = {};
  assert.throws(() => context.exports.check('getPaintTapeInventoryComments', noModule, {}), /FORBIDDEN/);
});

test('saving and reloading old permission records does not silently grant access to comments', () => {
  for (const flag of [undefined, false, 'true', 1, true]) {
    const raw = user('USER', flag).access;
    raw.paintTapePermissions = { create: true, ...(raw.paintTapePermissions ?? {}) };
    const normalized = users.normalizeAccessForDb(raw);
    assert.equal(normalized.paintTapePermissions.inventoryComments, flag === true);
    assert.equal(normalized.paintTapePermissions.create, true);
    assert.equal(normalized.paintTapePermissions.accounting, true);
    assert.equal(users.normalizeAccessForDb(normalized).paintTapePermissions.inventoryComments, flag === true);
  }
});

const sessionId = '00000000-0000-0000-0000-000000000001';
const otherSession = '00000000-0000-0000-0000-000000000002';
const itemId = '00000000-0000-0000-0000-000000000003';
const otherItem = '00000000-0000-0000-0000-000000000004';
function adapter(pg) {
  return { from(table) {
    assert.ok(['paint_tape_inventory_comments', 'paint_tape_inventory_entries'].includes(table));
    let method = 'select', fields = '*', row, singleton = false, limit = null, offset = 0;
    const filters = [];
    const query = {
      select(value = '*') { fields = value; return query; },
      eq(key, value) { filters.push([key, value]); return query; },
      order() { return query; },
      range(from, to) { offset = from; limit = to - from + 1; return query; },
      limit(value) { limit = value; return query; },
      maybeSingle() { singleton = true; return query; },
      single() { singleton = true; return query; },
      insert(value) { method = 'insert'; row = value; return query; },
      update(value) { method = 'update'; row = value; return query; },
      async then(done) {
        try {
          const values = [];
          const param = value => { values.push(value); return `$${values.length}`; };
          const where = () => filters.length ? ` where ${filters.map(([k, v]) => `${k} = ${param(v)}`).join(' and ')}` : '';
          let sql;
          if (method === 'insert') sql = `insert into ${table} (${Object.keys(row).join(',')}) values (${Object.values(row).map(param).join(',')}) returning *`;
          else if (method === 'update') sql = `update ${table} set ${Object.entries(row).map(([k, v]) => `${k} = ${param(v)}`).join(',')}${where()} returning *`;
          else sql = `select ${fields} from ${table}${where()}${table.endsWith('comments') ? ' order by catalog_item_id' : ''}${limit !== null ? ` limit ${limit} offset ${offset}` : ''}`;
          const { rows } = await pg.query(sql, values);
          return done({ data: singleton ? rows[0] ?? null : rows, error: null });
        } catch (error) { return done({ data: null, error }); }
      }
    };
    return query;
  } };
}

test('real SQL stores per-day comments, protects concurrent edits and preserves counts and catalog', async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table paint_tape_inventory_sessions(id uuid primary key, status text, erp_comparison jsonb);
      create table paint_tape_inventory_catalog(id uuid primary key, name text);
      create table paint_tape_inventory_entries(id int primary key, session_id uuid references paint_tape_inventory_sessions on delete cascade, catalog_item_id uuid references paint_tape_inventory_catalog, qty numeric);
      insert into paint_tape_inventory_sessions values ('${sessionId}', 'CLOSED', '{"erp":1.3}'), ('${otherSession}', 'OPEN', null);
      insert into paint_tape_inventory_catalog values ('${itemId}', 'Paint'), ('${otherItem}', 'Other');
      insert into paint_tape_inventory_entries values (1, '${sessionId}', '${itemId}', 1.52), (2, '${otherSession}', '${itemId}', 5);`);
    const migration = readSqlSource('paint_tape_inventory_comments');
    await pg.exec(migration);
    await pg.exec(migration);
    const before = await pg.query('select * from paint_tape_inventory_entries order by id');
    const archiveBefore = await pg.query('select * from paint_tape_inventory_sessions order by id');
    const db = adapter(pg);
    const first = await saveComment(db, { sessionId, catalogItemId: itemId, text: '  Private note\nSecond line  ', expectedRevision: 0 }, 'Accountant');
    assert.equal(first.text, 'Private note\nSecond line');
    assert.equal(first.revision, 1);
    assert.equal(first.updatedBy, 'Accountant');
    await pg.exec(migration);
    assert.equal((await fetchComments(db, sessionId))[0].text, first.text);
    assert.deepEqual(await fetchComments(db, otherSession), []);
    await assert.rejects(saveComment(db, { sessionId, catalogItemId: itemId, text: 'stale insert', expectedRevision: 0 }, 'Other'), /INVENTORY_COMMENT_CONFLICT/);
    const updated = await saveComment(db, { sessionId, catalogItemId: itemId, text: 'Updated', expectedRevision: 1 }, 'Other');
    assert.equal(updated.revision, 2);
    await assert.rejects(saveComment(db, { sessionId, catalogItemId: itemId, text: 'stale update', expectedRevision: 1 }, 'Accountant'), /INVENTORY_COMMENT_CONFLICT/);
    const cleared = await saveComment(db, { sessionId, catalogItemId: itemId, text: '', expectedRevision: 2 }, 'Other');
    assert.equal(cleared.text, '');
    assert.equal(cleared.revision, 3);
    await assert.rejects(saveComment(db, { sessionId, catalogItemId: otherItem, text: 'No measurement', expectedRevision: 0 }, 'Other'), /NOT_FOUND/);
    assert.deepEqual(await pg.query('select * from paint_tape_inventory_entries order by id'), before);
    assert.deepEqual(await pg.query('select * from paint_tape_inventory_sessions order by id'), archiveBefore);
    await pg.exec('set role anon');
    await assert.rejects(pg.query('select * from paint_tape_inventory_comments'), /permission denied/);
    await pg.exec('reset role; set role authenticated');
    await assert.rejects(pg.query('select * from paint_tape_inventory_comments'), /permission denied/);
    await pg.exec('reset role');
    await pg.query('delete from paint_tape_inventory_sessions where id=$1', [sessionId]);
    assert.equal((await pg.query('select * from paint_tape_inventory_comments')).rows.length, 0);
    assert.equal((await pg.query('select * from paint_tape_inventory_catalog')).rows.length, 2);
    assert.equal((await pg.query('select * from paint_tape_inventory_entries')).rows.length, 1);
  } finally { await pg.close(); }
});

test('invalid comment payloads fail before contacting the database', async () => {
  const db = { from() { assert.fail('invalid input must not query DB'); } };
  const valid = { sessionId, catalogItemId: itemId, text: 'note', expectedRevision: 0 };
  for (const input of [null, { ...valid, sessionId: '' }, { ...valid, text: 7 }, { ...valid, text: 'x'.repeat(4001) },
    { ...valid, text: '\0' }, { ...valid, expectedRevision: -1 }, { ...valid, expectedRevision: 0.5 }]) {
    await assert.rejects(saveComment(db, input, 'Test'), /NOT_FOUND|INVENTORY_COMMENT_INVALID/);
  }
});

test('missing comments migration is explicit, not an empty successful read', async () => {
  const db = { from() { return { select() { return this; }, eq() { return this; }, order() { return this; },
    range() { return { data: null, error: { code: 'PGRST205', message: 'missing' } }; } }; } };
  await assert.rejects(fetchComments(db, sessionId), /MIGRATION_REQUIRED_PAINT_TAPE_INVENTORY_COMMENTS/);
});

test('private text does not enter the general inventory response or ERP archive', () => {
  const handler = routeText.slice(routeText.indexOf("case 'getPaintTapeInventory': {"), routeText.indexOf("case 'savePaintTapeInventoryEntry': {"));
  assert.doesNotMatch(handler, /paint_tape_inventory_comments|fetchPaintTapeInventoryComments/);
  assert.doesNotMatch(readFileSync(resolve(root, 'lib/utils/paintTapeInventoryArchive.ts'), 'utf8'), /inventoryComments|paint_tape_inventory_comments|fetchPaintTapeInventoryComments/);
});
