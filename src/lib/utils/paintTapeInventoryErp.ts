import type { OriginalInventoryErpSnapshotEntry, PaintTapeInventoryCatalogItem } from '@/lib/api/types';
import { normalizeOriginalInventoryName } from './originalInventoryName';
import { getOriginalInventorySpisIndex2 } from './originalInventorySpisSearch';

type SnapshotSource = Pick<OriginalInventoryErpSnapshotEntry,
  'name' | 'unit' | 'realQty' | 'availableQty' | 'indexCode' | 'indexCode2'>;
type SnapshotGroup = Pick<SnapshotSource, 'unit' | 'realQty' | 'availableQty'>;

const normalizeName = (value: unknown) => normalizeOriginalInventoryName(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();
const normalizeIndex = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');

export const buildPaintTapeInventoryErpLookup = (entries: readonly SnapshotSource[]) => {
  const byName = new Map<string, SnapshotGroup>();
  entries.forEach((entry) => {
    const key = normalizeName(entry.name);
    if (!key) return;
    const current = byName.get(key);
    if (current) {
      current.realQty += entry.realQty;
      current.availableQty += entry.availableQty;
    } else {
      byName.set(key, { realQty: entry.realQty, availableQty: entry.availableQty, unit: entry.unit });
    }
  });

  // Ambiguous codes must fall back to the material name, not the first match.
  const byIndex = new Map<string, SnapshotGroup | null>();
  entries.forEach((entry) => {
    const group = byName.get(normalizeName(entry.name));
    if (!group) return;
    [entry.indexCode, entry.indexCode2, getOriginalInventorySpisIndex2(entry.indexCode, entry.indexCode2)]
      .forEach((identifier) => {
        const key = normalizeIndex(identifier);
        if (!key) return;
        if (!byIndex.has(key)) byIndex.set(key, group);
        else if (byIndex.get(key) !== group) byIndex.set(key, null);
      });
  });
  return { byName, byIndex };
};

export const findPaintTapeInventoryErpSnapshot = (
  lookup: ReturnType<typeof buildPaintTapeInventoryErpLookup>,
  item: Pick<PaintTapeInventoryCatalogItem, 'itemIndex' | 'itemCode' | 'name'>
) => lookup.byIndex.get(normalizeIndex(item.itemIndex)) ??
  lookup.byIndex.get(normalizeIndex(item.itemCode)) ??
  lookup.byName.get(normalizeName(item.name));
