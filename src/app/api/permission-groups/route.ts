import { NextRequest, NextResponse } from 'next/server';
import type { UserAccess } from '@/lib/api/types';
import { isHeadAdmin } from '@/lib/auth/access';
import { clearSessionCookie, getAuthenticatedUser } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { listPermissionGroups } from '@/lib/supabase/permission-groups';
import {
  mapDbPermissionGroup,
  normalizeAccessForDb,
  type DbPermissionGroupRow
} from '@/lib/supabase/users';

type CreatePermissionGroupPayload = {
  name?: string;
  description?: string | null;
  access?: UserAccess;
  isActive?: boolean;
};

const requireHeadAdmin = async (request: Request) => {
  const auth = await getAuthenticatedUser(request);
  if (!auth.user) {
    const response = NextResponse.json({ code: auth.code }, { status: 401 });
    if (auth.code === 'SESSION_EXPIRED') {
      clearSessionCookie(response);
    }
    return response;
  }
  if (!isHeadAdmin(auth.user)) {
    return NextResponse.json({ code: 'FORBIDDEN' }, { status: 403 });
  }
  return null;
};

export async function GET(request: NextRequest) {
  const denied = await requireHeadAdmin(request);
  if (denied) return denied;

  try {
    const groups = await listPermissionGroups();
    return NextResponse.json(groups);
  } catch {
    return NextResponse.json({ code: 'UNKNOWN' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireHeadAdmin(request);
  if (denied) return denied;

  const payload = (await request.json().catch(() => null)) as CreatePermissionGroupPayload | null;
  const name = payload?.name?.trim() ?? '';
  if (!name) {
    return NextResponse.json({ code: 'NAME_REQUIRED' }, { status: 400 });
  }

  const access = normalizeAccessForDb(payload?.access) ?? { admin: false, warehouses: {} };

  const { data, error } = await supabaseAdmin
    .from('permission_groups')
    .insert({
      name,
      description: payload?.description?.trim() || null,
      access,
      is_active: payload?.isActive ?? true
    })
    .select('id, name, description, access, is_active, created_at')
    .maybeSingle();

  if (error) {
    const code = error.code === '23505' ? 'DUPLICATE' : 'UNKNOWN';
    const status = code === 'DUPLICATE' ? 409 : 400;
    return NextResponse.json({ code }, { status });
  }
  if (!data) {
    return NextResponse.json({ code: 'UNKNOWN' }, { status: 500 });
  }

  return NextResponse.json({ ...mapDbPermissionGroup(data as DbPermissionGroupRow), assignedUsersCount: 0 });
}
