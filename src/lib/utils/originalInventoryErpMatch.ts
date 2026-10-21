import { isPieceGrindingUnit } from '@/lib/utils/originalInventoryGrinding';
import { normalizeOriginalInventoryNameKey } from '@/lib/utils/originalInventoryName';

type MaterialIdentity = { name: string; unit: string; indexCode?: string | null; previousNames?: readonly string[] };
type StockEntry = MaterialIdentity & { realQty: number; availableQty: number };

const indexKey = (value: string | null | undefined) =>
  String(value ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
const unitKey = (value: string) => isPieceGrindingUnit(value)
  ? 'szt'
  : value.trim().toLowerCase().replace(/\.$/, '');

export const findOriginalInventoryCatalogMaterial = <T extends MaterialIdentity>(
  catalog: readonly T[],
  material: Pick<MaterialIdentity, 'name' | 'unit'>
): T | null => {
  const name = normalizeOriginalInventoryNameKey(material.name);
  const unit = unitKey(material.unit);
  if (!name || !unit) return null;
  // Inspect all exact matches before choosing an index, not a truncated suggestion list.
  const matches = catalog.filter((item) => [item.name, ...item.previousNames ?? []].some((value) => normalizeOriginalInventoryNameKey(value) === name) &&
    unitKey(item.unit) === unit && indexKey(item.indexCode));
  if (!matches.length || new Set(matches.map((item) => indexKey(item.indexCode))).size !== 1) return null;
  return matches[0];
};

export const buildOriginalInventoryNameResolver = (catalog: readonly MaterialIdentity[]) => {
  const names = new Map<string, MaterialIdentity[]>();
  const indices = new Map<string, MaterialIdentity[]>();
  for (const item of catalog) {
    const index = indexKey(item.indexCode);
    if (!index) continue;
    const indexed = indices.get(index) ?? [];
    indexed.push(item);
    indices.set(index, indexed);
    for (const name of new Set([item.name, ...item.previousNames ?? []].map(normalizeOriginalInventoryNameKey))) {
      const key = `${name}|${unitKey(item.unit)}`;
      const matches = names.get(key) ?? [];
      matches.push(item);
      names.set(key, matches);
    }
  }
  return (material: MaterialIdentity) => {
    const index = indexKey(material.indexCode);
    const matches = (index ? indices.get(index) : names.get(`${normalizeOriginalInventoryNameKey(material.name)}|${unitKey(material.unit)}`)) ?? [];
    if (!matches.length || matches.some((item) => unitKey(item.unit) !== unitKey(material.unit)) ||
      new Set(matches.map((item) => `${indexKey(item.indexCode)}|${normalizeOriginalInventoryNameKey(item.name)}`)).size !== 1) return material.name;
    return matches[0].name;
  };
};

export const matchOriginalInventoryErpStock = (
  entries: readonly StockEntry[],
  material: MaterialIdentity,
  normalizeName: (name: string) => string
) => {
  const name = normalizeName(material.name);
  if (!name) return null;
  const index = indexKey(material.indexCode);
  let matches = index ? entries.filter((entry) => indexKey(entry.indexCode) === index) : [];
  if (!matches.length) {
    // Name matching is only a fallback for legacy rows without an ERP index.
    matches = entries.filter((entry) => normalizeName(entry.name) === name &&
      (!index || !indexKey(entry.indexCode)));
  }
  if (!matches.length || new Set(matches.map((entry) => indexKey(entry.indexCode))).size > 1) return null;
  const unit = unitKey(material.unit);
  if (matches.some((entry) => unitKey(entry.unit) !== unit ||
    !Number.isFinite(entry.realQty) || !Number.isFinite(entry.availableQty))) return null;

  return {
    name: matches[0].name,
    unit: matches[0].unit,
    realQty: matches.reduce((total, entry) => total + entry.realQty, 0),
    availableQty: matches.reduce((total, entry) => total + entry.availableQty, 0)
  };
};
