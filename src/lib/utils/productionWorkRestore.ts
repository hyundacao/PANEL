import { appendProductionWorkEvent, productionWorkEvents, revertProductionWorkEvent, type ProductionWorkEvent } from './productionTaskLifecycle';
import { isProductionCompletableTeam, isProductionTaskDone, normalizeProductionTeamProgress, productionTeamProgressForTask, setProductionTeamCompletion, type ProductionTeamProgress } from './productionWorkProgress';

export const PRODUCTION_RESTORED_WORK_PREFIX = 'restored-work:';
export const PRODUCTION_RESTORED_EVENT_NOTE = '__restoredWorkEvent';

type RestoreTask = {
  id: string;
  station: string;
  detail: string;
  kinds: string[];
  teams: string[];
  notes: Record<string, string>;
  teamProgress?: ProductionTeamProgress;
  done: boolean;
};

export const productionRestorableEvents = (task: RestoreTask): ProductionWorkEvent[] => {
  const events = productionWorkEvents(task.notes);
  for (const [team, completion] of Object.entries(productionTeamProgressForTask(task))) {
    if (!isProductionCompletableTeam(team) || !completion?.completedAt) continue;
    const id = `${task.id}:${team}:${completion.completedAt}`;
    if (!events.some(event => event.id === id)) events.push({
      id, team, kinds: task.kinds, completedAt: completion.completedAt, completedBy: completion.completedBy
    });
  }
  return events;
};

export const canRestoreProductionWorkInPlace = (task: RestoreTask, event: ProductionWorkEvent): boolean => {
  if (!isProductionCompletableTeam(event.team) || task.kinds.includes('anulowane')) return false;
  const before = productionTeamProgressForTask(task);
  if (before[event.team]?.completedAt !== event.completedAt) return false;
  const after = productionTeamProgressForTask({
    ...task, done: false, teamProgress: setProductionTeamCompletion(before, event.team, false)
  });
  return Object.entries(before).every(([team, completion]) => team === event.team
    || (event.team === 'distribution' && (team === 'distributionMaterials' || team === 'distributionStation'))
    || after[team as keyof ProductionTeamProgress]?.completedAt === completion?.completedAt);
};

// Revoke the selected occurrence, not the latest occurrence for this team.
export const revokeProductionWork = <T extends RestoreTask>(task: T, event: ProductionWorkEvent, at: string): T => {
  const existing = productionWorkEvents(task.notes);
  const notes = existing.some(item => item.id === event.id) ? task.notes : appendProductionWorkEvent(task.notes, event);
  const next = { ...task, notes: revertProductionWorkEvent(notes, event.team, at, event.id) };
  if (isProductionCompletableTeam(event.team)
    && normalizeProductionTeamProgress(task.teamProgress)[event.team]?.completedAt === event.completedAt
    && canRestoreProductionWorkInPlace(task, event)) {
    next.teamProgress = setProductionTeamCompletion(task.teamProgress, event.team, false);
    next.done = isProductionTaskDone({ ...next, done: false });
  }
  return next;
};
