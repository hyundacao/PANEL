import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { GRIND_DOCUMENT_KG_LIMIT, GRIND_DOCUMENT_BATCH_LIMIT, splitGrindingQuantity, isPieceGrindingUnit } from './originalInventoryGrinding.ts';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;

test('splits kg into full 500 kg parts and one exact remainder without zero rows', () => {
  for (const [qty, parts] of [[20, [20]], [500, [500]], [700, [500, 200]], [1000, [500, 500]],
    [1581.336, [500, 500, 500, 81.336]], [500.001, [500, 0.001]], [1000.00001, [500, 500, 0.00001]]]) {
    assert.deepEqual(splitGrindingQuantity(qty, 'kg'), parts);
    assert.deepEqual(splitGrindingQuantity(qty, ' KG. '), parts);
    assert.equal(parts.reduce((sum, part) => sum + part, 0), qty);
    assert.ok(parts.every((part) => part > 0 && part <= 500));
  }
  assert.deepEqual(splitGrindingQuantity(700, 'szt.'), [700]);
  assert.deepEqual(splitGrindingQuantity(1500, 'szt'), [1500]);
  for (const qty of [0, -1, NaN, Infinity]) assert.throws(() => splitGrindingQuantity(qty, 'kg'), /QTY_REQUIRED/);
  assert.throws(() => splitGrindingQuantity(1.5, 'szt.'), /QTY_INTEGER_REQUIRED/);
  assert.equal(splitGrindingQuantity(500 * GRIND_DOCUMENT_BATCH_LIMIT, 'kg').length, GRIND_DOCUMENT_BATCH_LIMIT);
  assert.throws(() => splitGrindingQuantity(500 * GRIND_DOCUMENT_BATCH_LIMIT + 0.001, 'kg'), /TOO_MANY_GRIND_DOCUMENTS/);
});

const component = readFileSync(join(root, 'components/planowanie-zapotrzebowania/SpisRzeczywisty.tsx'), 'utf8');
const ast = ts.createSourceFile('SpisRzeczywisty.tsx', component, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const initializers = new Map();
const visit = (node) => {
  if (ts.isVariableDeclaration(node) && node.initializer) initializers.set(node.name.getText(ast), node.initializer.getText(ast));
  ts.forEachChild(node, visit);
};
visit(ast);
const documents = (tasks, kind = 'materials', mode = 'pending') => {
  const mod = { exports: {} };
  vm.runInNewContext(compile(`module.exports = (${initializers.get('buildGrindDocuments')})(tasks, mode);`), {
    module: mod, tasks, mode, grindKind: kind, GRIND_DOCUMENT_KG_LIMIT,
    normalizeCatalogNameKey: (name) => name.trim().toLowerCase(),
    isMissingDetailGrindTarget: (task) => isPieceGrindingUnit(task.unit) && (!task.targetMaterialName || task.materialName === task.targetMaterialName)
  });
  return JSON.parse(JSON.stringify(mod.exports));
};
const task = (id, qty, extra = {}) => ({ id, qty, unit: 'kg', materialName: 'ABS', targetMaterialName: 'PRZEMIAL ABS', status: 'PENDING', createdAt: '2026-10-21T12:00:00Z', ...extra });

test('the actual document list keeps split rows separate after reload even if the server returns the remainder first', () => {
  const tasks = [task('remainder', 200), task('full', 500)];
  const docs = documents(tasks);
  assert.deepEqual(docs.map((doc) => doc.totalQty), [500, 200]);
  assert.deepEqual(docs.map((doc) => doc.tasks.map((row) => row.id)), [['full'], ['remainder']]);
  assert.deepEqual(documents(JSON.parse(JSON.stringify(tasks))), docs);
  const completedIds = new Set(docs[0].tasks.map((row) => row.id));
  assert.deepEqual(documents(tasks.filter((row) => !completedIds.has(row.id))).map((doc) => doc.totalQty), [200]);
  assert.equal(documents(tasks.map((row) => ({ ...row, unit: 'szt.' })), 'details').length, 1);
});

test('existing pending documents keep their quantities and never exceed 500 kg after new parts are added', () => {
  const rows = [task('existing', 400, { createdAt: '2026-10-20T12:00:00Z' }), ...splitGrindingQuantity(1581.336, 'kg').map((qty, i) => task(`new-${i}`, qty))];
  const docs = documents(rows);
  assert.ok(docs.every((doc) => doc.totalQty <= 500));
  assert.equal(docs.reduce((sum, doc) => sum + doc.totalQty, 0), 1981.336);
  assert.deepEqual(docs.flatMap((doc) => doc.tasks.map((row) => row.id)).sort(), rows.map((row) => row.id).sort());
});

function apiFixture() {
  const state = { user: { id: 'user', name: 'Operator', username: 'operator', role: 'HEAD_ADMIN', access: {} }, tasks: [], inserts: [], fail: false };
  class Query {
    constructor(table) { this.table = table; this.rows = null; }
    select() { return this; }
    insert(rows) { this.rows = Array.isArray(rows) ? rows : [rows]; return this; }
    then(a, b) { return this.run().then(a, b); }
    async run() {
      if (this.table === 'audit_logs') return { data: [], error: null };
      assert.equal(this.table, 'original_inventory_grind_tasks');
      assert.ok(this.rows);
      state.inserts.push(structuredClone(this.rows));
      if (state.fail) return { data: null, error: { message: 'Simulated insert failure' } };
      state.tasks.push(...structuredClone(this.rows));
      return { data: structuredClone(this.rows), error: null };
    }
  }
  const mocks = {
    '@/lib/auth/session': { getAuthenticatedUser: async () => ({ user: state.user, code: 'UNAUTHORIZED' }), clearSessionCookie() {} },
    '@/lib/supabase/admin': { supabaseAdmin: { from: (table) => new Query(table) } },
    '@/lib/push/server': {}
  };
  const cache = new Map();
  function load(file) {
    const path = [file, `${file}.ts`, join(file, 'index.ts')].find(existsSync);
    assert.ok(path, file);
    if (cache.has(path)) return cache.get(path).exports;
    const mod = new Module(path); cache.set(path, mod);
    mod.require = (name) => Object.hasOwn(mocks, name) ? mocks[name] : name.startsWith('@/') ? load(join(root, name.slice(2))) : name.startsWith('.') ? load(resolve(dirname(path), name)) : require(name);
    mod._compile(compile(readFileSync(path, 'utf8')), path);
    return mod.exports;
  }
  const route = load(join(root, 'app/api/app/route.ts'));
  return { state, add: (qty, unit = 'kg') => route.POST(new Request('http://test/api/app', {
    method: 'POST', body: JSON.stringify({ action: 'addOriginalInventoryGrindTask', payload: { materialName: 'ABS', targetMaterialName: 'PRZEMIAL ABS', qty, unit, sourceReportDate: '2026-10-21' } })
  })) };
}

test('API saves all parts in one insert with independent ids and unchanged material, target, date and author', async () => {
  const f = apiFixture();
  const response = await f.add(700);
  assert.equal(response.status, 200);
  const rows = await response.json();
  assert.deepEqual(rows.map((row) => row.qty), [500, 200]);
  assert.equal(new Set(rows.map((row) => row.id)).size, 2);
  assert.equal(f.state.inserts.length, 1);
  for (const row of f.state.tasks) {
    assert.equal(row.material_name, 'ABS'); assert.equal(row.target_material_name, 'PRZEMIAL ABS');
    assert.equal(row.unit, 'kg'); assert.equal(row.status, 'PENDING'); assert.equal(row.created_by, 'Operator');
    assert.equal(row.source_report_date, '2026-10-21');
  }
  assert.deepEqual(documents(rows).map((doc) => doc.totalQty), [500, 200]);
  assert.equal((await (await f.add(700, 'szt.')).json()).length, 1);
});

test('API failure cannot leave only one part saved and invalid quantities never reach the insert', async () => {
  const f = apiFixture(); f.state.fail = true;
  assert.notEqual((await f.add(700)).status, 200);
  assert.equal(f.state.inserts.length, 1); assert.equal(f.state.inserts[0].length, 2); assert.deepEqual(f.state.tasks, []);
  f.state.inserts = []; f.state.fail = false;
  for (const [qty, unit] of [[0, 'kg'], [-1, 'kg'], [1.5, 'szt.'], [1e10, 'kg']]) assert.notEqual((await f.add(qty, unit)).status, 200);
  assert.equal(f.state.inserts.length, 0);
  f.state.user = null;
  assert.equal((await f.add(700)).status, 401);
  assert.equal(f.state.inserts.length, 0);
});
