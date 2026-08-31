import assert from 'node:assert/strict';
import test from 'node:test';
import { isToolroomReturnTask, toolroomReturnId, toolroomLinkNotes, withToolroomReturnTasks } from './productionToolroomTasks.ts';

const parent = (id='plan-1', overrides={}) => ({
  id, station:'WTR 49', detail:'MANETA BOSCH (9001434742)', quantity:'1980', norm:'1120',
  isCurrentPlan:true, planGroup:'standard', highlighted:true, kinds:['forma-narzedziownia'],
  teams:['mechanics','process'], notes:{mechanics:'Uwaga do zdjęcia formy',processAssignee:'Adam'}, done:false,
  material:'PP', materialType:'TW', source:'Silos', dryer:'S1', temperature:'80', ...overrides
});

test('creates one return directly below the matching index and station',()=>{
  const source=parent();const next=parent('plan-2',{station:'WTR 50',kinds:[]});
  const result=withToolroomReturnTasks([source,next]);
  assert.deepEqual(result.map(task=>task.id),[source.id,toolroomReturnId(source.id),next.id]);
  const child=result[1];
  assert.equal(child.station,source.station);assert.equal(child.detail,source.detail);
  assert.deepEqual(child.teams,['mechanics']);assert.deepEqual(child.kinds,['powrot-formy-narzedziownia']);
  assert.equal(child.notes.mechanics,undefined);assert.equal(child.notes.processAssignee,undefined);
  assert.equal(child.isCurrentPlan,false);assert.equal(child.material,'');assert.equal(child.done,false);
  assert.equal(result.filter(task=>task.isCurrentPlan).length,2);
  assert.deepEqual(source,parent());
});

test('repeated normalization never duplicates returns, even on identical machines and indices',()=>{
  const initial=[parent(),parent('plan-2')];
  let tasks=withToolroomReturnTasks(initial);
  for(let i=0;i<10;i++)tasks=withToolroomReturnTasks(tasks);
  assert.equal(tasks.length,4);assert.equal(new Set(tasks.map(task=>task.id)).size,4);
  assert.deepEqual(tasks.filter(isToolroomReturnTask).map(task=>task.notes.toolroomParentId),['plan-1','plan-2']);
});

test('return keeps its own note, completion and cancellation, not the source state',()=>{
  const tasks=withToolroomReturnTasks([parent()]);
  tasks[1]={...tasks[1],notes:{...tasks[1].notes,mechanics:'Zawiesić po naprawie'},done:true,kinds:[...tasks[1].kinds,'anulowane']};
  const result=withToolroomReturnTasks([{...tasks[0],done:false,detail:'Poprawiona nazwa',quantity:'3000'},tasks[1]]);
  assert.equal(result[1].done,true);assert.equal(result[1].notes.mechanics,'Zawiesić po naprawie');
  assert.equal(result[1].detail,'Poprawiona nazwa');assert.equal(result[1].quantity,'3000');
  assert.ok(result[1].kinds.includes('anulowane'));assert.ok(!result[0].kinds.includes('anulowane'));
  assert.equal(withToolroomReturnTasks([parent('done',{done:true})])[1].done,false);
});

test('removing the sending assignment or the whole source does not remove an existing return',()=>{
  const [source,child]=withToolroomReturnTasks([parent()]);
  let result=withToolroomReturnTasks([{...source,teams:['process'],kinds:[]},child]);
  assert.equal(result[1].id,child.id);assert.deepEqual(result[1].teams,['mechanics']);
  result=withToolroomReturnTasks([child]);assert.equal(result.length,1);assert.equal(result[0].id,child.id);
});

test('removed return stays removed after import and refresh instead of being regenerated',()=>{
  const [source,child]=withToolroomReturnTasks([parent()]);
  const removed={...child,teams:[],kinds:[],notes:toolroomLinkNotes(child)};
  const result=withToolroomReturnTasks([source,removed]);
  assert.equal(result.length,2);assert.deepEqual(result[1].teams,[]);assert.deepEqual(result[1].kinds,[]);
  assert.deepEqual(result[0].kinds,['forma-narzedziownia']);
});

test('link survives a legacy client clearing notes and returns are reordered correctly',()=>{
  const [source,child]=withToolroomReturnTasks([parent('zażółć / 1')]);
  assert.equal(isToolroomReturnTask({...child,notes:{}}),true);
  const result=withToolroomReturnTasks([{...child,notes:{}},source]);
  assert.deepEqual(result.map(task=>task.id),[source.id,child.id]);
  assert.equal(result[1].notes.toolroomParentId,source.id);
});

test('no new returns for unrelated, cancelled, manual or unassigned jobs; old history is not invented',()=>{
  for(const overrides of [{kinds:['rozruch']},{teams:['process']},{kinds:['forma-narzedziownia','anulowane']},{station:'ZADANIE DODATKOWE'}]) {
    assert.equal(withToolroomReturnTasks([parent('a',overrides)]).length,1);
  }
  assert.equal(withToolroomReturnTasks([parent()],false).length,1);
});
