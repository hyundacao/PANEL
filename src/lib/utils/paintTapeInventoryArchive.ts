import type {
  OriginalInventoryErpSnapshotEntry,
  PaintTapeInventoryCatalogItem,
  PaintTapeInventoryComparison,
  PaintTapeInventoryEntry
} from '@/lib/api/types';
import { buildPaintTapeInventoryErpLookup, findPaintTapeInventoryErpSnapshot } from './paintTapeInventoryErp';

export const ORIGINAL_ERP_RETENTION_DAYS = 90;

export const originalErpRetentionCutoff = (today: string) => {
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ORIGINAL_ERP_RETENTION_DAYS);
  return date.toISOString().slice(0, 10);
};

export const buildPaintTapeInventoryComparison = (
  inventoryDate: string,
  catalog: readonly PaintTapeInventoryCatalogItem[],
  entries: readonly PaintTapeInventoryEntry[],
  snapshots: readonly OriginalInventoryErpSnapshotEntry[],
  previous: PaintTapeInventoryComparison | null = null,
  capturedAt = new Date().toISOString()
): PaintTapeInventoryComparison => {
  const lookup = buildPaintTapeInventoryErpLookup(snapshots);
  const previousById = new Map(previous?.rows.map((row) => [row.item.id, row.erp]) ?? []);
  const quantities = new Map<string, number>();
  entries.forEach((entry) => quantities.set(
    entry.catalogItemId, (quantities.get(entry.catalogItemId) ?? 0) + entry.qty
  ));
  return {
    version: 1, inventoryDate, capturedAt,
    rows: catalog.filter((item) => item.isActive || quantities.has(item.id)).map((item) => {
      // Reopening an old count must not lose ERP already archived before retention.
      const erp = snapshots.length > 0
        ? findPaintTapeInventoryErpSnapshot(lookup, item) ?? null
        : previousById.get(item.id) ?? null;
      return {
        item: { ...item }, physicalQty: quantities.get(item.id) ?? null,
        erp: erp ? { ...erp } : null
      };
    })
  };
};

