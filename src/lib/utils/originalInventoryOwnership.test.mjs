import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inventoryOwnership } from './originalInventoryOwnership.ts';

const identities = [{ id: 'alice', username: 'a.counter', name: 'Alicja' }, { id: 'bob', username: 'b.counter', name: 'Bartek' }];
const candidate = (role = 'USER', readOnly = false) => ({ ...identities[0], role, access: { warehouses: {
  PLANOWANIE_ZAPOTRZEBOWANIA: { readOnly, admin: role === 'ADMIN', tabs: ['planowanie-zapotrzebowania'] }
} } });
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date());
const entry = (extra = {}) => ({ id: 'entry', at: `${today}T12:00:00Z`, name: 'ABS', qty: 300, unit: 'kg', warehouse_id: 'hall-2', user_name: 'Alicja', ...extra });

test('only an unambiguous author owns a row, without an administrator override', () => {
  for (const role of ['USER', 'ADMIN', 'HEAD_ADMIN']) {
    const owner = inventoryOwnership(candidate(role), identities);
    for (const name of ['Alicja', 'a.counter', ' A.COUNTER ']) assert.equal(owner.owns({ user_name: name }), true);
    for (const name of ['Bartek', 'b.counter', '', 'nieznany', undefined, 'Alic']) assert.equal(owner.owns({ user_name: name }), false);
    assert.equal(owner.actor, 'a.counter');
  }
});

test('duplicate display names and login/name collisions fail closed, including inactive accounts', () => {
  const duplicates = [...identities, { id: 'inactive', username: 'old', name: 'Alicja', is_active: false }];
  assert.equal(inventoryOwnership(candidate(), duplicates).owns({ user_name: 'Alicja' }), false);
  assert.equal(inventoryOwnership(candidate(), duplicates).owns({ user_name: 'a.counter' }), true);
  assert.equal(inventoryOwnership(candidate(), [...duplicates, { id: 'other', name: 'a.counter' }]).owns({ user_name: 'a.counter' }), false);
  assert.equal(inventoryOwnership({ ...candidate(), id: '' }, identities).owns({ user_name: 'Alicja' }), false);
});

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
function fixture(user = candidate()) {
  const state = { user, writes: [], tables: {
    app_users: structuredClone(identities), original_inventory_entries: [entry()], original_inventory_silo_entries: [], audit_logs: [],
    original_inventory_silos: [{ id: 'silo', name: 'Silos', chamber: '1', material_name: 'ABS', warehouse_id: 'hall-2', percent_kg: 100, hopper_kg: 400 }],
    warehouses: [{ id: 'hall-2', name: 'Hala 2', is_active: true }],
    material_planning_state: [{ id: 'main', state: { fixedDevices: [{ id: 'dryer', name: 'Suszarka', materialName: 'ABS', areaId: 'hala-2', active: true, fullQty: 400, type: 'dryer' }] } }]
  } };
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.mode = 'select'; }
    select() { return this; }
    order() { return this; }
    range() { return this; }
    limit() { return this; }
    eq(key, value) { this.filters.push(row => row[key] === value); return this; }
    in(key, values) { this.filters.push(row => values.includes(row[key])); return this; }
    like(key, value) { this.filters.push(row => row[key]?.startsWith(value.slice(0, -1))); return this; }
    gte(key, value) { this.filters.push(row => row[key] >= value); return this; }
    lt(key, value) { this.filters.push(row => row[key] < value); return this; }
    insert(rows) { this.mode = 'insert'; this.value = structuredClone(Array.isArray(rows) ? rows : [rows]); return this; }
    update(value) { this.mode = 'update'; this.value = structuredClone(value); return this; }
    upsert() { throw new Error('Inventory must not bypass ownership through UPSERT'); }
    delete() { this.mode = 'delete'; return this; }
    maybeSingle() { return this.run(true); }
    then(a, b) { return this.run().then(a, b); }
    async run(single = false) {
      const table = state.tables[this.table];
      assert.ok(table, this.table);
      let rows = table.filter(row => this.filters.every(filter => filter(row)));
      if (this.mode === 'insert') {
        for (const row of this.value) {
          if (table.some(old => (row.id && old.id === row.id) || (this.table === 'original_inventory_silo_entries' && old.config_id === row.config_id && old.date_key === row.date_key)
            || (this.table === 'original_inventory_entries' && row.source_id && old.source_id === row.source_id && old.source_type === row.source_type))) return { data: null, error: { code: '23505' } };
        }
        table.push(...this.value); rows = this.value;
      } else if (this.mode === 'update') rows.forEach(row => Object.assign(row, this.value));
      else if (this.mode === 'delete') state.tables[this.table] = table.filter(row => !rows.includes(row));
      if (this.mode !== 'select' && rows.length && this.table !== 'audit_logs') state.writes.push({ table: this.table, mode: this.mode, rows: structuredClone(rows) });
      return { data: structuredClone(single ? rows[0] ?? null : rows), error: null, count: rows.length };
    }
  }
  const mocks = {
    '@/lib/auth/session': { getAuthenticatedUser: async () => ({ user: state.user, code: state.user ? null : 'UNAUTHORIZED' }), clearSessionCookie() {} },
    '@/lib/supabase/admin': { supabaseAdmin: { from: table => new Query(table) } },
    '@/lib/push/server': {}
  };
  const cache = new Map();
  function load(file) {
    const path = [file, `${file}.ts`, join(file, 'index.ts')].find(existsSync);
    assert.ok(path, file);
    if (cache.has(path)) return cache.get(path).exports;
    const mod = new Module(path); cache.set(path, mod);
    mod.require = id => Object.hasOwn(mocks, id) ? mocks[id] : id.startsWith('@/') ? load(join(root, id.slice(2))) : id.startsWith('.') ? load(resolve(dirname(path), id)) : require(id);
    mod._compile(ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, path);
    return mod.exports;
  }
  const route = load(join(root, 'app/api/app/route.ts'));
  return { state, post: (action, payload = {}) => route.POST(new Request('http://test/api/app', { method: 'POST', body: JSON.stringify({ action, payload }) })) };
}

for (const role of ['USER', 'ADMIN', 'HEAD_ADMIN']) {
  test(`${role}: own manual entry is editable/removable; somebody else's is forbidden without any write`, async () => {
    const { state, post } = fixture(candidate(role));
    const edited = await post('updateOriginalInventory', { id: 'entry', qty: 280, warehouseId: 'hall-2' });
    assert.equal(edited.status, 200);
    assert.equal((await edited.json()).canModify, true);
    assert.equal(state.tables.original_inventory_entries[0].user_name, 'Alicja');
    assert.equal((await post('removeOriginalInventory', 'entry')).status, 200);
    state.tables.original_inventory_entries = [entry({ user_name: 'Bartek' })]; state.writes = [];
    for (const action of ['updateOriginalInventory', 'removeOriginalInventory']) {
      const response = await post(action, { id: 'entry', entryId: 'entry', qty: 1, warehouseId: 'hall-2', user: 'Alicja', user_name: 'Alicja', canModify: true });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).code, 'INVENTORY_NOT_OWNER');
    }
    assert.equal(state.writes.length, 0);
    assert.equal(state.tables.original_inventory_entries[0].qty, 300);
  });

  test(`${role}: another person's fixed device cannot be overwritten, zeroed or unconfirmed`, async () => {
    const { state, post } = fixture(candidate(role));
    state.tables.original_inventory_entries = [entry({ source_type: 'FIXED_DEVICE', source_id: `fixed-device:dryer:${today}`, user_name: 'Bartek' })];
    for (const qty of [0, 280, 400]) assert.equal((await post('saveOriginalInventoryFixedDeviceEntry', { deviceId: 'dryer', dateKey: today, qty })).status, 403);
    assert.equal((await post('removeOriginalInventory', 'entry')).status, 403);
    assert.equal(state.writes.length, 0);
  });

  test(`${role}: another person's silo reading cannot be zeroed or taken over`, async () => {
    const { state, post } = fixture(candidate(role));
    state.tables.original_inventory_entries = [entry({ source_type: 'SILO', source_id: `silo:silo:${today}`, user_name: 'Bartek' })];
    state.tables.original_inventory_silo_entries = [{ id: 'reading', config_id: 'silo', date_key: today, percent: 3, calculated_qty: 300, generated_entry_id: 'entry', user_name: 'Bartek' }];
    for (const percent of [0, 20]) assert.equal((await post('saveOriginalInventorySiloEntry', { configId: 'silo', dateKey: today, percent, hopperPresent: false })).status, 403);
    assert.equal(state.writes.length, 0);
  });
}

test('server ignores forged author on create and returns per-entry ownership for the UI', async () => {
  const { state, post } = fixture();
  const added = await post('addOriginalInventory', { name: 'PP', warehouseId: 'hall-2', qty: 10, user: 'Bartek', user_name: 'Bartek' });
  assert.equal(added.status, 200);
  const row = await added.json();
  assert.equal(row.user, 'a.counter'); assert.equal(row.canModify, true);
  state.tables.original_inventory_entries.push(entry({ id: 'other', user_name: 'Bartek' }));
  const rows = await (await post('getOriginalInventory', { dateKey: today })).json();
  assert.equal(rows.find(row => row.id === 'other').canModify, false);
  assert.equal(rows.find(row => row.id === 'entry').canModify, true);
});

test('owner can count, correct and clear their own device and silo without changing the author', async () => {
  const { state, post } = fixture(); state.tables.original_inventory_entries = [];
  for (const qty of [400, 280]) {
    const response = await post('saveOriginalInventoryFixedDeviceEntry', { deviceId: 'dryer', dateKey: today, qty });
    assert.equal(response.status, 200); assert.equal((await response.json()).canModify, true);
  }
  for (const percent of [10, 20, 0]) {
    const response = await post('saveOriginalInventorySiloEntry', { configId: 'silo', dateKey: today, percent, hopperPresent: false });
    assert.equal(response.status, 200); assert.equal((await response.json()).canModify, true);
  }
  assert.equal(state.tables.original_inventory_entries.length, 1);
  assert.equal(state.tables.original_inventory_entries[0].qty, 280);
  assert.equal(state.tables.original_inventory_silo_entries[0].user_name, 'a.counter');
});

test('a silo without a generated quantity still belongs to its original counter', async () => {
  const { state, post } = fixture(); state.tables.original_inventory_entries = [];
  state.tables.original_inventory_silo_entries = [{ id: 'reading', config_id: 'silo', date_key: today, percent: 0, calculated_qty: 0, user_name: 'Bartek' }];
  assert.equal((await post('saveOriginalInventorySiloEntry', { configId: 'silo', dateKey: today, percent: 20 })).status, 403);
  assert.equal(state.writes.length, 0);
});

for (const mode of ['device', 'silo']) {
  test(`two counters racing to count an empty ${mode} cannot take over the winning entry`, async () => {
    const { state, post } = fixture(); state.tables.original_inventory_entries = [];
    const action = mode === 'device' ? 'saveOriginalInventoryFixedDeviceEntry' : 'saveOriginalInventorySiloEntry';
    const payload = mode === 'device' ? { deviceId: 'dryer', dateKey: today, qty: 400 } : { configId: 'silo', dateKey: today, percent: 10 };
    const first = post(action, payload);
    state.user = { ...candidate(), ...identities[1] };
    const second = post(action, payload);
    const responses = await Promise.all([first, second]);
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 403]);
    assert.equal(state.tables.original_inventory_entries.length, 1);
    if (mode === 'silo') assert.equal(state.tables.original_inventory_entries[0].user_name, state.tables.original_inventory_silo_entries[0].user_name);
  });
}

test('read-only users cannot change even their own entry; missing and ambiguous authors stay protected', async () => {
  const { state, post } = fixture(candidate('USER', true));
  assert.equal((await post('removeOriginalInventory', 'entry')).status, 403);
  state.user = candidate();
  for (const user_name of ['', 'nieznany', 'Old missing account']) {
    state.tables.original_inventory_entries = [entry({ user_name })];
    assert.equal((await post('removeOriginalInventory', 'entry')).status, 403);
  }
  state.tables.app_users.push({ id: 'other', username: 'c.counter', name: 'Alicja' });
  state.tables.original_inventory_entries = [entry()];
  assert.equal((await post('removeOriginalInventory', 'entry')).status, 403);
  assert.equal(state.writes.length, 0);
});

test('UI gates manual, pallet, silo and device actions using server-issued ownership, not matching visible names', () => {
  const source = readFileSync(join(root, 'components/planowanie-zapotrzebowania/SpisRzeczywisty.tsx'), 'utf8');
  assert.match(source, /const canModifyEntry = !readOnly && entry\.canModify === true/);
  assert.match(source, /!canModifyEntry \? <span[^\n]*Tylko autor/);
  assert.match(source, /readOnly=\{readOnly \|\| entries\.filter[^\n]*canModify !== true/);
  assert.match(source, /disabled=\{deviceReadOnly \|\| isSaving\}/);
  assert.match(source, /disabled=\{siloReadOnly \|\| saveSiloMutation\.isPending\}/);
});
