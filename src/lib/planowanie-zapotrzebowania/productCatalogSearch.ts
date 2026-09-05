export type ProductCatalogItem = {
  id: string;
  name: string;
  index: string;
  warehouseCode?: string;
  unit?: string;
};

export type ProductCatalogSearchMode =
  | 'product-name'
  | 'product-index'
  | 'material-name'
  | 'material-code';

const MATERIAL_WAREHOUSE_PRIORITY = ['M-1', 'M-4', 'M-10', 'M-11', 'M-51'] as const;
const MATERIAL_WAREHOUSE_RANK = new Map<string, number>(
  MATERIAL_WAREHOUSE_PRIORITY.map((warehouseCode, index) => [warehouseCode, index])
);

export const normalizeProductCatalogSearch = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[łŁ]/g, 'l')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const relevanceFor = (primary: string, secondary: string, query: string) => {
  if (primary === query) return 0;
  if (primary.startsWith(query)) return 1;
  if (primary.includes(query)) return 2;
  if (secondary === query) return 3;
  if (secondary.startsWith(query)) return 4;
  if (secondary.includes(query)) return 5;
  return 6;
};

export const searchProductCatalog = (
  items: ProductCatalogItem[],
  rawQuery: string,
  mode: ProductCatalogSearchMode,
  requestedLimit = 12
) => {
  const query = normalizeProductCatalogSearch(rawQuery);
  if (!query) return [];
  const tokens = query.split(/\s+/).filter(Boolean);
  const materialSearch = mode === 'material-name' || mode === 'material-code';
  const nameFirst = mode === 'product-name' || mode === 'material-name';
  const limit = Math.min(25, Math.max(1, Math.floor(requestedLimit) || 12));
  const otherWarehouseRank = MATERIAL_WAREHOUSE_PRIORITY.length;

  return items
    .map((item, sourceOrder) => {
      const code = normalizeProductCatalogSearch(item.index);
      const name = normalizeProductCatalogSearch(item.name);
      const warehouseCode = normalizeProductCatalogSearch(item.warehouseCode);
      if (materialSearch && /(^|[\s(/_-])fw\s*-/.test(name)) return null;
      if (!tokens.every((token) => `${code} ${name} ${warehouseCode}`.includes(token))) return null;
      const primary = nameFirst ? name : code;
      const secondary = nameFirst ? code : name;
      const warehouseRank = materialSearch
        ? MATERIAL_WAREHOUSE_RANK.get(String(item.warehouseCode ?? '').trim().toUpperCase()) ?? otherWarehouseRank
        : 0;
      return {
        item,
        sourceOrder,
        relevance: relevanceFor(primary, secondary, query),
        warehouseRank,
        primary
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
    .sort((left, right) =>
      left.relevance - right.relevance ||
      left.warehouseRank - right.warehouseRank ||
      left.primary.localeCompare(right.primary, 'pl', { numeric: true }) ||
      left.sourceOrder - right.sourceOrder
    )
    .slice(0, limit)
    .map(({ item }) => item);
};
