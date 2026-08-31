import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPlanningAutosave, PlanningSaveError, restorePlanningDraft, samePlanningState
} from './autosave.ts';

const drain = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
test('default browser timers keep their global receiver when scheduling an imported plan', (t) => {
  let scheduled = 0;
  let cleared = 0;
  t.mock.method(globalThis, 'setTimeout', function () {
    assert.equal(this, globalThis, 'native browser setTimeout requires the Window receiver');
    return ++scheduled;
  });
  t.mock.method(globalThis, 'clearTimeout', function () {
    assert.equal(this, globalThis, 'native browser clearTimeout requires the Window receiver');
    cleared += 1;
  });
  const engine = createPlanningAutosave({
    draft: { state: { plan: [] }, revision: 1, pending: false },
    read: async () => ({state:null,revision:1}), write: async () => 2, cache: () => {}, onChange: () => {}
  });
  assert.doesNotThrow(() => engine.setSnapshot({ plan: [{ sourceQuantity: 'L 3500 P 3775' }] }, true));
  assert.doesNotThrow(() => engine.setSnapshot({ plan: [{ sourceQuantity: 'DO RANA' }] }, true));
  assert.doesNotThrow(() => engine.persist());
  assert.ok(scheduled >= 4);
  assert.ok(cleared >= 2);
});
const fakeClock = () => {
  let time = 0;
  let id = 0;
  const timers = new Map();
  return {
    setTimeout(callback, delay) { const key = ++id; timers.set(key, { at: time + delay, callback }); return key; },
    clearTimeout(key) { timers.delete(key); },
    async tick(milliseconds) {
      const end = time + milliseconds;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [key, timer] = next;
        timers.delete(key);
        time = timer.at;
        timer.callback();
        await drain();
      }
      time = end;
      await drain();
    }
  };
};

const setup = (overrides = {}) => {
  const clock = fakeClock();
  const writes = [];
  const backups = [];
  const notifications = [];
  let reads = 0;
  const options = {
    draft: { state: { quantity: 100 }, revision: 4, pending: false },
    clock,
    read: async () => { reads += 1; return { state: { quantity: 100 }, revision: 4 }; },
    write: async (state, revision) => { writes.push({ state, revision }); return revision + 1; },
    cache: (draft) => backups.push(JSON.parse(JSON.stringify(draft))),
    onChange: (info) => notifications.push(info),
    ...overrides
  };
  const queue = createPlanningAutosave(options);
  queue.start();
  return { queue, clock, writes, backups, notifications, reads: () => reads };
};

test('idle plans and local view changes do not send requests', async () => {
  const h = setup();
  await h.clock.tick(60000);
  h.queue.setSnapshot({ quantity: 100, selectedPlanDate: '2026-09-01' });
  await h.clock.tick(60000);
  assert.equal(h.writes.length, 0);
  assert.equal(h.reads(), 0);
  assert.equal(h.queue.getInfo().status, 'saved');
});

test('a burst of clicks or typing saves only the latest value after 700 ms', async () => {
  const h = setup();
  for (const quantity of [2, 20, 200, 2000]) {
    h.queue.setSnapshot({ quantity }, true);
    await h.clock.tick(100);
  }
  await h.clock.tick(599);
  assert.equal(h.writes.length, 0);
  await h.clock.tick(1);
  assert.deepEqual(h.writes, [{ state: { quantity: 2000 }, revision: 4 }]);
  assert.equal(h.queue.getInfo().status, 'saved');
  assert.equal(h.backups.at(-1).pending, false);
});

test('new edits during a request stay pending and use the acknowledged revision next', async () => {
  const calls = [];
  let resolveWrite;
  const h = setup({ write: (state, revision) => {
    calls.push({ state, revision });
    return new Promise((resolve) => { resolveWrite = resolve; });
  } });
  h.queue.setSnapshot({ quantity: 200 }, true);
  await h.clock.tick(700);
  h.queue.setSnapshot({ quantity: 300 }, true);
  await h.clock.tick(700);
  assert.equal(calls.length, 1);
  resolveWrite(5);
  await drain();
  assert.equal(h.queue.getInfo().status, 'pending');
  assert.equal(h.queue.getDraft().pending, true);
  await h.clock.tick(700);
  assert.deepEqual(calls[1], { state: { quantity: 300 }, revision: 5 });
  resolveWrite(6);
  await drain();
  assert.equal(h.queue.getInfo().status, 'saved');
  assert.equal(h.queue.getDraft().revision, 6);
});

test('multiple flush triggers share one request', async () => {
  let finish;
  let writes = 0;
  const h = setup({ write: async () => { writes += 1; await new Promise((resolve) => { finish = resolve; }); return 5; } });
  h.queue.setSnapshot({ quantity: 200 }, true);
  const first = h.queue.flush();
  const second = h.queue.flush();
  assert.equal(first, second);
  assert.equal(writes, 1);
  finish();
  await first;
  await h.clock.tick(60000);
  assert.equal(writes, 1);
});

test('revision conflict pauses writes without advancing the expected revision', async () => {
  let writes = 0;
  const h = setup({ write: async () => { writes += 1; throw new PlanningSaveError('REVISION_CONFLICT'); } });
  h.queue.setSnapshot({ quantity: 200 }, true);
  await h.queue.flush();
  h.queue.setSnapshot({ quantity: 300 }, true);
  await h.queue.retry();
  await h.clock.tick(120000);
  assert.equal(writes, 1);
  assert.equal(h.queue.getInfo().status, 'conflict');
  assert.equal(h.queue.getDraft().revision, 4);
  assert.equal(h.backups.at(-1).state.quantity, 300);
  assert.equal(h.backups.at(-1).pending, true);
});

test('offline work remains backed up and retry attempts are bounded', async () => {
  let writes = 0;
  const h = setup({
    write: async () => { writes += 1; throw new Error('offline'); },
    read: async () => { throw new Error('offline'); }
  });
  h.queue.setSnapshot({ quantity: 200 }, true);
  await h.queue.flush();
  assert.equal(h.queue.getInfo().status, 'offline');
  assert.equal(h.backups.at(-1).pending, true);
  await h.clock.tick(80000);
  assert.equal(h.queue.getInfo().error, 'RETRY_PAUSED');
  const notificationCount = h.notifications.length;
  await h.clock.tick(3600000);
  assert.equal(h.notifications.length, notificationCount);
  assert.equal(writes, 1);
  assert.equal(h.queue.getDraft().state.quantity, 200);
});

test('a lost successful response is reconciled before saving the next edit', async () => {
  let remote = { state: { quantity: 100 }, revision: 4 };
  const calls = [];
  const h = setup({
    read: async () => remote,
    write: async (state, revision) => {
      calls.push({ state, revision });
      remote = { state, revision: revision + 1 };
      if (calls.length === 1) throw new Error('response lost');
      return remote.revision;
    }
  });
  h.queue.setSnapshot({ quantity: 200 }, true);
  await h.queue.flush();
  h.queue.setSnapshot({ quantity: 300 }, true);
  await h.queue.retry();
  assert.deepEqual(calls, [
    { state: { quantity: 200 }, revision: 4 },
    { state: { quantity: 300 }, revision: 5 }
  ]);
  assert.equal(h.queue.getInfo().status, 'saved');
  assert.equal(h.queue.getDraft().revision, 6);
});

test('a committed snapshot is not written twice after losing its response', async () => {
  let remote = { state: { quantity: 100 }, revision: 4 };
  let writes = 0;
  const h = setup({
    read: async () => remote,
    write: async (state, revision) => { writes += 1; remote = { state, revision: revision + 1 }; throw new Error('response lost'); }
  });
  h.queue.setSnapshot({ quantity: 200 }, true);
  await h.queue.flush();
  await h.queue.retry();
  assert.equal(writes, 1);
  assert.equal(h.queue.getInfo().status, 'saved');
  assert.equal(h.queue.getDraft().revision, 5);
});

test('unknown initial revision cannot overwrite an existing server plan', async () => {
  const h = setup({ draft: { state: { quantity: 0 }, revision: null, pending: false } });
  h.queue.setSnapshot({ quantity: 200 }, true);
  await h.queue.flush();
  assert.equal(h.reads(), 1);
  assert.equal(h.writes.length, 0);
  assert.equal(h.queue.getInfo().status, 'conflict');
});

test('unknown revision can create a genuinely empty server state', async () => {
  const h = setup({
    draft: { state: { quantity: 0 }, revision: null, pending: false },
    read: async () => ({ state: null, revision: 0 })
  });
  h.queue.setSnapshot({ quantity: 200 }, true);
  await h.queue.flush();
  assert.deepEqual(h.writes[0], { state: { quantity: 200 }, revision: 0 });
});

test('permission and migration errors do not generate automatic retry loops', async () => {
  for (const code of ['FORBIDDEN', 'UNAUTHORIZED', 'READ_ONLY', 'CONCURRENCY_MIGRATION_REQUIRED']) {
    let writes = 0;
    const h = setup({ write: async () => { writes += 1; throw new PlanningSaveError(code); } });
    h.queue.setSnapshot({ quantity: 200 }, true);
    await h.queue.flush();
    await h.clock.tick(3600000);
    assert.equal(writes, 1);
    assert.equal(h.queue.getInfo().status, 'error');
    assert.equal(h.queue.getDraft().pending, true);
  }
});

test('closing the module flushes the last edit behind an in-flight save', async () => {
  let finish;
  const calls = [];
  const h = setup({ write: async (state, revision) => {
    calls.push({ state, revision });
    if (calls.length === 1) await new Promise((resolve) => { finish = resolve; });
    return revision + 1;
  } });
  h.queue.setSnapshot({ quantity: 200 }, true);
  await h.clock.tick(700);
  h.queue.setSnapshot({ quantity: 300 }, true);
  const closing = h.queue.close();
  finish();
  await closing;
  assert.deepEqual(calls, [
    { state: { quantity: 200 }, revision: 4 },
    { state: { quantity: 300 }, revision: 5 }
  ]);
  const backups = h.backups.length;
  await h.queue.close();
  await h.clock.tick(60000);
  assert.equal(h.backups.length, backups);
  assert.equal(h.queue.getDraft().pending, false);
});

test('an unavailable browser cache does not block a central save or claim a local backup', async () => {
  const h = setup({ cache: () => { throw new Error('quota exceeded'); } });
  h.queue.setSnapshot({ quantity: 200 }, true);
  await h.queue.flush();
  assert.equal(h.writes.length, 1);
  assert.equal(h.queue.getInfo().status, 'saved');
  assert.equal(h.queue.getInfo().backupAvailable, false);
});

test('reopening restores pending local work when the base revision is unchanged', () => {
  const restored = restorePlanningDraft(
    { state: { quantity: 100 }, revision: 4 },
    { state: { quantity: 200 }, revision: 4, pending: true },
    { quantity: 0 }
  );
  assert.equal(restored.state.quantity, 200);
  assert.equal(restored.pending, true);
  assert.equal(restored.conflict, false);
});

test('reopening never silently replaces pending local work with another users version', () => {
  const restored = restorePlanningDraft(
    { state: { quantity: 400 }, revision: 5 },
    { state: { quantity: 200 }, revision: 4, pending: true },
    { quantity: 0 }
  );
  assert.equal(restored.state.quantity, 200);
  assert.equal(restored.revision, 4);
  assert.equal(restored.pending, true);
  assert.equal(restored.conflict, true);
});

test('reopening can resume edits made after a successfully committed but unacknowledged request', () => {
  const restored = restorePlanningDraft(
    { state: { quantity: 200 }, revision: 5 },
    { state: { quantity: 300 }, revision: 4, pending: true, lastAttempt: { state: { quantity: 200 }, revision: 4 } },
    { quantity: 0 }
  );
  assert.equal(restored.state.quantity, 300);
  assert.equal(restored.revision, 5);
  assert.equal(restored.pending, true);
  assert.equal(restored.conflict, false);
});

test('JSONB property order and omitted optional fields do not cause false conflicts', () => {
  assert.equal(samePlanningState(
    { plan: [{ qty: 300, selected: true }], calculationMode: 'all', optional: undefined },
    { calculationMode: 'all', plan: [{ selected: true, qty: 300 }] }
  ), true);
  assert.equal(samePlanningState({ plan: [{ qty: 300 }] }, { plan: [{ qty: 301 }] }), false);
  assert.equal(samePlanningState([1, 2], { 0: 1, 1: 2 }), false);
});

test('edits made while reconciling an uncertain save remain the newest snapshot', async () => {
  let finishRead;
  const h = setup({
    draft: {
      state: { quantity: 200 }, revision: 4, pending: true,
      lastAttempt: { state: { quantity: 200 }, revision: 4 }
    },
    read: () => new Promise((resolve) => { finishRead = resolve; })
  });
  const saving = h.queue.flush();
  h.queue.setSnapshot({ quantity: 350 }, true);
  finishRead({ state: { quantity: 200 }, revision: 5 });
  await saving;
  assert.deepEqual(h.writes, [{ state: { quantity: 350 }, revision: 5 }]);
  assert.equal(h.queue.getDraft().pending, false);
});

test('another users edit after an uncertain response is never overwritten on retry', async () => {
  let remote = { state: { quantity: 100 }, revision: 4 };
  let writes = 0;
  const h = setup({
    read: async () => remote,
    write: async (state, revision) => {
      writes += 1;
      remote = { state, revision: revision + 1 };
      throw new Error('response lost');
    }
  });
  h.queue.setSnapshot({ quantity: 200 }, true);
  await h.queue.flush();
  remote = { state: { quantity: 500 }, revision: 6 };
  h.queue.setSnapshot({ quantity: 300 }, true);
  await h.queue.retry();
  assert.equal(writes, 1);
  assert.equal(h.queue.getInfo().status, 'conflict');
  assert.equal(h.queue.getDraft().state.quantity, 300);
  assert.equal(remote.state.quantity, 500);
});

test('manual retry resumes the saved revision after the connection recovers', async () => {
  let offline = true;
  let writes = 0;
  const h = setup({
    read: async () => ({ state: { quantity: 100 }, revision: 4 }),
    write: async (_state, revision) => {
      writes += 1;
      if (offline) throw new Error('offline');
      return revision + 1;
    }
  });
  h.queue.setSnapshot({ quantity: 200 }, true);
  await h.queue.flush();
  offline = false;
  await h.queue.retry();
  await h.clock.tick(3600000);
  assert.equal(writes, 2);
  assert.equal(h.queue.getDraft().revision, 5);
  assert.equal(h.queue.getInfo().status, 'saved');
});

test('empty storage stays idle while a legacy local plan is queued only for an empty database', () => {
  const fallback = { quantity: 0 };
  const local = { state: { quantity: 200 }, revision: null, pending: false };
  assert.equal(restorePlanningDraft({ state: null, revision: 0 }, null, fallback).pending, false);
  assert.equal(restorePlanningDraft({ state: null, revision: 0 }, local, fallback).pending, true);
  const restored = restorePlanningDraft({ state: { quantity: 300 }, revision: 8 }, local, fallback);
  assert.equal(restored.pending, false);
  assert.equal(restored.state.quantity, 300);
});
