export type InventoryAlertUnit = 'szt' | 'kg' | 'l' | 'inne';

export type InventoryAlertThresholds = Record<'szt' | 'kg' | 'l', number>;

export type InventoryAlertSourceLine = {
  key: string;
  name: string;
  unit: string;
  qty: number;
};

export type InventoryAlertErpLine = Omit<InventoryAlertSourceLine, 'qty'> & {
  availableQty: number;
};

export type InventoryAlertRow = {
  key: string;
  name: string;
  unit: string;
  unitGroup: InventoryAlertUnit;
  availableErpQty: number;
  countedQty: number | null;
  differenceQty: number | null;
  hasIncompatibleCount: boolean;
};

const normalizedUnit = (value: string) => value.trim().toLowerCase().replace(/[\s.]/g, '');

const alertUnit = (value: string): { key: string; label: string; group: InventoryAlertUnit; factor: number } => {
  const unit = normalizedUnit(value);
  if (['szt', 'sztuka', 'sztuki', 'sztuk', 'pcs', 'pc'].includes(unit)) {
    return { key: 'szt', label: 'szt.', group: 'szt', factor: 1 };
  }
  if (['1000szt', '1000sztuk'].includes(unit)) {
    return { key: 'szt', label: 'szt.', group: 'szt', factor: 1000 };
  }
  if (['kg', 'kilogram', 'kilogramy', 'kilogramow'].includes(unit)) {
    return { key: 'kg', label: 'kg', group: 'kg', factor: 1 };
  }
  if (['g', 'gram', 'gramy', 'gramow'].includes(unit)) {
    return { key: 'kg', label: 'kg', group: 'kg', factor: 0.001 };
  }
  if (['l', 'lt', 'litr', 'litry', 'litrow'].includes(unit)) {
    return { key: 'l', label: 'l', group: 'l', factor: 1 };
  }
  return { key: `inne:${unit || 'brak'}`, label: value.trim() || 'brak jednostki', group: 'inne', factor: 1 };
};

const groupLines = (lines: InventoryAlertSourceLine[]) => {
  const grouped = new Map<string, { name: string; unit: string; unitGroup: InventoryAlertUnit; qty: number }>();
  for (const line of lines) {
    if (!line.key || !Number.isFinite(line.qty)) continue;
    const unit = alertUnit(line.unit);
    const key = `${line.key}|${unit.key}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.qty += line.qty * unit.factor;
    } else {
      grouped.set(key, {
        name: line.name,
        unit: unit.label,
        unitGroup: unit.group,
        qty: line.qty * unit.factor
      });
    }
  }
  return grouped;
};

export const buildOriginalInventoryAlerts = (
  erpLines: InventoryAlertErpLine[],
  countedLines: InventoryAlertSourceLine[]
): InventoryAlertRow[] => {
  const erp = groupLines(erpLines.map((line) => ({
    key: line.key,
    name: line.name,
    unit: line.unit,
    qty: line.availableQty
  })));
  const counted = groupLines(countedLines);
  const countedMaterialKeys = new Set(countedLines.map((line) => line.key));
  const rows: InventoryAlertRow[] = [];

  for (const [key, stock] of erp) {
    const physical = counted.get(key);
    const differenceQty = physical ? physical.qty - stock.qty : null;
    if (physical ? Math.abs(differenceQty ?? 0) < 0.000001 : stock.qty <= 0) continue;
    rows.push({
      key,
      name: stock.name,
      unit: stock.unit,
      unitGroup: stock.unitGroup,
      availableErpQty: stock.qty,
      countedQty: physical?.qty ?? null,
      differenceQty,
      hasIncompatibleCount: !physical && countedMaterialKeys.has(key.slice(0, key.lastIndexOf('|')))
    });
  }

  return rows.sort((a, b) => {
    const first = Math.abs(b.differenceQty ?? b.availableErpQty) - Math.abs(a.differenceQty ?? a.availableErpQty);
    return first || a.name.localeCompare(b.name, 'pl');
  });
};

export const passesOriginalInventoryAlertThreshold = (
  row: InventoryAlertRow,
  thresholds: InventoryAlertThresholds
) => {
  if (row.unitGroup === 'inne') return true;
  const amount = Math.abs(row.differenceQty ?? row.availableErpQty);
  return amount >= Math.max(0, thresholds[row.unitGroup]);
};
