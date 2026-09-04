const normalizeSearchText = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[łŁ]/g, 'l')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const compactSearchCode = (value: unknown) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

export const getOriginalInventorySpisIndex2 = (
  indexCode: unknown,
  explicitIndexCode2?: unknown
) => {
  const explicit = String(explicitIndexCode2 ?? '').trim();
  if (explicit) return explicit;

  const legacy = String(indexCode ?? '').trim();
  if (!legacy) return '';
  if (!/^m[-\s]?\d+(?:[-\s]|$)/i.test(legacy)) return legacy;

  return legacy.match(/(\d+(?:[-/]\d+)*)$/)?.[1] ?? '';
};

export const matchesOriginalInventorySpisSearch = (
  query: unknown,
  name: unknown,
  indexCode2: unknown
) => {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;

  const normalizedName = normalizeSearchText(name);
  const normalizedIndex2 = normalizeSearchText(indexCode2);
  if (
    normalizedName.includes(normalizedQuery) ||
    normalizedIndex2.includes(normalizedQuery)
  ) {
    return true;
  }

  // Index 1 values start with an M-* warehouse prefix. They may still occur in
  // legacy rows, but the Spis search must not match them as a code.
  if (/^m[-\s]?\d+(?:[-\s]|$)/i.test(String(query ?? '').trim())) return false;

  const compactQuery = compactSearchCode(query);
  const compactIndex2 = compactSearchCode(indexCode2);
  if (compactQuery.length >= 2 && compactIndex2.includes(compactQuery)) return true;

  const haystackTokens = `${normalizedName} ${normalizedIndex2}`
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const queryTokens = normalizedQuery.split(/[^a-z0-9]+/).filter(Boolean);
  return queryTokens.length > 0 && queryTokens.every((queryToken) =>
    haystackTokens.some((haystackToken) => haystackToken.includes(queryToken))
  );
};
