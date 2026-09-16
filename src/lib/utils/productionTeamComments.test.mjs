import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as comments from './productionTeamComments.ts';
import * as planDates from './productionPlanDate.ts';
import * as workPlan from './productionWorkPlan.ts';
import * as workProgress from './productionWorkProgress.ts';
import * as workComments from './productionWorkComments.ts';
import * as toolroom from './productionToolroomTasks.ts';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const recurringFile = fileURLToPath(new URL('./productionRecurringTasks.ts', import.meta.url));
const recurringModule = new Module(recurringFile);
recurringModule.require = (id) => {
  if (id === './productionTeamComments') return comments;
  return require(id);
};
recurringModule._compile(ts.transpileModule(readFileSync(recurringFile, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, recurringFile);
const recurring = recurringModule.exports;

const { defaultTeamComments, normalizeTeamComments, normalizeTeamComment, validateTeamComment, teamCommentForTask, TEAM_COMMENT_KEY_PREFIX } = comments;

const accessFile = fileURLToPath(new URL('../auth/access.ts', import.meta.url));
const accessModule = new Module(accessFile);
accessModule.require = (id) => {
  if (id === '@/lib/utils/productionTeamComments') return comments;
  if (id === '@/lib/utils/productionWorkProgress') return workProgress;
  return require(id);
};
accessModule._compile(ts.transpileModule(readFileSync(accessFile, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, accessFile);
const authAccess = accessModule.exports;

const usersFile = fileURLToPath(new URL('../supabase/users.ts', import.meta.url));
const usersModule = new Module(usersFile);
usersModule.require = (id) => {
  if (id === '@/lib/auth/access') return authAccess;
  return require(id);
};
usersModule._compile(ts.transpileModule(readFileSync(usersFile, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, usersFile);
const dbUsers = usersModule.exports;

test('preparation module admin is independent from the global account role', () => {
  const preparationAccess = {
    role: 'PODGLAD',
    readOnly: true,
    tabs: ['przygotowanie-produkcji'],
    admin: true,
    preparationTeams: [],
    preparationMaterialAccess: 'none'
  };
  const user = {
    role: 'USER',
    access: { admin: false, warehouses: { PRZYGOTOWANIE_PRODUKCJI: preparationAccess } }
  };
  assert.equal(authAccess.isWarehouseAdmin(user, 'PRZYGOTOWANIE_PRODUKCJI'), true);
  assert.equal(authAccess.canManageProductionPreparation(user), true);
  assert.deepEqual(authAccess.getAdminWarehouses(user), ['PRZYGOTOWANIE_PRODUKCJI']);
  assert.equal(authAccess.hasAnyAdminAccess(user), true);
  assert.deepEqual(authAccess.getProductionPreparationTeams(user), [...comments.PRODUCTION_TEAMS]);
  assert.equal(authAccess.getProductionPreparationMaterialAccess(user), 'edit');
  assert.equal(authAccess.canViewProductionPreparationMaterials(user), true);
  assert.equal(authAccess.canEditProductionPreparationMaterials(user), true);

  preparationAccess.admin = false;
  preparationAccess.preparationMaterialAccess = 'read';
  assert.equal(authAccess.isWarehouseAdmin(user, 'PRZYGOTOWANIE_PRODUKCJI'), false);
  assert.equal(authAccess.canManageProductionPreparation(user), false);
  assert.equal(authAccess.getProductionPreparationMaterialAccess(user), 'read');
  assert.equal(authAccess.canViewProductionPreparationMaterials(user), true);
  assert.equal(authAccess.canEditProductionPreparationMaterials(user), false);
});

test('material access defaults securely and permission groups merge to the highest level', () => {
  const invalid = dbUsers.normalizeAccessForDb({
    admin: false,
    warehouses: {
      PRZYGOTOWANIE_PRODUKCJI: {
        role: 'PODGLAD',
        readOnly: true,
        tabs: ['przygotowanie-produkcji'],
        admin: false,
        preparationTeams: [],
        preparationMaterialAccess: 'owner'
      }
    }
  });
  assert.equal(
    invalid.warehouses.PRZYGOTOWANIE_PRODUKCJI.preparationMaterialAccess,
    'none'
  );

  const preparationAccess = (preparationMaterialAccess) => ({
    admin: false,
    warehouses: {
      PRZYGOTOWANIE_PRODUKCJI: {
        role: 'PODGLAD',
        readOnly: true,
        tabs: ['przygotowanie-produkcji'],
        admin: false,
        preparationTeams: [],
        preparationMaterialAccess
      }
    }
  });
  const mapped = dbUsers.mapDbUser({
    id: 'user-1',
    name: 'Materiałowiec',
    username: 'materialowiec',
    role: 'USER',
    access: preparationAccess('read'),
    is_active: true,
    created_at: '2026-09-11T00:00:00.000Z',
    last_login: null
  }, [{
    id: 'group-1',
    name: 'Edycja materiałów',
    description: null,
    access: preparationAccess('edit'),
    isActive: true,
    createdAt: '2026-09-11T00:00:00.000Z'
  }]);
  assert.equal(
    mapped.access.warehouses.PRZYGOTOWANIE_PRODUKCJI.preparationMaterialAccess,
    'edit'
  );
});

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
  assert.equal(workProgress.canProductionTeamStart(task, 'additional'), true);
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
  task.teamProgress = workProgress.setProductionTeamCompletion(task.teamProgress, 'additional', true);
  assert.equal(workProgress.isProductionTeamDone(task, 'additional'), true);
  assert.equal(workProgress.isProductionTaskDone(task), true);
  task.teamProgress = workProgress.productionTeamProgressForTask({
    ...task,
    teamProgress: workProgress.setProductionTeamCompletion(task.teamProgress, 'technician', false),
    done: false
  });
  assert.equal(workProgress.isProductionTeamDone(task, 'process'), false);
  assert.equal(workProgress.isProductionTeamDone(task, 'graphics'), false);
  assert.equal(workProgress.isProductionTeamDone(task, 'additional'), true);

  const additionalOnly = { teams: ['additional'], kinds: ['inne'], teamProgress: {}, done: false };
  assert.equal(workProgress.canProductionTeamStart(additionalOnly, 'additional'), true);
  assert.equal(workProgress.isProductionTaskDone(additionalOnly), false);
  additionalOnly.teamProgress = workProgress.setProductionTeamCompletion(additionalOnly.teamProgress, 'additional', true);
  assert.equal(workProgress.isProductionTaskDone(additionalOnly), true);

  const legacyMixed = { teams: ['mechanics', 'additional'], kinds: ['inne'], teamProgress: {}, done: true };
  assert.equal(workProgress.isProductionTeamDone(legacyMixed, 'mechanics'), true);
  assert.equal(workProgress.isProductionTeamDone(legacyMixed, 'additional'), false);
  assert.equal(workProgress.isProductionTaskDone(legacyMixed), true);
  const legacyAdditionalOnly = { teams: ['additional'], kinds: ['inne'], teamProgress: {}, done: true };
  assert.equal(workProgress.isProductionTeamDone(legacyAdditionalOnly, 'additional'), true);

  const technicianOnly = { teams: ['technician', 'process'], kinds: ['inne'], teamProgress: {}, done: false };
  assert.deepEqual(workProgress.productionWaitingTeams(technicianOnly, 'process'), ['technician']);
  technicianOnly.teamProgress = workProgress.setProductionTeamCompletion(technicianOnly.teamProgress, 'technician', true);
  assert.equal(workProgress.canProductionTeamStart(technicianOnly, 'process'), true);
  assert.equal(workProgress.canProductionTeamStart({ teams: ['process'], kinds: ['inne'], teamProgress: {} }, 'process'), true);
  assert.equal(workProgress.canProductionTeamStart({ ...task, kinds: ['anulowane'] }, 'process'), false);
});

test('dispatcher material stage unlocks process before packaging and station are ready', () => {
  const task = { teams: ['mechanics', 'distribution', 'technician', 'process', 'graphics'], kinds: ['zmiana-formy'], teamProgress: {}, done: false };
  task.teamProgress = workProgress.setProductionTeamCompletion(task.teamProgress, 'mechanics', true);
  task.teamProgress = workProgress.setProductionTeamCompletion(task.teamProgress, 'technician', true);
  assert.deepEqual(workProgress.productionWaitingTeams(task, 'process'), ['distribution']);

  task.teamProgress = workProgress.setProductionDistributionStageCompletion(task.teamProgress, 'materials', true);
  assert.equal(workProgress.isProductionDistributionStageDone(task, 'materials'), true);
  assert.equal(workProgress.isProductionDistributionStageDone(task, 'station'), false);
  assert.equal(workProgress.isProductionTeamDone(task, 'distribution'), false);
  assert.equal(workProgress.canProductionTeamStart(task, 'process'), true);
  assert.equal(workProgress.canProductionTeamStart(task, 'graphics'), false);

  task.teamProgress = workProgress.setProductionTeamCompletion(task.teamProgress, 'process', true);
  assert.equal(workProgress.isProductionTaskDone(task), false);
  task.teamProgress = workProgress.setProductionDistributionStageCompletion(task.teamProgress, 'station', true);
  assert.equal(workProgress.isProductionTeamDone(task, 'distribution'), true);
  assert.equal(workProgress.canProductionTeamStart(task, 'graphics'), true);

  task.teamProgress = workProgress.productionTeamProgressForTask({
    ...task,
    teamProgress: workProgress.setProductionDistributionStageCompletion(task.teamProgress, 'materials', false),
    done: false
  });
  assert.equal(workProgress.isProductionTeamDone(task, 'distribution'), false);
  assert.equal(workProgress.isProductionDistributionStageDone(task, 'station'), true);
  assert.equal(workProgress.isProductionTeamDone(task, 'process'), false);
  assert.deepEqual(workProgress.productionWaitingTeams(task, 'process'), ['distribution']);

  const legacy = { teams: ['distribution', 'process'], kinds: ['inne'], teamProgress: {
    distribution: { completedAt: '2026-09-16T08:00:00.000Z', completedBy: 'Rozdzielca' }
  }, done: false };
  assert.equal(workProgress.isProductionDistributionStageDone(legacy, 'materials'), true);
  assert.equal(workProgress.isProductionDistributionStageDone(legacy, 'station'), true);
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
  const state = {
    user:{name:'Test'},
    isAdmin:true,
    preparationTeams:[...comments.PRODUCTION_TEAMS],
    materialAccess:'none',
    allowed:true,
    failWrite:false,
    writeCount:0
  };
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
      if(this.mode!=='select')state.writeCount+=1;
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
    '@/lib/auth/access':{
      canSeeTab:()=>state.allowed,
      getProductionPreparationTeams:()=>state.isAdmin?[...comments.PRODUCTION_TEAMS]:[...state.preparationTeams],
      getProductionPreparationMaterialAccess:()=>state.isAdmin?'edit':state.materialAccess,
      canManageProductionPreparation:()=>Boolean(state.user&&state.isAdmin),
      canEditProductionPreparationMaterials:()=>Boolean(state.user)&&(state.isAdmin||state.materialAccess==='edit'),
      canCompleteProductionPreparationTeam:(_user,team)=>Boolean(state.user)&&workProgress.isProductionCompletableTeam(team)&&(state.isAdmin||state.preparationTeams.includes(team))
    },
    '@/lib/auth/session':{getAuthenticatedUser:async()=>({user:state.user,code:'UNAUTHORIZED'})},
    '@/lib/supabase/admin':{supabaseAdmin:{from:table=>new Query(table)}},
    '@/lib/utils/productionPlanDate':planDates,
    '@/lib/utils/productionRecurringTasks':recurring,
    '@/lib/utils/productionTeamComments':comments,
    '@/lib/utils/productionWorkComments':workComments,
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

test('unchanged plan polling skips shared settings until the periodic settings refresh', async () => {
  const api=testApi();
  const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Warsaw'}).format(new Date());
  api.db.przygotowanie_produkcji_sessions.push({id:'daily',session_date:date,updated_at:'version-1'});
  await api.save('process',{enabled:true,text:'Nowa wspólna instrukcja'});
  const fastPoll=await (await api.get('?sync=1&since=version-1%7Cedit')).json();
  assert.equal(fastPoll.unchanged,true);
  assert.equal(fastPoll.teamComments,undefined);
  const settingsPoll=await (await api.get('?sync=1&since=version-1%7Cedit&settings=1')).json();
  assert.equal(settingsPoll.unchanged,true);
  assert.equal(settingsPoll.teamComments.process.text,'Nowa wspólna instrukcja');
});

test('invalid requests and access restrictions never write settings', async () => {
  const api=testApi();
  assert.equal((await api.save('unknown',{enabled:true,text:'tekst'})).status,400);
  assert.equal((await api.save('mechanics',{enabled:true,text:' '})).status,400);
  api.state.isAdmin=false;api.state.preparationTeams=['mechanics'];
  assert.equal((await api.save('mechanics',{enabled:true,text:'tekst'})).status,403);
  api.state.isAdmin=true;api.state.allowed=false;
  assert.equal((await api.save('mechanics',{enabled:true,text:'tekst'})).status,403);
  api.state.allowed=true;api.state.user=null;
  assert.equal((await api.save('mechanics',{enabled:true,text:'tekst'})).status,401);
  assert.equal(api.db.przygotowanie_produkcji_sessions.length,0);
  assert.equal(api.db.przygotowanie_produkcji_tasks.length,0);
});

test('API exposes scoped preparation access and protects history from workers without writes', async () => {
  const api=testApi();
  api.state.isAdmin=false;
  api.state.preparationTeams=['mechanics','additional'];
  const data=await(await api.get()).json();
  assert.deepEqual(data.access,{isAdmin:false,teams:['mechanics','additional'],materialAccess:'none'});

  const writesBefore=api.state.writeCount;
  const denied=await api.get('?history=1');
  assert.equal(denied.status,403);
  assert.equal((await denied.json()).code,'FORBIDDEN');
  assert.equal(api.state.writeCount,writesBefore);

  api.state.isAdmin=true;
  const adminResponse=await api.get('?history=1');
  assert.equal(adminResponse.status,200);
  const adminData=await adminResponse.json();
  assert.deepEqual(adminData.access,{isAdmin:true,teams:[...comments.PRODUCTION_TEAMS],materialAccess:'edit'});
});

test('material access separates none, read and edit without broadening worker writes', async () => {
  const api=testApi();
  const active={
    ...toolroomSource(),
    id:'material-active',
    kinds:['inne'],
    teams:[],
    notes:{},
    material:'PP GBX',
    materialType:'PP',
    source:'Silos 1',
    dryer:'S-1',
    temperature:'80'
  };
  const inactive={...active,id:'material-inactive',isCurrentPlan:false};
  const planned={...active,id:'material-planned',planGroup:'planned'};
  const header={...active,id:'material-header',station:'ST 1',detail:'PANELE SE'};
  assert.equal((await api.post({action:'savePlan',tasks:[active,inactive,planned,header]})).status,200);

  api.state.isAdmin=false;
  api.state.preparationTeams=[];
  api.state.materialAccess='none';
  let data=await(await api.get()).json();
  assert.equal(data.access.materialAccess,'none');
  assert.deepEqual(
    ['material','materialType','source','dryer','temperature'].map(key=>data.tasks.find(task=>task.id===active.id)[key]),
    ['','','','','']
  );

  const maskedSyncVersion=data.syncVersion;
  api.state.materialAccess='read';
  data=await(await api.get('?sync=1&since='+encodeURIComponent(maskedSyncVersion))).json();
  assert.notEqual(data.unchanged,true);
  assert.equal(data.tasks.find(task=>task.id===active.id).material,'PP GBX');
  const writesBeforeReadAttempt=api.state.writeCount;
  const readDenied=await api.post({
    action:'mutateTask',
    taskId:active.id,
    mutation:{fields:{material:'ABS'}}
  });
  assert.equal(readDenied.status,403);
  assert.equal((await readDenied.json()).code,'MATERIAL_EDIT_FORBIDDEN');
  assert.equal(api.state.writeCount,writesBeforeReadAttempt);

  api.state.materialAccess='edit';
  const edited=await api.post({
    action:'mutateTask',
    taskId:active.id,
    mutation:{fields:{
      material:'ABS NOVODUR',
      materialType:'ABS',
      source:'Silos 2',
      dryer:'S-2',
      temperature:'80'
    }}
  });
  assert.equal(edited.status,200);
  const editedTask=(await edited.json()).task;
  assert.deepEqual(
    ['material','materialType','source','dryer','temperature'].map(key=>editedTask[key]),
    ['ABS NOVODUR','ABS','Silos 2','S-2','80']
  );

  const writesBeforeSmuggling=api.state.writeCount;
  const invalidBodies=[
    {status:400,body:{action:'mutateTask',taskId:active.id,mutation:{fields:{}}}},
    {status:400,body:{action:'mutateTask',taskId:active.id,mutation:{fields:{material:123}}}},
    {status:400,body:{action:'mutateTask',taskId:active.id,mutation:{fields:{material:'X'.repeat(241)}}}},
    {status:400,body:{action:'mutateTask',taskId:active.id,mutation:{fields:{material:'ABS',detail:'Podmiana'}}}},
    {status:403,body:{action:'mutateTask',taskId:active.id,mutation:{fields:{material:'ABS'},addTeams:['mechanics']}}},
    {status:403,body:{action:'mutateTask',taskId:active.id,mutation:{fields:{material:'ABS'},setTeamDone:{team:'mechanics',done:true}}}},
    {status:403,body:{action:'mutateTask',taskId:active.id,mutation:{fields:{material:'ABS'}},tasks:[]}},
    {status:403,body:{action:'savePlan',tasks:[]}},
    {status:403,body:{action:'updateTask',task:{...active,material:'ABS'}}}
  ];
  for(const entry of invalidBodies) {
    assert.equal((await api.post(entry.body)).status,entry.status,JSON.stringify(entry.body));
  }
  assert.equal(api.state.writeCount,writesBeforeSmuggling);

  for(const taskId of [inactive.id,planned.id,header.id]) {
    const response=await api.post({
      action:'mutateTask',
      taskId,
      mutation:{fields:{material:'Niedozwolone'}}
    });
    assert.equal(response.status,409,taskId);
    assert.equal((await response.json()).code,'MATERIAL_TASK_FORBIDDEN');
  }
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
  const end=page.indexOf('\n  if (!preparationAccess)',start);
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
  assert.deepEqual(Object.keys(saved.teamProgress).sort(),['distribution','distributionMaterials','distributionStation','mechanics','process','technician']);
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

test('API stores dispatcher stages independently and protects process readiness', async () => {
  const api=testApi();
  const task={...toolroomSource(),id:'staged-distribution',kinds:['inne'],teams:['distribution','process'],notes:{},teamProgress:{},done:false};
  assert.equal((await api.post({action:'savePlan',tasks:[task]})).status,200);
  api.state.isAdmin=false;
  api.state.preparationTeams=['distribution'];

  const invalid=await api.post({action:'mutateTask',taskId:task.id,mutation:{setDistributionStageDone:{stage:'unknown',done:true}}});
  assert.equal(invalid.status,400);
  const materials=await api.post({action:'mutateTask',taskId:task.id,mutation:{setDistributionStageDone:{stage:'materials',done:true}}});
  assert.equal(materials.status,200);
  let saved=(await materials.json()).task;
  assert.ok(saved.teamProgress.distributionMaterials);
  assert.equal(saved.teamProgress.distributionStation,undefined);
  assert.equal(saved.teamProgress.distribution,undefined);
  assert.equal(workProgress.canProductionTeamStart(saved,'process'),true);

  api.state.preparationTeams=['process'];
  assert.equal((await api.post({action:'mutateTask',taskId:task.id,mutation:{setDistributionStageDone:{stage:'station',done:true}}})).status,403);
  assert.equal((await api.post({action:'mutateTask',taskId:task.id,mutation:{setTeamDone:{team:'process',done:true}}})).status,200);

  api.state.preparationTeams=['distribution'];
  const station=await api.post({action:'mutateTask',taskId:task.id,mutation:{setDistributionStageDone:{stage:'station',done:true}}});
  assert.equal(station.status,200);
  saved=(await station.json()).task;
  assert.equal(saved.done,true);
  assert.ok(saved.teamProgress.distribution);
  assert.ok(saved.teamProgress.distributionStation);

  const reopened=await api.post({action:'mutateTask',taskId:task.id,mutation:{setDistributionStageDone:{stage:'materials',done:false}}});
  assert.equal(reopened.status,200);
  saved=(await reopened.json()).task;
  assert.equal(saved.done,false);
  assert.ok(saved.teamProgress.distributionStation);
  assert.equal(saved.teamProgress.distributionMaterials,undefined);
  assert.equal(saved.teamProgress.process,undefined);
  assert.equal((await (await api.get()).json()).tasks.find(item=>item.id===task.id).teamProgress.distributionStation.completedBy,'Test');

  api.state.isAdmin=true;
  const changed=await api.post({action:'mutateTask',taskId:task.id,mutation:{fields:{detail:'Inny produkt'}}});
  assert.equal(changed.status,200);
  saved=(await changed.json()).task;
  assert.equal(saved.teamProgress.distributionStation,undefined);
  assert.equal(saved.teamProgress.distributionMaterials,undefined);
});

test('recurring task definitions validate days, groups and matching dates', () => {
  const valid=[{id:'kontrola-srodowa',title:'Sprawdzić stan suszarek',weekdays:[3],teams:['distribution','technician'],active:true}];
  assert.equal(recurring.validateRecurringTasks(valid),null);
  assert.equal(recurring.isoWeekdayForDate('2026-09-16'),3);
  assert.equal(recurring.recurringTasksForDate(valid,'2026-09-16').length,1);
  assert.equal(recurring.recurringTasksForDate(valid,'2026-09-17').length,0);
  assert.match(recurring.validateRecurringTasks([{...valid[0],weekdays:[]}]),/dzień tygodnia/);
  assert.match(recurring.validateRecurringTasks([{...valid[0],teams:[]}]),/grupę/);
});

test('recurring settings materialize exactly one normal task for the current day', async () => {
  const api=testApi();
  const planDate=planDates.getWarsawProductionPlanDate();
  const weekday=recurring.isoWeekdayForDate(planDate);
  assert.ok(weekday);
  const definition={
    id:'cotygodniowa-kontrola',
    title:'Sprawdzić poziom oleju w wtryskarkach',
    weekdays:[weekday],
    teams:['distribution','technician'],
    active:true
  };

  const savedResponse=await api.post({action:'saveRecurringTasks',planDate,recurringTasks:[definition]});
  assert.equal(savedResponse.status,200);
  assert.deepEqual((await savedResponse.json()).recurringTasks,[definition]);

  const first=await (await api.get(`?date=${planDate}`)).json();
  const taskId=recurring.recurringTaskInstanceId(definition.id,planDate);
  const generated=first.tasks.filter(task=>task.id===taskId);
  assert.equal(generated.length,1);
  assert.equal(generated[0].station,recurring.RECURRING_TASK_STATION);
  assert.equal(generated[0].detail,definition.title);
  assert.deepEqual(generated[0].teams,definition.teams);
  assert.deepEqual(generated[0].kinds,['inne']);
  assert.equal(generated[0].isCurrentPlan,false);
  assert.deepEqual(first.recurringTasks,[definition]);

  await api.get(`?date=${planDate}`);
  assert.equal(api.db.przygotowanie_produkcji_tasks.filter(row=>row.task_key===taskId).length,1);
});

test('editing a completed recurring task reopens it and marks the added content', async () => {
  const api=testApi();
  const planDate=planDates.getWarsawProductionPlanDate();
  const definition={
    id:'cotygodniowe-czyszczenie',
    title:'Czyszczenie',
    weekdays:[recurring.isoWeekdayForDate(planDate)],
    teams:['distribution'],
    active:true
  };
  await api.post({action:'saveRecurringTasks',planDate,recurringTasks:[definition]});
  const taskId=recurring.recurringTaskInstanceId(definition.id,planDate);
  assert.equal((await api.post({action:'mutateTask',taskId,mutation:{setTeamDone:{team:'distribution',done:true}}})).status,200);

  const title='Czyszczenie i podstawić pojemnik pod maszynę';
  assert.equal((await api.post({
    action:'saveRecurringTasks',
    planDate,
    recurringTasks:[{...definition,title}]
  })).status,200);
  const changed=(await(await api.get(`?date=${planDate}`)).json()).tasks.find(task=>task.id===taskId);
  assert.equal(changed.detail,title);
  assert.equal(changed.done,false);
  assert.equal(changed.teamProgress.distribution,undefined);
  assert.deepEqual(workProgress.productionReopenedDetailDiff(changed.notes,'distribution',changed.detail),{
    unchanged:'Czyszczenie',
    changed:' i podstawić pojemnik pod maszynę',
    wasChanged:true
  });

  const completed=await api.post({action:'mutateTask',taskId,mutation:{setTeamDone:{team:'distribution',done:true}}});
  assert.equal(completed.status,200);
  assert.equal(workProgress.productionReopenedDetailDiff((await completed.json()).task.notes,'distribution',title),null);
});

test('editing a completed team note reopens the task and marks only the added text', async () => {
  const api=testApi();
  const task={
    ...toolroomSource(),
    id:'reopened-note',
    kinds:['inne'],
    teams:['distribution'],
    notes:{distribution:'Czyszczenie'},
    teamProgress:{},
    done:false
  };
  assert.equal((await api.post({action:'savePlan',tasks:[task]})).status,200);
  assert.equal((await api.post({action:'mutateTask',taskId:task.id,mutation:{setTeamDone:{team:'distribution',done:true}}})).status,200);

  const changedResponse=await api.post({
    action:'mutateTask',
    taskId:task.id,
    mutation:{setNotes:{distribution:'Czyszczenie i podstawić pojemnik pod maszynę'}}
  });
  assert.equal(changedResponse.status,200);
  const changed=(await changedResponse.json()).task;
  assert.equal(changed.done,false);
  assert.equal(changed.teamProgress.distribution,undefined);
  assert.deepEqual(workProgress.productionReopenedNoteDiff(changed.notes,'distribution'),{
    unchanged:'Czyszczenie',
    changed:' i podstawić pojemnik pod maszynę',
    wasChanged:true
  });

  const completedResponse=await api.post({
    action:'mutateTask',
    taskId:task.id,
    mutation:{setTeamDone:{team:'distribution',done:true}}
  });
  assert.equal(completedResponse.status,200);
  const completed=(await completedResponse.json()).task;
  assert.ok(completed.teamProgress.distribution);
  assert.equal(workProgress.productionReopenedNoteDiff(completed.notes,'distribution'),null);
});

test('API rejects invalid or unassigned department confirmations', async () => {
  const api=testApi();
  const task={...toolroomSource(),id:'progress-invalid',kinds:['inne'],teams:['technician'],notes:{},teamProgress:{},done:false};
  await api.post({action:'savePlan',tasks:[task]});
  assert.equal((await api.post({action:'mutateTask',taskId:task.id,mutation:{setTeamDone:{team:'technician',done:'yes'}}})).status,400);
  assert.equal((await api.post({action:'mutateTask',taskId:task.id,mutation:{setTeamDone:{team:'process',done:true}}})).status,409);
  const unassignedAdditional=await api.post({action:'mutateTask',taskId:task.id,mutation:{setTeamDone:{team:'additional',done:true}}});
  assert.equal(unassignedAdditional.status,409);
  assert.equal((await unassignedAdditional.json()).code,'TEAM_NOT_ASSIGNED');
});

test('worker can only toggle completion for an allowed assigned section', async () => {
  const api=testApi();
  const task={
    ...toolroomSource(),
    id:'worker-scope',
    kinds:['inne'],
    teams:['mechanics','process','additional'],
    notes:{mechanics:'Praca mechanika',process:'Praca procesu',additional:'Informacja'},
    teamProgress:{},
    done:false
  };
  assert.equal((await api.post({action:'savePlan',tasks:[task]})).status,200);

  api.state.isAdmin=false;
  api.state.preparationTeams=['mechanics','additional'];
  const writesBeforeDenied=api.state.writeCount;
  const forbiddenBodies=[
    {action:'savePlan',tasks:[]},
    {action:'updateTask',task:{...task,detail:'Niedozwolona zmiana'}},
    {action:'saveProcessEngineers',processEngineerRoster:[]},
    {action:'saveRecurringTasks',recurringTasks:[],planDate:planDates.getWarsawProductionPlanDate()},
    {action:'saveTeamComment',team:'mechanics',comment:{enabled:true,text:'Niedozwolony komentarz',showQuantity:false}},
    {action:'deleteHistoryDay',planDate:'2026-09-01'},
    {action:'mutateTask',taskId:task.id,mutation:{fields:{detail:'Niedozwolona zmiana'}}},
    {action:'mutateTask',taskId:task.id,mutation:{setTeamDone:{team:'mechanics',done:true},fields:{detail:'Niedozwolona zmiana'}}},
    {action:'mutateTask',taskId:task.id,mutation:{setTeamDone:{team:'mechanics',done:true}},tasks:[]}
  ];
  for(const body of forbiddenBodies) {
    const response=await api.post(body);
    assert.equal(response.status,403,JSON.stringify(body));
  }
  const otherTeam=await api.post({action:'mutateTask',taskId:task.id,mutation:{setTeamDone:{team:'process',done:true}}});
  assert.equal(otherTeam.status,403);
  assert.equal((await otherTeam.json()).code,'TEAM_COMPLETION_FORBIDDEN');
  const nestedExtra=await api.post({action:'mutateTask',taskId:task.id,mutation:{setTeamDone:{team:'mechanics',done:true,unexpected:true}}});
  assert.equal(nestedExtra.status,400);
  assert.equal(api.state.writeCount,writesBeforeDenied);
  assert.equal(api.db.przygotowanie_produkcji_tasks.find(row=>row.task_key===task.id).detail,task.detail);

  const additional=await api.post({action:'mutateTask',taskId:task.id,mutation:{setTeamDone:{team:'additional',done:true}}});
  assert.equal(additional.status,200);
  assert.equal((await additional.json()).task.teamProgress.additional.completedBy,'Test');
  const revertedAdditional=await api.post({action:'mutateTask',taskId:task.id,mutation:{setTeamDone:{team:'additional',done:false}}});
  assert.equal(revertedAdditional.status,200);
  assert.equal((await revertedAdditional.json()).task.teamProgress.additional,undefined);

  const allowed=await api.post({action:'mutateTask',taskId:task.id,mutation:{setTeamDone:{team:'mechanics',done:true}}});
  assert.equal(allowed.status,200);
  const allowedTask=(await allowed.json()).task;
  assert.equal(allowedTask.teamProgress.mechanics.completedBy,'Test');
  assert.equal(allowedTask.teamProgress.process,undefined);

  api.state.isAdmin=true;
  assert.equal((await api.post({action:'mutateTask',taskId:task.id,mutation:{setTeamDone:{team:'process',done:true}}})).status,200);
  const saved=(await(await api.get()).json()).tasks.find(item=>item.id===task.id);
  assert.equal(saved.done,true);
  assert.equal(saved.teamProgress.additional,undefined);
});

test('dispatcher work comment is attributed and visible to the process engineer', async () => {
  const api=testApi();
  const task={
    ...toolroomSource(),
    id:'dispatcher-comment',
    kinds:['inne'],
    teams:['distribution','process'],
    notes:{distribution:'Przygotuj suszarkę',process:'Uruchom maszynę'},
    teamProgress:{},
    done:false
  };
  assert.equal((await api.post({action:'savePlan',tasks:[task]})).status,200);
  assert.equal((await api.post({
    action:'mutateTask',
    taskId:task.id,
    mutation:{setTeamDone:{team:'distribution',done:true}}
  })).status,200);

  api.state.isAdmin=false;
  api.state.preparationTeams=['distribution'];
  const response=await api.post({
    action:'mutateTask',
    taskId:task.id,
    mutation:{setWorkComment:{team:'distribution',text:'Suszarka gotowa o 10:35'}}
  });
  assert.equal(response.status,200);
  const updated=(await response.json()).task;
  assert.equal(updated.notes.distribution,'Przygotuj suszarkę');
  const comment=workComments.productionWorkCommentFromNotes(updated.notes,'distribution');
  assert.equal(comment.text,'Suszarka gotowa o 10:35');
  assert.equal(comment.author,'Test');
  assert.ok(Number.isFinite(Date.parse(comment.updatedAt)));
  assert.equal(updated.teamProgress.distribution.completedBy,'Test');

  api.state.preparationTeams=['process'];
  const visible=(await(await api.get()).json()).tasks.find(item=>item.id===task.id);
  assert.equal(workComments.productionWorkCommentFromNotes(visible.notes,'distribution').text,'Suszarka gotowa o 10:35');
  const forbidden=await api.post({
    action:'mutateTask',
    taskId:task.id,
    mutation:{setWorkComment:{team:'distribution',text:'Podszyty wpis'}}
  });
  assert.equal(forbidden.status,403);
  assert.equal((await forbidden.json()).code,'WORK_COMMENT_FORBIDDEN');
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
