import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readSqlModule, sqlModuleFiles } from '../../../scripts/sql-files.mjs';
import { createSqlTestDatabase, loadSuppliedDatabase, withoutUnavailableTestExtension } from '../../../scripts/sql-test-database.mjs';

const live = JSON.parse(readFileSync(new URL('./fixtures/supabase-schema-2026-10-18.json', import.meta.url), 'utf8'));
const runModules = async (db) => {
  for (const name of sqlModuleFiles) {
    await db.exec(withoutUnavailableTestExtension(readSqlModule(name)));
  }
};
const columns = async (db) => (await db.query(`select table_name, column_name, is_nullable,
  case when data_type='ARRAY' then substring(udt_name from 2)||'[]' else data_type end type
  from information_schema.columns where table_schema='public' order by table_name,column_name`)).rows;
const functions = async (db) => (await db.query(`select proname, oidvectortypes(proargtypes) args,
  pg_get_functiondef(oid) definition, proacl::text acl from pg_proc
  where pronamespace='public'::regnamespace order by proname,args`)).rows;
const security = async (db) => (await db.query(`select c.relname, c.relrowsecurity, c.relforcerowsecurity,
  c.relacl::text acl, (select jsonb_agg(to_jsonb(p) - 'oid' - 'polrelid' order by p.polname)
    from pg_policy p where p.polrelid=c.oid) policies
  from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' order by c.relname`)).rows;
const data = async (db) => {
  const tables = (await db.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows;
  const result = {};
  for (const { tablename } of tables) {
    const omit = tablename === 'paint_tape_inventory_sessions' ? " - 'erp_comparison'"
      : tablename === 'paint_tape_settlements' ? " - 'erp_archive'" : '';
    result[tablename] = (await db.query(`select to_jsonb(t)${omit} value from public."${tablename}" t order by (to_jsonb(t)${omit})::text`)).rows;
  }
  return result;
};

test('supplied SQL reproduces every column and RPC signature observed in the live database', async () => {
  const db = await createSqlTestDatabase();
  try {
    await loadSuppliedDatabase(db);
    const actual = await columns(db);
    const expected = Object.entries(live.tables).flatMap(([table_name, cols]) =>
      Object.entries(cols).map(([column_name, c]) => ({ table_name, column_name, is_nullable: c.nullable ? 'YES' : 'NO', type: c.type })));
    const sort = (rows) => rows.toSorted((a,b) => `${a.table_name}.${a.column_name}`.localeCompare(`${b.table_name}.${b.column_name}`));
    assert.deepEqual(sort(actual), sort(expected));
    const procs = (await db.query(`select proname, proargnames, oidvectortypes(proargtypes) args
      from pg_proc where pronamespace='public'::regnamespace`)).rows;
    assert.equal(procs.length, live.functions.length);
    for (const f of live.functions) {
      const proc = procs.find(p => p.proname === f.name);
      assert.ok(proc, f.name);
      for (const [name, arg] of Object.entries(f.arguments)) {
        const index = proc.proargnames.indexOf(name);
        assert.ok(index >= 0, `${f.name}.${name}`);
        assert.equal(proc.args.split(', ')[index], arg.format);
      }
    }
  } finally { await db.close(); }
});

test('complete modules run twice on a new schema, with no example users, groups or warehouse data', async () => {
  const db = await createSqlTestDatabase();
  try {
    await runModules(db);
    const schemaBefore = await columns(db);
    const securityBefore = await security(db);
    const functionsBefore = await functions(db);
    await runModules(db);
    assert.deepEqual(await columns(db), schemaBefore);
    assert.deepEqual(await security(db), securityBefore);
    assert.deepEqual(await functions(db), functionsBefore);
    for (const rows of Object.values(await data(db))) assert.equal(rows.length, 0);
    assert.equal(securityBefore.every(row => row.relrowsecurity), true);
    const { rows } = await db.query(`select
      has_function_privilege('anon', 'public.purge_original_inventory_erp_snapshots(date)', 'EXECUTE') anon,
      has_function_privilege('authenticated', 'public.archive_paint_tape_inventory_session(uuid,jsonb,jsonb,text,boolean)', 'EXECUTE') authenticated,
      has_function_privilege('service_role', 'public.archive_paint_tape_inventory_session(uuid,jsonb,jsonb,text,boolean)', 'EXECUTE') service`);
    assert.deepEqual(rows[0], { anon: false, authenticated: false, service: true });
  } finally { await db.close(); }
});

test('rerunning all modules preserves populated data, existing function bodies, RLS, grants, constraints and indexes', async () => {
  const db = await createSqlTestDatabase();
  try {
    await loadSuppliedDatabase(db);
    await db.exec(`
      insert into halls(name,order_no) values ('Legacy hall',99);
      alter table halls enable row level security;
      create policy custom_hall_policy on halls for select to authenticated using (is_active);
      grant select on halls to authenticated;
      update warehouses set name='Custom warehouse', order_no=77, include_in_spis=false,
        include_in_stats=true, is_active=false where id in ('bakoma','lakiernia');
      insert into warehouses(id,name) values ('test-warehouse','Sentinel warehouse');
      insert into locations(id,warehouse_id,name,order_no,type) values ('test-location','test-warehouse','Legacy WTR',99,'wtr');
      insert into materials(id,code,name) values ('test-material','code','Sentinel material');
      insert into daily_entries values ('2026-09-24','test-location','test-material',123.45,true,'Do not recalculate',now());
      insert into daily_entry_measurements(date_key,location_id,material_id,qty,created_by)
        values ('2026-09-24','test-location','test-material',11,'Tester');
      insert into daily_location_status(date_key,location_id) values ('2026-09-24','test-location');
      insert into mixed_materials(name,qty,location_id) values ('Mixture',19,'test-location');
      insert into inventory_adjustments(location_id,material_id,prev_qty,next_qty,note)
        values ('test-location','test-material',100,123.45,'History');
      insert into transfers(kind,material_id,qty,from_location_id,partner,cancelled_at,cancelled_by)
        values ('EXTERNAL_OUT','test-material',5,'test-location','Partner',now(),'Tester');
      insert into audit_logs(user_name,action,warehouse) values ('Tester','EXISTING','test-warehouse');
      insert into app_users(id,name,username,password_hash,role,access,active_session_id)
        values ('00000000-0000-0000-0000-000000000001','Tester','test','not-a-real-password','HEAD_ADMIN',
          '{"admin":true,"custom":"do not overwrite"}',gen_random_uuid());
      insert into permission_groups(id,name,access) values
        ('00000000-0000-0000-0000-000000000002','Custom group','{"custom":true}');
      insert into user_permission_groups(user_id,group_id) values
        ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002');
      insert into material_planning_state(id,state,updated_by,revision)
        values ('module','{"selectedPlanDate":"2026-09-24","customTechnology":"keep"}','Tester',17);
      insert into material_planning_events(event_type,event_data) values ('SENTINEL','{"revision":17}');
      insert into przygotowanie_produkcji_sessions(id,created_by,session_date)
        values ('00000000-0000-0000-0000-000000000003','Tester','2026-09-24');
      insert into przygotowanie_produkcji_tasks(session_id,task_key,station,detail,done,notes)
        values ('00000000-0000-0000-0000-000000000003','task','WTR 21','Completed',true,'{"completedBy":"Tester"}');
      insert into przygotowanie_produkcji_history(plan_date,tasks)
        values ('2026-09-20','[{"completed":22,"pending":3,"cancelled":2}]');
      insert into original_inventory_erp_snapshots(snapshot_date,name,real_qty,available_qty,imported_by,qty,unit)
        values ('2020-01-01','Old ERP',100,90,'Tester',85,'kg');
      insert into paint_tape_inventory_catalog(id,item_index,name) values
        ('00000000-0000-0000-0000-000000000004','PT1','Paint');
      insert into paint_tape_inventory_sessions(id,inventory_date,status,expected_count,checked_count)
        values ('00000000-0000-0000-0000-000000000005','2020-01-01','CLOSED',1,1);
      insert into paint_tape_inventory_entries(session_id,catalog_item_id,qty,checked_by) values
        ('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000004',14.5,'Tester');
      insert into paint_tape_settlements(detail_name,item_name,start_qty,warehouse_issued_qty,status,production_completed_at)
        values ('Detail','Paint',5,7,'DONE','2020-01-01');
      insert into raport_brakowosci_latest(id,payload) values ('latest','{"bars":[1,2,3]}');
      create or replace function public.save_material_planning_state(p_module_id text,p_state jsonb,p_expected_revision bigint,p_updated_by text)
        returns table(new_revision bigint,has_conflict boolean) language sql as $$ select 999::bigint,false $$;
      grant execute on function public.save_material_planning_state(text,jsonb,bigint,text) to authenticated;
    `);
    const before = await data(db);
    const securityBefore = await security(db);
    const functionsBefore = await functions(db);
    const constraintsBefore = (await db.query("select conname,pg_get_constraintdef(oid) definition from pg_constraint where connamespace='public'::regnamespace order by conname")).rows;
    const indexesBefore = (await db.query("select indexname,indexdef from pg_indexes where schemaname='public' order by indexname")).rows;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await runModules(db);
      assert.deepEqual(await data(db), before, `data changed on attempt ${attempt}`);
      assert.deepEqual(await security(db), securityBefore);
      const after = await functions(db);
      for (const f of functionsBefore) assert.deepEqual(after.find(x => x.proname === f.proname && x.args === f.args), f);
      assert.deepEqual((await db.query("select conname,pg_get_constraintdef(oid) definition from pg_constraint where connamespace='public'::regnamespace order by conname")).rows, constraintsBefore);
      const indexesAfter = (await db.query("select indexname,indexdef from pg_indexes where schemaname='public' order by indexname")).rows;
      for (const index of indexesBefore) assert.deepEqual(indexesAfter.find(x => x.indexname === index.indexname), index);
    }
    assert.equal((await db.query('select count(*)::int n from original_inventory_erp_snapshots')).rows[0].n, 1);
    assert.equal((await db.query('select erp_comparison from paint_tape_inventory_sessions')).rows[0].erp_comparison, null);
  } finally { await db.close(); }
});

test('a failed module rolls back all its new objects', async () => {
  const db = await createSqlTestDatabase();
  try {
    // Missing ERP prerequisite intentionally fails trigger installation at the end.
    await assert.rejects(db.exec(readSqlModule('05_farby_i_tasmy.sql')), /original_inventory_erp_snapshots/);
    await db.exec('rollback;');
    assert.equal((await db.query("select count(*)::int n from pg_tables where schemaname='public'")).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int n from pg_proc where pronamespace='public'::regnamespace")).rows[0].n, 0);
  } finally { await db.close(); }
});
