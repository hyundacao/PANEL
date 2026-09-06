'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createPlanningAutosave, PlanningSaveError, restorePlanningDraft,
  type PlanningDraft, type PlanningRemote, type PlanningSaveInfo
} from './autosave';

const finishingWrites = new Map<string, Promise<void>>();
const initialInfo: PlanningSaveInfo = { status: 'loading', pending: false, backupAvailable: false, error: '' };
type StateUpdate<T> = T | ((current: T) => T);

export const usePlanningAutosave = <T,>({
  initial, parse, prepare, storageKey, readOnly
}: {
  initial: () => T;
  parse: (value: unknown) => T | null;
  prepare: (state: T) => T;
  storageKey: string;
  readOnly: boolean;
}) => {
  const [state, setReactState] = useState(initial);
  const stateRef = useRef(state);
  const [hydrated, setHydrated] = useState(false);
  const [info, setInfo] = useState<PlanningSaveInfo>(initialInfo);
  const [reloadVersion, setReloadVersion] = useState(0);
  const engineRef = useRef<ReturnType<typeof createPlanningAutosave<T>> | null>(null);
  const restoredDraftRef = useRef<PlanningDraft<T> | null>(null);
  const writableRef = useRef(!readOnly);
  const cacheKey = storageKey + '-autosave-v1';

  useEffect(() => { writableRef.current = !readOnly; }, [readOnly]);

  const readRemote = useCallback(async (): Promise<PlanningRemote<T>> => {
    const response = await fetch('/api/planowanie-zapotrzebowania', {
      cache: 'no-store', signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new PlanningSaveError(response.status === 401 ? 'UNAUTHORIZED'
      : response.status === 403 ? 'FORBIDDEN' : 'LOAD_FAILED');
    const payload = await response.json() as { state?: unknown; revision?: number };
    const revision = Number(payload.revision ?? 0);
    if (!Number.isSafeInteger(revision) || revision < 0) throw new PlanningSaveError('INVALID_REVISION');
    if (payload.state != null && !parse(payload.state)) throw new PlanningSaveError('INVALID_STATE');
    return { state: (payload.state ?? null) as T | null, revision };
  }, [parse]);

  useEffect(() => {
    let active = true;
    let engine: ReturnType<typeof createPlanningAutosave<T>> | null = null;
    const load = async () => {
      await finishingWrites.get(cacheKey)?.catch(() => undefined);
      if (!active) return;
      let local: PlanningDraft<T> | null = restoredDraftRef.current;
      restoredDraftRef.current = null;
      if (!local) try {
        const cached = JSON.parse(window.localStorage.getItem(cacheKey) || 'null') as (PlanningDraft<T> & { format?: number }) | null;
        if (cached?.format === 1 && parse(cached.state)
          && (cached.revision === null || (Number.isSafeInteger(cached.revision) && cached.revision >= 0))) {
          local = { ...cached, pending: cached.pending === true };
        } else {
          const legacy = parse(JSON.parse(window.localStorage.getItem(storageKey) || 'null'));
          if (legacy) local = { state: legacy, revision: null, pending: false };
        }
      } catch {
        // An unavailable local cache must not prevent loading the shared plan.
      }
      let draft = local ?? { state: initial(), revision: null, pending: false };
      let loadError = '';
      let conflict = false;
      try {
        const remote = await readRemote();
        const restored = restorePlanningDraft(remote, local, initial());
        draft = restored;
        conflict = restored.conflict;
      } catch (failure) {
        loadError = failure instanceof PlanningSaveError ? failure.code : 'LOAD_FAILED';
      }
      if (!active) return;
      const nextState = prepare(parse(draft.state) ?? initial());
      stateRef.current = nextState;
      setReactState(nextState);
      engine = createPlanningAutosave<T>({
        draft: { ...draft, state: nextState },
        read: readRemote,
        write: async (next, revision) => {
          if (!writableRef.current) throw new PlanningSaveError('READ_ONLY');
          const body = JSON.stringify({ state: next, expectedRevision: revision });
          const response = await fetch('/api/planowanie-zapotrzebowania', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body,
            keepalive: new Blob([body]).size < 60000,
            signal: AbortSignal.timeout(15000)
          });
          if (response.status === 409) throw new PlanningSaveError('REVISION_CONFLICT');
          if (response.status === 401) throw new PlanningSaveError('UNAUTHORIZED');
          if (response.status === 403) throw new PlanningSaveError('FORBIDDEN');
          const payload = await response.json() as { revision?: number; code?: string };
          if (!response.ok) {
            throw new PlanningSaveError(payload.code ?? 'SAVE_FAILED');
          }
          const nextRevision = Number(payload.revision);
          if (!Number.isSafeInteger(nextRevision) || nextRevision <= revision) throw new PlanningSaveError('SAVE_FAILED');
          return nextRevision;
        },
        cache: (next) => window.localStorage.setItem(cacheKey, JSON.stringify({ format: 1, ...next })),
        onChange: (nextInfo) => { if (active) setInfo(nextInfo); }
      });
      engineRef.current = engine;
      if (!writableRef.current) engine.pause('error', 'READ_ONLY');
      else if (conflict) engine.pause('conflict', 'REVISION_CONFLICT');
      else if (loadError) engine.pause(
        ['UNAUTHORIZED', 'FORBIDDEN', 'INVALID_STATE', 'INVALID_REVISION'].includes(loadError) ? 'error' : 'offline',
        loadError
      );
      engine.persist();
      setHydrated(true);
      if (writableRef.current) engine.start();
    };
    void load();

    const leave = () => {
      engine?.persist();
      if (writableRef.current) void engine?.flush();
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      leave();
      if (writableRef.current && engine?.getDraft().pending) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const visibilityChange = () => { if (document.visibilityState === 'hidden') leave(); };
    const online = () => {
      if (engine?.getDraft().pending && writableRef.current) void engine.retry();
      else if (engine?.getInfo().error === 'LOAD_FAILED') {
        setHydrated(false);
        setInfo(initialInfo);
        setReloadVersion((value) => value + 1);
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('pagehide', leave);
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', visibilityChange);
    return () => {
      active = false;
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', visibilityChange);
      if (engine) {
        const closing = engine.close();
        finishingWrites.set(cacheKey, closing);
        void closing.finally(() => {
          if (finishingWrites.get(cacheKey) === closing) finishingWrites.delete(cacheKey);
        });
      }
      engineRef.current = null;
    };
  }, [cacheKey, storageKey, initial, parse, prepare, readRemote, reloadVersion]);

  const setState = useCallback((updater: StateUpdate<T>) => {
    const next = typeof updater === 'function' ? (updater as (current: T) => T)(stateRef.current) : updater;
    if (next === stateRef.current) return;
    stateRef.current = next;
    setReactState(next);
    engineRef.current?.setSnapshot(next);
  }, []);

  const changeState = useCallback((updater: (current: T) => T) => {
    if (!writableRef.current || !engineRef.current) return;
    const next = updater(stateRef.current);
    if (next === stateRef.current) return;
    stateRef.current = next;
    setReactState(next);
    engineRef.current.setSnapshot(next, true);
  }, []);

  const beginManualSave = useCallback(() => {
    engineRef.current?.beginManual();
  }, []);

  const commitManualSave = useCallback(async (): Promise<PlanningSaveInfo | null> => {
    const engine = engineRef.current;
    if (!engine || !writableRef.current) return null;
    await engine.commitManual();
    return engine.getInfo();
  }, []);

  const discardManualSave = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const restored = engine.discardManual();
    stateRef.current = restored;
    setReactState(restored);
  }, []);

  const retry = useCallback(() => {
    if (engineRef.current?.getDraft().pending) void engineRef.current.retry();
    else {
      setHydrated(false);
      setInfo(initialInfo);
      setReloadVersion((value) => value + 1);
    }
  }, []);

  const downloadDraft = useCallback(() => {
    const draft = engineRef.current?.getDraft();
    if (!draft) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(draft.state, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'planowanie-kopia-zmian.json';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  const loadLatest = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine || !window.confirm('Wczytać aktualną wersję z bazy? Niezapisane zmiany pozostaną w lokalnej kopii odzyskiwania. Przed wczytaniem możesz też pobrać kopię do pliku.')) return false;
    setHydrated(false);
    try {
      const remote = await readRemote();
      if (engineRef.current !== engine) return false;
      window.localStorage.setItem(cacheKey + '-recovery', JSON.stringify(engine.getDraft()));
      // Hand the confirmed version to the next mount without depending on another cache write.
      restoredDraftRef.current = { state: remote.state ?? initial(), revision: remote.revision, pending: false };
      setInfo(initialInfo);
      setReloadVersion((value) => value + 1);
      return true;
    } catch {
      setInfo((current) => ({ ...current, error: 'RELOAD_FAILED' }));
      setHydrated(true);
      return false;
    }
  }, [cacheKey, initial, readRemote]);

  return {
    state,
    setState,
    changeState,
    beginManualSave,
    commitManualSave,
    discardManualSave,
    hydrated,
    info,
    retry,
    downloadDraft,
    loadLatest
  };
};
