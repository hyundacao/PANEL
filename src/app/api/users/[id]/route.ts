import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getErrorCode, mapDbUser, type DbUserRow } from '@/lib/supabase/users';
import type { Role, UserAccess } from '@/lib/api/types';

type UpdateUserPayload = {
  name?: string;
  username?: string;
  password?: string;
  role?: Role;
  access?: UserAccess;
  isActive?: boolean;
};

const normalizeRole = (role?: Role) => (role === 'ADMIN' || role === 'USER' || role === 'VIEWER' ? role : null);

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const userId = id ?? '';
  if (!userId) {
    return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });
  }

  const payload = (await request.json().catch(() => null)) as UpdateUserPayload | null;
  const name = payload?.name?.trim();
  const username = payload?.username?.trim();
  const password = payload?.password?.trim();

  if (payload?.name !== undefined && !name) {
    return NextResponse.json({ code: 'NAME_REQUIRED' }, { status: 400 });
  }
  if (payload?.username !== undefined && !username) {
    return NextResponse.json({ code: 'USERNAME_REQUIRED' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.rpc('update_app_user', {
    p_id: userId,
    p_name: name ?? null,
    p_username: username ?? null,
    p_password: password ? password : null,
    p_role: normalizeRole(payload?.role),
    p_access: payload?.access ?? null,
    p_is_active: typeof payload?.isActive === 'boolean' ? payload.isActive : null
  });

  if (error) {
    if (
      typeof payload?.isActive === 'boolean' &&
      payload?.name === undefined &&
      payload?.username === undefined &&
      payload?.password === undefined &&
      payload?.role === undefined &&
      payload?.access === undefined
    ) {
      const { data: directRow, error: directError } = await supabaseAdmin
        .from('app_users')
        .update({ is_active: payload.isActive })
        .eq('id', userId)
        .select('*')
        .maybeSingle();
      if (!directError && directRow) {
        return NextResponse.json(mapDbUser(directRow as DbUserRow));
      }
    }
    const code = getErrorCode(error.message, error.code);
    const status = code === 'DUPLICATE' ? 409 : code === 'NOT_FOUND' ? 404 : 400;
    return NextResponse.json({ code }, { status });
  }

  const row = (Array.isArray(data) ? data[0] : data) as DbUserRow | null;
  if (!row) {
    return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });
  }

  return NextResponse.json(mapDbUser(row));
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const userId = id ?? '';
  if (!userId) {
    return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });
  }

  const { data, error } = await supabaseAdmin
    .from('app_users')
    .delete()
    .eq('id', userId)
    .select('*')
    .maybeSingle();

  if (error) {
    const code = getErrorCode(error.message, error.code);
    const status = code === 'NOT_FOUND' ? 404 : 400;
    return NextResponse.json({ code }, { status });
  }

  const row = (Array.isArray(data) ? data[0] : data) as DbUserRow | null;
  if (!row) {
    return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });
  }

  return NextResponse.json(mapDbUser(row));
}
