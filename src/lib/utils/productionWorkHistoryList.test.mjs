import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as lifecycle from './productionTaskLifecycle.ts';
import * as progress from './productionWorkProgress.ts';
import * as dates from './productionPlanDate.ts';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { renderToStaticMarkup } = require('react-dom/server');
const cn = (...values) => require('tailwind-merge').twMerge(require('clsx').clsx(values));
const file = fileURLToPath(new URL('../../app/(main)/przygotowanie-produkcji/page.tsx', import.meta.url));
const page = readFileSync(file, 'utf8');
const block = (start, end) => page.slice(page.indexOf(start), page.indexOf(end, page.indexOf(start)));
const compile = (source, jsx = false) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    ...(jsx ? { jsx: ts.JsxEmit.ReactJSX } : {}) }
}).outputText;
const ui = name => {
  const path = fileURLToPath(new URL(`../../components/ui/${name}.tsx`, import.meta.url));
  const mod = new Module(path);
  mod.require = id => id === '@/lib/utils/cn' ? { cn } : require(id);
  mod._compile(compile(readFileSync(path, 'utf8'), true), path);
  return mod.exports[name];
};
const component = new Module(file);
component.require = id => id === 'dependencies'
  ? { ...require('lucide-react'), ...progress, cn, Card: ui('Card'), Badge: ui('Badge'), Button: ui('Button') }
  : require(id);
component._compile(compile(`
  const { cn, Card, Badge, Button, Wrench, Check, RotateCcw, productionReopenedDetailDiff } = require('dependencies');
  ${block('const TaskTitle =', 'const TaskWorkSummary =')}
  ${block('const teamOptions:', 'const normalizePreparationAccess')}
  ${block('const historyCompletionFormatter =', 'const WorkHistoryDashboard =')}
  export { WorkHistoryBoard, TaskTitle };
`, true), file);
const mapping = new Module(file);
mapping.require = () => ({ ...lifecycle, ...progress, ...dates, RECURRING_TASK_STATION: 'ZADANIE CYKLICZNE' });
mapping._compile(compile(`
  const { productionWorkEvents, PRODUCTION_LEGACY_COMPLETION_DAY_NOTE, isProductionTeamDone,
    productionTeamCompletion, isProductionDistributionStageDone, getWarsawProductionPlanDate,
    RECURRING_TASK_STATION } = require('dependencies');
  ${block('const teamOptions:', 'const normalizePreparationAccess')}
  ${block('const workKinds:', 'const reportKinds:')}
  ${block('const kindsForTeam =', 'const planGroupLabel:')}
  export ${block('const workHistoryRowsForDay =', 'const historyCompletionFormatter =')}
`), file);

const rowsForDay = mapping.exports.workHistoryRowsForDay;
const task = (extra = {}) => ({ id: 'task', station: 'WTR 10', detail: 'TOP SECTION (8001356944)',
  kinds: ['zmiana-formy', 'rozruch'], teams: ['mechanics'], notes: {}, teamProgress: {}, done: false, ...extra });
const day = (tasks, date = '2026-09-28') => ({ plan_date: date, tasks });

test('completed history reuses the pending queue columns and green cards with author and Warsaw time', () => {
  const rows = [{ id: 'one', station: 'WTR 10', detail: 'Product', team: 'Mechanik', work: 'Zmiana formy',
    status: 'done', completedBy: 'kowalski', completedAt: '2026-09-28T09:14:36Z' }];
  const html = renderToStaticMarkup(component.exports.WorkHistoryBoard({ rows }));
  for (const label of ['production-queues', 'production-queue-task', 'outlined-task-list', 'Mechanik', 'Wykonał: kowalski', '11:14:36']) {
    assert.ok(html.includes(label), label);
  }
  assert.ok(html.includes('data-team-done="true"'));
  assert.match(html, /datetime="2026-09-28T09:14:36Z"/i);
  assert.equal(html.includes('role="table"'), false);
  assert.equal(html.includes('role="columnheader"'), false);
  assert.ok(page.includes('completedHistoryDays.map(day =>'));
  assert.ok(page.includes('days.get(item.planDate)'));
});

test('each team has its own history column and completion sorting does not change source records', () => {
  const rows = [
    { id: 'early', team: 'Mechanik', station: 'WTR 1', detail: 'EARLY', work: 'Zmiana formy', status: 'done', completedAt: '2026-09-28T08:00:00Z', completedBy: 'A' },
    { id: 'process', team: 'Inżynier procesu', station: 'WTR 2', detail: 'PROCESS', work: 'Rozruch', status: 'done', completedAt: '2026-09-28T09:00:00Z', completedBy: 'B' },
    { id: 'late', team: 'Mechanik', station: 'WTR 3', detail: 'LATEST', work: 'Powrót formy', status: 'done', completedAt: '2026-09-28T10:00:00Z', completedBy: 'C' }
  ];
  const before = structuredClone(rows);
  const teams = [{ id: 'mechanics', label: 'Mechanik', color: '#ff7900' }, { id: 'process', label: 'Inżynier procesu', color: '#2fb5f0' }];
  const html = renderToStaticMarkup(component.exports.WorkHistoryBoard({ rows, teams }));
  assert.equal((html.match(/role="list"/g) ?? []).length, 2);
  assert.ok(html.includes('aria-label="Historia prac: Mechanik"'));
  assert.ok(html.includes('aria-label="Historia prac: Inżynier procesu"'));
  assert.ok(html.indexOf('LATEST') < html.indexOf('EARLY'));
  assert.ok(html.indexOf('EARLY') < html.indexOf('PROCESS'));
  assert.deepEqual(rows, before);
});

test('task headings are one pixel larger and bold in normal, compact and completed cards', () => {
  const props = { task: task(), team: 'mechanics' };
  for (const [compact, size] of [[false, '12px'], [true, '11px']]) {
    const html = renderToStaticMarkup(component.exports.TaskTitle({ ...props, compact }));
    assert.ok(html.includes(`text-[${size}]`));
    assert.ok(html.includes('font-bold'));
    assert.ok(html.includes('break-words'));
    assert.ok(html.includes('text-[var(--brand)]'));
  }
  const history = renderToStaticMarkup(component.exports.WorkHistoryBoard({ rows: [{
    id: 'one', station: 'WTR 10', detail: 'Product', team: 'Mechanik', work: 'Zmiana formy', status: 'done'
  }] }));
  assert.match(history, /production-task-title[^\"]*text-\[12px\][^\"]*font-bold/);
});

test('legacy unknown author and timestamp are explicit rather than fabricated', () => {
  const html = renderToStaticMarkup(component.exports.WorkHistoryBoard({
    rows: [{ id: 'old', station: 'WTR 1', detail: 'Old product', team: 'Mechanik', status: 'done', work: 'Praca', completedAt: 'invalid' }]
  }));
  assert.ok(html.includes('Nieznany użytkownik'));
  assert.ok(html.includes('Brak zapisu czasu'));
  assert.equal(html.includes('Invalid Date'), false);
});

test('completed cards offer an undo arrow only for restorable authorized work and disable it while saving', () => {
  const row = { id: 'one', station: 'WTR 10', detail: 'Product', team: 'Mechanik', work: 'Zmiana formy',
    status: 'done', completedBy: 'A', completedAt: '2026-09-28T10:00:00Z',
    restore: { taskId: 'task', eventId: 'event', sourceDate: '2026-09-28', team: 'mechanics' } };
  const props = { rows: [row], onRestore: () => {}, canRestore: () => true };
  const html = renderToStaticMarkup(component.exports.WorkHistoryBoard(props));
  assert.ok(html.includes('Przywróć zadanie'));
  assert.ok(html.includes('lucide-rotate-ccw'));
  assert.ok(html.indexOf('Wykonał:') < html.indexOf('Przywróć zadanie'));
  assert.ok(!renderToStaticMarkup(component.exports.WorkHistoryBoard({ ...props, canRestore: () => false })).includes('Przywróć zadanie'));
  const saving = renderToStaticMarkup(component.exports.WorkHistoryBoard({ ...props, restoringId: row.id }));
  assert.ok(saving.includes('Przywracanie'));
  assert.match(saving, /<button[^>]+disabled/);
  assert.ok(!renderToStaticMarkup(component.exports.WorkHistoryBoard({ ...props, rows: [{ ...row, status: 'open' }] })).includes('Przywróć zadanie'));
});

test('history mapping lists each completion once with only the work belonging to that team', () => {
  const event = { id: 'work:mechanics:one', team: 'mechanics', kinds: ['zmiana-formy', 'rozruch'],
    completedAt: '2026-09-28T10:00:00Z', completedBy: 'Mechanik A' };
  const input = task({ done: true, notes: lifecycle.appendProductionWorkEvent({}, event),
    teamProgress: { mechanics: event } });
  const rows = rowsForDay(day([input]), '2026-09-28');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].completedBy, 'Mechanik A');
  assert.equal(rows[0].completedAt, event.completedAt);
  assert.equal(rows[0].status, 'done');
  assert.equal(rows[0].work, 'Zmiana formy');
  assert.deepEqual(rowsForDay(day([input], '2026-09-29'), '2026-09-29'), []);
});

test('recurring missed work is marked only after its day ends and partial dispatcher work is not done', () => {
  const recurring = task({ id: 'recurring', station: 'ZADANIE CYKLICZNE', kinds: ['inne'], teams: ['technician'] });
  assert.equal(rowsForDay(day([recurring]), '2026-09-29')[0].status, 'missed');
  assert.equal(rowsForDay(day([recurring]), '2026-09-28')[0].status, 'open');
  const dispatcher = task({ id: 'partial', teams: ['distribution'], kinds: ['rozruch'],
    teamProgress: { distributionMaterials: { completedAt: '2026-09-28T10:00:00Z', completedBy: 'A' } } });
  const [partial] = rowsForDay(day([dispatcher]), '2026-09-28');
  assert.equal(partial.status, 'partial');
  assert.equal(partial.completedBy, undefined);
});

test('requeued work keeps earlier valid completions and does not show undone events', () => {
  const event = { id: 'one', team: 'mechanics', kinds: ['zmiana-formy'], completedAt: '2026-09-28T10:00:00Z', completedBy: 'A' };
  const notes = lifecycle.appendProductionWorkEvent(lifecycle.appendProductionWorkEvent({}, event),
    { ...event, id: 'two', completedAt: '2026-09-28T11:00:00Z', revertedAt: '2026-09-28T12:00:00Z' });
  const rows = rowsForDay(day([task({ notes })]), '2026-09-28');
  assert.deepEqual(rows.map(row => row.status), ['done', 'open']);
  assert.equal(rows[0].completedBy, 'A');
});
