import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import {
  canCompleteProductionPreparationTeam,
  canEditProductionPreparationMaterials,
  canManageProductionPreparation,
  canSeeTab,
  getProductionPreparationMaterialAccess,
  getProductionPreparationTeams
} from '@/lib/auth/access';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  getWarsawProductionPlanDate,
  isProductionPlanDate,
  resolveProductionPlanDate
} from '@/lib/utils/productionPlanDate';
import {
  RECURRING_TASK_SETTINGS_KEY,
  RECURRING_TASK_STATION,
  normalizeRecurringTasks,
  recurringTaskInstanceId,
  recurringTasksForDate,
  validateRecurringTasks,
  type RecurringTaskDefinition
} from '@/lib/utils/productionRecurringTasks';
import { canSelectToolroomWork, createToolroomReturnTask, isToolroomWorkKind, isToolroomReturnTask, toolroomLinkNotes, toolroomParentId, toolroomReturnId, toolroomWorkMutation, withToolroomReturnTasks, type ToolroomWorkSelection } from '@/lib/utils/productionToolroomTasks';
import { PRODUCTION_TEAMS, TEAM_COMMENT_KEY_PREFIX, defaultTeamComments, isProductionTeam, normalizeTeamComment, validateTeamComment } from '@/lib/utils/productionTeamComments';
import { productionWorkCommentNoteKey, validateProductionWorkCommentText, withProductionWorkComment } from '@/lib/utils/productionWorkComments';
import { canRestoreProductionWorkInPlace, productionRestorableEvents, PRODUCTION_RESTORED_EVENT_NOTE, PRODUCTION_RESTORED_WORK_PREFIX, revokeProductionWork } from '@/lib/utils/productionWorkRestore';
import { PRODUCTION_HALL_NOTE, normalizeProductionHallAssignment } from '@/lib/utils/productionTaskReference';
import { appendProductionWorkEvent, canRetireProductionSession, PRODUCTION_LEGACY_COMPLETION_DAY_NOTE, isRecentProductionHistoryDate, productionHistoryCutoffDate, productionKindOwner, productionSummaryFromTasks, productionWorkEvents, revertProductionWorkEvent, shouldCarryProductionTask, summarizeProductionDay, type ProductionCompletedWork, type ProductionDaySummary } from '@/lib/utils/productionTaskLifecycle';
import {
  PRODUCTION_TEAM_PROGRESS_NOTE_KEY,
  PRODUCTION_STARTUP_TEAMS,
  canProductionTeamStart,
  encodeProductionReopenedNoteBase,
  isProductionCompletableTeam,
  isProductionDistributionStage,
  isProductionDistributionStageDone,
  isProductionTaskDone,
  isProductionTeamDone,
  normalizeProductionTeamProgress,
  productionActionTeamsForTask,
  productionReopenedDetailBase,
  productionReopenedDetailKey,
  productionReopenedNoteBase,
  productionReopenedNoteKey,
  productionTeamProgressForTask,
  productionWaitingTeams,
  productionWaitsForToolroomReturn,
  setProductionDistributionStageCompletion,
  setProductionTeamCompletion,
  type ProductionTeamCompletion,
  type ProductionTeamProgress
} from '@/lib/utils/productionWorkProgress';

export const dynamic = 'force-dynamic';

type StoredTask = {
  id: string;
  isCurrentPlan: boolean;
  planGroup: string;
  station: string;
  detail: string;
  quantity: string;
  norm: string;
  highlighted: boolean;
  kinds: string[];
  teams: string[];
  notes: Record<string, string>;
  teamProgress?: ProductionTeamProgress;
  toolroomReturnDone?: boolean;
  done: boolean;
  material: string;
  materialType: string;
  source: string;
  dryer: string;
  temperature: string;
};

type StoredTaskMutation = {
  setToolroomWork?: ToolroomWorkSelection;
  fields?: Partial<Pick<StoredTask,
    | 'isCurrentPlan'
    | 'planGroup'
    | 'station'
    | 'detail'
    | 'quantity'
    | 'norm'
    | 'highlighted'
    | 'done'
    | 'material'
    | 'materialType'
    | 'source'
    | 'dryer'
    | 'temperature'
  >>;
  addKinds?: string[];
  removeKinds?: string[];
  addTeams?: string[];
  removeTeams?: string[];
  setNotes?: Record<string, string | null>;
  setNotesIfMissing?: Record<string, string>;
  setTeamDone?: { team?: unknown; done?: unknown };
  setDistributionStageDone?: { stage?: unknown; done?: unknown };
  setWorkComment?: { team?: unknown; text?: unknown };
  requeueKind?: string;
  clearWork?: boolean;
};

const PROCESS_ENGINEERS_SETTINGS_KEY = '__process_engineers__';
const PROCESS_ENGINEERS_SETTINGS_DATE = '2000-01-01';
const MACHINE_STATE_KEY_PREFIX = '__machine_state__:';
const DEFAULT_PROCESS_ENGINEERS = ['Adam', 'Mirek', 'Zbyszek', 'Paweł', 'Bogdan'];
const defaultProcessEngineerRoster = (): ProcessEngineerRosterEntry[] =>
  DEFAULT_PROCESS_ENGINEERS.map((name) => ({ name, shift: '1', active: true }));

type ProcessEngineerRosterEntry = {
  name: string;
  shift: '1' | '2';
  active: boolean;
};

const isProcessEngineersSettings = (task: Record<string, unknown>) =>
  String(task.task_key ?? task.id ?? '') === PROCESS_ENGINEERS_SETTINGS_KEY;

const isRecurringTasksSettings = (task: Record<string, unknown>) =>
  String(task.task_key ?? task.id ?? '') === RECURRING_TASK_SETTINGS_KEY;

const isModuleSettings = (task: Record<string, unknown>) =>
  isProcessEngineersSettings(task)
  || isRecurringTasksSettings(task)
  || String(task.task_key ?? task.id ?? '').startsWith(MACHINE_STATE_KEY_PREFIX)
  || String(task.task_key ?? task.id ?? '').startsWith('__personal_task__:')
  || String(task.task_key ?? task.id ?? '').startsWith(TEAM_COMMENT_KEY_PREFIX);

type GlobalSettingsRow = { task_key: unknown; notes: unknown };
const GLOBAL_SETTINGS_CACHE_MS = 60 * 1000;
let globalSettingsRowsCache: { rows: GlobalSettingsRow[]; expiresAt: number } | null = null;
let globalSettingsRowsLoad: Promise<GlobalSettingsRow[]> | null = null;

const queryGlobalSettingsRows = async (): Promise<GlobalSettingsRow[]> => {
  const { data: session, error: sessionError } = await supabaseAdmin
    .from('przygotowanie_produkcji_sessions')
    .select('id')
    .eq('session_date', PROCESS_ENGINEERS_SETTINGS_DATE)
    .maybeSingle();
  if (sessionError) throw sessionError;
  if (!session) return [];
  const { data, error } = await supabaseAdmin
    .from('przygotowanie_produkcji_tasks')
    .select('task_key, notes')
    .eq('session_id', session.id);
  if (error) throw error;
  return (data ?? []) as GlobalSettingsRow[];
};

const readGlobalSettingsRows = async () => {
  if (globalSettingsRowsCache && globalSettingsRowsCache.expiresAt > Date.now()) {
    return globalSettingsRowsCache.rows;
  }
  if (!globalSettingsRowsLoad) globalSettingsRowsLoad = queryGlobalSettingsRows();
  try {
    const rows = await globalSettingsRowsLoad;
    globalSettingsRowsCache = { rows, expiresAt: Date.now() + GLOBAL_SETTINGS_CACHE_MS };
    return rows;
  } finally {
    globalSettingsRowsLoad = null;
  }
};

const invalidateGlobalSettingsCache = () => {
  globalSettingsRowsCache = null;
};

const readGlobalTeamComments = async () => {
  const comments = defaultTeamComments();
  for (const row of await readGlobalSettingsRows()) {
    const team = String(row.task_key).slice(TEAM_COMMENT_KEY_PREFIX.length);
    if (isProductionTeam(team)) {
      const notes = row.notes && typeof row.notes === 'object' ? row.notes as Record<string, unknown> : {};
      comments[team] = normalizeTeamComment(notes.comment, team);
    }
  }
  return comments;
};

const normalizeProcessEngineers = (value: unknown) => {
  if (!Array.isArray(value)) return [...DEFAULT_PROCESS_ENGINEERS];
  const result: string[] = [];
  const seen = new Set<string>();
  value.forEach((item) => {
    const name = String(item ?? '').trim().slice(0, 80);
    const key = name.toLocaleLowerCase('pl-PL');
    if (!name || seen.has(key)) return;
    seen.add(key);
    result.push(name);
  });
  return result.slice(0, 30);
};

const normalizeProcessEngineerRoster = (value: unknown, legacyNames?: unknown): ProcessEngineerRosterEntry[] => {
  if (!Array.isArray(value)) {
    return normalizeProcessEngineers(legacyNames).map((name) => ({ name, shift: '1', active: true }));
  }
  const result: ProcessEngineerRosterEntry[] = [];
  const seen = new Set<string>();
  value.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const record = item as Record<string, unknown>;
    const name = String(record.name ?? '').trim().slice(0, 80);
    const key = name.toLocaleLowerCase('pl-PL');
    if (!name || seen.has(key)) return;
    seen.add(key);
    result.push({ name, shift: record.shift === '2' ? '2' : '1', active: record.active !== false });
  });
  return result.slice(0, 30);
};

const readGlobalProcessEngineerRoster = async () => {
  const settingsRow = (await readGlobalSettingsRows()).find((row) => (
    String(row.task_key ?? '') === PROCESS_ENGINEERS_SETTINGS_KEY
  ));
  if (!settingsRow?.notes || typeof settingsRow.notes !== 'object') return null;
  const notes = settingsRow.notes as Record<string, unknown>;
  return normalizeProcessEngineerRoster(notes.processEngineerRoster, notes.processEngineers);
};

const readGlobalRecurringTasks = async (): Promise<RecurringTaskDefinition[]> => {
  const settingsRow = (await readGlobalSettingsRows()).find((row) => (
    String(row.task_key ?? '') === RECURRING_TASK_SETTINGS_KEY
  ));
  if (!settingsRow?.notes || typeof settingsRow.notes !== 'object') return [];
  return normalizeRecurringTasks((settingsRow.notes as Record<string, unknown>).recurringTasks);
};

const todayKey = () => getWarsawProductionPlanDate();

const invalidPlanDate = () => NextResponse.json({
  code: 'INVALID_PLAN_DATE',
  message: 'Nieprawidłowa data planu.'
}, { status: 400 });

const archivedPlanDateResponse = async (planDate: string) => {
  if (planDate >= todayKey()) return null;
  const { data, error } = await supabaseAdmin.from('przygotowanie_produkcji_history')
    .select('tasks').eq('plan_date', planDate).maybeSingle();
  if (error) throw error;
  return productionSummaryFromTasks(data?.tasks)
    ? NextResponse.json({ code: 'ARCHIVED_PLAN_DATE', message: 'Ten dzień ma już tylko podsumowanie raportowe.' }, { status: 410 })
    : null;
};

const unauthorized = (code: string) => NextResponse.json({ code }, { status: 401 });

const omitFields = <T extends object, K extends keyof T>(value: T, fields: readonly K[]): Omit<T, K> => {
  const copy = { ...value } as Partial<T>;
  fields.forEach((field) => {
    delete copy[field];
  });
  return copy as Omit<T, K>;
};

const hasAssignment = (task: Record<string, unknown>) => {
  const kinds = Array.isArray(task.kinds) ? task.kinds : [];
  const teams = Array.isArray(task.teams) ? task.teams : [];
  const notes = task.notes && typeof task.notes === 'object' ? Object.keys(task.notes).filter((key) => key !== 'toolroomParentId').length : 0;
  return kinds.length > 0 || teams.length > 0 || notes > 0 || Boolean(task.done);
};

const historyTaskKey = (task: Record<string, unknown>) => {
  const explicitKey = task.id ?? task.task_key;
  if (explicitKey !== undefined && explicitKey !== null && String(explicitKey).trim()) {
    return String(explicitKey);
  }
  return [task.station, task.detail, task.quantity, task.norm]
    .map((value) => String(value ?? '').trim().toUpperCase())
    .join('|');
};

const saveHistorySnapshot = async (
  session: { session_date: string; file_name?: string | null; plan_sheet?: string | null; created_by?: string | null },
  tasks: Array<Record<string, unknown>>
) => {
  const assignedTasks = withToolroomReturnTasks(tasks
    .filter((task) => !isModuleSettings(task))
    .map((task) => 'task_key' in task ? fromDbTask(task) : task as unknown as StoredTask))
    .filter((task) => hasAssignment(task as unknown as Record<string, unknown>));
  if (!assignedTasks.length) return;
  try {
    const { data: existingHistory, error: historyReadError } = await supabaseAdmin
      .from('przygotowanie_produkcji_history')
      .select('tasks')
      .eq('plan_date', session.session_date)
      .maybeSingle();
    if (historyReadError) throw historyReadError;

    const existingTasks = Array.isArray(existingHistory?.tasks)
      ? existingHistory.tasks as Array<Record<string, unknown>>
      : [];
    if (productionSummaryFromTasks(existingTasks)) return;
    const mergedTasks = new Map<string, Record<string, unknown>>();
    existingTasks.forEach((task) => mergedTasks.set(historyTaskKey(task), task));
    assignedTasks.forEach((task) => mergedTasks.set(historyTaskKey(task), task));

    const { error } = await supabaseAdmin
      .from('przygotowanie_produkcji_history')
      .upsert({
        plan_date: session.session_date,
        file_name: session.file_name ?? '',
        plan_sheet: session.plan_sheet ?? '',
        tasks: [...mergedTasks.values()],
        archived_by: session.created_by ?? null
      }, { onConflict: 'plan_date' });
    if (error) throw error;
  } catch (error) {
    // A history schema issue cannot affect the current plan save.
    console.error('[przygotowanie-produkcji] History snapshot skipped:', error);
  }
};

const archivePreviousDays = async () => {
  try {
    const archiveBefore = todayKey();
    const [sessionsResult, historyResult] = await Promise.all([
      supabaseAdmin
        .from('przygotowanie_produkcji_sessions')
        .select('id, session_date, file_name, plan_sheet, created_by')
        .lt('session_date', archiveBefore)
        .neq('session_date', PROCESS_ENGINEERS_SETTINGS_DATE),
      supabaseAdmin
        .from('przygotowanie_produkcji_history')
        .select('plan_date')
        .lt('plan_date', archiveBefore)
    ]);
    const { data: previousSessions, error: sessionError } = sessionsResult;
    if (sessionError) throw sessionError;
    if (historyResult.error) throw historyResult.error;

    const archivedDates = new Set((historyResult.data ?? []).map((entry) => String(entry.plan_date)));
    const sessionsToArchive = (previousSessions ?? []).filter((session) => !archivedDates.has(String(session.session_date)));
    if (sessionsToArchive.length === 0) return;

    const sessionIds = sessionsToArchive.map((session) => session.id);
    const { data: taskRows, error: taskError } = await supabaseAdmin
      .from('przygotowanie_produkcji_tasks')
      .select('*')
      .in('session_id', sessionIds)
      .order('position_no');
    if (taskError) throw taskError;
    const rowsBySession = new Map<string, Array<Record<string, unknown>>>();
    for (const row of taskRows ?? []) {
      const sessionId = String(row.session_id);
      const rows = rowsBySession.get(sessionId) ?? [];
      rows.push(row as Record<string, unknown>);
      rowsBySession.set(sessionId, rows);
    }

    const historyRows = sessionsToArchive.flatMap((session) => {
      const tasks = withToolroomReturnTasks((rowsBySession.get(String(session.id)) ?? []).filter((task) => {
        const record = task as Record<string, unknown>;
        return !isModuleSettings(record) && hasAssignment(record);
      }).map((row) => fromDbTask(row as Record<string, unknown>)), false);
      return tasks.length === 0
        ? []
        : [{
          plan_date: session.session_date,
          file_name: session.file_name,
          plan_sheet: session.plan_sheet,
          tasks,
          archived_by: session.created_by
        }];
    });
    if (historyRows.length === 0) return;
    const { error: historyError } = await supabaseAdmin
      .from('przygotowanie_produkcji_history')
      .upsert(historyRows, { onConflict: 'plan_date', ignoreDuplicates: true });
    if (historyError) throw historyError;
  } catch (error) {
    // History is optional. A missing migration must never block the current plan or delete data.
    console.error('[przygotowanie-produkcji] History archive skipped:', error);
  }
};

const retireCompactedSession = async (date: string, expectedSummary: ProductionDaySummary) => {
  if (!expectedSummary.sourceDigest || date >= todayKey()) return;
  const [historyResult, oldResult, currentResult] = await Promise.all([
    supabaseAdmin.from('przygotowanie_produkcji_history').select('tasks').eq('plan_date', date).maybeSingle(),
    supabaseAdmin.from('przygotowanie_produkcji_sessions').select('id, session_date, updated_at').eq('session_date', date).maybeSingle(),
    supabaseAdmin.from('przygotowanie_produkcji_sessions').select('id, session_date').eq('session_date', todayKey()).maybeSingle()
  ]);
  if (historyResult.error) throw historyResult.error;
  if (oldResult.error) throw oldResult.error;
  if (currentResult.error) throw currentResult.error;
  const savedSummary = productionSummaryFromTasks(historyResult.data?.tasks);
  const oldSession = oldResult.data;
  const currentSession = currentResult.data;
  if (!oldSession || !currentSession || !savedSummary
    || savedSummary.sourceDigest !== expectedSummary.sourceDigest
    || savedSummary.assignments !== expectedSummary.assignments
    || savedSummary.completedEvents !== expectedSummary.completedEvents
    || savedSummary.missedRecurring !== expectedSummary.missedRecurring
    || Object.keys(savedSummary.kinds ?? {}).length !== Object.keys(expectedSummary.kinds).length
    || Object.entries(expectedSummary.kinds).some(([kind, count]) =>
      savedSummary.kinds?.[kind]?.total !== count.total || savedSummary.kinds?.[kind]?.done !== count.done)) return;
  const [oldTasksResult, currentTasksResult] = await Promise.all([
    supabaseAdmin.from('przygotowanie_produkcji_tasks').select('*').eq('session_id', oldSession.id),
    supabaseAdmin.from('przygotowanie_produkcji_tasks').select('*').eq('session_id', currentSession.id)
  ]);
  if (oldTasksResult.error) throw oldTasksResult.error;
  if (currentTasksResult.error) throw currentTasksResult.error;
  const oldTasks = (oldTasksResult.data ?? []).map(row => fromDbTask(row as Record<string, unknown>));
  const currentTasks = (currentTasksResult.data ?? []).map(row => fromDbTask(row as Record<string, unknown>));
  if (!canRetireProductionSession(date, String(currentSession.session_date), savedSummary, oldTasks, currentTasks)) return;
  const { error: deleteError } = await supabaseAdmin
    .from('przygotowanie_produkcji_sessions')
    .delete()
    .eq('id', oldSession.id)
    .eq('updated_at', oldSession.updated_at);
  if (deleteError) throw deleteError;
};

const compactOldHistorySnapshots = async () => {
  const { data: dates, error: datesError } = await supabaseAdmin
    .from('przygotowanie_produkcji_history')
    .select('plan_date')
    .lt('plan_date', productionHistoryCutoffDate(todayKey()))
    .is('tasks->0->__productionSummary', null)
    .order('plan_date', { ascending: false })
    .limit(10);
  if (datesError) throw datesError;
  const staleDates = (dates ?? []).map(row => String(row.plan_date));
  let maintained = 0;
  for (const date of staleDates) {
    if (maintained >= 10) break;
    const { data: history, error: readError } = await supabaseAdmin
      .from('przygotowanie_produkcji_history')
      .select('tasks')
      .eq('plan_date', date)
      .single();
    if (readError) throw readError;
    let summary = productionSummaryFromTasks(history?.tasks);
    if (!summary) {
      const tasks = Array.isArray(history?.tasks) ? history.tasks as StoredTask[] : [];
      summary = {
        ...summarizeProductionDay(tasks, date),
        sourceDigest: createHash('sha256').update(JSON.stringify(tasks)).digest('hex')
      };
      const { error: summaryError } = await supabaseAdmin
        .from('przygotowanie_produkcji_history')
        .update({ tasks: [{ __productionSummary: summary }] })
        .eq('plan_date', date);
      if (summaryError) throw summaryError;
    }
    if (!summary.sourceDigest) continue;
    await retireCompactedSession(date, summary);
    maintained += 1;
  }
  if (maintained >= 10) return;
  const { data: oldSessions, error: sessionsError } = await supabaseAdmin
    .from('przygotowanie_produkcji_sessions')
    .select('session_date')
    .lt('session_date', productionHistoryCutoffDate(todayKey()))
    .neq('session_date', PROCESS_ENGINEERS_SETTINGS_DATE)
    .order('session_date', { ascending: true })
    .limit(10 - maintained);
  if (sessionsError) throw sessionsError;
  for (const session of (oldSessions ?? []).slice(0, 10 - maintained)) {
    const date = String(session.session_date);
    const { data: history, error: readError } = await supabaseAdmin
      .from('przygotowanie_produkcji_history').select('tasks').eq('plan_date', date).maybeSingle();
    if (readError) throw readError;
    const summary = productionSummaryFromTasks(history?.tasks);
    if (summary?.sourceDigest) await retireCompactedSession(date, summary);
  }
};

const carryLatestPlanToDate = async (planDate: string, userName: string) => {
  const { data: previous, error: previousError } = await supabaseAdmin
    .from('przygotowanie_produkcji_sessions')
    .select('id, session_date, file_name, plan_sheet')
    .lt('session_date', planDate)
    .neq('session_date', PROCESS_ENGINEERS_SETTINGS_DATE)
    .order('session_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (previousError) throw previousError;
  if (!previous) return null;

  const { data: previousRows, error: previousRowsError } = await supabaseAdmin
    .from('przygotowanie_produkcji_tasks')
    .select('*')
    .eq('session_id', previous.id)
    .order('position_no');
  if (previousRowsError) throw previousRowsError;
  const carried = (previousRows ?? [])
    .filter((row) => !isModuleSettings(row as Record<string, unknown>)
      || String(row.task_key ?? '').startsWith(MACHINE_STATE_KEY_PREFIX))
    .map((row) => fromDbTask(row as Record<string, unknown>))
    .filter((task) => task.id.startsWith(MACHINE_STATE_KEY_PREFIX) || shouldCarryProductionTask(task))
    .map((task) => {
      const hasDatedCompletion = Object.values(task.teamProgress ?? {}).some(value => Boolean(value?.completedAt));
      const hasUndatedCompletion = Object.values(task.teamProgress ?? {}).some(value => value && !value.completedAt);
      return (hasUndatedCompletion || (task.done && !hasDatedCompletion)) && !task.notes[PRODUCTION_LEGACY_COMPLETION_DAY_NOTE]
        ? { ...task, notes: { ...task.notes, [PRODUCTION_LEGACY_COMPLETION_DAY_NOTE]: String(previous.session_date) } }
        : task;
    });
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('przygotowanie_produkcji_sessions')
    .insert({ session_date: planDate, file_name: previous.file_name, plan_sheet: previous.plan_sheet, created_by: userName })
    .select('id, session_date, file_name, plan_sheet, updated_at')
    .single();
  if (insertError && insertError.code !== '23505') throw insertError;
  if (!inserted) {
    const { data: concurrent, error: concurrentError } = await supabaseAdmin
      .from('przygotowanie_produkcji_sessions')
      .select('id, session_date, file_name, plan_sheet, updated_at')
      .eq('session_date', planDate)
      .single();
    if (concurrentError) throw concurrentError;
    return concurrent;
  }
  if (carried.length) {
    const rows = carried.map((task, index) => ({
      ...toDbTask(task, inserted.id, index, userName),
      id: stableTaskRowUuid(inserted.id, task.id)
    }));
    const { error: carryError } = await supabaseAdmin
      .from('przygotowanie_produkcji_tasks')
      .insert(rows);
    if (carryError) throw carryError;
  }
  const carriedAt = new Date(Date.now() + 1).toISOString();
  const { error: versionError } = await supabaseAdmin
    .from('przygotowanie_produkcji_sessions')
    .update({ updated_at: carriedAt })
    .eq('id', inserted.id);
  if (versionError) throw versionError;
  return { ...inserted, updated_at: carriedAt };
};

const machineStateKey = (station: string) => `${MACHINE_STATE_KEY_PREFIX}${createHash('sha256').update(station.trim().toUpperCase()).digest('hex').slice(0, 24)}`;

const updateMachineState = async (
  sessionId: string,
  task: StoredTask,
  stage: 'mounted' | 'started',
  userName: string,
  at: string
) => {
  if (!task.station.trim() || !task.detail.trim()) return;
  const key = machineStateKey(task.station);
  const id = stableTaskRowUuid(sessionId, key);
  const { data: existing, error: readError } = await supabaseAdmin
    .from('przygotowanie_produkcji_tasks')
    .select('detail')
    .eq('id', id)
    .maybeSingle();
  if (readError) throw readError;
  if (stage === 'started' && existing?.detail !== task.detail) return;
  const state: StoredTask = {
    id: key, isCurrentPlan: false, planGroup: 'standard', station: task.station, detail: task.detail,
    quantity: '', norm: '', highlighted: false, kinds: [], teams: [],
    notes: { __machineStage: stage, __machineAt: at, __machineBy: userName },
    teamProgress: {}, done: false, material: '', materialType: '', source: '', dryer: '', temperature: ''
  };
  const { error: writeError } = await supabaseAdmin
    .from('przygotowanie_produkcji_tasks')
    .upsert({ id, ...toDbTask(state, sessionId, 0, userName) }, { onConflict: 'id' });
  if (writeError) throw writeError;
};

const ensureAccess = async (request: NextRequest) => {
  const auth = await getAuthenticatedUser(request);
  if (!auth.user) return { user: null, response: unauthorized(auth.code ?? 'UNAUTHORIZED') };
  if (!canSeeTab(auth.user, 'PRZYGOTOWANIE_PRODUKCJI', 'przygotowanie-produkcji')) {
    return { user: null, response: NextResponse.json({ code: 'FORBIDDEN' }, { status: 403 }) };
  }
  return { user: auth.user, response: null };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const hasExactlyKeys = (value: Record<string, unknown>, expected: readonly string[]) => {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
};

const materialEditFieldKeys = [
  'material',
  'materialType',
  'source',
  'dryer',
  'temperature'
] as const;
const materialEditFieldSet = new Set<string>(materialEditFieldKeys);
const materialEditFieldLimits: Record<(typeof materialEditFieldKeys)[number], number> = {
  material: 240,
  materialType: 120,
  source: 120,
  dryer: 120,
  temperature: 32
};

const isValidMaterialEditFields = (value: unknown) => {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => {
    const fieldValue = value[key];
    return materialEditFieldSet.has(key)
      && typeof fieldValue === 'string'
      && fieldValue.length <= materialEditFieldLimits[key as (typeof materialEditFieldKeys)[number]];
  });
};

const normalizeTaskHeader = (value: string) =>
  value.replace(/\s+/g, ' ').trim().toUpperCase();

const isMaterialScheduleTask = (task: StoredTask) =>
  task.isCurrentPlan &&
  Boolean(task.station.trim()) &&
  task.planGroup !== 'planned' &&
  !(
    /^ST\s*[12]$/.test(normalizeTaskHeader(task.station)) &&
    /^PANELE\s+(SE|BO)$/.test(normalizeTaskHeader(task.detail))
  );

const maskMaterialFields = (task: StoredTask): StoredTask => ({
  ...task,
  material: '',
  materialType: '',
  source: '',
  dryer: '',
  temperature: ''
});

const invalidTeamCompletion = () => NextResponse.json({
  code: 'INVALID_TEAM_COMPLETION',
  message: 'Nieprawidłowe potwierdzenie wykonania pracy.'
}, { status: 400 });

const completionOnlyForbidden = () => NextResponse.json({
  code: 'COMPLETION_ONLY',
  message: 'Możesz potwierdzić wykonanie lub dodać komentarz do pracy swojego działu.'
}, { status: 403 });

const invalidWorkComment = (message = 'Nieprawidłowy komentarz do pracy.') => NextResponse.json({
  code: 'INVALID_WORK_COMMENT',
  message
}, { status: 400 });

const invalidMaterialEdit = () => NextResponse.json({
  code: 'INVALID_MATERIAL_EDIT',
  message: 'Nieprawidłowa zmiana rozpiski materiałowej.'
}, { status: 400 });

const materialEditForbidden = () => NextResponse.json({
  code: 'MATERIAL_EDIT_FORBIDDEN',
  message: 'Nie masz uprawnienia do edycji rozpiski materiałowej.'
}, { status: 403 });

const materialTaskForbidden = () => NextResponse.json({
  code: 'MATERIAL_TASK_FORBIDDEN',
  message: 'Ta pozycja nie należy do aktywnej rozpiski materiałowej.'
}, { status: 409 });

const taskNotesFromValue = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key, note]) => key !== PRODUCTION_TEAM_PROGRESS_NOTE_KEY && typeof note === 'string')) as Record<string, string>;
};

const toDbTask = (task: StoredTask, sessionId: string, position: number, userName: string) => {
  const teamProgress = productionTeamProgressForTask(task);
  return {
    session_id: sessionId,
    task_key: String(task.id),
    position_no: position,
    is_current_plan: Boolean(task.isCurrentPlan),
    plan_group: String(task.planGroup ?? 'standard'),
    station: String(task.station ?? ''),
    detail: String(task.detail ?? ''),
    quantity: String(task.quantity ?? ''),
    norm: String(task.norm ?? ''),
    highlighted: Boolean(task.highlighted),
    kinds: Array.isArray(task.kinds) ? [...new Set(task.kinds.map(String))] : [],
    teams: Array.isArray(task.teams) ? [...new Set(task.teams.map(String))] : [],
    notes: { ...taskNotesFromValue(task.notes), [PRODUCTION_TEAM_PROGRESS_NOTE_KEY]: teamProgress },
    done: isProductionTaskDone({ ...task, teamProgress }),
    material: String(task.material ?? ''),
    material_type: String(task.materialType ?? ''),
    source: String(task.source ?? ''),
    dryer: String(task.dryer ?? ''),
    temperature: String(task.temperature ?? ''),
    updated_at: new Date().toISOString(),
    updated_by: userName
  };
};

const fromDbTask = (row: Record<string, unknown>): StoredTask => {
  const rawNotes = row.notes && typeof row.notes === 'object' && !Array.isArray(row.notes)
    ? row.notes as Record<string, unknown>
    : {};
  const task: StoredTask = {
    id: String(row.task_key ?? ''),
    isCurrentPlan: row.is_current_plan !== false,
    planGroup: String(row.plan_group ?? 'standard'),
    station: String(row.station ?? ''),
    detail: String(row.detail ?? ''),
    quantity: String(row.quantity ?? ''),
    norm: String(row.norm ?? ''),
    highlighted: Boolean(row.highlighted),
    kinds: Array.isArray(row.kinds) ? [...new Set(row.kinds.map(String))] : [],
    teams: Array.isArray(row.teams) ? [...new Set(row.teams.map(String))] : [],
    notes: taskNotesFromValue(rawNotes),
    teamProgress: rawNotes[PRODUCTION_TEAM_PROGRESS_NOTE_KEY] as ProductionTeamProgress | undefined,
    done: Boolean(row.done),
    material: String(row.material ?? ''),
    materialType: String(row.material_type ?? ''),
    source: String(row.source ?? ''),
    dryer: String(row.dryer ?? ''),
    temperature: String(row.temperature ?? '')
  };
  task.teamProgress = productionTeamProgressForTask(task);
  task.done = isProductionTaskDone(task);
  return task;
};

const validWorkKinds = new Set([
  'zmiana-formy', 'forma-narzedziownia', 'powrot-formy-narzedziownia', 'rozruch', 'wznowienie', 'zmiana-koloru',
  'zmiana-grafiki', 'regulacja', 'proby', 'przeglad-a', 'anulowane', 'inne'
]);
const validTeams = new Set(['mechanics', 'process', 'distribution', 'graphics', 'technician', 'additional']);
const validNoteKeys = new Set([...validTeams, 'processAssignee', PRODUCTION_HALL_NOTE]);

const applyTaskMutation = (
  task: StoredTask,
  mutation: StoredTaskMutation,
  completion: ProductionTeamCompletion
): StoredTask => {
  const fields = mutation.fields ?? {};
  const next: StoredTask = {
    ...task,
    isCurrentPlan: typeof fields.isCurrentPlan === 'boolean' ? fields.isCurrentPlan : task.isCurrentPlan,
    planGroup: fields.planGroup === undefined ? task.planGroup : String(fields.planGroup),
    station: fields.station === undefined ? task.station : String(fields.station),
    detail: fields.detail === undefined ? task.detail : String(fields.detail),
    quantity: fields.quantity === undefined ? task.quantity : String(fields.quantity),
    norm: fields.norm === undefined ? task.norm : String(fields.norm),
    highlighted: typeof fields.highlighted === 'boolean' ? fields.highlighted : task.highlighted,
    done: typeof fields.done === 'boolean' ? fields.done : task.done,
    material: fields.material === undefined ? task.material : String(fields.material),
    materialType: fields.materialType === undefined ? task.materialType : String(fields.materialType),
    source: fields.source === undefined ? task.source : String(fields.source),
    dryer: fields.dryer === undefined ? task.dryer : String(fields.dryer),
    temperature: fields.temperature === undefined ? task.temperature : String(fields.temperature),
    kinds: mutation.clearWork ? [] : [...task.kinds],
    teams: mutation.clearWork ? [] : [...task.teams],
    notes: mutation.clearWork ? {
      ...toolroomLinkNotes(task),
      ...(normalizeProductionHallAssignment(task.notes[PRODUCTION_HALL_NOTE]) ? { [PRODUCTION_HALL_NOTE]: task.notes[PRODUCTION_HALL_NOTE] } : {})
    } : { ...task.notes },
    teamProgress: mutation.clearWork ? {} : productionTeamProgressForTask(task)
  };

  const removedKinds = new Set((mutation.removeKinds ?? []).filter((kind) => validWorkKinds.has(kind)));
  const addedKinds = (mutation.addKinds ?? []).filter((kind) => validWorkKinds.has(kind));
  next.kinds = [...new Set([...next.kinds.filter((kind) => !removedKinds.has(kind)), ...addedKinds])];

  const removedTeams = new Set((mutation.removeTeams ?? []).filter((team) => validTeams.has(team)));
  const addedTeams = (mutation.addTeams ?? []).filter((team) => validTeams.has(team));
  next.teams = [...new Set([...next.teams.filter((team) => !removedTeams.has(team)), ...addedTeams])];

  const reopenedTeams = PRODUCTION_TEAMS.filter((team) => {
    const value = mutation.setNotes?.[team];
    if (value === undefined || removedTeams.has(team)) return false;
    const nextValue = value === null ? '' : String(value);
    return nextValue !== String(task.notes[team] ?? '') && (isProductionTeamDone(task, team)
      || (team === 'distribution' && (isProductionDistributionStageDone(task, 'materials')
        || isProductionDistributionStageDone(task, 'station'))));
  });
  const detailChanged = fields.detail !== undefined && String(fields.detail) !== task.detail;
  const reopenedDetailTeams = detailChanged
    ? PRODUCTION_TEAMS.filter((team) => !removedTeams.has(team) && task.teams.includes(team)
      && (isProductionTeamDone(task, team) || (team === 'distribution'
        && (isProductionDistributionStageDone(task, 'materials')
          || isProductionDistributionStageDone(task, 'station')))))
    : [];

  Object.entries(mutation.setNotesIfMissing ?? {}).forEach(([key, value]) => {
    if (!validNoteKeys.has(key) || String(next.notes[key] ?? '').trim()) return;
    next.notes[key] = String(value);
  });
  Object.entries(mutation.setNotes ?? {}).forEach(([key, value]) => {
    if (!validNoteKeys.has(key)) return;
    if (key === PRODUCTION_HALL_NOTE && value && !normalizeProductionHallAssignment(value)) return;
    if (value === null || value === '') delete next.notes[key];
    else next.notes[key] = String(value);
  });
  const workComment = mutation.setWorkComment;
  if (
    workComment
    && isProductionTeam(workComment.team)
    && typeof workComment.text === 'string'
    && validateProductionWorkCommentText(workComment.text) === null
  ) {
    next.notes = withProductionWorkComment(
      next.notes,
      workComment.team,
      workComment.text,
      completion.completedBy,
      completion.completedAt
    );
  }
  for (const team of PRODUCTION_TEAMS) {
    const value = mutation.setNotes?.[team];
    const base = productionReopenedNoteBase(task.notes, team);
    if (value !== undefined && base !== null && (value === null ? '' : String(value)) === base) {
      delete next.notes[productionReopenedNoteKey(team)];
    }
  }
  for (const team of reopenedTeams) {
    if (productionReopenedNoteBase(task.notes, team) === null) {
      next.notes[productionReopenedNoteKey(team)] = encodeProductionReopenedNoteBase(String(task.notes[team] ?? ''));
    }
  }
  if (fields.detail !== undefined) {
    for (const team of PRODUCTION_TEAMS) {
      const base = productionReopenedDetailBase(task.notes, team);
      if (base !== null && String(fields.detail) === base) delete next.notes[productionReopenedDetailKey(team)];
    }
  }
  for (const team of reopenedDetailTeams) {
    if (productionReopenedDetailBase(task.notes, team) === null) {
      next.notes[productionReopenedDetailKey(team)] = encodeProductionReopenedNoteBase(task.detail);
    }
  }
  for (const team of removedTeams) {
    if (!isProductionTeam(team)) continue;
    delete next.notes[productionReopenedNoteKey(team)];
    delete next.notes[productionReopenedDetailKey(team)];
    delete next.notes[productionWorkCommentNoteKey(team)];
  }

  next.teamProgress = productionTeamProgressForTask({ ...next, done: false });
  if (typeof fields.done === 'boolean' && mutation.setTeamDone === undefined) {
    if (!fields.done) next.teamProgress = {};
    else {
      for (const team of productionActionTeamsForTask(next)) {
        next.teamProgress = setProductionTeamCompletion(next.teamProgress, team, true, completion);
      }
    }
  }
  const teamDone = mutation.setTeamDone;
  if (teamDone && isProductionCompletableTeam(teamDone.team) && typeof teamDone.done === 'boolean') {
    const wasDone = isProductionTeamDone(task, teamDone.team);
    next.teamProgress = setProductionTeamCompletion(next.teamProgress, teamDone.team, teamDone.done, completion);
    if (teamDone.done) {
      delete next.notes[productionReopenedNoteKey(teamDone.team)];
      delete next.notes[productionReopenedDetailKey(teamDone.team)];
      if (!wasDone) next.notes = appendProductionWorkEvent(next.notes, {
        id: `${task.id}:${teamDone.team}:${completion.completedAt}`,
        team: teamDone.team,
        kinds: task.kinds.filter((kind) => kind !== 'anulowane'),
        completedAt: completion.completedAt,
        completedBy: completion.completedBy
      });
    } else if (wasDone) {
      next.notes = revertProductionWorkEvent(next.notes, teamDone.team, completion.completedAt);
    }
  }
  const distributionStage = mutation.setDistributionStageDone;
  if (distributionStage && isProductionDistributionStage(distributionStage.stage) && typeof distributionStage.done === 'boolean') {
    next.teamProgress = setProductionDistributionStageCompletion(
      next.teamProgress,
      distributionStage.stage,
      distributionStage.done,
      completion
    );
    if (distributionStage.done && !isProductionTeamDone(task, 'distribution')
      && isProductionTeamDone({ ...next, teamProgress: next.teamProgress }, 'distribution')) {
      next.notes = appendProductionWorkEvent(next.notes, {
        id: `${task.id}:distribution:${completion.completedAt}`,
        team: 'distribution',
        kinds: task.kinds.filter((kind) => kind !== 'anulowane'),
        completedAt: completion.completedAt,
        completedBy: completion.completedBy
      });
    } else if (!distributionStage.done && isProductionTeamDone(task, 'distribution')) {
      next.notes = revertProductionWorkEvent(next.notes, 'distribution', completion.completedAt);
    }
  }
  if (mutation.requeueKind && validWorkKinds.has(mutation.requeueKind)) {
    const team = productionKindOwner(mutation.requeueKind);
    if (isProductionCompletableTeam(team)) {
      next.kinds = [...new Set([...next.kinds, mutation.requeueKind])];
      next.teams = [...new Set([...next.teams, team])];
      next.teamProgress = setProductionTeamCompletion(next.teamProgress, team, false);
    }
  }
  for (const team of new Set([...reopenedTeams, ...reopenedDetailTeams])) {
    next.teamProgress = setProductionTeamCompletion(next.teamProgress, team, false);
  }
  next.teamProgress = productionTeamProgressForTask({ ...next, done: false });
  next.done = isProductionTaskDone({ ...next, done: false });

  return next;
};

// Materialize linked work using a stable UUID: even older databases without a
// unique task_key index cannot create duplicate return rows on parallel saves.
const stableTaskRowUuid = (sessionId: string, taskId: string) => {
  const hash = createHash('sha256').update(`${sessionId}\0${taskId}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
};

const toolroomRowUuid = stableTaskRowUuid;

const ensureRecurringTaskInstances = async (
  planDate: string,
  definitions: RecurringTaskDefinition[],
  userName: string,
  syncExisting = false,
  knownSessionId = ''
): Promise<boolean> => {
  const dueTasks = recurringTasksForDate(definitions, planDate);
  if (dueTasks.length === 0) return false;

  const now = new Date().toISOString();
  let sessionId = knownSessionId;
  if (!sessionId) {
    const { error: createSessionError } = await supabaseAdmin
      .from('przygotowanie_produkcji_sessions')
      .upsert({
        session_date: planDate,
        file_name: 'ZADANIA CYKLICZNE',
        plan_sheet: '',
        created_by: userName,
        updated_at: now
      }, { onConflict: 'session_date', ignoreDuplicates: true });
    if (createSessionError) throw createSessionError;

    const { data: session, error: sessionError } = await supabaseAdmin
      .from('przygotowanie_produkcji_sessions')
      .select('id')
      .eq('session_date', planDate)
      .single();
    if (sessionError) throw sessionError;
    sessionId = String(session.id);
  }

  const taskKeys = dueTasks.map((task) => recurringTaskInstanceId(task.id, planDate));
  const { data: existingRows, error: existingError } = await supabaseAdmin
    .from('przygotowanie_produkcji_tasks')
    .select('*')
    .eq('session_id', sessionId)
    .in('task_key', taskKeys);
  if (existingError) throw existingError;
  const existingByKey = new Map((existingRows ?? []).map((row) => [String(row.task_key), row]));
  let changed = false;

  for (const [index, definition] of dueTasks.entries()) {
    const taskKey = recurringTaskInstanceId(definition.id, planDate);
    const existingRow = existingByKey.get(taskKey);
    if (existingRow) {
      if (!syncExisting) continue;
      const current = fromDbTask(existingRow as Record<string, unknown>);
      const definitionTeams = new Set<string>(definition.teams);
      const currentTeams = new Set<string>(current.teams);
      const removedTeams = current.teams.filter((team) => !definitionTeams.has(team));
      const addedTeams = definition.teams.filter((team) => !currentTeams.has(team));
      const hallChanged = (current.notes[PRODUCTION_HALL_NOTE] ?? '') !== (definition.hall ?? '');
      if (current.detail === definition.title && removedTeams.length === 0 && addedTeams.length === 0 && !hallChanged) continue;
      const next = applyTaskMutation(current, {
        fields: current.detail === definition.title ? undefined : { detail: definition.title },
        removeTeams: removedTeams,
        addTeams: addedTeams,
        setNotes: {
          ...Object.fromEntries(removedTeams.map((team) => [team, null])),
          [PRODUCTION_HALL_NOTE]: definition.hall ?? null
        }
      }, { completedAt: '', completedBy: '' });
      const row = toDbTask(next, sessionId, Number(existingRow.position_no ?? 100000 + index), userName);
      const updates = omitFields(row, ['session_id', 'task_key', 'position_no'] as const);
      const { error } = await supabaseAdmin
        .from('przygotowanie_produkcji_tasks')
        .update(updates)
        .eq('id', existingRow.id);
      if (error) throw error;
      changed = true;
      continue;
    }
    const task: StoredTask = {
      id: taskKey,
      isCurrentPlan: false,
      planGroup: 'standard',
      station: RECURRING_TASK_STATION,
      detail: definition.title,
      quantity: '',
      norm: '',
      highlighted: false,
      kinds: ['inne'],
      teams: definition.teams,
      notes: definition.hall ? { [PRODUCTION_HALL_NOTE]: definition.hall } : {},
      teamProgress: {},
      done: false,
      material: '',
      materialType: '',
      source: '',
      dryer: '',
      temperature: ''
    };
    const row = toDbTask(task, sessionId, 100000 + index, 'System cykliczny');
    const { error } = await supabaseAdmin
      .from('przygotowanie_produkcji_tasks')
      .insert({ id: stableTaskRowUuid(sessionId, taskKey), ...row });
    if (error && error.code !== '23505') throw error;
    if (!error) changed = true;
  }

  if (changed) {
    const { error } = await supabaseAdmin
      .from('przygotowanie_produkcji_sessions')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', sessionId);
    if (error) throw error;
  }
  return changed;
};

const requiresToolroomReturn = (task: StoredTask) =>
  !isToolroomReturnTask(task)
  && task.station !== 'ZADANIE DODATKOWE'
  && task.kinds.includes('forma-narzedziownia')
  && !task.kinds.includes('anulowane');

const withStoredToolroomReturnState = async (sessionId: string, task: StoredTask): Promise<StoredTask> => {
  if (isToolroomReturnTask(task) || task.station === 'ZADANIE DODATKOWE' || task.kinds.includes('anulowane')) return task;
  const { data: returnRow, error } = await supabaseAdmin
    .from('przygotowanie_produkcji_tasks')
    .select('*')
    .eq('session_id', sessionId)
    .eq('task_key', toolroomReturnId(task.id))
    .maybeSingle();
  if (error) throw error;
  const returnTask = returnRow ? fromDbTask(returnRow as Record<string, unknown>) : null;
  if (!requiresToolroomReturn(task) && !(returnTask?.kinds.includes('powrot-formy-narzedziownia')
    && returnTask.teams.includes('mechanics') && !returnTask.kinds.includes('anulowane'))) return task;
  const toolroomReturnDone = Boolean(
    returnTask
    && !returnTask.kinds.includes('anulowane')
    && isProductionTeamDone(returnTask, 'mechanics')
  );
  const enriched = { ...task, toolroomReturnDone };
  enriched.teamProgress = productionTeamProgressForTask(enriched);
  enriched.done = isProductionTaskDone(enriched);
  return enriched;
};

const storedProgressFromRow = (row: Record<string, unknown>) => {
  const notes = row.notes && typeof row.notes === 'object' && !Array.isArray(row.notes)
    ? row.notes as Record<string, unknown>
    : {};
  return normalizeProductionTeamProgress(notes[PRODUCTION_TEAM_PROGRESS_NOTE_KEY]);
};

const clearToolroomParentStartupProgress = async (
  sessionId: string,
  parentTaskId: string,
  userName: string,
  minimumVersionMs = 0,
  forceBarrier = false
): Promise<string | null> => {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { data: parentRow, error: readError } = await supabaseAdmin
      .from('przygotowanie_produkcji_tasks')
      .select('*')
      .eq('session_id', sessionId)
      .eq('task_key', parentTaskId)
      .maybeSingle();
    if (readError) throw readError;
    if (!parentRow) return null;

    const storedProgress = storedProgressFromRow(parentRow as Record<string, unknown>);
    const hasStartupCompletion = PRODUCTION_STARTUP_TEAMS.some((team) => Boolean(storedProgress[team]));
    if (!forceBarrier && !hasStartupCompletion && parentRow.done !== true) return null;

    const parentTask = {
      ...fromDbTask(parentRow as Record<string, unknown>),
      toolroomReturnDone: false,
      done: false
    };
    parentTask.teamProgress = productionTeamProgressForTask(parentTask);
    parentTask.done = isProductionTaskDone(parentTask);
    const storedTask = toDbTask(parentTask, sessionId, Number(parentRow.position_no ?? 0), userName);
    const parentVersionMs = Date.parse(String(parentRow.updated_at ?? ''));
    const nextVersionMs = Math.max(
      Date.now(),
      Number.isFinite(parentVersionMs) ? parentVersionMs + 1 : 0,
      minimumVersionMs + 1
    );
    const updatedAt = new Date(nextVersionMs).toISOString();
    const { data: updatedRow, error: updateError } = await supabaseAdmin
      .from('przygotowanie_produkcji_tasks')
      .update({
        notes: storedTask.notes,
        done: storedTask.done,
        updated_at: updatedAt,
        updated_by: userName
      })
      .eq('id', parentRow.id)
      .eq('updated_at', parentRow.updated_at)
      .select('id')
      .maybeSingle();
    if (updateError) throw updateError;
    if (updatedRow) return updatedAt;
  }
  throw new Error('Nie udało się wycofać gotowości po cofnięciu powrotu formy. Spróbuj ponownie.');
};

const syncToolroomReturns = async (sessionId: string, userName: string) => {
  const readRows = () => supabaseAdmin.from('przygotowanie_produkcji_tasks')
    .select('*').eq('session_id', sessionId).order('position_no');
  const initial = await readRows();
  if (initial.error) throw initial.error;
  const rows = initial.data ?? [];
  const workRows = rows.filter((row) => !isModuleSettings(row as Record<string, unknown>));
  const byKey = new Map(workRows.map((row) => [String(row.task_key), row]));
  const tasks = withToolroomReturnTasks(workRows.map((row) => fromDbTask(row as Record<string, unknown>)));
  let changed = false;
  for (const parent of tasks.filter((task) => !isToolroomReturnTask(task) && task.toolroomReturnDone === false)) {
    if (await clearToolroomParentStartupProgress(sessionId, parent.id, userName)) changed = true;
  }
  for (const task of tasks.filter(isToolroomReturnTask)) {
    const existing = byKey.get(task.id);
    if (!existing) {
      const id = toolroomRowUuid(sessionId, task.id);
      const parent = byKey.get(toolroomParentId(task) ?? '');
      const { error } = await supabaseAdmin.from('przygotowanie_produkcji_tasks')
        .insert({ id, ...toDbTask(task, sessionId, Number(parent?.position_no ?? 0), userName) });
      if (error && error.code !== '23505') throw error;
      changed = true;
    } else if (existing.station !== task.station || existing.detail !== task.detail
      || existing.quantity !== task.quantity || existing.norm !== task.norm || existing.is_current_plan !== false) {
      const { error } = await supabaseAdmin.from('przygotowanie_produkcji_tasks')
        .update({ station: task.station, detail: task.detail, quantity: task.quantity, norm: task.norm,
          is_current_plan: false, updated_at: new Date().toISOString(), updated_by: userName })
        .eq('id', existing.id);
      if (error) throw error;
      changed = true;
    }
  }
  if (!changed) return rows;
  const refreshed = await readRows();
  if (refreshed.error) throw refreshed.error;
  return refreshed.data ?? [];
};

export async function GET(request: NextRequest) {
  try {
    const access = await ensureAccess(request);
    if (access.response) return access.response;
    if (!access.user) return unauthorized('UNAUTHORIZED');
    const responseAccess = {
      isAdmin: canManageProductionPreparation(access.user),
      teams: getProductionPreparationTeams(access.user),
      materialAccess: getProductionPreparationMaterialAccess(access.user)
    };
    const syncOnly = request.nextUrl.searchParams.get('sync') === '1';
    const historyOnly = request.nextUrl.searchParams.get('history') === '1';
    const recentCompletedOnly = request.nextUrl.searchParams.get('recentCompleted') === '1';
    if (historyOnly && !responseAccess.isAdmin) {
      return NextResponse.json({ code: 'FORBIDDEN' }, { status: 403 });
    }
    if (historyOnly) {
      await archivePreviousDays();
      await compactOldHistorySnapshots();
      const { data: history, error: historyError } = await supabaseAdmin
        .from('przygotowanie_produkcji_history')
        .select('plan_date, file_name, plan_sheet, tasks, archived_at')
        .order('plan_date', { ascending: false });
      if (historyError) {
        console.error('[przygotowanie-produkcji] History read skipped:', historyError);
        return NextResponse.json({ history: [], access: responseAccess });
      }
      return NextResponse.json({
        history: (history ?? []).filter((entry) => Array.isArray(entry.tasks) && entry.tasks.length > 0)
          .map((entry) => ({
            ...entry,
            summary: productionSummaryFromTasks(entry.tasks),
            tasks: productionSummaryFromTasks(entry.tasks) ? [] : entry.tasks
          })),
        access: responseAccess
      });
    }
    if (recentCompletedOnly) {
      const today = todayKey();
      const { data: recentHistory, error: recentError } = await supabaseAdmin
        .from('przygotowanie_produkcji_history')
        .select('plan_date, tasks')
        .gte('plan_date', productionHistoryCutoffDate(today))
        .lte('plan_date', today)
        .order('plan_date', { ascending: false });
      if (recentError) throw recentError;
      const completed = new Map<string, ProductionCompletedWork>();
      for (const day of recentHistory ?? []) {
        const planDate = String(day.plan_date);
        for (const rawTask of Array.isArray(day.tasks) ? day.tasks : []) {
          if (!isRecord(rawTask) || !rawTask.notes || !isRecord(rawTask.notes)) continue;
          const task = rawTask as unknown as StoredTask;
          const events = productionWorkEvents(task.notes);
          const progress = isRecord(task.teamProgress) ? {
            ...task.teamProgress,
            distribution: productionTeamProgressForTask(task).distribution
          } : {};
          for (const [team, value] of Object.entries(progress)) {
            if (!isProductionTeam(team) || !isRecord(value)
              || typeof value.completedAt !== 'string' || !value.completedAt) continue;
            const id = `${task.id}:${team}:${value.completedAt}`;
            if (events.some((event) => event.id === id)) continue;
            events.push({ id, team, kinds: Array.isArray(task.kinds) ? task.kinds : [], completedAt: value.completedAt, completedBy: String(value.completedBy ?? '') });
          }
          for (const event of events) {
            if (event.revertedAt) continue;
            if (!responseAccess.isAdmin && !responseAccess.teams.includes(event.team as typeof responseAccess.teams[number])) continue;
            const completedAt = new Date(event.completedAt);
            if (Number.isNaN(completedAt.getTime()) || getWarsawProductionPlanDate(completedAt) !== planDate
              || !isRecentProductionHistoryDate(planDate, today)) continue;
            completed.set(event.id, { ...event, taskId: task.id, station: String(task.station ?? ''), detail: String(task.detail ?? ''), planDate });
          }
        }
      }
      return NextResponse.json({ completed: [...completed.values()].sort((left, right) => right.completedAt.localeCompare(left.completedAt)) });
    }
    const planDate = resolveProductionPlanDate(request.nextUrl.searchParams.get('date'));
    if (!planDate || planDate === PROCESS_ENGINEERS_SETTINGS_DATE) return invalidPlanDate();
    const readPlanSession = () => supabaseAdmin
      .from('przygotowanie_produkcji_sessions')
      .select('id, session_date, file_name, plan_sheet, updated_at')
      .eq('session_date', planDate)
      .maybeSingle();
    const initialSettingsLoad = !syncOnly ? Promise.all([
      readGlobalTeamComments(),
      readGlobalRecurringTasks(),
      readGlobalProcessEngineerRoster()
    ]) : null;
    const sessionResult = await readPlanSession();
    const prefetchedSettings = initialSettingsLoad ? await initialSettingsLoad : null;
    let session = sessionResult.data;
    const sessionError = sessionResult.error;
    if (sessionError) throw sessionError;
    if (!session && !syncOnly && planDate === todayKey()) {
      session = await carryLatestPlanToDate(planDate, access.user.name);
      try {
        await archivePreviousDays();
        await compactOldHistorySnapshots();
      } catch (maintenanceError) {
        console.error('[przygotowanie-produkcji] Daily history maintenance skipped:', maintenanceError);
      }
    }
    const requestedVersion = request.nextUrl.searchParams.get('since');
    let syncVersion = session
      ? `${String(session.updated_at ?? '')}|${responseAccess.materialAccess}`
      : '';
    const refreshSharedSettings = !syncOnly || !session || request.nextUrl.searchParams.get('settings') === '1';
    if (syncOnly && session && requestedVersion && requestedVersion === syncVersion && !refreshSharedSettings) {
      return NextResponse.json({ unchanged: true, updatedAt: session.updated_at, syncVersion, access: responseAccess });
    }

    const [teamComments, recurringTasks, globalRoster] = prefetchedSettings ?? await Promise.all([
      refreshSharedSettings ? readGlobalTeamComments() : Promise.resolve(undefined),
      refreshSharedSettings ? readGlobalRecurringTasks() : Promise.resolve(undefined),
      syncOnly ? Promise.resolve(null) : readGlobalProcessEngineerRoster()
    ]);
    if (syncOnly && session && requestedVersion && requestedVersion === syncVersion) {
      return NextResponse.json({
        unchanged: true,
        updatedAt: session.updated_at,
        syncVersion,
        teamComments,
        recurringTasks,
        access: responseAccess
      });
    }

    if (!syncOnly && planDate === todayKey()) {
      const recurringTasksChanged = await ensureRecurringTaskInstances(
        planDate,
        recurringTasks ?? [],
        access.user.name,
        false,
        String(session?.id ?? '')
      );
      if (recurringTasksChanged) {
        const refreshedSession = await readPlanSession();
        if (refreshedSession.error) throw refreshedSession.error;
        session = refreshedSession.data;
        syncVersion = session
          ? `${String(session.updated_at ?? '')}|${responseAccess.materialAccess}`
          : '';
      }
    }
    if (!session) {
      const processEngineerRoster = globalRoster ?? defaultProcessEngineerRoster();
      return NextResponse.json({
        session: null,
        tasks: [],
        teamComments,
        recurringTasks,
        processEngineers: processEngineerRoster.filter((engineer) => engineer.active).map((engineer) => engineer.name),
        processEngineerRoster,
        access: responseAccess
      });
    }
    const { data: taskRows, error: taskError } = await supabaseAdmin
      .from('przygotowanie_produkcji_tasks')
      .select('*')
      .eq('session_id', session.id)
      .order('position_no');
    if (taskError) throw taskError;
    const settingsRow = (taskRows ?? []).find((row) => isProcessEngineersSettings(row as Record<string, unknown>));
    const settingsNotes = settingsRow?.notes && typeof settingsRow.notes === 'object'
      ? settingsRow.notes as Record<string, unknown>
      : {};
    const processEngineerRoster = globalRoster ?? normalizeProcessEngineerRoster(settingsNotes.processEngineerRoster, settingsNotes.processEngineers);
    const processEngineers = processEngineerRoster.filter((engineer) => engineer.active).map((engineer) => engineer.name);
    const tasks = (taskRows ?? [])
      .filter((row) => !isModuleSettings(row as Record<string, unknown>))
      .map((row) => fromDbTask(row as Record<string, unknown>));
    const machineForms = Object.fromEntries((taskRows ?? [])
      .filter((row) => String(row.task_key ?? '').startsWith(MACHINE_STATE_KEY_PREFIX))
      .map((row) => [String(row.station ?? ''), {
        detail: String(row.detail ?? ''),
        stage: String((row.notes as Record<string, unknown> | null)?.__machineStage ?? 'mounted'),
        at: String((row.notes as Record<string, unknown> | null)?.__machineAt ?? '')
      }]));
    const tasksWithReturns = withToolroomReturnTasks(tasks);
    const visibleTasks = responseAccess.materialAccess === 'none'
      ? tasksWithReturns.map(maskMaterialFields)
      : tasksWithReturns;
    return NextResponse.json({ session, tasks: visibleTasks, machineForms, processEngineers, processEngineerRoster, teamComments, recurringTasks, access: responseAccess, syncVersion });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nie udało się odczytać planu.';
    return NextResponse.json({ code: 'PREPARATION_READ_FAILED', message }, { status: 400 });
  }
}

const restoreCompletedProductionWork = async (taskId: string, eventId: string, sourceDate: string, team: string, userName: string) => {
  const today = todayKey();
  if (!isRecentProductionHistoryDate(sourceDate, today)) {
    return NextResponse.json({ message: 'Można przywrócić zadania z ostatnich 7 dni.' }, { status: 400 });
  }
  const { data: sourceHistory, error: historyError } = await supabaseAdmin
    .from('przygotowanie_produkcji_history').select('tasks').eq('plan_date', sourceDate).maybeSingle();
  if (historyError) throw historyError;
  const { data: sourceSession, error: sourceError } = await supabaseAdmin
    .from('przygotowanie_produkcji_sessions').select('id').eq('session_date', sourceDate).maybeSingle();
  if (sourceError) throw sourceError;
  const { data: sourceRow, error: rowError } = sourceSession
    ? await supabaseAdmin.from('przygotowanie_produkcji_tasks').select('*')
      .eq('session_id', sourceSession.id).eq('task_key', taskId).maybeSingle()
    : { data: null, error: null };
  if (rowError) throw rowError;
  const historyTask = (Array.isArray(sourceHistory?.tasks) ? sourceHistory.tasks : [])
    .find((task: StoredTask) => task.id === taskId) as StoredTask | undefined;
  const sourceTask = historyTask ?? (sourceRow ? fromDbTask(sourceRow) : undefined);
  const event = sourceTask && productionRestorableEvents(sourceTask).find(item => item.id === eventId);
  if (!sourceTask || !event || event.team !== team || !isProductionCompletableTeam(event.team)
    || Number.isNaN(new Date(event.completedAt).getTime())
    || getWarsawProductionPlanDate(new Date(event.completedAt)) !== sourceDate) {
    return NextResponse.json({ message: 'Nie znaleziono wskazanego wykonania zadania.' }, { status: 404 });
  }
  const sessionResult = await supabaseAdmin
    .from('przygotowanie_produkcji_sessions').select('id, session_date, file_name, plan_sheet, updated_at')
    .eq('session_date', today).maybeSingle();
  if (sessionResult.error) throw sessionResult.error;
  let session = sessionResult.data;
  if (!session) session = await carryLatestPlanToDate(today, userName);
  if (!session) return NextResponse.json({ message: 'Najpierw wczytaj bieżący plan produkcji.' }, { status: 409 });

  const touchSession = async (id: string) => {
    const { data: current, error: readError } = await supabaseAdmin.from('przygotowanie_produkcji_sessions')
      .select('updated_at').eq('id', id).maybeSingle();
    if (readError) throw readError;
    const previous = Date.parse(String(current?.updated_at ?? ''));
    const { error } = await supabaseAdmin.from('przygotowanie_produkcji_sessions')
      .update({ updated_at: new Date(Math.max(Date.now() + 1, Number.isFinite(previous) ? previous + 1 : 0)).toISOString() }).eq('id', id);
    if (error) throw error;
  };
  if (event.revertedAt) {
    await touchSession(session.id);
    return NextResponse.json({ planDate: today, alreadyRestored: true });
  }
  const restorationUpdate = (task: StoredTask, row: Record<string, unknown>) => {
    const stored = toDbTask(task, String(row.session_id), Number(row.position_no ?? 0), userName);
    const previous = Date.parse(String(row.updated_at ?? ''));
    stored.updated_at = new Date(Math.max(Date.now(), Number.isFinite(previous) ? previous + 1 : 0)).toISOString();
    return omitFields(stored, ['session_id', 'task_key', 'position_no'] as const);
  };

  const now = new Date().toISOString();
  let restoredTaskId = '';
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { data: row, error } = await supabaseAdmin.from('przygotowanie_produkcji_tasks').select('*')
      .eq('session_id', session.id).eq('task_key', taskId).maybeSingle();
    if (error) throw error;
    if (!row) break;
    const current = fromDbTask(row);
    if (current.notes[PRODUCTION_RESTORED_EVENT_NOTE] === event.id) {
      restoredTaskId = current.id;
      break;
    }
    if (current.detail !== sourceTask.detail || !canRestoreProductionWorkInPlace(current, event)) break;
    const next = revokeProductionWork(current, event, now);
    next.notes[PRODUCTION_RESTORED_EVENT_NOTE] = event.id;
    const { data: saved, error: saveError } = await supabaseAdmin.from('przygotowanie_produkcji_tasks')
      .update(restorationUpdate(next, row))
      .eq('id', row.id).eq('updated_at', row.updated_at).select('id').maybeSingle();
    if (saveError) throw saveError;
    if (saved) { restoredTaskId = current.id; break; }
    if (attempt === 5) throw new Error('Zadanie właśnie się zmieniło. Spróbuj przywrócić je ponownie.');
  }
  if (!restoredTaskId) {
    // A later job on the same machine must not be replaced by an older one.
    restoredTaskId = `${PRODUCTION_RESTORED_WORK_PREFIX}${createHash('sha256').update(event.id).digest('hex').slice(0, 32)}`;
    const pending: StoredTask = {
      ...sourceTask, id: restoredTaskId, isCurrentPlan: false, planGroup: 'standard', highlighted: false,
      teams: [event.team], teamProgress: {}, done: false, toolroomReturnDone: undefined,
      kinds: event.kinds.filter(kind => validWorkKinds.has(kind) && kind !== 'anulowane'
        && (event.team === 'mechanics' ? productionKindOwner(kind) === 'mechanics'
          : event.team !== 'process' || kind !== 'zmiana-formy')),
      notes: {
        ...Object.fromEntries(Object.entries(sourceTask.notes).filter(([key]) => validNoteKeys.has(key)
          || key === productionWorkCommentNoteKey(event.team as typeof PRODUCTION_TEAMS[number]))),
        [PRODUCTION_RESTORED_EVENT_NOTE]: event.id
      }
    };
    const { error: insertError } = await supabaseAdmin.from('przygotowanie_produkcji_tasks').upsert({
      id: stableTaskRowUuid(session.id, pending.id), ...toDbTask(pending, session.id, 200000, userName)
    }, { onConflict: 'id', ignoreDuplicates: true });
    if (insertError) throw insertError;
  }

  // Keep source rows and the report snapshot consistent; conditional writes preserve parallel edits.
  const sessionIds = [...new Set([String(session.id), ...(sourceSession ? [String(sourceSession.id)] : [])])];
  for (const sessionId of sessionIds) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const { data: row, error } = await supabaseAdmin.from('przygotowanie_produkcji_tasks').select('*')
        .eq('session_id', sessionId).eq('task_key', taskId).maybeSingle();
      if (error) throw error;
      if (!row) break;
      const current = fromDbTask(row);
      const next = revokeProductionWork(current, event, now);
      if (JSON.stringify(next) === JSON.stringify(current)) break;
      const { data: saved, error: saveError } = await supabaseAdmin.from('przygotowanie_produkcji_tasks')
        .update(restorationUpdate(next, row))
        .eq('id', row.id).eq('updated_at', row.updated_at).select('id').maybeSingle();
      if (saveError) throw saveError;
      if (saved) break;
      if (attempt === 5) throw new Error('Nie udało się cofnąć wykonania. Spróbuj ponownie.');
    }
  }
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { data: history, error } = await supabaseAdmin.from('przygotowanie_produkcji_history')
      .select('tasks').eq('plan_date', sourceDate).maybeSingle();
    if (error) throw error;
    if (!history || !Array.isArray(history.tasks) || productionSummaryFromTasks(history.tasks)) break;
    const nextTasks = (history.tasks as StoredTask[]).map(task => task.id === taskId ? revokeProductionWork(task, event, now) : task);
    if (JSON.stringify(nextTasks) === JSON.stringify(history.tasks)) break;
    const { data: saved, error: saveError } = await supabaseAdmin.from('przygotowanie_produkcji_history')
      .update({ tasks: nextTasks }).eq('plan_date', sourceDate).eq('tasks', JSON.stringify(history.tasks))
      .select('plan_date').maybeSingle();
    if (saveError) throw saveError;
    if (saved) break;
    if (attempt === 5) throw new Error('Historia właśnie się zmieniła. Spróbuj ponownie.');
  }
  const rows = await syncToolroomReturns(session.id, userName);
  await saveHistorySnapshot(session, rows as Array<Record<string, unknown>>);
  for (const sessionId of sessionIds) {
    await touchSession(sessionId);
  }
  return NextResponse.json({ planDate: today, restoredTaskId });
};

export async function POST(request: NextRequest) {
  try {
    const access = await ensureAccess(request);
    if (access.response || !access.user) return access.response;
    const rawBody = await request.json() as unknown;
    const bodyRecord = isRecord(rawBody) ? rawBody : {};
    const body = bodyRecord as { action?: string; fileName?: string; sheetName?: string; tasks?: StoredTask[]; task?: StoredTask; taskId?: string; mutation?: StoredTaskMutation; processEngineers?: string[]; processEngineerRoster?: ProcessEngineerRosterEntry[]; recurringTasks?: unknown; planDate?: string; team?: unknown; comment?: unknown };
    const isAdmin = canManageProductionPreparation(access.user);
    const materialAccess = getProductionPreparationMaterialAccess(access.user);
    let isScopedMaterialEdit = false;

    if (body.action === 'restoreCompletedWork') {
      if (!hasExactlyKeys(bodyRecord, ['action', 'sourceDate', 'taskId', 'eventId', 'team'])
        || typeof bodyRecord.sourceDate !== 'string' || typeof body.taskId !== 'string' || !body.taskId.trim()
        || typeof bodyRecord.eventId !== 'string' || !bodyRecord.eventId.trim() || bodyRecord.eventId.length > 500
        || !isProductionCompletableTeam(body.team)) {
        return NextResponse.json({ message: 'Nieprawidłowe dane przywracania zadania.' }, { status: 400 });
      }
      if (!canCompleteProductionPreparationTeam(access.user, body.team)) return completionOnlyForbidden();
      return await restoreCompletedProductionWork(body.taskId, bodyRecord.eventId, bodyRecord.sourceDate, body.team, access.user.name);
    }

    if (!isAdmin) {
      const allowedRequestKeys = new Set(['action', 'planDate', 'taskId', 'mutation']);
      if (
        body.action !== 'mutateTask'
        || typeof body.taskId !== 'string'
        || !body.taskId.trim()
        || Object.keys(bodyRecord).some((key) => !allowedRequestKeys.has(key))
      ) {
        return completionOnlyForbidden();
      }

      const mutation = isRecord(body.mutation) ? body.mutation : null;
      if (!mutation) {
        return completionOnlyForbidden();
      }

      if (hasExactlyKeys(mutation, ['setTeamDone'])) {
        const teamDone = isRecord(mutation.setTeamDone) ? mutation.setTeamDone : null;
        if (
          !teamDone
          || !hasExactlyKeys(teamDone, ['team', 'done'])
          || !isProductionCompletableTeam(teamDone.team)
          || typeof teamDone.done !== 'boolean'
        ) {
          return invalidTeamCompletion();
        }
        if (!canCompleteProductionPreparationTeam(access.user, teamDone.team)) {
          return NextResponse.json({
            code: 'TEAM_COMPLETION_FORBIDDEN',
            message: 'Nie masz uprawnienia do potwierdzania pracy tego działu.'
          }, { status: 403 });
        }
      } else if (hasExactlyKeys(mutation, ['setDistributionStageDone'])) {
        const stageDone = isRecord(mutation.setDistributionStageDone) ? mutation.setDistributionStageDone : null;
        if (!stageDone || !hasExactlyKeys(stageDone, ['stage', 'done'])
          || !isProductionDistributionStage(stageDone.stage) || typeof stageDone.done !== 'boolean') {
          return invalidTeamCompletion();
        }
        if (!canCompleteProductionPreparationTeam(access.user, 'distribution')) {
          return NextResponse.json({
            code: 'TEAM_COMPLETION_FORBIDDEN',
            message: 'Nie masz uprawnienia do potwierdzania pracy rozdzielcy.'
          }, { status: 403 });
        }
      } else if (hasExactlyKeys(mutation, ['setWorkComment'])) {
        const workComment = isRecord(mutation.setWorkComment) ? mutation.setWorkComment : null;
        if (
          !workComment
          || !hasExactlyKeys(workComment, ['team', 'text'])
          || !isProductionTeam(workComment.team)
        ) {
          return invalidWorkComment();
        }
        const validationError = validateProductionWorkCommentText(workComment.text);
        if (validationError) return invalidWorkComment(validationError);
        if (!canCompleteProductionPreparationTeam(access.user, workComment.team)) {
          return NextResponse.json({
            code: 'WORK_COMMENT_FORBIDDEN',
            message: 'Nie masz uprawnienia do komentowania pracy tego działu.'
          }, { status: 403 });
        }
      } else if (hasExactlyKeys(mutation, ['setToolroomWork'])) {
        if (!canCompleteProductionPreparationTeam(access.user, 'mechanics')) {
          return NextResponse.json({ code: 'TOOLROOM_WORK_FORBIDDEN', message: 'Tę pracę może przypisać mechanik lub administrator modułu.' }, { status: 403 });
        }
      } else if (hasExactlyKeys(mutation, ['fields'])) {
        if (!canEditProductionPreparationMaterials(access.user)) {
          return materialEditForbidden();
        }
        if (!isValidMaterialEditFields(mutation.fields)) {
          return invalidMaterialEdit();
        }
        isScopedMaterialEdit = true;
      } else {
        return completionOnlyForbidden();
      }
    }

    const now = new Date().toISOString();

    if (body.action === 'saveTeamComment') {
      if (!isProductionTeam(body.team)) return NextResponse.json({ code: 'INVALID_TEAM', message: 'Nieprawidłowa grupa osób.' }, { status: 400 });
      const validationError = validateTeamComment(body.comment);
      if (validationError) return NextResponse.json({ code: 'INVALID_TEAM_COMMENT', message: validationError }, { status: 400 });
      const team = body.team;
      const commentForRow = (row: { notes?: unknown } | null) => {
        const notes = row?.notes && typeof row.notes === 'object' ? row.notes as Record<string, unknown> : {};
        // Older open clients may still save just the comment; keep the saved visibility in that case.
        return normalizeTeamComment(body.comment, team, notes.comment);
      };

      // Reuse the permanent settings session, not the daily production plan.
      // A separate row per group keeps edits independent of the engineer roster and other groups.
      const { error: createError } = await supabaseAdmin
        .from('przygotowanie_produkcji_sessions')
        .upsert({ session_date: PROCESS_ENGINEERS_SETTINGS_DATE, file_name: 'USTAWIENIA', plan_sheet: '', created_by: access.user.name, updated_at: now }, { onConflict: 'session_date', ignoreDuplicates: true });
      if (createError) throw createError;
      const { data: settingsSession, error: sessionError } = await supabaseAdmin
        .from('przygotowanie_produkcji_sessions')
        .select('id')
        .eq('session_date', PROCESS_ENGINEERS_SETTINGS_DATE)
        .single();
      if (sessionError) throw sessionError;
      const key = `${TEAM_COMMENT_KEY_PREFIX}${team}`;
      const readRow = () => supabaseAdmin.from('przygotowanie_produkcji_tasks')
        .select('id, notes').eq('session_id', settingsSession.id).eq('task_key', key).maybeSingle();
      const { data: existing, error: readError } = await readRow();
      if (readError) throw readError;
      let comment = commentForRow(existing);
      const values = { notes: { comment }, updated_at: now, updated_by: access.user.name };
      const updateRow = (id: string) => supabaseAdmin.from('przygotowanie_produkcji_tasks').update(values).eq('id', id);
      if (existing) {
        const { error } = await updateRow(existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabaseAdmin.from('przygotowanie_produkcji_tasks').insert({
          ...values, session_id: settingsSession.id, task_key: key, position_no: -2,
          is_current_plan: false, plan_group: 'standard', station: 'USTAWIENIA',
          detail: `KOMENTARZ: ${team}`, kinds: [], teams: [], done: false
        });
        if (error?.code === '23505') {
          const retry = await readRow();
          if (retry.error || !retry.data) throw retry.error ?? error;
          comment = commentForRow(retry.data);
          values.notes.comment = comment;
          const update = await updateRow(retry.data.id);
          if (update.error) throw update.error;
        } else if (error) throw error;
      }
      invalidateGlobalSettingsCache();
      return NextResponse.json({ team, comment });
    }

    if (body.action === 'deleteHistoryDay') {
      const planDate = String(body.planDate ?? '');
      if (!isProductionPlanDate(planDate) || planDate === PROCESS_ENGINEERS_SETTINGS_DATE) return invalidPlanDate();
      const { error: historyError } = await supabaseAdmin
        .from('przygotowanie_produkcji_history')
        .update({ tasks: [], file_name: '', plan_sheet: '' })
        .eq('plan_date', planDate);
      if (historyError) throw historyError;
      return NextResponse.json({ deleted: true, planDate });
    }

    if (body.action === 'saveRecurringTasks') {
      const validationError = validateRecurringTasks(body.recurringTasks);
      if (validationError) {
        return NextResponse.json({ code: 'INVALID_RECURRING_TASKS', message: validationError }, { status: 400 });
      }
      const recurringTasks = normalizeRecurringTasks(body.recurringTasks);
      const planDate = resolveProductionPlanDate(body.planDate);
      if (!planDate || planDate === PROCESS_ENGINEERS_SETTINGS_DATE) return invalidPlanDate();

      const { error: createError } = await supabaseAdmin
        .from('przygotowanie_produkcji_sessions')
        .upsert({
          session_date: PROCESS_ENGINEERS_SETTINGS_DATE,
          file_name: 'USTAWIENIA',
          plan_sheet: '',
          created_by: access.user.name,
          updated_at: now
        }, { onConflict: 'session_date', ignoreDuplicates: true });
      if (createError) throw createError;
      const { data: settingsSession, error: sessionError } = await supabaseAdmin
        .from('przygotowanie_produkcji_sessions')
        .select('id')
        .eq('session_date', PROCESS_ENGINEERS_SETTINGS_DATE)
        .single();
      if (sessionError) throw sessionError;
      const { data: existingSettings, error: settingsReadError } = await supabaseAdmin
        .from('przygotowanie_produkcji_tasks')
        .select('id')
        .eq('session_id', settingsSession.id)
        .eq('task_key', RECURRING_TASK_SETTINGS_KEY)
        .maybeSingle();
      if (settingsReadError) throw settingsReadError;

      const settings = {
        position_no: -2,
        is_current_plan: false,
        plan_group: 'standard',
        station: 'USTAWIENIA',
        detail: 'ZADANIA CYKLICZNE',
        quantity: '',
        norm: '',
        highlighted: false,
        kinds: [],
        teams: [],
        notes: { recurringTasks },
        done: false,
        material: '',
        material_type: '',
        source: '',
        dryer: '',
        temperature: '',
        updated_at: now,
        updated_by: access.user.name
      };
      if (existingSettings) {
        const { error } = await supabaseAdmin
          .from('przygotowanie_produkcji_tasks')
          .update(settings)
          .eq('id', existingSettings.id);
        if (error) throw error;
      } else {
        const { error } = await supabaseAdmin
          .from('przygotowanie_produkcji_tasks')
          .insert({ ...settings, session_id: settingsSession.id, task_key: RECURRING_TASK_SETTINGS_KEY });
        if (error) throw error;
      }

      if (planDate === todayKey()) {
        await ensureRecurringTaskInstances(planDate, recurringTasks, access.user.name, true);
      }
      invalidateGlobalSettingsCache();
      return NextResponse.json({ recurringTasks });
    }

    if (body.action === 'saveProcessEngineers') {
      const processEngineerRoster = normalizeProcessEngineerRoster(body.processEngineerRoster, body.processEngineers);
      const processEngineers = processEngineerRoster.filter((engineer) => engineer.active).map((engineer) => engineer.name);
      const { data: existingSession, error: sessionReadError } = await supabaseAdmin
        .from('przygotowanie_produkcji_sessions')
        .select('id')
        .eq('session_date', PROCESS_ENGINEERS_SETTINGS_DATE)
        .maybeSingle();
      if (sessionReadError) throw sessionReadError;
      let session = existingSession;
      if (!session) {
        const { data: createdSession, error: sessionCreateError } = await supabaseAdmin
          .from('przygotowanie_produkcji_sessions')
          .insert({ session_date: PROCESS_ENGINEERS_SETTINGS_DATE, file_name: 'USTAWIENIA', plan_sheet: '', created_by: access.user.name, updated_at: now })
          .select('id')
          .single();
        if (sessionCreateError) throw sessionCreateError;
        session = createdSession;
      }

      const { data: existingSettings, error: settingsReadError } = await supabaseAdmin
        .from('przygotowanie_produkcji_tasks')
        .select('id')
        .eq('session_id', session.id)
        .eq('task_key', PROCESS_ENGINEERS_SETTINGS_KEY)
        .maybeSingle();
      if (settingsReadError) throw settingsReadError;

      const settings = {
        position_no: -1,
        is_current_plan: false,
        plan_group: 'standard',
        station: 'USTAWIENIA',
        detail: 'INZYNIEROWIE PROCESU',
        quantity: '',
        norm: '',
        highlighted: false,
        kinds: [],
        teams: [],
        notes: { processEngineers, processEngineerRoster },
        done: false,
        material: '',
        material_type: '',
        source: '',
        dryer: '',
        temperature: '',
        updated_at: now,
        updated_by: access.user.name
      };
      if (existingSettings) {
        const { error: updateError } = await supabaseAdmin
          .from('przygotowanie_produkcji_tasks')
          .update(settings)
          .eq('id', existingSettings.id);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabaseAdmin
          .from('przygotowanie_produkcji_tasks')
          .insert({ ...settings, session_id: session.id, task_key: PROCESS_ENGINEERS_SETTINGS_KEY });
        if (insertError) throw insertError;
      }
      invalidateGlobalSettingsCache();
      return NextResponse.json({ processEngineers, processEngineerRoster });
    }

    if (body.action === 'savePlan') {
      const planDate = resolveProductionPlanDate(body.planDate);
      if (!planDate || planDate === PROCESS_ENGINEERS_SETTINGS_DATE) return invalidPlanDate();
      const archived = await archivedPlanDateResponse(planDate);
      if (archived) return archived;
      let tasks = Array.isArray(body.tasks) ? body.tasks : [];
      const { data: session, error: sessionError } = await supabaseAdmin
        .from('przygotowanie_produkcji_sessions')
        .upsert({ session_date: planDate, file_name: body.fileName ?? '', plan_sheet: body.sheetName ?? '', created_by: access.user.name, updated_at: now }, { onConflict: 'session_date' })
        .select('id, session_date, file_name, plan_sheet, updated_at')
        .single();
      if (sessionError) throw sessionError;
      const taskKeys = tasks.map((task) => String(task.id));
      if (new Set(taskKeys).size !== taskKeys.length) {
        throw new Error('Plan zawiera powtarzające się identyfikatory pozycji. Dane nie zostały zmienione.');
      }
      const { data: storedRows, error: storedRowsError } = await supabaseAdmin
        .from('przygotowanie_produkcji_tasks')
        .select('*')
        .eq('session_id', session.id);
      if (storedRowsError) throw storedRowsError;
      const storedReturns = (storedRows ?? []).map((row) => fromDbTask(row as Record<string, unknown>))
        .filter((task) => isToolroomReturnTask(task) && !taskKeys.includes(task.id));
      tasks = withToolroomReturnTasks([...tasks, ...storedReturns]);
      const storedByTaskKey = new Map((storedRows ?? []).map((row) => [String(row.task_key), String(row.id)]));
      const importedRows = tasks.map((task, index) => toDbTask(task, session.id, index, access.user.name));
      const rowsToUpdate = importedRows.flatMap((row) => {
        const storedId = storedByTaskKey.get(String(row.task_key));
        return storedId ? [{ id: storedId, ...row }] : [];
      });
      const rowsToInsert = importedRows.filter((row) => !storedByTaskKey.has(String(row.task_key)))
        .map((row) => isToolroomReturnTask(fromDbTask(row)) ? { ...row, id: toolroomRowUuid(session.id, row.task_key) } : row);

      // Existing rows already have stable primary keys, so the whole imported plan
      // can be updated in one request without relying on the optional task_key index.
      if (rowsToUpdate.length) {
        const { error: updateError } = await supabaseAdmin
          .from('przygotowanie_produkcji_tasks')
          .upsert(rowsToUpdate, { onConflict: 'id' });
        if (updateError) throw updateError;
      }
      if (rowsToInsert.length) {
        const { error: insertError } = await supabaseAdmin
          .from('przygotowanie_produkcji_tasks')
          .insert(rowsToInsert);
        if (insertError) throw insertError;
      }
      const staleIds = (storedRows ?? [])
        .filter((row) => !isModuleSettings(row as Record<string, unknown>) && !taskKeys.includes(String(row.task_key)))
        .map((row) => String(row.id));
      if (staleIds.length) {
        const { error: retainError } = await supabaseAdmin
          .from('przygotowanie_produkcji_tasks')
          .update({ is_current_plan: false, updated_at: now, updated_by: access.user.name })
          .in('id', staleIds);
        if (retainError) throw retainError;
      }
      const syncedRows = await syncToolroomReturns(session.id, access.user.name);
      tasks = withToolroomReturnTasks(syncedRows.filter((row) => !isModuleSettings(row as Record<string, unknown>)).map((row) => fromDbTask(row as Record<string, unknown>)));
      await saveHistorySnapshot(session, tasks as unknown as Array<Record<string, unknown>>);
      return NextResponse.json({ session, tasks });
    }

    if (body.action === 'updateTask' && body.task) {
      const planDate = resolveProductionPlanDate(body.planDate);
      if (!planDate || planDate === PROCESS_ENGINEERS_SETTINGS_DATE) return invalidPlanDate();
      const archived = await archivedPlanDateResponse(planDate);
      if (archived) return archived;
      const { data: session, error: sessionError } = await supabaseAdmin
        .from('przygotowanie_produkcji_sessions')
        .select('id, session_date, file_name, plan_sheet, created_by, updated_at')
        .eq('session_date', planDate)
        .maybeSingle();
      if (sessionError) throw sessionError;
      if (!session) return NextResponse.json({ code: 'NO_PLAN' }, { status: 409 });
      await syncToolroomReturns(session.id, access.user.name);
      const storedTask = toDbTask(body.task, session.id, 0, access.user.name);
      const updates = omitFields(storedTask, ['session_id', 'task_key', 'position_no'] as const);
      const { error: taskError } = await supabaseAdmin
        .from('przygotowanie_produkcji_tasks')
        .update(updates)
        .eq('session_id', session.id)
        .eq('task_key', body.task.id);
      if (taskError) throw taskError;
      const taskRows = await syncToolroomReturns(session.id, access.user.name);
      await saveHistorySnapshot({ ...session, created_by: session.created_by ?? access.user.name }, (taskRows ?? []) as Array<Record<string, unknown>>);
      return NextResponse.json({ task: body.task });
    }

    if (body.action === 'mutateTask' && body.taskId && body.mutation) {
      if (body.mutation.requeueKind !== undefined && !validWorkKinds.has(body.mutation.requeueKind)) {
        return NextResponse.json({ code: 'INVALID_WORK_KIND' }, { status: 400 });
      }
      const toolroomSelection = body.mutation.setToolroomWork;
      if (toolroomSelection !== undefined && (
        !hasExactlyKeys(body.mutation, ['setToolroomWork'])
        || !isRecord(toolroomSelection)
        || !hasExactlyKeys(toolroomSelection, ['kind', 'enabled'])
        || !isToolroomWorkKind(toolroomSelection.kind)
        || typeof toolroomSelection.enabled !== 'boolean'
      )) {
        return NextResponse.json({ code: 'INVALID_TOOLROOM_WORK', message: 'Nieprawidłowy wybór pracy narzędziowni.' }, { status: 400 });
      }
      const teamDoneMutation = body.mutation.setTeamDone;
      const distributionStageMutation = body.mutation.setDistributionStageDone;
      const workCommentMutation = body.mutation.setWorkComment;
      if (teamDoneMutation !== undefined && (
        !isProductionCompletableTeam(teamDoneMutation.team) || typeof teamDoneMutation.done !== 'boolean'
      )) {
        return invalidTeamCompletion();
      }
      if (distributionStageMutation !== undefined && (
        !isRecord(distributionStageMutation)
        || !isProductionDistributionStage(distributionStageMutation.stage)
        || typeof distributionStageMutation.done !== 'boolean'
      )) {
        return invalidTeamCompletion();
      }
      if (workCommentMutation !== undefined) {
        if (!isRecord(workCommentMutation) || !isProductionTeam(workCommentMutation.team)) return invalidWorkComment();
        const validationError = validateProductionWorkCommentText(workCommentMutation.text);
        if (validationError) return invalidWorkComment(validationError);
      }
      const planDate = resolveProductionPlanDate(body.planDate);
      if (!planDate || planDate === PROCESS_ENGINEERS_SETTINGS_DATE) return invalidPlanDate();
      const archived = await archivedPlanDateResponse(planDate);
      if (archived) return archived;
      const { data: session, error: sessionError } = await supabaseAdmin
        .from('przygotowanie_produkcji_sessions')
        .select('id, session_date, file_name, plan_sheet, created_by, updated_at')
        .eq('session_date', planDate)
        .maybeSingle();
      if (sessionError) throw sessionError;
      if (!session) return NextResponse.json({ code: 'NO_PLAN' }, { status: 409 });

      await syncToolroomReturns(session.id, access.user.name);

      for (let attempt = 0; attempt < 6; attempt += 1) {
        const { data: currentRow, error: readError } = await supabaseAdmin
          .from('przygotowanie_produkcji_tasks')
          .select('*')
          .eq('session_id', session.id)
          .eq('task_key', body.taskId)
          .maybeSingle();
        if (readError) throw readError;
        if (!currentRow && toolroomSelection?.kind === 'powrot-formy-narzedziownia' && toolroomSelection.enabled) {
          const parentId = toolroomParentId({ id: body.taskId, notes: {} });
          if (!parentId || body.taskId !== toolroomReturnId(parentId)) return NextResponse.json({ code: 'TOOLROOM_TASK_FORBIDDEN' }, { status: 403 });
          const { data: parentRow, error: parentError } = await supabaseAdmin
            .from('przygotowanie_produkcji_tasks').select('*')
            .eq('session_id', session.id).eq('task_key', parentId).maybeSingle();
          if (parentError) throw parentError;
          if (!parentRow || !canSelectToolroomWork(fromDbTask(parentRow), 'forma-narzedziownia')) {
            return NextResponse.json({ code: 'TOOLROOM_TASK_FORBIDDEN' }, { status: 403 });
          }
          const child = createToolroomReturnTask(fromDbTask(parentRow));
          // Deterministic ID makes concurrent selections converge on the same return.
          const { error: createError } = await supabaseAdmin.from('przygotowanie_produkcji_tasks').insert({
            id: toolroomRowUuid(session.id, child.id),
            ...toDbTask({ ...child, kinds: [], teams: [] }, session.id, Number(parentRow.position_no ?? 0), access.user.name)
          });
          if (createError && createError.code !== '23505') throw createError;
          continue;
        }
        if (!currentRow) return NextResponse.json({ code: 'TASK_NOT_FOUND' }, { status: 404 });

        const currentTask = await withStoredToolroomReturnState(
          session.id,
          fromDbTask(currentRow as Record<string, unknown>)
        );
        if (toolroomSelection && !canSelectToolroomWork(currentTask, toolroomSelection.kind)) {
          return NextResponse.json({ code: 'TOOLROOM_TASK_FORBIDDEN', message: 'Nie można przypisać tej pracy do wskazanej pozycji.' }, { status: 403 });
        }
        if (isScopedMaterialEdit && !isMaterialScheduleTask(currentTask)) {
          return materialTaskForbidden();
        }
        if (teamDoneMutation && isProductionCompletableTeam(teamDoneMutation.team)) {
          if (!currentTask.teams.includes(teamDoneMutation.team)) {
            return NextResponse.json({
              code: 'TEAM_NOT_ASSIGNED',
              message: 'Ten dział nie jest przypisany do zadania.'
            }, { status: 409 });
          }
          if (teamDoneMutation.done === true && !canProductionTeamStart(currentTask, teamDoneMutation.team)) {
            const waitingForToolroomReturn = productionWaitsForToolroomReturn(currentTask, teamDoneMutation.team);
            return NextResponse.json({
              code: 'TEAM_NOT_READY',
              message: waitingForToolroomReturn
                ? 'Najpierw mechanik musi zakończyć „Powrót formy z narzędziowni”.'
                : 'Najpierw muszą zakończyć pracę wszystkie wymagane działy przygotowania.',
              waitingTeams: productionWaitingTeams(currentTask, teamDoneMutation.team),
              waitingForToolroomReturn
            }, { status: 409 });
          }
        }
        if (distributionStageMutation && !currentTask.teams.includes('distribution')) {
          return NextResponse.json({
            code: 'TEAM_NOT_ASSIGNED',
            message: 'Rozdzielca nie jest przypisany do tego zadania.'
          }, { status: 409 });
        }
        if (distributionStageMutation?.done === true && !canProductionTeamStart(currentTask, 'distribution')) {
          return NextResponse.json({ code: 'TEAM_NOT_READY', message: 'To zadanie nie jest aktywne.' }, { status: 409 });
        }
        if (
          workCommentMutation
          && isProductionTeam(workCommentMutation.team)
          && !currentTask.teams.includes(workCommentMutation.team)
        ) {
          return NextResponse.json({
            code: 'TEAM_NOT_ASSIGNED',
            message: 'Ten dział nie jest przypisany do zadania.'
          }, { status: 409 });
        }
        const nextTask = applyTaskMutation(currentTask, toolroomSelection ? toolroomWorkMutation(currentTask, toolroomSelection) : body.mutation, {
          completedAt: now,
          completedBy: access.user.name
        });
        const storedTask = toDbTask(nextTask, session.id, Number(currentRow.position_no ?? 0), access.user.name);
        const currentTaskVersion = Date.parse(String(currentRow.updated_at ?? ''));
        const currentSessionVersion = Date.parse(String(session.updated_at ?? ''));
        const nextVersionMs = Math.max(
          Date.now(),
          Number.isFinite(currentTaskVersion) ? currentTaskVersion + 1 : 0,
          Number.isFinite(currentSessionVersion) ? currentSessionVersion + 1 : 0
        );
        storedTask.updated_at = new Date(nextVersionMs).toISOString();
        const updates = omitFields(storedTask, ['session_id', 'task_key', 'position_no'] as const);
        const { data: updatedRow, error: updateError } = await supabaseAdmin
          .from('przygotowanie_produkcji_tasks')
          .update(updates)
          .eq('id', currentRow.id)
          .eq('updated_at', currentRow.updated_at)
          .select('*')
          .maybeSingle();
        if (updateError) throw updateError;
        if (!updatedRow) continue;

        let machineStateError: unknown = null;
        try {
          if (teamDoneMutation?.done === true && teamDoneMutation.team === 'mechanics'
            && !isProductionTeamDone(currentTask, 'mechanics')
            && (nextTask.kinds.includes('zmiana-formy') || nextTask.kinds.includes('powrot-formy-narzedziownia'))) {
            await updateMachineState(session.id, nextTask, 'mounted', access.user.name, storedTask.updated_at);
          }
          if (teamDoneMutation?.done === true && teamDoneMutation.team === 'process'
            && !isProductionTeamDone(currentTask, 'process')
            && (nextTask.kinds.includes('rozruch') || nextTask.kinds.includes('wznowienie'))) {
            await updateMachineState(session.id, nextTask, 'started', access.user.name, storedTask.updated_at);
          }
        } catch (error) {
          machineStateError = error;
        }

        const linkedParentId = toolroomParentId(nextTask);
        const updatedTaskVersion = Date.parse(storedTask.updated_at);
        const cascadeUpdatedAt = linkedParentId
          && (nextTask.kinds.includes('anulowane') || !isProductionTeamDone(nextTask, 'mechanics'))
          ? await clearToolroomParentStartupProgress(
              session.id,
              linkedParentId,
              access.user.name,
              Number.isFinite(updatedTaskVersion) ? updatedTaskVersion : Date.now(),
              true
            )
          : null;
        const taskRows = await syncToolroomReturns(session.id, access.user.name);
        const currentTasks = withToolroomReturnTasks((taskRows ?? [])
          .filter((row) => !isModuleSettings(row as Record<string, unknown>))
          .map((row) => fromDbTask(row as Record<string, unknown>)));
        const latestTaskVersion = Math.max(
          Date.parse(storedTask.updated_at),
          cascadeUpdatedAt ? Date.parse(cascadeUpdatedAt) : 0,
          ...(taskRows ?? []).map((row) => Date.parse(String(row.updated_at ?? ''))).filter(Number.isFinite)
        );
        const sessionUpdatedAt = new Date(latestTaskVersion).toISOString();
        const { error: sessionUpdateError } = await supabaseAdmin
          .from('przygotowanie_produkcji_sessions')
          .update({ updated_at: sessionUpdatedAt })
          .eq('id', session.id);
        if (sessionUpdateError) throw sessionUpdateError;
        await saveHistorySnapshot(session, currentTasks as unknown as Array<Record<string, unknown>>);
        if (machineStateError) throw machineStateError;
        const responseTask = currentTasks.find((task) => task.id === body.taskId)
          ?? fromDbTask(updatedRow as Record<string, unknown>);
        return NextResponse.json({
          task: materialAccess === 'none'
            ? maskMaterialFields(responseTask)
            : responseTask
        });
      }

      return NextResponse.json({
        code: 'TASK_UPDATE_CONFLICT',
        message: 'Ktoś równocześnie zmieniał to zadanie. Spróbuj ponownie.'
      }, { status: 409 });
    }

    return NextResponse.json({ code: 'INVALID_ACTION' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nie udało się zapisać planu.';
    return NextResponse.json({ code: 'PREPARATION_SAVE_FAILED', message }, { status: 400 });
  }
}
