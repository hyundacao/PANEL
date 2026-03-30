import {
  normalizeOriginalInventoryName,
  normalizeOriginalInventoryNameKey
} from '@/lib/utils/originalInventoryName';

export const normalizeOriginalInventoryCatalogCell = (value: unknown) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

export const extractOriginalInventoryWarehouseCode = (value: unknown) => {
  const text = normalizeOriginalInventoryCatalogCell(value);
  if (!text) return null;
  const match = text.match(/M[-\s]?\d+/i);
  if (!match) return null;
  return match[0].replace(/\s+/g, '-').toUpperCase();
};

export const normalizeOriginalInventoryCatalogIdentityKey = (
  name: unknown,
  indexCode?: unknown
) =>
  `${normalizeOriginalInventoryNameKey(name)}|${normalizeOriginalInventoryCatalogCell(indexCode).toLowerCase()}`;

const normalizeHeader = (value: unknown) =>
  normalizeOriginalInventoryCatalogCell(value)
    .toLowerCase()
    .replace(/\./g, '');

const NAME_HEADERS = new Set(['nazwa', 'material', 'tworzywo', 'kartoteka', 'name']);
const UNIT_HEADERS = new Set(['jedn', 'jm', 'jednostka', 'unit']);
const INDEX_HEADERS = new Set(['indeks', 'index', 'index code', 'indeks erp', 'symbol']);

const findHeaderIndex = (headers: string[], allowed: Set<string>) =>
  headers.findIndex((header) => allowed.has(header));

const detectHeaderLayout = (row: unknown[]) => {
  const headers = row.map((cell) => normalizeHeader(cell));
  const nameIndex = findHeaderIndex(headers, NAME_HEADERS);
  if (nameIndex < 0) return null;
  return {
    nameIndex,
    unitIndex: findHeaderIndex(headers, UNIT_HEADERS),
    indexIndex: findHeaderIndex(headers, INDEX_HEADERS)
  };
};

const scoreCatalogCandidate = (name: string, unit: string, indexCode: string | null) => {
  let score = 0;
  if (/[A-Za-zĄąĆćĘęŁłŃńÓóŚśŹźŻż]/.test(name)) score += 3;
  if (name.length >= 4) score += 1;
  if (!unit || /^[a-z]{1,5}$/i.test(unit)) score += 1;
  if (indexCode && /[\d-]/.test(indexCode)) score += 1;
  return score;
};

const parseFallbackCatalogRow = (row: unknown[]) => {
  const firstLayout = {
    name: normalizeOriginalInventoryName(row?.[0]),
    unit: normalizeOriginalInventoryCatalogCell(row?.[1]) || 'kg',
    indexCode: normalizeOriginalInventoryCatalogCell(row?.[2]) || null
  };
  const erpLayout = {
    name: normalizeOriginalInventoryName(row?.[2]),
    unit: normalizeOriginalInventoryCatalogCell(row?.[3]) || 'kg',
    indexCode: normalizeOriginalInventoryCatalogCell(row?.[1]) || null
  };

  const firstScore = scoreCatalogCandidate(firstLayout.name, firstLayout.unit, firstLayout.indexCode);
  const erpScore = scoreCatalogCandidate(erpLayout.name, erpLayout.unit, erpLayout.indexCode);
  return erpScore > firstScore ? erpLayout : firstLayout;
};

export const parseOriginalInventoryCatalogRows = (rows: unknown[][]) => {
  const items: Array<{
    name: string;
    unit: string;
    indexCode: string | null;
    warehouseCode: string | null;
  }> = [];
  const seen = new Set<string>();
  const headerLayout = rows.length > 0 ? detectHeaderLayout(rows[0] ?? []) : null;

  rows.forEach((row, index) => {
    const parsed = headerLayout
      ? {
          name: normalizeOriginalInventoryName(row?.[headerLayout.nameIndex]),
          unit:
            headerLayout.unitIndex >= 0
              ? normalizeOriginalInventoryCatalogCell(row?.[headerLayout.unitIndex]) || 'kg'
              : 'kg',
          indexCode:
            headerLayout.indexIndex >= 0
              ? normalizeOriginalInventoryCatalogCell(row?.[headerLayout.indexIndex]) || null
              : null
        }
      : parseFallbackCatalogRow(row);

    if (!parsed.name) return;
    if (headerLayout && index === 0) return;
    if (!parsed.indexCode) return;

    const key = normalizeOriginalInventoryCatalogIdentityKey(parsed.name, parsed.indexCode);
    if (seen.has(key)) return;
    seen.add(key);

    items.push({
      name: parsed.name,
      unit: parsed.unit || 'kg',
      indexCode: parsed.indexCode,
      warehouseCode: extractOriginalInventoryWarehouseCode(parsed.indexCode)
    });
  });

  return items;
};
