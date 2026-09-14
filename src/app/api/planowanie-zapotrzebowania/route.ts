import { NextRequest, NextResponse } from 'next/server';
import { canSeeTab, isReadOnly } from '@/lib/auth/access';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  searchProductCatalog,
  type ProductCatalogItem,
  type ProductCatalogSearchMode
} from '@/lib/planowanie-zapotrzebowania/productCatalogSearch';
import { FIXED_INVENTORY_DEVICE_SOURCE_TYPE } from '@/lib/planowanie-zapotrzebowania/fixedInventoryDevices';

export const dynamic = 'force-dynamic';

const MODULE_KEY = 'main';
const PRODUCT_CATALOG_PAGE_SIZE = 1000;
const PRODUCT_CATALOG_PAGE_CONCURRENCY = 4;
const PRODUCT_CATALOG_CACHE_MS = 5 * 60 * 1000;
const PLANNING_STATE_CACHE_MS = 30 * 1000;

let productCatalogCache: { items: ProductCatalogItem[]; expiresAt: number } | null = null;
let productCatalogLoadPromise: Promise<ProductCatalogItem[]> | null = null;
type PlanningStateRecord = {
  state: unknown;
  updatedAt: string | null;
  updatedBy: string | null;
  revision: number;
  concurrencyMigrationRequired?: boolean;
};
let planningStateCache: (PlanningStateRecord & { expiresAt: number }) | null = null;

const cachedPlanningState = () => (
  planningStateCache && planningStateCache.expiresAt > Date.now() ? planningStateCache : null
);

const rememberPlanningState = (record: PlanningStateRecord) => {
  planningStateCache = { ...record, expiresAt: Date.now() + PLANNING_STATE_CACHE_MS };
  return record;
};

const planningStateResponse = (record: PlanningStateRecord, requestedRevision: number | null) => {
  if (requestedRevision !== null && requestedRevision === record.revision) {
    return NextResponse.json({ unchanged: true, revision: record.revision });
  }
  return NextResponse.json({
    state: record.state,
    updatedAt: record.updatedAt,
    updatedBy: record.updatedBy,
    revision: record.revision,
    ...(record.concurrencyMigrationRequired ? { concurrencyMigrationRequired: true } : {})
  });
};

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

  const requestedRevisionValue = request.nextUrl.searchParams.get('revision');
  const parsedRequestedRevision = requestedRevisionValue === null ? NaN : Number(requestedRevisionValue);
  const requestedRevision = Number.isSafeInteger(parsedRequestedRevision) && parsedRequestedRevision >= 0
    ? parsedRequestedRevision
    : null;
  const cached = cachedPlanningState();
  if (cached) return planningStateResponse(cached, requestedRevision);

  if (requestedRevision !== null) {
    const revisionOnly = await supabaseAdmin
      .from('material_planning_state')
      .select('revision')
      .eq('id', MODULE_KEY)
      .maybeSingle();
    if (!revisionOnly.error && Number(revisionOnly.data?.revision ?? 0) === requestedRevision) {
      return NextResponse.json({ unchanged: true, revision: requestedRevision });
    }
  }

  const withRevision = await supabaseAdmin
    .from('material_planning_state')
    .select('state, updated_at, updated_by, revision')
    .eq('id', MODULE_KEY)
    .maybeSingle();
  if (!withRevision.error) {
    return planningStateResponse(rememberPlanningState({
      state: withRevision.data?.state ?? null,
      updatedAt: withRevision.data?.updated_at ?? null,
      updatedBy: withRevision.data?.updated_by ?? null,
      revision: Number(withRevision.data?.revision ?? 0)
    }), requestedRevision);
  }
  const legacy = await supabaseAdmin.from('material_planning_state').select('state, updated_at, updated_by').eq('id', MODULE_KEY).maybeSingle();
  if (legacy.error) return NextResponse.json({ code: 'MIGRATION_REQUIRED', detail: legacy.error.message }, { status: 503 });
  return planningStateResponse(rememberPlanningState({
    state: legacy.data?.state ?? null,
    updatedAt: legacy.data?.updated_at ?? null,
    updatedBy: legacy.data?.updated_by ?? null,
    revision: 0,
    concurrencyMigrationRequired: true
  }), requestedRevision);
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
  const payload = body && typeof body === 'object' ? body as { state?: unknown; expectedRevision?: unknown } : {};
  const state = payload.state;
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return NextResponse.json({ code: 'INVALID_STATE' }, { status: 400 });
  }
  const expectedRevision = Number(payload.expectedRevision ?? 0);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    return NextResponse.json({ code: 'INVALID_REVISION' }, { status: 400 });
  }
  const updatedBy = access.user.username ?? access.user.name;
  const { data, error } = await supabaseAdmin.rpc('save_material_planning_state', {
    p_module_id: MODULE_KEY,
    p_state: state,
    p_expected_revision: expectedRevision,
    p_updated_by: updatedBy
  });
  if (error) {
    return NextResponse.json({
      code: error.code === 'PGRST202' ? 'CONCURRENCY_MIGRATION_REQUIRED' : 'SAVE_FAILED',
      detail: error.message
    }, { status: error.code === 'PGRST202' ? 503 : 500 });
  }
  const result = Array.isArray(data) ? data[0] as { new_revision?: number; has_conflict?: boolean } | undefined : undefined;
  const revision = Number(result?.new_revision ?? expectedRevision);
  if (result?.has_conflict) {
    return NextResponse.json({ code: 'REVISION_CONFLICT', revision }, { status: 409 });
  }
  const updatedAt = new Date().toISOString();
  rememberPlanningState({ state, updatedAt, updatedBy, revision });
  return NextResponse.json({ ok: true, revision, updatedAt });
}
