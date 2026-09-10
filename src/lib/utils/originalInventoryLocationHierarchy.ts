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

export type OriginalInventorySiloExportConfig = {
  id: string;
  name: string;
  chamber: string;
  materialName: string;
  percentKg: number;
  hopperKg: number;
  orderNo?: number;
};

export type OriginalInventorySiloExportEntry = {
  configId: string;
  percent: number;
  hopperPresent: boolean;
  calculatedQty: number;
};

export type OriginalInventoryExportRow = OriginalInventoryAreaSummaryRow & {
  siloName?: string;
  siloChamber?: string;
  siloPercent?: number;
  siloPercentKg?: number;
  siloHopperKg?: number;
  siloOrderNo?: number;
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

export const buildOriginalInventoryExportRows = (
  entries: readonly OriginalInventoryAreaSummaryEntry[],
  siloConfigs: readonly OriginalInventorySiloExportConfig[],
  siloEntries: readonly OriginalInventorySiloExportEntry[],
  hierarchy: OriginalInventoryLocationHierarchy
): OriginalInventoryExportRow[] => {
  const siloConfigById = new Map(siloConfigs.map((config) => [config.id, config]));
  const detailedSiloConfigIds = new Set(
    siloEntries
      .map((entry) => entry.configId)
      .filter((configId) => siloConfigById.has(configId))
  );
  const summaryRows = aggregateOriginalInventoryByArea(
    entries.filter((entry) => {
      if (String(entry.sourceType ?? '').trim().toUpperCase() !== 'SILO') return true;
      const configId = sourceEntityId(entry.sourceId, 'silo');
      return !configId || !detailedSiloConfigIds.has(configId);
    }),
    hierarchy
  );
  const siloRows = siloEntries.flatMap<OriginalInventoryExportRow>((entry) => {
    const config = siloConfigById.get(entry.configId);
    if (!config) return [];

    const percent = Number.isFinite(entry.percent) ? entry.percent : 0;
    const percentKg = Number.isFinite(config.percentKg) ? config.percentKg : 0;
    const hopperKg = entry.hopperPresent && Number.isFinite(config.hopperKg)
      ? config.hopperKg
      : 0;
    const calculatedQty = Number.isFinite(entry.calculatedQty)
      ? entry.calculatedQty
      : (percent * percentKg) + hopperKg;

    return [{
      materialName: config.materialName.trim(),
      areaName: 'Silosy',
      qty: calculatedQty,
      unit: 'kg',
      siloName: config.name.trim(),
      siloChamber: config.chamber.trim(),
      siloPercent: percent,
      siloPercentKg: percentKg,
      siloHopperKg: hopperKg,
      siloOrderNo: config.orderNo
    }];
  });

  return [...summaryRows, ...siloRows];
};
