import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { canSeeTab } from '@/lib/auth/access';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getWarsawProductionPlanDate } from '@/lib/utils/productionPlanDate';
import {
  MAX_PERSONAL_TASKS,
  PERSONAL_TASK_SETTINGS_DATE,
  PERSONAL_TASK_STATION,
  isPersonalTaskDate,
  isPersonalTaskId,
  nextPersonalTaskDueDate,
  normalizePersonalTaskInput,
  personalTaskAnchorDay,
  personalTaskDueDateForToday,
  personalTaskIdFromStorageKey,
  personalTaskOwnerPrefix,
  personalTaskStorageKey,
  sortPersonalTasks,
  validatePersonalTaskInput,
  type PersonalTask,
  type PersonalTaskRecurrence
} from '@/lib/utils/productionPersonalTasks';

export const dynamic = 'force-dynamic';

type PersonalTaskMetadata = {
  ownerId: string;
  recurrence: PersonalTaskRecurrence;
  dueDate: string;
  recurrenceAnchorDay: number;
  createdAt: string;
  completedAt?: string;
  lastCompletedAt?: string;
  lastCompletedDueDate?: string;
  archivedAt?: string;
};

type PersonalTaskRow = Record<string, unknown> & {
  id?: string;
  session_id?: string;
  task_key?: string;
  detail?: string;
  notes?: unknown;
  done?: boolean;
  created_at?: string;
  updated_at?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const hasExactlyKeys = (value: Record<string, unknown>, expected: readonly string[]) => {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
};

const jsonError = (code: string, message: string, status: number) =>
  NextResponse.json({ code, message }, { status });

class PersonalTaskWriteConflict extends Error {}

const ensureAccess = async (request: NextRequest) => {
  const auth = await getAuthenticatedUser(request);
  if (!auth.user) {
    return { user: null, response: jsonError(auth.code ?? 'UNAUTHORIZED', 'Zaloguj się ponownie.', 401) };
  }
  if (!canSeeTab(auth.user, 'PRZYGOTOWANIE_PRODUKCJI', 'przygotowanie-produkcji')) {
    return { user: null, response: jsonError('FORBIDDEN', 'Brak dostępu do przygotowania produkcji.', 403) };
  }
  return { user: auth.user, response: null };
};

const readSettingsSessionId = async () => {
  const { data, error } = await supabaseAdmin
    .from('przygotowanie_produkcji_sessions')
    .select('id')
    .eq('session_date', PERSONAL_TASK_SETTINGS_DATE)
    .maybeSingle();
  if (error) throw error;
  return data?.id ? String(data.id) : null;
};

const ensureSettingsSessionId = async (userName: string) => {
  const now = new Date().toISOString();
  const { error: createError } = await supabaseAdmin
    .from('przygotowanie_produkcji_sessions')
    .upsert({
      session_date: PERSONAL_TASK_SETTINGS_DATE,
      file_name: 'USTAWIENIA',
      plan_sheet: '',
      created_by: userName,
      updated_at: now
    }, { onConflict: 'session_date', ignoreDuplicates: true });
  if (createError) throw createError;
  const sessionId = await readSettingsSessionId();
  if (!sessionId) throw new Error('Nie udało się utworzyć magazynu zadań osobistych.');
  return sessionId;
};

const metadataFromRow = (row: PersonalTaskRow, ownerId: string): PersonalTaskMetadata | null => {
  const id = personalTaskIdFromStorageKey(row.task_key, ownerId);
  if (!id || !isRecord(row.notes) || !isRecord(row.notes.personalTask)) return null;
  const metadata = row.notes.personalTask;
  if (metadata.ownerId !== ownerId) return null;
  const input = normalizePersonalTaskInput({
    title: row.detail,
    dueDate: metadata.dueDate,
    recurrence: metadata.recurrence
  });
  if (!input) return null;
  return {
    ownerId,
    recurrence: input.recurrence,
    dueDate: input.dueDate,
    recurrenceAnchorDay: Number.isInteger(metadata.recurrenceAnchorDay)
      ? Math.min(Math.max(Number(metadata.recurrenceAnchorDay), 1), 31)
      : personalTaskAnchorDay(input.dueDate),
    createdAt: typeof metadata.createdAt === 'string'
      ? metadata.createdAt
      : typeof row.created_at === 'string' ? row.created_at : '',
    ...(typeof metadata.completedAt === 'string' ? { completedAt: metadata.completedAt } : {}),
    ...(typeof metadata.lastCompletedAt === 'string' ? { lastCompletedAt: metadata.lastCompletedAt } : {}),
    ...(typeof metadata.lastCompletedDueDate === 'string' ? { lastCompletedDueDate: metadata.lastCompletedDueDate } : {}),
    ...(typeof metadata.archivedAt === 'string' ? { archivedAt: metadata.archivedAt } : {})
  };
};

const taskFromRow = (row: PersonalTaskRow, ownerId: string): PersonalTask | null => {
  const id = personalTaskIdFromStorageKey(row.task_key, ownerId);
  const metadata = metadataFromRow(row, ownerId);
  if (!id || !metadata || metadata.archivedAt) return null;
  return {
    id,
    title: String(row.detail ?? '').trim(),
    recurrence: metadata.recurrence,
    dueDate: personalTaskDueDateForToday(metadata, getWarsawProductionPlanDate()),
    done: metadata.recurrence === 'once' && row.done === true,
    createdAt: metadata.createdAt,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : metadata.createdAt,
    ...(metadata.completedAt ? { completedAt: metadata.completedAt } : {}),
    ...(metadata.lastCompletedAt ? { lastCompletedAt: metadata.lastCompletedAt } : {}),
    ...(metadata.lastCompletedDueDate ? { lastCompletedDueDate: metadata.lastCompletedDueDate } : {})
  };
};

const readPersonalTasks = async (ownerId: string): Promise<PersonalTask[]> => {
  const sessionId = await readSettingsSessionId();
  if (!sessionId) return [];
  const ownerPrefixPattern = `${personalTaskOwnerPrefix(ownerId).replace(/[%_]/g, '\\$&')}%`;
  const { data, error } = await supabaseAdmin
    .from('przygotowanie_produkcji_tasks')
    .select('task_key, detail, notes, done, created_at, updated_at')
    .eq('session_id', sessionId)
    .like('task_key', ownerPrefixPattern)
    .order('position_no');
  if (error) throw error;
  const tasks = (data ?? [])
    .map((row) => taskFromRow(row as PersonalTaskRow, ownerId))
    .filter((task): task is PersonalTask => Boolean(task));
  return sortPersonalTasks(tasks);
};

const readOwnedRow = async (ownerId: string, taskId: string) => {
  const sessionId = await readSettingsSessionId();
  if (!sessionId) return null;
  const { data, error } = await supabaseAdmin
    .from('przygotowanie_produkcji_tasks')
    .select('*')
    .eq('session_id', sessionId)
    .eq('task_key', personalTaskStorageKey(ownerId, taskId))
    .maybeSingle();
  if (error) throw error;
  if (!data || !metadataFromRow(data as PersonalTaskRow, ownerId)) return null;
  return { sessionId, row: data as PersonalTaskRow };
};

const updateOwnedRow = async (
  sessionId: string,
  ownerId: string,
  taskId: string,
  expectedUpdatedAt: string,
  values: Record<string, unknown>
) => {
  const { data, error } = await supabaseAdmin
    .from('przygotowanie_produkcji_tasks')
    .update(values)
    .eq('session_id', sessionId)
    .eq('task_key', personalTaskStorageKey(ownerId, taskId))
    .eq('updated_at', expectedUpdatedAt)
    .select('task_key')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new PersonalTaskWriteConflict();
};

const deleteOwnedRow = async (sessionId: string, ownerId: string, taskId: string, expectedUpdatedAt: string) => {
  const { data, error } = await supabaseAdmin
    .from('przygotowanie_produkcji_tasks')
    .delete()
    .eq('session_id', sessionId)
    .eq('task_key', personalTaskStorageKey(ownerId, taskId))
    .eq('updated_at', expectedUpdatedAt)
    .select('task_key')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new PersonalTaskWriteConflict();
};

export async function GET(request: NextRequest) {
  try {
    const access = await ensureAccess(request);
    if (access.response || !access.user) return access.response;
    return NextResponse.json({ tasks: await readPersonalTasks(access.user.id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nie udało się odczytać zadań osobistych.';
    return jsonError('PERSONAL_TASKS_READ_FAILED', message, 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await ensureAccess(request);
    if (access.response || !access.user) return access.response;
    const rawBody = await request.json() as unknown;
    if (!isRecord(rawBody) || typeof rawBody.action !== 'string') {
      return jsonError('INVALID_PERSONAL_TASK_REQUEST', 'Nieprawidłowe żądanie.', 400);
    }
    const ownerId = access.user.id;
    const now = new Date().toISOString();

    if (rawBody.action === 'create') {
      if (!hasExactlyKeys(rawBody, ['action', 'task']) || !isRecord(rawBody.task) || !hasExactlyKeys(rawBody.task, ['title', 'dueDate', 'recurrence'])) {
        return jsonError('INVALID_PERSONAL_TASK', 'Nieprawidłowe dane zadania.', 400);
      }
      const validationError = validatePersonalTaskInput(rawBody.task);
      const input = normalizePersonalTaskInput(rawBody.task);
      if (validationError || !input) return jsonError('INVALID_PERSONAL_TASK', validationError ?? 'Nieprawidłowe dane zadania.', 400);
      const existingTasks = await readPersonalTasks(ownerId);
      if (existingTasks.length >= MAX_PERSONAL_TASKS) {
        return jsonError('PERSONAL_TASK_LIMIT', `Możesz mieć maksymalnie ${MAX_PERSONAL_TASKS} aktywnych zadań osobistych.`, 400);
      }
      const sessionId = await ensureSettingsSessionId(access.user.name);
      const id = randomUUID();
      const metadata: PersonalTaskMetadata = {
        ownerId,
        recurrence: input.recurrence,
        dueDate: input.dueDate,
        recurrenceAnchorDay: personalTaskAnchorDay(input.dueDate),
        createdAt: now
      };
      const { error } = await supabaseAdmin.from('przygotowanie_produkcji_tasks').insert({
        session_id: sessionId,
        task_key: personalTaskStorageKey(ownerId, id),
        position_no: -3,
        is_current_plan: false,
        plan_group: 'standard',
        station: PERSONAL_TASK_STATION,
        detail: input.title,
        quantity: '',
        norm: '',
        highlighted: false,
        kinds: [],
        teams: [],
        notes: { personalTask: metadata },
        done: false,
        material: '',
        material_type: '',
        source: '',
        dryer: '',
        temperature: '',
        updated_at: now,
        updated_by: access.user.name
      });
      if (error) throw error;
      return NextResponse.json({ tasks: await readPersonalTasks(ownerId) }, { status: 201 });
    }

    if (!isPersonalTaskId(rawBody.id)) {
      return jsonError('INVALID_PERSONAL_TASK_ID', 'Nieprawidłowe zadanie.', 400);
    }
    const owned = await readOwnedRow(ownerId, rawBody.id);
    if (!owned) return jsonError('PERSONAL_TASK_NOT_FOUND', 'Nie znaleziono zadania.', 404);
    const metadata = metadataFromRow(owned.row, ownerId);
    if (!metadata || metadata.archivedAt) return jsonError('PERSONAL_TASK_NOT_FOUND', 'Nie znaleziono zadania.', 404);

    if (rawBody.action === 'update') {
      if (!hasExactlyKeys(rawBody, ['action', 'id', 'task']) || !isRecord(rawBody.task) || !hasExactlyKeys(rawBody.task, ['title', 'dueDate', 'recurrence'])) {
        return jsonError('INVALID_PERSONAL_TASK', 'Nieprawidłowe dane zadania.', 400);
      }
      const validationError = validatePersonalTaskInput(rawBody.task);
      const input = normalizePersonalTaskInput(rawBody.task);
      if (validationError || !input) return jsonError('INVALID_PERSONAL_TASK', validationError ?? 'Nieprawidłowe dane zadania.', 400);
      const currentDueDate = personalTaskDueDateForToday(metadata, getWarsawProductionPlanDate());
      const scheduleChanged = input.dueDate !== currentDueDate || input.recurrence !== metadata.recurrence;
      const nextMetadata: PersonalTaskMetadata = {
        ownerId,
        recurrence: input.recurrence,
        dueDate: input.dueDate,
        recurrenceAnchorDay: scheduleChanged ? personalTaskAnchorDay(input.dueDate) : metadata.recurrenceAnchorDay,
        createdAt: metadata.createdAt,
        ...(!scheduleChanged && metadata.completedAt ? { completedAt: metadata.completedAt } : {}),
        ...(!scheduleChanged && metadata.lastCompletedAt ? { lastCompletedAt: metadata.lastCompletedAt } : {}),
        ...(!scheduleChanged && metadata.lastCompletedDueDate ? { lastCompletedDueDate: metadata.lastCompletedDueDate } : {})
      };
      await updateOwnedRow(owned.sessionId, ownerId, rawBody.id, String(owned.row.updated_at ?? ''), {
        detail: input.title,
        notes: { personalTask: nextMetadata },
        done: scheduleChanged ? false : input.recurrence === 'once' && owned.row.done === true,
        updated_at: now,
        updated_by: access.user.name
      });
      return NextResponse.json({ tasks: await readPersonalTasks(ownerId) });
    }

    if (rawBody.action === 'complete') {
      if (!hasExactlyKeys(rawBody, ['action', 'id', 'occurrenceDate']) || !isPersonalTaskDate(rawBody.occurrenceDate)) {
        return jsonError('INVALID_PERSONAL_TASK_COMPLETION', 'Nieprawidłowe potwierdzenie zadania.', 400);
      }
      const today = getWarsawProductionPlanDate();
      if (metadata.recurrence === 'daily' && metadata.lastCompletedAt) {
        const completedAt = new Date(metadata.lastCompletedAt);
        if (Number.isFinite(completedAt.getTime()) && getWarsawProductionPlanDate(completedAt) === today) {
          return NextResponse.json({ tasks: await readPersonalTasks(ownerId) });
        }
      }
      const currentDueDate = personalTaskDueDateForToday(metadata, today);
      if (metadata.recurrence !== 'once'
        && metadata.lastCompletedDueDate === rawBody.occurrenceDate
        && currentDueDate !== rawBody.occurrenceDate) {
        return NextResponse.json({ tasks: await readPersonalTasks(ownerId) });
      }
      if (rawBody.occurrenceDate !== currentDueDate) {
        return jsonError('PERSONAL_TASK_OUTDATED', 'Termin zadania zmienił się. Lista została odświeżona.', 409);
      }
      if (metadata.recurrence === 'daily' && currentDueDate > today) {
        return jsonError('PERSONAL_TASK_NOT_DUE', 'To zadanie będzie ponownie do wykonania w kolejnym dniu.', 409);
      }
      if (metadata.recurrence === 'once') {
        if (!owned.row.done) {
          await updateOwnedRow(owned.sessionId, ownerId, rawBody.id, String(owned.row.updated_at ?? ''), {
            notes: { personalTask: { ...metadata, completedAt: now } },
            done: true,
            updated_at: now,
            updated_by: access.user.name
          });
        }
      } else {
        const nextDueDate = nextPersonalTaskDueDate(
          currentDueDate,
          metadata.recurrence,
          today,
          metadata.recurrenceAnchorDay
        );
        if (!nextDueDate) return jsonError('INVALID_PERSONAL_TASK_RECURRENCE', 'Nie udało się wyznaczyć kolejnego terminu.', 400);
        await updateOwnedRow(owned.sessionId, ownerId, rawBody.id, String(owned.row.updated_at ?? ''), {
          notes: {
            personalTask: {
              ...metadata,
              dueDate: nextDueDate,
              lastCompletedAt: now,
              lastCompletedDueDate: currentDueDate,
              completedAt: undefined
            }
          },
          done: false,
          updated_at: now,
          updated_by: access.user.name
        });
      }
      return NextResponse.json({ tasks: await readPersonalTasks(ownerId) });
    }

    if (rawBody.action === 'undo') {
      if (!hasExactlyKeys(rawBody, ['action', 'id'])) {
        return jsonError('INVALID_PERSONAL_TASK_UNDO', 'Nieprawidłowe cofnięcie zadania.', 400);
      }
      if (metadata.recurrence === 'once') {
        if (owned.row.done) {
          const nextMetadata = { ...metadata };
          delete nextMetadata.completedAt;
          await updateOwnedRow(owned.sessionId, ownerId, rawBody.id, String(owned.row.updated_at ?? ''), {
            notes: { personalTask: nextMetadata },
            done: false,
            updated_at: now,
            updated_by: access.user.name
          });
        }
      } else if (metadata.lastCompletedDueDate) {
        const lastCompletedDueDate = metadata.lastCompletedDueDate;
        const nextMetadata = { ...metadata };
        delete nextMetadata.lastCompletedAt;
        delete nextMetadata.lastCompletedDueDate;
        await updateOwnedRow(owned.sessionId, ownerId, rawBody.id, String(owned.row.updated_at ?? ''), {
          notes: { personalTask: { ...nextMetadata, dueDate: lastCompletedDueDate } },
          done: false,
          updated_at: now,
          updated_by: access.user.name
        });
      }
      return NextResponse.json({ tasks: await readPersonalTasks(ownerId) });
    }

    if (rawBody.action === 'archive') {
      if (!hasExactlyKeys(rawBody, ['action', 'id'])) {
        return jsonError('INVALID_PERSONAL_TASK_ARCHIVE', 'Nieprawidłowe usunięcie zadania.', 400);
      }
      await deleteOwnedRow(owned.sessionId, ownerId, rawBody.id, String(owned.row.updated_at ?? ''));
      return NextResponse.json({ tasks: await readPersonalTasks(ownerId) });
    }

    return jsonError('INVALID_PERSONAL_TASK_ACTION', 'Nieprawidłowa operacja na zadaniu.', 400);
  } catch (error) {
    if (error instanceof PersonalTaskWriteConflict) {
      return jsonError('PERSONAL_TASK_CONFLICT', 'Zadanie zostało zmienione w innym oknie. Lista została odświeżona.', 409);
    }
    const message = error instanceof Error ? error.message : 'Nie udało się zapisać zadania osobistego.';
    return jsonError('PERSONAL_TASK_WRITE_FAILED', message, 500);
  }
}
