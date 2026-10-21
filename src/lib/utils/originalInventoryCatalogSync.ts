import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OriginalInventoryCatalogSyncResult } from '@/lib/api/types';
import { normalizeOriginalInventoryName, normalizeOriginalInventoryNameKey } from './originalInventoryName';

type Item = { id?: string; name: string; unit: string; indexCode?: string | null; warehouseCode?: string | null; catalogIssue?: string };
type CatalogRow = { id: string; name: string; unit: string; index_code: string | null; warehouse_code: string | null };
const clean = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();
const indexKey = (value: unknown) => clean(value).replace(/\s*([-\/])\s*/g, '$1').replace(/^M\s*-?\s*(\d+)/i, 'M-$1').toUpperCase();
const warehouseKey = (item: Item) => {
  const raw = indexKey(item.warehouseCode || item.indexCode);
  return raw.match(/^M-\d+(?=-|$)/)?.[0] ?? '';
};
const identity = (item: Item) => indexKey(item.indexCode);
const unitKey = (unit: string) => {
  const value = clean(unit).toLowerCase().replace(/\.$/, '');
  if (/^(szt|sztuka|sztuki|sztuk|pc|pcs|piece|pieces)$/.test(value)) return 'szt';
  if (/^(l|ltr|litr|litry|liter)$/.test(value)) return 'l';
  return value;
};
const sameDescription = (left: Item, right: Item) =>
  normalizeOriginalInventoryNameKey(left.name) === normalizeOriginalInventoryNameKey(right.name) && unitKey(left.unit) === unitKey(right.unit);
const fromRow = (row: CatalogRow): Item => ({ id: row.id, name: row.name, unit: row.unit, indexCode: row.index_code, warehouseCode: row.warehouse_code });

// Stable primary keys prevent duplicate inserts during concurrent imports.
const catalogId = (key: string) => {
  const hash = createHash('sha256').update(`original-inventory-erp-catalog:${key}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
};

/** Enriches the permanent catalog only. Failure must never undo or reject imported stock. */
export async function syncOriginalInventoryCatalogFromSnapshot(
  db: SupabaseClient,
  items: readonly Item[]
): Promise<OriginalInventoryCatalogSyncResult> {
  const result: OriginalInventoryCatalogSyncResult = { added: 0, updated: 0, existing: 0, failed: false, warningCount: 0, warnings: [] };
  const warn = (item: Item | null, reason: string) => {
    result.warningCount++;
    if (result.warnings.length < 50) result.warnings.push({ name: item?.name ?? '', indexCode: item?.indexCode ?? '', reason });
  };
  const groups = new Map<string, Item[]>();
  for (const raw of items) {
    const item = { ...raw, name: normalizeOriginalInventoryName(raw.name), unit: clean(raw.unit), indexCode: indexKey(raw.indexCode), warehouseCode: warehouseKey(raw) || null };
    if (item.catalogIssue) {
      warn(item, item.catalogIssue);
      continue;
    }
    if (!item.indexCode || !item.name || !/[\p{L}]/u.test(item.unit)) {
      warn(item, 'Brak indeksu, nazwy lub jednostki — nie dodano kartoteki.');
      continue;
    }
    const group = groups.get(identity(item)) ?? [];
    group.push(item);
    groups.set(identity(item), group);
  }
  const candidates: Item[] = [];
  for (const group of groups.values()) {
    if (group.some((item) => !sameDescription(group[0], item))) {
      warn(group[0], 'Ten sam indeks ma różne nazwy lub jednostki w pliku — kartoteka wymaga sprawdzenia.');
    } else candidates.push(group[0]);
  }
  if (!candidates.length) return result;

  // One paged comparison and bulk inserts, not one database request per material.
  const signal = AbortSignal.timeout(10_000);
  const readCatalog = async () => {
    const known = new Map<string, Item[]>();
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await db.from('original_inventory_catalog')
        .select('id,name,unit,index_code,warehouse_code').order('id').range(offset, offset + 999).abortSignal(signal);
      if (error) throw error;
      const rows = (data ?? []) as CatalogRow[];
      for (const row of rows) {
        const item = fromRow(row);
        if (!indexKey(item.indexCode)) continue;
        const group = known.get(identity(item)) ?? [];
        group.push(item);
        known.set(identity(item), group);
      }
      if (rows.length < 1000) return known;
    }
  };
  const pendingOnly = async (batch: Item[], known: Map<string, Item[]>) => {
    const pending: Item[] = [];
    const renames: Array<{ item: Item; current: Item }> = [];
    for (const item of batch) {
      const matches = known.get(identity(item));
      if (!matches) { pending.push(item); continue; }
      if (matches.every((match) => sameDescription(item, match))) { result.existing++; continue; }
      if (matches.some((match) => unitKey(match.unit) !== unitKey(item.unit))) {
        warn(item, 'Indeks ma inną jednostkę — nie zmieniono kartoteki ani przeliczników.');
      } else if (matches.length !== 1) {
        warn(item, 'Indeks ma kilka kartotek — nie wybrano automatycznie rekordu do zmiany nazwy.');
      } else renames.push({ item, current: matches[0] });
    }
    for (let offset = 0; offset < renames.length; offset += 500) {
      const chunk = renames.slice(offset, offset + 500);
      const { data, error } = await db.rpc('rename_original_inventory_catalog_items', {
        p_changes: chunk.map(({ item, current }) => ({
          id: current.id, name: item.name, previousName: current.name, indexCode: current.indexCode
        }))
      }).abortSignal(signal);
      if (error) {
        result.failed = true;
        warn(null, error.code === 'PGRST202' || error.code === '42883'
          ? 'Aktualizacja nazw wymaga uruchomienia pliku 04_spis_rzeczywisty_i_stany_erp.sql. Dotychczasowe nazwy i spisy pozostawiono bez zmian.'
          : 'Nie udało się zaktualizować nazw kartotek. Ponów import; zapisane ilości nie zostały zmienione.');
        break;
      }
      const updated = new Set((data ?? []).filter((row: { updated: boolean }) => row.updated).map((row: { id: string }) => row.id));
      result.updated += updated.size;
      chunk.filter(({ current }) => !updated.has(current.id!)).forEach(({ item }) =>
        warn(item, 'Kartoteka zmieniła się w trakcie importu albo nazwa jest zajęta. Ponów import, aby sprawdzić aktualny zapis.'));
    }
    return pending;
  };
  try {
    const pending = await pendingOnly(candidates, await readCatalog());
    for (let offset = 0; offset < pending.length; offset += 500) {
      let batch = pending.slice(offset, offset + 500);
      for (let attempt = 0; attempt < 2 && batch.length; attempt++) {
        const rows = batch.map((item) => ({
          id: catalogId(identity(item)), name: item.name, unit: item.unit,
          index_code: item.indexCode, warehouse_code: item.warehouseCode
        }));
        const { data, error } = await db.from('original_inventory_catalog')
          .upsert(rows, { onConflict: 'id', ignoreDuplicates: true }).select('id').abortSignal(signal);
        if (error?.code === '23505' && attempt === 0) {
          // A separate catalog import may have won the race with a different UUID.
          batch = await pendingOnly(batch, await readCatalog());
          continue;
        }
        if (error) throw error;
        const inserted = new Set((data ?? []).map((row: { id: string }) => row.id));
        result.added += inserted.size;
        const raced = batch.filter((item) => !inserted.has(catalogId(identity(item))));
        if (raced.length) await pendingOnly(raced, await readCatalog());
        break;
      }
    }
  } catch {
    result.failed = true;
    warn(null, 'Stany ERP zostały wgrane, ale nie udało się dopisać wszystkich kartotek. Ponowny import ponowi próbę bez tworzenia duplikatów.');
  }
  return result;
}
