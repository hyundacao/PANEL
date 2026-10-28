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

export type ZonePlanSummaryRow = Material & {
  key: string;
  demand: number | null;
  stock: number | null;
  sharedStock: number | null;
  incompatibleSharedStock: boolean;
  balance: number | null;
  balancePartial: boolean;
  marginPercent: number | null;
  stockStatus: 'ready' | 'missing' | 'incompatible' | 'stale' | 'ambiguous';
  stockMatchedByName: boolean;
  sources: ZoneStockSummary['others'];
};

const normalizedIdentity = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pl-PL');
const sameMaterialIdentity = (left: Material, right: Material) => {
  const leftCode = normalizedIdentity(left.code);
  const rightCode = normalizedIdentity(right.code);
  if (leftCode || rightCode) return Boolean(leftCode && rightCode && leftCode === rightCode);
  return Boolean(normalizedIdentity(left.name) && normalizedIdentity(left.name) === normalizedIdentity(right.name));
};

export function buildZonePlanSummary({ areaId, inventory, sources, sharedAreaIds = new Set<string>(), stockReady, incompletePlan = false }: {
  areaId: string;
  inventory: Array<Material & { areaId: string; qty: number; identitySource?: 'name' }>;
  sources: ZoneDemandSource[];
  sharedAreaIds?: ReadonlySet<string>;
  stockReady: boolean;
  incompletePlan?: boolean;
}): ZonePlanSummaryRow[] {
  if (!areaId || sharedAreaIds.has(areaId)) return [];
  const zoneSources = sources.filter((source) => source.included && source.areaId === areaId);
  const sourceMaterials = zoneSources.flatMap((source) => source.contributions.map((row) => row.material));
  // A code inferred by the API from a name is not an index recorded during counting.
  const zoneInventory = inventory.filter((row) => row.areaId === areaId || sharedAreaIds.has(row.areaId))
    .map((row) => {
      if (row.identitySource !== 'name') return row;
      const code = normalizedIdentity(row.code);
      const namedMaterials = sourceMaterials.filter((material) => normalizedIdentity(material.name) === normalizedIdentity(row.name));
      const uniqueHint = code && sourceMaterials.some((material) => normalizedIdentity(material.code) === code)
        && namedMaterials.every((material) => !material.code.trim() || normalizedIdentity(material.code) === code);
      return uniqueHint ? row : { ...row, code: '' };
    });
  const codesByName = new Map<string, Map<string, string>>();
  [...zoneInventory, ...sourceMaterials].forEach((material) => {
    const name = normalizedIdentity(material.name);
    const code = normalizedIdentity(material.code);
    if (!name || !code) return;
    const codes = codesByName.get(name) ?? new Map<string, string>();
    codes.set(code, material.code.trim());
    codesByName.set(name, codes);
  });
  // A name-only record can join a known index only when the match is unambiguous.
  const resolveMaterial = <T extends Material>(material: T): T => {
    if (material.code.trim()) return material;
    const codes = codesByName.get(normalizedIdentity(material.name));
    return codes?.size === 1 ? { ...material, code: [...codes.values()][0] } : material;
  };
  const resolvedSources = zoneSources.map((source) => ({ ...source, contributions: source.contributions.map((row) => ({
    ...row, material: resolveMaterial(row.material)
  })) }));
  const resolvedInventory = stockReady ? zoneInventory.map((row) => ({
    ...resolveMaterial(row), matchedByName: row.identitySource === 'name' || !row.code.trim()
  })) : [];
  const materials = new Map<string, Material>();
  resolvedSources.forEach((source) => {
    source.contributions.forEach(({ material, demand }) => {
      if (demand === 0 || (!material.code.trim() && !material.name.trim())) return;
      const descriptor = unitDescriptor(material.unit);
      const unit = descriptor.family === 'mass' ? 'kg' : descriptor.family === 'pieces' ? 'szt.'
        : descriptor.family === 'packages' ? 'opak.' : material.unit;
      const key = JSON.stringify([normalizedIdentity(material.code.trim() || material.name), descriptor.family]);
      if (!materials.has(key)) materials.set(key, { ...material, unit });
    });
  });
  return [...materials.entries()].map(([key, material]): ZonePlanSummaryRow => {
    const summary = buildZoneStockSummary({
      material, areaId, currentItemId: '', inventory: resolvedInventory, sources: resolvedSources,
      sharedAreaIds, matchesMaterial: sameMaterialIdentity
    });
    const demand = summary.otherDemand;
    const ambiguousStock = resolvedInventory.some((row) => row.areaId === areaId && !row.code.trim()
      && normalizedIdentity(row.name) === normalizedIdentity(material.name)
      && (codesByName.get(normalizedIdentity(row.name))?.size ?? 0) > 1);
    const stock = ambiguousStock ? null : summary.stock;
    const stockMatchedByName = resolvedInventory.some((row) => row.areaId === areaId && row.matchedByName && sameMaterialIdentity(material, row));
    // This is physical stock only: pending/issued documents are not measurements.
    // Shared silos remain separate so their stock is never promised to every hall.
    const balance = stock !== null && demand !== null
      ? Math.round((stock - demand) * 1e9) / 1e9 : null;
    return {
      ...material, key, demand, stock, stockMatchedByName, sharedStock: summary.sharedStock,
      incompatibleSharedStock: summary.incompatibleSharedStock,
      balance, balancePartial: incompletePlan && balance !== null,
      marginPercent: balance !== null && demand !== null && demand > 0 ? balance / demand * 100 : null,
      stockStatus: !stockReady ? 'stale' : ambiguousStock ? 'ambiguous' : summary.incompatibleStock ? 'incompatible'
        : summary.stock === null ? 'missing' : 'ready',
      sources: summary.others
    };
  }).filter((row) => row.demand !== 0).sort((left, right) => {
    if (left.balance === null && right.balance !== null) return -1;
    if (left.balance !== null && right.balance === null) return 1;
    return (left.marginPercent ?? 0) - (right.marginPercent ?? 0)
      || left.name.localeCompare(right.name, 'pl') || left.code.localeCompare(right.code, 'pl');
  });
}
