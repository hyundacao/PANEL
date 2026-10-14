import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  OriginalInventoryErpSnapshotEntry,
  PaintTapeInventoryCatalogItem,
  PaintTapeInventoryComparison,
  PaintTapeInventoryEntry
} from '@/lib/api/types';
import { buildPaintTapeInventoryComparison, originalErpRetentionCutoff } from './paintTapeInventoryArchive';

type ArchiveMappers = {
  catalog: (row: Record<string, unknown>) => PaintTapeInventoryCatalogItem;
  entry: (row: Record<string, unknown>) => PaintTapeInventoryEntry;
  snapshots: (date: string) => Promise<OriginalInventoryErpSnapshotEntry[]>;
};

const assertResult = (error: { message: string; code?: string } | null) => {
  if (!error) return;
  if (error.code === 'PGRST202' || error.code === '42703') {
    throw new Error('MIGRATION_REQUIRED_PAINT_TAPE_INVENTORY_ARCHIVE');
  }
  throw error;
};

export const archivePaintTapeInventorySession = async (
  db: SupabaseClient,
  date: string,
  actor: string | null,
  mappers: ArchiveMappers,
  closeSession: boolean
) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const sessionResult = await db.from('paint_tape_inventory_sessions').select('*')
      .eq('inventory_date', date).maybeSingle();
    assertResult(sessionResult.error);
    const session = sessionResult.data;
    if (!session) throw new Error('NOT_FOUND');
    if (session.status === 'CLOSED' && session.erp_comparison) return session;
    if (!closeSession && session.status !== 'CLOSED') return session;

    const catalogResult = await db.from('paint_tape_inventory_catalog').select('*')
      .order('sort_order').order('name');
    assertResult(catalogResult.error);
    const entriesResult = await db.from('paint_tape_inventory_entries').select('*')
      .eq('session_id', session.id).order('id');
    assertResult(entriesResult.error);
    const entries = entriesResult.data ?? [];
    const comparison = buildPaintTapeInventoryComparison(
      date, (catalogResult.data ?? []).map(mappers.catalog), entries.map(mappers.entry),
      await mappers.snapshots(date), session.erp_comparison as PaintTapeInventoryComparison | null
    );
    const result = await db.rpc('archive_paint_tape_inventory_session', {
      p_session_id: session.id,
      p_comparison: comparison,
      p_expected_entries: entries.map((entry) => ({
        id: entry.id, catalog_item_id: entry.catalog_item_id, qty: entry.qty
      })),
      p_actor: actor,
      p_close: closeSession
    });
    if (result.error?.message.includes('INVENTORY_ARCHIVE_CONFLICT') && attempt < 2) continue;
    assertResult(result.error);
    return result.data;
  }
  throw new Error('INVENTORY_ARCHIVE_CONFLICT');
};

export const purgeOriginalErpHistory = async (
  db: SupabaseClient,
  today: string,
  mappers: ArchiveMappers
) => {
  const cutoff = originalErpRetentionCutoff(today);
  // A bounded backfill protects legacy counts without a large foreground request.
  const pending = await db.from('paint_tape_inventory_sessions').select('inventory_date')
    .eq('status', 'CLOSED').is('erp_comparison', null)
    .order('inventory_date').limit(20);
  assertResult(pending.error);
  for (const session of pending.data ?? []) {
    await archivePaintTapeInventorySession(db, session.inventory_date, null, mappers, false);
  }
  const result = await db.rpc('purge_original_inventory_erp_snapshots', { p_cutoff_date: cutoff });
  assertResult(result.error);
  return result.data;
};
