import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getErrorCode, mapDbUser, type DbUserRow } from '@/lib/supabase/users';
import type { Role, UserAccess } from '@/lib/api/types';
import { clearSessionCookie, getAuthenticatedUser } from '@/lib/auth/session';
import { isHeadAdmin } from '@/lib/auth/access';

type CreateUserPayload = {
  name?: string;
  username?: string;
  password?: string;
  role?: Role;
  access?: UserAccess;
};

const normalizeRole = (role?: Role) =>
  role === 'HEAD_ADMIN' || role === 'ADMIN' || role === 'USER' || role === 'VIEWER'
    ? role
    : 'USER';

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

  const { data, error } = await supabaseAdmin.rpc('list_app_users');

  if (error) {
    const code = getErrorCode(error.message, error.code);
    return NextResponse.json({ code }, { status: 500 });
  }

  const rows = (data ?? []) as DbUserRow[];
  return NextResponse.json(rows.map(mapDbUser));
}

export async function POST(request: NextRequest) {
  const denied = await requireHeadAdmin(request);
  if (denied) return denied;

  const payload = (await request.json().catch(() => null)) as CreateUserPayload | null;
  const name = payload?.name?.trim() ?? '';
  const username = payload?.username?.trim() ?? '';
  const password = payload?.password?.trim() ?? '';

  if (!name) return NextResponse.json({ code: 'NAME_REQUIRED' }, { status: 400 });
  if (!username) return NextResponse.json({ code: 'USERNAME_REQUIRED' }, { status: 400 });
  if (!password) return NextResponse.json({ code: 'PASSWORD_REQUIRED' }, { status: 400 });

  const { data, error } = await supabaseAdmin.rpc('create_app_user', {
    p_name: name,
    p_username: username,
    p_password: password,
    p_role: normalizeRole(payload?.role),
    p_access: payload?.access ?? null
  });

  if (error) {
    const code = getErrorCode(error.message, error.code);
    const status = code === 'DUPLICATE' ? 409 : 400;
    return NextResponse.json({ code }, { status });
  }

  const row = (Array.isArray(data) ? data[0] : data) as DbUserRow | null;
  if (!row) {
    return NextResponse.json({ code: 'UNKNOWN' }, { status: 500 });
  }

  return NextResponse.json(mapDbUser(row));
}
