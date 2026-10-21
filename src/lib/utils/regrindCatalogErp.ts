import type { OriginalInventoryCatalogEntry, OriginalInventoryErpSnapshotEntry, RegrindCatalogErpStock } from '@/lib/api/types';
import { findOriginalInventoryCatalogMaterial, matchOriginalInventoryErpStock } from '@/lib/utils/originalInventoryErpMatch';
import { normalizeOriginalInventoryNameKey } from '@/lib/utils/originalInventoryName';

type CatalogIdentity = Pick<OriginalInventoryCatalogEntry, 'name' | 'unit' | 'indexCode' | 'previousNames'>;
type Stock = Pick<OriginalInventoryErpSnapshotEntry, 'name' | 'unit' | 'indexCode' | 'realQty' | 'availableQty'>;
const indexKey = (value: string | null | undefined) => String(value ?? '').trim().toUpperCase();

/** Each ERP stock belongs to a catalog group, not to each of its constituent regrinds. */
export const matchRegrindCatalogErpStocks = (
  catalogs: readonly string[],
  snapshots: readonly Stock[],
  inventoryCatalog: readonly CatalogIdentity[]
): RegrindCatalogErpStock[] => [...new Set(catalogs.map((value) => value.trim()))].map((catalog) => {
  if (!catalog) return { catalog, erpQty: null, indexCode: null };
  const byIndex = snapshots.find((row) => indexKey(row.indexCode) === indexKey(catalog));
  const identity = byIndex
    ? { name: catalog, unit: 'kg', indexCode: byIndex.indexCode }
    : { name: catalog, unit: 'kg', indexCode: findOriginalInventoryCatalogMaterial(inventoryCatalog, { name: catalog, unit: 'kg' })?.indexCode };
  const match = matchOriginalInventoryErpStock(snapshots, identity, normalizeOriginalInventoryNameKey);
  if (!match) return { catalog, erpQty: null, indexCode: null };
  const indexCode = identity.indexCode ?? snapshots.find((row) =>
    normalizeOriginalInventoryNameKey(row.name) === normalizeOriginalInventoryNameKey(catalog))?.indexCode ?? null;
  return { catalog, erpQty: match.realQty, indexCode };
});
