export type PlanningSaveStatus = 'loading' | 'saved' | 'pending' | 'saving' | 'offline' | 'conflict' | 'error';

export type PlanningSaveInfo = {
  status: PlanningSaveStatus;
  pending: boolean;
  backupAvailable: boolean;
  error: string;
};

export type PlanningDraft<T> = {
  state: T;
  revision: number | null;
  pending: boolean;
  lastAttempt?: { state: T; revision: number };
};

export type PlanningRemote<T> = { state: T | null; revision: number };

export class PlanningSaveError extends Error {
  code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export const samePlanningState = (left: unknown, right: unknown): boolean => {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a).filter((key) => a[key] !== undefined);
  return keys.length === Object.keys(b).filter((key) => b[key] !== undefined).length
    && keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && samePlanningState(a[key], b[key]));
};

export const restorePlanningDraft = <T,>(
  remote: PlanningRemote<T>,
  local: PlanningDraft<T> | null,
  fallback: T
): PlanningDraft<T> & { conflict: boolean } => {
  if (!local?.pending) {
    return {
      state: remote.state ?? local?.state ?? fallback,
      revision: remote.revision,
      pending: remote.state === null && Boolean(local),
      conflict: false
    };
  }
  if (samePlanningState(remote.state, local.state)) {
    return { state: local.state, revision: remote.revision, pending: false, conflict: false };
  }
  const previousAttemptSaved = local.lastAttempt
    && remote.revision > local.lastAttempt.revision
    && samePlanningState(remote.state, local.lastAttempt.state);
  if (local.revision === remote.revision || (local.revision === null && remote.state === null) || previousAttemptSaved) {
    return { state: local.state, revision: remote.revision, pending: true, conflict: false };
  }
  return { ...local, conflict: true };
};

type Clock = {
  setTimeout: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
};

type AutosaveOptions<T> = {
  draft: PlanningDraft<T>;
  read: () => Promise<PlanningRemote<T>>;
  write: (state: T, revision: number) => Promise<number>;
  cache: (draft: PlanningDraft<T>) => void;
  onChange: (info: PlanningSaveInfo) => void;
  delay?: number;
  clock?: Clock;
};

const terminalErrors = new Set([
  'UNAUTHORIZED', 'FORBIDDEN', 'READ_ONLY', 'INVALID_STATE', 'INVALID_REVISION',
  'CONCURRENCY_MIGRATION_REQUIRED', 'MIGRATION_REQUIRED'
]);

export const createPlanningAutosave = <T,>(options: AutosaveOptions<T>) => {
  const clock: Clock = options.clock ?? {
    setTimeout: (callback, milliseconds) => globalThis.setTimeout(callback, milliseconds),
    clearTimeout: (timer) => globalThis.clearTimeout(timer)
  };
  const delay = options.delay ?? 700;
  let draft = { ...options.draft };
  let generation = 0;
  let status: PlanningSaveStatus = draft.pending ? 'pending' : 'saved';
  let error = '';
  let backupAvailable = false;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let cacheTimer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;
  let closing = false;
  let stopped = false;
  let failures = 0;

  const notify = () => options.onChange({ status, pending: draft.pending, backupAvailable, error });
  const clearSaveTimer = () => {
    if (saveTimer !== null) clock.clearTimeout(saveTimer);
    saveTimer = null;
  };
  const persist = () => {
    if (cacheTimer !== null) clock.clearTimeout(cacheTimer);
    cacheTimer = null;
    try {
      options.cache(draft);
      backupAvailable = true;
    } catch {
      backupAvailable = false;
    }
    notify();
  };
  const schedule = (milliseconds: number) => {
    clearSaveTimer();
    if (stopped || closing || !draft.pending || status === 'conflict' || status === 'error') return;
    saveTimer = clock.setTimeout(() => { saveTimer = null; void flush(); }, milliseconds);
  };

  const flush = (): Promise<void> => {
    clearSaveTimer();
    if (running) return running;
    if (stopped || !draft.pending || status === 'conflict' || status === 'error') return Promise.resolve();
    const request = async () => {
      status = 'saving';
      error = '';
      persist();
      try {
        // After a lost response, confirm the old attempt before sending a newer edit.
        if (draft.revision === null || draft.lastAttempt) {
          const remote = await options.read();
          const restored = restorePlanningDraft(remote, draft, draft.state);
          if (restored.conflict) throw new PlanningSaveError('REVISION_CONFLICT');
          draft = restored;
          if (!draft.pending) {
            status = 'saved';
            failures = 0;
            persist();
            return;
          }
        }
        const sentState = draft.state;
        const sentGeneration = generation;
        const revision = draft.revision;
        if (revision === null) throw new PlanningSaveError('INVALID_REVISION');
        draft = { ...draft, lastAttempt: { state: sentState, revision } };
        persist();
        const nextRevision = await options.write(sentState, revision);
        draft = { state: draft.state, revision: nextRevision, pending: generation !== sentGeneration };
        status = draft.pending ? 'pending' : 'saved';
        failures = 0;
        persist();
      } catch (failure) {
        error = failure instanceof PlanningSaveError ? failure.code : 'NETWORK_ERROR';
        if (error === 'REVISION_CONFLICT') {
          status = 'conflict';
          draft = { ...draft, lastAttempt: undefined };
        } else if (terminalErrors.has(error)) {
          status = 'error';
          draft = { ...draft, lastAttempt: undefined };
        } else {
          status = 'offline';
          failures += 1;
          if (failures > 3) error = 'RETRY_PAUSED';
        }
        persist();
      }
    };
    running = request().finally(() => {
      running = null;
      if (status === 'pending') schedule(delay);
      // Only unsaved work is retried, with a bounded backoff; idle plans never poll.
      if (status === 'offline' && failures <= 3) schedule([5000, 15000, 60000][failures - 1]);
    });
    return running;
  };

  return {
    getDraft: () => draft,
    getInfo: (): PlanningSaveInfo => ({ status, pending: draft.pending, backupAvailable, error }),
    setSnapshot(state: T, changed = false) {
      if (stopped) return;
      draft = { ...draft, state, pending: draft.pending || changed };
      if (changed) generation += 1;
      if (cacheTimer !== null) clock.clearTimeout(cacheTimer);
      cacheTimer = clock.setTimeout(persist, 200);
      if (changed) {
        if (status !== 'conflict' && status !== 'error' && status !== 'offline') status = running ? 'saving' : 'pending';
        if (status !== 'offline') schedule(delay);
        else if (saveTimer === null && failures <= 3) schedule(5000);
      }
      notify();
    },
    start() {
      notify();
      if (draft.pending) schedule(delay);
    },
    pause(nextStatus: 'offline' | 'conflict' | 'error', code: string) {
      clearSaveTimer();
      status = nextStatus;
      error = code;
      notify();
    },
    retry() {
      if (status === 'conflict' || stopped) return Promise.resolve();
      status = draft.pending ? 'pending' : 'saved';
      error = '';
      failures = 0;
      return flush();
    },
    persist,
    flush,
    async close() {
      if (stopped) return;
      closing = true;
      clearSaveTimer();
      persist();
      if (running) await running;
      if (draft.pending && status === 'pending') await flush();
      stopped = true;
      clearSaveTimer();
      persist();
    }
  };
};
