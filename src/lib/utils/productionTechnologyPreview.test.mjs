import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Module, createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as reference from './productionTaskReference.ts';
import * as scopes from '../planowanie-zapotrzebowania/stateScopes.ts';
import * as retention from '../planowanie-zapotrzebowania/historyRetention.ts';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const loadSaveUtility = filename => {
  const mod = new Module(filename);
  mod.require = id => id.startsWith('.')
    ? loadSaveUtility(fileURLToPath(new URL(`${id}.ts`, `file:///${filename.replaceAll('\\', '/')}`)))
    : require(id);
  mod._compile(ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  return mod.exports;
};
const saveBody = loadSaveUtility(fileURLToPath(new URL('../planowanie-zapotrzebowania/saveBody.server.ts', import.meta.url)));
const transport = loadSaveUtility(fileURLToPath(new URL('../planowanie-zapotrzebowania/saveTransport.ts', import.meta.url)));
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date());
const item = (id = 'base') => ({ index: '1830', name: 'SYSTEM', station: 'WTR 21', areaId: 'hala-1', technologyId: id });
const state = (id = 'base') => ({ selectedPlanDate: day, plan: [item(id)], dailyPlans: { [day]: [item(id)] } });

function planningApi() {
  const rows = new Map([['workspace:planner', { state: state(), revision: 3 }], ['main', { state: { technologies: [] }, revision: 1 }]]);
  let writes = 0, reads = 0, fail = false;
  const stubs = {
    'next/server': { NextResponse: { json: (data, options) => Response.json(data, options) } },
    '@/lib/auth/access': { canSeeTab: () => true, isReadOnly: () => false, isWarehouseAdmin: () => false },
    '@/lib/auth/session': { getAuthenticatedUser: async () => ({ user: { id: 'planner', username: 'planner', name: 'Planner' } }) },
    '@/lib/planowanie-zapotrzebowania/saveBody.server': saveBody,
    '@/lib/planowanie-zapotrzebowania/historyRetention': retention,
    '@/lib/utils/productionTaskReference': reference,
    '@/lib/utils/originalInventorySpisSearch': {},
    '@/lib/utils/originalInventoryM10Indices': {},
    '@/lib/utils/originalInventoryCatalogRegister': {},
    '@/lib/utils/originalInventoryCatalogRegisterServer': {},
    '@/lib/planowanie-zapotrzebowania/stateScopes': scopes,
    '@/lib/planowanie-zapotrzebowania/palletSets': {},
    '@/lib/planowanie-zapotrzebowania/productCatalogSearch': {},
    '@/lib/planowanie-zapotrzebowania/fixedInventoryDevices': {},
    '@/lib/supabase/admin': { supabaseAdmin: {
      from: () => ({ select: field => ({ eq: (_, id) => ({ maybeSingle: async () => {
        reads++;
        const row = rows.get(id);
        const data = !row ? null : field.startsWith('preview:') ? { preview: row.state.__technologyPreview }
          : field.startsWith('plan:') ? { plan: row.state.plan, dailyPlans: row.state.dailyPlans, selectedPlanDate: row.state.selectedPlanDate } : row;
        return { data: structuredClone(data), error: null };
      } }) }) }),
      rpc: async (_, params) => {
        if (fail) return { data: null, error: new Error('offline') };
        const row = rows.get(params.p_module_id);
        if (row.revision !== params.p_expected_revision) return { data: [{ has_conflict: true, new_revision: row.revision }], error: null };
        writes++;
        rows.set(params.p_module_id, { state: structuredClone(params.p_state), revision: row.revision + 1 });
        return { data: [{ has_conflict: false, new_revision: row.revision + 1 }], error: null };
      }
    } }
  };
  const routeFile = fileURLToPath(new URL('../../app/api/planowanie-zapotrzebowania/route.ts', import.meta.url));
  const mod = new Module(routeFile);
  mod.require = id => { assert.ok(id in stubs, id); return stubs[id]; };
  mod._compile(ts.transpileModule(readFileSync(routeFile, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, routeFile);
  return { rows, writes: () => writes, reads: () => reads, fail: value => { fail = value; },
    put: (next, revision = 3) => mod.exports.PUT({ json: async () => ({ state: next, expectedRevision: revision, expectedSharedRevision: 1, changedSharedFields: [] }) }),
    putDocuments: (next, baseline) => mod.exports.PUT({ json: async () => ({ state: next, expectedRevision: 3,
      expectedSharedRevision: 1, changedSharedFields: ['documents'], sharedBaseline: { documents: baseline } }) }),
    putCompressed: async next => {
      const encoded = await transport.encodePlanningSave({ state: next, expectedRevision: 3, expectedSharedRevision: 1,
        changedSharedFields: ['technologies'], sharedBaseline: { technologies: [] } });
      assert.equal(encoded.headers['content-type'], 'application/gzip');
      return mod.exports.PUT(new Request('http://test/api/planowanie-zapotrzebowania', { method: 'PUT', ...encoded }));
    },
    get: () => mod.exports.GET({ nextUrl: new URL('http://test/api/planowanie-zapotrzebowania') })
  };
}

const relativeDay = offset => {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};

test('actual API removes expired workspace history but preserves a continuing working recipe and stock', async () => {
  const api = planningApi();
  const old = relativeDay(-2), yesterday = relativeDay(-1);
  const plan = [{ ...item('alternative'), manualOverride: true, workingMaterials: [{ code: 'ALT', usage: 0.5, unit: 'kg' }] }];
  const next = { ...state(), plan, dailyPlans: { [old]: plan, [yesterday]: plan, [day]: plan },
    planVersions: [{ id: 'old', planDate: old }, { id: 'yesterday', planDate: yesterday }],
    archive: [{ id: 'old', at: `${old}T12:00:00Z` }, { id: 'today', at: `${day}T12:00:00Z` }],
    returnStatuses: { [`${old}|hall|material`]: 'completed', [`${day}|hall|material`]: 'open' },
    inventory: [{ code: 'ALT', qty: 12 }], returnExclusions: [{ id: 'permanent' }] };
  const result = await api.put(next);
  assert.equal(result.status, 200);
  const saved = api.rows.get('workspace:planner').state;
  assert.deepEqual(saved.plan, plan);
  assert.deepEqual(Object.keys(saved.dailyPlans), [yesterday, day]);
  assert.deepEqual(saved.planVersions.map(row => row.id), ['yesterday']);
  assert.deepEqual(saved.archive.map(row => row.id), ['today']);
  assert.equal(saved.returnStatuses, undefined, 'shared return decisions are not copied into the private workspace');
  assert.deepEqual(saved.inventory, next.inventory);
  assert.equal(saved.__technologyPreview.days[day][0].manualOverride, true);
  assert.equal(saved.__technologyPreview.days[day][0].workingMaterials[0].code, 'ALT');
  assert.equal(api.writes(), 1);
});

test('stale document baselines cannot resurrect expired data or cause a false merge conflict', async () => {
  const api = planningApi();
  const old = relativeDay(-2);
  const expired = { id: 'expired', areaId: 'hala-1', planDate: old, rows: [{ qty: 1 }] };
  const current = { id: 'current', areaId: 'hala-1', planDate: day, rows: [{ qty: 2 }] };
  const active = [{ ...item('working'), manualOverride: true, workingMaterials: [{ code: 'ALT', usage: 0.5 }] }];
  api.rows.set('main', { revision: 1, state: { technologies: [], documents: [expired, current],
    plan: active, selectedPlanDate: old, dailyPlans: { [old]: active }, planVersions: [{ id: 'old', planDate: old }],
    archive: [{ id: 'old', at: `${old}T12:00:00Z` }],
    returnStatuses: { [`${old}|hall|material`]: 'completed', [`${day}|hall|material`]: 'open' } } });
  const result = await api.putDocuments({ ...state(), documents: [expired, { ...current, rows: [{ qty: 9 }] }] }, [expired, current]);
  assert.equal(result.status, 200);
  const shared = api.rows.get('main').state;
  assert.deepEqual(shared.documents.map(row => row.id), ['current']);
  assert.equal(shared.documents[0].rows[0].qty, 9);
  assert.deepEqual(shared.plan, active);
  assert.deepEqual(shared.dailyPlans, {});
  assert.deepEqual(shared.planVersions, []);
  assert.deepEqual(shared.archive, []);
  assert.deepEqual(shared.returnStatuses, { [`${day}|hall|material`]: 'open' });
  assert.equal(api.writes(), 2, 'cleanup is part of the existing optimistic writes, not a competing extra write');
});

test('large compressed technology saves use the actual API, preserve history and publish the same preview', async () => {
  const api = planningApi();
  const next = { ...state('alternative'), technologies: [{ id: 'new', productIndex: '000703', productName: 'New product', materials: [{ usage: .248, unit: 'kg' }] }],
    archive: [{ name: 'Synthetic history', note: 'Keep this complete history. '.repeat(210_000), qty: 0 }] };
  assert.ok(Buffer.byteLength(JSON.stringify(next)) > 4_500_000);
  const result = await api.putCompressed(next);
  assert.equal(result.status, 200);
  assert.equal(api.writes(), 2);
  assert.deepEqual(api.rows.get('main').state.technologies, next.technologies);
  assert.deepEqual(api.rows.get('workspace:planner').state.archive, next.archive);
  assert.equal(api.rows.get('workspace:planner').state.__technologyPreview.days[day][0].technologyId, 'alternative');
});

test('recipe choice is published atomically in the existing save without shared-state writes', async () => {
  const api = planningApi();
  const result = await api.put(state('alternative'));
  assert.equal(result.status, 200);
  assert.equal(api.writes(), 1);
  const saved = api.rows.get('workspace:planner');
  assert.equal(saved.state.__technologyPreview.days[day][0].technologyId, 'alternative');
  assert.ok(saved.state.__technologyPreview.days[day][0].changedAt);
  assert.equal(api.rows.get('main').revision, 1);
  const remote = await (await api.get()).json();
  assert.equal(remote.state.__technologyPreview, undefined);
  assert.equal(remote.state.plan[0].technologyId, 'alternative');
});

test('unrelated saves and legacy bootstrap cannot override another planner selection', async () => {
  const api = planningApi();
  await api.put({ ...state(), notes: 'unrelated' });
  assert.equal(api.rows.get('workspace:planner').state.__technologyPreview.days[day][0].changedAt, '');
  await api.put(state('alternative'), 4);
  const first = structuredClone(api.rows.get('workspace:planner').state.__technologyPreview);
  await api.put({ ...state('alternative'), plan: [{ ...item('alternative'), totalQty: 500, included: false }] }, 5);
  assert.deepEqual(api.rows.get('workspace:planner').state.__technologyPreview, first);
});

test('normal plan loading warms the projection so consecutive saves need no extra database reads', async () => {
  const api = planningApi();
  await api.get();
  const reads = api.reads();
  await api.put(state('alternative'), 3);
  await api.put(state('base'), 4);
  assert.equal(api.reads(), reads);
  assert.equal(api.writes(), 2);
});

test('conflicted or failed saves do not publish a preview and supplied metadata is ignored', async () => {
  const api = planningApi();
  assert.equal((await api.put(state('alternative'), 2)).status, 409);
  assert.equal(api.rows.get('workspace:planner').state.__technologyPreview, undefined);
  api.fail(true);
  assert.equal((await api.put(state('alternative'))).status, 500);
  assert.equal(api.rows.get('workspace:planner').state.__technologyPreview, undefined);
  api.fail(false);
  await api.put({ ...state(), __technologyPreview: { days: { [day]: [{ technologyId: 'injected', changedAt: '9999' }] } } });
  assert.equal(api.rows.get('workspace:planner').state.__technologyPreview.days[day][0].technologyId, 'base');
});

test('operator component is read-only, does not fetch while closed, and refreshes only open previews', () => {
  const file = fileURLToPath(new URL('../../components/production-preparation/TaskTechnologyPreview.tsx', import.meta.url));
  const source = readFileSync(file, 'utf8');
  assert.doesNotMatch(source, /SelectField|setSelectedId|Wariant podglądu|method:\s*['"](?:PUT|POST|PATCH|DELETE)/);
  assert.match(source, /enabled: open/);
  assert.match(source, /refetchInterval: open \? 5_000 : false/);
  assert.match(source, /refetchIntervalInBackground: false/);
  const mod = new Module(file);
  mod.require = id => id === '@/lib/utils/productionTaskReference' ? reference : require(id);
  mod._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText, file);
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { QueryClient, QueryClientProvider } = require('@tanstack/react-query');
  const client = new QueryClient();
  const html = renderToStaticMarkup(React.createElement(QueryClientProvider, { client }, React.createElement(mod.exports.TaskTechnologyPreview, { detail: 'SYSTEM (01830)', station: 'WTR 21', planDate: day })));
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /<select|<input|<option/);
  assert.equal(client.isFetching(), 0);
  client.clear();
});

function referenceApi() {
  const calls = [];
  const workspaces = [{ id: 'workspace:planner', revision: 3, version: null, preview: null }];
  const legacy = { id: 'workspace:planner', plan: state().plan, selectedPlanDate: day, day: state().plan };
  const techs = [
    { id: 'base', productIndex: '1830', productName: 'SYSTEM', variant: 'base', materials: [{ name: 'base resin' }] },
    { id: 'alt', productIndex: '1830', productName: 'SYSTEM', variant: 'alternative', materials: [{ name: 'alternative resin' }] }
  ];
  const stubs = {
    'next/server': { NextResponse: { json: (data, options) => Response.json(data, options) } },
    '@/lib/auth/access': { canSeeTab: () => true },
    '@/lib/auth/session': { getAuthenticatedUser: async () => ({ user: { id: 'worker' } }) },
    '@/lib/utils/productionTaskReference': reference,
    '@/lib/supabase/admin': { supabaseAdmin: { from: () => ({ select: field => {
      calls.push(field);
      return {
        eq: () => ({ maybeSingle: async () => ({ data: { value: techs }, error: null }) }),
        like: () => ({ order: () => ({ range: async () => ({ data: structuredClone(workspaces), error: null }) }) }),
        in: async () => ({ data: [structuredClone(legacy)], error: null })
      };
    } }) } }
  };
  const routeFile = fileURLToPath(new URL('../../app/api/przygotowanie-produkcji/reference/route.ts', import.meta.url));
  const mod = new Module(routeFile);
  mod.require = id => { assert.ok(id in stubs, id); return stubs[id]; };
  mod._compile(ts.transpileModule(readFileSync(routeFile, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, routeFile);
  return { calls, workspaces, legacy,
    get: (overrides = {}) => mod.exports.GET({ nextUrl: new URL('http://test/api?' + new URLSearchParams({ detail: 'SYSTEM (01830)', date: day, station: 'WTR 21', area: 'hala-1', ...overrides })) })
  };
}

test('many simultaneous previews coalesce database reads and unchanged legacy plans stay cached', async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const api = referenceApi();
  const responses = await Promise.all(Array.from({ length: 30 }, () => api.get()));
  assert.equal(api.calls.length, 3); // library + small workspace projection + one legacy compatibility read
  for (const response of responses) {
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal((await response.json()).items[0].id, 'base');
  }
  now += 5_000;
  await api.get();
  assert.equal(api.calls.length, 4); // only the small projection, not library or legacy plan
  now += 5_000;
  api.workspaces[0].revision++;
  api.legacy.plan = state('alt').plan;
  assert.equal((await (await api.get()).json()).items[0].id, 'alt');
  assert.equal(api.calls.length, 6);
  now += 5_000;
  api.workspaces[0].version = 1;
  api.workspaces[0].preview = reference.buildTechnologyPreviewProjection(state('base'), null, new Date(now).toISOString()).days[day];
  assert.equal((await (await api.get()).json()).items[0].id, 'base');
  assert.equal(api.calls.length, 7);
});

test('reference context validation prevents malformed dates and missing stations before database reads', async () => {
  const api = referenceApi();
  for (const overrides of [{ date: '2026-99-99' }, { date: '2026-02-30' }, { date: '' }, { station: '' }, { date: '2026-09-21",state' }]) {
    assert.equal((await api.get(overrides)).status, 400);
  }
  assert.equal(api.calls.length, 0);
});

test('API merges a legacy blank with a selected recipe and still refreshes intentional clearing', async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const api = referenceApi();
  api.legacy.plan = state('').plan;
  const selected = reference.buildTechnologyPreviewProjection(state('alt'), null, '').days[day];
  api.workspaces.push({ id: 'workspace:second', revision: 1, version: 1, preview: selected });
  const responses = await Promise.all(Array.from({ length: 30 }, () => api.get()));
  for (const response of responses) {
    const result = await response.json();
    assert.equal(result.status, 'matched');
    assert.deepEqual(result.items.map(item => item.id), ['alt']);
    assert.equal(result.items[0].materials[0].name, 'alternative resin');
  }
  assert.equal(api.calls.length, 3);
  now += 5_000;
  api.workspaces[1].revision++;
  api.workspaces[1].preview = [{ ...selected[0], technologyId: '', changedAt: new Date(now).toISOString() }];
  assert.equal((await (await api.get()).json()).status, 'unselected');
  assert.equal(api.calls.length, 4);
});
