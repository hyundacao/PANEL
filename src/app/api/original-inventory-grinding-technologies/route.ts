import { NextRequest, NextResponse } from 'next/server';
import { canSeeTab } from '@/lib/auth/access';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { GrindingTechnology } from '@/lib/utils/grindingTechnologyMass';

export const dynamic = 'force-dynamic';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedUser(request);
  if (!auth.user) return NextResponse.json({ code: auth.code ?? 'UNAUTHORIZED' }, { status: 401 });
  if (
    !canSeeTab(auth.user, 'PLANOWANIE_ZAPOTRZEBOWANIA', 'planowanie-zapotrzebowania') &&
    !canSeeTab(auth.user, 'PRZEMIALY', 'spis-oryginalow')
  ) return NextResponse.json({ code: 'FORBIDDEN' }, { status: 403 });

  const { data, error } = await supabaseAdmin
    .from('material_planning_state')
    .select('technologies:state->technologies')
    .eq('id', 'main')
    .maybeSingle();
  if (error) return NextResponse.json({ code: 'LOAD_FAILED' }, { status: 500 });
  const raw = record(data).technologies;
  const items: GrindingTechnology[] = (Array.isArray(raw) ? raw : []).map((item) => {
    const technology = record(item);
    return {
      id: String(technology.id ?? ''),
      productIndex: String(technology.productIndex ?? ''),
      productName: String(technology.productName ?? ''),
      variant: technology.variant === 'alternative' ? 'alternative' as const : 'base' as const,
      archived: technology.archived === true,
      materials: (Array.isArray(technology.materials) ? technology.materials : []).map((rawMaterial) => {
        const material = record(rawMaterial);
        return {
          category: String(material.category ?? ''),
          usage: Number(material.usage ?? 0),
          unit: String(material.unit ?? '')
        };
      })
    };
  }).filter((item) => item.id && (item.productIndex || item.productName));
  return NextResponse.json({ items });
}
