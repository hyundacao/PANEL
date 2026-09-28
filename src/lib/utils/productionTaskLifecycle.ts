export const PRODUCTION_TASK_DUE_DATE_NOTE = '__dueDate';
export const PRODUCTION_WORK_EVENTS_NOTE = '__workEvents';
export const PRODUCTION_LEGACY_COMPLETION_DAY_NOTE = '__legacyCompletionDay';
export const PRODUCTION_HISTORY_DETAIL_DAYS = 7;

export const productionHistoryCutoffDate = (today: string): string => {
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (PRODUCTION_HISTORY_DETAIL_DAYS - 1));
  return date.toISOString().slice(0, 10);
};

export const isRecentProductionHistoryDate = (date: string, today: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= productionHistoryCutoffDate(today) && date <= today;

export type ProductionWorkEvent = {
  id: string;
  team: string;
  kinds: string[];
  completedAt: string;
  completedBy: string;
  revertedAt?: string;
};

export type ProductionCompletedWork = ProductionWorkEvent & {
  taskId?: string;
  station: string;
  detail: string;
  planDate: string;
};

export const mergeProductionCompletedWork = (
  previous: readonly ProductionCompletedWork[],
  current: readonly ProductionCompletedWork[]
): ProductionCompletedWork[] => [...new Map([...previous, ...current].map(item => [item.id, item])).values()]
  .filter(item => !item.revertedAt);

export type ProductionDaySummary = {
  version: 1;
  assignments: number;
  completedEvents: number;
  missedRecurring: number;
  kinds: Record<string, { total: number; done: number }>;
  sourceDigest?: string;
};

type RetainedProductionTask = {
  id: string;
  station: string;
  isCurrentPlan: boolean;
  kinds: readonly string[];
  teams: readonly string[];
  notes: Record<string, string | undefined>;
  done: boolean;
};

export const canRetireProductionSession = (
  oldDate: string,
  activeDate: string,
  summary: ProductionDaySummary | null,
  oldTasks: readonly RetainedProductionTask[],
  activeTasks: readonly RetainedProductionTask[]
): boolean => {
  if (oldDate >= activeDate || !summary || !/^[a-f0-9]{64}$/.test(summary.sourceDigest ?? '')) return false;
  if (summary.version !== 1 || !summary.kinds || typeof summary.kinds !== 'object' || Array.isArray(summary.kinds)) return false;
  if (!Number.isSafeInteger(summary.assignments) || summary.assignments < 0
    || !Number.isSafeInteger(summary.completedEvents) || summary.completedEvents < 0
    || !Number.isSafeInteger(summary.missedRecurring) || summary.missedRecurring < 0
    || Object.values(summary.kinds).some(count => !count || !Number.isSafeInteger(count.total)
      || !Number.isSafeInteger(count.done) || count.total < 0 || count.done < 0 || count.done > count.total)
    || Object.values(summary.kinds).reduce((total, count) => total + count.total, 0) !== summary.assignments) return false;
  const activeById = new Map(activeTasks.map(task => [task.id, task]));
  for (const task of oldTasks) {
    if (task.id.startsWith('__machine_state__:')) {
      const current = activeById.get(task.id);
      if (!current || !current.notes.__machineAt || current.notes.__machineAt < (task.notes.__machineAt ?? '')) return false;
      continue;
    }
    if ((task.station === 'ZADANIE DODATKOWE' || task.id.startsWith('restored-work:')) && shouldCarryProductionTask(task)
      && !task.done && !activeById.has(task.id)) return false;
    if (task.id.startsWith('toolroom-return:') && shouldCarryProductionTask(task) && !task.done) {
      let parentId: string;
      try {
        parentId = decodeURIComponent(task.id.slice('toolroom-return:'.length));
      } catch {
        return false;
      }
      if (activeById.has(parentId) && !activeById.has(task.id)) return false;
    }
  }
  return true;
};

const warsawDateFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit'
});

const warsawDateAt = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = warsawDateFormatter.formatToParts(date);
  const part = (name: string) => parts.find(item => item.type === name)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};

export const isProductionCompletionVisibleOnDate = (
  team: string,
  completion: { completedAt?: string } | undefined,
  date: string,
  legacyCompletionDate?: string
): boolean => {
  if ((team !== 'distribution' && team !== 'technician') || !completion) return true;
  const completedDate = warsawDateAt(completion.completedAt ?? '')
    || (/^\d{4}-\d{2}-\d{2}$/.test(legacyCompletionDate ?? '') ? legacyCompletionDate : '');
  return !completedDate || completedDate >= date;
};

export const productionTaskDoneOnDate = (task: {
  done?: boolean;
  teamProgress?: Record<string, { completedAt?: string } | undefined>;
  notes?: Record<string, string | undefined>;
}, date: string): boolean => {
  if (!task.done) return false;
  const completions = Object.values(task.teamProgress ?? {}).map(value => value?.completedAt).filter((value): value is string => Boolean(value));
  if (completions.length === 0) return !task.notes?.[PRODUCTION_LEGACY_COMPLETION_DAY_NOTE]
    || task.notes[PRODUCTION_LEGACY_COMPLETION_DAY_NOTE] === date;
  if (productionWorkEvents(task.notes).some(event => event.revertedAt
    && task.teamProgress?.[event.team]?.completedAt === event.completedAt)) return false;
  return warsawDateAt(completions.sort().at(-1) ?? '') === date;
};

export const summarizeProductionDay = (tasks: readonly {
  station?: string;
  kinds?: readonly string[];
  teams?: readonly string[];
  notes?: Record<string, string | undefined>;
  done?: boolean;
  teamProgress?: Record<string, { completedAt?: string } | undefined>;
}[], date: string): ProductionDaySummary => {
  const kinds: ProductionDaySummary['kinds'] = {};
  let assignments = 0;
  const eventIds = new Set<string>();
  let missedRecurring = 0;
  const add = (kind: string, done: boolean) => {
    const count = kinds[kind] ?? { total: 0, done: 0 };
    kinds[kind] = { total: count.total + 1, done: count.done + (done ? 1 : 0) };
    assignments += 1;
  };
  for (const task of tasks) {
    if (task.station === 'ZADANIE CYKLICZNE' && !task.done) missedRecurring += 1;
    for (const event of productionWorkEvents(task.notes)) {
      if (!event.revertedAt && warsawDateAt(event.completedAt) === date) eventIds.add(event.id);
    }
    const doneOnDate = productionTaskDoneOnDate(task, date);
    for (const kind of task.kinds ?? []) add(kind, doneOnDate);
    if (task.teams?.includes('distribution') && task.notes?.distribution?.toLocaleLowerCase().includes('przygotowa')) {
      add('przygotowanie-stanowiska', doneOnDate);
    }
    if (task.kinds?.includes('forma-narzedziownia') && task.teams?.includes('process')) {
      add('wznowienie-procesu', doneOnDate);
    }
  }
  return { version: 1, assignments, completedEvents: eventIds.size, missedRecurring, kinds };
};

export const productionSummaryFromTasks = (tasks: unknown): ProductionDaySummary | null => {
  if (!Array.isArray(tasks) || tasks.length !== 1) return null;
  const marker = tasks[0];
  if (!marker || typeof marker !== 'object') return null;
  const summary = (marker as Record<string, unknown>).__productionSummary;
  if (!summary || typeof summary !== 'object' || (summary as Record<string, unknown>).version !== 1) return null;
  return summary as ProductionDaySummary;
};

export const productionWorkEvents = (notes: Record<string, string | undefined> | undefined): ProductionWorkEvent[] => {
  try {
    const parsed: unknown = JSON.parse(notes?.[PRODUCTION_WORK_EVENTS_NOTE] ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is ProductionWorkEvent =>
      value !== null && typeof value === 'object' && typeof value.id === 'string'
      && typeof value.team === 'string' && Array.isArray(value.kinds)
      && typeof value.completedAt === 'string' && typeof value.completedBy === 'string');
  } catch {
    return [];
  }
};

export const appendProductionWorkEvent = (
  notes: Record<string, string>,
  event: ProductionWorkEvent
): Record<string, string> => ({
  ...notes,
  [PRODUCTION_WORK_EVENTS_NOTE]: JSON.stringify([...productionWorkEvents(notes), event].slice(-100))
});

export const revertProductionWorkEvent = (
  notes: Record<string, string>,
  team: string,
  revertedAt: string,
  eventId?: string
): Record<string, string> => {
  const events = productionWorkEvents(notes);
  const index = events.findLastIndex(event => event.team === team && !event.revertedAt
    && (eventId === undefined || event.id === eventId));
  if (index < 0) return notes;
  events[index] = { ...events[index], revertedAt };
  return { ...notes, [PRODUCTION_WORK_EVENTS_NOTE]: JSON.stringify(events) };
};

export const productionKindOwner = (kind: string): string => {
  if (kind === 'zmiana-formy' || kind === 'forma-narzedziownia' || kind === 'powrot-formy-narzedziownia') return 'mechanics';
  if (kind === 'zmiana-grafiki') return 'graphics';
  if (kind === 'inne') return 'additional';
  return 'process';
};

export const productionTaskDueDate = (notes: Record<string, string | undefined> | undefined): string => {
  const value = notes?.[PRODUCTION_TASK_DUE_DATE_NOTE] ?? '';
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
};

export const recentProductionDates = (dates: readonly string[], count = 6): string[] =>
  [...new Set(dates.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort().reverse().slice(0, count);

export const shouldCarryProductionTask = (task: {
  id: string;
  station: string;
  isCurrentPlan: boolean;
  kinds: readonly string[];
  teams: readonly string[];
}): boolean => {
  if (task.id.startsWith('zadanie-cykliczne:') || task.station === 'ZADANIE CYKLICZNE') return false;
  if (task.id.includes('::work-event:')) return false;
  if (task.kinds.includes('anulowane')) return false;
  if (task.id.startsWith('toolroom-return:')) return task.teams.length > 0;
  if (task.id.startsWith('restored-work:')) return task.teams.length > 0;
  if (task.isCurrentPlan) return true;
  return task.station === 'ZADANIE DODATKOWE' && task.teams.length > 0;
};
