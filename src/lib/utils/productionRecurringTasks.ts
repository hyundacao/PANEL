import { isProductionTeam, type ProductionTeam } from './productionTeamComments';
import { isProductionHallSelection, type ProductionHallSelection } from './productionTaskReference';

export const RECURRING_TASK_SETTINGS_KEY = '__recurring_tasks__';
export const RECURRING_TASK_STATION = 'ZADANIE CYKLICZNE';
export const RECURRING_TASK_ID_PREFIX = 'zadanie-cykliczne:';

export const RECURRING_TASK_WEEKDAYS = [
  { value: 1, label: 'Pon' },
  { value: 2, label: 'Wt' },
  { value: 3, label: 'Śr' },
  { value: 4, label: 'Czw' },
  { value: 5, label: 'Pt' },
  { value: 6, label: 'Sob' },
  { value: 7, label: 'Nd' }
] as const;

export type RecurringTaskDefinition = {
  id: string;
  title: string;
  weekdays: number[];
  teams: ProductionTeam[];
  active: boolean;
  hall?: ProductionHallSelection;
};

const MAX_RECURRING_TASKS = 100;
const MAX_RECURRING_TASK_TITLE_LENGTH = 240;
const VALID_ID = /^[a-zA-Z0-9_-]{1,80}$/;

export const normalizeRecurringTasks = (value: unknown): RecurringTaskDefinition[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: RecurringTaskDefinition[] = [];

  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const id = String(record.id ?? '').trim();
    const title = String(record.title ?? '').trim().slice(0, MAX_RECURRING_TASK_TITLE_LENGTH);
    if (!VALID_ID.test(id) || !title || seen.has(id)) continue;
    seen.add(id);
    const weekdays = Array.isArray(record.weekdays)
      ? [...new Set(record.weekdays.filter((day): day is number => Number.isInteger(day) && day >= 1 && day <= 7))].sort((left, right) => left - right)
      : [];
    const teams = Array.isArray(record.teams)
      ? [...new Set(record.teams.filter(isProductionTeam))]
      : [];
    result.push({ id, title, weekdays, teams, active: record.active !== false, ...(isProductionHallSelection(record.hall) ? { hall: record.hall } : {}) });
    if (result.length >= MAX_RECURRING_TASKS) break;
  }

  return result;
};

export const validateRecurringTasks = (value: unknown): string | null => {
  if (!Array.isArray(value)) return 'Nieprawidłowa lista zadań cyklicznych.';
  if (value.length > MAX_RECURRING_TASKS) return `Możesz zapisać maksymalnie ${MAX_RECURRING_TASKS} zadań cyklicznych.`;

  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return 'Nieprawidłowe zadanie cykliczne.';
    const record = item as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const title = typeof record.title === 'string' ? record.title.trim() : '';
    if (!VALID_ID.test(id) || seen.has(id)) return 'Każde zadanie cykliczne musi mieć unikalny identyfikator.';
    seen.add(id);
    if (!title) return 'Wpisz treść każdego zadania cyklicznego.';
    if (title.length > MAX_RECURRING_TASK_TITLE_LENGTH) return `Treść zadania może mieć maksymalnie ${MAX_RECURRING_TASK_TITLE_LENGTH} znaków.`;
    if (!Array.isArray(record.weekdays) || record.weekdays.length === 0 || record.weekdays.some((day) => !Number.isInteger(day) || Number(day) < 1 || Number(day) > 7)) {
      return `Wybierz co najmniej jeden dzień tygodnia dla zadania „${title}”.`;
    }
    if (!Array.isArray(record.teams) || record.teams.length === 0 || record.teams.some((team) => !isProductionTeam(team))) {
      return `Wybierz co najmniej jedną grupę dla zadania „${title}”.`;
    }
    if (typeof record.active !== 'boolean') return 'Nieprawidłowy status zadania cyklicznego.';
    if (record.hall !== undefined && !isProductionHallSelection(record.hall)) return 'Wybierz Halę 1, Halę 2, obie hale albo pozostaw zadanie nieprzypisane.';
  }
  return null;
};

export const isoWeekdayForDate = (date: string): number | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day, 12));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  return parsed.getUTCDay() || 7;
};

export const recurringTasksForDate = (value: unknown, date: string): RecurringTaskDefinition[] => {
  const weekday = isoWeekdayForDate(date);
  if (!weekday) return [];
  return normalizeRecurringTasks(value).filter((task) => task.active && task.weekdays.includes(weekday));
};

export const recurringTaskInstanceId = (definitionId: string, date: string) =>
  `${RECURRING_TASK_ID_PREFIX}${definitionId}:${date}`;

export const isRecurringTaskStation = (station: string) => station === RECURRING_TASK_STATION;
