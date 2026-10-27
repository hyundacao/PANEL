import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSqlTestDatabase, withoutUnavailableTestExtension } from '../../../scripts/sql-test-database.mjs';
import { sqlModuleFiles, readSqlModule } from '../../../scripts/sql-files.mjs';

test('security migration preserves data, atomic replacement rolls back, grants and throttling work', async () => {
  const db = await createSqlTestDatabase();
  try {
    for (const file of sqlModuleFiles) await db.exec(withoutUnavailableTestExtension(readSqlModule(file)));
    const sql = readFileSync(new URL('../../../supabase/10_zabezpieczenia.sql', import.meta.url), 'utf8');
    await db.exec(sql);
    await db.exec(sql);
    const input = [{ name: 'TEST A', real_qty: 4, available_qty: 3, unit: 'kg', index_code: 'TEST-A', warehouse_code: 'M-1' }];
    const invoke = rows => db.query('select * from public.replace_original_inventory_erp_snapshot($1,$2,$3,$4)', ['2026-10-27', JSON.stringify(rows), 'test', 'test.xlsx']);
    assert.deepEqual((await invoke(input)).rows, [{ inserted: 1, replaced: 0 }]);
    await assert.rejects(invoke([input[0], input[0]]));
    const old = await db.query('select name, real_qty, available_qty from public.original_inventory_erp_snapshots');
    assert.deepEqual(old.rows, [{ name: 'TEST A', real_qty: '4', available_qty: '3' }]);
    assert.deepEqual((await invoke([{ ...input[0], real_qty: 8 }])).rows, [{ inserted: 1, replaced: 1 }]);
    const grant = await db.query(`select has_function_privilege('anon', 'public.replace_original_inventory_erp_snapshot(date,jsonb,text,text)', 'EXECUTE') as anon,
      has_function_privilege('service_role', 'public.replace_original_inventory_erp_snapshot(date,jsonb,text,text)', 'EXECUTE') as service`);
    assert.deepEqual(grant.rows, [{ anon: false, service: true }]);
    const rate = () => db.query('select public.consume_security_rate_limit($1,2,900) as retry', ['a'.repeat(64)]);
    assert.equal((await rate()).rows[0].retry, 0);
    assert.equal((await rate()).rows[0].retry, 0);
    assert.ok((await rate()).rows[0].retry > 0);
    const user = await db.query(`insert into public.app_users(name,username,password_hash,active_session_id)
      values('Test','security-audit','synthetic-old',gen_random_uuid()) returning id`);
    await db.query('update public.app_users set password_hash=$1 where id=$2', ['synthetic-new', user.rows[0].id]);
    assert.equal((await db.query('select active_session_id from public.app_users where id=$1', [user.rows[0].id])).rows[0].active_session_id, null);
  } finally { await db.close(); }
});
