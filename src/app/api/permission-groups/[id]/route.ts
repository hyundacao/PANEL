import { NextRequest, NextResponse } from 'next/server';
import type { UserAccess } from '@/lib/api/types';
import { isHeadAdmin } from '@/lib/auth/access';
import { clearSessionCookie, getAuthenticatedUser } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  mapDbPermissionGroup,
  normalizeAccessForDb,
  type DbPermissionGroupRow
} from '@/lib/supabase/users';

type UpdatePermissionGroupPayload = {
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

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const denied = await requireHeadAdmin(request);
  if (denied) return denied;

  const { id } = await context.params;
  const groupId = id?.trim();
  if (!groupId) {
    return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });
  }

  const payload = (await request.json().catch(() => null)) as UpdatePermissionGroupPayload | null;
  const updatePayload: Record<string, unknown> = {};

  if (payload?.name !== undefined) {
    const name = payload.name.trim();
    if (!name) {
      return NextResponse.json({ code: 'NAME_REQUIRED' }, { status: 400 });
    }
    updatePayload.name = name;
  }
  if (payload?.description !== undefined) {
    updatePayload.description = payload.description?.trim() || null;
  }
  if (payload?.access !== undefined) {
    updatePayload.access = normalizeAccessForDb(payload.access) ?? { admin: false, warehouses: {} };
  }
  if (typeof payload?.isActive === 'boolean') {
    updatePayload.is_active = payload.isActive;
  }

  if (Object.keys(updatePayload).length === 0) {
    const { data, error } = await supabaseAdmin
      .from('permission_groups')
      .select('id, name, description, access, is_active, created_at')
      .eq('id', groupId)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ code: 'UNKNOWN' }, { status: 400 });
    }
    if (!data) {
      return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });
    }
    return NextResponse.json(mapDbPermissionGroup(data as DbPermissionGroupRow));
  }

  const { data, error } = await supabaseAdmin
    .from('permission_groups')
    .update(updatePayload)
    .eq('id', groupId)
    .select('id, name, description, access, is_active, created_at')
    .maybeSingle();

  if (error) {
    const code = error.code === '23505' ? 'DUPLICATE' : 'UNKNOWN';
    const status = code === 'DUPLICATE' ? 409 : 400;
    return NextResponse.json({ code }, { status });
  }
  if (!data) {
    return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });
  }

  return NextResponse.json(mapDbPermissionGroup(data as DbPermissionGroupRow));
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const denied = await requireHeadAdmin(request);
  if (denied) return denied;

  const { id } = await context.params;
  const groupId = id?.trim();
  if (!groupId) {
    return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });
  }

  const { data, error } = await supabaseAdmin
    .from('permission_groups')
    .delete()
    .eq('id', groupId)
    .select('id, name, description, access, is_active, created_at')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ code: 'UNKNOWN' }, { status: 400 });
  }
  if (!data) {
    return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });
  }

  return NextResponse.json(mapDbPermissionGroup(data as DbPermissionGroupRow));
}
