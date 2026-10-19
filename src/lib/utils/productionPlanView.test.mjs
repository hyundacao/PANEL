import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as workPlan from './productionWorkPlan.ts';
import * as toolroom from './productionToolroomTasks.ts';
import * as progress from './productionWorkProgress.ts';
import * as lifecycle from './productionTaskLifecycle.ts';
import { matchesProductionPlanStation } from './productionPlanSearch.ts';
import { accessFixtureSource, declaration, findNode, makeTask, pageSource, planFixtureSource, sampleTasks } from './productionPlanView.fixture.mjs';

function compile(source, context = {}) {
  const exports = {};
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React
  } }).outputText;
  vm.runInNewContext(code, { exports, ...workPlan, ...context });
  return exports;
}

const { resolveView } = compile(accessFixtureSource);
const access = (teams = [], isAdmin = false) => ({ isAdmin, teams, materialAccess: 'none' });

test('mechanic can open the production plan without becoming an administrator', () => {
  for (const view of [null, 'plan']) {
    const result = resolveView(access(['mechanics']), view);
    assert.equal(result.activeView, 'plan');
    assert.equal(result.isPreparationAdmin, false);
  }
  assert.equal(resolveView(access(['mechanics']), 'work-plan-technology').activeView, 'work-plan');
  assert.equal(resolveView(access(['mechanics']), 'personal').activeView, 'personal');
  for (const view of ['management', 'history', 'report', 'material']) {
    assert.equal(resolveView(access(['mechanics']), view).activeView, 'work-plan');
  }
});

test('other worker teams keep their existing views; module administrators retain plan editing', () => {
  for (const team of ['process', 'distribution', 'graphics', 'technician', 'additional']) {
    for (const view of [null, 'plan']) {
      assert.equal(resolveView(access([team]), view).activeView, 'work-plan');
      assert.equal(resolveView(access([team]), view).canViewPlan, false);
    }
  }
  assert.equal(resolveView(access()).activeView, 'personal');
  assert.equal(resolveView(access([], true)).activeView, 'plan');
  assert.equal(resolveView(access([], true)).isPreparationAdmin, true);
});

test('URL normalization does not redirect a mechanic away from the plan', () => {
  const ast = ts.createSourceFile('page.tsx', pageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const effect = findNode(ast, node => ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect'
    && node.arguments[0]?.getText(ast).includes('const normalizedExecutorView'));
  assert.ok(effect);
  for (const requestedView of [null, 'plan']) {
    const redirects = [];
    const { normalizeUrl } = compile(`export const normalizeUrl = ${effect.arguments[0].getText(ast)};`, {
      preparationAccess: access(['mechanics']), isPreparationAdmin: false, activeView: 'plan',
      requestedView, workPlanView: 'work-plan-technology', router: { replace: url => redirects.push(url) },
      pathname: '/przygotowanie-produkcji', searchParams: new URLSearchParams(), URLSearchParams
    });
    normalizeUrl();
    assert.deepEqual(redirects, []);
  }
});

test('desktop and mobile navigation expose the plan only to mechanics and module admins', () => {
  for (const path of ['../../components/layout/Sidebar.tsx', '../../app/(main)/layout.tsx']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const icons = { ClipboardList: null, ListTodo: null, ClipboardCheck: null, Layers: null, History: null, FileText: null, Settings2: null };
    const { items } = compile(`${declaration('navItemsPrzygotowanieProdukcji', tree)} export const items = navItemsPrzygotowanieProdukcji;`, icons);
    const plan = items.find(item => item.href === '/przygotowanie-produkcji');
    assert.deepEqual([...plan.preparationTeams], ['mechanics']);
    assert.equal(plan.requiresAdmin, undefined);
    for (const view of ['management', 'report', 'history']) {
      assert.equal(items.find(item => item.href.endsWith(`view=${view}`)).requiresAdmin, true);
    }
    if (path.includes('Sidebar')) {
      const visible = findNode(tree, node => ts.isVariableDeclaration(node) && node.name.getText(tree) === 'visibleItems');
      const filter = visible.initializer.arguments[0].getText(tree);
      const { check } = compile(`export const check = ${filter};`, {
        warehouse: 'PRZYGOTOWANIE_PRODUKCJI', warehouseAdmin: false,
        preparationTeamIds: ['mechanics'], canSeeTab: () => true
      });
      assert.equal(check(plan), true);
    } else {
      const { canShow } = compile(`${declaration('canShowModuleNavItem', tree)} export const canShow = canShowModuleNavItem;`, {
        isWarehouseAdmin: user => user.isAdmin,
        getProductionPreparationTeams: user => user.isAdmin ? ['mechanics'] : user.teams
      });
      assert.equal(canShow(access(['mechanics']), 'PRZYGOTOWANIE_PRODUKCJI', plan), true);
      assert.equal(canShow(access(['distribution']), 'PRZYGOTOWANIE_PRODUKCJI', plan), false);
      assert.equal(canShow(access([], true), 'PRZYGOTOWANIE_PRODUKCJI', plan), true);
    }
  }
});

test('station search accepts common WTR formats, number-only and machine names', () => {
  for (const query of ['WTR 34', 'wtr34', 'WTRY 34', 'Wtr. 034', '34', '  wtr - 34  ']) {
    for (const station of ['WTR 34', 'WTR.034', 'wtr34']) {
      assert.equal(matchesProductionPlanStation(station, query), true, `${station} / ${query}`);
    }
    for (const station of ['WTR 3', 'WTR 134', 'WTR 340', 'ST 2']) {
      assert.equal(matchesProductionPlanStation(station, query), false, `${station} / ${query}`);
    }
  }
  assert.equal(matchesProductionPlanStation('ST 34', 'WTR 34'), false);
  assert.equal(matchesProductionPlanStation('ST 34', '34'), true);
  assert.equal(matchesProductionPlanStation('Linia montażowa 2', 'montaz'), true);
  assert.equal(matchesProductionPlanStation('WTR 34', '---'), false);
  assert.equal(matchesProductionPlanStation('WTR 34', ''), true);
  assert.equal(matchesProductionPlanStation('WTR 34', '   '), true);
});

const element = tag => function FixtureElement({ children, ...props }) {
  delete props.variant;
  return React.createElement(tag, props, children);
};
const icon = () => null;
const { PlanFixture } = compile(planFixtureSource, {
  React, useState: React.useState, useMemo: React.useMemo,
  matchesProductionPlanStation, ...toolroom, ...progress, ...lifecycle,
  cn: (...classes) => classes.filter(Boolean).join(' '),
  Button: element('button'), Card: element('div'), Input: element('input'),
  SelectField: element('select'), Search: icon, X: icon, Upload: icon, Trash2: icon, ChevronDown: icon
});

test('plan highlights completion only on its actual day and never on a cancelled row', () => {
  const task = { ...makeTask('completed', 'WTR 49'), done: true,
    teamProgress: { mechanics: { completedAt: '2026-10-12T08:00:00Z', completedBy: 'Test' } } };
  const render = (selectedPlanDate, value = task) => renderToStaticMarkup(React.createElement(PlanFixture, {
    access: access([], true), requestedView: 'plan', tasks: [value], selectedPlanDate
  }));
  assert.match(render('2026-10-12'), /<article[^>]*border-\[rgba\(34,197,94,0\.65\)\]/);
  assert.doesNotMatch(render('2026-10-13'), /<article[^>]*border-\[rgba\(34,197,94,0\.65\)\]/);
  assert.doesNotMatch(render('2026-10-12', { ...task, kinds: [...task.kinds, 'anulowane'] }),
    /<article[^>]*border-\[rgba\(34,197,94,0\.65\)\]/);
});

test('another product machine confirmation is hidden under the current plan index', () => {
  const markup = renderToStaticMarkup(React.createElement(PlanFixture, {
    access: access([], true), requestedView: 'plan', tasks: [makeTask('new-product', 'WTR 49')],
    machineForms: { 'WTR 49': { detail: 'TRAY HANDLE CLIPPED', stage: 'started', at: '2026-10-11T19:32:10Z' } }
  }));
  assert.doesNotMatch(markup, /Poprzedni potwierdzony detal|Ostatnie potwierdzenie|TRAY HANDLE CLIPPED|11\.10\.2026/);
  assert.doesNotMatch(markup, /rozruch wykonany|rozruch niewykonany|proces potwierdzony/);
  const current = renderToStaticMarkup(React.createElement(PlanFixture, {
    access: access([], true), requestedView: 'plan', tasks: [makeTask('new-product', 'WTR 49')],
    machineForms: { 'WTR 49': { detail: 'Product new-product', stage: 'mounted', at: '2026-10-12T08:00:00Z' } }
  }));
  assert.match(current, /Ostatnie potwierdzenie/);
  assert.match(current, /zawieszenie formy potwierdzone/);
  assert.doesNotMatch(current, /rozruch niewykonany/);
});

test('old TOP SECTION confirmation is not displayed under the WTR 47 MAX index', () => {
  const task = { ...makeTask('max', 'WTR 47'),
    detail: 'MAX BO VG1 PANEL+TH WHITE/LOGO+INSERT (9001909401)', kinds: [], teams: [], notes: {} };
  const markup = renderToStaticMarkup(React.createElement(PlanFixture, {
    access: access([], true), requestedView: 'plan', tasks: [task],
    machineForms: { 'WTR 47': { detail: 'TOP SECTION GS70 TORNADO RED (8001356946)',
      stage: 'mounted', at: '2026-09-29T11:25:24.673Z' } }
  }));
  assert.match(markup, /9001909401/);
  assert.doesNotMatch(markup, /TOP SECTION|8001356946|29\.09\.2026|potwierdzony detal|potwierdzenie/);
  assert.doesNotMatch(markup, /<article[^>]*border-\[rgba\(34,197,94,0\.65\)\]/);
});

const render = props => renderToStaticMarkup(React.createElement(PlanFixture, {
  access: access(['mechanics']), tasks: sampleTasks, initiallyExpanded: ['planned-34'], ...props
}));

test('real plan UI filters current, emergency and planned rows without mutating source data', () => {
  const before = JSON.stringify(sampleTasks);
  const html = render({ initialSearch: 'WTRY34' });
  assert.match(html, /Product current-34/);
  assert.match(html, /Product emergency-34/);
  assert.match(html, /Product planned-34/);
  assert.doesNotMatch(html, /Product current-3<|Product planned-134/);
  assert.match(html, /Pozycje: 3 z 5/);
  assert.equal(JSON.stringify(sampleTasks), before);
  assert.match(render({ initialSearch: 'WTR 999' }), /Brak pozycji dla podanej maszyny/);
  assert.match(render({ initialSearch: '' }), /Pozycje: 5 z 5/);
});

test('Excel source highlighting remains attached to current, completed and planned rows', () => {
  for (const planGroup of ['standard', 'emergency', 'planned']) {
    for (const done of [false, true]) {
      const task = { ...makeTask('highlighted', 'WTR 34', planGroup), highlighted: true, done };
      const html = render({ access: access([], true), tasks: [task], initiallyExpanded: [task.id] });
      assert.equal((html.match(/data-source-highlighted="true"/g) ?? []).length, 1);
      const clear = render({ access: access([], true), tasks: [{ ...task, highlighted: false }], initiallyExpanded: [task.id] });
      assert.doesNotMatch(clear, /data-source-highlighted="true"/);
    }
  }
});

test('mechanic plan UI allows only two toolroom work choices while other fields stay protected', () => {
  const html = render();
  assert.match(html, /Powrót formy z narzędziowni/);
  assert.doesNotMatch(html, /Wybierz plik Excel|Kasuj przypisania/);
  const checkboxes = html.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [];
  assert.equal(checkboxes.filter(input => !input.includes('disabled')).length, 8);
  assert.equal((html.match(/<textarea[^>]*readOnly=""/g) ?? []).length, 3);
  assert.equal((html.match(/<input[^>]*readOnly=""/g) ?? []).length, 4);
  assert.match(html, /<button aria-expanded="true"/);
  assert.match(html, /id="production-plan-station-search"/);
});

test('admin search sits between import and discussion; all admin controls remain enabled', () => {
  const html = render({ access: access([], true) });
  assert.ok(html.indexOf('Wybierz plik Excel') < html.indexOf('production-plan-station-search'));
  assert.ok(html.indexOf('production-plan-station-search') < html.indexOf('Pozycje do omówienia'));
  assert.match(html, /Kasuj przypisania/);
  assert.doesNotMatch(html, /<fieldset disabled|Tylko podgląd/);
});

const checkedTeam = (html, label) => new RegExp(`<input[^>]*checked=""[^>]*>${label}</label>`).test(html);

for (const group of ['standard', 'planned']) {
  test(`saved toolroom return assigns only the mechanic in the ${group} plan row`, () => {
    const parent = { ...makeTask('unassigned', 'WTR 34', group), kinds: [], teams: [], notes: {} };
    const child = toolroom.createToolroomReturnTask(parent);
    child.notes.mechanics = 'Return instruction';
    const tasks = [parent, child];
    const before = JSON.stringify(tasks);
    for (const isAdmin of [false, true]) {
      const html = render({ access: access(['mechanics'], isAdmin), tasks, initiallyExpanded: [parent.id] });
      assert.equal(checkedTeam(html, 'Mechanik'), true);
      assert.equal(checkedTeam(html, 'Inżynier procesu'), false);
      assert.equal(checkedTeam(html, 'Rozdzielca'), false);
      assert.match(html, /Uwagi dla: Mechanik.*Powrót formy z narzędziowni/);
      assert.match(html, /value="Return instruction"/);
      assert.doesNotMatch(html, /Uwagi dla: Inżynier procesu.*Powrót formy z narzędziowni/);
      if (group === 'planned') assert.match(html, /Przypisano/);
    }
    assert.equal(JSON.stringify(tasks), before);
  });

  test(`inactive returns do not add roles to the ${group} plan row or remove parent assignments`, () => {
    const parent = { ...makeTask('source', 'WTR 34', group), teams: ['graphics'] };
    const child = toolroom.createToolroomReturnTask(parent);
    for (const kinds of [[], ['powrot-formy-narzedziownia', 'anulowane']]) {
      const html = render({ tasks: [parent, { ...child, kinds }], initiallyExpanded: [parent.id] });
      assert.equal(checkedTeam(html, 'Mechanik'), false);
      assert.equal(checkedTeam(html, 'Inżynier procesu'), false);
      assert.equal(checkedTeam(html, 'Grafik'), true);
    }
  });
}

test('plan role edits target linked return work without creating duplicate parent assignments', () => {
  const parent = { ...makeTask('source', 'WTR 34'), kinds: [], teams: [] };
  const child = toolroom.createToolroomReturnTask(parent);
  const requests = [];
  const tasks = [parent, child];
  const { toggle } = compile(`${['planTaskWorkItems', 'togglePlanTeam'].map(name => declaration(name)).join('\n')}
    export const toggle = togglePlanTeam;`, {
    ...toolroom, ...progress, tasks, isPreparationAdmin: true,
    toggleTeam: (task, team) => requests.push([task.id, team])
  });
  toggle(parent, 'mechanics');
  assert.deepEqual(requests.splice(0), [[child.id, 'mechanics']]);
  child.teams = [];
  toggle(parent, 'mechanics');
  assert.deepEqual(requests.splice(0), [[child.id, 'mechanics']]);
  parent.teams = ['process'];
  parent.kinds = ['rozruch'];
  toggle(parent, 'process');
  assert.deepEqual(requests.splice(0), [[parent.id, 'process']]);
  toggle(parent, 'distribution');
  assert.deepEqual(requests.splice(0), [[parent.id, 'distribution']]);
});

test('return work remains selected independently of a manually removed mechanic assignment', () => {
  const parent = makeTask('source', 'WTR 34');
  const child = { ...toolroom.createToolroomReturnTask(parent), teams: [] };
  const { selected } = compile(`${declaration('isWorkKindSelected')} export const selected = isWorkKindSelected;`, {
    ...toolroom, ...progress, ...lifecycle, tasks: [parent, child]
  });
  assert.equal(selected(parent, 'powrot-formy-narzedziownia'), true);
});

test('plan checkbox requeues a completed department without calling the undo action', () => {
  for (const team of ['process', 'distribution', 'mechanics']) {
    const task = { ...makeTask('repeat', 'WTR 34'), kinds: ['regulacja'], teams: [team], done: true,
      teamProgress: progress.setProductionTeamCompletion({}, team, true, { completedAt: '2026-10-19T08:00:00Z', completedBy: 'Test' }),
      notes: { __workEvents: JSON.stringify([{ id: 'first', team, kinds: ['regulacja'], completedAt: '2026-10-19T08:00:00Z', completedBy: 'Test' }]) } };
    const requests = [];
    let optimistic;
    const { toggle } = compile(`${['planTaskWorkItems', 'togglePlanTeam'].map(name => declaration(name)).join('\n')}
      export const toggle = togglePlanTeam;`, {
      ...toolroom, ...progress, tasks: [task], isPreparationAdmin: true,
      mutateTask: (id, mutation, update) => { requests.push({ id, mutation }); optimistic = update(task); },
      toggleTeamDone: () => assert.fail('This would undo the previous completion'),
      toggleTeam: () => assert.fail('This would remove the department')
    });
    toggle(task, team);
    assert.equal(JSON.stringify(requests), JSON.stringify([{ id: task.id, mutation: { requeueTeam: team } }]));
    assert.equal(progress.isProductionTeamDone(optimistic, team), false);
    assert.equal(lifecycle.productionWorkEvents(optimistic.notes).length, 1);
    assert.equal(lifecycle.productionWorkEvents(optimistic.notes)[0].revertedAt, undefined);
  }
});
