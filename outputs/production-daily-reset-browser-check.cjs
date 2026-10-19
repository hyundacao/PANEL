const { chromium } = require('C:/Users/hyund/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const compile = (source, scope = {}) => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, ...scope });
  return exports;
};
const helpers = Object.assign({}, ...['productionTaskLifecycle', 'productionWorkProgress', 'productionWorkComments', 'productionToolroomTasks', 'productionTaskReference', 'productionTeamComments']
  .map(name => compile(readFileSync(path.join(root, 'src/lib/utils', name + '.ts'), 'utf8'))));
const routeSource = readFileSync(path.join(root, 'src/app/api/przygotowanie-produkcji/route.ts'), 'utf8');
const ast = ts.createSourceFile('route.ts', routeSource, ts.ScriptTarget.Latest, true);
const extract = name => {
  const statement = ast.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(ast) === name));
  assert.ok(statement, name);
  return statement.getText(ast);
};
const { apply } = compile(['validWorkKinds', 'validTeams', 'validNoteKeys', 'applyTaskMutation'].map(extract).join('\n') + '\nexport const apply = applyTaskMutation;', helpers);
const date = '2026-10-19';
const tomorrow = '2026-10-20';
const user = { id: 'test-user', name: 'Test', username: 'test', role: 'HEAD_ADMIN', isActive: true, access: { admin: true, warehouses: {} } };
const make = (id, station) => ({ id, station, detail: 'DETAL TESTOWY ' + id, isCurrentPlan: true, planGroup: 'standard',
  highlighted: false, quantity: '1000', norm: '500', material: '', materialType: '', source: '', dryer: '', temperature: '',
  kinds: ['rozruch'], teams: ['process'], notes: {}, teamProgress: {}, done: false });
const completed = (task, team) => ({ ...task, done: true,
  teamProgress: helpers.setProductionTeamCompletion({}, team, true, { completedAt: date + 'T08:00:00Z', completedBy: 'Test' }),
  notes: helpers.appendProductionWorkEvent(task.notes, { id: task.id + ':first', team, kinds: task.kinds, completedAt: date + 'T08:00:00Z', completedBy: 'Test' }) });

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const [label, viewport, mobile] of [['desktop', { width: 1700, height: 1100 }, false], ['mobile', { width: 390, height: 844 }, true]]) {
      const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block', timezoneId: 'Europe/Warsaw' });
      const page = await context.newPage();
      const errors = [];
      const requests = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      const parent = make('toolroom', 'WTR 49');
      const child = completed(helpers.createToolroomReturnTask(parent), 'mechanics');
      const days = { [date]: [completed(make('kind', 'WTR 20'), 'process'), completed(make('team', 'WTR 3'), 'process'), parent, child] };
      await context.addInitScript(user => localStorage.setItem('apka-ui', JSON.stringify({ state: { user, theme: 'dark', role: user.role,
        activeWarehouse: 'PRZYGOTOWANIE_PRODUKCJI', sidebarCollapsed: true }, version: 0 })), user);
      // All API requests are intercepted, including writes; no production data is touched.
      await context.route('**/api/**', async route => {
        const url = new URL(route.request().url());
        let data = [];
        if (url.pathname === '/api/auth/session') data = user;
        if (url.pathname === '/api/przygotowanie-produkcji') {
          const body = route.request().method() === 'POST' ? route.request().postDataJSON() : null;
          const day = body?.planDate || url.searchParams.get('date') || date;
          if (!days[day]) days[day] = days[date].filter(helpers.shouldCarryProductionTask).map(task => helpers.resetProductionTaskForNewDay(task));
          if (body) {
            requests.push(body);
            assert.equal(body.action, 'mutateTask');
            days[day] = helpers.withToolroomReturnTasks(days[day].map(task => task.id === body.taskId
              ? apply(task, body.mutation.setToolroomWork ? helpers.toolroomWorkMutation(task, body.mutation.setToolroomWork) : body.mutation,
                { completedAt: date + 'T10:00:00Z', completedBy: 'Test' }) : task));
          }
          data = { session: { id: day, session_date: day, file_name: 'Plan testowy.xlsx', plan_sheet: day, updated_at: 'v' + requests.length },
            tasks: days[day], teamComments: helpers.defaultTeamComments(), recurringTasks: [], processEngineerRoster: [], processEngineers: [],
            machineForms: {}, access: { isAdmin: true, teams: helpers.PRODUCTION_TEAMS, materialAccess: 'edit' } };
          if (url.searchParams.has('recentCompleted')) data = { completed: Object.entries(days).flatMap(([planDate, tasks]) => tasks.flatMap(task =>
            helpers.productionWorkEvents(task.notes).filter(event => !event.revertedAt).map(event => ({ ...event, taskId: task.id, station: task.station, detail: task.detail, planDate })))) };
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
      });
      const open = async day => {
        await page.goto('http://127.0.0.1:3000/przygotowanie-produkcji?view=plan&date=' + day, { waitUntil: 'networkidle', timeout: 120000 });
        await page.locator('article').filter({ hasText: 'WTR 20' }).waitFor();
      };
      await open(date);
      const article = station => page.locator('article').filter({ hasText: station });
      const clickAndSave = async locator => {
        const saved = page.waitForResponse(response => response.url().endsWith('/api/przygotowanie-produkcji') && response.request().method() === 'POST');
        await locator.click();
        assert.equal((await saved).status(), 200);
      };
      await clickAndSave(article('WTR 20').getByRole('checkbox', { name: 'Regulacja', exact: true }));
      assert.deepEqual(Array.from(days[date].find(task => task.id === 'kind').kinds), ['regulacja']);
      assert.equal(days[date].find(task => task.id === 'kind').done, false);
      await clickAndSave(article('WTR 3').getByRole('checkbox', { name: 'In\u017cynier procesu', exact: true }));
      assert.equal(requests.at(-1).mutation.requeueTeam, 'process');
      assert.equal(helpers.productionWorkEvents(days[date].find(task => task.id === 'team').notes)[0].revertedAt, undefined);
      await clickAndSave(article('WTR 49').getByRole('checkbox', { name: 'Powr\u00f3t formy z narz\u0119dziowni', exact: true }));
      assert.equal(requests.at(-1).taskId, child.id);
      assert.equal(days[date].find(task => task.id === child.id).done, false);
      assert.equal(helpers.productionWorkEvents(days[date].find(task => task.id === child.id).notes)[0].revertedAt, undefined);
      await open(date);
      assert.equal(await article('WTR 20').getByRole('checkbox', { name: 'Regulacja', exact: true }).isChecked(), true);
      assert.equal(await article('WTR 20').getByRole('checkbox', { name: 'Rozruch', exact: true }).isChecked(), false);
      await page.screenshot({ path: path.join(__dirname, 'production-repeat-' + label + '.png'), fullPage: true });
      await open(tomorrow);
      assert.equal(await page.locator('article input[type=checkbox]:checked').count(), 0);
      assert.equal(days[tomorrow].length, 3);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(__dirname, 'production-new-day-' + label + '.png'), fullPage: true });
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ label, newKind: true, requeueTeam: true, repeatToolroomReturn: true, newDayClean: true, consoleErrors: 0 }));
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
