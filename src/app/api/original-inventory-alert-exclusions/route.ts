import { NextRequest, NextResponse } from 'next/server';
import { canSeeTab, isReadOnly } from '@/lib/auth/access';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  changeOriginalInventoryAlertExclusions,
  normalizeOriginalInventoryAlertExclusions
} from '@/lib/utils/originalInventoryAlertExclusions';

export const dynamic = 'force-dynamic';

const MODULE_ID = 'original-inventory-alert-exclusions';

const authorize = async (request: NextRequest, write: boolean) => {
  const auth = await getAuthenticatedUser(request);
  if (!auth.user) return { user: null, response: NextResponse.json({ code: auth.code ?? 'UNAUTHORIZED' }, { status: 401 }) };
  const planning = canSeeTab(auth.user, 'PLANOWANIE_ZAPOTRZEBOWANIA', 'planowanie-zapotrzebowania');
  const inventory = canSeeTab(auth.user, 'PRZEMIALY', 'spis-oryginalow');
  if (!planning && !inventory) {
    return { user: null, response: NextResponse.json({ code: 'FORBIDDEN' }, { status: 403 }) };
  }
  if (write && (planning
    ? isReadOnly(auth.user, 'PLANOWANIE_ZAPOTRZEBOWANIA')
    : isReadOnly(auth.user, 'PRZEMIALY'))) {
    return { user: null, response: NextResponse.json({ code: 'READ_ONLY' }, { status: 403 }) };
  }
  return { user: auth.user, response: null };
};

const loadState = async () => {
  const { data, error } = await supabaseAdmin
    .from('material_planning_state')
    .select('state, revision')
    .eq('id', MODULE_ID)
    .maybeSingle();
  if (error) throw error;
  const state = data?.state && typeof data.state === 'object' && !Array.isArray(data.state)
    ? data.state as Record<string, unknown>
    : {};
  return { state, revision: Number(data?.revision ?? 0) };
};

export async function GET(request: NextRequest) {
  const access = await authorize(request, false);
  if (access.response) return access.response;
  try {
    const { state } = await loadState();
    return NextResponse.json({ items: normalizeOriginalInventoryAlertExclusions(state.items) });
  } catch {
    return NextResponse.json({ code: 'LOAD_FAILED' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const access = await authorize(request, true);
  if (access.response || !access.user) return access.response;
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('INVALID_JSON');
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ code: 'INVALID_JSON' }, { status: 400 });
  }

  const action = body.action;
  const key = String(body.key ?? '').trim();
  const name = String(body.name ?? '').trim();
  const unit = String(body.unit ?? '').trim();
  if ((action !== 'ignore' && action !== 'restore') || !key || key.length > 600 ||
    (action === 'ignore' && (!name || name.length > 500 || unit.length > 50))) {
    return NextResponse.json({ code: 'INVALID_EXCLUSION' }, { status: 400 });
  }

  const updatedBy = access.user.username ?? access.user.name;
  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { state, revision } = await loadState();
      const current = normalizeOriginalInventoryAlertExclusions(state.items);
      const items = action === 'ignore'
        ? changeOriginalInventoryAlertExclusions(current, {
          action: 'ignore',
          exclusion: { key, name, unit, createdAt: new Date().toISOString(), createdBy: updatedBy }
        })
        : changeOriginalInventoryAlertExclusions(current, { action: 'restore', key });
      const { data, error } = await supabaseAdmin.rpc('save_material_planning_state', {
        p_module_id: MODULE_ID,
        p_state: { ...state, items },
        p_expected_revision: revision,
        p_updated_by: updatedBy
      });
      if (error) throw error;
      const result = Array.isArray(data)
        ? data[0] as { has_conflict?: boolean } | undefined
        : undefined;
      if (result?.has_conflict) continue;
      return NextResponse.json({ items });
    }
    return NextResponse.json({ code: 'REVISION_CONFLICT' }, { status: 409 });
  } catch {
    return NextResponse.json({ code: 'SAVE_FAILED' }, { status: 500 });
  }
}
