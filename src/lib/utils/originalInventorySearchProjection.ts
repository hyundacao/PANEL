import type { SupabaseClient } from '@supabase/supabase-js';
import type { OriginalInventoryCatalogEntry } from '@/lib/api/types';
import { applyOriginalInventoryCatalogRegister, type CatalogRegisterState } from './originalInventoryCatalogRegister';
import { linkOriginalInventoryM10Indices } from './originalInventoryM10Indices';
import { normalizeOriginalInventorySearchText } from './originalInventorySpisSearch';
import { withOriginalInventorySearchTimeout } from './originalInventorySearchTimeout';

export const ORIGINAL_INVENTORY_SEARCH_FORMAT = 1;

type CatalogRow = {
  id: string; name: string; unit: string; created_at: string;
  index_code?: string | null; index_code2?: string | null; warehouse_code?: string | null;
  previous_names?: unknown;
};

export const mapOriginalInventoryCatalogEntry = (row: CatalogRow): OriginalInventoryCatalogEntry => ({
  id: row.id, name: row.name, unit: row.unit, createdAt: row.created_at,
  indexCode: row.index_code ? String(row.index_code).trim() : null,
  indexCode2: row.index_code2 ? String(row.index_code2).trim() : null,
  warehouseCode: row.warehouse_code ? String(row.warehouse_code).trim() : null,
  previousNames: Array.isArray(row.previous_names) ? row.previous_names.filter((name): name is string => typeof name === 'string') : []
});

export const buildOriginalInventorySearchProjection = (rows: CatalogRow[], state: CatalogRegisterState | null) => {
  if (state && (state.version !== 1 || !Array.isArray(state.items) || !Array.isArray(state.blocked))) {
    throw new Error('CATALOG_REGISTER_INVALID');
  }
  const mapped = rows.filter(row => String(row.index_code ?? '').trim()).map(mapOriginalInventoryCatalogEntry);
  const catalog = state ? applyOriginalInventoryCatalogRegister(mapped, state) : linkOriginalInventoryM10Indices(mapped);
  return catalog.map(item => ({
    item,
    searchValues: [item.name, ...item.previousNames ?? [], item.indexCode, item.indexCode2]
      .map(normalizeOriginalInventorySearchText).filter(Boolean)
  }));
};

const missingMigration = (error: { code?: string } | null) =>
  error?.code === 'PGRST202' || error?.code === '42883';

const loading = new WeakMap<SupabaseClient, Promise<boolean>>();
const rpc = (db: SupabaseClient, name: string, args?: Record<string, unknown>, timeoutMs = 2000) =>
  withOriginalInventorySearchTimeout(signal => {
    const request = db.rpc(name, args);
    return typeof request.abortSignal === 'function' ? request.abortSignal(signal) : request;
  }, undefined, timeoutMs);
const candidates = (db: SupabaseClient, terms: string[], onlyIndex2: boolean) =>
  rpc(db, 'get_original_inventory_search_candidates', {
    p_terms: terms, p_only_index2: onlyIndex2, p_format: ORIGINAL_INVENTORY_SEARCH_FORMAT
  });

// Publication is atomic and checks the source generation again after canonicalization.
export const refreshOriginalInventorySearchProjection = (db: SupabaseClient): Promise<boolean> => {
  const pending = loading.get(db);
  if (pending) return pending;
  const work = (async () => {
    const status = await candidates(db, [], false);
    if (missingMigration(status.error)) return false;
    if (status.error) throw status.error;
    if (status.data?.ready) return true;
    for (let attempt = 0; attempt < 2; attempt++) {
      const source = await rpc(db, 'get_original_inventory_search_source', undefined, 15_000);
      if (source.error) throw source.error;
      if (!source.data || !Array.isArray(source.data.rows)) throw new Error('SEARCH_SOURCE_INVALID');
      const rows = buildOriginalInventorySearchProjection(source.data.rows, source.data.register ?? null);
      const published = await rpc(db, 'publish_original_inventory_search', {
        p_generation: source.data.generation, p_format: ORIGINAL_INVENTORY_SEARCH_FORMAT, p_rows: rows
      }, 10_000);
      if (published.error) throw published.error;
      if (published.data === true) return true;
    }
    return false;
  })().catch((error: unknown) => {
    // A derived read model must never turn a completed catalog import into a failed import.
    console.warn('ORIGINAL_INVENTORY_SEARCH_PREPARE_FAILED', {
      code: error && typeof error === 'object' && 'code' in error ? String(error.code) : 'UNKNOWN'
    });
    return false;
  }).finally(() => { if (loading.get(db) === work) loading.delete(db); });
  loading.set(db, work);
  return work;
};

export const readOriginalInventorySearchCandidates = async (
  db: SupabaseClient, query: string, onlyIndex2: boolean,
  onNotReady?: (generation: string) => void
): Promise<OriginalInventoryCatalogEntry[] | null> => {
  const terms = normalizeOriginalInventorySearchText(query).split(' ').filter(Boolean);
  const result = await candidates(db, terms, onlyIndex2);
  if (missingMigration(result.error)) return null;
  if (result.error) throw result.error;
  if (!result.data?.ready) {
    // Typing must not wait for a full catalog rebuild or retry a failed publication.
    onNotReady?.(String(result.data?.generation ?? 'unknown'));
    return null;
  }
  if (!result.data?.ready || !Array.isArray(result.data.items)) throw new Error('SEARCH_PROJECTION_NOT_READY');
  // SQL returns a superset, without LIMIT. Existing JS matching/ranking remains authoritative.
  return result.data.items;
};
