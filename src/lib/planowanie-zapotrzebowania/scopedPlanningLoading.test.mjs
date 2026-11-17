import assert from 'node:assert/strict';
import test from 'node:test';
import {
  combinePlanningState, planningTechnologyRequests, projectPlanningWorkspace,
  selectPlanningTechnologies, savePlanningTechnologyLibrary, savePlanningWorkspace,
  rebasePlanningTechnologyLibraryDraft
} from './stateScopes.ts';
import { restorePlanningDraft } from './autosave.ts';

const recipe = (id, productIndex, extra = {}) => ({ id, productIndex, productName: 'Same name',
  variant: 'base', materials: [{ code: 'ABS', usage: 0.248, unit: 'kg' }], ...extra });
const library = [recipe('a', 'A'), recipe('a-alt', 'A', { variant: 'alternative' }),
  recipe('b', 'B'), recipe('unrelated', 'OTHER'), recipe('zero', '01882')];
const storeFixture = () => {
  const rows = new Map([
    ['main', { state: { technologies: structuredClone(library), documents: [{ id: 'keep-doc' }],
      areas: [{ id: 'keep-area' }], unrelated: 'keep' }, revision: 4 }],
    ['workspace:me', { state: { selectedPlanDate: '2026-11-17',
      plan: [{ id: 'p', index: 'A', technologyId: 'a', manualOverride: true,
        workingMaterials: [{ code: 'OTHER-ABS', usage: 0.3, unit: 'kg' }] }],
      inventory: [{ code: 'ABS', qty: 100 }], archive: [{ id: 'keep-archive' }] }, revision: 7 }],
    ['workspace:other', { state: { plan: [{ technologyId: 'a' }] }, revision: 3 }]
  ]);
  const reads = [], writes = [];
  return { rows, reads, writes,
    read: async id => { reads.push(id); return structuredClone(rows.get(id) ?? { state: null, revision: 0 }); },
    save: async (id, state, revision) => {
      const current = rows.get(id);
      if (current.revision !== revision) return { conflict: true, revision: current.revision };
      writes.push(id);
      rows.set(id, { state: structuredClone(state), revision: revision + 1 });
      return { conflict: false, revision: revision + 1 };
    }
  };
};

test('a plan gets only its recipes and variants, not the full library or namesakes', () => {
  assert.deepEqual(selectPlanningTechnologies(library, [{ index: 'A', name: 'Same name' }]).map(row => row.id), ['a', 'a-alt']);
  assert.deepEqual(selectPlanningTechnologies(library, []).map(row => row.id), []);
  assert.deepEqual(selectPlanningTechnologies(library, [{ index: '1882' }]).map(row => row.id), ['zero']);
  assert.deepEqual(selectPlanningTechnologies(library, [{ index: 'M-10-1882' }]), []);
});

test('assigned recipe IDs survive a renamed product and retain the whole assigned family', () => {
  const renamed = library.map(row => row.productIndex === 'A' ? { ...row, productIndex: 'NEW' } : row);
  assert.deepEqual(selectPlanningTechnologies(renamed, [{ index: 'OLD', technologyId: 'a' }]).map(row => row.id), ['a', 'a-alt']);
});

test('linked recipes are loaded transitively with variants and cyclic links terminate', () => {
  const rows = [recipe('a', 'A', { linkedProducts: [{ productIndex: 'B' }] }),
    recipe('b', 'B', { linkedProducts: [{ productIndex: 'C' }] }), recipe('b-alt', 'B'),
    recipe('c', 'C', { linkedProducts: [{ productIndex: 'A' }] }), recipe('other', 'X')];
  const before = structuredClone(rows);
  assert.deepEqual(selectPlanningTechnologies(rows, [{ index: 'A' }]).map(row => row.id), ['a', 'b', 'b-alt', 'c']);
  assert.deepEqual(rows, before);
});

test('daily plans, archived assignments and saved plan versions keep their referenced recipes', () => {
  const state = { technologies: library, plan: [{ index: 'A' }],
    dailyPlans: { yesterday: [{ index: 'B' }] }, planVersions: [{ items: [{ index: '1882' }] }],
    archive: [{ planItem: { index: 'OLD', technologyId: 'unrelated' } }] };
  assert.equal(planningTechnologyRequests(state).length, 4);
  assert.deepEqual(projectPlanningWorkspace(state).technologies, library);
});

test('adding to the library does not read or overwrite a workspace, its working recipe, documents or stock', async () => {
  const store = storeFixture();
  const before = structuredClone(store.rows);
  const result = await savePlanningTechnologyLibrary(store, 'me', [...library, recipe('new', 'NEW')], library, 4, 'Me');
  assert.equal(result.ok, true);
  assert.deepEqual(store.reads, ['main']);
  assert.deepEqual(store.writes, ['main']);
  assert.deepEqual(store.rows.get('workspace:me'), before.get('workspace:me'));
  assert.deepEqual(store.rows.get('workspace:other'), before.get('workspace:other'));
  assert.deepEqual(store.rows.get('main').state.documents, before.get('main').state.documents);
  assert.deepEqual(store.rows.get('main').state.areas, before.get('main').state.areas);
  assert.equal(store.rows.get('main').state.unrelated, 'keep');
});

test('saving a scoped plan recipe cannot delete library recipes that were not loaded', async () => {
  const store = storeFixture();
  const projected = projectPlanningWorkspace(combinePlanningState(store.rows.get('workspace:me').state, store.rows.get('main').state));
  const baseline = projected.technologies;
  projected.technologies = projected.technologies.map(row => row.id === 'a'
    ? { ...row, notes: 'edited from plan' } : row);
  const result = await savePlanningWorkspace(store, 'me', projected, 7, 4, ['technologies'], undefined, 'Me', { technologies: baseline });
  assert.equal(result.ok, true);
  assert.deepEqual(store.rows.get('main').state.technologies.map(row => row.id), library.map(row => row.id));
  assert.equal(store.rows.get('main').state.technologies.find(row => row.id === 'a').notes, 'edited from plan');
  assert.equal(store.rows.get('workspace:me').state.plan[0].workingMaterials[0].usage, 0.3);
});

test('library conflicts are reported without writing either scope', async () => {
  const store = storeFixture();
  store.rows.get('main').state.technologies[0].notes = 'someone else';
  const proposed = library.map(row => row.id === 'a' ? { ...row, notes: 'mine' } : row);
  const result = await savePlanningTechnologyLibrary(store, 'me', proposed, library, 4, 'Me');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'SHARED_REVISION_CONFLICT');
  assert.deepEqual(store.writes, []);
});

test('explicit library deletion only clears the active assignment for this user, not archives or other users', async () => {
  const store = storeFixture();
  const beforeOther = structuredClone(store.rows.get('workspace:other'));
  const result = await savePlanningTechnologyLibrary(store, 'me', library.filter(row => row.id !== 'a'), library, 4, 'Me');
  assert.equal(result.ok, true);
  const workspace = store.rows.get('workspace:me').state;
  assert.equal(workspace.plan[0].technologyId, '');
  assert.equal(workspace.plan[0].workingMaterials, null);
  assert.deepEqual(workspace.inventory, [{ code: 'ABS', qty: 100 }]);
  assert.deepEqual(workspace.archive, [{ id: 'keep-archive' }]);
  assert.deepEqual(store.rows.get('workspace:other'), beforeOther);
  assert.deepEqual(store.rows.get('main').state.documents, [{ id: 'keep-doc' }]);
});

test('an offline library edit rebases onto another recipe edit and advances the library revision safely', () => {
  const baseline = { technologies: library };
  const local = { state: { plan: [], technologies: library.map(row => row.id === 'a' ? { ...row, notes: 'mine' } : row) }, revision: 4, pending: true };
  const remote = { state: { plan: [], technologies: library.map(row => row.id === 'b' ? { ...row, notes: 'other' } : row) }, revision: 5 };
  const rebased = rebasePlanningTechnologyLibraryDraft(baseline, local, remote);
  const restored = restorePlanningDraft(remote, rebased, {});
  assert.equal(restored.conflict, false);
  assert.equal(restored.pending, true);
  assert.equal(restored.revision, 5);
  assert.equal(restored.state.technologies.find(row => row.id === 'a').notes, 'mine');
  assert.equal(restored.state.technologies.find(row => row.id === 'b').notes, 'other');
});

test('a failed attempt followed by another library update cannot be mistaken for a lost successful save', () => {
  const baseline = { technologies: library };
  const changed = { plan: [], technologies: library.map(row => row.id === 'a' ? { ...row, notes: 'mine' } : row) };
  const local = { state: changed, revision: 4, pending: true, lastAttempt: { state: changed, revision: 4 } };
  const remote = { state: { plan: [], technologies: library.map(row => row.id === 'b' ? { ...row, notes: 'other' } : row) }, revision: 5 };
  const rebased = rebasePlanningTechnologyLibraryDraft(baseline, local, remote);
  assert.equal(rebased.state.technologies.find(row => row.id === 'a').notes, 'mine');
  assert.equal(rebased.state.technologies.find(row => row.id === 'b').notes, 'other');
});

test('a successful library save with a lost response is not replayed or allowed to remove newer recipes', () => {
  const baseline = { technologies: library };
  const changed = { plan: [], technologies: library.map(row => row.id === 'a' ? { ...row, notes: 'mine' } : row) };
  const local = { state: changed, revision: 4, pending: true, lastAttempt: { state: changed, revision: 4 } };
  const remote = { state: { plan: [], technologies: [...changed.technologies, recipe('new-remote', 'REMOTE')] }, revision: 6 };
  const rebased = rebasePlanningTechnologyLibraryDraft(baseline, local, remote);
  const restored = restorePlanningDraft(remote, rebased, {});
  assert.equal(restored.pending, false);
  assert.equal(restored.conflict, false);
  assert.equal(restored.state.technologies.at(-1).id, 'new-remote');
});

test('conflicting offline edits of the same recipe remain a conflict', () => {
  const local = { state: { technologies: library.map(row => row.id === 'a' ? { ...row, notes: 'mine' } : row) }, revision: 4, pending: true };
  const remote = { state: { technologies: library.map(row => row.id === 'a' ? { ...row, notes: 'other' } : row) }, revision: 5 };
  assert.equal(rebasePlanningTechnologyLibraryDraft({ technologies: library }, local, remote), null);
});
