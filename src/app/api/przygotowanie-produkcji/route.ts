import { NextRequest, NextResponse } from 'next/server';
import { canSeeTab, isReadOnly } from '@/lib/auth/access';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/admin';

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
  done: boolean;
  material: string;
  materialType: string;
  source: string;
  dryer: string;
  temperature: string;
};

type StoredTaskMutation = {
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
  clearWork?: boolean;
};

const PROCESS_ENGINEERS_SETTINGS_KEY = '__process_engineers__';
const PROCESS_ENGINEERS_SETTINGS_DATE = '2000-01-01';
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
  const { data: settingsSession, error: sessionError } = await supabaseAdmin
    .from('przygotowanie_produkcji_sessions')
    .select('id')
    .eq('session_date', PROCESS_ENGINEERS_SETTINGS_DATE)
    .maybeSingle();
  if (sessionError) throw sessionError;
  if (!settingsSession) return null;
  const { data: settingsRow, error: settingsError } = await supabaseAdmin
    .from('przygotowanie_produkcji_tasks')
    .select('notes')
    .eq('session_id', settingsSession.id)
    .eq('task_key', PROCESS_ENGINEERS_SETTINGS_KEY)
    .maybeSingle();
  if (settingsError) throw settingsError;
  if (!settingsRow?.notes || typeof settingsRow.notes !== 'object') return null;
  const notes = settingsRow.notes as Record<string, unknown>;
  return normalizeProcessEngineerRoster(notes.processEngineerRoster, notes.processEngineers);
};

const todayKey = () => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
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
  const notes = task.notes && typeof task.notes === 'object' ? Object.keys(task.notes).length : 0;
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
  const assignedTasks = tasks.filter((task) => !isProcessEngineersSettings(task) && hasAssignment(task));
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
    const { data: previousSessions, error: sessionError } = await supabaseAdmin
      .from('przygotowanie_produkcji_sessions')
      .select('id, session_date, file_name, plan_sheet, created_by')
      .lt('session_date', todayKey())
      .neq('session_date', PROCESS_ENGINEERS_SETTINGS_DATE);
    if (sessionError) throw sessionError;

    for (const session of previousSessions ?? []) {
      const { data: existingHistory, error: historyLookupError } = await supabaseAdmin
        .from('przygotowanie_produkcji_history')
        .select('plan_date')
        .eq('plan_date', session.session_date)
        .maybeSingle();
      if (historyLookupError) throw historyLookupError;
      if (existingHistory) continue;

      const { data: taskRows, error: taskError } = await supabaseAdmin
        .from('przygotowanie_produkcji_tasks')
        .select('*')
        .eq('session_id', session.id)
        .order('position_no');
      if (taskError) throw taskError;
      const tasks = (taskRows ?? []).filter((task) => {
        const record = task as Record<string, unknown>;
        return !isProcessEngineersSettings(record) && hasAssignment(record);
      });
      if (!tasks.length) continue;

      const { error: historyError } = await supabaseAdmin
        .from('przygotowanie_produkcji_history')
        .insert({
          plan_date: session.session_date,
          file_name: session.file_name,
          plan_sheet: session.plan_sheet,
          tasks,
          archived_by: session.created_by
        });
      if (historyError) throw historyError;
    }
  } catch (error) {
    // History is optional. A missing migration must never block the current plan or delete data.
    console.error('[przygotowanie-produkcji] History archive skipped:', error);
  }
};

const ensureAccess = async (request: NextRequest, write = false) => {
  const auth = await getAuthenticatedUser(request);
  if (!auth.user) return { user: null, response: unauthorized(auth.code ?? 'UNAUTHORIZED') };
  if (!canSeeTab(auth.user, 'PRZYGOTOWANIE_PRODUKCJI', 'przygotowanie-produkcji')) {
    return { user: null, response: NextResponse.json({ code: 'FORBIDDEN' }, { status: 403 }) };
  }
  if (write && isReadOnly(auth.user, 'PRZYGOTOWANIE_PRODUKCJI')) {
    return { user: null, response: NextResponse.json({ code: 'READ_ONLY' }, { status: 403 }) };
  }
  return { user: auth.user, response: null };
};

const toDbTask = (task: StoredTask, sessionId: string, position: number, userName: string) => ({
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
  notes: task.notes && typeof task.notes === 'object' ? task.notes : {},
  done: Boolean(task.done),
  material: String(task.material ?? ''),
  material_type: String(task.materialType ?? ''),
  source: String(task.source ?? ''),
  dryer: String(task.dryer ?? ''),
  temperature: String(task.temperature ?? ''),
  updated_at: new Date().toISOString(),
  updated_by: userName
});

const fromDbTask = (row: Record<string, unknown>): StoredTask => ({
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
  notes: row.notes && typeof row.notes === 'object' ? row.notes as Record<string, string> : {},
  done: Boolean(row.done),
  material: String(row.material ?? ''),
  materialType: String(row.material_type ?? ''),
  source: String(row.source ?? ''),
  dryer: String(row.dryer ?? ''),
  temperature: String(row.temperature ?? '')
});

const validWorkKinds = new Set([
  'zmiana-formy', 'forma-narzedziownia', 'rozruch', 'wznowienie', 'zmiana-koloru',
  'zmiana-grafiki', 'regulacja', 'proby', 'przeglad-a', 'anulowane', 'inne'
]);
const validTeams = new Set(['mechanics', 'process', 'distribution', 'graphics', 'technician', 'additional']);
const validNoteKeys = new Set([...validTeams, 'processAssignee']);

const applyTaskMutation = (task: StoredTask, mutation: StoredTaskMutation): StoredTask => {
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
    notes: mutation.clearWork ? {} : { ...task.notes }
  };

  const removedKinds = new Set((mutation.removeKinds ?? []).filter((kind) => validWorkKinds.has(kind)));
  const addedKinds = (mutation.addKinds ?? []).filter((kind) => validWorkKinds.has(kind));
  next.kinds = [...new Set([...next.kinds.filter((kind) => !removedKinds.has(kind)), ...addedKinds])];

  const removedTeams = new Set((mutation.removeTeams ?? []).filter((team) => validTeams.has(team)));
  const addedTeams = (mutation.addTeams ?? []).filter((team) => validTeams.has(team));
  next.teams = [...new Set([...next.teams.filter((team) => !removedTeams.has(team)), ...addedTeams])];

  Object.entries(mutation.setNotesIfMissing ?? {}).forEach(([key, value]) => {
    if (!validNoteKeys.has(key) || String(next.notes[key] ?? '').trim()) return;
    next.notes[key] = String(value);
  });
  Object.entries(mutation.setNotes ?? {}).forEach(([key, value]) => {
    if (!validNoteKeys.has(key)) return;
    if (value === null || value === '') delete next.notes[key];
    else next.notes[key] = String(value);
  });

  return next;
};

export async function GET(request: NextRequest) {
  try {
    const access = await ensureAccess(request);
    if (access.response) return access.response;
    const syncOnly = request.nextUrl.searchParams.get('sync') === '1';
    if (!syncOnly) await archivePreviousDays();
    if (request.nextUrl.searchParams.get('history') === '1') {
      const { data: history, error: historyError } = await supabaseAdmin
        .from('przygotowanie_produkcji_history')
        .select('plan_date, file_name, plan_sheet, tasks, archived_at')
        .order('plan_date', { ascending: false });
      if (historyError) {
        console.error('[przygotowanie-produkcji] History read skipped:', historyError);
        return NextResponse.json({ history: [] });
      }
      return NextResponse.json({
        history: (history ?? []).filter((entry) => Array.isArray(entry.tasks) && entry.tasks.length > 0)
      });
    }
    const { data: session, error: sessionError } = await supabaseAdmin
      .from('przygotowanie_produkcji_sessions')
      .select('id, session_date, file_name, plan_sheet, updated_at')
      .eq('session_date', todayKey())
      .maybeSingle();
    if (sessionError) throw sessionError;
    const requestedVersion = request.nextUrl.searchParams.get('since');
    if (syncOnly && session && requestedVersion && requestedVersion === String(session.updated_at ?? '')) {
      return NextResponse.json({ unchanged: true, updatedAt: session.updated_at });
    }
    const globalRoster = syncOnly ? null : await readGlobalProcessEngineerRoster();
    if (!session) {
      const processEngineerRoster = globalRoster ?? defaultProcessEngineerRoster();
      return NextResponse.json({
        session: null,
        tasks: [],
        processEngineers: processEngineerRoster.filter((engineer) => engineer.active).map((engineer) => engineer.name),
        processEngineerRoster
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
      .filter((row) => !isProcessEngineersSettings(row as Record<string, unknown>))
      .map((row) => fromDbTask(row as Record<string, unknown>));
    return NextResponse.json({ session, tasks, processEngineers, processEngineerRoster });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nie udało się odczytać planu.';
    return NextResponse.json({ code: 'PREPARATION_READ_FAILED', message }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await ensureAccess(request, true);
    if (access.response || !access.user) return access.response;
    await archivePreviousDays();
    const body = await request.json() as { action?: string; fileName?: string; sheetName?: string; tasks?: StoredTask[]; task?: StoredTask; taskId?: string; mutation?: StoredTaskMutation; processEngineers?: string[]; processEngineerRoster?: ProcessEngineerRosterEntry[]; planDate?: string };
    const now = new Date().toISOString();

    if (body.action === 'deleteHistoryDay') {
      const planDate = String(body.planDate ?? '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(planDate)) {
        return NextResponse.json({ code: 'INVALID_PLAN_DATE' }, { status: 400 });
      }
      const { error: historyError } = await supabaseAdmin
        .from('przygotowanie_produkcji_history')
        .update({ tasks: [], file_name: '', plan_sheet: '' })
        .eq('plan_date', planDate);
      if (historyError) throw historyError;
      return NextResponse.json({ deleted: true, planDate });
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
      return NextResponse.json({ processEngineers, processEngineerRoster });
    }

    if (body.action === 'savePlan') {
      const tasks = Array.isArray(body.tasks) ? body.tasks : [];
      const { data: session, error: sessionError } = await supabaseAdmin
        .from('przygotowanie_produkcji_sessions')
        .upsert({ session_date: todayKey(), file_name: body.fileName ?? '', plan_sheet: body.sheetName ?? '', created_by: access.user.name, updated_at: now }, { onConflict: 'session_date' })
        .select('id, session_date, file_name, plan_sheet, updated_at')
        .single();
      if (sessionError) throw sessionError;
      const taskKeys = tasks.map((task) => String(task.id));
      if (new Set(taskKeys).size !== taskKeys.length) {
        throw new Error('Plan zawiera powtarzające się identyfikatory pozycji. Dane nie zostały zmienione.');
      }
      const { data: storedRows, error: storedRowsError } = await supabaseAdmin
        .from('przygotowanie_produkcji_tasks')
        .select('id, task_key')
        .eq('session_id', session.id);
      if (storedRowsError) throw storedRowsError;
      const storedByTaskKey = new Map((storedRows ?? []).map((row) => [String(row.task_key), String(row.id)]));
      const importedRows = tasks.map((task, index) => toDbTask(task, session.id, index, access.user.name));
      const rowsToInsert = importedRows.filter((row) => !storedByTaskKey.has(String(row.task_key)));

      // The production database may not yet have the unique index required by Supabase upsert.
      // Updating known rows by their primary key makes repeated imports work with both schemas.
      for (const row of importedRows) {
        const storedId = storedByTaskKey.get(String(row.task_key));
        if (!storedId) continue;
        const updates = omitFields(row, ['session_id', 'task_key'] as const);
        const { error: updateError } = await supabaseAdmin
          .from('przygotowanie_produkcji_tasks')
          .update(updates)
          .eq('id', storedId);
        if (updateError) throw updateError;
      }
      if (rowsToInsert.length) {
        const { error: insertError } = await supabaseAdmin
          .from('przygotowanie_produkcji_tasks')
          .insert(rowsToInsert);
        if (insertError) throw insertError;
      }
      const staleIds = (storedRows ?? [])
        .filter((row) => String(row.task_key) !== PROCESS_ENGINEERS_SETTINGS_KEY && !taskKeys.includes(String(row.task_key)))
        .map((row) => String(row.id));
      if (staleIds.length) {
        const { error: retainError } = await supabaseAdmin
          .from('przygotowanie_produkcji_tasks')
          .update({ is_current_plan: false, updated_at: now, updated_by: access.user.name })
          .in('id', staleIds);
        if (retainError) throw retainError;
      }
      await saveHistorySnapshot(session, tasks as unknown as Array<Record<string, unknown>>);
      return NextResponse.json({ session, tasks });
    }

    if (body.action === 'updateTask' && body.task) {
      const { data: session, error: sessionError } = await supabaseAdmin
        .from('przygotowanie_produkcji_sessions')
        .select('id')
        .eq('session_date', todayKey())
        .maybeSingle();
      if (sessionError) throw sessionError;
      if (!session) return NextResponse.json({ code: 'NO_PLAN' }, { status: 409 });
      const storedTask = toDbTask(body.task, session.id, 0, access.user.name);
      const updates = omitFields(storedTask, ['session_id', 'task_key', 'position_no'] as const);
      const { error: taskError } = await supabaseAdmin
        .from('przygotowanie_produkcji_tasks')
        .update(updates)
        .eq('session_id', session.id)
        .eq('task_key', body.task.id);
      if (taskError) throw taskError;
      const { data: taskRows, error: taskRowsError } = await supabaseAdmin
        .from('przygotowanie_produkcji_tasks')
        .select('*')
        .eq('session_id', session.id);
      if (taskRowsError) throw taskRowsError;
      await saveHistorySnapshot({ ...session, session_date: todayKey(), created_by: access.user.name }, (taskRows ?? []) as Array<Record<string, unknown>>);
      return NextResponse.json({ task: body.task });
    }

    if (body.action === 'mutateTask' && body.taskId && body.mutation) {
      const { data: session, error: sessionError } = await supabaseAdmin
        .from('przygotowanie_produkcji_sessions')
        .select('id, session_date, file_name, plan_sheet, created_by')
        .eq('session_date', todayKey())
        .maybeSingle();
      if (sessionError) throw sessionError;
      if (!session) return NextResponse.json({ code: 'NO_PLAN' }, { status: 409 });

      for (let attempt = 0; attempt < 6; attempt += 1) {
        const { data: currentRow, error: readError } = await supabaseAdmin
          .from('przygotowanie_produkcji_tasks')
          .select('*')
          .eq('session_id', session.id)
          .eq('task_key', body.taskId)
          .maybeSingle();
        if (readError) throw readError;
        if (!currentRow) return NextResponse.json({ code: 'TASK_NOT_FOUND' }, { status: 404 });

        const currentTask = fromDbTask(currentRow as Record<string, unknown>);
        const nextTask = applyTaskMutation(currentTask, body.mutation);
        const storedTask = toDbTask(nextTask, session.id, Number(currentRow.position_no ?? 0), access.user.name);
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

        const { data: taskRows, error: taskRowsError } = await supabaseAdmin
          .from('przygotowanie_produkcji_tasks')
          .select('*')
          .eq('session_id', session.id)
          .order('position_no');
        if (taskRowsError) throw taskRowsError;
        const currentTasks = (taskRows ?? [])
          .filter((row) => !isProcessEngineersSettings(row as Record<string, unknown>))
          .map((row) => fromDbTask(row as Record<string, unknown>));
        const { error: sessionUpdateError } = await supabaseAdmin
          .from('przygotowanie_produkcji_sessions')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', session.id);
        if (sessionUpdateError) throw sessionUpdateError;
        await saveHistorySnapshot(session, currentTasks as unknown as Array<Record<string, unknown>>);
        return NextResponse.json({ task: fromDbTask(updatedRow as Record<string, unknown>) });
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
