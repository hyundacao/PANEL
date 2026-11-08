export const MATERIAL_PLANNING_HISTORY_DAYS = 1;

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
) => {
  const entries = Object.entries(record);
  const retained = entries.filter(([key]) => {
    const dateKey = key.slice(0, 10);
    return !isDateKey(dateKey) || keepDate(dateKey);
  });
  return retained.length === entries.length ? record : Object.fromEntries(retained);
};

export const materialPlanningHistoryEntryDateKey = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})(?:$|T)/);
  if (iso) {
    if (/T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(text)) {
      const date = new Date(text);
      if (Number.isFinite(date.getTime())) return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(date);
    }
    return iso[1];
  }
  const polish = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\D|$)/);
  return polish ? `${polish[3]}-${polish[2].padStart(2, '0')}-${polish[1].padStart(2, '0')}` : '';
};

// The API also saves partial shared records. Prune only known history fields;
// never rebuild the active plan or touch inventory, recipes or permanent settings.
export const pruneMaterialPlanningRecord = <TState extends object>(
  state: TState,
  todayKey: string,
  historyDays = MATERIAL_PLANNING_HISTORY_DAYS
): TState => {
  if (!isDateKey(todayKey)) return state;
  const keepDate = (key: string) => isMaterialPlanningDateRetained(key, todayKey, historyDays);
  const record = state as Record<string, unknown>;
  let result = record;
  const replace = (key: string, value: unknown) => {
    if (record[key] === value) return;
    if (result === record) result = { ...record };
    result[key] = value;
  };
  const filterArray = (key: string, keep: (item: unknown) => boolean) => {
    const items = record[key];
    if (!Array.isArray(items)) return;
    const retained = items.filter(keep);
    if (retained.length !== items.length) replace(key, retained);
  };
  for (const key of ['planVersions', 'quantityCorrections', 'documents']) filterArray(key, item => {
    const date = item && typeof item === 'object' && 'planDate' in item ? item.planDate : undefined;
    return typeof date !== 'string' || keepDate(date);
  });
  filterArray('archive', item => {
    const date = materialPlanningHistoryEntryDateKey(item && typeof item === 'object' && 'at' in item ? item.at : undefined);
    return !date || keepDate(date);
  });
  if (record.dailyPlans && typeof record.dailyPlans === 'object' && !Array.isArray(record.dailyPlans)) {
    const entries = Object.entries(record.dailyPlans);
    const retained = entries.filter(([date]) => keepDate(date));
    if (retained.length !== entries.length) replace('dailyPlans', Object.fromEntries(retained));
  }
  for (const key of ['returnStatuses', 'pickingDone']) {
    const value = record[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      replace(key, filterDatePrefixedRecord(value as Record<string, unknown>, keepDate));
    }
  }
  return result as TState;
};

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
  const retained = pruneMaterialPlanningRecord(state, todayKey, historyDays);
  const { dailyPlans, planVersions } = retained;
  const selectedPlanDate = keepDate(state.selectedPlanDate) ? state.selectedPlanDate : todayKey;
  const selectedDateChanged = selectedPlanDate !== state.selectedPlanDate;
  const latestVersion = planVersions
    .filter((version) => version.planDate === selectedPlanDate)
    .sort((left, right) => right.versionNo - left.versionNo)[0];
  const lastImportedVersion = state.planVersions
    .filter((version) => version.planDate < selectedPlanDate)
    .sort((left, right) => right.planDate.localeCompare(left.planDate) || right.versionNo - left.versionNo)[0];
  const savedSelectedPlan = dailyPlans[selectedPlanDate] ?? latestVersion?.items;
  const carryLastPlan = selectedDateChanged && !latestVersion && !savedSelectedPlan?.length;
  const lastPlan = lastImportedVersion
    ? state.dailyPlans[lastImportedVersion.planDate] ?? lastImportedVersion.items
    : state.plan;

  const changed = selectedDateChanged || retained !== state;
  if (!changed) return state;

  return {
    ...retained,
    selectedPlanDate,
    activePlanVersionId: selectedDateChanged ? latestVersion?.id ?? '' : state.activePlanVersionId,
    planName: selectedDateChanged ? latestVersion?.fileName ?? (carryLastPlan ? lastImportedVersion?.fileName ?? state.planName : '') : state.planName,
    planSheet: selectedDateChanged ? latestVersion?.sheetName ?? (carryLastPlan ? lastImportedVersion?.sheetName ?? state.planSheet : '') : state.planSheet,
    planImportedAt: selectedDateChanged ? latestVersion?.importedAt ?? (carryLastPlan ? lastImportedVersion?.importedAt ?? state.planImportedAt : '') : state.planImportedAt,
    plan: selectedDateChanged
      ? carryLastPlan ? lastPlan : savedSelectedPlan ?? []
      : state.plan,
    dailyPlans: carryLastPlan ? { ...dailyPlans, [selectedPlanDate]: lastPlan } : dailyPlans,
    planVersions
  } as TState;
};
