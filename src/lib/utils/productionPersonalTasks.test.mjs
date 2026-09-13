import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const Module = require('module');
const utilityFile = fileURLToPath(new URL('./productionPersonalTasks.ts', import.meta.url));
const utilityModule = new Module(utilityFile);
utilityModule._compile(ts.transpileModule(readFileSync(utilityFile, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, utilityFile);
const personal = utilityModule.exports;

test('personal task input rejects invalid data and normalizes safe values', () => {
  assert.match(personal.validatePersonalTaskInput(null), /Nieprawidłowe/);
  assert.match(personal.validatePersonalTaskInput({title:'',dueDate:'2026-09-13',recurrence:'once'}), /treść/);
  assert.match(personal.validatePersonalTaskInput({title:'Test',dueDate:'2026-02-30',recurrence:'once'}), /termin/);
  assert.match(personal.validatePersonalTaskInput({title:'Test',dueDate:'2026-09-13',recurrence:'hourly'}), /cykliczność/);
  assert.deepEqual(personal.normalizePersonalTaskInput({title:'  Kontrola stanu  ',dueDate:'2026-09-13',recurrence:'weekly'}), {
    title:'Kontrola stanu',dueDate:'2026-09-13',recurrence:'weekly'
  });
});

test('personal recurrence advances overdue dates and preserves monthly anchor days', () => {
  assert.equal(personal.nextPersonalTaskDueDate('2026-09-10','daily','2026-09-13'), '2026-09-14');
  assert.equal(personal.nextPersonalTaskDueDate('2026-09-01','weekly','2026-09-13'), '2026-09-15');
  assert.equal(personal.nextPersonalTaskDueDate('2026-09-20','weekly','2026-09-13'), '2026-09-27');
  assert.equal(personal.nextPersonalTaskDueDate('2027-01-31','monthly','2027-01-31',31), '2027-02-28');
  assert.equal(personal.nextPersonalTaskDueDate('2027-02-28','monthly','2027-02-28',31), '2027-03-31');
  assert.equal(personal.nextPersonalTaskDueDate('2028-01-31','monthly','2028-01-31',31), '2028-02-29');
  assert.equal(personal.nextPersonalTaskDueDate('2026-09-13','once','2026-09-13'), null);
});

function personalApi() {
  const USER_A = '11111111-1111-4111-8111-111111111111';
  const USER_B = '22222222-2222-4222-8222-222222222222';
  const db = { przygotowanie_produkcji_sessions: [], przygotowanie_produkcji_tasks: [] };
  const state = { user:{id:USER_A,name:'Anna'}, allowed:true, writeCount:0, likeCalls:[] };
  let sequence = 0;
  const clone = (value) => structuredClone(value);

  class Query {
    constructor(table) { this.table=table; this.filters=[]; this.mode='select'; }
    select() { return this; }
    eq(key,value) { this.filters.push((row)=>row[key]===value); return this; }
    like(key,value) { const prefix=String(value).replace(/%$/, '').replaceAll('\\', ''); state.likeCalls.push({key,value}); this.filters.push((row)=>String(row[key]??'').startsWith(prefix)); return this; }
    order() { return this; }
    insert(values) { this.mode='insert'; this.values=values; return this; }
    upsert(values,options) { this.mode='upsert'; this.values=values; this.options=options; return this; }
    update(values) { this.mode='update'; this.values=values; return this; }
    delete() { this.mode='delete'; return this; }
    maybeSingle() { return this.run(true); }
    single() { return this.run(true); }
    then(resolve,reject) { return this.run(false).then(resolve,reject); }
    async run(single) {
      const table=db[this.table];
      assert.ok(table, `Unexpected table ${this.table}`);
      let result=table.filter((row)=>this.filters.every((filter)=>filter(row)));
      if(this.mode==='update') {
        state.writeCount+=1;
        result.forEach((row)=>Object.assign(row,clone(this.values)));
      }
      if(this.mode==='delete') {
        state.writeCount+=1;
        const removed=[...result];
        for(const row of removed) table.splice(table.indexOf(row),1);
        result=removed;
      }
      if(this.mode==='insert'||this.mode==='upsert') {
        state.writeCount+=1;
        result=[];
        for(const value of Array.isArray(this.values)?this.values:[this.values]) {
          const existing=this.mode==='upsert'
            ? table.find((row)=>row[this.options.onConflict]===value[this.options.onConflict])
            : undefined;
          if(existing) {
            if(!this.options.ignoreDuplicates) Object.assign(existing,clone(value));
            result.push(existing);
          } else {
            const row={id:`row-${++sequence}`,created_at:'2026-09-13T08:00:00.000Z',updated_at:'2026-09-13T08:00:00.000Z',...clone(value)};
            table.push(row);
            result.push(row);
          }
        }
      }
      return {data:clone(single?result[0]??null:result),error:null};
    }
  }

  const routeFile=fileURLToPath(new URL('../../app/api/przygotowanie-produkcji/personal-tasks/route.ts',import.meta.url));
  const mod=new Module(routeFile);
  const stubs={
    'node:crypto':require('node:crypto'),
    'next/server':{NextResponse:{json:(data,options)=>new Response(JSON.stringify(data),{status:options?.status??200,headers:{'Content-Type':'application/json'}})}},
    '@/lib/auth/access':{canSeeTab:()=>state.allowed},
    '@/lib/auth/session':{getAuthenticatedUser:async()=>({user:state.user,code:state.user?null:'UNAUTHORIZED'})},
    '@/lib/supabase/admin':{supabaseAdmin:{from:(table)=>new Query(table)}},
    '@/lib/utils/productionPlanDate':{getWarsawProductionPlanDate:()=> '2026-09-13'},
    '@/lib/utils/productionPersonalTasks':personal
  };
  mod.require=(id)=>{assert.ok(id in stubs,`Unmocked route dependency ${id}`);return stubs[id];};
  mod._compile(ts.transpileModule(readFileSync(routeFile,'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}
  }).outputText,routeFile);
  const get=async()=>mod.exports.GET({});
  const post=async(body)=>mod.exports.POST({json:async()=>body});
  return {USER_A,USER_B,db,state,get,post};
}

const taskInput = (overrides={}) => ({title:'Sprawdzić stany',dueDate:'2026-09-13',recurrence:'once',...overrides});

test('personal task endpoint requires module access and rejects injected ownership', async () => {
  const api=personalApi();
  api.state.user=null;
  assert.equal((await api.get()).status,401);
  api.state.user={id:api.USER_A,name:'Anna'};
  api.state.allowed=false;
  assert.equal((await api.get()).status,403);
  api.state.allowed=true;
  const writes=api.state.writeCount;
  const injected=await api.post({action:'create',task:{...taskInput(),ownerId:api.USER_B}});
  assert.equal(injected.status,400);
  assert.equal(api.state.writeCount,writes);
});

test('users create, edit and see only their own personal tasks', async () => {
  const api=personalApi();
  const created=await api.post({action:'create',task:taskInput()});
  assert.ok(api.state.likeCalls.some((call)=>call.key==='task_key'&&call.value.includes(api.USER_A)));
  assert.equal(created.status,201);
  const createdData=await created.json();
  assert.equal(createdData.tasks.length,1);
  const task=createdData.tasks[0];
  const raw=api.db.przygotowanie_produkcji_tasks.find((row)=>String(row.task_key).endsWith(task.id));
  assert.equal(raw.notes.personalTask.ownerId,api.USER_A);

  api.state.user={id:api.USER_B,name:'Bartek'};
  assert.deepEqual((await(await api.get()).json()).tasks,[]);
  assert.equal((await api.post({action:'update',id:task.id,task:taskInput({title:'Cudze'})})).status,404);
  assert.equal((await api.post({action:'archive',id:task.id})).status,404);

  api.state.user={id:api.USER_A,name:'Anna'};
  const updated=await api.post({action:'update',id:task.id,task:taskInput({title:'Sprawdzić stany magazynowe',recurrence:'weekly'})});
  assert.equal(updated.status,200);
  assert.equal((await updated.json()).tasks[0].title,'Sprawdzić stany magazynowe');
});

test('one-time personal task can be completed, restored and archived', async () => {
  const api=personalApi();
  const task=(await(await api.post({action:'create',task:taskInput()})).json()).tasks[0];
  let response=await api.post({action:'complete',id:task.id,occurrenceDate:task.dueDate});
  assert.equal(response.status,200);
  let saved=(await response.json()).tasks[0];
  assert.equal(saved.done,true);
  assert.ok(saved.completedAt);

  response=await api.post({action:'undo',id:task.id});
  saved=(await response.json()).tasks[0];
  assert.equal(saved.done,false);
  assert.equal(saved.completedAt,undefined);

  response=await api.post({action:'archive',id:task.id});
  assert.equal(response.status,200);
  assert.deepEqual((await response.json()).tasks,[]);
  assert.equal(api.db.przygotowanie_produkcji_tasks.length,0);
});

test('recurring completion advances once, is idempotent and can be undone', async () => {
  const api=personalApi();
  const created=await api.post({action:'create',task:taskInput({dueDate:'2026-09-10',recurrence:'daily'})});
  const task=(await created.json()).tasks[0];
  let response=await api.post({action:'complete',id:task.id,occurrenceDate:'2026-09-10'});
  assert.equal(response.status,200);
  let saved=(await response.json()).tasks[0];
  assert.equal(saved.done,false);
  assert.equal(saved.dueDate,'2026-09-14');
  assert.equal(saved.lastCompletedDueDate,'2026-09-10');
  const writesAfterFirst=api.state.writeCount;

  response=await api.post({action:'complete',id:task.id,occurrenceDate:'2026-09-10'});
  assert.equal(response.status,200);
  assert.equal(api.state.writeCount,writesAfterFirst);
  assert.equal((await response.json()).tasks[0].dueDate,'2026-09-14');

  response=await api.post({action:'complete',id:task.id,occurrenceDate:'2026-09-11'});
  assert.equal(response.status,409);
  response=await api.post({action:'undo',id:task.id});
  saved=(await response.json()).tasks[0];
  assert.equal(saved.dueDate,'2026-09-10');
  assert.equal(saved.lastCompletedAt,undefined);
});

test('daily plan route keeps personal storage rows out of module task data', () => {
  const route=readFileSync(fileURLToPath(new URL('../../app/api/przygotowanie-produkcji/route.ts',import.meta.url)),'utf8');
  assert.match(route,/startsWith\('__personal_task__:'\)/);
});
