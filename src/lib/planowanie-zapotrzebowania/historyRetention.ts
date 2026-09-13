export const MATERIAL_PLANNING_HISTORY_DAYS = 7;

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type DateScopedRecord = {
  planDate: string;
};

type PlanVersionRecord<TPlanItem> = DateScopedRecord & {
  id: string;
  versionNo: number;
  importedAt: string;
  fileName: string;
  sheetName: string;
  items: TPlanItem[];
};

type MaterialPlanningHistoryState<TPlanItem> = {
  selectedPlanDate: string;
  activePlanVersionId: string;
  planName: string;
  planSheet: string;
  planImportedAt: string;
  plan: TPlanItem[];
  dailyPlans: Record<string, TPlanItem[]>;
  planVersions: PlanVersionRecord<TPlanItem>[];
  quantityCorrections: DateScopedRecord[];
  documents: DateScopedRecord[];
  returnStatuses: Record<string, unknown>;
  pickingDone: Record<string, boolean>;
};

const isDateKey = (value: string) => DATE_KEY_PATTERN.test(value);

export const materialPlanningHistoryCutoffDateKey = (
  todayKey: string,
  historyDays = MATERIAL_PLANNING_HISTORY_DAYS
) => {
  if (!isDateKey(todayKey)) return todayKey;
  const [year, month, day] = todayKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - Math.max(0, Math.trunc(historyDays)));
  return date.toISOString().slice(0, 10);
};

export const isMaterialPlanningDateRetained = (
  dateKey: string,
  todayKey: string,
  historyDays = MATERIAL_PLANNING_HISTORY_DAYS
) => isDateKey(dateKey)
  && dateKey >= materialPlanningHistoryCutoffDateKey(todayKey, historyDays);

const filterDatePrefixedRecord = <T>(
  record: Record<string, T>,
  keepDate: (dateKey: string) => boolean
) => Object.fromEntries(Object.entries(record).filter(([key]) => {
  const dateKey = key.slice(0, 10);
  return !isDateKey(dateKey) || keepDate(dateKey);
}));

export const pruneMaterialPlanningHistory = <
  TPlanItem,
  TState extends MaterialPlanningHistoryState<TPlanItem>
>(
  state: TState,
  todayKey: string,
  historyDays = MATERIAL_PLANNING_HISTORY_DAYS
): TState => {
  if (!isDateKey(todayKey)) return state;
  const keepDate = (dateKey: string) => isMaterialPlanningDateRetained(dateKey, todayKey, historyDays);
  const dailyPlans = Object.fromEntries(
    Object.entries(state.dailyPlans).filter(([dateKey]) => keepDate(dateKey))
  ) as Record<string, TPlanItem[]>;
  const planVersions = state.planVersions.filter((version) => keepDate(version.planDate));
  const quantityCorrections = state.quantityCorrections.filter((correction) => keepDate(correction.planDate));
  const documents = state.documents.filter((document) => keepDate(document.planDate));
  const returnStatuses = filterDatePrefixedRecord(state.returnStatuses, keepDate);
  const pickingDone = filterDatePrefixedRecord(state.pickingDone, keepDate);
  const selectedPlanDate = keepDate(state.selectedPlanDate) ? state.selectedPlanDate : todayKey;
  const selectedDateChanged = selectedPlanDate !== state.selectedPlanDate;
  const latestVersion = planVersions
    .filter((version) => version.planDate === selectedPlanDate)
    .sort((left, right) => right.versionNo - left.versionNo)[0];

  const changed = selectedDateChanged
    || Object.keys(dailyPlans).length !== Object.keys(state.dailyPlans).length
    || planVersions.length !== state.planVersions.length
    || quantityCorrections.length !== state.quantityCorrections.length
    || documents.length !== state.documents.length
    || Object.keys(returnStatuses).length !== Object.keys(state.returnStatuses).length
    || Object.keys(pickingDone).length !== Object.keys(state.pickingDone).length;
  if (!changed) return state;

  return {
    ...state,
    selectedPlanDate,
    activePlanVersionId: selectedDateChanged ? latestVersion?.id ?? '' : state.activePlanVersionId,
    planName: selectedDateChanged ? latestVersion?.fileName ?? '' : state.planName,
    planSheet: selectedDateChanged ? latestVersion?.sheetName ?? '' : state.planSheet,
    planImportedAt: selectedDateChanged ? latestVersion?.importedAt ?? '' : state.planImportedAt,
    plan: selectedDateChanged
      ? dailyPlans[selectedPlanDate] ?? latestVersion?.items ?? []
      : state.plan,
    dailyPlans,
    planVersions,
    quantityCorrections,
    documents,
    returnStatuses,
    pickingDone
  } as TState;
};
