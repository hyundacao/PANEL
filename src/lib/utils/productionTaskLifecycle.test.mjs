import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendProductionWorkEvent,
  canRetireProductionSession,
  productionKindOwner,
  productionSummaryFromTasks,
  productionTaskDoneOnDate,
  productionTaskDueDate,
  productionWorkEvents,
  recentProductionDates,
  revertProductionWorkEvent,
  shouldCarryProductionTask,
  summarizeProductionDay
} from './productionTaskLifecycle.ts';

test('only active plan and open additional work carry into the new day', () => {
  const base = { id: 'plan-1', station: 'WTR 10', isCurrentPlan: true, kinds: ['zmiana-formy'], teams: ['mechanics'] };
  assert.equal(shouldCarryProductionTask(base), true);
  assert.equal(shouldCarryProductionTask({ ...base, kinds: ['anulowane'] }), false);
  assert.equal(shouldCarryProductionTask({ ...base, id: 'zadanie-cykliczne:x:2026-09-27', station: 'ZADANIE CYKLICZNE' }), false);
  assert.equal(shouldCarryProductionTask({ ...base, id: 'manual', station: 'ZADANIE DODATKOWE', isCurrentPlan: false }), true);
  assert.equal(shouldCarryProductionTask({ ...base, id: 'manual', station: 'ZADANIE DODATKOWE', isCurrentPlan: false, teams: [] }), false);
  assert.equal(shouldCarryProductionTask({ ...base, id: 'toolroom-return:plan-1', isCurrentPlan: false }), true);
  assert.equal(shouldCarryProductionTask({ ...base, id: 'plan-1::work-event:x' }), false);
});

test('a Saturday due date is stored separately from the plan day', () => {
  assert.equal(productionTaskDueDate({ __dueDate: '2026-10-03' }), '2026-10-03');
  assert.equal(productionTaskDueDate({ __dueDate: 'later' }), '');
});

test('completion events survive requeue and preserve each occurrence', () => {
  const first = { id: 'a:mechanics:1', team: 'mechanics', kinds: ['zmiana-formy'], completedAt: '2026-09-27T06:00:00Z', completedBy: 'A' };
  const second = { ...first, id: 'a:mechanics:2', completedAt: '2026-09-27T13:00:00Z', completedBy: 'B' };
  const notes = appendProductionWorkEvent(appendProductionWorkEvent({}, first), second);
  assert.deepEqual(productionWorkEvents(notes), [first, second]);
  assert.equal(productionKindOwner('zmiana-formy'), 'mechanics');
  assert.equal(productionKindOwner('rozruch'), 'process');
  const undone = revertProductionWorkEvent(notes, 'mechanics', '2026-09-27T14:00:00Z');
  assert.equal(productionWorkEvents(undone)[0].revertedAt, undefined);
  assert.equal(productionWorkEvents(undone)[1].revertedAt, '2026-09-27T14:00:00Z');
});

test('six production dates include Saturday when work exists', () => {
  assert.deepEqual(recentProductionDates(['2026-09-18', '2026-09-19', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25']),
    ['2026-09-25', '2026-09-24', '2026-09-23', '2026-09-22', '2026-09-21', '2026-09-19']);
});

test('old history can be replaced by numeric summary including missed recurring work', () => {
  const tasks = [
    { station: 'WTR 10', kinds: ['zmiana-formy'], teams: ['mechanics', 'distribution'], notes: { distribution: 'Przygotować stanowisko' }, done: true },
    { station: 'ZADANIE CYKLICZNE', kinds: ['inne'], teams: ['mechanics'], notes: {}, done: false }
  ];
  const summary = summarizeProductionDay(tasks, '2026-09-27');
  assert.equal(summary.assignments, 3);
  assert.equal(summary.kinds['zmiana-formy'].done, 1);
  assert.equal(summary.kinds['przygotowanie-stanowiska'].total, 1);
  assert.equal(summary.missedRecurring, 1);
  assert.deepEqual(productionSummaryFromTasks([{ __productionSummary: summary }]), summary);
});

test('completion carried into tomorrow is counted only on the day it happened', () => {
  const task = {
    station: 'WTR 10', kinds: ['zmiana-formy'], teams: ['mechanics'], notes: {}, done: true,
    teamProgress: { mechanics: { completedAt: '2026-09-27T10:00:00.000Z' } }
  };
  assert.equal(productionTaskDoneOnDate(task, '2026-09-27'), true);
  assert.equal(productionTaskDoneOnDate(task, '2026-09-28'), false);
  assert.equal(summarizeProductionDay([task], '2026-09-28').kinds['zmiana-formy'].done, 0);
  const legacy = { ...task, teamProgress: {}, notes: { __legacyCompletionDay: '2026-09-27' } };
  assert.equal(productionTaskDoneOnDate(legacy, '2026-09-28'), false);
});

test('old session is retired only when the report and carried state are preserved', () => {
  const summary = { ...summarizeProductionDay([], '2026-09-18'), sourceDigest: 'a'.repeat(64) };
  const machine = { id: '__machine_state__:wtr10', station: 'WTR 10', isCurrentPlan: false,
    kinds: [], teams: [], notes: { __machineAt: '2026-09-18T10:00:00Z' }, done: false };
  const manual = { id: 'manual-1', station: 'ZADANIE DODATKOWE', isCurrentPlan: false,
    kinds: ['inne'], teams: ['mechanics'], notes: {}, done: false };
  const parent = { id: 'plan-1', station: 'WTR 10', isCurrentPlan: true,
    kinds: ['forma-narzedziownia'], teams: ['mechanics'], notes: {}, done: false };
  const child = { ...parent, id: 'toolroom-return:plan-1', isCurrentPlan: false };
  const old = [machine, manual, parent, child];
  const active = [{ ...machine, notes: { __machineAt: '2026-09-27T10:00:00Z' } }, manual, parent, child];
  assert.equal(canRetireProductionSession('2026-09-18', '2026-09-27', summary, old, active), true);
  assert.equal(canRetireProductionSession('2026-09-27', '2026-09-27', summary, old, active), false);
  assert.equal(canRetireProductionSession('2026-09-18', '2026-09-27', { ...summary, sourceDigest: undefined }, old, active), false);
  assert.equal(canRetireProductionSession('2026-09-18', '2026-09-27', { ...summary, assignments: 2 }, old, active), false);
  assert.equal(canRetireProductionSession('2026-09-18', '2026-09-27', summary, old, active.slice(1)), false);
  assert.equal(canRetireProductionSession('2026-09-18', '2026-09-27', summary, old, [machine, parent, child]), false);
  assert.equal(canRetireProductionSession('2026-09-18', '2026-09-27', summary, old, [machine, manual, parent]), false);
  assert.equal(canRetireProductionSession('2026-09-18', '2026-09-27', summary, old,
    [{ ...machine, notes: { __machineAt: '2026-09-17T10:00:00Z' } }, manual, parent, child]), false);
});
