export const TOOLROOM_RETURN_KIND = 'powrot-formy-narzedziownia';
export const TOOLROOM_SEND_KIND = 'forma-narzedziownia';
export type ToolroomWorkKind = typeof TOOLROOM_SEND_KIND | typeof TOOLROOM_RETURN_KIND;
export type ToolroomWorkSelection = { kind: ToolroomWorkKind; enabled: boolean };
export const isToolroomWorkKind = (kind: unknown): kind is ToolroomWorkKind =>
  kind === TOOLROOM_SEND_KIND || kind === TOOLROOM_RETURN_KIND;
export const TOOLROOM_RETURN_LABEL = 'Powrót formy z narzędziowni';
export const TOOLROOM_PARENT_NOTE = 'toolroomParentId';
const RETURN_ID_PREFIX = 'toolroom-return:';

type ToolroomTask = {
  id: string;
  station: string;
  detail: string;
  quantity: string;
  norm: string;
  isCurrentPlan: boolean;
  planGroup: string;
  highlighted: boolean;
  kinds: string[];
  teams: string[];
  notes: { toolroomParentId?: string };
  teamProgress?: Record<string, unknown>;
  toolroomReturnDone?: boolean;
  done: boolean;
  material: string;
  materialType: string;
  source: string;
  dryer: string;
  temperature: string;
};

export const toolroomReturnId = (parentId: string) => `${RETURN_ID_PREFIX}${encodeURIComponent(parentId)}`;

export const toolroomParentId = (task: Pick<ToolroomTask, 'id' | 'notes'>): string | null => {
  if (typeof task.notes?.toolroomParentId === 'string' && task.notes.toolroomParentId) return task.notes.toolroomParentId;
  if (!task.id.startsWith(RETURN_ID_PREFIX)) return null;
  try { return decodeURIComponent(task.id.slice(RETURN_ID_PREFIX.length)) || null; } catch { return null; }
};

export const isToolroomReturnTask = (task: Pick<ToolroomTask, 'id' | 'notes'>) => toolroomParentId(task) !== null;

export const toolroomLinkNotes = (task: Pick<ToolroomTask, 'id' | 'notes'>): { toolroomParentId?: string } => {
  const parentId = toolroomParentId(task);
  return parentId ? { toolroomParentId: parentId } : {};
};

export const createToolroomReturnTask = <T extends ToolroomTask>(parent: T): T => ({
  ...parent,
  id: toolroomReturnId(parent.id),
  isCurrentPlan: false,
  planGroup: 'standard',
  highlighted: false,
  kinds: [TOOLROOM_RETURN_KIND],
  teams: ['mechanics', 'process'],
  notes: { toolroomParentId: parent.id },
  teamProgress: {},
  toolroomReturnDone: undefined,
  done: false,
  material: '', materialType: '', source: '', dryer: '', temperature: ''
});

export const canSelectToolroomWork = (task: ToolroomTask, kind: ToolroomWorkKind) =>
  Boolean(task.station) && !task.kinds.includes('anulowane') && (kind === TOOLROOM_RETURN_KIND
    ? isToolroomReturnTask(task)
    : task.isCurrentPlan && !isToolroomReturnTask(task));

// The client sends only a kind and a boolean, never arbitrary team/note changes.
export const toolroomWorkMutation = (task: ToolroomTask, selection: ToolroomWorkSelection) => {
  const { kind, enabled } = selection;
  const changed = task.kinds.includes(kind) !== enabled || (enabled && !task.teams.includes('mechanics'));
  const setNotesIfMissing: Record<string, string> = enabled && kind === TOOLROOM_SEND_KIND
    ? { process: 'Wznowienie procesu po powrocie z narzędziowni.' }
    : {};
  return {
    addKinds: enabled ? [kind] : [],
    removeKinds: enabled ? [] : [kind],
    addTeams: enabled ? ['mechanics' as const, 'process' as const] : [],
    removeTeams: !enabled && kind === TOOLROOM_RETURN_KIND ? ['mechanics' as const, 'process' as const] : [],
    setNotesIfMissing,
    ...(changed ? { setTeamDone: { team: 'mechanics' as const, done: false } } : {})
  };
};

// Returns are work instructions, never an additional production/material-plan row.
// Existing return tasks retain their own assignments, notes, cancellation and completion.
export const withToolroomReturnTasks = <T extends ToolroomTask>(tasks: T[], createMissing = true): T[] => {
  const children = new Map<string, T>();
  const parents: T[] = [];
  for (const task of tasks) {
    const parentId = toolroomParentId(task);
    if (parentId) {
      if (!children.has(parentId)) children.set(parentId, task);
    } else parents.push(task);
  }
  const result: T[] = [];
  for (const parent of parents) {
    const existing = children.get(parent.id);
    const requiresReturn = parent.station !== 'ZADANIE DODATKOWE'
      && (parent.kinds.includes(TOOLROOM_SEND_KIND)
        || Boolean(existing?.kinds.includes(TOOLROOM_RETURN_KIND) && existing.teams.includes('mechanics') && !existing.kinds.includes('anulowane')))
      && !parent.kinds.includes('anulowane');
    const needsReturn = requiresReturn && parent.teams.includes('mechanics');
    const existingReturnDone = Boolean(
      existing
      && existing.teams.includes('mechanics')
      && !existing.kinds.includes('anulowane')
      && (existing.done || existing.teamProgress?.mechanics)
    );
    const parentProgress = { ...(parent.teamProgress ?? {}) };
    if (requiresReturn && !existingReturnDone) {
      delete parentProgress.process;
      delete parentProgress.graphics;
    }
    const parentWithReturnState = {
      ...parent,
      toolroomReturnDone: requiresReturn
        ? existingReturnDone
        : undefined,
      teamProgress: parentProgress,
      done: requiresReturn && !existingReturnDone ? false : parent.done
    } as T;
    result.push(parentWithReturnState);
    if (existing) {
      children.delete(parent.id);
      result.push({
        ...existing,
        station: parent.station, detail: parent.detail, quantity: parent.quantity, norm: parent.norm,
        isCurrentPlan: false,
        toolroomReturnDone: undefined,
        notes: { ...existing.notes, toolroomParentId: parent.id }
      });
    } else if (createMissing && needsReturn) {
      result.push(createToolroomReturnTask(parent));
    }
  }
  // Keep a pending return even when its original production row is no longer present.
  children.forEach((child) => result.push({ ...child, isCurrentPlan: false }));
  return result;
};
