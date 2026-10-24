const normalizeSearchText = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[łŁ]/g, 'l')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const compactSearchCode = (value: unknown) =>
  normalizeSearchText(value)
    .replace(/[^a-z0-9]+/g, '');

const PRIORITY_WAREHOUSE_CODES = ['M1', 'M4', 'M10', 'M11'] as const;

export const getOriginalInventorySpisEntriesQueryKey = (scope: unknown) =>
  ['spis-oryginalow', String(scope ?? '').trim()] as const;

export const getOriginalInventorySpisWarehousePriority = (...values: unknown[]) => {
  let warehouseCode = '';
  for (const value of values) {
    const match = compactSearchCode(value).match(/m\d+/);
    if (match) {
      warehouseCode = match[0].toUpperCase();
      break;
    }
  }

  const preferredIndex = PRIORITY_WAREHOUSE_CODES.indexOf(
    warehouseCode as (typeof PRIORITY_WAREHOUSE_CODES)[number]
  );
  if (preferredIndex >= 0) return preferredIndex;
  if (!warehouseCode) return 100;
  return 500;
};

type OriginalInventorySpisSuggestion = {
  name: string;
  previousNames?: readonly string[];
  warehouseCode?: string | null;
  indexCode?: string | null;
  indexCode2?: string | null;
  inErp?: boolean;
};

const isFormSuggestion = (item: OriginalInventorySpisSuggestion) =>
  [item.name, item.warehouseCode, item.indexCode, item.indexCode2].some((value) =>
    /(^|[\s(/_-])fwp?(?=$|[\s/_-]|\d)/i.test(String(value ?? ''))
  );

const getOriginalInventorySpisIdentityKey = (item: OriginalInventorySpisSuggestion) => {
  const index = String(item.indexCode || item.indexCode2 || '').trim().toUpperCase()
    .replace(/\s*([-\/])\s*/g, '$1');
  return `${normalizeSearchText(item.name)}|${String(item.warehouseCode ?? '').trim().toUpperCase()}|${index}`;
};

const getOriginalInventorySpisIndexedMaterialKey = (item: OriginalInventorySpisSuggestion) => {
  const index2 = normalizeSearchText(getOriginalInventorySpisIndex2(item.indexCode, item.indexCode2));
  if (!index2) return '';
  const name = normalizeSearchText(item.name).replace(/\s*-\s*/g, '-');
  return `${name}|${index2}`;
};

export const dedupeOriginalInventorySpisSuggestions = <T extends OriginalInventorySpisSuggestion>(
  suggestions: readonly T[]
) => {
  const currentNamesByAlias = new Map<string, Set<string>>();
  for (const item of suggestions) {
    if (!item.indexCode) continue;
    for (const alias of item.previousNames ?? []) {
      const key = normalizeSearchText(alias);
      const identities = currentNamesByAlias.get(key) ?? new Set<string>();
      identities.add(`${item.indexCode.trim().toUpperCase()}|${normalizeSearchText(item.name)}`);
      currentNamesByAlias.set(key, identities);
    }
  }
  const deduped = new Map<string, T>();
  const score = (item: T) =>
    compactSearchCode(item.indexCode2).length * 8 +
    Number(Boolean(item.indexCode2)) * 4 +
    Number(Boolean(item.indexCode)) * 2 +
    Number(Boolean(item.warehouseCode));

  suggestions.forEach((item) => {
    // Old counted names are aliases, not additional catalog choices. Keep ambiguous ones.
    if (!item.indexCode && currentNamesByAlias.get(normalizeSearchText(item.name))?.size === 1) return;
    const key = getOriginalInventorySpisIdentityKey(item);
    const current = deduped.get(key);
    if (!current || score(item) > score(current)) deduped.set(key, item);
  });

  return [...deduped.values()];
};

export const prioritizeOriginalInventorySpisSuggestions = <T extends OriginalInventorySpisSuggestion>(
  suggestions: readonly T[],
  inventoriedNames: Iterable<unknown>
) => {
  const inventoried = new Set(
    [...inventoriedNames].map(normalizeSearchText).filter(Boolean)
  );
  const ordered = [...suggestions].sort((left, right) => {
    const leftName = normalizeSearchText(left.name);
    const rightName = normalizeSearchText(right.name);
    const wasInventoried = (item: T, name: string) => inventoried.has(name) ||
      (item.previousNames ?? []).some((alias) => inventoried.has(normalizeSearchText(alias)));
    const inventoriedOrder = Number(!wasInventoried(left, leftName)) - Number(!wasInventoried(right, rightName));
    if (inventoriedOrder !== 0) return inventoriedOrder;

    const warehouseOrder = getOriginalInventorySpisWarehousePriority(left.warehouseCode, left.indexCode) -
      getOriginalInventorySpisWarehousePriority(right.warehouseCode, right.indexCode);
    if (warehouseOrder !== 0) return warehouseOrder;

    const nameOrder = left.name.localeCompare(right.name, 'pl', { sensitivity: 'base' });
    if (nameOrder !== 0) return nameOrder;
    const erpOrder = Number(Boolean(right.inErp)) - Number(Boolean(left.inErp));
    if (erpOrder !== 0) return erpOrder;
    return String(left.warehouseCode ?? '').localeCompare(String(right.warehouseCode ?? ''), 'pl');
  });

  // An old count has only a name. Hide that generic choice, not its distinct catalog indices.
  const indexedNames = new Set(ordered
    .filter(item => Boolean(item.indexCode || item.indexCode2))
    .map(item => normalizeSearchText(item.name)));
  return ordered.filter(item => Boolean(item.indexCode || item.indexCode2) ||
    !indexedNames.has(normalizeSearchText(item.name)));
};

export const rankOriginalInventorySpisSuggestions = <T extends OriginalInventorySpisSuggestion>(
  suggestions: readonly T[],
  inventoriedNames: Iterable<unknown> = []
) => {
  const matches = dedupeOriginalInventorySpisSuggestions(suggestions.filter(item => !isFormSuggestion(item)));
  const namesWithWarehouseVariant = new Set(
    matches
      .filter((item) => Boolean(item.warehouseCode))
      .map((item) => normalizeSearchText(item.name))
  );
  const indexedMaterialsWithWarehouseVariant = new Set(
    matches
      .filter((item) => Boolean(item.warehouseCode))
      .map(getOriginalInventorySpisIndexedMaterialKey)
      .filter(Boolean)
  );
  const uniqueMatches = matches.filter(
    (item) => Boolean(item.warehouseCode) || /^m[-\s]?\d+(?:[-\s]|$)/i.test(item.indexCode ?? '') || (
      getOriginalInventorySpisIndexedMaterialKey(item)
        ? !indexedMaterialsWithWarehouseVariant.has(getOriginalInventorySpisIndexedMaterialKey(item))
        : !namesWithWarehouseVariant.has(normalizeSearchText(item.name))
    )
  );
  return prioritizeOriginalInventorySpisSuggestions(uniqueMatches, inventoriedNames);
};

export const searchOriginalInventorySpisSuggestions = <T extends OriginalInventorySpisSuggestion>(
  suggestions: readonly T[],
  query: unknown,
  inventoriedNames: Iterable<unknown>,
  limit = 8
) => {
  if (!normalizeSearchText(query)) return [];
  const safeLimit = Math.max(1, Math.floor(Number.isFinite(limit) ? limit : 8));
  return rankOriginalInventorySpisSuggestions(
    suggestions.filter(item => [item.name, ...item.previousNames ?? []].some(name =>
      matchesOriginalInventorySpisSearch(query, name, item.indexCode2))),
    inventoriedNames
  ).slice(0, safeLimit);
};

export const getOriginalInventorySpisIndex2 = (
  indexCode: unknown,
  explicitIndexCode2?: unknown
) => {
  const explicit = String(explicitIndexCode2 ?? '').trim();
  const legacy = String(indexCode ?? '')
    .trim()
    .replace(/\s*([-\/])\s*/g, '$1');
  if (!legacy) return explicit;

  const derived = /^m[-\s]?\d+(?:[-\s]|$)/i.test(legacy)
    ? legacy
        .replace(/^m[-\s]?\d+(?:[-\s]|$)/i, '')
        .match(/(\d+(?:[-/]\d+)*)$/)?.[1] ?? ''
    : legacy;
  if (!explicit) return derived;
  if (!derived) return explicit;
  return compactSearchCode(derived).length >= compactSearchCode(explicit).length
    ? derived
    : explicit;
};

export const matchesOriginalInventorySpisSearch = (
  query: unknown,
  name: unknown,
  indexCode2: unknown
) => {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;

  const normalizedName = normalizeSearchText(name);
  // Ignore legacy index 1 values, not queries: M2 can be part of a material name.
  const normalizedIndex2 = /^m[-\s]?\d+(?:[-\s]|$)/i.test(String(indexCode2 ?? '').trim())
    ? ''
    : normalizeSearchText(indexCode2);
  const searchableValues = [normalizedName, normalizedIndex2];
  const queryParts = normalizedQuery.split(' ').filter(Boolean);
  if (queryParts.length === 1) {
    return searchableValues.some((value) => value.includes(queryParts[0]));
  }

  const numericRuns = searchableValues.flatMap((value) => value.match(/\d+/g) ?? []);
  return queryParts.every((part) => {
    if (!/^\d+$/.test(part)) {
      return searchableValues.some((value) => value.includes(part));
    }
    if (part.length === 1) return numericRuns.includes(part);
    return numericRuns.some((run) => run.includes(part));
  });
};
