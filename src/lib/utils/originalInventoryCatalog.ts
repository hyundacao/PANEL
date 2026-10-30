import {
  normalizeOriginalInventoryName,
  normalizeOriginalInventoryNameKey
} from '@/lib/utils/originalInventoryName';
import { getInventoryImportIndexColumns, normalizeInventoryImportHeader } from './originalInventoryImportColumns';

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

const normalizeHeader = normalizeInventoryImportHeader;

const NAME_HEADERS = new Set(['nazwa', 'material', 'tworzywo', 'kartoteka', 'name']);
const UNIT_HEADERS = new Set(['jedn', 'jm', 'j m', 'jednostka', 'unit']);

const findHeaderIndex = (headers: string[], allowed: Set<string>) =>
  headers.findIndex((header) => allowed.has(header));

const detectHeaderLayout = (row: unknown[]) => {
  const headers = row.map((cell) => normalizeHeader(cell));
  const nameIndex = findHeaderIndex(headers, NAME_HEADERS);
  if (nameIndex < 0) return null;
  return {
    nameIndex,
    unitIndex: findHeaderIndex(headers, UNIT_HEADERS),
    ...getInventoryImportIndexColumns(row)
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
    indexCode2?: string | null;
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
            headerLayout.index1 >= 0
              ? normalizeOriginalInventoryCatalogCell(row?.[headerLayout.index1]) || null
              : null,
          indexCode2: headerLayout.index2 >= 0
            ? normalizeOriginalInventoryCatalogCell(row?.[headerLayout.index2]) || null
            : null
        }
      : parseFallbackCatalogRow(row);

    if (!parsed.name) return;
    if (headerLayout && index === 0) return;
    if (!parsed.indexCode) return;

    const indexCode2 = 'indexCode2' in parsed ? parsed.indexCode2 as string | null : null;
    const key = `${normalizeOriginalInventoryCatalogIdentityKey(parsed.name, parsed.indexCode)}|${indexCode2 ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);

    items.push({
      name: parsed.name,
      unit: parsed.unit || 'kg',
      indexCode: parsed.indexCode,
      ...(indexCode2 ? { indexCode2 } : {}),
      warehouseCode: extractOriginalInventoryWarehouseCode(parsed.indexCode)
    });
  });

  return items;
};
