export type PlanningScope =
  | { mode: 'shifts'; shifts: number }
  | { mode: 'quantity'; quantity: number }
  | { mode: 'all' };

export type ComparablePlanItem = {
  id: string;
  index: string;
  name: string;
  station: string;
  totalQty: number;
  remainingQty: number;
  shiftNorm: number;
  planGroup?: 'standard' | 'emergency' | 'planned';
  plannedDate?: string;
};

export type PlanDifferenceKind =
  | 'new'
  | 'removed'
  | 'quantity_increased'
  | 'quantity_decreased'
  | 'station_changed'
  | 'norm_changed';

export type PlanDifference = {
  id: string;
  kind: PlanDifferenceKind;
  itemId: string;
  index: string;
  name: string;
  previousValue: string | number | null;
  currentValue: string | number | null;
  difference: number;
};

const normalized = (value: unknown) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[łŁ]/g, 'l')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

const identityKey = (item: ComparablePlanItem) => [
  item.planGroup ?? 'standard',
  normalized(item.plannedDate),
  normalized(item.index || item.name)
].join('|');

export const calculateScopedQuantity = (
  remainingQty: number,
  shiftNorm: number,
  scope: PlanningScope
) => {
  const remaining = Math.max(0, Number.isFinite(remainingQty) ? remainingQty : 0);
  if (scope.mode === 'all') return remaining;
  if (scope.mode === 'quantity') return Math.min(remaining, Math.max(0, scope.quantity));
  return Math.min(remaining, Math.max(0, shiftNorm) * Math.max(0, scope.shifts));
};

export const nextPlanVersionNumber = (
  versions: Array<{ planDate: string; versionNo: number }>,
  planDate: string
) => Math.max(0, ...versions.filter((version) => version.planDate === planDate).map((version) => version.versionNo)) + 1;

export const latestPlanVersion = <T extends { planDate: string; versionNo: number }>(
  versions: readonly T[],
  planDate: string
): T | undefined => {
  let latest: T | undefined;
  for (const version of versions) {
    if (version.planDate === planDate && (!latest || version.versionNo > latest.versionNo)) latest = version;
  }
  return latest;
};

export const diffPlanItems = (
  previous: ComparablePlanItem[],
  current: ComparablePlanItem[]
): PlanDifference[] => {
  const previousQueues = new Map<string, ComparablePlanItem[]>();
  previous.forEach((item) => {
    const key = identityKey(item);
    previousQueues.set(key, [...(previousQueues.get(key) ?? []), item]);
  });

  const differences: PlanDifference[] = [];
  current.forEach((item, position) => {
    const key = identityKey(item);
    const queue = previousQueues.get(key) ?? [];
    const old = queue.shift();
    previousQueues.set(key, queue);
    if (!old) {
      differences.push({
        id: `new-${item.id}-${position}`,
        kind: 'new',
        itemId: item.id,
        index: item.index,
        name: item.name,
        previousValue: null,
        currentValue: item.totalQty,
        difference: item.totalQty
      });
      return;
    }

    if (old.totalQty !== item.totalQty) {
      differences.push({
        id: `quantity-${item.id}-${position}`,
        kind: item.totalQty > old.totalQty ? 'quantity_increased' : 'quantity_decreased',
        itemId: item.id,
        index: item.index,
        name: item.name,
        previousValue: old.totalQty,
        currentValue: item.totalQty,
        difference: item.totalQty - old.totalQty
      });
    }
    if (normalized(old.station) !== normalized(item.station)) {
      differences.push({
        id: `station-${item.id}-${position}`,
        kind: 'station_changed',
        itemId: item.id,
        index: item.index,
        name: item.name,
        previousValue: old.station,
        currentValue: item.station,
        difference: 0
      });
    }
    if (old.shiftNorm !== item.shiftNorm) {
      differences.push({
        id: `norm-${item.id}-${position}`,
        kind: 'norm_changed',
        itemId: item.id,
        index: item.index,
        name: item.name,
        previousValue: old.shiftNorm,
        currentValue: item.shiftNorm,
        difference: item.shiftNorm - old.shiftNorm
      });
    }
  });

  previousQueues.forEach((queue) => queue.forEach((item, position) => differences.push({
    id: `removed-${item.id}-${position}`,
    kind: 'removed',
    itemId: item.id,
    index: item.index,
    name: item.name,
    previousValue: item.totalQty,
    currentValue: null,
    difference: -item.totalQty
  })));

  return differences;
};

export const calculateIssueBalance = ({
  demand,
  areaStock,
  sharedCoverage,
  issued,
  pending
}: {
  demand: number;
  areaStock: number;
  sharedCoverage: number;
  issued: number;
  pending: number;
}) => {
  const openDemand = Math.max(0, demand - Math.max(0, issued) - Math.max(0, pending));
  const available = Math.max(0, areaStock) + Math.max(0, sharedCoverage);
  const toIssue = Math.max(0, openDemand - available);
  return {
    openDemand,
    toIssue,
    shortage: toIssue,
    surplus: Math.max(0, available - openDemand)
  };
};

export const allocateAmountByDemand = <T extends { demand: number }>(
  totalAmount: number,
  sources: T[]
) => {
  const amount = Math.max(0, Number.isFinite(totalAmount) ? totalAmount : 0);
  if (!sources.length) return [] as Array<T & { allocated: number }>;
  const totalDemand = sources.reduce((sum, source) => sum + Math.max(0, source.demand), 0);
  return sources.map((source) => ({
    ...source,
    allocated: amount * (totalDemand > 0
      ? Math.max(0, source.demand) / totalDemand
      : 1 / sources.length)
  }));
};

export const correctedQuantity = (
  current: number,
  mode: 'exact' | 'increase' | 'decrease',
  value: number
) => {
  const amount = Math.max(0, Number.isFinite(value) ? value : 0);
  if (mode === 'exact') return amount;
  if (mode === 'increase') return Math.max(0, current + amount);
  return Math.max(0, current - amount);
};

export const setRemainingQuantity = <T extends { totalQty: number; remainingQty: number }>(
  item: T,
  quantity: number
): T => {
  const remainingQty = correctedQuantity(item.remainingQty, 'exact', quantity);
  const produced = Math.max(0, item.totalQty - (item.remainingQty ?? item.totalQty));
  return { ...item, totalQty: produced + remainingQty, remainingQty };
};

export const coalesceQuantityCorrection = <T extends {
  id: string; previousValue: number; newValue: number; difference: number;
}>(corrections: T[], correction: T): T[] => {
  const previousValue = corrections.find((entry) => entry.id === correction.id)?.previousValue ?? correction.previousValue;
  const others = corrections.filter((entry) => entry.id !== correction.id);
  return [{ ...correction, previousValue, difference: correction.newValue - previousValue }, ...others];
};
