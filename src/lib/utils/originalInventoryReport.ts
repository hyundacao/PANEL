import type { OriginalInventoryErpSnapshotEntry } from '../api/types';

type ReportSourceEntry = { key: string; name: string; unit: string; qty: number };
type InventoryHistoryPoint = { dateKey: string; qty: number };
type ErpQuantities = { realQty: number; availableQty: number };
type ErpHistory = Map<string, Map<string, ErpQuantities>>;

const reportCollator = new Intl.Collator('pl', { sensitivity: 'base', numeric: true });

export const buildOriginalInventoryReportErpHistory = (
  entries: OriginalInventoryErpSnapshotEntry[],
  normalizeName: (name: string) => string
): ErpHistory => {
  const datesMap: ErpHistory = new Map();
  entries.forEach((entry) => {
    let materialMap = datesMap.get(entry.snapshotDate);
    if (!materialMap) {
      materialMap = new Map();
      datesMap.set(entry.snapshotDate, materialMap);
    }
    const key = normalizeName(entry.name);
    const current = materialMap.get(key);
    if (current) {
      current.realQty += entry.realQty;
      current.availableQty += entry.availableQty;
    } else {
      materialMap.set(key, { realQty: entry.realQty, availableQty: entry.availableQty });
    }
  });
  return datesMap;
};

export const buildOriginalInventoryReportRows = ({
  sourceEntries,
  inventoryHistoryByMaterial,
  historyDates,
  erpHistory,
  currentErp
}: {
  sourceEntries: ReportSourceEntry[];
  inventoryHistoryByMaterial: Map<string, InventoryHistoryPoint[]>;
  historyDates: string[];
  erpHistory: ErpHistory;
  currentErp: Map<string, ErpQuantities>;
}) => sourceEntries.map((entry) => {
  const historyByDate = new Map(
    (inventoryHistoryByMaterial.get(entry.key) ?? []).map((point) => [point.dateKey, point])
  );
  const previousComparisons = historyDates.map((dateKey) => {
    const point = historyByDate.get(dateKey);
    if (!point) return null;
    const erpPoint = erpHistory.get(point.dateKey)?.get(entry.key);
    return {
      dateKey: point.dateKey,
      realDiffQty: erpPoint ? point.qty - erpPoint.realQty : null,
      availableDiffQty: erpPoint ? point.qty - erpPoint.availableQty : null
    };
  });
  const currentSnapshot = currentErp.get(entry.key);
  return {
    key: entry.key,
    name: entry.name,
    unit: entry.unit,
    currentRealErpQty: currentSnapshot?.realQty ?? null,
    currentAvailableErpQty: currentSnapshot?.availableQty ?? null,
    currentSpisQty: entry.qty,
    currentRealDiffQty: currentSnapshot ? entry.qty - currentSnapshot.realQty : null,
    currentAvailableDiffQty: currentSnapshot ? entry.qty - currentSnapshot.availableQty : null,
    previousRealDiffs: previousComparisons.map((point) =>
      point ? { dateKey: point.dateKey, diffQty: point.realDiffQty } : null
    ),
    previousAvailableDiffs: previousComparisons.map((point) =>
      point ? { dateKey: point.dateKey, diffQty: point.availableDiffQty } : null
    )
  };
}).sort((a, b) => {
  const nameCompare = reportCollator.compare(a.name.trim(), b.name.trim());
  return nameCompare || reportCollator.compare(a.unit.trim(), b.unit.trim());
});
