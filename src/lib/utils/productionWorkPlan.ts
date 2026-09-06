import type { ProductionTeam } from './productionTeamComments';

export const PRODUCTION_WORK_PLAN_VIEWS = [
  'work-plan-technology',
  'work-plan-preparation'
] as const;

export type ProductionWorkPlanView = typeof PRODUCTION_WORK_PLAN_VIEWS[number];

export const PRODUCTION_WORK_PLAN_TEAM_IDS = {
  'work-plan-technology': ['mechanics', 'process', 'graphics'],
  'work-plan-preparation': ['distribution', 'technician', 'additional']
} as const satisfies Record<ProductionWorkPlanView, readonly ProductionTeam[]>;

export const normalizeProductionWorkPlanView = (value: unknown): ProductionWorkPlanView | null => {
  if (value === 'work-plan') return 'work-plan-technology';
  return typeof value === 'string' && PRODUCTION_WORK_PLAN_VIEWS.includes(value as ProductionWorkPlanView)
    ? value as ProductionWorkPlanView
    : null;
};

export const teamsForProductionWorkPlan = (value: unknown): readonly ProductionTeam[] => {
  const view = normalizeProductionWorkPlanView(value);
  return view ? PRODUCTION_WORK_PLAN_TEAM_IDS[view] : [];
};
