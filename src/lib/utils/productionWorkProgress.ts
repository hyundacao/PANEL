import type { ProductionTeam } from './productionTeamComments';

export const PRODUCTION_TEAM_PROGRESS_NOTE_KEY = '__teamProgress';

export const PRODUCTION_PREPARATION_TEAMS = [
  'mechanics',
  'distribution',
  'technician'
] as const satisfies readonly ProductionTeam[];

export const PRODUCTION_STARTUP_TEAMS = [
  'process',
  'graphics'
] as const satisfies readonly ProductionTeam[];

export const PRODUCTION_ACTION_TEAMS = [
  ...PRODUCTION_PREPARATION_TEAMS,
  ...PRODUCTION_STARTUP_TEAMS
] as const satisfies readonly ProductionTeam[];

export type ProductionTeamCompletion = {
  completedAt: string;
  completedBy: string;
};

export type ProductionTeamProgress = Partial<Record<ProductionTeam, ProductionTeamCompletion>>;

type ProgressTask = {
  teams?: readonly unknown[];
  kinds?: readonly unknown[];
  teamProgress?: unknown;
  toolroomReturnDone?: boolean;
  done?: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const isProductionPreparationTeam = (team: unknown): team is typeof PRODUCTION_PREPARATION_TEAMS[number] =>
  typeof team === 'string' && PRODUCTION_PREPARATION_TEAMS.includes(team as typeof PRODUCTION_PREPARATION_TEAMS[number]);

export const isProductionStartupTeam = (team: unknown): team is typeof PRODUCTION_STARTUP_TEAMS[number] =>
  typeof team === 'string' && PRODUCTION_STARTUP_TEAMS.includes(team as typeof PRODUCTION_STARTUP_TEAMS[number]);

export const isProductionActionTeam = (team: unknown): team is typeof PRODUCTION_ACTION_TEAMS[number] =>
  typeof team === 'string' && PRODUCTION_ACTION_TEAMS.includes(team as typeof PRODUCTION_ACTION_TEAMS[number]);

export const normalizeProductionTeamProgress = (value: unknown): ProductionTeamProgress => {
  if (!isRecord(value)) return {};
  const result: ProductionTeamProgress = {};
  for (const team of PRODUCTION_ACTION_TEAMS) {
    const raw = value[team];
    if (raw === true) {
      result[team] = { completedAt: '', completedBy: '' };
      continue;
    }
    if (!isRecord(raw)) continue;
    result[team] = {
      completedAt: typeof raw.completedAt === 'string' ? raw.completedAt.slice(0, 80) : '',
      completedBy: typeof raw.completedBy === 'string' ? raw.completedBy.slice(0, 120) : ''
    };
  }
  return result;
};

export const productionActionTeamsForTask = (task: ProgressTask): ProductionTeam[] =>
  PRODUCTION_ACTION_TEAMS.filter((team) => task.teams?.includes(team));

export const productionWaitsForToolroomReturn = (task: ProgressTask, team: ProductionTeam): boolean =>
  isProductionStartupTeam(team)
  && task.kinds?.includes('forma-narzedziownia') === true
  && task.toolroomReturnDone === false;

export const productionTeamProgressForTask = (task: ProgressTask): ProductionTeamProgress => {
  const assigned = new Set(productionActionTeamsForTask(task));
  const normalized = normalizeProductionTeamProgress(task.teamProgress);
  let filtered = Object.fromEntries(
    Object.entries(normalized).filter(([team]) => assigned.has(team as ProductionTeam))
  ) as ProductionTeamProgress;
  if (Object.keys(filtered).length === 0 && task.done === true) {
    filtered = Object.fromEntries(
      [...assigned].map((team) => [team, { completedAt: '', completedBy: '' }])
    ) as ProductionTeamProgress;
  }
  for (const startupTeam of PRODUCTION_STARTUP_TEAMS) {
    if (!assigned.has(startupTeam)) continue;
    const missingPreparation = PRODUCTION_PREPARATION_TEAMS.some(
      (preparationTeam) => assigned.has(preparationTeam) && !filtered[preparationTeam]
    );
    if (missingPreparation || productionWaitsForToolroomReturn(task, startupTeam)) delete filtered[startupTeam];
  }
  return filtered;
};

export const productionTeamCompletion = (
  task: ProgressTask,
  team: ProductionTeam
): ProductionTeamCompletion | undefined => productionTeamProgressForTask(task)[team];

export const isProductionTeamDone = (task: ProgressTask, team: ProductionTeam): boolean =>
  Boolean(productionTeamCompletion(task, team));

export const productionWaitingTeams = (task: ProgressTask, team: ProductionTeam): ProductionTeam[] => {
  if (!isProductionStartupTeam(team)) return [];
  const waitingTeams = PRODUCTION_PREPARATION_TEAMS.filter(
    (requiredTeam) => task.teams?.includes(requiredTeam) && !isProductionTeamDone(task, requiredTeam)
  );
  // A linked return is a second, separate mechanic operation. Keep startup cards
  // blocked even after the mechanic has completed the original removal task.
  if (productionWaitsForToolroomReturn(task, team) && !waitingTeams.includes('mechanics')) {
    waitingTeams.push('mechanics');
  }
  return waitingTeams;
};

export const canProductionTeamStart = (task: ProgressTask, team: ProductionTeam): boolean => {
  if (!isProductionActionTeam(team) || !task.teams?.includes(team)) return false;
  if (task.kinds?.includes('anulowane')) return false;
  return !isProductionStartupTeam(team)
    || (productionWaitingTeams(task, team).length === 0 && !productionWaitsForToolroomReturn(task, team));
};

export const isProductionTaskDone = (task: ProgressTask): boolean => {
  const assignedTeams = productionActionTeamsForTask(task);
  return assignedTeams.length > 0 && assignedTeams.every((team) => isProductionTeamDone(task, team));
};

export const setProductionTeamCompletion = (
  value: unknown,
  team: ProductionTeam,
  done: boolean,
  completion: ProductionTeamCompletion = { completedAt: '', completedBy: '' }
): ProductionTeamProgress => {
  const next = normalizeProductionTeamProgress(value);
  if (done && isProductionActionTeam(team)) next[team] = completion;
  else delete next[team];
  return next;
};
