import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const cache = new Map();
const load = (path) => {
  const file = /\.ts$/.test(path) ? path : `${path}.ts`;
  if (cache.has(file)) return cache.get(file).exports;
  const mod = new Module(file);
  cache.set(file, mod);
  mod.require = (name) => name.startsWith('@/') ? load(resolve(root, name.slice(2)))
    : name.startsWith('.') ? load(resolve(dirname(file), name)) : require(name);
  mod._compile(ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, file);
  return mod.exports;
};
const { buildPaintTapeInventoryComparison: build, originalErpRetentionCutoff: cutoff } =
  load(resolve(root, 'lib/utils/paintTapeInventoryArchive.ts'));
const { archivePaintTapeInventorySession, purgeOriginalErpHistory } =
  load(resolve(root, 'lib/utils/paintTapeInventoryArchiveServer.ts'));
const itemId = '00000000-0000-0000-0000-000000000001';
const sessionId = '00000000-0000-0000-0000-000000000002';
const entryId = '00000000-0000-0000-0000-000000000003';
const item = {
  id: itemId, name: 'FOLIA EXTERIOR GLC73725_05 - 20MMX305M', itemIndex: '10060',
  itemCode: '10060', category: 'FOLIE', unit: 'ro', sortOrder: 0, isActive: true,
  createdAt: '2026-09-24T06:00:00Z', createdBy: 'test'
};
const entry = { id: entryId, sessionId, catalogItemId: itemId, qty: 17.2, checkedBy: 'test' };
const snapshot = {
  id: 'erp', snapshotDate: '2026-09-24', name: 'FOLIA EXTERIOR GLC73725_05-20MMX305M',
  indexCode: 'M-51-FO-PCP-10060', unit: 'ro', realQty: 28.549, availableQty: 25
};

test('retention cutoff is exactly 90 calendar days, including year and leap-year boundaries', () => {
  assert.equal(cutoff('2026-10-14'), '2026-07-16');
  assert.equal(cutoff('2026-01-01'), '2025-10-03');
  assert.equal(cutoff('2024-05-29'), '2024-02-29');
});

test('archive contains only inventory catalog items, with frozen names, physical totals and ERP', () => {
  const foreign = { ...snapshot, name: 'UNRELATED RESIN', indexCode: 'OTHER', realQty: 999 };
  const second = { ...entry, id: 'second', qty: 2 };
  const result = build('2026-09-24', [item], [entry, second], [snapshot, foreign]);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].physicalQty, 19.2);
  assert.deepEqual(result.rows[0].erp, { unit: 'ro', realQty: 28.549, availableQty: 25 });
  assert.notEqual(result.rows[0].item, item);
  assert.notEqual(result.rows[0].erp, snapshot);
  item.name = 'TEMPORARY NEW NAME';
  assert.notEqual(result.rows[0].item.name, item.name);
  item.name = 'FOLIA EXTERIOR GLC73725_05 - 20MMX305M';
});

test('missing ERP stays missing, recorded zero is not confused with an uncounted material', () => {
  const result = build('2026-09-24', [item, { ...item, id: 'uncounted', itemIndex: 'OTHER' }],
    [{ ...entry, qty: 0 }], []);
  assert.equal(result.rows[0].physicalQty, 0);
  assert.equal(result.rows[0].erp, null);
  assert.equal(result.rows[1].physicalQty, null);
});

test('reclosing after retention preserves archived ERP, but uses newly edited physical quantity', () => {
  const archive = build('2026-09-24', [item], [entry], [snapshot]);
  const result = build('2026-09-24', [item], [{ ...entry, qty: 20 }], [], archive);
  assert.equal(result.rows[0].physicalQty, 20);
  assert.deepEqual(result.rows[0].erp, archive.rows[0].erp);
  const refreshed = build('2026-09-24', [item], [entry], [{ ...snapshot, realQty: 30 }], archive);
  assert.equal(refreshed.rows[0].erp.realQty, 30);
});

test('inactive materials with measurements are archived, unrelated inactive ones are omitted', () => {
  const result = build('2026-09-24', [
    { ...item, isActive: false }, { ...item, id: 'unused', isActive: false }
  ], [entry], [snapshot]);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].physicalQty, 17.2);
});

test('server never runs deletion if the archive migration is missing', async () => {
  for (const error of [
    { code: '42703', message: 'erp_comparison is missing' },
    { code: 'PGRST202', message: 'function is missing' }
  ]) {
    let deleted = false;
    const query = { then(resolve) { resolve({ data: null, error }); } };
    for (const method of ['select', 'eq', 'is', 'order', 'limit']) query[method] = () => query;
    const db = { from: () => query, rpc() { deleted = true; } };
    await assert.rejects(purgeOriginalErpHistory(db, '2026-10-14', {}), /MIGRATION_REQUIRED/);
    assert.equal(deleted, false);
  }
});

test('failed backfill stops retention before any ERP deletion', async () => {
  let deleted = false;
  const db = {
    from(table) {
      let single = false;
      const query = {
        then(done) { done({ error: null, data: table === 'paint_tape_inventory_sessions'
          ? single ? { id: sessionId, status: 'CLOSED', erp_comparison: null } : [{ inventory_date: '2026-09-24' }]
          : table === 'paint_tape_inventory_catalog' ? [item]
          : [{ id: entryId, qty: entry.qty }] }); }
      };
      for (const method of ['select', 'eq', 'is', 'order', 'limit']) query[method] = () => query;
      query.maybeSingle = () => { single = true; return query; };
      return query;
    },
    rpc() { deleted = true; }
  };
  await assert.rejects(purgeOriginalErpHistory(db, '2026-10-14', {
    catalog: (row) => row, entry: (row) => ({ ...entry, qty: row.qty }),
    snapshots: async () => { throw new Error('ERP_UNAVAILABLE'); }
  }), /ERP_UNAVAILABLE/);
  assert.equal(deleted, false);
});

test('server retries closing after a concurrent measurement change and captures the fresh quantity', async () => {
  let qty = 17.2;
  let calls = 0;
  const state = { id: sessionId, status: 'OPEN', inventory_date: '2026-09-24', erp_comparison: null };
  const db = {
    from(table) {
      const query = {
        then(done) { done({ error: null, data: table === 'paint_tape_inventory_sessions' ? state
          : table === 'paint_tape_inventory_catalog' ? [item]
          : [{ id: entryId, catalog_item_id: itemId, qty }] }); }
      };
      for (const method of ['select', 'eq', 'order', 'maybeSingle']) query[method] = () => query;
      return query;
    },
    async rpc(name, args) {
      assert.equal(name, 'archive_paint_tape_inventory_session');
      calls++;
      if (calls === 1) { qty = 20; return { error: { message: 'INVENTORY_ARCHIVE_CONFLICT' }, data: null }; }
      assert.equal(args.p_expected_entries[0].qty, 20);
      return { error: null, data: { ...state, status: 'CLOSED', erp_comparison: args.p_comparison } };
    }
  };
  const result = await archivePaintTapeInventorySession(db, '2026-09-24', 'operator', {
    catalog: (row) => row,
    entry: (row) => ({ ...entry, qty: row.qty }),
    snapshots: async () => [snapshot]
  }, true);
  assert.equal(calls, 2);
  assert.equal(result.erp_comparison.rows[0].physicalQty, 20);
});

test('SQL archive and retention are transactional, guarded and idempotent', async (t) => {
  const { PGlite } = await import(process.env.PGLITE_MODULE_PATH
    ? pathToFileURL(process.env.PGLITE_MODULE_PATH).href : '@electric-sql/pglite');
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table original_inventory_erp_snapshots (
        id uuid primary key default gen_random_uuid(), snapshot_date date not null,
        name text, index_code text, real_qty numeric, available_qty numeric, unit text);
    `);
    await db.exec(readFileSync(resolve(root, '../supabase/migrate_paint_tape_settlements.sql'), 'utf8'));
    await db.exec(readFileSync(resolve(root, '../supabase/migrate_paint_tape_inventory.sql'), 'utf8'));
    const migration = readFileSync(resolve(root, '../supabase/migrate_paint_tape_inventory_archive.sql'), 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    const dates = (await db.query(`select
      ((now() at time zone 'Europe/Warsaw')::date - 365)::text old,
      ((now() at time zone 'Europe/Warsaw')::date - 90)::text boundary,
      ((now() at time zone 'Europe/Warsaw')::date - 89)::text recent,
      (now() at time zone 'Europe/Warsaw')::date::text today`)).rows[0];
    const reset = async () => {
      await db.exec('truncate paint_tape_inventory_sessions, paint_tape_inventory_entries, paint_tape_inventory_catalog, original_inventory_erp_snapshots, paint_tape_settlements cascade');
      await db.query(`insert into paint_tape_inventory_catalog(id, item_index, name, unit)
        values($1, '10060', $2, 'ro')`, [itemId, item.name]);
      await db.query(`insert into paint_tape_inventory_sessions(id, inventory_date, created_by)
        values($1, $2, 'test')`, [sessionId, dates.old]);
      await db.query(`insert into paint_tape_inventory_entries(id, session_id, catalog_item_id, qty)
        values($1, $2, $3, 17.2)`, [entryId, sessionId, itemId]);
      for (const date of [dates.old, dates.boundary, dates.recent]) {
        await db.query(`insert into original_inventory_erp_snapshots(snapshot_date, name, real_qty, unit)
          values($1, $2, 28.549, 'ro')`, [date, snapshot.name]);
      }
    };
    const expected = [{ id: entryId, catalog_item_id: itemId, qty: 17.2 }];
    const comparison = () => build(dates.old, [item], [entry], [snapshot]);
    const archive = async (data = comparison(), expectedEntries = expected, close = true) =>
      (await db.query('select archive_paint_tape_inventory_session($1,$2,$3,$4,$5) result',
        [sessionId, JSON.stringify(data), JSON.stringify(expectedEntries), 'operator', close])).rows[0].result;
    const purge = async (date = dates.today) =>
      (await db.query('select purge_original_inventory_erp_snapshots($1)::int removed', [date])).rows[0].removed;

    await t.test('year-old ERP can be removed only after capture; history keeps original comparison', async () => {
      await reset();
      assert.equal(await purge(), 0);
      const result = await archive();
      assert.equal(result.status, 'CLOSED');
      assert.equal(result.completed_by, 'operator');
      assert.equal(await purge(), 1);
      const saved = (await db.query('select erp_comparison from paint_tape_inventory_sessions')).rows[0].erp_comparison;
      assert.equal(saved.rows[0].physicalQty, 17.2);
      assert.equal(saved.rows[0].erp.realQty, 28.549);
      assert.equal((await db.query('select count(*)::int n from original_inventory_erp_snapshots')).rows[0].n, 2);
      assert.equal((await db.query('select count(*)::int n from paint_tape_inventory_entries')).rows[0].n, 1);
    });
    await t.test('concurrent quantity change rejects a stale archive without closing the count', async () => {
      await reset();
      await db.exec('update paint_tape_inventory_entries set qty = 20');
      await assert.rejects(archive(), /INVENTORY_ARCHIVE_CONFLICT/);
      const result = (await db.query('select status, erp_comparison from paint_tape_inventory_sessions')).rows[0];
      assert.equal(result.status, 'OPEN');
      assert.equal(result.erp_comparison, null);
    });
    await t.test('archive validates physical totals and inventory date', async () => {
      await reset();
      const bad = comparison(); bad.rows[0].physicalQty = 0;
      await assert.rejects(archive(bad), /INVENTORY_ARCHIVE_INVALID/);
      await assert.rejects(archive({ ...comparison(), inventoryDate: dates.today }), /INVENTORY_ARCHIVE_INVALID/);
      assert.equal(await purge(), 0);
    });
    await t.test('legacy closed counts are protected; backfill preserves who and when closed them', async () => {
      await reset();
      await db.exec(`update paint_tape_inventory_sessions set status = 'CLOSED',
        completed_by = 'original-operator', completed_at = '2026-01-01T06:00:00Z'`);
      assert.equal(await purge(), 0);
      await assert.rejects(db.query('delete from original_inventory_erp_snapshots where snapshot_date = $1', [dates.old]), /ERP_SNAPSHOT_ARCHIVE_REQUIRED/);
      const result = await archive(comparison(), expected, false);
      assert.equal(result.completed_by, 'original-operator');
      assert.equal(new Date(result.completed_at).toISOString(), '2026-01-01T06:00:00.000Z');
      assert.equal(await purge(), 1);
    });
    await t.test('closed measurements cannot be changed; reopening permits edits and recapture', async () => {
      await reset();
      await archive();
      await assert.rejects(db.exec('update paint_tape_inventory_entries set qty=25'), /INVENTORY_SESSION_CLOSED/);
      await assert.rejects(db.exec('delete from paint_tape_inventory_entries'), /INVENTORY_SESSION_CLOSED/);
      await db.exec("update paint_tape_inventory_sessions set status='OPEN', completed_at=null, completed_by=null");
      await db.exec('update paint_tape_inventory_entries set qty=25');
      const revised = build(dates.old, [item], [{ ...entry, qty: 25 }], [], comparison());
      const result = await archive(revised, [{ ...expected[0], qty: 25 }]);
      assert.equal(result.erp_comparison.rows[0].physicalQty, 25);
      assert.equal(result.erp_comparison.rows[0].erp.realQty, 28.549);
    });
    await t.test('repeated close never overwrites a frozen ERP even after a reimport', async () => {
      await reset();
      const first = await archive();
      const changed = comparison(); changed.rows[0].erp.realQty = 999;
      const second = await archive(changed);
      assert.deepEqual(second.erp_comparison, first.erp_comparison);
    });
    await t.test('cleanup is bounded and cannot be tricked into deleting newer than 90 days', async () => {
      await reset();
      for (let i = 1; i <= 6; i++) await db.query(`insert into original_inventory_erp_snapshots(snapshot_date)
        values($1::date - $2::int)`, [dates.old, i]);
      assert.equal(await purge('2999-01-01'), 5);
      assert.equal(await purge('2999-01-01'), 1);
      assert.equal(await purge('2999-01-01'), 0);
      assert.equal((await db.query('select count(*)::int n from original_inventory_erp_snapshots')).rows[0].n, 3);
    });
    await t.test('explicit deletion of a whole count still cascades correctly', async () => {
      await reset(); await archive();
      await db.exec('delete from paint_tape_inventory_sessions');
      assert.equal((await db.query('select count(*)::int n from paint_tape_inventory_entries')).rows[0].n, 0);
    });
    await t.test('only backend service role can archive or purge', async () => {
      const result = (await db.query(`select
        has_function_privilege('authenticated', 'purge_original_inventory_erp_snapshots(date)', 'EXECUTE') client,
        has_function_privilege('anon', 'archive_paint_tape_inventory_session(uuid,jsonb,jsonb,text,boolean)', 'EXECUTE') anonymous,
        has_function_privilege('service_role', 'purge_original_inventory_erp_snapshots(date)', 'EXECUTE') server`)).rows[0];
      assert.deepEqual(result, { client: false, anonymous: false, server: true });
    });
    await t.test('completed settlements keep their ERP on completion after full stock deletion', async () => {
      await reset(); await archive();
      const result = await db.query(`insert into paint_tape_settlements(detail_name, item_name, production_completed_at)
        values('PART', $1, $2::date + interval '12 hours') returning erp_archive`, [snapshot.name, dates.old]);
      assert.equal(result.rows[0].erp_archive.entry.real_qty, 28.549);
      assert.equal(await purge(), 1);
      await db.exec("update paint_tape_settlements set order_note='Later note'");
      const saved = (await db.query('select erp_archive from paint_tape_settlements')).rows[0].erp_archive;
      assert.equal(saved.entry.real_qty, 28.549);
      assert.equal(saved.date, dates.old);
    });
    await t.test('legacy settlements are captured before deletion, not after their source rows disappear', async () => {
      await reset(); await archive();
      await db.exec('alter table paint_tape_settlements disable trigger paint_tape_settlement_erp_guard');
      await db.query(`insert into paint_tape_settlements(detail_name, item_name, production_completed_at)
        values('PART', $1, $2::date + interval '12 hours')`, [snapshot.name, dates.old]);
      await db.exec('alter table paint_tape_settlements enable trigger paint_tape_settlement_erp_guard');
      assert.equal(await purge(), 1);
      const saved = (await db.query('select erp_archive from paint_tape_settlements')).rows[0].erp_archive;
      assert.equal(saved.entry.real_qty, 28.549);
    });
    await t.test('settlement matching prioritizes the material index over a conflicting name', async () => {
      await reset();
      await db.query(`insert into original_inventory_erp_snapshots(snapshot_date, name, index_code, real_qty, unit)
        values($1, 'OTHER NAME', 'M-51-FO-PCP-10060', 70, 'ro')`, [dates.old]);
      const result = await db.query(`insert into paint_tape_settlements(detail_name, item_name, item_index_code, production_completed_at)
        values('PART', $1, 'M-51-FO-PCP-10060', $2::date + interval '12 hours') returning erp_archive`, [snapshot.name, dates.old]);
      assert.equal(result.rows[0].erp_archive.entry.real_qty, 70);
      await db.exec('update paint_tape_settlements set production_completed_at = null');
      assert.equal((await db.query('select erp_archive from paint_tape_settlements')).rows[0].erp_archive, null);
    });
  } finally { await db.close(); }
});

test('full setup embeds the same archive migration', () => {
  const migration = readFileSync(resolve(root, '../supabase/migrate_paint_tape_inventory_archive.sql'), 'utf8');
  const setup = readFileSync(resolve(root, '../supabase/setup_full.sql'), 'utf8');
  const body = migration.trim().replace(/^begin;\s*/, '').replace(/notify pgrst, 'reload schema';\s*commit;$/, '').trim();
  const embedded = setup.split('-- BEGIN PAINT TAPE INVENTORY ARCHIVE')[1].split('-- END PAINT TAPE INVENTORY ARCHIVE')[0].trim();
  assert.equal(embedded.replaceAll('\r\n', '\n'), body.replaceAll('\r\n', '\n'));
});
