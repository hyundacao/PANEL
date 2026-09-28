import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { applyPieceGrindingReservations } from '../../lib/utils/originalInventoryGrinding.ts';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../..');
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
}).outputText;
const load = (file) => {
  const mod = { exports: {} };
  vm.runInNewContext(compile(readFileSync(file, 'utf8')), {
    module: mod, exports: mod.exports,
    require: (name) => name.startsWith('@/')
      ? load(path.join(root, 'src', `${name.slice(2)}.ts`))
      : require(name)
  });
  return mod.exports;
};
const { SpisErpAvailability } = load(path.join(directory, 'SpisErpAvailability.tsx'));
const source = readFileSync(path.join(directory, 'SpisRzeczywisty.tsx'), 'utf8');
const ast = ts.createSourceFile('SpisRzeczywisty.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const queryNodes = new Map();
let availabilityNode;
const visit = (node) => {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useQuery') {
    const options = node.arguments[0];
    const key = options.properties.find((property) => property.name?.getText(ast) === 'queryKey');
    if (key && ts.isArrayLiteralExpression(key.initializer)) {
      queryNodes.set(key.initializer.elements[0].text, options.getText(ast));
    }
  }
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'SpisErpAvailability') availabilityNode = node.getText(ast);
  ts.forEachChild(node, visit);
};
visit(ast);

const optionsFor = (key, tab = 'spis', date = '2026-09-28', fetcher = async () => []) => {
  assert.ok(queryNodes.has(key));
  const mod = { exports: {} };
  vm.runInNewContext(compile(`module.exports = (${queryNodes.get(key)});`), {
    module: mod, activeTab: tab, spisDate: date,
    getOriginalInventoryErpSnapshot: fetcher,
    getOriginalInventoryGrindTasks: fetcher,
    isErpSnapshotMigrationError: (error) => error.message === 'MIGRATION_REQUIRED'
  });
  return mod.exports;
};
const erpKey = 'spis-oryginalow-erp-snapshot';
const grindKey = 'original-inventory-grind-tasks';
const baseProps = {
  name: 'METAL BOX 1230X830X730', date: '2026-09-28', snapshot: { availableQty: 250, unit: 'szt.' },
  hasSnapshot: true, loading: false, error: false, migrationRequired: false,
  reservationsLoading: false, reservationsError: false, onRetry: () => {}
};
const render = (props = {}) => renderToStaticMarkup(React.createElement(SpisErpAvailability, { ...baseProps, ...props }));

test('a cold Spis tab loads ERP for its day and grinding reservations without visiting reports', async () => {
  let calls = 0;
  const options = optionsFor(erpKey, 'spis', '2026-09-28', async (date) => {
    assert.equal(date, '2026-09-28');
    calls++;
    return [{ name: 'METAL BOX', availableQty: 250, unit: 'szt.' }];
  });
  assert.equal(options.enabled, true);
  assert.equal(optionsFor(grindKey).enabled, true);
  const client = new QueryClient();
  try {
    const data = await client.fetchQuery(options);
    assert.equal(data.items[0].availableQty, 250);
    assert.equal(calls, 1);
  } finally { client.clear(); }
});

test('ERP is scoped by date, not search text, and unrelated tabs do not load daily stock', () => {
  const options = optionsFor(erpKey);
  assert.equal(JSON.stringify(options.queryKey), JSON.stringify([erpKey, '2026-09-28']));
  assert.equal(options.staleTime, 300_000);
  assert.equal(options.gcTime, 1_800_000);
  assert.equal(optionsFor(grindKey).staleTime, 60_000);
  assert.equal(options.refetchInterval, undefined);
  for (const tab of ['spis', 'stany-erp', 'raporty', 'alerty']) assert.equal(optionsFor(erpKey, tab).enabled, true);
  for (const tab of ['kartoteki', 'do-zmielenia']) assert.equal(optionsFor(erpKey, tab).enabled, false);
  assert.equal(optionsFor(erpKey, 'spis', '').enabled, false);
  assert.doesNotMatch(queryNodes.get(erpKey), /form\.name|debouncedQuery|normalizedQuery/);
});

test('rerenders and repeated material searches reuse the same daily request and fresh cache', async () => {
  const client = new QueryClient();
  let calls = 0;
  const fetcher = async () => { calls++; return [{ name: 'METAL BOX', availableQty: 250 }]; };
  const options = optionsFor(erpKey, 'spis', '2026-09-28', fetcher);
  const observer = new QueryObserver(client, options);
  const unsubscribe = observer.subscribe(() => {});
  try {
    await client.fetchQuery(options);
    for (let index = 0; index < 50; index++) observer.setOptions(optionsFor(erpKey, 'spis', '2026-09-28', fetcher));
    await setImmediate();
    await client.fetchQuery(options);
    assert.equal(calls, 1);
    assert.equal(observer.getCurrentResult().data.items[0].availableQty, 250);
  } finally { unsubscribe(); client.clear(); }
});

test('changing days never displays the previous day stock and returning reuses that day cache', async () => {
  const client = new QueryClient();
  let calls = 0;
  const fetcher = async (date) => { calls++; return date === '2026-09-28' ? [{ availableQty: 250 }] : []; };
  const first = optionsFor(erpKey, 'spis', '2026-09-28', fetcher);
  const second = optionsFor(erpKey, 'spis', '2026-09-29', fetcher);
  const observer = new QueryObserver(client, first);
  const unsubscribe = observer.subscribe(() => {});
  try {
    await client.fetchQuery(first);
    observer.setOptions(second);
    assert.equal(observer.getCurrentResult().data, undefined);
    assert.equal(observer.getCurrentResult().isPending, true);
    await client.fetchQuery(second);
    assert.equal(observer.getCurrentResult().data.items.length, 0);
    observer.setOptions(first);
    assert.equal(observer.getCurrentResult().data.items[0].availableQty, 250);
    assert.equal(calls, 2);
  } finally { unsubscribe(); client.clear(); }
});

test('import and removal invalidation refresh daily stock despite its five minute cache', async () => {
  const client = new QueryClient();
  let stock = [{ availableQty: 250 }];
  let calls = 0;
  const options = optionsFor(erpKey, 'spis', '2026-09-28', async () => { calls++; return stock; });
  const observer = new QueryObserver(client, options);
  const unsubscribe = observer.subscribe(() => {});
  try {
    await client.fetchQuery(options);
    stock = [{ availableQty: 340 }];
    await client.invalidateQueries({ queryKey: options.queryKey });
    assert.equal(observer.getCurrentResult().data.items[0].availableQty, 340);
    stock = [];
    await client.invalidateQueries({ queryKey: options.queryKey });
    assert.equal(observer.getCurrentResult().data.items.length, 0);
    assert.equal(calls, 3);
    assert.ok((source.match(/invalidateQueries\(\{ queryKey: \['spis-oryginalow-erp-snapshot', spisDate\]/g) ?? []).length >= 2);
  } finally { unsubscribe(); client.clear(); }
});

test('reusing stock from reports does not fetch it again when opening Spis', async () => {
  const client = new QueryClient();
  let calls = 0;
  const fetcher = async () => { calls++; return []; };
  try {
    await client.fetchQuery(optionsFor(erpKey, 'raporty', '2026-09-28', fetcher));
    await client.fetchQuery(optionsFor(erpKey, 'spis', '2026-09-28', fetcher));
    assert.equal(calls, 1);
  } finally { client.clear(); }
});

test('ERP query errors remain errors while a missing migration is reported separately', async () => {
  const failed = optionsFor(erpKey, 'spis', '2026-09-28', async () => { throw new Error('NETWORK_FAILURE'); });
  await assert.rejects(failed.queryFn, /NETWORK_FAILURE/);
  const migration = optionsFor(erpKey, 'spis', '2026-09-28', async () => { throw new Error('MIGRATION_REQUIRED'); });
  const result = await migration.queryFn();
  assert.equal(result.migrationRequired, true);
  assert.equal(result.items.length, 0);
});

test('grinding changes invalidate cached reservations without refetching the whole ERP snapshot', async () => {
  const client = new QueryClient();
  let calls = 0;
  let tasks = [];
  const options = optionsFor(grindKey, 'spis', '2026-09-28', async () => { calls++; return tasks; });
  const observer = new QueryObserver(client, options);
  const unsubscribe = observer.subscribe(() => {});
  try {
    await client.fetchQuery(options);
    await client.fetchQuery(options);
    assert.equal(calls, 1);
    tasks = [{ materialName: 'METAL BOX', qty: 200 }];
    await client.invalidateQueries({ queryKey: [grindKey] });
    assert.equal(observer.getCurrentResult().data[0].qty, 200);
    assert.equal(calls, 2);
    assert.match(source, /invalidateQueries\(\{ queryKey: \['original-inventory-grind-tasks'\]/);
  } finally { unsubscribe(); client.clear(); }
});

test('availability renders only ERP and available quantity with unit in one compact unframed line', () => {
  const html = render({ snapshot: { availableQty: 125.625, realQty: 999, unit: 'kg' } });
  assert.equal(html.replace(/<[^>]+>/g, ''), 'ERP — 125,625 kg');
  assert.match(html, /whitespace-nowrap/);
  assert.match(html, /text-violet-300/);
  assert.match(html, /class="font-bold tabular-nums"/);
  assert.equal((html.match(/<p\b/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<div|<br|border|shadow|rounded|bg-|text-base|px-3|py-2/);
  assert.doesNotMatch(html, /999|28\.09\.2026|2026-09-28|do dyspozycji/);
  assert.match(render({ snapshot: { availableQty: 12.5, unit: 'l' } }), /12,5 l/);
  assert.equal(render({ name: '' }), '');
  assert.equal(render({ date: '' }), '');
});

test('real zero and negative availability are displayed and never called missing ERP', () => {
  for (const availableQty of [0, -15]) {
    const html = render({ snapshot: { availableQty, unit: 'szt.' } });
    assert.ok(html.includes(`${availableQty} szt.`));
    assert.doesNotMatch(html, /Brak danych|Wczytywanie/);
  }
});

test('missing day and missing material are distinct from a zero balance', () => {
  const missingDay = render({ snapshot: null, hasSnapshot: false });
  assert.match(missingDay, /Brak danych ERP dla tego dnia/);
  assert.match(missingDay, /Stany ERP/);
  const missingMaterial = render({ snapshot: null });
  assert.match(missingMaterial, /Brak danych ERP dla wybranego materiału/);
  assert.doesNotMatch(missingDay + missingMaterial, />0 szt\./);
});

test('loading, network failure and migration error never pretend stock is zero or available', () => {
  assert.match(render({ loading: true, snapshot: null, hasSnapshot: false }), /Wczytywanie danych ERP/);
  const failure = render({ error: true });
  assert.match(failure, /Nie udało się pobrać/);
  assert.match(failure, /Spróbuj ponownie/);
  assert.doesNotMatch(failure, /250 szt\./);
  assert.match(render({ migrationRequired: true }), /Wymagana aktualizacja bazy/);
});

test('pieces wait for reservations while kilograms and litres can already show ERP stock', () => {
  assert.match(render({ reservationsLoading: true }), /Wczytywanie danych ERP/);
  const failure = render({ reservationsError: true });
  assert.match(failure, /Nie udało się pobrać/);
  assert.doesNotMatch(failure, /250 szt\./);
  for (const unit of ['kg', 'l']) {
    const html = render({ snapshot: { availableQty: 75, unit }, reservationsError: true, reservationsLoading: true });
    assert.ok(html.includes(`75 ${unit}`));
    assert.doesNotMatch(html, /Nie udało|Wczytywanie/);
  }
});

test('Spis displays the same grinding-adjusted availability as reports without altering imported stock', () => {
  const entries = [{ name: 'METAL BOX', unit: 'szt.', availableQty: 500, importedAt: '2026-09-28T06:00:00Z' }];
  const tasks = [{ materialName: 'METAL BOX', unit: 'szt.', qty: 200, status: 'PENDING', sourceReportDate: '2026-09-28', createdAt: '2026-09-28T08:00:00Z' }];
  const [effective] = applyPieceGrindingReservations(entries, tasks, '2026-09-28', (name) => name.toLowerCase());
  assert.match(render({ snapshot: effective }), /300 szt\./);
  assert.equal(entries[0].availableQty, 500);
});

test('actual Spis JSX wires snapshot, date, loading states and both retry requests into the hint', () => {
  assert.ok(availabilityNode);
  const mod = { exports: {} };
  let erpRetries = 0;
  let reservationRetries = 0;
  vm.runInNewContext(compile(`module.exports = (${availabilityNode});`), {
    module: mod, exports: mod.exports, require, SpisErpAvailability,
    form: { name: baseProps.name }, spisDate: baseProps.date,
    matchedErpSnapshot: baseProps.snapshot, erpSnapshotEntries: [baseProps.snapshot],
    isErpSnapshotPending: false, isErpSnapshotError: true, erpSnapshotMigrationRequired: false,
    isGrindTasksPending: false, isGrindTasksError: false,
    refetchErpSnapshot: () => { erpRetries++; },
    refetchGrindTasks: () => { reservationRetries++; }
  });
  assert.match(renderToStaticMarkup(mod.exports), /Spróbuj ponownie/);
  assert.equal(mod.exports.props.date, baseProps.date);
  assert.doesNotMatch(renderToStaticMarkup(mod.exports), /28\.09\.2026|2026-09-28/);
  mod.exports.props.onRetry();
  assert.equal(erpRetries, 1);
  assert.equal(reservationRetries, 1);
});
