import { NextRequest, NextResponse } from 'next/server';
import { canSeeTab, isReadOnly } from '@/lib/auth/access';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const MODULE_KEY = 'main';
const PRODUCT_CATALOG_PAGE_SIZE = 1000;
const PRODUCT_CATALOG_CACHE_MS = 5 * 60 * 1000;

type ProductCatalogItem = { id: string; name: string; index: string; warehouseCode: string; unit: string };

let productCatalogCache: { items: ProductCatalogItem[]; expiresAt: number } | null = null;
let productCatalogLoadPromise: Promise<ProductCatalogItem[]> | null = null;

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
  for (let from = 0; ; from += PRODUCT_CATALOG_PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from('original_inventory_catalog')
      .select('id, name, index_code, warehouse_code, unit')
      .order('name', { ascending: true })
      .range(from, from + PRODUCT_CATALOG_PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PRODUCT_CATALOG_PAGE_SIZE) break;
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
  const grouped = new Map<string, { id: string; areaId: string; code: string; name: string; qty: number; unit: string }>();
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
    if (current) {
      current.qty += Number(row.qty ?? 0);
    } else {
      grouped.set(key, { id: `original-${String(row.id)}`, areaId, code, name, qty: Number(row.qty ?? 0), unit });
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
  if (request.nextUrl.searchParams.get('source') === 'product-catalog') {
    try {
      return NextResponse.json({ items: await loadProductCatalog() });
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
      return NextResponse.json({ code: 'PRODUCT_CATALOG_LOAD_FAILED', detail }, { status: 500 });
    }
  }
  if (request.nextUrl.searchParams.get('source') === 'original-inventory') {
    try {
      return NextResponse.json(await loadOriginalInventory(request.nextUrl.searchParams.get('date') ?? ''));
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
      return NextResponse.json({ code: 'ORIGINAL_INVENTORY_LOAD_FAILED', detail }, { status: 500 });
    }
  }
  const withRevision = await supabaseAdmin
    .from('material_planning_state')
    .select('state, updated_at, updated_by, revision')
    .eq('id', MODULE_KEY)
    .maybeSingle();
  if (!withRevision.error) {
    return NextResponse.json({
      state: withRevision.data?.state ?? null,
      updatedAt: withRevision.data?.updated_at ?? null,
      updatedBy: withRevision.data?.updated_by ?? null,
      revision: Number(withRevision.data?.revision ?? 0)
    });
  }
  const legacy = await supabaseAdmin.from('material_planning_state').select('state, updated_at, updated_by').eq('id', MODULE_KEY).maybeSingle();
  if (legacy.error) return NextResponse.json({ code: 'MIGRATION_REQUIRED', detail: legacy.error.message }, { status: 503 });
  return NextResponse.json({
    state: legacy.data?.state ?? null,
    updatedAt: legacy.data?.updated_at ?? null,
    updatedBy: legacy.data?.updated_by ?? null,
    revision: 0,
    concurrencyMigrationRequired: true
  });
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
  return NextResponse.json({ ok: true, revision, updatedAt: new Date().toISOString() });
}
