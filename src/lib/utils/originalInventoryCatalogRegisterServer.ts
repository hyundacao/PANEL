import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  applyOriginalInventoryCatalogRegister, catalogRegisterIdentity, catalogRegisterBlockIdentity, createCatalogRegisterResolver,
  type CatalogRegisterItem, type CatalogRegisterState
} from './originalInventoryCatalogRegister';
import { normalizeOriginalInventoryCatalogCell, extractOriginalInventoryWarehouseCode } from './originalInventoryCatalog';
import { normalizeOriginalInventoryName } from './originalInventoryName';
import { assertOriginalInventoryImportIndices } from './originalInventoryIndex';

export const CATALOG_REGISTER_MODULE_ID = 'original-inventory-catalog-register';

export const readOriginalInventoryCatalogRegister = async (db: SupabaseClient) => {
  const { data, error } = await db.from('material_planning_state').select('state,revision')
    .eq('id', CATALOG_REGISTER_MODULE_ID).maybeSingle();
  if (error) throw error;
  const state = data?.state as CatalogRegisterState | undefined;
  if (state && (state.version !== 1 || !Array.isArray(state.items) || !Array.isArray(state.blocked))) {
    throw new Error('CATALOG_REGISTER_INVALID');
  }
  return { state: state ?? null, revision: Number(data?.revision ?? 0) };
};

export const saveOriginalInventoryCatalogRegister = async (
  db: SupabaseClient, state: CatalogRegisterState, revision: number, updatedBy: string
) => {
  const { data, error } = await db.rpc('save_material_planning_state', {
    p_module_id: CATALOG_REGISTER_MODULE_ID, p_state: state, p_expected_revision: revision, p_updated_by: updatedBy
  });
  if (error) throw error;
  const saved = Array.isArray(data) ? data[0] : null;
  if (saved?.has_conflict) return false;
  if (saved?.has_conflict !== false) throw new Error('SAVE_NOT_CONFIRMED');
  return true;
};

export const normalizeCatalogRegisterItem = (item: {
  name: string; unit: string; indexCode?: string | null; indexCode2?: string | null; warehouseCode?: string | null
}): CatalogRegisterItem => ({
  name: normalizeOriginalInventoryName(normalizeOriginalInventoryCatalogCell(item.name)),
  unit: normalizeOriginalInventoryCatalogCell(item.unit),
  indexCode: normalizeOriginalInventoryCatalogCell(item.indexCode),
  indexCode2: normalizeOriginalInventoryCatalogCell(item.indexCode2) || null,
  warehouseCode: extractOriginalInventoryWarehouseCode(item.indexCode)
});

const stableId = (item: CatalogRegisterItem) => {
  const hash = createHash('sha256').update(`catalog-register:${catalogRegisterIdentity(item)}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
};

const readCatalogRows = async (db: SupabaseClient) => {
  const rows: Array<{ id: string; name: string; unit: string; index_code: string | null; index_code2?: string | null; warehouse_code: string | null }> = [];
  for (let from = 0;; from += 1000) {
    const { data, error } = await db.from('original_inventory_catalog').select('*').order('id').range(from, from + 999);
    if (error) throw error;
    rows.push(...data ?? []);
    if ((data?.length ?? 0) < 1000) return rows;
  }
};

export const importOriginalInventoryCatalogRegister = async (
  db: SupabaseClient, imported: CatalogRegisterItem[], sourceFileName: string, updatedBy: string,
  seedBlocked?: CatalogRegisterItem[]
) => {
  assertOriginalInventoryImportIndices(imported);
  if (!imported.length || imported.some(row => !row.indexCode || !row.name || !row.unit)) throw new Error('CATALOG_REGISTER_INVALID');
  imported = [...new Map(imported.map(row => [catalogRegisterIdentity(row), row])).values()];
  const identities = new Map<string, Set<string>>();
  for (const row of imported) {
    const key = catalogRegisterBlockIdentity({ ...row, indexCode2: null });
    const group = identities.get(key) ?? new Set<string>();
    group.add(catalogRegisterIdentity(row));
    if (group.size > 1) throw new Error('CONFLICTING_INDEX_COLUMNS');
    identities.set(key, group);
  }
  const raw = await readCatalogRows(db);
  let added = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await readOriginalInventoryCatalogRegister(db);
    const blocked = seedBlocked ?? current.state?.blocked ?? [];
    const trial: CatalogRegisterState = { version: 1, items: imported, blocked, importedAt: new Date().toISOString(), sourceFileName };
    // Evaluate exclusions against the incoming active identities too: a reused number is not a global blacklist.
    const blockedKeys = new Set(blocked.map(catalogRegisterBlockIdentity));
    trial.items = imported.filter(row => !blockedKeys.has(catalogRegisterBlockIdentity(row)));
    const exclusions = createCatalogRegisterResolver(current.state ? { ...current.state, blocked } : trial);
    trial.items = trial.items.filter(row => !exclusions.isBlocked(row));
    const processed = trial.items.length;
    const skippedBlocked = imported.length - processed;
    const bucket = (row: CatalogRegisterItem) => JSON.stringify([row.indexCode.toUpperCase(), row.unit.toLowerCase().replace(/\.$/, '')]);
    const previous = new Map<string, CatalogRegisterItem[]>();
    for (const row of current.state?.items ?? []) previous.set(bucket(row), [...previous.get(bucket(row)) ?? [], row]);
    trial.items = trial.items.map(row => {
      const group = previous.get(bucket(row)) ?? [];
      const paired = group.filter(old => old.indexCode2 === row.indexCode2);
      const old = paired.length === 1 ? paired[0] : group.length === 1 ? group[0] : null;
      if (!old) return row;
      const previousNames = [...new Set([...old.previousNames ?? [], old.name])].filter(name => name !== row.name);
      return previousNames.length ? { ...row, previousNames } : row;
    });
    const replaced = new Set(trial.items.map(bucket));
    const exact = new Set(trial.items.map(catalogRegisterBlockIdentity));
    trial.items = [...current.state?.items.filter(row => !blockedKeys.has(catalogRegisterBlockIdentity(row)) &&
      (!replaced.has(bucket(row)) || ((previous.get(bucket(row))?.length ?? 0) > 1 && !exact.has(catalogRegisterBlockIdentity(row))))) ?? [], ...trial.items];
    const resolver = createCatalogRegisterResolver(trial);
    const mapped = raw.map(row => ({ id: row.id, name: row.name, unit: row.unit,
      indexCode: row.index_code, indexCode2: row.index_code2, warehouseCode: row.warehouse_code }));
    trial.blockedCatalogIds = mapped.filter(row => resolver.isBlocked(row)).map(row => row.id);
    trial.ambiguousCatalogIds = mapped.filter(row => !resolver.isBlocked(row) && resolver.hasRegisteredCode(row) && !resolver.resolve(row)).map(row => row.id);
    const represented = new Set(mapped.flatMap(row => {
      const match = resolver.resolve(row);
      return match ? [catalogRegisterIdentity(match)] : [];
    }));
    const missing = [...new Map(trial.items.filter(row => !represented.has(catalogRegisterIdentity(row)))
      .map(row => [catalogRegisterIdentity(row), row])).values()];
    for (let from = 0; from < missing.length; from += 250) {
      const batch = missing.slice(from, from + 250).map(row => ({ id: stableId(row), name: row.name, unit: row.unit,
        index_code: row.indexCode, warehouse_code: row.warehouseCode }));
      const { data, error } = await db.from('original_inventory_catalog')
        .upsert(batch, { onConflict: 'id', ignoreDuplicates: true }).select('*');
      if (error) throw error;
      added += data?.length ?? 0;
      raw.push(...data ?? []);
    }
    if (await saveOriginalInventoryCatalogRegister(db, trial, current.revision, updatedBy)) {
      const visible = applyOriginalInventoryCatalogRegister(raw.map(row => ({ id: row.id, name: row.name, unit: row.unit,
        indexCode: row.index_code, indexCode2: row.index_code2, warehouseCode: row.warehouse_code })), trial);
      return { added, linked: visible.filter(row => row.catalogIds?.length && row.catalogIds.length > 1).length,
        active: trial.items.length, processed, blocked: skippedBlocked, state: trial };
    }
  }
  throw new Error('REVISION_CONFLICT');
};

export const assertOriginalInventoryCatalogAllowed = async (
  db: SupabaseClient, item: { name: string; unit?: string; indexCode?: string | null; indexCode2?: string | null }
) => {
  const { state } = await readOriginalInventoryCatalogRegister(db);
  const resolver = createCatalogRegisterResolver(state);
  if (resolver.isBlocked(item)) throw new Error('CATALOG_BLOCKED');
  if (resolver.hasRegisteredCode(item) && !resolver.resolve(item)) throw new Error('CATALOG_AMBIGUOUS');
};

export const updateCatalogRegisterNamesFromSnapshot = async (
  db: SupabaseClient, items: Array<{ name: string; unit: string; indexCode?: string | null; indexCode2?: string | null }>
) => {
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await readOriginalInventoryCatalogRegister(db);
    if (!current.state) return;
    const resolver = createCatalogRegisterResolver(current.state);
    const updates = new Map<string, Set<string>>();
    for (const item of items) {
      const target = resolver.resolve(item);
      if (!target) continue;
      const key = catalogRegisterIdentity(target);
      updates.set(key, new Set([...updates.get(key) ?? [], normalizeOriginalInventoryName(item.name)]));
    }
    let changed = false;
    const next = current.state.items.map(row => {
      const names = updates.get(catalogRegisterIdentity(row));
      if (names?.size !== 1) return row;
      const name = [...names][0];
      if (!name || name === row.name) return row;
      changed = true;
      return { ...row, name, previousNames: [...new Set([...row.previousNames ?? [], row.name])] };
    });
    if (!changed) return;
    if (await saveOriginalInventoryCatalogRegister(db, { ...current.state, items: next }, current.revision, 'ERP catalog sync')) return;
  }
  throw new Error('REVISION_CONFLICT');
};
