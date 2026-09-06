import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as comments from './productionTeamComments.ts';
import * as planDates from './productionPlanDate.ts';
import * as workPlan from './productionWorkPlan.ts';
import * as workProgress from './productionWorkProgress.ts';
import * as toolroom from './productionToolroomTasks.ts';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { defaultTeamComments, normalizeTeamComments, normalizeTeamComment, validateTeamComment, teamCommentForTask, TEAM_COMMENT_KEY_PREFIX } = comments;

test('defaults preserve the four existing 5S groups, leaving other groups disabled', () => {
  const defaults = defaultTeamComments();
  assert.deepEqual(Object.keys(defaults).filter(team => defaults[team].enabled), ['mechanics', 'process', 'distribution', 'technician']);
  assert.equal(defaults.graphics.text, '');
  assert.equal(defaults.additional.enabled, false);
});

test('disabled text is retained, and deleting text does not restore the default after reload', () => {
  const disabled = normalizeTeamComment({enabled:false,text:' Własna instrukcja '}, 'mechanics');
  assert.deepEqual(disabled, {enabled:false,text:'Własna instrukcja',showQuantity:false});
  const deleted = normalizeTeamComments(JSON.parse(JSON.stringify({mechanics:{enabled:false,text:''}})));
  assert.deepEqual(deleted.mechanics, {enabled:false,text:'',showQuantity:false});
  assert.equal(deleted.process.enabled, true);
});

test('custom comments apply to only their group and preserve existing manual-task exclusion', () => {
  const settings = normalizeTeamComments({graphics:{enabled:true,text:'Sprawdź wzór\r\nZapisz numer'}});
  assert.equal(teamCommentForTask(settings,'graphics','WTR 45'), 'Sprawdź wzór\nZapisz numer');
  assert.equal(teamCommentForTask(settings,'graphics','ZADANIE DODATKOWE'), '');
  assert.notEqual(teamCommentForTask(settings,'process','WTR 45'), settings.graphics.text);
});

test('validation rejects invalid values and enabled empty comments', () => {
  for (const value of [null,[],{enabled:'false',text:'tekst'},{enabled:true,text:' \n '},{enabled:true,text:'x'.repeat(2001)}]) {
    assert.ok(validateTeamComment(value));
  }
  assert.equal(validateTeamComment({enabled:false,text:''}), null);
  assert.equal(validateTeamComment({enabled:true,text:'x'.repeat(2000)}), null);
  assert.equal(comments.isProductionTeam('__proto__'), false);
});

test('production plan dates accept real days and remain attached to module navigation', () => {
  assert.equal(planDates.isProductionPlanDate('2026-09-03'), true);
  assert.equal(planDates.isProductionPlanDate('2026-02-29'), false);
  assert.equal(planDates.isProductionPlanDate('03.09.2026'), false);
  assert.equal(
    planDates.withProductionPlanDate('/przygotowanie-produkcji?view=work-plan', '2026-09-03'),
    '/przygotowanie-produkcji?view=work-plan&date=2026-09-03'
  );
  assert.equal(
    planDates.withProductionPlanDate('/przygotowanie-produkcji', '2026-09-03'),
    '/przygotowanie-produkcji?date=2026-09-03'
  );
  assert.equal(planDates.withProductionPlanDate('/spis', '2026-09-03'), '/spis');
});

test('work plan is split into technology and production preparation teams', () => {
  assert.deepEqual(
    [...workPlan.teamsForProductionWorkPlan('work-plan-technology')],
    ['mechanics', 'process', 'graphics']
  );
  assert.deepEqual(
    [...workPlan.teamsForProductionWorkPlan('work-plan-preparation')],
    ['distribution', 'technician', 'additional']
  );
  assert.equal(workPlan.normalizeProductionWorkPlanView('work-plan'), 'work-plan-technology');
  assert.deepEqual(workPlan.teamsForProductionWorkPlan('material'), []);
});

test('work-plan task actions remain touch-friendly and inside each card on phones', () => {
  const pageFile=fileURLToPath(new URL('../../app/(main)/przygotowanie-produkcji/page.tsx',import.meta.url));
  const page=readFileSync(pageFile,'utf8');
  const mobileStart=page.indexOf('@media (max-width: 767px)');
  const mobileEnd=page.indexOf('`}</style>',mobileStart);
  assert.ok(mobileStart>=0&&mobileEnd>mobileStart);
  const mobileCss=page.slice(mobileStart,mobileEnd);
  assert.match(mobileCss,/\.production-queues \.production-task-actions \{[\s\S]*?position: static !important;/);
  assert.match(mobileCss,/\.production-queues \.production-task-actions button \{[\s\S]*?height: 2\.75rem !important;[\s\S]*?flex: 1 1 0%;/);
  assert.match(mobileCss,/\.production-queues select \{[\s\S]*?font-size: 1rem;/);
  assert.doesNotMatch(page,/\.production-queues \.flex\.justify-end/);
  assert.match(page,/md:hidden">\{mobileLabel\}<\/span>/);
  assert.match(page,/md:hidden">\{editing \? 'Zamknij' : 'Edytuj'\}<\/span>/);
  assert.match(page,/md:hidden">Usuń<\/span>/);
  const queueStart=page.indexOf('const columnCopyId = `column-${team.id}`');
  const queueEnd=page.indexOf("workPlanView === 'work-plan-technology'",queueStart);
  assert.ok(queueStart>=0&&queueEnd>queueStart);
  const queueSource=page.slice(queueStart,queueEnd);
  assert.ok(queueSource.indexOf("team.id === 'process'")<queueSource.indexOf('production-task-actions'));
});

test('process engineer cards use red blocked, amber ready and green completed states', () => {
  const pageFile=fileURLToPath(new URL('../../app/(main)/przygotowanie-produkcji/page.tsx',import.meta.url));
  const page=readFileSync(pageFile,'utf8');
  assert.match(page,/process-status-blocked text-red-300/);
  assert.match(page,/process-status-ready text-amber-300/);
  assert.match(page,/process-status-done/);
  assert.match(page,/<style jsx global>/);
  assert.match(page,/:has\(\.process-status-blocked\)[\s\S]*?border-color: rgba\(239, 68, 68, 0\.82\)/);
  assert.match(page,/:has\(\.process-status-ready\)[\s\S]*?border-color: rgba\(251, 191, 36, 0\.88\)/);
  assert.match(page,/border-red-500\/65 bg-red-500\/15 text-red-300/);
  assert.match(page,/border-amber-400\/70 bg-amber-500\/15 text-amber-200/);
  assert.match(page,/border-emerald-400\/70 bg-emerald-500\/25 text-emerald-200/);
});

test('work progress unlocks startup teams only after assigned preparation teams finish', () => {
  const task = {
    teams: ['mechanics', 'distribution', 'technician', 'process', 'graphics', 'additional'],
    kinds: ['zmiana-formy'],
    teamProgress: {},
    done: false
  };
  assert.equal(workProgress.canProductionTeamStart(task, 'mechanics'), true);
  assert.equal(workProgress.canProductionTeamStart(task, 'distribution'), true);
  assert.equal(workProgress.canProductionTeamStart(task, 'technician'), true);
  assert.equal(workProgress.canProductionTeamStart(task, 'process'), false);
  assert.equal(workProgress.canProductionTeamStart(task, 'graphics'), false);
  assert.deepEqual(workProgress.productionWaitingTeams(task, 'process'), ['mechanics', 'distribution', 'technician']);

  for (const team of ['mechanics', 'distribution', 'technician']) {
    task.teamProgress = workProgress.setProductionTeamCompletion(task.teamProgress, team, true);
  }
  assert.equal(workProgress.canProductionTeamStart(task, 'process'), true);
  assert.equal(workProgress.canProductionTeamStart(task, 'graphics'), true);
  assert.equal(workProgress.isProductionTaskDone(task), false);
  task.teamProgress = workProgress.setProductionTeamCompletion(task.teamProgress, 'process', true);
  task.teamProgress = workProgress.setProductionTeamCompletion(task.teamProgress, 'graphics', true);
  assert.equal(workProgress.isProductionTaskDone(task), true);
  assert.equal(workProgress.isProductionTeamDone(task, 'additional'), false);
  task.teamProgress = workProgress.productionTeamProgressForTask({
    ...task,
    teamProgress: workProgress.setProductionTeamCompletion(task.teamProgress, 'technician', false),
    done: false
  });
  assert.equal(workProgress.isProductionTeamDone(task, 'process'), false);
  assert.equal(workProgress.isProductionTeamDone(task, 'graphics'), false);

  const technicianOnly = { teams: ['technician', 'process'], kinds: ['inne'], teamProgress: {}, done: false };
  assert.deepEqual(workProgress.productionWaitingTeams(technicianOnly, 'process'), ['technician']);
  technicianOnly.teamProgress = workProgress.setProductionTeamCompletion(technicianOnly.teamProgress, 'technician', true);
  assert.equal(workProgress.canProductionTeamStart(technicianOnly, 'process'), true);
  assert.equal(workProgress.canProductionTeamStart({ teams: ['process'], kinds: ['inne'], teamProgress: {} }, 'process'), true);
  assert.equal(workProgress.canProductionTeamStart({ ...task, kinds: ['anulowane'] }, 'process'), false);
});

test('toolroom return is a separate mechanic gate for process startup', () => {
  const task = {
    teams: ['mechanics', 'process'],
    kinds: ['forma-narzedziownia'],
    teamProgress: {
      mechanics: {completedAt: '2026-09-06T08:00:00.000Z', completedBy: 'Mechanik'},
      process: {completedAt: '2026-09-06T08:05:00.000Z', completedBy: 'Inżynier'}
    },
    toolroomReturnDone: false,
    done: true
  };
  assert.equal(workProgress.productionWaitsForToolroomReturn(task, 'process'), true);
  assert.deepEqual(workProgress.productionWaitingTeams(task, 'process'), ['mechanics']);
  assert.equal(workProgress.canProductionTeamStart(task, 'process'), false);
  assert.equal(workProgress.productionTeamProgressForTask(task).process, undefined);
  assert.equal(workProgress.isProductionTaskDone(task), false);

  const returned = {...task, toolroomReturnDone: true, done: false};
  assert.equal(workProgress.productionWaitsForToolroomReturn(returned, 'process'), false);
  assert.deepEqual(workProgress.productionWaitingTeams(returned, 'process'), []);
  assert.equal(workProgress.canProductionTeamStart(returned, 'process'), true);
  assert.ok(workProgress.productionTeamProgressForTask(returned).process);
});

// Exercise the real route against an isolated in-memory database, never Supabase.
function testApi() {
  const db = {przygotowanie_produkcji_sessions:[],przygotowanie_produkcji_tasks:[],przygotowanie_produkcji_history:[]};
  const state = {user:{name:'Test'},readOnly:false,allowed:true,failWrite:false};
  let sequence=0;
  const clone=value=>structuredClone(value);
  class Query {
    constructor(table) {this.table=table;this.filters=[];this.mode='select';}
    select() {return this;}
    eq(key,value) {this.filters.push(row=>row[key]===value);return this;}
    neq(key,value) {this.filters.push(row=>row[key]!==value);return this;}
    lt(key,value) {this.filters.push(row=>row[key]<value);return this;}
    in(key,values) {this.filters.push(row=>values.includes(row[key]));return this;}
    order() {return this;}
    insert(values) {this.mode='insert';this.values=values;return this;}
    upsert(values,options) {this.mode='upsert';this.values=values;this.options=options;return this;}
    update(values) {this.mode='update';this.values=values;return this;}
    maybeSingle() {return this.run(true);}
    single() {return this.run(true);}
    then(resolve,reject) {return this.run(false).then(resolve,reject);}
    async run(single) {
      const table=db[this.table];
      assert.ok(table, `Unexpected table ${this.table}`);
      if(state.failWrite&&this.mode!=='select')return {data:null,error:new Error('Testowy błąd zapisu')};
      let result=table.filter(row=>this.filters.every(filter=>filter(row)));
      if(this.mode==='update')result.forEach(row=>Object.assign(row,clone(this.values)));
      if(this.mode==='insert'||this.mode==='upsert') {
        result=[];
        for(const value of Array.isArray(this.values)?this.values:[this.values]) {
          const existing=this.mode==='upsert'?table.find(row=>row[this.options.onConflict]===value[this.options.onConflict]):undefined;
          if(existing) {if(!this.options.ignoreDuplicates)Object.assign(existing,clone(value));result.push(existing);}
          else {
            if(value.id&&table.some(row=>row.id===value.id)) return {data:null,error:{code:'23505'}};
            const row={id:`id-${++sequence}`,updated_at:'initial',...clone(value)};table.push(row);result.push(row);
          }
        }
      }
      return {data:clone(single?result[0]??null:result),error:null};
    }
  }
  const routeFile=fileURLToPath(new URL('../../app/api/przygotowanie-produkcji/route.ts',import.meta.url));
  const mod=new Module(routeFile);
  const stubs={
    'node:crypto':require('node:crypto'),
    'next/server':{NextResponse:{json:(data,options)=>new Response(JSON.stringify(data),{status:options?.status??200,headers:{'Content-Type':'application/json'}})}},
    '@/lib/auth/access':{canSeeTab:()=>state.allowed,isReadOnly:()=>state.readOnly},
    '@/lib/auth/session':{getAuthenticatedUser:async()=>({user:state.user,code:'UNAUTHORIZED'})},
    '@/lib/supabase/admin':{supabaseAdmin:{from:table=>new Query(table)}},
    '@/lib/utils/productionPlanDate':planDates,
    '@/lib/utils/productionTeamComments':comments,
    '@/lib/utils/productionWorkProgress':workProgress,
    '@/lib/utils/productionToolroomTasks':toolroom
  };
  mod.require=(id)=>{assert.ok(id in stubs,`Unmocked route dependency ${id}`);return stubs[id];};
  mod._compile(ts.transpileModule(readFileSync(routeFile,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,routeFile);
  const get=async(query='?sync=1')=>mod.exports.GET({nextUrl:new URL(`http://test/api/przygotowanie-produkcji${query}`)});
  const post=async(body)=>mod.exports.POST({json:async()=>body});
  const save=(team,comment)=>post({action:'saveTeamComment',team,comment});
  return {db,state,get,post,save};
}

test('settings can be saved before any plan exists and are loaded again globally', async () => {
  const api=testApi();
  const response=await api.save('graphics',{enabled:true,text:'Wzór ma być zatwierdzony.'});
  assert.equal(response.status,200);
  const data=await (await api.get()).json();
  assert.equal(data.session,null);
  assert.deepEqual(data.tasks,[]);
  assert.deepEqual(data.teamComments.graphics,{enabled:true,text:'Wzór ma być zatwierdzony.',showQuantity:true});
  assert.equal(api.db.przygotowanie_produkcji_sessions[0].session_date,'2000-01-01');
  assert.equal(api.db.przygotowanie_produkcji_history.length,0);
});

test('saving one group preserves other groups and engineer settings', async () => {
  const api=testApi();
  await api.post({action:'saveProcessEngineers',processEngineerRoster:[{name:'Testowy inżynier',shift:'2',active:true}]});
  const session=api.db.przygotowanie_produkcji_sessions[0];
  const roster=cloneRow(api.db.przygotowanie_produkcji_tasks[0]);
  const savedSession=cloneRow(session);
  await api.save('mechanics',{enabled:true,text:'Komentarz mechanika'});
  await api.save('graphics',{enabled:true,text:'Komentarz grafika'});
  await api.save('mechanics',{enabled:false,text:'Komentarz mechanika'});
  const data=await (await api.get()).json();
  assert.equal(data.teamComments.graphics.text,'Komentarz grafika');
  assert.equal(data.teamComments.mechanics.enabled,false);
  assert.equal(data.teamComments.mechanics.text,'Komentarz mechanika');
  assert.deepEqual(api.db.przygotowanie_produkcji_tasks.find(row=>row.task_key==='__process_engineers__'),roster);
  assert.deepEqual(session,savedSession);
  assert.equal(api.db.przygotowanie_produkcji_tasks.filter(row=>row.task_key===`${TEAM_COMMENT_KEY_PREFIX}mechanics`).length,1);
});

const cloneRow=value=>structuredClone(value);

test('deleted comments stay deleted after reload and roster saves', async () => {
  const api=testApi();
  await api.save('process',{enabled:false,text:''});
  await api.post({action:'saveProcessEngineers',processEngineerRoster:[{name:'Inna osoba',shift:'1',active:true}]});
  const data=await (await api.get()).json();
  assert.deepEqual(data.teamComments.process,{enabled:false,text:'',showQuantity:false});
});

test('unchanged plan responses still refresh shared comments', async () => {
  const api=testApi();
  const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Warsaw'}).format(new Date());
  api.db.przygotowanie_produkcji_sessions.push({id:'daily',session_date:date,updated_at:'version-1'});
  await api.save('process',{enabled:true,text:'Nowa wspólna instrukcja'});
  const data=await (await api.get('?sync=1&since=version-1')).json();
  assert.equal(data.unchanged,true);
  assert.equal(data.teamComments.process.text,'Nowa wspólna instrukcja');
});

test('invalid requests and access restrictions never write settings', async () => {
  const api=testApi();
  assert.equal((await api.save('unknown',{enabled:true,text:'tekst'})).status,400);
  assert.equal((await api.save('mechanics',{enabled:true,text:' '})).status,400);
  api.state.readOnly=true;
  assert.equal((await api.save('mechanics',{enabled:true,text:'tekst'})).status,403);
  api.state.readOnly=false;api.state.allowed=false;
  assert.equal((await api.save('mechanics',{enabled:true,text:'tekst'})).status,403);
  api.state.allowed=true;api.state.user=null;
  assert.equal((await api.save('mechanics',{enabled:true,text:'tekst'})).status,401);
  assert.equal(api.db.przygotowanie_produkcji_sessions.length,0);
  assert.equal(api.db.przygotowanie_produkcji_tasks.length,0);
});

test('database failures are reported without pretending the comment was saved', async () => {
  const api=testApi();api.state.failWrite=true;
  const result=await api.save('mechanics',{enabled:true,text:'Komentarz'});
  assert.equal(result.status,400);
  assert.match((await result.json()).message,/błąd zapisu/);
});

test('legacy settings retain the existing quantity visibility for each group', () => {
  const settings=normalizeTeamComments({mechanics:{enabled:false,text:'Własny tekst'}});
  assert.deepEqual(Object.keys(settings).filter(team=>settings[team].showQuantity),['distribution','graphics','additional']);
  assert.equal(settings.mechanics.text,'Własny tekst');
  assert.equal(settings.mechanics.enabled,false);
});

test('quantity visibility is independent from automatic comments for every group', () => {
  const task={station:'WTR 45',quantity:'1980',norm:'1120'};
  for(const team of comments.PRODUCTION_TEAMS) {
    for(const enabled of [true,false]) {
      for(const showQuantity of [true,false]) {
        const settings=normalizeTeamComments({[team]:{enabled,text:'Tekst grupy',showQuantity}});
        assert.equal(comments.productionMetricsForTask(settings,team,task),showQuantity?'Ilość: 1980 | Norma: 1120':'');
        assert.equal(teamCommentForTask(settings,team,task.station),enabled?'Tekst grupy':'');
        assert.equal(comments.productionMetricsForTask(settings,team,{...task,station:'ZADANIE DODATKOWE'}),'');
      }
    }
  }
  const settings=defaultTeamComments();
  assert.equal(comments.productionMetricsForTask(settings,'distribution',{...task,quantity:'0',norm:'0'}),'Ilość: 0 | Norma: 0');
  assert.equal(comments.productionMetricsForTask(settings,'distribution',{...task,quantity:'',norm:''}),'Ilość: --- | Norma: ---');
});

test('quantity visibility persists and old clients cannot reset it by editing only the comment', async () => {
  const api=testApi();
  await api.save('mechanics',{enabled:false,text:'',showQuantity:true});
  await api.save('distribution',{enabled:true,text:'Sprawdź materiał',showQuantity:false});
  let data=await(await api.get()).json();
  assert.equal(data.teamComments.mechanics.showQuantity,true);
  assert.equal(data.teamComments.distribution.showQuantity,false);
  assert.equal(data.teamComments.graphics.showQuantity,true);
  await api.save('mechanics',{enabled:true,text:'Nowy tekst ze starszej karty przeglądarki'});
  await api.save('distribution',{enabled:false,text:''});
  data=await(await api.get()).json();
  assert.equal(data.teamComments.mechanics.showQuantity,true);
  assert.equal(data.teamComments.distribution.showQuantity,false);
  assert.equal(data.teamComments.mechanics.text,'Nowy tekst ze starszej karty przeglądarki');
});

test('invalid quantity flags are rejected before writing', async () => {
  const api=testApi();
  for(const showQuantity of ['false',1,null]) {
    assert.equal((await api.save('mechanics',{enabled:false,text:'',showQuantity})).status,400);
  }
  assert.equal(api.db.przygotowanie_produkcji_sessions.length,0);
});

test('all actual copy paths use the same saved quantity switch', async () => {
  const pageFile=fileURLToPath(new URL('../../app/(main)/przygotowanie-produkcji/page.tsx',import.meta.url));
  const page=readFileSync(pageFile,'utf8');
  const start=page.indexOf('  const copyQueueTask =');
  const end=page.indexOf('\n  return (\n    <div className="production-preparation',start);
  assert.ok(start>=0&&end>start);
  const source=`export function createCopies(deps) { const { navigator, window, taskMetrics, taskComment, kindsForTeam, workKinds, isManualTask, setCopiedQueueTask } = deps; ${page.slice(start,end)} return {copyQueueTask,copyTeamQueue,copyProcessEngineerQueue}; }`;
  const mod=new Module(pageFile);
  mod.require=id=>{throw Error(`Unexpected copy dependency: ${id}`);};
  mod._compile(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,pageFile);
  const task={id:'test-task',station:'WTR 45',detail:'TEST',quantity:'1980',norm:'1120',kinds:['rozruch'],notes:{}};
  let copied='';
  for(const showQuantity of [false,true]) {
    const settings=normalizeTeamComments(Object.fromEntries(comments.PRODUCTION_TEAMS.map(team=>[team,{enabled:false,text:'',showQuantity}])));
    const api=mod.exports.createCopies({
      navigator:{clipboard:{writeText:async text=>{copied=text;}}},window:{setTimeout:()=>{}},
      taskMetrics:(item,team)=>comments.productionMetricsForTask(settings,team,item),
      taskComment:(item,team)=>teamCommentForTask(settings,team,item.station),
      kindsForTeam:item=>item.kinds,workKinds:[{id:'rozruch',label:'Rozruch'}],
      isManualTask:item=>item.station==='ZADANIE DODATKOWE',setCopiedQueueTask:()=>{}
    });
    for(const team of comments.PRODUCTION_TEAMS) {
      await api.copyQueueTask(task,team);
      assert.equal(copied.includes('Ilość: 1980 | Norma: 1120'),showQuantity,`single: ${team}`);
      await api.copyTeamQueue(team,[task]);
      assert.equal(copied.includes('Ilość: 1980 | Norma: 1120'),showQuantity,`column: ${team}`);
    }
    await api.copyProcessEngineerQueue('Test',[task]);
    assert.equal(copied.includes('Ilość: 1980 | Norma: 1120'),showQuantity,'engineer column');
    await api.copyQueueTask({...task,station:'ZADANIE DODATKOWE'},'process');
    assert.equal(copied.includes('Ilość:'),false);
  }
});

const toolroomSource = () => ({id:'source-1',station:'WTR 49',detail:'MANETA BOSCH (9001434742)',quantity:'1980',norm:'1120',isCurrentPlan:true,planGroup:'standard',highlighted:false,kinds:['forma-narzedziownia'],teams:['mechanics','process'],notes:{mechanics:'Zdjąć formę'},done:false,material:'PP',materialType:'',source:'',dryer:'',temperature:''});

test('API loads and edits the selected production day without changing another day', async () => {
  const api=testApi();
  const third={...toolroomSource(),detail:'PLAN 3 WRZEŚNIA',kinds:['rozruch'],teams:['process'],notes:{}};
  const fourth={...third,detail:'PLAN 4 WRZEŚNIA'};
  assert.equal((await api.post({action:'savePlan',planDate:'2026-09-03',tasks:[third],fileName:'03.xlsx',sheetName:'Plan'})).status,200);
  assert.equal((await api.post({action:'savePlan',planDate:'2026-09-04',tasks:[fourth],fileName:'04.xlsx',sheetName:'Plan'})).status,200);

  let thirdDay=await(await api.get('?date=2026-09-03')).json();
  let fourthDay=await(await api.get('?date=2026-09-04')).json();
  assert.equal(thirdDay.session.session_date,'2026-09-03');
  assert.equal(thirdDay.tasks[0].detail,'PLAN 3 WRZEŚNIA');
  assert.equal(fourthDay.session.session_date,'2026-09-04');
  assert.equal(fourthDay.tasks[0].detail,'PLAN 4 WRZEŚNIA');

  assert.equal((await api.post({action:'mutateTask',planDate:'2026-09-03',taskId:third.id,mutation:{setNotes:{process:'Edycja starego dnia'}}})).status,200);
  thirdDay=await(await api.get('?date=2026-09-03')).json();
  fourthDay=await(await api.get('?date=2026-09-04')).json();
  assert.equal(thirdDay.tasks[0].notes.process,'Edycja starego dnia');
  assert.equal(fourthDay.tasks[0].notes.process,undefined);
  assert.deepEqual(api.db.przygotowanie_produkcji_sessions.map(row=>row.session_date).sort(),['2026-09-03','2026-09-04']);
});

test('API rejects impossible selected dates before creating a plan', async () => {
  const api=testApi();
  assert.equal((await api.get('?date=2026-02-30')).status,400);
  assert.equal((await api.post({action:'savePlan',planDate:'2026-02-30',tasks:[]})).status,400);
  assert.equal(api.db.przygotowanie_produkcji_sessions.length,0);
});

test('API saves completion per department and unlocks process only after preparation', async () => {
  const api=testApi();
  const task={
    ...toolroomSource(),
    id:'progress-1',
    kinds:['zmiana-formy'],
    teams:['mechanics','distribution','technician','process'],
    notes:{},
    teamProgress:{},
    done:false
  };
  assert.equal((await api.post({action:'savePlan',tasks:[task]})).status,200);

  const blocked=await api.post({action:'mutateTask',taskId:task.id,mutation:{setTeamDone:{team:'process',done:true}}});
  assert.equal(blocked.status,409);
  assert.deepEqual((await blocked.json()).waitingTeams,['mechanics','distribution','technician']);

  const preparationResponses=await Promise.all([
    api.post({action:'mutateTask',taskId:task.id,mutation:{setTeamDone:{team:'mechanics',done:true}}}),
    api.post({action:'mutateTask',taskId:task.id,mutation:{setTeamDone:{team:'distribution',done:true}}}),
    api.post({action:'mutateTask',taskId:task.id,mutation:{setTeamDone:{team:'technician',done:true}}})
  ]);
  assert.deepEqual(preparationResponses.map(response=>response.status),[200,200,200]);
  assert.equal((await api.post({action:'mutateTask',taskId:task.id,mutation:{setTeamDone:{team:'process',done:true}}})).status,200);

  let data=await(await api.get()).json();
  let saved=data.tasks.find(item=>item.id===task.id);
  assert.equal(saved.done,true);
  assert.deepEqual(Object.keys(saved.teamProgress).sort(),['distribution','mechanics','process','technician']);
  assert.ok(Object.values(saved.teamProgress).every(completion=>completion.completedBy==='Test'));
  assert.equal(saved.notes.__teamProgress,undefined);
  const raw=api.db.przygotowanie_produkcji_tasks.find(item=>item.task_key===task.id);
  assert.ok(raw.notes.__teamProgress.process);

  assert.equal((await api.post({action:'mutateTask',taskId:task.id,mutation:{setTeamDone:{team:'technician',done:false}}})).status,200);
  data=await(await api.get()).json();
  saved=data.tasks.find(item=>item.id===task.id);
  assert.equal(saved.done,false);
  assert.equal(saved.teamProgress.technician,undefined);
  assert.equal(saved.teamProgress.process,undefined);
});

test('API rejects invalid or unassigned department confirmations', async () => {
  const api=testApi();
  const task={...toolroomSource(),id:'progress-invalid',kinds:['inne'],teams:['technician'],notes:{},teamProgress:{},done:false};
  await api.post({action:'savePlan',tasks:[task]});
  assert.equal((await api.post({action:'mutateTask',taskId:task.id,mutation:{setTeamDone:{team:'technician',done:'yes'}}})).status,400);
  assert.equal((await api.post({action:'mutateTask',taskId:task.id,mutation:{setTeamDone:{team:'process',done:true}}})).status,409);
  assert.equal((await api.post({action:'mutateTask',taskId:task.id,mutation:{setTeamDone:{team:'additional',done:true}}})).status,400);
});

test('API stores two linked work tasks and snapshots both, with just one production row', async()=>{
  const api=testApi();const source=toolroomSource();
  assert.equal((await api.post({action:'savePlan',tasks:[source],fileName:'plan.xlsx',sheetName:'Plan'})).status,200);
  const data=await(await api.get()).json();
  assert.deepEqual(data.tasks.map(task=>task.id),[source.id,toolroom.toolroomReturnId(source.id)]);
  assert.equal(data.tasks.filter(task=>task.isCurrentPlan).length,1);
  assert.equal(api.db.przygotowanie_produkcji_history[0].tasks.length,2);
  assert.deepEqual(data.tasks[1].teams,['mechanics']);
});

test('API unlocks process only after the mould returns and never resurrects a reverted completion', async()=>{
  const api=testApi();
  const source={...toolroomSource(),id:'toolroom-gate',teamProgress:{}};
  const childId=toolroom.toolroomReturnId(source.id);
  assert.equal((await api.post({action:'savePlan',tasks:[source]})).status,200);
  assert.equal((await api.post({action:'mutateTask',taskId:source.id,mutation:{setTeamDone:{team:'mechanics',done:true}}})).status,200);

  const blocked=await api.post({action:'mutateTask',taskId:source.id,mutation:{setTeamDone:{team:'process',done:true}}});
  assert.equal(blocked.status,409);
  const blockedData=await blocked.json();
  assert.equal(blockedData.waitingForToolroomReturn,true);
  assert.match(blockedData.message,/Powrót formy z narzędziowni/);

  assert.equal((await api.post({action:'mutateTask',taskId:childId,mutation:{setTeamDone:{team:'mechanics',done:true}}})).status,200);
  assert.equal((await api.post({action:'mutateTask',taskId:source.id,mutation:{setTeamDone:{team:'process',done:true}}})).status,200);
  let data=await(await api.get()).json();
  assert.equal(data.tasks.find(task=>task.id===source.id).toolroomReturnDone,true);
  assert.ok(data.tasks.find(task=>task.id===source.id).teamProgress.process);

  assert.equal((await api.post({action:'mutateTask',taskId:childId,mutation:{setTeamDone:{team:'mechanics',done:false}}})).status,200);
  data=await(await api.get()).json();
  assert.equal(data.tasks.find(task=>task.id===childId).done,false);
  assert.equal(data.tasks.find(task=>task.id===source.id).toolroomReturnDone,false);
  assert.equal(data.tasks.find(task=>task.id===source.id).teamProgress.process,undefined);

  assert.equal((await api.post({action:'mutateTask',taskId:childId,mutation:{setTeamDone:{team:'mechanics',done:true}}})).status,200);
  data=await(await api.get()).json();
  assert.equal(data.tasks.find(task=>task.id===source.id).toolroomReturnDone,true);
  assert.equal(data.tasks.find(task=>task.id===source.id).teamProgress.process,undefined);
  assert.equal(data.tasks.find(task=>task.id===source.id).done,false);
  assert.equal((await api.post({action:'mutateTask',taskId:source.id,mutation:{setTeamDone:{team:'process',done:true}}})).status,200);
});

test('API return notes and removal do not modify sending work; old imports do not recreate it', async()=>{
  const api=testApi();const source=toolroomSource();
  await api.post({action:'savePlan',tasks:[source]});
  const childId=toolroom.toolroomReturnId(source.id);
  assert.equal((await api.post({action:'mutateTask',taskId:childId,mutation:{setNotes:{mechanics:'Zawiesić po naprawie'},fields:{done:true}}})).status,200);
  let data=await(await api.get()).json();
  assert.equal(data.tasks[0].notes.mechanics,'Zdjąć formę');assert.equal(data.tasks[0].done,false);
  assert.equal(data.tasks[1].notes.mechanics,'Zawiesić po naprawie');assert.equal(data.tasks[1].done,true);
  await api.post({action:'mutateTask',taskId:childId,mutation:{removeTeams:['mechanics']}});
  await api.post({action:'savePlan',tasks:[{...source,quantity:'3000'}]});
  data=await(await api.get()).json();
  assert.equal(data.tasks.length,2);assert.deepEqual(data.tasks[1].teams,[]);
  assert.equal(data.tasks[1].notes.mechanics,'Zawiesić po naprawie');assert.equal(data.tasks[1].quantity,'3000');
  assert.ok(data.tasks[0].teams.includes('mechanics'));
});

test('API creates return when toolroom work is selected and retains it if original work is removed',async()=>{
  const api=testApi();const source={...toolroomSource(),kinds:[],teams:[]};
  await api.post({action:'savePlan',tasks:[source]});
  await api.post({action:'mutateTask',taskId:source.id,mutation:{addKinds:['forma-narzedziownia'],addTeams:['mechanics','process']}});
  await api.post({action:'mutateTask',taskId:source.id,mutation:{removeTeams:['mechanics']}});
  const data=await(await api.get()).json();
  assert.equal(data.tasks.length,2);assert.deepEqual(data.tasks[0].teams,['process']);
  assert.deepEqual(data.tasks[1].teams,['mechanics']);
});

test('API repeated and simultaneous saves create one return record',async()=>{
  const api=testApi();const source={...toolroomSource(),kinds:[],teams:[]};
  await api.post({action:'savePlan',tasks:[source]});
  const row=api.db.przygotowanie_produkcji_tasks.find(task=>task.task_key===source.id);
  row.kinds=['forma-narzedziownia'];row.teams=['mechanics'];
  await Promise.all([api.post({action:'mutateTask',taskId:source.id,mutation:{setNotes:{mechanics:'Pierwsza'}}}),api.post({action:'mutateTask',taskId:source.id,mutation:{setNotes:{mechanics:'Druga'}}})]);
  for(let i=0;i<3;i++)await api.post({action:'savePlan',tasks:[toolroomSource()]});
  assert.equal(api.db.przygotowanie_produkcji_tasks.filter(task=>task.task_key===toolroom.toolroomReturnId(source.id)).length,1);
});
