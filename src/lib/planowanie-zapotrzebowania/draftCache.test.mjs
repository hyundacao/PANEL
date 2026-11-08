import assert from 'node:assert/strict';
import { createRequire, Module } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const loadCache = () => {
  const filename = fileURLToPath(new URL('./draftCache.ts', import.meta.url));
  const mod = new Module(filename);
  mod._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename);
  return mod.exports;
};

function environment(t, { failOpen = false, failWrite = false, localLimit = Infinity } = {}) {
  const indexed = new Map();
  const local = new Map();
  const previous = { indexedDB: globalThis.indexedDB, window: globalThis.window };
  globalThis.window = { localStorage: {
    getItem: key => local.get(key) ?? null,
    setItem: (key, value) => { if (value.length > localLimit) throw new Error('QuotaExceededError'); local.set(key, value); },
    removeItem: key => local.delete(key)
  } };
  let created = false;
  const db = {
    objectStoreNames: { contains: () => created },
    createObjectStore: () => { created = true; },
    close: () => {},
    transaction: () => {
      const tx = { error: null };
      tx.objectStore = () => ({
        get: key => {
          const request = {};
          queueMicrotask(() => { request.result = indexed.get(key); request.onsuccess?.(); });
          return request;
        },
        put: (value, key) => queueMicrotask(() => {
          if (failWrite) { tx.error = new Error('DISK_FULL'); tx.onabort?.(); }
          else { indexed.set(key, value); tx.oncomplete?.(); }
        }),
        delete: key => queueMicrotask(() => { indexed.delete(key); tx.oncomplete?.(); })
      });
      return tx;
    }
  };
  globalThis.indexedDB = { open: () => {
    const request = { result: db };
    queueMicrotask(() => {
      if (failOpen) request.onerror?.();
      else { if (!created) request.onupgradeneeded?.(); request.onsuccess?.(); }
    });
    return request;
  } };
  t.after(() => {
    if (previous.indexedDB === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = previous.indexedDB;
    if (previous.window === undefined) delete globalThis.window;
    else globalThis.window = previous.window;
  });
  return { indexed, local, cache: loadCache() };
}

test('a backup larger than localStorage quota uses IndexedDB and restores byte for byte', async t => {
  const { cache, indexed, local } = environment(t, { localLimit: 1000 });
  const value = JSON.stringify({ format: 2, state: { notes: 'x'.repeat(6_000_000), technologies: [{ id: 'new', productIndex: '000703' }] }, pending: true, revision: 964 });
  await cache.writePlanningDraftCache('workspace:one', value);
  assert.equal(indexed.get('workspace:one'), value);
  assert.equal(await cache.readPlanningDraftCache('workspace:one'), value);
  assert.equal(local.has('workspace:one'), false);
});

test('legacy backups are retained until the migrated transaction has committed', async t => {
  const { cache, indexed, local } = environment(t);
  const old = JSON.stringify({ format: 2, state: { technologies: [] }, pending: true });
  local.set('workspace:one', old);
  assert.equal(await cache.readPlanningDraftCache('workspace:one'), old);
  const writing = cache.writePlanningDraftCache('workspace:one', old);
  assert.equal(local.get('workspace:one'), old);
  await writing;
  assert.equal(indexed.get('workspace:one'), old);
  assert.equal(local.has('workspace:one'), false);
});

test('failed IndexedDB writes fall back without removing the only existing copy', async t => {
  const { cache, indexed, local } = environment(t, { failWrite: true, localLimit: 1000 });
  local.set('workspace:one', 'previous');
  await assert.rejects(cache.writePlanningDraftCache('workspace:one', 'x'.repeat(2000)), /QuotaExceededError/);
  assert.equal(local.get('workspace:one'), 'previous');
  assert.equal(indexed.has('workspace:one'), false);
});

test('browsers without IndexedDB can still use a small legacy backup', async t => {
  const { cache, local } = environment(t, { failOpen: true });
  await cache.writePlanningDraftCache('workspace:one', 'saved');
  assert.equal(local.get('workspace:one'), 'saved');
  assert.equal(await cache.readPlanningDraftCache('workspace:one'), 'saved');
});

test('queued writes retain the newest backup and removing one user never clears another', async t => {
  const { cache, indexed, local } = environment(t);
  await Promise.all([
    cache.writePlanningDraftCache('workspace:one', 'first'),
    cache.writePlanningDraftCache('workspace:one', 'second'),
    cache.writePlanningDraftCache('workspace:two', 'other user')
  ]);
  assert.equal(await cache.readPlanningDraftCache('workspace:one'), 'second');
  local.set('unrelated', 'keep');
  await cache.removePlanningDraftCache('workspace:one');
  assert.equal(indexed.has('workspace:one'), false);
  assert.equal(await cache.readPlanningDraftCache('workspace:two'), 'other user');
  assert.equal(local.get('unrelated'), 'keep');
});
