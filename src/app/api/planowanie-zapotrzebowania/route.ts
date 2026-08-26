import { NextRequest, NextResponse } from 'next/server';
import { canSeeTab, isReadOnly } from '@/lib/auth/access';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const MODULE_KEY = 'main';
const PRODUCT_CATALOG_PAGE_SIZE = 1000;

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

const loadProductCatalog = async () => {
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

  type CatalogItem = { id: string; name: string; index: string; warehouseCode: string; unit: string };
  const unique = new Map<string, CatalogItem>();
  rows.forEach((row) => {
    const name = String(row.name ?? '').replace(/\s+/g, ' ').trim();
    const index = String(row.index_code ?? '').replace(/\s+/g, ' ').trim();
    const warehouseCode = String(row.warehouse_code ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
    const unit = String(row.unit ?? '').replace(/\s+/g, ' ').trim();
    if (!name) return;
    const key = `${normalizeName(name)}|${normalizeName(warehouseCode)}`;
    const next = { id: String(row.id), name, index, warehouseCode, unit };
    const current = unique.get(key);
    const score = (item: CatalogItem) => (item.warehouseCode ? 4 : 0) + (item.index ? 2 : 0) + (item.unit ? 1 : 0);
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
  const { data, error } = await supabaseAdmin
    .from('material_planning_state')
    .select('state, updated_at, updated_by')
    .eq('id', MODULE_KEY)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ code: 'MIGRATION_REQUIRED', detail: error.message }, { status: 503 });
  }
  return NextResponse.json({ state: data?.state ?? null, updatedAt: data?.updated_at ?? null, updatedBy: data?.updated_by ?? null });
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
  const state = body && typeof body === 'object' ? (body as { state?: unknown }).state : null;
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return NextResponse.json({ code: 'INVALID_STATE' }, { status: 400 });
  }
  const updatedAt = new Date().toISOString();
  const { error } = await supabaseAdmin.from('material_planning_state').upsert({
    id: MODULE_KEY,
    state,
    updated_at: updatedAt,
    updated_by: access.user.name
  }, { onConflict: 'id' });
  if (error) {
    return NextResponse.json({ code: 'SAVE_FAILED', detail: error.message }, { status: 500 });
  }
  await supabaseAdmin.from('material_planning_events').insert({
    event_type: 'STATE_SAVED',
    event_data: {
      planName: String((state as Record<string, unknown>).planName ?? ''),
      planSheet: String((state as Record<string, unknown>).planSheet ?? '')
    },
    created_by: access.user.name
  });
  return NextResponse.json({ ok: true, updatedAt });
}
