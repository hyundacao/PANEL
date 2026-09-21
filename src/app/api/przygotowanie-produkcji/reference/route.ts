import { NextRequest, NextResponse } from 'next/server';
import { canSeeTab } from '@/lib/auth/access';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { buildSelectedTaskTechnologyReference, buildTechnologyPreviewProjection, TECHNOLOGY_PREVIEW_FIELD } from '@/lib/utils/productionTaskReference';

export const dynamic = 'force-dynamic';

type ReferenceField = 'stationMappings' | 'technologies';
const cache: Partial<Record<ReferenceField, { value: unknown; expires: number }>> = {};
const pending: Partial<Record<ReferenceField, Promise<unknown>>> = {};
const loadReferenceField = async (field: ReferenceField) => {
  const cached = cache[field];
  if (cached && cached.expires > Date.now()) return cached.value;
  if (!pending[field]) pending[field] = (async () => {
    const { data, error } = await supabaseAdmin.from('material_planning_state')
      .select(`value:state->${field}`).eq('id', 'main').maybeSingle();
    if (error) throw error;
    const value: unknown = data?.value ?? [];
    cache[field] = { value, expires: Date.now() + 30_000 };
    return value;
  })();
  try { return await pending[field]; } finally { delete pending[field]; }
};

const selectionsCache = new Map<string, { value: unknown[]; expires: number }>();
const selectionsPending = new Map<string, Promise<unknown[]>>();
type LegacyPlanRow = { plan: unknown; selectedPlanDate: unknown; day: unknown };
const legacySelectionsCache = new Map<string, { revision: number; selections: unknown[] }>();
const loadSelections = async (date: string) => {
  const cached = selectionsCache.get(date);
  if (cached && cached.expires > Date.now()) return cached.value;
  if (!selectionsPending.has(date)) selectionsPending.set(date, (async () => {
    const selections: unknown[] = [];
    let workspaceCount = 0;
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await supabaseAdmin.from('material_planning_state')
        .select(`id,revision,preview:state->${TECHNOLOGY_PREVIEW_FIELD}->days->"${date}",version:state->${TECHNOLOGY_PREVIEW_FIELD}->version`)
        .like('id', 'workspace:%').order('id').range(offset, offset + 499);
      if (error) throw error;
      const rows = (data ?? []) as unknown as { id: string; revision: number; preview: unknown; version: unknown }[];
      workspaceCount += rows.length;
      for (const row of rows) if (Array.isArray(row.preview)) selections.push(...row.preview);
      const legacyRows = rows.filter(row => row.version !== 1);
      const legacyIds = legacyRows.filter(row => {
        const cached = legacySelectionsCache.get(`${row.id}|${date}`);
        if (cached && cached.revision === row.revision) { selections.push(...cached.selections); return false; }
        return true;
      }).map(row => String(row.id));
      if (legacyIds.length) {
        const legacy = await supabaseAdmin.from('material_planning_state')
          .select(`id,plan:state->plan,selectedPlanDate:state->selectedPlanDate,day:state->dailyPlans->"${date}"`)
          .in('id', legacyIds);
        if (legacy.error) throw legacy.error;
        for (const row of (legacy.data ?? []) as unknown as (LegacyPlanRow & { id: string })[]) {
          const plan = row.selectedPlanDate === date ? row.plan : row.day;
          const projection = buildTechnologyPreviewProjection({ selectedPlanDate: date, plan }, null, '');
          const items = projection.days[date] ?? [];
          selections.push(...items);
          if (legacySelectionsCache.size >= 128) legacySelectionsCache.delete(legacySelectionsCache.keys().next().value!);
          legacySelectionsCache.set(`${row.id}|${date}`, { revision: legacyRows.find(entry => entry.id === row.id)!.revision, selections: items });
        }
      }
      if (rows.length < 500) break;
    }
    if (!workspaceCount) {
      const legacy = await supabaseAdmin.from('material_planning_state')
        .select(`plan:state->plan,selectedPlanDate:state->selectedPlanDate,day:state->dailyPlans->"${date}"`)
        .eq('id', 'main').maybeSingle();
      if (legacy.error) throw legacy.error;
      const row = legacy.data as unknown as LegacyPlanRow | null;
      if (row) {
        const projection = buildTechnologyPreviewProjection({ selectedPlanDate: date, plan: row.selectedPlanDate === date ? row.plan : row.day }, null, '');
        selections.push(...(projection.days[date] ?? []));
      }
    }
    // Bounded, shared cache coalesces simultaneous cards and operator requests.
    if (selectionsCache.size >= 32) selectionsCache.delete(selectionsCache.keys().next().value!);
    selectionsCache.set(date, { value: selections, expires: Date.now() + 2_000 });
    return selections;
  })());
  try { return await selectionsPending.get(date)!; } finally { selectionsPending.delete(date); }
};

export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedUser(request);
  if (!auth.user) return NextResponse.json({ code: auth.code ?? 'UNAUTHORIZED' }, { status: 401 });
  if (!canSeeTab(auth.user, 'PRZYGOTOWANIE_PRODUKCJI', 'przygotowanie-produkcji')) {
    return NextResponse.json({ code: 'FORBIDDEN' }, { status: 403 });
  }
  const detail = request.nextUrl.searchParams.get('detail');
  if (detail !== null && (!detail.trim() || detail.length > 2000)) return NextResponse.json({ code: 'INVALID_DETAIL' }, { status: 400 });
  const date = request.nextUrl.searchParams.get('date') ?? '';
  const station = request.nextUrl.searchParams.get('station') ?? '';
  const area = request.nextUrl.searchParams.get('area') ?? '';
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T12:00:00Z`))
    && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date;
  if (detail !== null && (!validDate || !station.trim() || station.length > 120 || area.length > 100)) {
    return NextResponse.json({ code: 'INVALID_CONTEXT' }, { status: 400 });
  }
  try {
    if (detail !== null) {
      const [technologies, selections] = await Promise.all([loadReferenceField('technologies'), loadSelections(date)]);
      return NextResponse.json(buildSelectedTaskTechnologyReference(detail, station, area, technologies, selections), {
        headers: { 'Cache-Control': 'private, no-store' }
      });
    }
    const raw = await loadReferenceField('stationMappings');
    const stationMappings = (Array.isArray(raw) ? raw : []).filter((m): m is { station: string; areaId: string } =>
      m && typeof m.station === 'string' && typeof m.areaId === 'string'
    ).map(({ station, areaId }) => ({ station, areaId }));
    return NextResponse.json({ stationMappings });
  } catch {
    return NextResponse.json({ code: 'LOAD_FAILED' }, { status: 500 });
  }
}
