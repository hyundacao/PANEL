import type { ProductionTeam } from './productionTeamComments';

export const PRODUCTION_TEAM_PROGRESS_NOTE_KEY = '__teamProgress';
export const PRODUCTION_REOPENED_NOTE_PREFIX = '__reopenedNoteBase:';
export const PRODUCTION_REOPENED_DETAIL_PREFIX = '__reopenedDetailBase:';
const PRODUCTION_REOPENED_NOTE_VALUE_PREFIX = 'v1:';

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

// Sections listed here have their own completion toggle. "Additional" is kept
// outside the workflow teams so it never blocks preparation or startup.
export const PRODUCTION_COMPLETABLE_TEAMS = [
  ...PRODUCTION_ACTION_TEAMS,
  'additional'
] as const satisfies readonly ProductionTeam[];

export type ProductionTeamCompletion = {
  completedAt: string;
  completedBy: string;
};

export const PRODUCTION_DISTRIBUTION_STAGES = ['materials', 'station'] as const;
export type ProductionDistributionStage = typeof PRODUCTION_DISTRIBUTION_STAGES[number];
const distributionStageKeys = {
  materials: 'distributionMaterials',
  station: 'distributionStation'
} as const;
type DistributionStageKey = typeof distributionStageKeys[ProductionDistributionStage];

export type ProductionTeamProgress = Partial<Record<ProductionTeam | DistributionStageKey, ProductionTeamCompletion>>;

type ProgressTask = {
  teams?: readonly unknown[];
  kinds?: readonly unknown[];
  teamProgress?: unknown;
  toolroomReturnDone?: boolean;
  done?: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const productionReopenedNoteKey = (team: ProductionTeam) =>
  `${PRODUCTION_REOPENED_NOTE_PREFIX}${team}`;

export const productionReopenedDetailKey = (team: ProductionTeam) =>
  `${PRODUCTION_REOPENED_DETAIL_PREFIX}${team}`;

export const encodeProductionReopenedNoteBase = (value: string) =>
  `${PRODUCTION_REOPENED_NOTE_VALUE_PREFIX}${value}`;

export const productionReopenedNoteBase = (notes: unknown, team: ProductionTeam): string | null => {
  if (!isRecord(notes)) return null;
  const value = notes[productionReopenedNoteKey(team)];
  return typeof value === 'string' && value.startsWith(PRODUCTION_REOPENED_NOTE_VALUE_PREFIX)
    ? value.slice(PRODUCTION_REOPENED_NOTE_VALUE_PREFIX.length)
    : null;
};

const productionReopenedTextDiff = (base: string | null, current: string) => {
  if (base === null) return null;
  let commonLength = 0;
  while (commonLength < base.length && commonLength < current.length && base[commonLength] === current[commonLength]) {
    commonLength += 1;
  }
  return {
    unchanged: current.slice(0, commonLength),
    changed: current.slice(commonLength),
    wasChanged: current !== base
  };
};

export const productionReopenedNoteDiff = (notes: unknown, team: ProductionTeam) => {
  if (!isRecord(notes)) return null;
  return productionReopenedTextDiff(
    productionReopenedNoteBase(notes, team),
    typeof notes[team] === 'string' ? notes[team] : ''
  );
};

export const productionReopenedDetailBase = (notes: unknown, team: ProductionTeam): string | null => {
  if (!isRecord(notes)) return null;
  const value = notes[productionReopenedDetailKey(team)];
  return typeof value === 'string' && value.startsWith(PRODUCTION_REOPENED_NOTE_VALUE_PREFIX)
    ? value.slice(PRODUCTION_REOPENED_NOTE_VALUE_PREFIX.length)
    : null;
};

export const productionReopenedDetailDiff = (notes: unknown, team: ProductionTeam, detail: string) =>
  productionReopenedTextDiff(productionReopenedDetailBase(notes, team), detail);

export const isProductionPreparationTeam = (team: unknown): team is typeof PRODUCTION_PREPARATION_TEAMS[number] =>
  typeof team === 'string' && PRODUCTION_PREPARATION_TEAMS.includes(team as typeof PRODUCTION_PREPARATION_TEAMS[number]);

export const isProductionStartupTeam = (team: unknown): team is typeof PRODUCTION_STARTUP_TEAMS[number] =>
  typeof team === 'string' && PRODUCTION_STARTUP_TEAMS.includes(team as typeof PRODUCTION_STARTUP_TEAMS[number]);

export const isProductionActionTeam = (team: unknown): team is typeof PRODUCTION_ACTION_TEAMS[number] =>
  typeof team === 'string' && PRODUCTION_ACTION_TEAMS.includes(team as typeof PRODUCTION_ACTION_TEAMS[number]);

export const isProductionCompletableTeam = (team: unknown): team is typeof PRODUCTION_COMPLETABLE_TEAMS[number] =>
  typeof team === 'string'
  && PRODUCTION_COMPLETABLE_TEAMS.includes(team as typeof PRODUCTION_COMPLETABLE_TEAMS[number]);

export const isProductionDistributionStage = (stage: unknown): stage is ProductionDistributionStage =>
  typeof stage === 'string'
  && PRODUCTION_DISTRIBUTION_STAGES.includes(stage as ProductionDistributionStage);

export const normalizeProductionTeamProgress = (value: unknown): ProductionTeamProgress => {
  if (!isRecord(value)) return {};
  const result: ProductionTeamProgress = {};
  for (const team of [...PRODUCTION_COMPLETABLE_TEAMS, ...Object.values(distributionStageKeys)]) {
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

export const productionCompletableTeamsForTask = (task: ProgressTask): ProductionTeam[] =>
  PRODUCTION_COMPLETABLE_TEAMS.filter((team) => task.teams?.includes(team));

export const productionWaitsForToolroomReturn = (task: ProgressTask, team: ProductionTeam): boolean =>
  isProductionStartupTeam(team)
  && task.toolroomReturnDone === false;

export const productionTeamProgressForTask = (task: ProgressTask): ProductionTeamProgress => {
  const assigned = new Set(productionCompletableTeamsForTask(task));
  const normalized = normalizeProductionTeamProgress(task.teamProgress);
  let filtered = Object.fromEntries(
    Object.entries(normalized).filter(([team]) => assigned.has(team as ProductionTeam)
      || (assigned.has('distribution') && Object.values(distributionStageKeys).includes(team as DistributionStageKey)))
  ) as ProductionTeamProgress;
  if (Object.keys(filtered).length === 0 && task.done === true) {
    const legacyActionTeams = productionActionTeamsForTask(task);
    const inferredDoneTeams = legacyActionTeams.length > 0 ? legacyActionTeams : [...assigned];
    filtered = Object.fromEntries(
      inferredDoneTeams.map((team) => [team, { completedAt: '', completedBy: '' }])
    ) as ProductionTeamProgress;
  }
  if (assigned.has('distribution')) {
    if (filtered.distribution && !filtered.distributionMaterials && !filtered.distributionStation) {
      filtered.distributionMaterials = filtered.distribution;
      filtered.distributionStation = filtered.distribution;
    }
    if (filtered.distributionMaterials && filtered.distributionStation) {
      filtered.distribution = filtered.distributionStation;
    } else {
      delete filtered.distribution;
    }
  }
  for (const startupTeam of PRODUCTION_STARTUP_TEAMS) {
    if (!assigned.has(startupTeam)) continue;
    const missingPreparation = PRODUCTION_PREPARATION_TEAMS.some(
      (preparationTeam) => assigned.has(preparationTeam)
        && !(startupTeam === 'process' && preparationTeam === 'distribution'
          ? filtered.distributionMaterials
          : filtered[preparationTeam])
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

export const productionDistributionStageCompletion = (
  task: ProgressTask,
  stage: ProductionDistributionStage
): ProductionTeamCompletion | undefined => productionTeamProgressForTask(task)[distributionStageKeys[stage]];

export const isProductionDistributionStageDone = (task: ProgressTask, stage: ProductionDistributionStage): boolean =>
  Boolean(productionDistributionStageCompletion(task, stage));

export const productionWaitingTeams = (task: ProgressTask, team: ProductionTeam): ProductionTeam[] => {
  if (!isProductionStartupTeam(team)) return [];
  const waitingTeams = PRODUCTION_PREPARATION_TEAMS.filter(
    (requiredTeam) => task.teams?.includes(requiredTeam)
      && !(team === 'process' && requiredTeam === 'distribution'
        ? isProductionDistributionStageDone(task, 'materials')
        : isProductionTeamDone(task, requiredTeam))
  );
  // A linked return is a second, separate mechanic operation. Keep startup cards
  // blocked even after the mechanic has completed the original removal task.
  if (productionWaitsForToolroomReturn(task, team) && !waitingTeams.includes('mechanics')) {
    waitingTeams.push('mechanics');
  }
  return waitingTeams;
};

export const canProductionTeamStart = (task: ProgressTask, team: ProductionTeam): boolean => {
  if (!isProductionCompletableTeam(team) || !task.teams?.includes(team)) return false;
  if (task.kinds?.includes('anulowane')) return false;
  return !isProductionStartupTeam(team)
    || (productionWaitingTeams(task, team).length === 0 && !productionWaitsForToolroomReturn(task, team));
};

export const isProductionTaskDone = (task: ProgressTask): boolean => {
  const requiredTeams = productionActionTeamsForTask(task);
  if (requiredTeams.length > 0) {
    return requiredTeams.every((team) => isProductionTeamDone(task, team));
  }

  const optionalTeams = productionCompletableTeamsForTask(task);
  return optionalTeams.length > 0
    && optionalTeams.every((team) => isProductionTeamDone(task, team));
};

export const setProductionTeamCompletion = (
  value: unknown,
  team: ProductionTeam,
  done: boolean,
  completion: ProductionTeamCompletion = { completedAt: '', completedBy: '' }
): ProductionTeamProgress => {
  const next = normalizeProductionTeamProgress(value);
  if (done && isProductionCompletableTeam(team)) {
    next[team] = completion;
    if (team === 'distribution') {
      next.distributionMaterials = completion;
      next.distributionStation = completion;
    }
  } else {
    delete next[team];
    if (team === 'distribution') {
      delete next.distributionMaterials;
      delete next.distributionStation;
    }
  }
  return next;
};

export const setProductionDistributionStageCompletion = (
  value: unknown,
  stage: ProductionDistributionStage,
  done: boolean,
  completion: ProductionTeamCompletion = { completedAt: '', completedBy: '' }
): ProductionTeamProgress => {
  const next = normalizeProductionTeamProgress(value);
  if (next.distribution && !next.distributionMaterials && !next.distributionStation) {
    next.distributionMaterials = next.distribution;
    next.distributionStation = next.distribution;
  }
  const key = distributionStageKeys[stage];
  if (done) next[key] = completion;
  else delete next[key];
  if (next.distributionMaterials && next.distributionStation) {
    next.distribution = next.distributionStation;
  } else {
    delete next.distribution;
  }
  return next;
};
