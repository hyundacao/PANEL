import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

export const pageSource = readFileSync(new URL('../../app/(main)/przygotowanie-produkcji/page.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('page.tsx', pageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

export function findNode(root, predicate) {
  if (predicate(root)) return root;
  return ts.forEachChild(root, child => findNode(child, predicate));
}

export function declaration(name, root = ast) {
  const node = findNode(root, node => ts.isVariableDeclaration(node) && node.name.getText(root) === name);
  assert.ok(node, `Missing declaration: ${name}`);
  return `const ${node.getText(root)};`;
}

export function planExpression(prefix) {
  const node = findNode(ast, node => ts.isJsxExpression(node) && node.expression?.getText(ast).startsWith(prefix));
  assert.ok(node, `Missing plan UI: ${prefix}`);
  return node.getText(ast);
}

const accessDeclarations = [
  'requestedWorkPlanView', 'isPreparationAdmin', 'grantedTeamIds', 'canViewPlan', 'canAssignToolroomWork',
  'materialAccess', 'canViewMaterials', 'canEditMaterials', 'hasAccessToWorkPlan',
  'defaultExecutorWorkPlanView', 'workPlanView', 'executorActiveView', 'activeView'
].map(name => declaration(name)).join('\n');

export const accessFixtureSource = `
export function resolveView(preparationAccess, requestedView = null) {
  ${accessDeclarations}
  return { activeView, isPreparationAdmin, canViewPlan, workPlanView };
}`;

// Compile the real JSX, so tests catch accidental read-only or filtering regressions.
export const planFixtureSource = `
${['teamOptions', 'workKinds', 'automaticTeams', 'editableWorkKinds', 'normalize', 'isPanelGroupHeader', 'planGroupLabel', 'taskChoiceBackground', 'assignedForTheDay'].map(name => declaration(name)).join('\n')}
export function PlanFixture({ access, requestedView = null, tasks: initialTasks, initialSearch = '', initiallyExpanded = [], onMutation = () => {}, onTasksChange }) {
  const [tasks, setTasks] = useState(initialTasks);
  React.useEffect(() => { onTasksChange?.(tasks); }, [tasks, onTasksChange]);
  const preparationAccess = access;
  ${accessDeclarations}
  const [stationSearch, setStationSearch] = useState(initialSearch);
  const [expandedPlannedTasks, setExpandedPlannedTasks] = useState(initiallyExpanded);
  ${['activeTasks', 'plannedTasks', 'visibleActiveTasks', 'visiblePlannedTasks', 'togglePlannedTask'].map(name => declaration(name)).join('\n')}
  const loadingSavedPlan = false;
  const importing = false;
  const readingWorkbook = false;
  const fileInputRef = { current: null };
  const workbookSource = null;
  const fileName = 'plan-test.xlsx';
  const sheetName = 'Plan';
  const importError = null;
  const preparePlanImport = onMutation;
  const clearAllAssignments = onMutation;
  const updateTask = onMutation;
  const saveTaskMutation = (taskId, mutation) => onMutation({ taskId, mutation });
  ${['mutateTask', 'updateTaskNote', 'canEditWorkKind', 'isWorkKindSelected', 'toggleKind', 'toggleTeam', 'planTaskWorkItems', 'togglePlanTeam'].map(name => declaration(name)).join('\n')}
  return <>
    ${planExpression("isPreparationAdmin && (activeView === 'plan'")}
    ${planExpression("activeView === 'plan' && <div")}
    ${planExpression("activeView === 'plan' && stationSearch.trim()")}
    ${planExpression("activeView === 'plan' && visibleActiveTasks.length")}
    ${planExpression("activeView === 'plan' && visiblePlannedTasks.length")}
  </>;
}`;

export const makeTask = (id, station, planGroup = 'standard') => ({
  id, station, planGroup, isCurrentPlan: true, detail: `Product ${id}`, quantity: '1000', norm: '500',
  highlighted: false, done: false, kinds: ['zmiana-formy'], teams: ['mechanics'],
  notes: { mechanics: 'Test instruction' }, teamProgress: {}, material: '25.09'
});

export const sampleTasks = [
  makeTask('current-34', 'WTR 34'), makeTask('current-3', 'WTR 3'),
  makeTask('emergency-34', 'WTR. 034', 'emergency'),
  makeTask('planned-34', 'WTR34', 'planned'), makeTask('planned-134', 'WTR 134', 'planned')
];
