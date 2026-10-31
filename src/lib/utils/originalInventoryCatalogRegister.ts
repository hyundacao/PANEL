import { normalizeOriginalInventoryNameKey } from './originalInventoryName';
import { normalizeOriginalInventoryIndex } from './originalInventoryIndex';

export type CatalogRegisterItem = {
  name: string;
  unit: string;
  indexCode: string;
  indexCode2: string | null;
  warehouseCode: string | null;
  previousNames?: string[];
};

export type CatalogRegisterState = {
  version: 1;
  items: CatalogRegisterItem[];
  blocked: CatalogRegisterItem[];
  importedAt: string;
  sourceFileName: string;
  blockedCatalogIds?: string[];
  ambiguousCatalogIds?: string[];
};

type CatalogItem = {
  id?: string;
  name: string;
  unit?: string | null;
  indexCode?: string | null;
  indexCode2?: string | null;
  warehouseCode?: string | null;
  previousNames?: string[];
  catalogIds?: string[];
};

const codeKey = (value: unknown) => normalizeOriginalInventoryIndex(String(value ?? '')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ''));
const nameKey = normalizeOriginalInventoryNameKey;
const unitKey = (value?: string | null) => {
  const unit = String(value ?? '').trim().toLowerCase().replace(/\.$/, '');
  if (/^(szt|sztuka|sztuki|sztuk|pc|pcs|piece|pieces)$/.test(unit)) return 'szt';
  if (/^(l|ltr|litr|litry|liter)$/.test(unit)) return 'l';
  return unit;
};

export const catalogRegisterIdentity = (item: CatalogItem) => JSON.stringify([
  codeKey(item.indexCode), codeKey(item.indexCode2), nameKey(item.name), unitKey(item.unit)
]);

export const catalogRegisterBlockIdentity = (item: CatalogItem) => JSON.stringify([
  codeKey(item.indexCode), codeKey(item.indexCode2), nameKey(item.name)
]);

const codes = (item: CatalogItem) => [...new Set([codeKey(item.indexCode), codeKey(item.indexCode2)].filter(Boolean))];
const byIndex = (items: readonly CatalogRegisterItem[]) => {
  const map = new Map<string, CatalogRegisterItem[]>();
  for (const item of items) for (const code of codes(item)) map.set(code, [...map.get(code) ?? [], item]);
  return map;
};

export const createCatalogRegisterResolver = (state: CatalogRegisterState | null) => {
  const active = byIndex(state?.items ?? []);
  const blocked = byIndex(state?.blocked ?? []);
  const activeNames = new Set((state?.items ?? []).map(item => nameKey(item.name)));
  const activeNameUnits = new Set((state?.items ?? []).map(item => `${nameKey(item.name)}|${unitKey(item.unit)}`));
  const blockedNames = new Set((state?.blocked ?? []).map(item => nameKey(item.name)));
  const candidates = (item: CatalogItem, map: Map<string, CatalogRegisterItem[]>) =>
    [...new Set(codes(item).flatMap(code => map.get(code) ?? []))];
  const hasActiveName = (item: CatalogItem) => item.unit
    ? activeNameUnits.has(`${nameKey(item.name)}|${unitKey(item.unit)}`) : activeNames.has(nameKey(item.name));
  const isBlocked = (item: CatalogItem) => {
    const indices = codes(item);
    if (!indices.length) return blockedNames.has(nameKey(item.name)) && !hasActiveName(item);
    const excluded = candidates(item, blocked);
    if (!excluded.length) return blockedNames.has(nameKey(item.name)) && !hasActiveName(item);
    const allowed = candidates(item, active);
    if (allowed.some(row => nameKey(row.name) === nameKey(item.name) && (!item.unit || unitKey(row.unit) === unitKey(item.unit)))) return false;
    return excluded.some(row => nameKey(row.name) === nameKey(item.name)) || !allowed.length;
  };
  const resolve = (item: CatalogItem): CatalogRegisterItem | null => {
    if (isBlocked(item)) return null;
    let possible = candidates(item, active).filter(row => !item.unit || unitKey(row.unit) === unitKey(item.unit));
    if (item.indexCode2) {
      const paired = possible.filter(row => codeKey(row.indexCode) === codeKey(item.indexCode) &&
        codeKey(row.indexCode2) === codeKey(item.indexCode2));
      if (paired.length) possible = paired;
    }
    const named = possible.filter(row => [row.name, ...row.previousNames ?? []].some(name => nameKey(name) === nameKey(item.name)));
    if (named.length === 1) return named[0];
    const primary = named.filter(row => codeKey(row.indexCode) === codeKey(item.indexCode));
    if (primary.length === 1) return primary[0];
    return possible.length === 1 ? possible[0] : null;
  };
  const hasRegisteredCode = (item: CatalogItem) => codes(item).some(code => active.has(code));
  return { isBlocked, resolve, hasRegisteredCode };
};

/** Only explicit pairs from the imported register are joined. Raw IDs remain usable as aliases. */
export const applyOriginalInventoryCatalogRegister = <T extends CatalogItem>(
  items: readonly T[], state: CatalogRegisterState | null
): Array<T & { catalogIds?: string[]; previousNames?: string[] }> => {
  if (!state) return [...items];
  const resolver = createCatalogRegisterResolver(state);
  const groups = new Map<string, { target: CatalogRegisterItem; rows: T[] }>();
  const unmatched: T[] = [];
  for (const item of items) {
    if (resolver.isBlocked(item)) continue;
    const target = resolver.resolve(item);
    if (!target) {
      if (!resolver.hasRegisteredCode(item)) unmatched.push(item);
      continue;
    }
    const identity = catalogRegisterIdentity(target);
    const group = groups.get(identity) ?? { target, rows: [] };
    group.rows.push(item);
    groups.set(identity, group);
  }
  for (const { target, rows } of groups.values()) {
    const preferred = rows.find(row => codeKey(row.indexCode) === codeKey(target.indexCode)) ?? rows[0];
    const catalogIds = [...new Set(rows.flatMap(row => [row.id ?? '', ...row.catalogIds ?? []]).filter(Boolean))];
    const previousNames = [...new Set([...target.previousNames ?? [], ...rows.flatMap(row => [row.name, ...row.previousNames ?? []])])]
      .filter(name => nameKey(name) !== nameKey(target.name));
    unmatched.push({ ...preferred, ...target, catalogIds, previousNames });
  }
  return unmatched;
};
