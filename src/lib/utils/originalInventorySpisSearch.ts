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
  warehouseCode?: string | null;
  indexCode?: string | null;
  indexCode2?: string | null;
};

const getOriginalInventorySpisIdentityKey = (item: OriginalInventorySpisSuggestion) =>
  `${normalizeSearchText(item.name)}|${String(item.warehouseCode ?? '').trim().toUpperCase()}`;

export const dedupeOriginalInventorySpisSuggestions = <T extends OriginalInventorySpisSuggestion>(
  suggestions: readonly T[]
) => {
  const deduped = new Map<string, T>();
  const score = (item: T) =>
    compactSearchCode(item.indexCode2).length * 8 +
    Number(Boolean(item.indexCode2)) * 4 +
    Number(Boolean(item.indexCode)) * 2 +
    Number(Boolean(item.warehouseCode));

  suggestions.forEach((item) => {
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
    const inventoriedOrder = Number(!inventoried.has(leftName)) - Number(!inventoried.has(rightName));
    if (inventoriedOrder !== 0) return inventoriedOrder;

    const warehouseOrder = getOriginalInventorySpisWarehousePriority(left.warehouseCode, left.indexCode) -
      getOriginalInventorySpisWarehousePriority(right.warehouseCode, right.indexCode);
    if (warehouseOrder !== 0) return warehouseOrder;

    const nameOrder = left.name.localeCompare(right.name, 'pl', { sensitivity: 'base' });
    if (nameOrder !== 0) return nameOrder;
    return String(left.warehouseCode ?? '').localeCompare(String(right.warehouseCode ?? ''), 'pl');
  });

  const emittedInventoriedNames = new Set<string>();
  return ordered.filter((suggestion) => {
    const name = normalizeSearchText(suggestion.name);
    if (!inventoried.has(name)) return true;
    if (emittedInventoriedNames.has(name)) return false;
    emittedInventoriedNames.add(name);
    return true;
  });
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

  // Index 1 values start with an M-* warehouse prefix. They may still occur in
  // legacy rows, but the Spis search must not match them as a code.
  if (/^m[-\s]?\d+(?:[-\s]|$)/i.test(String(query ?? '').trim())) return false;

  const normalizedName = normalizeSearchText(name);
  const normalizedIndex2 = normalizeSearchText(indexCode2);
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
