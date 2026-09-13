export const PERSONAL_TASK_SETTINGS_DATE = '2000-01-01';
export const PERSONAL_TASK_STORAGE_PREFIX = '__personal_task__:';
export const PERSONAL_TASK_STATION = 'ZADANIE OSOBISTE';

export const PERSONAL_TASK_RECURRENCES = ['once', 'daily', 'weekly', 'monthly'] as const;
export type PersonalTaskRecurrence = typeof PERSONAL_TASK_RECURRENCES[number];

export type PersonalTaskInput = {
  title: string;
  dueDate: string;
  recurrence: PersonalTaskRecurrence;
};

export type PersonalTask = PersonalTaskInput & {
  id: string;
  done: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  lastCompletedAt?: string;
  lastCompletedDueDate?: string;
};

export const MAX_PERSONAL_TASKS = 200;
export const MAX_PERSONAL_TASK_TITLE_LENGTH = 240;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const isPersonalTaskRecurrence = (value: unknown): value is PersonalTaskRecurrence =>
  typeof value === 'string' && PERSONAL_TASK_RECURRENCES.includes(value as PersonalTaskRecurrence);

const parseIsoDate = (value: unknown) => {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day, 12));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) return null;
  return { year, month, day };
};

export const isPersonalTaskDate = (value: unknown): value is string => Boolean(parseIsoDate(value));

const formatIsoDate = (year: number, month: number, day: number) =>
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const addCalendarDays = (value: string, days: number) => {
  const parsed = parseIsoDate(value);
  if (!parsed) return null;
  const next = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days, 12));
  return formatIsoDate(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
};

const addCalendarMonth = (value: string, anchorDay: number) => {
  const parsed = parseIsoDate(value);
  if (!parsed) return null;
  const targetMonth = new Date(Date.UTC(parsed.year, parsed.month, 1, 12));
  const year = targetMonth.getUTCFullYear();
  const month = targetMonth.getUTCMonth() + 1;
  const daysInMonth = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
  return formatIsoDate(year, month, Math.min(Math.max(anchorDay, 1), daysInMonth));
};

export const personalTaskAnchorDay = (date: string) => parseIsoDate(date)?.day ?? 1;

export const nextPersonalTaskDueDate = (
  dueDate: string,
  recurrence: PersonalTaskRecurrence,
  completedOn: string,
  anchorDay = personalTaskAnchorDay(dueDate)
): string | null => {
  if (recurrence === 'once' || !parseIsoDate(dueDate) || !parseIsoDate(completedOn)) return null;
  let candidate = dueDate;
  for (let index = 0; index < 20_000; index += 1) {
    candidate = recurrence === 'daily'
      ? addCalendarDays(candidate, 1) ?? candidate
      : recurrence === 'weekly'
        ? addCalendarDays(candidate, 7) ?? candidate
        : addCalendarMonth(candidate, anchorDay) ?? candidate;
    if (candidate > completedOn) return candidate;
  }
  return null;
};

export const validatePersonalTaskInput = (value: unknown): string | null => {
  if (!isRecord(value)) return 'Nieprawidłowe dane zadania.';
  if (typeof value.title !== 'string' || !value.title.trim()) return 'Wpisz treść zadania.';
  if (value.title.trim().length > MAX_PERSONAL_TASK_TITLE_LENGTH) {
    return `Treść zadania może mieć maksymalnie ${MAX_PERSONAL_TASK_TITLE_LENGTH} znaków.`;
  }
  if (!isPersonalTaskDate(value.dueDate)) return 'Wybierz prawidłowy termin zadania.';
  if (!isPersonalTaskRecurrence(value.recurrence)) return 'Wybierz prawidłową cykliczność zadania.';
  return null;
};

export const normalizePersonalTaskInput = (value: unknown): PersonalTaskInput | null => {
  if (validatePersonalTaskInput(value) || !isRecord(value)) return null;
  return {
    title: String(value.title).trim(),
    dueDate: String(value.dueDate),
    recurrence: value.recurrence as PersonalTaskRecurrence
  };
};

export const isPersonalTaskId = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export const personalTaskOwnerPrefix = (ownerId: string) =>
  `${PERSONAL_TASK_STORAGE_PREFIX}${encodeURIComponent(ownerId)}:`;

export const personalTaskStorageKey = (ownerId: string, taskId: string) =>
  `${personalTaskOwnerPrefix(ownerId)}${taskId}`;

export const personalTaskIdFromStorageKey = (key: unknown, ownerId: string): string | null => {
  if (typeof key !== 'string') return null;
  const prefix = personalTaskOwnerPrefix(ownerId);
  if (!key.startsWith(prefix)) return null;
  const id = key.slice(prefix.length);
  return isPersonalTaskId(id) ? id : null;
};

export const sortPersonalTasks = (value: PersonalTask[]) => [...value].sort((left, right) => {
  if (left.done !== right.done) return left.done ? 1 : -1;
  if (left.done) return String(right.completedAt ?? right.updatedAt).localeCompare(String(left.completedAt ?? left.updatedAt));
  const byDate = left.dueDate.localeCompare(right.dueDate);
  return byDate || right.updatedAt.localeCompare(left.updatedAt);
});
