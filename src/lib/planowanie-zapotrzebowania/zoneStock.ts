type Material = { code: string; name: string; unit: string };

export type ZoneDemandSource = {
  id: string;
  index: string;
  name: string;
  station: string;
  areaId: string;
  areaName?: string;
  included: boolean;
  contributions: Array<{ material: Material; demand: number | null }>;
};

export type ZoneStockSummary = {
  stock: number | null;
  incompatibleStock: boolean;
  sharedStock: number | null;
  incompatibleSharedStock: boolean;
  otherDemand: number | null;
  others: Array<{ id: string; index: string; name: string; station: string; areaId: string; areaName: string; demand: number | null }>;
  allOtherDemand: number | null;
  allOthers: ZoneStockSummary['others'];
};

const unitDescriptor = (unit: string) => {
  const key = unit.trim().toLowerCase().replace(/[.\s]/g, '');
  if (['kg', 'kilogram', 'kilogramy', 'kilograma'].includes(key)) return { family: 'mass', factor: 1000 };
  if (['g', 'gram', 'gramy', 'grama'].includes(key)) return { family: 'mass', factor: 1 };
  if (['1000szt', '1000sztuk', 'tysszt', 'tyssztuk'].includes(key)) return { family: 'pieces', factor: 1000 };
  if (['szt', 'sztuk', 'sztuka', 'sztuki'].includes(key)) return { family: 'pieces', factor: 1 };
  if (['opak', 'opakowanie', 'opakowania', 'opakowan'].includes(key)) return { family: 'packages', factor: 1 };
  return { family: key, factor: 1 };
};

const convert = (value: number | null, fromUnit: string, toUnit: string) => {
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  const from = unitDescriptor(fromUnit);
  const to = unitDescriptor(toUnit);
  return from.family && from.family === to.family ? value * from.factor / to.factor : null;
};

export function buildZoneStockSummary({ material, areaId, currentItemId, inventory, sources, matchesMaterial, sharedAreaIds = new Set<string>() }: {
  material: Material;
  areaId: string;
  currentItemId: string;
  inventory: Array<Material & { areaId: string; qty: number }>;
  sources: ZoneDemandSource[];
  matchesMaterial: (left: Material, right: Material) => boolean;
  sharedAreaIds?: ReadonlySet<string>;
}): ZoneStockSummary {
  if (!areaId) return { stock: null, incompatibleStock: false, sharedStock: null, incompatibleSharedStock: false, otherDemand: 0, others: [], allOtherDemand: 0, allOthers: [] };
  const stockFor = (matchesArea: (id: string) => boolean) => {
    const quantities = inventory.filter((row) => matchesArea(row.areaId) && matchesMaterial(material, row))
      .map((row) => convert(row.qty, row.unit, material.unit));
    const incompatible = quantities.some((qty) => qty === null);
    return {
      qty: !quantities.length || incompatible ? null : quantities.reduce<number>((sum, qty) => sum + (qty ?? 0), 0),
      incompatible
    };
  };
  const local = stockFor((id) => id === areaId && !sharedAreaIds.has(id));
  const shared = stockFor((id) => sharedAreaIds.has(id));
  const allOthers: ZoneStockSummary['others'] = [];
  sources.forEach((source) => {
    if (!source.included || !source.areaId || sharedAreaIds.has(source.areaId) || source.id === currentItemId) return;
    const contributions = source.contributions.filter((row) => matchesMaterial(material, row.material));
    if (!contributions.length) return;
    const quantities = contributions.map((row) => convert(row.demand, row.material.unit, material.unit));
    const demand = quantities.some((qty) => qty === null)
      ? null
      : quantities.reduce<number>((sum, qty) => sum + (qty ?? 0), 0);
    if (demand === 0) return;
    allOthers.push({ id: source.id, index: source.index, name: source.name, station: source.station, areaId: source.areaId, areaName: source.areaName || source.areaId, demand });
  });
  const others = allOthers.filter((source) => source.areaId === areaId);
  const otherDemand = others.some((row) => row.demand === null)
    ? null
    : others.reduce((sum, row) => sum + (row.demand ?? 0), 0);
  const allOtherDemand = allOthers.some((row) => row.demand === null)
    ? null
    : allOthers.reduce((sum, row) => sum + (row.demand ?? 0), 0);
  return {
    stock: local.qty, incompatibleStock: local.incompatible,
    sharedStock: shared.qty, incompatibleSharedStock: shared.incompatible,
    otherDemand, others, allOtherDemand, allOthers
  };
}
