export const normalizeInventoryImportHeader = (value: unknown) =>
  String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[łŁ]/g, 'l').toLowerCase().replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim();

const INDEX_1_HEADERS = new Set(['indeks', 'index', 'indeks 1', 'index 1', 'indeks1', 'index1', 'index code', 'index code1', 'indeks erp', 'symbol']);
const INDEX_2_HEADERS = new Set(['indeks 2', 'index 2', 'indeks2', 'index2', 'index code2', 'indeks dodatkowy', 'secondary index']);

// Column labels define the role. Numeric values and warehouse prefixes do not.
export const getInventoryImportIndexColumns = (row: unknown[]) => {
  const headers = row.map(normalizeInventoryImportHeader);
  const findUnique = (allowed: Set<string>) => {
    const matches = headers.flatMap((header, index) => allowed.has(header) ? [index] : []);
    if (matches.length > 1) throw new Error('AMBIGUOUS_INDEX_COLUMNS');
    return matches[0] ?? -1;
  };
  return { index1: findUnique(INDEX_1_HEADERS), index2: findUnique(INDEX_2_HEADERS) };
};
