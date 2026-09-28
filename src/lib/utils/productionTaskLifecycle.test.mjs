import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendProductionWorkEvent,
  canRetireProductionSession,
  isProductionCompletionVisibleOnDate,
  isRecentProductionHistoryDate,
  mergeProductionCompletedWork,
  productionKindOwner,
  productionHistoryCutoffDate,
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

test('a reverted completion replaces a stale completed entry without removing earlier work', () => {
  const first = { id: 'a:distribution:1', team: 'distribution', kinds: ['inne'], completedAt: '2026-09-27T06:00:00Z', completedBy: 'A', station: 'WTR 10', detail: 'Product', planDate: '2026-09-27' };
  const second = { ...first, id: 'a:distribution:2', completedAt: '2026-09-27T08:00:00Z' };
  const reverted = { ...second, revertedAt: '2026-09-27T09:00:00Z' };
  assert.deepEqual(mergeProductionCompletedWork([first, second], [reverted]), [first]);
  assert.deepEqual(mergeProductionCompletedWork([second], [reverted]), []);
  assert.deepEqual(mergeProductionCompletedWork([second], [second]), [second]);
  assert.deepEqual(mergeProductionCompletedWork([first], []), [first]);
});

test('six production dates include Saturday when work exists', () => {
  assert.deepEqual(recentProductionDates(['2026-09-18', '2026-09-19', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25']),
    ['2026-09-25', '2026-09-24', '2026-09-23', '2026-09-22', '2026-09-21', '2026-09-19']);
});

test('detailed history is limited to seven calendar dates including weekends and year boundaries', () => {
  assert.equal(productionHistoryCutoffDate('2026-09-28'), '2026-09-22');
  assert.equal(productionHistoryCutoffDate('2027-01-03'), '2026-12-28');
  assert.equal(productionHistoryCutoffDate('2026-10-26'), '2026-10-20');
  for (const day of ['2026-09-22', '2026-09-26', '2026-09-27', '2026-09-28']) {
    assert.equal(isRecentProductionHistoryDate(day, '2026-09-28'), true);
  }
  for (const day of ['2026-09-21', '2026-09-29', 'bad-date', '']) {
    assert.equal(isRecentProductionHistoryDate(day, '2026-09-28'), false);
  }
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

test('dispatcher and technician completions expire at Warsaw midnight in summer and winter', () => {
  for (const team of ['distribution', 'technician']) {
    for (const [lastSecond, midnight] of [
      ['2026-09-28T21:59:59Z', '2026-09-28T22:00:00Z'],
      ['2026-12-28T22:59:59Z', '2026-12-28T23:00:00Z']
    ]) {
      const month=lastSecond.slice(0,7);
      const previous={completedAt:lastSecond};
      const current={completedAt:midnight};
      assert.equal(isProductionCompletionVisibleOnDate(team,previous,`${month}-28`),true);
      assert.equal(isProductionCompletionVisibleOnDate(team,previous,`${month}-29`),false);
      assert.equal(isProductionCompletionVisibleOnDate(team,current,`${month}-29`),true);
    }
    assert.equal(isProductionCompletionVisibleOnDate(team,undefined,'2026-09-29'),true);
    assert.equal(isProductionCompletionVisibleOnDate(team,{completedAt:''},'2026-09-28','2026-09-28'),true);
    assert.equal(isProductionCompletionVisibleOnDate(team,{completedAt:''},'2026-09-29','2026-09-28'),false);
    assert.equal(isProductionCompletionVisibleOnDate(team,{completedAt:'invalid'},'2026-09-29','2026-09-28'),false);
    assert.equal(isProductionCompletionVisibleOnDate(team,{completedAt:''},'2026-09-29'),true);
  }
  for (const team of ['additional','mechanics','process','graphics']) {
    assert.equal(isProductionCompletionVisibleOnDate(team,{completedAt:'2026-09-28T08:00:00Z'},'2026-09-29'),true);
  }
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
