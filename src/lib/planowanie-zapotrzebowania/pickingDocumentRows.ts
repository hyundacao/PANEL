export const canonicalPlanningUnit = (value: unknown) => {
  const unit = String(value ?? '').trim().toLocaleLowerCase('pl-PL');
  const key = unit.replace(/[.\s]/g, '');
  if (['szt', 'sztuka', 'sztuki', 'sztuk'].includes(key)) return 'szt.';
  if (['1000szt', '1000sztuk', 'tysszt', 'tyssztuk'].includes(key)) return '1000szt.';
  if (['kg', 'kilogram', 'kilogramy', 'kilograma'].includes(key)) return 'kg';
  if (['g', 'gram', 'gramy', 'grama'].includes(key)) return 'g';
  if (['opak', 'opakowanie', 'opakowania', 'opakowan'].includes(key)) return 'opak.';
  return unit;
};

// Keep the saved material identity; only normalize its unit spelling.
export const canonicalPlanningMaterialKey = (key: string) => {
  const separator = key.lastIndexOf('|');
  return separator < 0 ? key : `${key.slice(0, separator)}|${canonicalPlanningUnit(key.slice(separator + 1))}`;
};

type Source = { planItemId: string; index: string; name: string; demand: number; toIssue?: number };
type Row = {
  key: string;
  unit: string;
  demand: number;
  areaStock: number;
  issuedBefore: number;
  pendingBefore: number;
  toIssue: number;
  confirmed: boolean;
  sources: Source[];
};

export function mergePickingSources(sources: Source[] = []): Source[] {
  const merged = new Map<string, Source>();
  sources.forEach((source) => {
    const key = JSON.stringify([source.planItemId, source.index]);
    const current = merged.get(key);
    if (current) {
      current.demand += source.demand;
      if (current.toIssue !== undefined && source.toIssue !== undefined) current.toIssue += source.toIssue;
      else delete current.toIssue;
    }
    else merged.set(key, { ...source });
  });
  return [...merged.values()];
}

export function groupPickingDocumentRows<T extends Row>(
  rows: T[], materialKey: (row: T) => string, warehouseCode: (row: T) => string
): Array<T & { memberKeys: string[] }> {
  const groups = new Map<string, T & { memberKeys: string[] }>();
  rows.forEach((row) => {
    const key = JSON.stringify([materialKey(row), warehouseCode(row)]);
    const current = groups.get(key);
    if (!current) {
      groups.set(key, { ...row, unit: canonicalPlanningUnit(row.unit), sources: mergePickingSources(row.sources), memberKeys: [row.key] });
      return;
    }
    current.memberKeys.push(row.key);
    current.demand += row.demand;
    current.areaStock += row.areaStock;
    current.issuedBefore += row.issuedBefore;
    current.pendingBefore += row.pendingBefore;
    current.toIssue += row.toIssue;
    current.confirmed = current.confirmed && row.confirmed;
    current.sources = mergePickingSources([...current.sources, ...(row.sources ?? [])]);
  });
  return [...groups.values()];
}
