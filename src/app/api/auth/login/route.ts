import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getErrorCode, mapDbUser, type DbUserRow } from '@/lib/supabase/users';

type LoginPayload = {
  username?: string;
  password?: string;
};

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as LoginPayload | null;
  const username = payload?.username?.trim() ?? '';
  const password = payload?.password?.trim() ?? '';

  if (!username || !password) {
    return NextResponse.json({ code: 'INVALID_CREDENTIALS' }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin.rpc('authenticate_user', {
    p_username: username,
    p_password: password
  });

  if (error) {
    const code = getErrorCode(error.message, error.code);
    const status = code === 'INACTIVE' ? 403 : 401;
    return NextResponse.json({ code }, { status });
  }

  const row = (Array.isArray(data) ? data[0] : data) as DbUserRow | null;
  if (!row) {
    return NextResponse.json({ code: 'INVALID_CREDENTIALS' }, { status: 401 });
  }

  return NextResponse.json(mapDbUser(row));
}
