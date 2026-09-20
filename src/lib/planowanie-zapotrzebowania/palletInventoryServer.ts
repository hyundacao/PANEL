import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isProductionPlanDate } from '@/lib/utils/productionPlanDate';
import {
  PALLET_SET_SOURCE_TYPE, isPalletCount, normalizePalletSets, palletBatchPrefix,
  palletSetError, palletSetFingerprint, palletSourceId, parsePalletSource
} from './palletSets';

type InventoryRow = {
  id: string; at: string; warehouse_id: string; name: string; qty: number; unit: string;
  location: string | null; note: string | null; source_type: string; source_id: string; user_name: string;
};

const batchRows = async (db: SupabaseClient, batchId: string): Promise<InventoryRow[]> => {
  const { data, error } = await db.from('original_inventory_entries').select('*')
    .eq('source_type', PALLET_SET_SOURCE_TYPE).like('source_id', palletBatchPrefix(batchId) + '%');
  if (error) throw error;
  return data ?? [];
};

const validateWarehouse = async (db: SupabaseClient, warehouseId: string) => {
  if (!warehouseId) throw new Error('WAREHOUSE_REQUIRED');
  const { data, error } = await db.from('warehouses').select('id,name,is_active').eq('id', warehouseId).maybeSingle();
  if (error) throw error;
  if (!data?.is_active) throw new Error('WAREHOUSE_REQUIRED');
};

const entryId = (sourceId: string) => {
  const hash = createHash('sha256').update(sourceId).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
};

export async function addPalletInventory(db: SupabaseClient, payload: Record<string, unknown>, actor: string) {
  const batchId = String(payload.batchId ?? '');
  palletBatchPrefix(batchId);
  const count = payload.count;
  const dateKey = String(payload.dateKey ?? '');
  const warehouseId = String(payload.warehouseId ?? '');
  if (!isPalletCount(count)) throw new Error('PALLET_COUNT_REQUIRED');
  if (!isProductionPlanDate(dateKey)) throw new Error('DATE_REQUIRED');
  const reusedBatch = (rows: InventoryRow[]) => {
    if (!rows.every((row) => row.warehouse_id === warehouseId && row.at.slice(0, 10) === dateKey &&
      row.qty === (parsePalletSource(row.source_id)?.qtyPerSet ?? 0) * count)) throw new Error('PALLET_BATCH_CONFLICT');
    return rows;
  };
  const existing = await batchRows(db, batchId);
  if (existing.length) return reusedBatch(existing);
  await validateWarehouse(db, warehouseId);
  const { data, error } = await db.from('material_planning_state').select('pallet_sets:state->palletSets').eq('id', 'main').maybeSingle();
  if (error) throw error;
  const set = normalizePalletSets(data?.pallet_sets).find((item) => item.id === payload.setId && item.active);
  if (!set || palletSetError(set)) throw new Error('PALLET_SET_NOT_FOUND');
  if (palletSetFingerprint(set) !== payload.fingerprint) throw new Error('PALLET_SET_CHANGED');
  const { data: catalog, error: catalogError } = await db.from('original_inventory_catalog')
    .select('id,name,unit').in('id', set.components.map((item) => item.catalogId));
  if (catalogError) throw catalogError;
  if (set.components.some((part) => !catalog?.some((item) => item.id === part.catalogId && item.name === part.name && item.unit === part.unit))) {
    throw new Error('PALLET_CATALOG_CHANGED');
  }
  const [year, month, day] = dateKey.split('-').map(Number);
  const at = new Date(year, month - 1, day, 12).toISOString();
  const rows: InventoryRow[] = set.components.map((part) => {
    const sourceId = palletSourceId({ batchId, catalogId: part.catalogId, qtyPerSet: part.qty });
    return { id: entryId(sourceId), at, warehouse_id: warehouseId, name: part.name, qty: part.qty * count,
      unit: part.unit, location: null, note: `Zestaw paletowy: ${set.name}`, source_type: PALLET_SET_SOURCE_TYPE,
      source_id: sourceId, user_name: actor };
  });
  // One INSERT is atomic. Stable IDs also make retries safe after a lost response.
  const inserted = await db.from('original_inventory_entries').insert(rows).select('*');
  if (inserted.error) {
    if (inserted.error.code === '23505') {
      const saved = await batchRows(db, batchId);
      if (saved.length) return reusedBatch(saved);
    }
    throw inserted.error;
  }
  return inserted.data ?? [];
}

export async function updatePalletInventory(db: SupabaseClient, payload: Record<string, unknown>, actor: string) {
  const batchId = String(payload.batchId ?? '');
  const count = payload.count;
  if (!isPalletCount(count)) throw new Error('PALLET_COUNT_REQUIRED');
  const warehouseId = String(payload.warehouseId ?? '');
  await validateWarehouse(db, warehouseId);
  const rows = await batchRows(db, batchId);
  if (!rows.length) throw new Error('ENTRY_MISSING');
  const updated = rows.map((row) => {
    const source = parsePalletSource(row.source_id);
    if (!source) throw new Error('PALLET_GROUP_REQUIRED');
    return { ...row, qty: source.qtyPerSet * count, warehouse_id: warehouseId, user_name: actor };
  });
  const { data, error } = await db.from('original_inventory_entries').upsert(updated, { onConflict: 'id' }).select('*');
  if (error) throw error;
  return data ?? [];
}

export async function removePalletInventory(db: SupabaseClient, batchId: string) {
  const { error } = await db.from('original_inventory_entries').delete()
    .eq('source_type', PALLET_SET_SOURCE_TYPE).like('source_id', palletBatchPrefix(batchId) + '%');
  if (error) throw error;
}
