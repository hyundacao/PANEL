import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { clearSessionCookie, getAuthenticatedUser } from '@/lib/auth/session';
import { getErrorCode } from '@/lib/supabase/users';
import { DEFAULT_RESET_PASSWORD } from '@/lib/auth/password';

type ChangePasswordPayload = {
  currentPassword?: string;
  newPassword?: string;
};

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser(request);
  if (!auth.user) {
    const response = NextResponse.json({ code: auth.code }, { status: 401 });
    if (auth.code === 'SESSION_EXPIRED') {
      clearSessionCookie(response);
    }
    return response;
  }

  const payload = (await request.json().catch(() => null)) as ChangePasswordPayload | null;
  const currentPassword = payload?.currentPassword?.trim() ?? '';
  const newPassword = payload?.newPassword?.trim() ?? '';

  if (!currentPassword) {
    return NextResponse.json({ code: 'CURRENT_PASSWORD_REQUIRED' }, { status: 400 });
  }
  if (!newPassword) {
    return NextResponse.json({ code: 'NEW_PASSWORD_REQUIRED' }, { status: 400 });
  }
  if (currentPassword === newPassword) {
    return NextResponse.json({ code: 'SAME_PASSWORD' }, { status: 400 });
  }
  if (auth.user.mustChangePassword && currentPassword !== DEFAULT_RESET_PASSWORD) {
    return NextResponse.json({ code: 'INVALID_CURRENT_PASSWORD' }, { status: 400 });
  }

  const { error: verifyError } = await supabaseAdmin.rpc('authenticate_user', {
    p_username: auth.user.username,
    p_password: currentPassword
  });

  if (verifyError) {
    const code = getErrorCode(verifyError.message, verifyError.code);
    if (code === 'INVALID_CREDENTIALS') {
      return NextResponse.json({ code: 'INVALID_CURRENT_PASSWORD' }, { status: 400 });
    }
    if (code === 'INACTIVE') {
      return NextResponse.json({ code: code }, { status: 403 });
    }
    return NextResponse.json({ code: 'UNKNOWN' }, { status: 500 });
  }

  const { error: updateError } = await supabaseAdmin.rpc('update_app_user', {
    p_id: auth.user.id,
    p_name: null,
    p_username: null,
    p_password: newPassword,
    p_role: null,
    p_access: null,
    p_is_active: null
  });

  if (updateError) {
    const code = getErrorCode(updateError.message, updateError.code);
    const status = code === 'NOT_FOUND' ? 404 : 400;
    return NextResponse.json({ code }, { status });
  }

  const { data: currentUserRow, error: currentUserError } = await supabaseAdmin
    .from('app_users')
    .select('access')
    .eq('id', auth.user.id)
    .maybeSingle();
  if (currentUserError) {
    return NextResponse.json({ code: 'UNKNOWN' }, { status: 500 });
  }

  const currentAccess =
    currentUserRow?.access && typeof currentUserRow.access === 'object'
      ? (currentUserRow.access as Record<string, unknown>)
      : ({ admin: false, warehouses: {} } as Record<string, unknown>);
  const nextAccess = {
    ...currentAccess,
    mustChangePassword: false
  };
  const { error: clearFlagError } = await supabaseAdmin
    .from('app_users')
    .update({ access: nextAccess })
    .eq('id', auth.user.id);
  if (clearFlagError) {
    return NextResponse.json({ code: 'UNKNOWN' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
