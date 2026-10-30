import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readSqlModule } from '../../../scripts/sql-files.mjs';
import { createSqlTestDatabase, loadSuppliedDatabase } from '../../../scripts/sql-test-database.mjs';

test('two-index SQL is idempotent, preserves quantities, protects stale metadata and forbids public writes', async () => {
  const db = await createSqlTestDatabase();
  const sql = name => readFileSync(new URL(`../../../supabase/${name}`, import.meta.url), 'utf8');
  const id = '00000000-0000-4000-8000-000000000001';
  const primary = 'M-10-PWY-BSHL-10012';
  try {
    await loadSuppliedDatabase(db);
    await db.exec(readSqlModule('04_spis_rzeczywisty_i_stany_erp.sql'));
    await db.exec(sql('10_zabezpieczenia.sql'));
    await db.query('insert into original_inventory_catalog(id,name,unit,index_code) values ($1,$2,$3,$4)', [id,'TRAY','szt.',primary]);
    await db.exec("insert into warehouses(id,name) values ('indices-test','Test');");
    await db.exec("insert into original_inventory_entries(warehouse_id,name,qty,unit,user_name) values ('indices-test','TRAY',2371,'szt.','Tester');");
    const before = (await db.query('select * from original_inventory_entries')).rows;
    await db.exec(sql('11_indeksy_kartotek.sql'));
    const update = async (secondary, previous = null, name = 'TRAY') => (await db.query(
      'select * from update_original_inventory_catalog_items_v2($1::jsonb)',
      [JSON.stringify([{id,name,previousName:'TRAY',indexCode:primary,indexCode2:secondary,previousIndexCode2:previous}])]
    )).rows[0];
    assert.equal((await update('8001103471')).updated,true);
    assert.equal((await update('STALE')).updated,false);
    assert.equal((await update(null,'8001103471')).updated,true);
    const current = (await db.query('select * from original_inventory_catalog where id=$1',[id])).rows[0];
    assert.equal(current.index_code,primary);
    assert.equal(current.index_code2,'8001103471');
    assert.deepEqual(current.previous_names,[]);
    await db.exec(sql('11_indeksy_kartotek.sql'));
    assert.deepEqual((await db.query('select * from original_inventory_catalog where id=$1',[id])).rows[0],current);
    assert.deepEqual((await db.query('select * from original_inventory_entries')).rows,before);
    const items = [{name:'TRAY',unit:'szt.',index_code:primary,index_code2:'8001103471',real_qty:5190,available_qty:5000}];
    const imported = await db.query('select * from replace_original_inventory_erp_snapshot_v2($1,$2::jsonb,$3,$4)', ['2026-10-30',JSON.stringify(items),'Tester','two-indices.xlsx']);
    assert.deepEqual(imported.rows,[{inserted:1,replaced:0}]);
    const snapshot = (await db.query("select index_code,index_code2,real_qty,available_qty from original_inventory_erp_snapshots where snapshot_date='2026-10-30'")).rows[0];
    assert.equal(snapshot.index_code,primary);
    assert.equal(snapshot.index_code2,'8001103471');
    assert.equal(Number(snapshot.real_qty),5190);
    assert.equal(Number(snapshot.available_qty),5000);
    for (const fn of ['update_original_inventory_catalog_items_v2(jsonb)','replace_original_inventory_erp_snapshot_v2(date,jsonb,text,text)']) {
      const rights = (await db.query("select has_function_privilege('anon',$1,'execute') anon, has_function_privilege('authenticated',$1,'execute') authenticated, has_function_privilege('service_role',$1,'execute') service",[fn])).rows[0];
      assert.deepEqual(rights,{anon:false,authenticated:false,service:true});
    }
  } finally { await db.close(); }
});
