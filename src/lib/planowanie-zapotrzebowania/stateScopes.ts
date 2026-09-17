const sameSharedValue = (left: unknown, right: unknown): boolean => {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a).filter((key) => a[key] !== undefined);
  return keys.length === Object.keys(b).filter((key) => b[key] !== undefined).length
    && keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && sameSharedValue(a[key], b[key]));
};

export const SHARED_PLANNING_FIELDS = [
  'technologies',
  'areas',
  'stationMappings',
  'fixedDevices',
  'documents',
  'returnStatuses',
  'returnExclusions'
] as const;

export type SharedPlanningField = typeof SHARED_PLANNING_FIELDS[number];

export const planningWorkspaceId = (userId: string) => `workspace:${userId}`;

const sharedFieldSet = new Set<string>(SHARED_PLANNING_FIELDS);

export const isSharedPlanningField = (value: string): value is SharedPlanningField => sharedFieldSet.has(value);

export const sharedPlanningState = (state: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(SHARED_PLANNING_FIELDS.filter((key) => Object.prototype.hasOwnProperty.call(state, key))
    .map((key) => [key, state[key]]));

export const privatePlanningState = (state: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(state).filter(([key]) => !sharedFieldSet.has(key)));

export const combinePlanningState = (workspace: Record<string, unknown>, shared: Record<string, unknown>) => ({
  // Older workspaces inherited their stock snapshot from the shared record.
  inventory: shared.inventory ?? [],
  inventorySourceDate: shared.inventorySourceDate ?? '',
  inventorySyncedAt: shared.inventorySyncedAt ?? '',
  ...workspace,
  ...sharedPlanningState(shared)
});

export const changedSharedPlanningFields = (
  baseline: Record<string, unknown>,
  next: Record<string, unknown>
): SharedPlanningField[] => SHARED_PLANNING_FIELDS.filter((key) => !sameSharedValue(baseline[key], next[key]));

type TechnologyItem = { id: string; [key: string]: unknown };

const technologyItems = (value: unknown): TechnologyItem[] | null => {
  if (value == null) return [];
  if (!Array.isArray(value)) return null;
  const ids = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id || ids.has(item.id)) return null;
    ids.add(item.id);
  }
  return value as TechnologyItem[];
};

export const mergeTechnologyChanges = (baseline: unknown, next: unknown, current: unknown): TechnologyItem[] | null => {
  const before = technologyItems(baseline);
  const edited = technologyItems(next);
  const stored = technologyItems(current);
  if (!before || !edited || !stored) return null;
  const beforeById = new Map(before.map((item) => [item.id, item]));
  const editedById = new Map(edited.map((item) => [item.id, item]));
  const storedById = new Map(stored.map((item) => [item.id, item]));
  const changes = new Map<string, TechnologyItem | null>();

  for (const id of new Set([...beforeById.keys(), ...editedById.keys()])) {
    const previous = beforeById.get(id);
    const proposed = editedById.get(id);
    if (sameSharedValue(previous, proposed)) continue;
    const latest = storedById.get(id);
    if (!previous && proposed) {
      if (latest && !sameSharedValue(latest, proposed)) return null;
      changes.set(id, proposed);
    } else if (previous && !proposed) {
      if (latest && !sameSharedValue(latest, previous)) return null;
      changes.set(id, null);
    } else if (previous && proposed) {
      if (!latest) return null;
      const merged = { ...latest };
      for (const key of new Set([...Object.keys(previous), ...Object.keys(proposed)])) {
        if (sameSharedValue(previous[key], proposed[key])) continue;
        if (!sameSharedValue(latest[key], previous[key]) && !sameSharedValue(latest[key], proposed[key])) return null;
        if (Object.prototype.hasOwnProperty.call(proposed, key)) merged[key] = proposed[key];
        else delete merged[key];
      }
      changes.set(id, merged);
    }
  }

  return [
    ...stored.filter((item) => changes.get(item.id) !== null).map((item) => changes.get(item.id) ?? item),
    ...edited.filter((item) => !storedById.has(item.id) && changes.get(item.id) != null)
  ];
};

type AreaDocument = { areaId: string; id: string; [key: string]: unknown };

export const areaDocuments = (value: unknown): AreaDocument[] | null => {
  if (value == null) return [];
  if (!Array.isArray(value)) return null;
  if (!value.every((item) => item && typeof item === 'object' &&
    typeof item.areaId === 'string' && item.areaId && typeof item.id === 'string' && item.id)) return null;
  return value as AreaDocument[];
};

export const changedDocumentAreas = (baseline: unknown, next: unknown): string[] | null => {
  const previousDocuments = areaDocuments(baseline);
  const nextDocuments = areaDocuments(next);
  if (!previousDocuments || !nextDocuments) return null;
  const areas = new Set([...previousDocuments, ...nextDocuments].map((document) => document.areaId));
  return [...areas].filter((areaId) => !sameSharedValue(
    previousDocuments.filter((document) => document.areaId === areaId),
    nextDocuments.filter((document) => document.areaId === areaId)
  ));
};

export const rebaseSharedPlanningChanges = (
  baseline: Record<string, unknown>,
  local: Record<string, unknown>,
  remote: Record<string, unknown>
): Record<string, unknown> | null => {
  const merged = sharedPlanningState(remote);
  for (const field of changedSharedPlanningFields(baseline, local)) {
    if (field === 'technologies') {
      const technologies = mergeTechnologyChanges(baseline.technologies, local.technologies, remote.technologies);
      if (!technologies) return null;
      merged.technologies = technologies;
    } else if (field === 'documents') {
      const changedAreas = changedDocumentAreas(baseline.documents, local.documents);
      const previous = areaDocuments(baseline.documents);
      const edited = areaDocuments(local.documents);
      const stored = areaDocuments(remote.documents);
      if (!changedAreas || !previous || !edited || !stored) return null;
      for (const areaId of changedAreas) {
        const previousArea = previous.filter((document) => document.areaId === areaId);
        const storedArea = stored.filter((document) => document.areaId === areaId);
        const editedArea = edited.filter((document) => document.areaId === areaId);
        if (!sameSharedValue(storedArea, previousArea) && !sameSharedValue(storedArea, editedArea)) return null;
      }
      const changed = new Set(changedAreas);
      merged.documents = [
        ...edited.filter((document) => changed.has(document.areaId)),
        ...stored.filter((document) => !changed.has(document.areaId))
      ];
    } else {
      if (!sameSharedValue(remote[field], baseline[field]) && !sameSharedValue(remote[field], local[field])) return null;
      merged[field] = local[field];
    }
  }
  return merged;
};

export const rebasePlanningWorkspaceDraft = <T,>(
  baseline: Record<string, unknown> | null,
  local: { state: T; revision: number | null; pending: boolean; lastAttempt?: { state: T; revision: number } },
  remote: { state: T | null; revision: number }
) => {
  if (!remote.state || !local.pending) return local;
  const remoteState = remote.state as Record<string, unknown>;
  const localState = local.state as Record<string, unknown>;
  const remoteShared = sharedPlanningState(remoteState);
  const attemptSaved = local.lastAttempt && remote.revision > local.lastAttempt.revision && sameSharedValue(
    privatePlanningState(remoteState), privatePlanningState(local.lastAttempt.state as Record<string, unknown>)
  );
  const mergeBase = attemptSaved ? sharedPlanningState(local.lastAttempt!.state as Record<string, unknown>) : baseline;
  const shared = mergeBase ? rebaseSharedPlanningChanges(mergeBase, localState, remoteState)
    : sameSharedValue(sharedPlanningState(localState), remoteShared) ? remoteShared : null;
  if (!shared) return null;
  return {
    ...local,
    state: combinePlanningState(localState, shared) as T,
    // A lost response is identified by the user's private workspace, independently
    // of later library updates from other users.
    lastAttempt: attemptSaved ? {
      ...local.lastAttempt!,
      state: combinePlanningState(local.lastAttempt!.state as Record<string, unknown>, remoteShared) as T
    } : local.lastAttempt
  };
};

export const shouldInvalidatePlanDocument = (
  document: { planDate: string; status: string; createdBy: string }, planDate: string, author: string
) => document.planDate === planDate && document.status === 'draft' && document.createdBy === author;

export const prepareSharedPlanningUpdate = (
  current: Record<string, unknown>,
  currentRevision: number,
  expectedRevision: number,
  changedFields: SharedPlanningField[],
  next: Record<string, unknown>,
  documentAreas: string[] | null = null,
  baseline: Record<string, unknown> | null = null
): Record<string, unknown> | null => {
  const recorded = current.__sharedFieldRevisions && typeof current.__sharedFieldRevisions === 'object'
    ? current.__sharedFieldRevisions as Record<string, unknown> : {};
  const fieldRevisions = Object.fromEntries(SHARED_PLANNING_FIELDS.map((field) => {
    const revision = Number(recorded[field]);
    return [field, Number.isSafeInteger(revision) && revision >= 0 ? revision : currentRevision];
  }));
  if (baseline) {
    const pickChanged = (value: Record<string, unknown>) => Object.fromEntries(changedFields.map((field) => [field, value[field]]));
    const merged = rebaseSharedPlanningChanges(pickChanged(baseline), pickChanged(next), current);
    if (!merged) return null;
    const storedAreaRevisions = current.__documentAreaRevisions && typeof current.__documentAreaRevisions === 'object'
      ? current.__documentAreaRevisions as Record<string, unknown> : {};
    const areaRevisions = { ...storedAreaRevisions };
    for (const field of changedFields) fieldRevisions[field] = currentRevision + 1;
    for (const area of documentAreas ?? []) areaRevisions[area] = currentRevision + 1;
    return { ...current, ...merged, __sharedFieldRevisions: fieldRevisions, __documentAreaRevisions: areaRevisions };
  }
  const currentDocuments = areaDocuments(current.documents);
  const nextDocuments = areaDocuments(next.documents);
  const useAreaDocuments = changedFields.includes('documents') && documentAreas !== null
    && currentDocuments !== null && nextDocuments !== null;
  if (changedFields.some((field) =>
    !(field === 'documents' && useAreaDocuments) &&
    fieldRevisions[field] > expectedRevision
  )) return null;
  const updated = { ...current };
  for (const field of changedFields) {
    if (field === 'documents' && useAreaDocuments) continue;
    updated[field] = next[field];
    fieldRevisions[field] = currentRevision + 1;
  }
  if (useAreaDocuments) {
    const storedAreaRevisions = current.__documentAreaRevisions && typeof current.__documentAreaRevisions === 'object'
      ? current.__documentAreaRevisions as Record<string, unknown> : {};
    const areaRevisions: Record<string, number> = {};
    for (const areaId of new Set([
      ...currentDocuments.map((document) => document.areaId),
      ...Object.keys(storedAreaRevisions)
    ])) {
      const recordedRevision = Number(storedAreaRevisions[areaId]);
      areaRevisions[areaId] = Number.isSafeInteger(recordedRevision) && recordedRevision >= 0
        ? recordedRevision : fieldRevisions.documents;
    }
    for (const areaId of documentAreas) {
      if ((areaRevisions[areaId] ?? 0) > expectedRevision) return null;
      areaRevisions[areaId] = currentRevision + 1;
    }
    const changedAreas = new Set(documentAreas);
    updated.documents = [
      ...nextDocuments.filter((document) => changedAreas.has(document.areaId)),
      ...currentDocuments.filter((document) => !changedAreas.has(document.areaId))
    ];
    updated.__documentAreaRevisions = areaRevisions;
    fieldRevisions.documents = currentRevision + 1;
  }
  updated.__sharedFieldRevisions = fieldRevisions;
  return updated;
};

export type PlanningRecord = {
  state: unknown;
  updatedAt: string | null;
  updatedBy: string | null;
  revision: number;
};

export type PlanningStore = {
  read: (id: string) => Promise<PlanningRecord>;
  readRevision?: (id: string) => Promise<number>;
  save: (id: string, state: Record<string, unknown>, revision: number, updatedBy: string) => Promise<{
    revision: number;
    conflict: boolean;
  }>;
};

export const loadSharedPlanningSnapshot = async (store: PlanningStore, knownRevision: number | null) => {
  if (knownRevision !== null && store.readRevision) {
    const revision = await store.readRevision('main');
    if (revision === knownRevision) return { unchanged: true as const, sharedRevision: revision };
  }
  const record = await store.read('main');
  return {
    unchanged: false as const,
    sharedRevision: record.revision,
    state: sharedPlanningState(record.state && typeof record.state === 'object'
      ? record.state as Record<string, unknown> : {})
  };
};

export const loadPlanningWorkspace = async (store: PlanningStore, userId: string) => {
  const [shared, workspace] = await Promise.all([
    store.read('main'),
    store.read(planningWorkspaceId(userId))
  ]);
  // The legacy shared plan is a starting copy until this user saves a workspace.
  const personalState = workspace.state ?? shared.state;
  return {
    state: personalState === null ? null : combinePlanningState(
      personalState && typeof personalState === 'object' && !Array.isArray(personalState)
        ? personalState as Record<string, unknown> : {},
      shared.state && typeof shared.state === 'object' && !Array.isArray(shared.state)
        ? shared.state as Record<string, unknown> : {}
    ),
    revision: workspace.revision,
    sharedRevision: shared.revision,
    updatedAt: workspace.updatedAt ?? shared.updatedAt,
    updatedBy: workspace.updatedBy ?? shared.updatedBy,
    shared
  };
};

export const savePlanningWorkspace = async (
  store: PlanningStore,
  userId: string,
  state: Record<string, unknown>,
  expectedRevision: number,
  expectedSharedRevision: number,
  changedFields: SharedPlanningField[],
  documentBaseline: unknown,
  updatedBy: string,
  baseline: Record<string, unknown> | null = null
): Promise<
  | { ok: true; revision: number; sharedRevision: number; sharedSaved: PlanningRecord | null }
  | { ok: false; code: string; revision?: number; sharedRevision?: number }
> => {
  const documentAreas = changedFields.includes('documents')
    ? changedDocumentAreas(baseline ? baseline.documents : documentBaseline, state.documents) : null;
  if (changedFields.includes('documents') && documentAreas === null) {
    return { ok: false, code: 'INVALID_DOCUMENTS' };
  }
  if (changedFields.includes('technologies') && baseline &&
    (!technologyItems(baseline.technologies) || !technologyItems(state.technologies))) {
    return { ok: false, code: 'INVALID_TECHNOLOGIES' };
  }
  const workspaceId = planningWorkspaceId(userId);
  let sharedRevision = expectedSharedRevision;
  let sharedSaved: PlanningRecord | null = null;
  if (changedFields.length) {
    const currentWorkspace = await store.read(workspaceId);
    if (currentWorkspace.revision !== expectedRevision) {
      return { ok: false, code: 'REVISION_CONFLICT', revision: currentWorkspace.revision };
    }
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const shared = await store.read('main');
      const updatedShared = prepareSharedPlanningUpdate(
        shared.state && typeof shared.state === 'object' && !Array.isArray(shared.state)
          ? shared.state as Record<string, unknown> : {},
        shared.revision, expectedSharedRevision, changedFields, state, documentAreas, baseline
      );
      if (!updatedShared) return { ok: false, code: 'SHARED_REVISION_CONFLICT', revision: shared.revision };
      const result = await store.save('main', updatedShared, shared.revision, updatedBy);
      if (result.conflict) continue;
      sharedRevision = result.revision;
      sharedSaved = {
        state: updatedShared,
        revision: sharedRevision,
        updatedAt: new Date().toISOString(),
        updatedBy
      };
      break;
    }
    if (!sharedSaved) return { ok: false, code: 'SHARED_REVISION_CONFLICT' };
  }
  const workspace = await store.save(workspaceId, privatePlanningState(state), expectedRevision, updatedBy);
  if (workspace.conflict) return {
    ok: false,
    code: changedFields.length ? 'PARTIAL_SAVE_CONFLICT' : 'REVISION_CONFLICT',
    revision: workspace.revision,
    sharedRevision
  };
  return { ok: true, revision: workspace.revision, sharedRevision, sharedSaved };
};
