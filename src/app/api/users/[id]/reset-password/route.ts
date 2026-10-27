import { DEFAULT_RESET_PASSWORD } from '@/lib/auth/password';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { isHeadAdmin } from '@/lib/auth/access';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await getAuthenticatedUser(request);
  if (!auth.user) return NextResponse.json({ code: auth.code }, { status: 401 });
  if (!isHeadAdmin(auth.user)) return NextResponse.json({ code: 'FORBIDDEN' }, { status: 403 });
  const { id } = await context.params;
  const { data: row, error: readError } = await supabaseAdmin.from('app_users').select('access').eq('id', id).maybeSingle();
  if (readError) return NextResponse.json({ code: 'UNKNOWN' }, { status: 500 });
  if (!row) return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });
  const temporaryPassword = DEFAULT_RESET_PASSWORD;
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  // Password and revocation timestamp change in the same UPDATE inside the RPC.
  const { error } = await supabaseAdmin.rpc('update_app_user', {
    p_id: id, p_name: null, p_username: null, p_password: temporaryPassword,
    p_role: null, p_is_active: null,
    p_access: { ...row.access, mustChangePassword: true, passwordChangedAt: new Date().toISOString(), passwordResetExpiresAt: expiresAt }
  });
  if (error) return NextResponse.json({ code: 'RESET_FAILED' }, { status: 500 });
  return NextResponse.json({ ok: true, temporaryPassword, expiresAt }, { headers: { 'Cache-Control': 'no-store' } });
}
