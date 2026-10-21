import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as domain from './grindingTargetSuggestions.ts';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../../app/api/original-inventory-grind-target-exclusions/route.ts', import.meta.url), 'utf8');

function fixture() {
  const state = { user: { name: 'Operator', username: 'operator', planning: true }, row: null, writes: [], conflicts: 0, loadError: false, saveError: false, emptyResult: false };
  const db = {
    from(table) {
      assert.equal(table, 'material_planning_state', 'no catalog, inventory or historical task may be changed');
      return { select() { return this; }, eq(column, id) {
        assert.equal(column, 'id'); assert.equal(id, 'original-inventory-grind-target-exclusions'); return this;
      }, async maybeSingle() { return { data: structuredClone(state.row), error: state.loadError ? new Error('load') : null }; } };
    },
    async rpc(name, args) {
      assert.equal(name, 'save_material_planning_state');
      assert.equal(args.p_module_id, 'original-inventory-grind-target-exclusions');
      if (state.saveError) return { error: new Error('save') };
      if (state.emptyResult) return { data: [] };
      if (state.conflicts-- > 0) {
        state.row = { revision: (state.row?.revision ?? 0) + 1, state: { items: [{ name: 'Another operator choice' }], keep: 'untouched' } };
        return { data: [{ has_conflict: true }] };
      }
      assert.equal(args.p_expected_revision, state.row?.revision ?? 0);
      state.writes.push(structuredClone(args));
      state.row = { state: structuredClone(args.p_state), revision: args.p_expected_revision + 1 };
      return { data: [{ has_conflict: false, new_revision: state.row.revision }] };
    }
  };
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module: mod, exports: mod.exports, require: (name) => {
      if (name === 'next/server') return { NextResponse: { json: (body, options = {}) => ({ status: options.status ?? 200, body }) } };
      if (name.endsWith('/auth/session')) return { getAuthenticatedUser: async () => ({ user: state.user }) };
      if (name.endsWith('/auth/access')) return {
        canSeeTab: (user, warehouse) => warehouse === 'PLANOWANIE_ZAPOTRZEBOWANIA' ? user.planning : user.inventory,
        isReadOnly: (user) => Boolean(user.readOnly)
      };
      if (name.endsWith('/supabase/admin')) return { supabaseAdmin: db };
      if (name.endsWith('/grindingTargetSuggestions')) return domain;
      throw new Error(name);
    }
  });
  return { state, get: () => mod.exports.GET({}), post: (body) => mod.exports.POST({ json: async () => body }) };
}

test('hiding and restoring are shared, durable and do not change history or catalog data', async () => {
  const f = fixture();
  assert.deepEqual((await f.get()).body.items, []);
  assert.equal((await f.post({ action: 'hide', name: 'Elix +grafika' })).status, 200);
  assert.equal((await f.post({ action: 'hide', name: 'pp' })).status, 200);
  assert.deepEqual((await f.get()).body.items.map((item) => item.name), ['Elix +grafika', 'pp']);
  assert.equal(f.state.writes[0].p_updated_by, 'operator');
  await f.post({ action: 'hide', name: ' PP ' });
  assert.equal((await f.get()).body.items.length, 2);
  await f.post({ action: 'restore', name: 'ELIX + GRAFIKA' });
  assert.deepEqual((await f.get()).body.items.map((item) => item.name), ['PP']);
});

test('concurrent removal retries against the new revision without losing another choice', async () => {
  const f = fixture();
  f.state.conflicts = 1;
  assert.equal((await f.post({ action: 'hide', name: 'pp' })).status, 200);
  assert.deepEqual((await f.get()).body.items.map((item) => item.name), ['Another operator choice', 'pp']);
  assert.equal(f.state.row.state.keep, 'untouched');
  f.state.conflicts = 5;
  assert.equal((await f.post({ action: 'hide', name: 'Not saved' })).status, 409);
});

test('anonymous, unrelated and read-only users cannot remove suggestions', async () => {
  const f = fixture();
  for (const [user, status] of [[null, 401], [{ planning: false, inventory: false }, 403], [{ planning: true, readOnly: true }, 403]]) {
    f.state.user = user;
    assert.equal((await f.post({ action: 'hide', name: 'pp' })).status, status);
  }
  assert.equal((await f.get()).status, 200, 'read-only can see the same shared list');
  assert.equal(f.state.writes.length, 0);
  f.state.user = { inventory: true, name: 'Legacy operator' };
  assert.equal((await f.post({ action: 'hide', name: 'pp' })).status, 200);
});

test('bad input and database failures never report a successful removal', async () => {
  const f = fixture();
  for (const body of [null, [], { action: 'delete', name: 'pp' }, { action: 'hide', name: {} }, { action: 'hide', name: '' }, { action: 'hide', name: 'x'.repeat(241) }]) {
    assert.equal((await f.post(body)).status, 400);
  }
  assert.equal(f.state.writes.length, 0);
  f.state.loadError = true;
  assert.equal((await f.get()).status, 500);
  f.state.loadError = false; f.state.saveError = true;
  assert.equal((await f.post({ action: 'hide', name: 'pp' })).status, 500);
  f.state.saveError = false; f.state.emptyResult = true;
  assert.equal((await f.post({ action: 'hide', name: 'pp' })).status, 500);
});
