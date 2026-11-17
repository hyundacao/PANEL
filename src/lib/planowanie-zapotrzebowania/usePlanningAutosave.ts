'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createPlanningAutosave, PlanningSaveError, restorePlanningDraft,
  type PlanningDraft, type PlanningRemote, type PlanningSaveInfo
} from './autosave';
import {
  changedSharedPlanningFields, combinePlanningState, privatePlanningState,
  rebasePlanningWorkspaceDraft, rebasePlanningTechnologyLibraryDraft, rebaseSharedPlanningChanges, sharedPlanningState,
  type PlanningLoadScope, type PlanningTechnologyRequest
} from './stateScopes';
import { encodePlanningSave, PlanningSaveTransportError } from './saveTransport';
import { readPlanningDraftCache, writePlanningDraftCache, removePlanningDraftCache } from './draftCache';

const finishingWrites = new Map<string, Promise<void>>();
const initialInfo: PlanningSaveInfo = { status: 'loading', pending: false, backupAvailable: false, error: '' };
type StateUpdate<T> = T | ((current: T) => T);

export const usePlanningAutosave = <T,>({
  initial, parse, prepare, storageKey, readOnly, sharedRefreshEnabled = true, scope = 'workspace'
}: {
  initial: () => T;
  parse: (value: unknown) => T | null;
  prepare: (state: T) => T;
  storageKey: string;
  readOnly: boolean;
  sharedRefreshEnabled?: boolean;
  scope?: PlanningLoadScope;
}) => {
  const [state, setReactState] = useState(initial);
  const stateRef = useRef(state);
  const [hydratedKey, setHydratedKey] = useState('');
  const [info, setInfo] = useState<PlanningSaveInfo>(initialInfo);
  const [reloadVersion, setReloadVersion] = useState(0);
  const engineRef = useRef<ReturnType<typeof createPlanningAutosave<T>> | null>(null);
  const writableRef = useRef(!readOnly);
  const sharedRevisionRef = useRef<number | null>(null);
  const sharedBaselineRef = useRef<Record<string, unknown> | null>(null);
  const needsSharedRefreshRef = useRef(false);
  const cacheKey = storageKey + (scope === 'technology-library' ? '-technology-library' : '') + '-autosave-v1';
  const hydrated = hydratedKey === cacheKey;
  const legacyRecoveryRef = useRef(false);

  useEffect(() => { writableRef.current = !readOnly; }, [readOnly]);

  const adoptRemote = useCallback((remote: PlanningRemote<T>) => {
    sharedRevisionRef.current = remote.sharedRevision ?? 0;
    sharedBaselineRef.current = remote.state ? sharedPlanningState(remote.state as Record<string, unknown>) : {};
    needsSharedRefreshRef.current = false;
  }, []);

  const readRemote = useCallback(async (known?: { state: T; revision: number }): Promise<PlanningRemote<T>> => {
    const params = new URLSearchParams();
    if (!legacyRecoveryRef.current) params.set('scope', scope);
    if (known && sharedRevisionRef.current !== null) {
      params.set('revision', String(known.revision));
      params.set('sharedRevision', String(sharedRevisionRef.current));
    }
    const response = await fetch(`/api/planowanie-zapotrzebowania?${params}`, {
      cache: 'no-store', signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new PlanningSaveError(response.status === 401 ? 'UNAUTHORIZED'
      : response.status === 403 ? 'FORBIDDEN' : 'LOAD_FAILED');
    const payload = await response.json() as { state?: unknown; revision?: number; sharedRevision?: number; unchanged?: boolean };
    const revision = Number(payload.revision ?? 0);
    if (!Number.isSafeInteger(revision) || revision < 0) throw new PlanningSaveError('INVALID_REVISION');
    const sharedRevision = Number(payload.sharedRevision ?? 0);
    if (!Number.isSafeInteger(sharedRevision) || sharedRevision < 0) throw new PlanningSaveError('INVALID_REVISION');
    if (payload.unchanged) {
      if (!known || revision !== known.revision || sharedRevision !== sharedRevisionRef.current) throw new PlanningSaveError('INVALID_STATE');
      return { state: known.state, revision, sharedRevision };
    }
    const parsedState = payload.state == null ? null : parse(payload.state);
    if (payload.state != null && !parsedState) throw new PlanningSaveError('INVALID_STATE');
    return { state: parsedState, revision, sharedRevision };
  }, [parse, scope]);

  useEffect(() => {
    let active = true;
    let engine: ReturnType<typeof createPlanningAutosave<T>> | null = null;
    const load = async () => {
      await finishingWrites.get(storageKey)?.catch(() => undefined);
      if (!active) return;
      let local: PlanningDraft<T> | null = null;
      let localSharedBaseline: Record<string, unknown> | null = null;
      let localSharedRevision: number | null = null;
      let localSharedRefreshRequired = false;
      let localScopeMatches = false;
      try {
        const cached = JSON.parse(await readPlanningDraftCache(cacheKey) || 'null') as (PlanningDraft<T> & {
          format?: number;
          sharedRevision?: number;
          sharedBaseline?: Record<string, unknown>;
          sharedRefreshRequired?: boolean;
          loadScope?: string;
        }) | null;
        const supportedFormat = cached?.format === 1 || cached?.format === 2 || cached?.format === 3;
        const parsedCachedState = supportedFormat ? parse(cached.state) : null;
        if (supportedFormat && parsedCachedState
          && (cached.revision === null || (Number.isSafeInteger(cached.revision) && cached.revision >= 0))) {
          const parsedLastAttemptState = cached.lastAttempt ? parse(cached.lastAttempt.state) : null;
          local = {
            ...cached,
            state: parsedCachedState,
            pending: cached.pending === true,
            lastAttempt: cached.lastAttempt && parsedLastAttemptState
              ? { ...cached.lastAttempt, state: parsedLastAttemptState }
              : undefined
          };
          localScopeMatches = cached.loadScope === scope;
          if ((cached.format === 2 || cached.format === 3) && Number.isSafeInteger(cached.sharedRevision) &&
            cached.sharedRevision! >= 0 && cached.sharedBaseline && typeof cached.sharedBaseline === 'object') {
            localSharedRevision = cached.sharedRevision!;
            localSharedBaseline = cached.sharedBaseline;
            localSharedRefreshRequired = cached.sharedRefreshRequired === true;
          }
        } else {
          const legacy = scope === 'workspace' ? parse(JSON.parse(window.localStorage.getItem(storageKey) || 'null')) : null;
          if (legacy) local = { state: legacy, revision: null, pending: false };
        }
      } catch {
        // An unavailable local cache must not prevent loading the shared plan.
      }
      // Recover an old unsaved full-state draft before switching it to scoped reads.
      legacyRecoveryRef.current = scope === 'workspace' && Boolean(local?.pending) && !localScopeMatches;
      sharedRevisionRef.current = localSharedRevision;
      sharedBaselineRef.current = localSharedBaseline;
      needsSharedRefreshRef.current = localSharedRefreshRequired;
      let draft = local ?? { state: initial(), revision: null, pending: false };
      let loadError = '';
      let conflict = false;
      let sharedConflict = false;
      try {
        const remote = await readRemote(localScopeMatches && local && !local.pending && !localSharedRefreshRequired && local.revision !== null
          ? { state: local.state, revision: local.revision }
          : undefined);
        if (!active) return;
        if (local?.pending && remote.state) {
          const rebased = scope === 'technology-library'
            ? rebasePlanningTechnologyLibraryDraft(localSharedBaseline, local, remote)
            : rebasePlanningWorkspaceDraft(localSharedBaseline, local, remote);
          if (rebased) local = rebased;
          else sharedConflict = true;
        }
        const restored = restorePlanningDraft(remote, local, initial());
        draft = restored;
        conflict = restored.conflict || sharedConflict;
        if (!conflict) adoptRemote(remote);
      } catch (failure) {
        loadError = failure instanceof PlanningSaveError ? failure.code : 'LOAD_FAILED';
      }
      if (!active) return;
      const nextState = prepare(draft.state);
      stateRef.current = nextState;
      setReactState(nextState);
      engine = createPlanningAutosave<T>({
        draft: { ...draft, state: nextState },
        read: readRemote,
        restore: (remote, local, fallback) => {
          const rebased = local ? scope === 'technology-library'
            ? rebasePlanningTechnologyLibraryDraft(sharedBaselineRef.current, local, remote)
            : rebasePlanningWorkspaceDraft(sharedBaselineRef.current, local, remote) : null;
          if (local && !rebased) throw new PlanningSaveError('SHARED_REVISION_CONFLICT');
          const restored = restorePlanningDraft(remote, rebased, fallback);
          if (!restored.conflict) {
            adoptRemote(remote);
            stateRef.current = restored.state;
            if (active) setReactState(restored.state);
          }
          return restored;
        },
        write: async (next, revision) => {
          if (!writableRef.current) throw new PlanningSaveError('READ_ONLY');
          const changedSharedFields = scope === 'technology-library' ? ['technologies'] as const : changedSharedPlanningFields(
            sharedBaselineRef.current ?? {}, next as Record<string, unknown>
          );
          const payload = {
            scope: scope === 'technology-library' ? scope : undefined,
            state: {
              ...(scope === 'workspace' ? privatePlanningState(next as Record<string, unknown>) : {}),
              ...Object.fromEntries(changedSharedFields.map((field) => [field, (next as Record<string, unknown>)[field]]))
            },
            expectedRevision: revision,
            expectedSharedRevision: sharedRevisionRef.current,
            changedSharedFields,
            ...(changedSharedFields.length ? {
              sharedBaseline: Object.fromEntries(changedSharedFields.map((field) => [field, sharedBaselineRef.current?.[field]]))
            } : {})
          };
          let encoded: Awaited<ReturnType<typeof encodePlanningSave>>;
          try { encoded = await encodePlanningSave(payload); }
          catch (error) {
            if (error instanceof PlanningSaveTransportError) throw new PlanningSaveError(error.code);
            throw error;
          }
          const response = await fetch('/api/planowanie-zapotrzebowania', {
            method: 'PUT',
            ...encoded,
            signal: AbortSignal.timeout(30000)
          });
          if (response.status === 413) throw new PlanningSaveError('PLANNING_PAYLOAD_TOO_LARGE');
          if (response.status === 409) {
            const conflict = await response.json() as { code?: string };
            throw new PlanningSaveError(conflict.code === 'SHARED_REVISION_CONFLICT'
              ? 'SHARED_REVISION_CONFLICT'
              : conflict.code === 'PARTIAL_SAVE_CONFLICT' ? 'PARTIAL_SAVE_CONFLICT' : 'REVISION_CONFLICT');
          }
          if (response.status === 401) throw new PlanningSaveError('UNAUTHORIZED');
          if (response.status === 403) throw new PlanningSaveError('FORBIDDEN');
          const result = await response.json().catch(() => null) as { revision?: number; sharedRevision?: number; code?: string } | null;
          if (!result) throw new PlanningSaveError(response.ok ? 'INVALID_RESPONSE' : `HTTP_${response.status}`);
          if (!response.ok) {
            throw new PlanningSaveError(result.code ?? 'SAVE_FAILED');
          }
          const nextRevision = Number(result.revision);
          if (!Number.isSafeInteger(nextRevision) || nextRevision <= revision) throw new PlanningSaveError('SAVE_FAILED');
          if (changedSharedFields.length) {
            const nextSharedRevision = Number(result.sharedRevision);
            if (!Number.isSafeInteger(nextSharedRevision) || nextSharedRevision < 0) throw new PlanningSaveError('SAVE_FAILED');
            sharedRevisionRef.current = nextSharedRevision;
            sharedBaselineRef.current = sharedPlanningState(next as Record<string, unknown>);
            needsSharedRefreshRef.current = true;
          }
          return nextRevision;
        },
        cache: (next) => {
          const cacheDraft = next.lastAttempt?.state === next.state
            ? { ...next, lastAttempt: undefined }
            : next;
          return writePlanningDraftCache(cacheKey, JSON.stringify({
            format: 3,
            loadScope: legacyRecoveryRef.current ? 'legacy-full' : scope,
            ...cacheDraft,
            sharedRevision: sharedRevisionRef.current,
            sharedBaseline: sharedBaselineRef.current,
            sharedRefreshRequired: needsSharedRefreshRef.current
          }));
        },
        onChange: (nextInfo) => { if (active) setInfo(nextInfo); }
      });
      engineRef.current = engine;
      if (!writableRef.current) engine.pause('error', 'READ_ONLY');
      else if (conflict) engine.pause('conflict', sharedConflict ? 'SHARED_REVISION_CONFLICT' : 'REVISION_CONFLICT');
      else if (loadError) engine.pause(
        ['UNAUTHORIZED', 'FORBIDDEN', 'INVALID_STATE', 'INVALID_REVISION'].includes(loadError) ? 'error' : 'offline',
        loadError
      );
      engine.persist();
      setHydratedKey(cacheKey);
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
        setHydratedKey('');
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
        finishingWrites.set(storageKey, closing);
        void closing.finally(() => {
          if (finishingWrites.get(storageKey) === closing) finishingWrites.delete(storageKey);
        });
      }
      engineRef.current = null;
    };
  }, [cacheKey, storageKey, initial, parse, prepare, readRemote, adoptRemote, reloadVersion, scope]);

  useEffect(() => {
    if (!hydrated || !sharedRefreshEnabled) return;
    let active = true;
    let inFlight = false;
    let lastCheck = 0;
    const idle = () => document.visibilityState === 'visible' &&
      !document.activeElement?.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="button"]), textarea, select, [contenteditable="true"]') &&
      engineRef.current?.canRefresh();
    const refresh = async () => {
      if (!active || inFlight || !idle() || Date.now() - lastCheck < 25000) return;
      const engine = engineRef.current!;
      inFlight = true;
      lastCheck = Date.now();
      try {
        const query = needsSharedRefreshRef.current ? '' : `&sharedRevision=${sharedRevisionRef.current ?? ''}`;
        const scopeQuery = legacyRecoveryRef.current ? '' : `&scope=${scope}`;
        const response = await fetch(`/api/planowanie-zapotrzebowania?source=shared${scopeQuery}${query}`, {
          cache: 'no-store', signal: AbortSignal.timeout(15000)
        });
        if (!response.ok) return;
        const payload = await response.json() as { state?: unknown; sharedRevision?: number; unchanged?: boolean };
        if (!active || engineRef.current !== engine || !idle() || payload.unchanged) return;
        const revision = Number(payload.sharedRevision);
        if (!Number.isSafeInteger(revision) || revision < 0 || !payload.state || typeof payload.state !== 'object') return;
        const parsed = parse(combinePlanningState(stateRef.current as Record<string, unknown>, payload.state as Record<string, unknown>));
        if (!parsed) return;
        const shared = rebaseSharedPlanningChanges(
          sharedBaselineRef.current ?? {}, stateRef.current as Record<string, unknown>, parsed as Record<string, unknown>
        );
        if (!shared) return;
        const next = prepare(combinePlanningState(stateRef.current as Record<string, unknown>, shared) as T);
        // No await between this guard, updating the baseline and the engine snapshot.
        if (!engine.canRefresh()) return;
        sharedBaselineRef.current = sharedPlanningState(parsed as Record<string, unknown>);
        sharedRevisionRef.current = revision;
        needsSharedRefreshRef.current = false;
        engine.applyIdleSnapshot(next);
        stateRef.current = next;
        setReactState(next);
      } catch {
        // Background connectivity failures do not interrupt the user's saved plan.
      } finally {
        inFlight = false;
      }
    };
    const timer = window.setInterval(() => { void refresh(); }, 25000);
    const visible = () => { void refresh(); };
    document.addEventListener('visibilitychange', visible);
    void refresh();
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [hydrated, sharedRefreshEnabled, parse, prepare, scope]);

  const ensurePlanTechnologies = useCallback(async (products: PlanningTechnologyRequest[]) => {
    const engine = engineRef.current;
    if (!engine || scope !== 'workspace' || engine.isManual()) return false;
    await engine.flush();
    if (engine !== engineRef.current || engine.getDraft().pending) return false;
    const response = await fetch('/api/planowanie-zapotrzebowania', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'plan-technologies', products }), signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new PlanningSaveError('LOAD_FAILED');
    const payload = await response.json() as { items?: unknown };
    if (engine !== engineRef.current) return false;
    await engine.flush();
    if (engine !== engineRef.current || engine.getDraft().pending || engine.isManual()) return false;
    if (!Array.isArray(payload.items)) throw new PlanningSaveError('INVALID_STATE');
    const parsed = parse({ ...(stateRef.current as Record<string, unknown>), plan: [], technologies: payload.items });
    if (!parsed) throw new PlanningSaveError('INVALID_STATE');
    const incoming = (parsed as Record<string, unknown>).technologies as { id: string }[];
    const current = stateRef.current as Record<string, unknown>;
    const existing = current.technologies as { id: string }[];
    const ids = new Set(existing.map((item) => item.id));
    const additions = incoming.filter((item) => !ids.has(item.id));
    if (!additions.length) return true;
    const baseline = sharedBaselineRef.current ?? {};
    const baselineItems = baseline.technologies as { id: string }[] ?? [];
    const baselineIds = new Set(baselineItems.map((item) => item.id));
    sharedBaselineRef.current = { ...baseline, technologies: [
      ...baselineItems, ...additions.filter((item) => !baselineIds.has(item.id))
    ] };
    const next = { ...current, technologies: [...existing, ...additions] } as T;
    stateRef.current = next;
    setReactState(next);
    engine.setSnapshot(next);
    return true;
  }, [parse, scope]);

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
      setHydratedKey('');
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
    if (!engine || !window.confirm('Wczytać aktualną wersję z bazy? Bieżące niezapisane zmiany zostaną zastąpione. Jeśli chcesz je zachować, najpierw pobierz kopię do pliku.')) return false;
    setInfo({ ...engine.getInfo(), status: 'loading', error: '' });
    try {
      const remote = await readRemote();
      if (engineRef.current !== engine) return false;
      try {
        await writePlanningDraftCache(cacheKey + '-recovery', JSON.stringify(engine.getDraft()));
      } catch {
        // Brak miejsca na dodatkową kopię nie może blokować wersji pobranej z bazy.
      }
      try {
        // Stary szkic z konfliktem nie może wrócić po odświeżeniu, nawet gdy pamięć jest pełna.
        await removePlanningDraftCache(cacheKey);
      } catch {
        // Niedostępna pamięć lokalna nie blokuje pracy na wersji centralnej.
      }
      const nextState = prepare(remote.state ?? initial());
      adoptRemote(remote);
      stateRef.current = nextState;
      setReactState(nextState);
      engine.acceptRemote(nextState, remote.revision);
      return true;
    } catch {
      setInfo({ ...engine.getInfo(), error: 'RELOAD_FAILED' });
      return false;
    }
  }, [cacheKey, initial, prepare, readRemote, adoptRemote]);

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
    loadLatest,
    ensurePlanTechnologies
  };
};
