import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  changedSharedPlanningFields,
  changedDocumentAreas,
  combinePlanningState,
  loadPlanningWorkspace,
  loadSharedPlanningSnapshot,
  mergeTechnologyChanges,
  planningWorkspaceId,
  privatePlanningState,
  prepareSharedPlanningUpdate,
  rebasePlanningWorkspaceDraft,
  rebaseSharedPlanningChanges,
  savePlanningWorkspace,
  sharedPlanningState,
  shouldInvalidatePlanDocument
} from './stateScopes.ts';
import { createPlanningAutosave, restorePlanningDraft, PlanningSaveError } from './autosave.ts';

test('private planning keeps separate plans while the library and documents stay shared', () => {
  const common = {
    technologies: [{ id: 'tech-1', name: 'Bazowa' }],
    documents: [{ id: 'document-hala-1', areaId: 'hala-1' }],
    areas: [{ id: 'hala-1' }, { id: 'hala-2' }]
  };
  const first = privatePlanningState({ ...common, plan: [{ id: 'item-1', areaId: 'hala-1' }], selectedAreaId: 'hala-1' });
  const second = privatePlanningState({ ...common, plan: [{ id: 'item-2', areaId: 'hala-2' }], selectedAreaId: 'hala-2' });

  assert.deepEqual(first.plan, [{ id: 'item-1', areaId: 'hala-1' }]);
  assert.deepEqual(second.plan, [{ id: 'item-2', areaId: 'hala-2' }]);
  assert.equal(Object.hasOwn(first, 'technologies'), false);
  assert.equal(Object.hasOwn(second, 'documents'), false);
  assert.deepEqual(combinePlanningState(first, common).technologies, common.technologies);
  assert.deepEqual(combinePlanningState(second, common).documents, common.documents);
});

test('saving a private calculation does not mark shared data as changed', () => {
  const baseline = { technologies: [{ id: 'tech-1' }], documents: [], inventory: [] };
  const next = { ...baseline, plan: [{ id: 'personal-result' }] };
  assert.deepEqual(changedSharedPlanningFields(sharedPlanningState(baseline), next), []);
});

test('only an actual technology edit requires a shared revision', () => {
  const baseline = { technologies: [{ id: 'tech-1', materials: [] }], documents: [] };
  const next = { technologies: [{ id: 'tech-1', materials: [{ code: 'ABS' }] }], documents: [] };
  assert.deepEqual(changedSharedPlanningFields(sharedPlanningState(baseline), next), ['technologies']);
});

test('a technology update does not block a document edit from another planner', () => {
  const baseline = { technologies: [], documents: [] };
  const afterTechnology = prepareSharedPlanningUpdate(
    baseline, 5, 5, ['technologies'], { technologies: [{ id: 'new-technology' }] }
  );
  assert.ok(afterTechnology);
  const afterDocument = prepareSharedPlanningUpdate(
    afterTechnology, 6, 5, ['documents'], { documents: [{ id: 'hala-2-document' }] }
  );
  assert.ok(afterDocument);
  assert.deepEqual(afterDocument.technologies, [{ id: 'new-technology' }]);
  assert.deepEqual(afterDocument.documents, [{ id: 'hala-2-document' }]);
});

test('a second edit to the same shared field must not overwrite the first', () => {
  const updated = prepareSharedPlanningUpdate(
    { technologies: [{ id: 'first' }], __sharedFieldRevisions: { technologies: 8 } },
    8, 7, ['technologies'], { technologies: [{ id: 'second' }] }
  );
  assert.equal(updated, null);
});

test('documents from different halls merge without overwriting either hall', () => {
  const hallOne = { id: 'doc-1', areaId: 'hala-1' };
  const hallTwo = { id: 'doc-2', areaId: 'hala-2' };
  const first = prepareSharedPlanningUpdate(
    { documents: [] }, 3, 3, ['documents'], { documents: [hallOne] }, ['hala-1']
  );
  assert.ok(first);
  const second = prepareSharedPlanningUpdate(
    first, 4, 3, ['documents'], { documents: [hallTwo] },
    changedDocumentAreas([], [hallTwo])
  );
  assert.ok(second);
  assert.deepEqual(second.documents, [hallTwo, hallOne]);
});

test('a stale edit to the same hall document is rejected', () => {
  const document = { id: 'doc-1', areaId: 'hala-1' };
  const first = prepareSharedPlanningUpdate(
    { documents: [] }, 3, 3, ['documents'], { documents: [document] }, ['hala-1']
  );
  assert.ok(first);
  const stale = prepareSharedPlanningUpdate(
    first, 4, 3, ['documents'], { documents: [{ ...document, status: 'issued' }] }, ['hala-1']
  );
  assert.equal(stale, null);
});

test('two distinct user IDs retain separate hall calculations after a shared technology update', () => {
  const shared = { technologies: [{ id: 'tech-1', materials: [] }], documents: [] };
  const workspaces = new Map();
  const firstUser = planningWorkspaceId('account-hala-1');
  const secondUser = planningWorkspaceId('account-hala-2');
  assert.notEqual(firstUser, secondUser);

  const firstDraft = { ...shared, selectedAreaId: 'hala-1', plan: [{ id: 'item-1', calculatedQty: 120 }] };
  const secondDraft = { ...shared, selectedAreaId: 'hala-2', plan: [{ id: 'item-2', calculatedQty: 90 }] };
  assert.deepEqual(changedSharedPlanningFields(sharedPlanningState(shared), firstDraft), []);
  assert.deepEqual(changedSharedPlanningFields(sharedPlanningState(shared), secondDraft), []);
  workspaces.set(firstUser, privatePlanningState(firstDraft));
  workspaces.set(secondUser, privatePlanningState(secondDraft));

  const updatedShared = prepareSharedPlanningUpdate(
    shared, 10, 10, ['technologies'],
    { technologies: [{ id: 'tech-1', materials: [{ code: 'ABS' }] }] }
  );
  assert.ok(updatedShared);
  const firstReload = combinePlanningState(workspaces.get(firstUser), updatedShared);
  const secondReload = combinePlanningState(workspaces.get(secondUser), updatedShared);
  assert.deepEqual(firstReload.plan, [{ id: 'item-1', calculatedQty: 120 }]);
  assert.deepEqual(secondReload.plan, [{ id: 'item-2', calculatedQty: 90 }]);
  assert.equal(firstReload.technologies[0].materials[0].code, 'ABS');
  assert.equal(secondReload.technologies[0].materials[0].code, 'ABS');
});

test('two user workspaces save in parallel and share technologies and area documents', async () => {
  const rows = new Map([['main', {
    state: { technologies: [{ id: 'base', materials: [] }], documents: [], plan: [] },
    revision: 7,
    updatedAt: null,
    updatedBy: null
  }]]);
  const empty = () => ({ state: null, revision: 0, updatedAt: null, updatedBy: null });
  const store = {
    async read(id) { return structuredClone(rows.get(id) ?? empty()); },
    async save(id, state, expectedRevision, updatedBy) {
      const current = rows.get(id) ?? empty();
      if (current.revision !== expectedRevision) return { conflict: true, revision: current.revision };
      const revision = current.revision + 1;
      rows.set(id, { state: structuredClone(state), revision, updatedAt: 'now', updatedBy });
      return { conflict: false, revision };
    }
  };
  const [first, second] = await Promise.all([
    loadPlanningWorkspace(store, 'worker-1'),
    loadPlanningWorkspace(store, 'worker-2')
  ]);
  const firstPlan = { ...first.state, selectedAreaId: 'hala-1', plan: [{ id: 'a', calculatedQty: 120 }] };
  const secondPlan = { ...second.state, selectedAreaId: 'hala-2', plan: [{ id: 'b', calculatedQty: 90 }] };
  const [firstSave, secondSave] = await Promise.all([
    savePlanningWorkspace(store, 'worker-1', firstPlan, 0, first.sharedRevision, [], [], 'Worker 1'),
    savePlanningWorkspace(store, 'worker-2', secondPlan, 0, second.sharedRevision, [], [], 'Worker 2')
  ]);
  assert.equal(firstSave.ok, true);
  assert.equal(secondSave.ok, true);
  assert.deepEqual((await loadPlanningWorkspace(store, 'worker-1')).state.plan, firstPlan.plan);
  assert.deepEqual((await loadPlanningWorkspace(store, 'worker-2')).state.plan, secondPlan.plan);

  const sharedTechnology = {
    ...firstPlan,
    technologies: [{ id: 'base', materials: [{ code: 'ABS' }] }]
  };
  const technologySave = await savePlanningWorkspace(
    store, 'worker-1', sharedTechnology, 1, first.sharedRevision,
    ['technologies'], [], 'Worker 1'
  );
  assert.equal(technologySave.ok, true);
  const secondReload = await loadPlanningWorkspace(store, 'worker-2');
  assert.deepEqual(secondReload.state.plan, secondPlan.plan);
  assert.equal(secondReload.state.technologies[0].materials[0].code, 'ABS');

  const firstReload = await loadPlanningWorkspace(store, 'worker-1');
  const firstDoc = { id: 'doc-a', areaId: 'hala-1' };
  const secondDoc = { id: 'doc-b', areaId: 'hala-2' };
  const [firstDocumentSave, secondDocumentSave] = await Promise.all([
    savePlanningWorkspace(store, 'worker-1', { ...firstReload.state, documents: [firstDoc] },
      firstReload.revision, firstReload.sharedRevision, ['documents'], [], 'Worker 1'),
    savePlanningWorkspace(store, 'worker-2', { ...secondReload.state, documents: [secondDoc] },
      secondReload.revision, secondReload.sharedRevision, ['documents'], [], 'Worker 2')
  ]);
  assert.equal(firstDocumentSave.ok, true);
  assert.equal(secondDocumentSave.ok, true);
  const finalDocuments = (await loadPlanningWorkspace(store, 'worker-1')).state.documents;
  assert.deepEqual(new Set(finalDocuments.map((document) => document.id)), new Set(['doc-a', 'doc-b']));
});

const baseLibrary = () => [{ id: 'left', materials: [{ code: 'ABS', usage: 1 }] }, { id: 'right', materials: [] }];
const memoryStore = (state) => {
  const rows = new Map([['main', { state: structuredClone(state), revision: 1, updatedAt: null, updatedBy: null }]]);
  const blank = () => ({ state: null, revision: 0, updatedAt: null, updatedBy: null });
  return {
    rows,
    async read(id) { return structuredClone(rows.get(id) ?? blank()); },
    async readRevision(id) { return (rows.get(id) ?? blank()).revision; },
    async save(id, next, expectedRevision, updatedBy) {
      const current = rows.get(id) ?? blank();
      if (current.revision !== expectedRevision) return { conflict: true, revision: current.revision };
      rows.set(id, { state: structuredClone(next), revision: current.revision + 1, updatedAt: null, updatedBy });
      return { conflict: false, revision: current.revision + 1 };
    }
  };
};

test('stock snapshots and sync timestamps belong to each personal calculation', async () => {
  const store = memoryStore({ plan: [], technologies: [], inventory: [{ qty: 10 }], inventorySourceDate: '2026-09-17' });
  const a = await loadPlanningWorkspace(store, 'a');
  const b = await loadPlanningWorkspace(store, 'b');
  assert.deepEqual(a.state.inventory, [{ qty: 10 }]);
  const first = { ...a.state, inventory: [{ qty: 20 }], inventorySyncedAt: '10:01' };
  const second = { ...b.state, inventory: [{ qty: 30 }], inventorySyncedAt: '10:02' };
  for (const next of [first, second]) assert.deepEqual(changedSharedPlanningFields(sharedPlanningState(a.state), next), []);
  const saved = await Promise.all([
    savePlanningWorkspace(store, 'a', first, 0, 1, [], [], 'a'),
    savePlanningWorkspace(store, 'b', second, 0, 1, [], [], 'b')
  ]);
  assert.ok(saved.every((result) => result.ok));
  assert.equal(store.rows.get('main').revision, 1);
  assert.equal((await loadPlanningWorkspace(store, 'a')).state.inventory[0].qty, 20);
  assert.equal((await loadPlanningWorkspace(store, 'b')).state.inventory[0].qty, 30);
});

test('concurrent users can edit different technologies without losing either private plan', async () => {
  const baseline = { technologies: baseLibrary(), documents: [], plan: [] };
  const store = memoryStore(baseline);
  const a = { ...baseline, plan: [{ qty: 700 }], technologies: baseLibrary() };
  const b = { ...baseline, plan: [{ qty: 1600 }], technologies: baseLibrary() };
  a.technologies[0].materials[0].usage = 2;
  b.technologies[1].materials = [{ code: 'POM', usage: 3 }];
  const saved = await Promise.all([
    savePlanningWorkspace(store, 'a', a, 0, 1, ['technologies'], [], 'a', baseline),
    savePlanningWorkspace(store, 'b', b, 0, 1, ['technologies'], [], 'b', baseline)
  ]);
  assert.ok(saved.every((result) => result.ok));
  const finalA = await loadPlanningWorkspace(store, 'a');
  const finalB = await loadPlanningWorkspace(store, 'b');
  assert.equal(finalA.state.technologies[0].materials[0].usage, 2);
  assert.equal(finalA.state.technologies[1].materials[0].code, 'POM');
  assert.deepEqual(finalA.state.plan, [{ qty: 700 }]);
  assert.deepEqual(finalB.state.plan, [{ qty: 1600 }]);
});

test('a real concurrent edit of the same material is rejected and keeps the first value', async () => {
  const baseline = { technologies: baseLibrary(), plan: [] };
  const store = memoryStore(baseline);
  const a = structuredClone(baseline);
  const b = structuredClone(baseline);
  a.technologies[0].materials[0].usage = 2;
  b.technologies[0].materials[0].usage = 3;
  assert.equal((await savePlanningWorkspace(store, 'a', a, 0, 1, ['technologies'], [], 'a', baseline)).ok, true);
  const conflict = await savePlanningWorkspace(store, 'b', b, 0, 1, ['technologies'], [], 'b', baseline);
  assert.equal(conflict.code, 'SHARED_REVISION_CONFLICT');
  assert.equal(store.rows.get('main').state.technologies[0].materials[0].usage, 2);
});

test('normalized defaults do not block a material edit and remote properties are preserved', () => {
  const raw = [{ id: 'a', materials: [] }];
  const baseline = [{ ...raw[0], productionMode: 'planned', shiftNorm: 0 }];
  const next = [{ ...baseline[0], materials: [{ code: 'PP' }] }];
  const result = mergeTechnologyChanges(baseline, next, [{ ...raw[0], description: 'remote' }]);
  assert.deepEqual(result, [{ id: 'a', description: 'remote', materials: [{ code: 'PP' }] }]);
  assert.equal(mergeTechnologyChanges(baseline, [], [{ ...raw[0], description: 'remote' }]), null);
});

test('independent additions and deletions merge, while editing a deleted technology conflicts', () => {
  const baseline = baseLibrary();
  const remote = [baseline[0], { id: 'new', materials: [] }];
  assert.deepEqual(mergeTechnologyChanges(baseline, [baseline[1]], remote), [{ id: 'new', materials: [] }]);
  const next = structuredClone(baseline);
  next[1].materials = [{ code: 'PP' }];
  assert.equal(mergeTechnologyChanges(baseline, next, remote), null);
});

test('cached pending edits rebase onto another users library and keep local quantities', () => {
  const baseline = { technologies: baseLibrary(), documents: [] };
  const local = { state: { ...structuredClone(baseline), plan: [{ qty: 700 }] }, revision: 4, pending: true };
  local.state.technologies[0].materials[0].usage = 2;
  const remote = { state: { ...structuredClone(baseline), plan: [{ qty: 100 }] }, revision: 4 };
  remote.state.technologies[1].materials = [{ code: 'PP' }];
  const rebased = rebasePlanningWorkspaceDraft(baseline, local, remote);
  const restored = restorePlanningDraft(remote, rebased, {});
  assert.equal(restored.conflict, false);
  assert.equal(restored.pending, true);
  assert.equal(restored.state.plan[0].qty, 700);
  assert.equal(restored.state.technologies[0].materials[0].usage, 2);
  assert.equal(restored.state.technologies[1].materials[0].code, 'PP');
});

test('separate hall documents rebase while a competing edit in the same hall conflicts', () => {
  const baseline = { documents: [], technologies: [] };
  const local = { ...baseline, documents: [{ id: 'a', areaId: 'hala-1' }] };
  const remote = { ...baseline, documents: [{ id: 'b', areaId: 'hala-2' }] };
  assert.equal(rebaseSharedPlanningChanges(baseline, local, remote).documents.length, 2);
  assert.equal(rebaseSharedPlanningChanges(baseline, local, {
    ...remote, documents: [{ id: 'c', areaId: 'hala-1' }]
  }), null);
});

test('a personal plan edit only invalidates its authors draft documents', () => {
  const document = { planDate: '2026-09-17', status: 'draft', createdBy: 'a' };
  assert.equal(shouldInvalidatePlanDocument(document, document.planDate, 'a'), true);
  assert.equal(shouldInvalidatePlanDocument(document, document.planDate, 'b'), false);
  assert.equal(shouldInvalidatePlanDocument({ ...document, status: 'issued' }, document.planDate, 'a'), false);
});

test('unchanged background refresh reads only a revision and returns no plan or library', async () => {
  const store = memoryStore({ technologies: baseLibrary(), plan: [{ confidential: true }], inventory: [{ qty: 10 }] });
  let fullReads = 0;
  const read = store.read;
  store.read = async (id) => { fullReads += 1; return read(id); };
  for (let i = 0; i < 10; i += 1) {
    assert.deepEqual(await loadSharedPlanningSnapshot(store, 1), { unchanged: true, sharedRevision: 1 });
  }
  assert.equal(fullReads, 0);
  const changed = await loadSharedPlanningSnapshot(store, 0);
  assert.equal(fullReads, 1);
  assert.deepEqual(changed.state.technologies, baseLibrary());
  assert.equal(Object.hasOwn(changed.state, 'plan'), false);
  assert.equal(Object.hasOwn(changed.state, 'inventory'), false);
});

test('lost successful response plus another users library change does not replay or delete shared data', async () => {
  const baseline = { technologies: baseLibrary(), plan: [], inventory: [], inventorySourceDate: '', inventorySyncedAt: '' };
  const store = memoryStore(baseline);
  let sharedBaseline = sharedPlanningState(baseline);
  let writes = 0;
  const engine = createPlanningAutosave({
    draft: { state: baseline, revision: 0, pending: false },
    read: async () => loadPlanningWorkspace(store, 'a'),
    restore: (remote, local, fallback) => {
      const rebased = rebasePlanningWorkspaceDraft(sharedBaseline, local, remote);
      if (!rebased) throw new PlanningSaveError('SHARED_REVISION_CONFLICT');
      sharedBaseline = sharedPlanningState(remote.state);
      return restorePlanningDraft(remote, rebased, fallback);
    },
    write: async (state, revision) => {
      writes += 1;
      const result = await savePlanningWorkspace(store, 'a', state, revision, 1, ['technologies'], [], 'a', sharedBaseline);
      assert.equal(result.ok, true);
      throw new Error('response lost');
    },
    cache: () => {}, onChange: () => {}
  });
  const edited = structuredClone(baseline);
  edited.technologies[0].materials[0].usage = 2;
  engine.setSnapshot(edited, true);
  await engine.flush();
  const other = await loadPlanningWorkspace(store, 'b');
  const otherEdit = structuredClone(other.state);
  otherEdit.technologies[0].materials[0].usage = 4;
  otherEdit.technologies.push({ id: 'added', materials: [] });
  assert.equal((await savePlanningWorkspace(store, 'b', otherEdit, 0, other.sharedRevision, ['technologies'], [], 'b', other.state)).ok, true);
  await engine.retry();
  assert.equal(engine.getInfo().status, 'saved');
  assert.equal(writes, 1);
  assert.equal(engine.getDraft().state.technologies[0].materials[0].usage, 4);
  assert.equal(engine.getDraft().state.technologies.at(-1).id, 'added');
  await engine.close();
});
