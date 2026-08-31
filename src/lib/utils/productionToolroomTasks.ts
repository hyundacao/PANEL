export const TOOLROOM_RETURN_KIND = 'powrot-formy-narzedziownia';
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
    result.push(parent);
    const existing = children.get(parent.id);
    const needsReturn = parent.station !== 'ZADANIE DODATKOWE'
      && parent.kinds.includes('forma-narzedziownia')
      && parent.teams.includes('mechanics')
      && !parent.kinds.includes('anulowane');
    if (existing) {
      children.delete(parent.id);
      result.push({
        ...existing,
        station: parent.station, detail: parent.detail, quantity: parent.quantity, norm: parent.norm,
        isCurrentPlan: false,
        notes: { ...existing.notes, toolroomParentId: parent.id }
      });
    } else if (createMissing && needsReturn) {
      result.push({
        ...parent,
        id: toolroomReturnId(parent.id),
        isCurrentPlan: false,
        planGroup: 'standard',
        highlighted: false,
        kinds: [TOOLROOM_RETURN_KIND],
        teams: ['mechanics'],
        notes: { toolroomParentId: parent.id },
        done: false,
        material: '', materialType: '', source: '', dryer: '', temperature: ''
      } as T);
    }
  }
  // Keep a pending return even when its original production row is no longer present.
  children.forEach((child) => result.push({ ...child, isCurrentPlan: false }));
  return result;
};
