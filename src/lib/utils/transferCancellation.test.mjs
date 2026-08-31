import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { expandTransferStatsRows, isActiveTransferForStats } from './transferCancellation.ts';
import { formatDate } from './format.ts';

const transfer = (kind, overrides = {}) => ({
  at: '2026-08-30T10:00:00.000Z', kind, material_id: 'pp', qty: 30,
  from_location_id: kind === 'EXTERNAL_IN' ? null : 'a',
  to_location_id: kind === 'EXTERNAL_OUT' ? null : 'b',
  ...overrides
});

for (const kind of ['INTERNAL', 'EXTERNAL_IN', 'EXTERNAL_OUT']) {
  test(`${kind}: cancellation neutralizes stock deltas without adding new production`, () => {
    const original = transfer(kind, { cancelled_at: '2026-08-30T12:00:00.000Z' });
    const before = structuredClone(original);
    const movements = expandTransferStatsRows([original]);
    const deltas = new Map();
    for (const movement of movements) {
      for (const [location, qty] of [[movement.from_location_id, -movement.qty], [movement.to_location_id, movement.qty]]) {
        if (location) deltas.set(location, (deltas.get(location) ?? 0) + qty);
      }
    }
    assert.equal(movements.length, 2);
    assert.equal(movements[1].kind, 'INTERNAL');
    assert.equal([...deltas.values()].every((qty) => qty === 0), true);
    assert.equal(movements.filter(isActiveTransferForStats).some((row) => row.kind.startsWith('EXTERNAL')), false);
    assert.deepEqual(original, before);
  });
}

test('cancellation in another month adjusts current stock without rewriting the original day', () => {
  const rows = expandTransferStatsRows([transfer('EXTERNAL_IN', { cancelled_at: '2026-08-31T22:30:00.000Z' })]);
  assert.equal(formatDate(new Date(rows[0].at)), '2026-08-30');
  assert.equal(formatDate(new Date(rows[1].at)), '2026-09-01');
  assert.equal(rows[1].from_location_id, 'b');
  assert.equal(rows[1].to_location_id, null);
  assert.equal(isActiveTransferForStats(rows[0]), false);
});

test('active transfers remain unchanged', () => {
  const original = transfer('EXTERNAL_OUT');
  assert.deepEqual(expandTransferStatsRows([original]), [original]);
  assert.equal(isActiveTransferForStats(original), true);
});

const migrationUrl = new URL('../../../supabase/migrate_regrind_transfer_cancellation.sql', import.meta.url);
test('full setup includes the same cancellation schema and functions', async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  const setup = await readFile(new URL('../../../supabase/setup_full.sql', import.meta.url), 'utf8');
  const body = migration.replace(/^begin;\s*/, '').replace(/notify pgrst, 'reload schema';\s*commit;\s*$/, '').trim();
  const embedded = setup.split('-- BEGIN REGRIND TRANSFER CANCELLATION')[1].split('-- END REGRIND TRANSFER CANCELLATION')[0].trim();
  assert.equal(embedded.replaceAll('\r\n', '\n'), body.replaceAll('\r\n', '\n'));
  assert.equal(/original_inventory|daily_entry_measurements/i.test(migration), false);
});

// Optional SQL integration tests use a disposable in-memory PostgreSQL instance.
test('SQL cancellation transaction', { skip: !process.env.PGLITE_MODULE_PATH }, async (t) => {
  const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE_PATH).href);
  const db = new PGlite();
  try {
    await db.exec(`
      create role service_role;
      create table materials (id text primary key);
      create table locations (id text primary key, warehouse_id text, is_active boolean default true);
      create table daily_entries (date_key date, location_id text, material_id text, qty numeric not null,
        confirmed boolean default false, comment text, updated_at timestamptz default now(),
        primary key (date_key, location_id, material_id));
      create table daily_location_status (date_key date, location_id text, primary key(date_key, location_id));
      create table transfers (id uuid primary key default gen_random_uuid(), at timestamptz not null default now(),
        kind text not null, material_id text not null, qty numeric not null,
        from_location_id text, to_location_id text, partner text, note text);
      insert into materials values ('pp');
      insert into locations values ('a', 'hall-1', true), ('b', 'hall-2', true);
    `);
    const migration = await readFile(migrationUrl, 'utf8');
    await db.exec(migration);
    await db.exec(migration);

    const reset = async () => {
      await db.exec(`truncate transfers, daily_entries, daily_location_status;
        insert into daily_entries(date_key, location_id, material_id, qty, confirmed, comment)
        values ((now() at time zone 'Europe/Warsaw')::date, 'a', 'pp', 100, true, 'existing'),
               ((now() at time zone 'Europe/Warsaw')::date, 'b', 'pp', 50, true, 'existing');`);
    };
    const stock = async () => (await db.query(`select location_id, qty::float8 as qty from daily_entries
      where date_key = (now() at time zone 'Europe/Warsaw')::date order by location_id`)).rows;
    const create = async (kind, qty = 30) => (await db.query(
      'select create_regrind_transfer($1, $2, $3, $4, $5, $6, $7) as movement',
      [kind, 'pp', qty, kind === 'EXTERNAL_IN' ? null : 'a', kind === 'EXTERNAL_OUT' ? null : 'b', null, null]
    )).rows[0].movement;
    const cancel = async (id) => (await db.query('select cancel_regrind_transfer($1, $2) as movement', [id, 'Tester'])).rows[0].movement;

    for (const kind of ['INTERNAL', 'EXTERNAL_IN', 'EXTERNAL_OUT']) {
      await t.test(`${kind}: restores both stocks and tolerates a repeated cancellation`, async () => {
        await reset();
        const before = await stock();
        const movement = await create(kind);
        assert.notDeepEqual(await stock(), before);
        const cancelled = await cancel(movement.id);
        assert.ok(cancelled.cancelled_at);
        assert.equal(cancelled.cancelled_by, 'Tester');
        assert.deepEqual(await stock(), before);
        await cancel(movement.id);
        assert.deepEqual(await stock(), before);
        assert.equal((await db.query('select count(*)::int as n from transfers')).rows[0].n, 1);
        assert.equal((await db.query("select count(*)::int as n from daily_entries where comment = 'existing' and confirmed")).rows[0].n, 2);
      });
    }

    await t.test('insufficient receiving stock rolls back cancellation of both warehouses', async () => {
      await reset();
      const movement = await create('INTERNAL', 30);
      await db.exec("update daily_entries set qty = 5 where location_id = 'b'");
      const before = await stock();
      await assert.rejects(cancel(movement.id), /INSUFFICIENT_STOCK/);
      assert.deepEqual(await stock(), before);
      assert.equal((await db.query('select cancelled_at from transfers where id = $1', [movement.id])).rows[0].cancelled_at, null);
    });

    await t.test('a later receipt is preserved when an earlier receipt is cancelled', async () => {
      await reset();
      const old = await create('EXTERNAL_IN', 30);
      await create('EXTERNAL_IN', 10);
      await cancel(old.id);
      assert.deepEqual(await stock(), [{ location_id: 'a', qty: 100 }, { location_id: 'b', qty: 60 }]);
    });

    await t.test('older movement is reversed today without rewriting historical counts', async () => {
      await reset();
      await db.exec(`delete from daily_entries;
        insert into daily_entries(date_key, location_id, material_id, qty, confirmed)
        values ((now() at time zone 'Europe/Warsaw')::date - 2, 'b', 'pp', 80, true);`);
      const old = (await db.query(`insert into transfers(at, kind, material_id, qty, to_location_id)
        values(now() - interval '2 days', 'EXTERNAL_IN', 'pp', 30, 'b') returning id`)).rows[0];
      await cancel(old.id);
      assert.deepEqual(await stock(), [{ location_id: 'b', qty: 50 }]);
      assert.equal((await db.query(`select qty::float8 as qty from daily_entries
        where date_key < (now() at time zone 'Europe/Warsaw')::date`)).rows[0].qty, 80);
    });

    await t.test('failed creation never leaves a half-written movement or changed stock', async () => {
      await reset();
      const before = await stock();
      await assert.rejects(create('INTERNAL', 101), /INSUFFICIENT_STOCK/);
      assert.deepEqual(await stock(), before);
      assert.equal((await db.query('select count(*)::int as n from transfers')).rows[0].n, 0);
      await assert.rejects(create('INVALID', 30), /INVALID_TRANSFER_KIND/);
    });

    await t.test('unknown movement and missing location leave stock unchanged', async () => {
      await reset();
      await assert.rejects(cancel('00000000-0000-0000-0000-000000000001'), /TRANSFER_NOT_FOUND/);
      const movement = await create('EXTERNAL_IN');
      const before = await stock();
      await db.query('update transfers set to_location_id = null where id = $1', [movement.id]);
      await assert.rejects(cancel(movement.id), /MISSING_LOCATION/);
      assert.deepEqual(await stock(), before);
    });

    await t.test('RPC functions are not executable by public users', async () => {
      await db.exec('create role anonymous_test');
      const result = await db.query(`select
        has_function_privilege('anonymous_test', 'public.cancel_regrind_transfer(uuid,text)', 'EXECUTE') as public_allowed,
        has_function_privilege('service_role', 'public.cancel_regrind_transfer(uuid,text)', 'EXECUTE') as service_allowed`);
      assert.deepEqual(result.rows[0], { public_allowed: false, service_allowed: true });
    });
  } finally {
    await db.close();
  }
});
