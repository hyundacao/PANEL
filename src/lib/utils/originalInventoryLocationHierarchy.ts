export type OriginalInventoryLocationEntry = {
  warehouseId?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
};

export type OriginalInventoryAreaSummaryEntry = OriginalInventoryLocationEntry & {
  name: string;
  qty: number;
  unit: string;
};

export type OriginalInventoryAreaSummaryRow = {
  materialName: string;
  areaName: string;
  qty: number;
  unit: string;
};

export type OriginalInventoryLocationHierarchy = {
  warehouseNameById: ReadonlyMap<string, string>;
  warehouseNameByPlanningAreaId: ReadonlyMap<string, string>;
  fixedDeviceAreaIdById: ReadonlyMap<string, string>;
};

const sourceEntityId = (sourceId: string | null | undefined, prefix: string) => {
  const normalized = String(sourceId ?? '').trim();
  if (!normalized.startsWith(`${prefix}:`)) return '';
  return normalized.slice(prefix.length + 1).split(':')[0]?.trim() ?? '';
};

const planningAreaFallbackName = (areaId: string) => {
  const hallMatch = /^hala-(\d+)$/i.exec(areaId.trim());
  return hallMatch ? `Hala ${hallMatch[1]}` : 'Nieprzypisana';
};

export const getOriginalInventoryParentLocationName = (
  entry: OriginalInventoryLocationEntry,
  hierarchy: OriginalInventoryLocationHierarchy
) => {
  const sourceType = String(entry.sourceType ?? '').trim().toUpperCase();

  if (sourceType === 'FIXED_DEVICE') {
    const deviceId = sourceEntityId(entry.sourceId, 'fixed-device');
    const areaId = hierarchy.fixedDeviceAreaIdById.get(deviceId)?.trim() ?? '';
    if (areaId) {
      return hierarchy.warehouseNameByPlanningAreaId.get(areaId)?.trim()
        || planningAreaFallbackName(areaId);
    }
  }

  if (sourceType === 'SILO') {
    return 'Silosy';
  }

  const warehouseId = String(entry.warehouseId ?? '').trim();
  return hierarchy.warehouseNameById.get(warehouseId)?.trim()
    || 'Nieprzypisana';
};

const compactAreaName = (value: string) => {
  const hallMatch = /^hala\s*(\d+)$/i.exec(value.trim());
  return hallMatch ? `H${hallMatch[1]}` : value.trim();
};

const summaryKeyPart = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[łŁ]/g, 'l')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

export const aggregateOriginalInventoryByArea = (
  entries: readonly OriginalInventoryAreaSummaryEntry[],
  hierarchy: OriginalInventoryLocationHierarchy
) => {
  const rows = new Map<string, OriginalInventoryAreaSummaryRow>();

  entries.forEach((entry) => {
    const materialName = entry.name.trim();
    const areaName = compactAreaName(getOriginalInventoryParentLocationName(entry, hierarchy));
    const unit = entry.unit.trim() || 'kg';
    const key = [summaryKeyPart(materialName), summaryKeyPart(areaName), unit.toLowerCase()].join('|');
    const current = rows.get(key);
    if (current) {
      current.qty += entry.qty;
      return;
    }
    rows.set(key, { materialName, areaName, qty: entry.qty, unit });
  });

  return [...rows.values()];
};
