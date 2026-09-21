import { NextRequest, NextResponse } from 'next/server';
import { canSeeTab, isReadOnly, isWarehouseAdmin } from '@/lib/auth/access';
import { validPalletSetsState } from '@/lib/planowanie-zapotrzebowania/palletSets';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { buildTechnologyPreviewProjection, TECHNOLOGY_PREVIEW_FIELD } from '@/lib/utils/productionTaskReference';
import {
  searchProductCatalog,
  type ProductCatalogItem,
  type ProductCatalogSearchMode
} from '@/lib/planowanie-zapotrzebowania/productCatalogSearch';
import { FIXED_INVENTORY_DEVICE_SOURCE_TYPE } from '@/lib/planowanie-zapotrzebowania/fixedInventoryDevices';
import {
  isSharedPlanningField,
  loadPlanningWorkspace,
  loadSharedPlanningSnapshot,
  savePlanningWorkspace,
  type PlanningRecord,
  type PlanningStore,
  type SharedPlanningField
} from '@/lib/planowanie-zapotrzebowania/stateScopes';

export const dynamic = 'force-dynamic';

const MODULE_KEY = 'main';
const PRODUCT_CATALOG_PAGE_SIZE = 1000;
const PRODUCT_CATALOG_PAGE_CONCURRENCY = 4;
const PRODUCT_CATALOG_CACHE_MS = 5 * 60 * 1000;
const PLANNING_STATE_CACHE_MS = 30 * 1000;

let productCatalogCache: { items: ProductCatalogItem[]; expiresAt: number } | null = null;
let productCatalogLoadPromise: Promise<ProductCatalogItem[]> | null = null;
let planningStateCache: (PlanningRecord & { expiresAt: number }) | null = null;
const workspacePreviewCache = new Map<string, { revision: number; projection: unknown }>();
const rememberWorkspacePreview = (id: string, revision: number, projection: unknown) => {
  if (workspacePreviewCache.size >= 32) workspacePreviewCache.delete(workspacePreviewCache.keys().next().value!);
  workspacePreviewCache.set(id, { revision, projection });
};

const cachedPlanningState = () => (
  planningStateCache && planningStateCache.expiresAt > Date.now() ? planningStateCache : null
);

const rememberPlanningState = (record: PlanningRecord) => {
  planningStateCache = { ...record, expiresAt: Date.now() + PLANNING_STATE_CACHE_MS };
  return record;
};

const readPlanningRecord = async (id: string): Promise<PlanningRecord> => {
  const { data, error } = await supabaseAdmin
    .from('material_planning_state')
    .select('state, updated_at, updated_by, revision')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  // Internal preview metadata must not participate in client autosave equality
  // or conflict recovery. It is rebuilt by the server in the same atomic save.
  const state = data?.state && typeof data.state === 'object' ? { ...data.state } : null;
  if (id.startsWith('workspace:')) rememberWorkspacePreview(id, Number(data?.revision ?? 0),
    state?.[TECHNOLOGY_PREVIEW_FIELD] ?? buildTechnologyPreviewProjection(state ?? {}, null, ''));
  if (state) delete state[TECHNOLOGY_PREVIEW_FIELD];
  return {
    state,
    updatedAt: data?.updated_at ?? null,
    updatedBy: data?.updated_by ?? null,
    revision: Number(data?.revision ?? 0)
  };
};

const savePlanningRecord = async (id: string, state: Record<string, unknown>, revision: number, updatedBy: string) => {
  let storedState = state;
  if (id.startsWith('workspace:')) {
    const cached = workspacePreviewCache.get(id);
    let projection: unknown = cached?.revision === revision ? cached.projection : null;
    if (!projection) {
      const previous = await supabaseAdmin.from('material_planning_state')
        .select(`preview:state->${TECHNOLOGY_PREVIEW_FIELD}`).eq('id', id).maybeSingle();
      if (previous.error) throw previous.error;
      projection = previous.data?.preview;
    }
    if (!projection) {
      // One-time compatibility read for plans saved before preview publication.
      // An unchanged old choice has no priority over a newer explicit change.
      const legacy = await supabaseAdmin.from('material_planning_state')
        .select('plan:state->plan,dailyPlans:state->dailyPlans,selectedPlanDate:state->selectedPlanDate')
        .eq('id', id).maybeSingle();
      if (legacy.error) throw legacy.error;
      projection = buildTechnologyPreviewProjection(legacy.data ?? {}, null, '');
    }
    storedState = { ...state, [TECHNOLOGY_PREVIEW_FIELD]: buildTechnologyPreviewProjection(state, projection, new Date().toISOString()) };
  }
  const { data, error } = await supabaseAdmin.rpc('save_material_planning_state', {
    p_module_id: id,
    p_state: storedState,
    p_expected_revision: revision,
    p_updated_by: updatedBy
  });
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] as { new_revision?: number; has_conflict?: boolean } | undefined : undefined;
  if (id.startsWith('workspace:')) {
    if (result?.has_conflict) workspacePreviewCache.delete(id);
    else if (result?.new_revision) rememberWorkspacePreview(id, result.new_revision, storedState[TECHNOLOGY_PREVIEW_FIELD]);
  }
  return { revision: Number(result?.new_revision ?? revision), conflict: result?.has_conflict === true };
};

const readPlanningRevision = async (id: string) => {
  const { data, error } = await supabaseAdmin.from('material_planning_state').select('revision').eq('id', id).maybeSingle();
  if (error) throw error;
  return Number(data?.revision ?? 0);
};

const planningStore: PlanningStore = { read: readPlanningRecord, save: savePlanningRecord, readRevision: readPlanningRevision };

const normalizeName = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[łŁ]/g, 'l')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const warsawDateKey = (value = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(value);

const queryProductCatalog = async (): Promise<ProductCatalogItem[]> => {
  const rows: Array<{ id: string; name: string; index_code: string | null; warehouse_code: string | null; unit: string | null }> = [];
  const fields = 'id, name, index_code, warehouse_code, unit';
  const firstResult = await supabaseAdmin
    .from('original_inventory_catalog')
    .select(fields, { count: 'exact' })
    .order('name', { ascending: true })
    .range(0, PRODUCT_CATALOG_PAGE_SIZE - 1);
  if (firstResult.error) throw firstResult.error;
  rows.push(...(firstResult.data ?? []));

  const total = firstResult.count;
  if (total === null) {
    for (let from = PRODUCT_CATALOG_PAGE_SIZE; rows.length === from; from += PRODUCT_CATALOG_PAGE_SIZE) {
      const { data, error } = await supabaseAdmin
        .from('original_inventory_catalog')
        .select(fields)
        .order('name', { ascending: true })
        .range(from, from + PRODUCT_CATALOG_PAGE_SIZE - 1);
      if (error) throw error;
      rows.push(...(data ?? []));
    }
  } else {
    const pageCount = Math.ceil(total / PRODUCT_CATALOG_PAGE_SIZE);
    for (let firstPage = 1; firstPage < pageCount; firstPage += PRODUCT_CATALOG_PAGE_CONCURRENCY) {
      const pages = await Promise.all(Array.from(
        { length: Math.min(PRODUCT_CATALOG_PAGE_CONCURRENCY, pageCount - firstPage) },
        async (_, offset) => {
          const from = (firstPage + offset) * PRODUCT_CATALOG_PAGE_SIZE;
          const { data, error } = await supabaseAdmin
            .from('original_inventory_catalog')
            .select(fields)
            .order('name', { ascending: true })
            .range(from, from + PRODUCT_CATALOG_PAGE_SIZE - 1);
          if (error) throw error;
          return data ?? [];
        }
      ));
      pages.forEach((page) => rows.push(...page));
    }
  }

  const unique = new Map<string, ProductCatalogItem>();
  rows.forEach((row) => {
    const name = String(row.name ?? '').replace(/\s+/g, ' ').trim();
    const index = String(row.index_code ?? '').replace(/\s+/g, ' ').trim();
    const warehouseCode = String(row.warehouse_code ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
    const unit = String(row.unit ?? '').replace(/\s+/g, ' ').trim();
    if (!name) return;
    const key = `${normalizeName(name)}|${normalizeName(warehouseCode)}`;
    const next = { id: String(row.id), name, index, warehouseCode, unit };
    const current = unique.get(key);
    const score = (item: ProductCatalogItem) => (item.warehouseCode ? 4 : 0) + (item.index ? 2 : 0) + (item.unit ? 1 : 0);
    if (!current || score(next) > score(current)) unique.set(key, next);
  });

  const values = [...unique.values()];
  const namesWithWarehouseVariant = new Set(
    values.filter((item) => Boolean(item.warehouseCode)).map((item) => normalizeName(item.name))
  );

  return values.filter(
    (item) => Boolean(item.warehouseCode) || !namesWithWarehouseVariant.has(normalizeName(item.name))
  );
};

const loadProductCatalog = async () => {
  if (productCatalogCache && productCatalogCache.expiresAt > Date.now()) {
    return productCatalogCache.items;
  }
  if (!productCatalogLoadPromise) productCatalogLoadPromise = queryProductCatalog();
  try {
    const items = await productCatalogLoadPromise;
    productCatalogCache = { items, expiresAt: Date.now() + PRODUCT_CATALOG_CACHE_MS };
    return items;
  } finally {
    productCatalogLoadPromise = null;
  }
};

const inventoryAreaId = (warehouseId: unknown, warehouseName: unknown, sourceType: unknown) => {
  if (String(sourceType ?? '').toUpperCase() === 'SILO') return 'silosy';
  const id = normalizeName(warehouseId);
  const name = normalizeName(warehouseName);
  if (id === 'hall-1' || name === 'hala 1') return 'hala-1';
  if (id === 'hall-2' || name === 'hala 2') return 'hala-2';
  if (id === 'bakoma' || name.includes('bakoma')) return 'bakoma';
  if (id === 'lakiernia' || name.includes('lakiernia')) return 'lakiernia';
  return '';
};

const loadOriginalInventory = async (dateKey: string) => {
  const requestedDate = /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey : warsawDateKey();
  const center = new Date(`${requestedDate}T12:00:00.000Z`);
  const from = new Date(center.getTime() - 36 * 60 * 60 * 1000).toISOString();
  const to = new Date(center.getTime() + 36 * 60 * 60 * 1000).toISOString();
  const [{ data: warehouses, error: warehouseError }, { data: entries, error: entryError }, { data: catalog, error: catalogError }] = await Promise.all([
    supabaseAdmin.from('warehouses').select('id, name').eq('is_active', true),
    supabaseAdmin.from('original_inventory_entries').select('id, at, warehouse_id, name, qty, unit, source_type').gte('at', from).lte('at', to),
    supabaseAdmin.from('original_inventory_catalog').select('name, index_code, warehouse_code')
  ]);
  if (warehouseError) throw warehouseError;
  if (entryError) throw entryError;
  if (catalogError) throw catalogError;
  const warehouseNames = new Map((warehouses ?? []).map((row) => [String(row.id), String(row.name ?? '')]));
  const catalogCodes = new Map<string, { code: string; warehouseCode: string }>();
  (catalog ?? []).forEach((row) => {
    const key = normalizeName(row.name);
    const code = String(row.index_code ?? '').trim();
    const warehouseCode = String(row.warehouse_code ?? '').trim().toUpperCase();
    if (!key || !code) return;
    const current = catalogCodes.get(key);
    if (!current || (!current.warehouseCode && warehouseCode)) catalogCodes.set(key, { code, warehouseCode });
  });
  const grouped = new Map<string, { id: string; areaId: string; code: string; name: string; qty: number; protectedQty: number; unit: string }>();
  (entries ?? []).forEach((row) => {
    const at = new Date(String(row.at));
    if (!Number.isFinite(at.getTime()) || warsawDateKey(at) !== requestedDate) return;
    const areaId = inventoryAreaId(row.warehouse_id, warehouseNames.get(String(row.warehouse_id)), row.source_type);
    if (!areaId) return;
    const name = String(row.name ?? '').trim();
    const code = catalogCodes.get(normalizeName(name))?.code ?? '';
    const unit = String(row.unit ?? '').trim() || 'kg';
    const key = `${areaId}|${normalizeName(code || name)}|${normalizeName(unit)}`;
    const current = grouped.get(key);
    const qty = Number(row.qty ?? 0);
    const protectedQty = String(row.source_type ?? '').toUpperCase() === FIXED_INVENTORY_DEVICE_SOURCE_TYPE ? qty : 0;
    if (current) {
      current.qty += qty;
      current.protectedQty += protectedQty;
    } else {
      grouped.set(key, { id: `original-${String(row.id)}`, areaId, code, name, qty, protectedQty, unit });
    }
  });
  return {
    dateKey: requestedDate,
    syncedAt: new Date().toISOString(),
    rows: [...grouped.values()].sort((left, right) => left.areaId.localeCompare(right.areaId) || left.name.localeCompare(right.name, 'pl'))
  };
};

const unauthorized = (code: string) => NextResponse.json({ code }, { status: 401 });

const ensureAccess = async (request: NextRequest, write = false) => {
  const auth = await getAuthenticatedUser(request);
  if (!auth.user) return { user: null, response: unauthorized(auth.code ?? 'UNAUTHORIZED') };
  if (!canSeeTab(auth.user, 'PLANOWANIE_ZAPOTRZEBOWANIA', 'planowanie-zapotrzebowania')) {
    return { user: null, response: NextResponse.json({ code: 'FORBIDDEN' }, { status: 403 }) };
  }
  if (write && isReadOnly(auth.user, 'PLANOWANIE_ZAPOTRZEBOWANIA')) {
    return { user: null, response: NextResponse.json({ code: 'READ_ONLY' }, { status: 403 }) };
  }
  return { user: auth.user, response: null };
};

export async function GET(request: NextRequest) {
  const access = await ensureAccess(request);
  if (access.response) return access.response;
  const source = request.nextUrl.searchParams.get('source');
  if (source === 'shared') {
    const revision = request.nextUrl.searchParams.get('sharedRevision');
    const knownRevision = revision !== null && /^\d+$/.test(revision) ? Number(revision) : null;
    try {
      return NextResponse.json(await loadSharedPlanningSnapshot(planningStore, knownRevision));
    } catch {
      return NextResponse.json({ code: 'LOAD_FAILED' }, { status: 503 });
    }
  }
  if (source === 'product-catalog') {
    try {
      const query = request.nextUrl.searchParams.get('query')?.slice(0, 160) ?? '';
      const requestedMode = request.nextUrl.searchParams.get('mode');
      const allowedModes = new Set<ProductCatalogSearchMode>([
        'product-name',
        'product-index',
        'material-name',
        'material-code'
      ]);
      if (!requestedMode || !allowedModes.has(requestedMode as ProductCatalogSearchMode)) {
        return NextResponse.json({ code: 'INVALID_PRODUCT_CATALOG_SEARCH_MODE' }, { status: 400 });
      }
      const requestedLimit = Number(request.nextUrl.searchParams.get('limit') ?? 12);
      const mode = requestedMode as ProductCatalogSearchMode;
      const items = query.trim()
        ? searchProductCatalog(await loadProductCatalog(), query, mode, requestedLimit)
        : [];
      return NextResponse.json({ items });
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
      return NextResponse.json({ code: 'PRODUCT_CATALOG_LOAD_FAILED', detail }, { status: 500 });
    }
  }
  if (source === 'original-inventory') {
    try {
      return NextResponse.json(await loadOriginalInventory(request.nextUrl.searchParams.get('date') ?? ''));
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
      return NextResponse.json({ code: 'ORIGINAL_INVENTORY_LOAD_FAILED', detail }, { status: 500 });
    }
  }
  if (source === 'fixed-devices') {
    const cached = cachedPlanningState();
    if (cached) {
      const state = cached.state && typeof cached.state === 'object'
        ? cached.state as { fixedDevices?: unknown }
        : null;
      return NextResponse.json({ items: state?.fixedDevices ?? [] });
    }
    const { data, error } = await supabaseAdmin
      .from('material_planning_state')
      .select('fixed_devices:state->fixedDevices')
      .eq('id', MODULE_KEY)
      .maybeSingle();
    if (error) return NextResponse.json({ code: 'LOAD_FAILED', detail: error.message }, { status: 500 });
    const row = data as unknown as { fixed_devices?: unknown } | null;
    return NextResponse.json({ items: row?.fixed_devices ?? [] });
  }

  const revisionParam = request.nextUrl.searchParams.get('revision');
  const sharedRevisionParam = request.nextUrl.searchParams.get('sharedRevision');
  const requestedRevision = revisionParam !== null && /^\d+$/.test(revisionParam) ? Number(revisionParam) : null;
  const requestedSharedRevision = sharedRevisionParam !== null && /^\d+$/.test(sharedRevisionParam)
    ? Number(sharedRevisionParam) : null;
  try {
    const loaded = await loadPlanningWorkspace(planningStore, access.user!.id);
    rememberPlanningState(loaded.shared);
    if (requestedRevision === loaded.revision && requestedSharedRevision === loaded.sharedRevision) {
      return NextResponse.json({ unchanged: true, revision: loaded.revision, sharedRevision: loaded.sharedRevision });
    }
    return NextResponse.json({
      state: loaded.state,
      revision: loaded.revision,
      sharedRevision: loaded.sharedRevision,
      updatedAt: loaded.updatedAt,
      updatedBy: loaded.updatedBy
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'LOAD_FAILED';
    return NextResponse.json({ code: 'MIGRATION_REQUIRED', detail }, { status: 503 });
  }
}

export async function PUT(request: NextRequest) {
  const access = await ensureAccess(request, true);
  if (access.response || !access.user) return access.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: 'INVALID_JSON' }, { status: 400 });
  }
  const payload = body && typeof body === 'object' ? body as {
    state?: unknown;
    expectedRevision?: unknown;
    expectedSharedRevision?: unknown;
    changedSharedFields?: unknown;
    documentBaseline?: unknown;
    sharedBaseline?: unknown;
  } : {};
  const state = payload.state;
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return NextResponse.json({ code: 'INVALID_STATE' }, { status: 400 });
  }
  const expectedRevision = Number(payload.expectedRevision ?? 0);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    return NextResponse.json({ code: 'INVALID_REVISION' }, { status: 400 });
  }
  if (payload.sharedBaseline !== undefined && (!payload.sharedBaseline ||
    typeof payload.sharedBaseline !== 'object' || Array.isArray(payload.sharedBaseline))) {
    return NextResponse.json({ code: 'INVALID_SHARED_BASELINE' }, { status: 400 });
  }
  const changedFields = payload.changedSharedFields ?? [];
  if (!Array.isArray(changedFields) || changedFields.some((field) => typeof field !== 'string' || !isSharedPlanningField(field)) ||
    new Set(changedFields).size !== changedFields.length) {
    return NextResponse.json({ code: 'INVALID_SHARED_FIELDS' }, { status: 400 });
  }
  const expectedSharedRevision = Number(payload.expectedSharedRevision);
  if (changedFields.includes('palletSets')) {
    if (!isWarehouseAdmin(access.user, 'PLANOWANIE_ZAPOTRZEBOWANIA')) {
      return NextResponse.json({ code: 'FORBIDDEN' }, { status: 403 });
    }
    if (!validPalletSetsState((state as Record<string, unknown>).palletSets)) {
      return NextResponse.json({ code: 'INVALID_PALLET_SETS' }, { status: 400 });
    }
  }
  if (changedFields.length && (!Number.isSafeInteger(expectedSharedRevision) || expectedSharedRevision < 0)) {
    return NextResponse.json({ code: 'INVALID_SHARED_REVISION' }, { status: 400 });
  }
  const updatedBy = access.user.username ?? access.user.name;
  try {
    const result = await savePlanningWorkspace(
      planningStore, access.user.id, state as Record<string, unknown>,
      expectedRevision, expectedSharedRevision, changedFields as SharedPlanningField[],
      payload.documentBaseline, updatedBy, payload.sharedBaseline as Record<string, unknown> | undefined
    );
    if (!result.ok) {
      return NextResponse.json(result, { status: result.code.startsWith('INVALID_') ? 400 : 409 });
    }
    if (result.sharedSaved) rememberPlanningState(result.sharedSaved);
    return NextResponse.json({ ok: true, revision: result.revision, sharedRevision: result.sharedRevision, updatedAt: new Date().toISOString() });
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error && error.code === 'PGRST202'
      ? 'CONCURRENCY_MIGRATION_REQUIRED' : 'SAVE_FAILED';
    return NextResponse.json({ code, detail: error instanceof Error ? error.message : 'SAVE_FAILED' }, { status: code === 'CONCURRENCY_MIGRATION_REQUIRED' ? 503 : 500 });
  }
}
