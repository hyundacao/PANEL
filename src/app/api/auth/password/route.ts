import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { clearSessionCookie, getAuthenticatedUser, revokeRequestSession } from '@/lib/auth/session';
import { getPasswordValidationError } from '@/lib/auth/password';

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser(request, { allowPasswordChange: true });
  if (!auth.user) return NextResponse.json({ code: auth.code }, { status: 401 });
  const payload = await request.json().catch(() => null);
  const currentPassword = typeof payload?.currentPassword === 'string' ? payload.currentPassword.trim() : '';
  const newPassword = typeof payload?.newPassword === 'string' ? payload.newPassword.trim() : '';
  if (!currentPassword) return NextResponse.json({ code: 'CURRENT_PASSWORD_REQUIRED' }, { status: 400 });
  const policyError = getPasswordValidationError(newPassword);
  if (policyError) return NextResponse.json({ code: policyError }, { status: 400 });
  if (newPassword === currentPassword) return NextResponse.json({ code: 'SAME_PASSWORD' }, { status: 400 });
  const { data, error } = await supabaseAdmin.rpc('authenticate_user', { p_username: auth.user.username, p_password: currentPassword });
  if (error) return NextResponse.json({ code: 'INVALID_CURRENT_PASSWORD' }, { status: 400 });
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || row.id !== auth.user.id) return NextResponse.json({ code: 'INVALID_CURRENT_PASSWORD' }, { status: 400 });
  const { error: updateError } = await supabaseAdmin.rpc('update_app_user', {
    p_id: auth.user.id, p_name: null, p_username: null, p_password: newPassword, p_role: null, p_is_active: null,
    p_access: { ...row.access, mustChangePassword: false, passwordChangedAt: new Date().toISOString(), passwordResetExpiresAt: null }
  });
  if (updateError) return NextResponse.json({ code: 'PASSWORD_CHANGE_FAILED' }, { status: 500 });
  // The atomic timestamp already rejects the old token if the extra cleanup fails.
  await revokeRequestSession(request).catch(() => undefined);
  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
}
