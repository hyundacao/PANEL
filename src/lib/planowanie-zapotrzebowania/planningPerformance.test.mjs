import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import * as domain from './domain.ts';
import * as picking from './pickingDocumentRows.ts';
import * as manual from './manualIssueQuantities.ts';
import * as catalog from './productCatalogSearch.ts';
import { knownRemainingQuantity, quantityNeedsReview } from './planImport.ts';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = ts.createSourceFile('page.tsx', readFileSync(new URL('../../app/(main)/planowanie-zapotrzebowania/page.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['numberValue', 'normalize', 'productIdentityMatches', 'technologyMatchesProduct', 'CATEGORIES', 'CATEGORY_ORDER',
  'materialKey', 'materialMatches', 'normalizedMaterialUnit', 'isKilogramUnit', 'isGramUnit', 'isThousandPiecesUnit',
  'roundTechnologyMaterialQuantity', 'canonicalProductIndex', 'linkedProductKey', 'linkedProductMatchesPlanItem',
  'linkedSourceSelectionForItem', 'linkedMachineProductQuantity', 'linkedWarehouseProductQuantity', 'linkedSurplusQuantity',
  'pickingRowWasWritten', 'planningAreas', 'areaName', 'technologiesFor', 'technologyById', 'calculationInputs', 'planningCalculations'];
const definitions = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.includes(node.name.text)) definitions.set(node.name.text, node.initializer.getText(source));
  ts.forEachChild(node, visit);
}
visit(source);
assert.equal(definitions.size, names.length);
const hooks = new Set(['planningAreas', 'areaName', 'technologiesFor', 'technologyById', 'calculationInputs', 'planningCalculations']);
const definition = name => `const ${name} = ${name === 'technologyMatchesProduct'
  ? `(...args) => { work.matches++; return (${definitions.get(name)})(...args); }`
  : definitions.get(name)};`;
const compiled = ts.transpileModule(names.filter(name => !hooks.has(name)).map(definition).join('\n') +
  `\nthis.render = (state, view = 'obliczenia') => { ${[...hooks].map(definition).join('\n')} return { model: planningCalculations, variants: technologiesFor }; };`,
{ compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function harness() {
  const memo = [];
  let cursor = 0;
  const work = { matches: 0, memoRuns: 0 };
  const memoize = (factory, deps) => {
    const index = cursor++;
    if (memo[index] && deps.every((value, position) => Object.is(value, memo[index].deps[position]))) return memo[index].value;
    work.memoRuns++;
    const value = factory();
    memo[index] = { deps, value };
    return value;
  };
  const context = vm.createContext({ ...domain, ...picking, ...manual, ...catalog,
    knownRemainingQuantity, quantityNeedsReview, work, useMemo: memoize, useCallback: (fn, deps) => memoize(() => fn, deps) });
  vm.runInContext(compiled, context);
  return { work, render(state, view) { cursor = 0; return context.render(state, view); } };
}

function fixture() {
  const material = { id: 'resin', code: 'RESIN', name: 'Resin', category: 'Tworzywo', unit: 'kg', usage: 0.2, logisticQty: 1 };
  const tech = (id, productIndex, usage) => ({ id, productIndex, productName: 'Shared product name', variant: 'base', alternativeNo: 0,
    archived: false, productionMode: 'planned', shiftNorm: 100, materials: [{ ...material, usage }], linkedProducts: [], surplusMaterials: [] });
  const item = (id, index, technologyId, areaId) => ({ id, index, name: 'Shared product name', technologyId, areaId,
    included: true, shiftNorm: 100, totalQty: 100, remainingQty: 100, quantityStatus: 'parsed', scopeMode: 'global',
    manualOverride: false, workingMaterials: null, linkedSources: {}, station: id });
  return {
    plan: [item('a', 'A100', 'tech-a', 'hala-1'), item('b', 'B200', 'tech-b', 'hala-2')],
    technologies: [tech('tech-a', 'A100', 0.2), tech('tech-b', 'B200', 0.1)],
    areas: [{ id: 'hala-1', name: 'Hall 1', shared: false }, { id: 'hala-2', name: 'Hall 2', shared: false }, { id: 'silos', name: 'Silo', shared: true }],
    inventory: [{ ...material, areaId: 'hala-1', qty: 5 }, { ...material, areaId: 'hala-2', qty: 5 }, { ...material, areaId: 'silos', qty: 10 }],
    documents: [], selectedAreaId: 'hala-1', selectedPlanDate: '2026-11-08', calculationMode: 'all', horizonShifts: 0.5,
    continuationBufferPercent: 0, archive: [], dailyPlans: {}, planVersions: [], updatedAt: ''
  };
}

test('memoized calculations retain shared-silo allocation and do not mutate source records', () => {
  const state = fixture();
  const before = JSON.stringify(state);
  const { model } = harness().render(state);
  const row = model.requirements[0];
  assert.equal(row.demand, 20);
  assert.equal(row.areaStock, 5);
  assert.equal(row.sharedStock, 10);
  assert.equal(row.toIssue, 7.5, '10 kg shared stock covers a common 20 kg shortage; H1 gets a 75 percent share');
  assert.equal(model.requirementsForArea('hala-2')[0].toIssue, 2.5);
  assert.equal(JSON.stringify(state), before);
});

test('status, history and unrelated settings reuse calculations instead of rebuilding the plan balance', () => {
  const h = harness();
  const state = fixture();
  const first = h.render(state);
  const runs = h.work.memoRuns;
  const next = h.render({ ...state, updatedAt: 'saved', archive: [{ old: true }], dailyPlans: { old: [] }, planVersions: [{}], returnStatuses: { x: true } });
  assert.equal(next.model, first.model);
  assert.equal(h.work.memoRuns, runs);
});

test('quantity changes refresh calculations but reuse product variants without rescanning the library', () => {
  const h = harness();
  const state = fixture();
  const first = h.render(state);
  const variants = first.variants(state.plan[0]);
  const matches = h.work.matches;
  const nextState = { ...state, plan: state.plan.map(item => item.id === 'a' ? { ...item, totalQty: 200, remainingQty: 200 } : item) };
  const next = h.render(nextState);
  assert.notEqual(next.model, first.model);
  assert.equal(next.model.requirements[0].demand, 40);
  assert.equal(next.variants(nextState.plan[0]), variants);
  assert.equal(h.work.matches, matches);
});

test('working recipes override library materials after recomputation without changing the base recipe', () => {
  const h = harness();
  const state = fixture();
  const first = h.render(state);
  const next = { ...state, plan: state.plan.map(item => item.id === 'a' ? { ...item, manualOverride: true,
    workingMaterials: [{ ...state.technologies[0].materials[0], usage: 0.4 }] } : item) };
  const model = h.render(next).model;
  assert.notEqual(model, first.model);
  assert.equal(model.requirements[0].demand, 40);
  assert.equal(state.technologies[0].materials[0].usage, 0.2);
});

test('changes in another hall refresh shared-stock distribution for the selected hall', () => {
  const h = harness();
  const state = fixture();
  h.render(state);
  const next = { ...state, plan: state.plan.map(item => item.id === 'b' ? { ...item, totalQty: 50, remainingQty: 50 } : item) };
  assert.equal(h.render(next).model.requirements[0].toIssue, 5);
});

test('new inventory snapshots refresh balances; no stock is written by the calculation model', () => {
  const h = harness();
  const state = fixture();
  h.render(state);
  const next = { ...state, inventory: state.inventory.map(row => row.areaId === 'silos' ? { ...row, qty: 0 } : row) };
  const before = JSON.stringify(next.inventory);
  assert.equal(h.render(next).model.requirements[0].toIssue, 15);
  assert.equal(JSON.stringify(next.inventory), before);
});

test('date, hall, range, continuation buffer, documents and library changes invalidate their results', () => {
  const patches = [
    { selectedPlanDate: '2026-11-09' }, { selectedAreaId: 'hala-2' }, { calculationMode: 'horizon' },
    { horizonShifts: 1 }, { continuationBufferPercent: 20 }, { documents: [] }, { technologies: [] },
    { areas: [] }
  ];
  for (const patch of patches) {
    const h = harness();
    const state = fixture();
    const first = h.render(state).model;
    assert.notEqual(h.render({ ...state, ...patch }).model, first, Object.keys(patch)[0]);
  }
  const h = harness();
  const state = { ...fixture(), calculationMode: 'horizon' };
  assert.equal(h.render(state).model.requirements[0].demand, 10);
  assert.equal(h.render({ ...state, continuationBufferPercent: 20 }).model.requirements[0].demand, 12);
});

test('issued document changes are reflected and remain scoped to the selected plan date', () => {
  const h = harness();
  const state = fixture();
  h.render(state);
  const next = { ...state, documents: [{ id: 'issued', areaId: 'hala-1', planDate: state.selectedPlanDate, status: 'issued', rows: [
    { key: 'resin|kg', toIssue: 4, confirmed: true }
  ] }] };
  assert.equal(h.render(next).model.requirements[0].issued, 4);
  assert.equal(h.render({ ...next, selectedPlanDate: '2026-11-09' }).model.requirements[0].issued, 0);
});

test('variant cache preserves strict product identity and assigned-family matching after a rename', () => {
  const h = harness();
  const state = fixture();
  const first = h.render(state);
  assert.deepEqual(Array.from(first.variants(state.plan[0]), row => row.id), ['tech-a']);
  assert.deepEqual(Array.from(first.variants({ ...state.plan[0], index: 'B200', technologyId: '' }), row => row.id), ['tech-b']);
  assert.deepEqual(Array.from(first.variants({ ...state.plan[0], index: 'OLD' }), row => row.id), ['tech-a']);
  const added = { ...state.technologies[0], id: 'alternative', variant: 'alternative', alternativeNo: 1 };
  const next = h.render({ ...state, technologies: [...state.technologies, added] });
  assert.deepEqual(Array.from(next.variants(state.plan[0]), row => row.id), ['tech-a', 'alternative']);
});

test('variant index retains no query cache and keeps known results after many unknown products', () => {
  const state = fixture();
  const { variants } = harness().render(state);
  const original = variants(state.plan[0]);
  assert.equal(variants(state.plan[0]), original);
  for (let index = 0; index < 513; index++) variants({ index: `unknown-${index}`, name: '', technologyId: '' });
  const restored = variants(state.plan[0]);
  assert.equal(restored, original);
  assert.deepEqual(Array.from(restored, row => row.id), ['tech-a']);
});

test('variant index agrees with original identity matching for zero-prefixed codes, empty codes and archived assignments', () => {
  const state = fixture();
  state.technologies.push(
    { ...state.technologies[0], id: 'numeric', productIndex: '01882' },
    { ...state.technologies[0], id: 'named', productIndex: '', productName: 'Only name' },
    { ...state.technologies[0], id: 'archived', archived: true }
  );
  const { variants } = harness().render(state);
  assert.deepEqual(Array.from(variants({ index: '1882', name: '' }), row => row.id), ['numeric']);
  assert.deepEqual(Array.from(variants({ index: '', name: 'ONLY NAME' }), row => row.id), ['named']);
  assert.deepEqual(Array.from(variants({ index: 'X999', name: 'Only name' }), row => row.id), []);
  assert.deepEqual(Array.from(variants({ index: 'OLD', name: '', technologyId: 'archived' }), row => row.id), ['tech-a']);
  assert.deepEqual(Array.from(variants({ index: 'B200', name: '', technologyId: 'tech-a' }), row => row.id), ['tech-a', 'tech-b']);
});
