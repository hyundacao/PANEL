import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getErrorCode, mapDbUser, type DbUserRow } from '@/lib/supabase/users';
import { loadUserGroupsByUserIds } from '@/lib/supabase/permission-groups';
import {
  buildLoginRateLimitKey,
  clearLoginFailures,
  getLoginBlockState,
  registerLoginFailure
} from '@/lib/auth/rate-limit';
import { setSessionCookie } from '@/lib/auth/session';
import { consumeSharedLoginLimit } from '@/lib/auth/shared-rate-limit';

type LoginPayload = {
  username?: string;
  password?: string;
  rememberMe?: boolean;
};

const getClientIp = (request: NextRequest) => {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const [first] = forwardedFor.split(',');
    if (first?.trim()) return first.trim();
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp?.trim()) return realIp.trim();
  return 'unknown';
};

export async function POST(request: NextRequest) {
  const payload = (await request.json().catch(() => null)) as LoginPayload | null;
  const username = typeof payload?.username === 'string' ? payload.username.trim() : '';
  const password = typeof payload?.password === 'string' ? payload.password.trim() : '';
  const rememberMe = payload?.rememberMe === true;

  const rateLimitKey = buildLoginRateLimitKey(username, getClientIp(request));
  const blockedState = getLoginBlockState(rateLimitKey);
  if (blockedState.blocked) {
    return NextResponse.json(
      { code: 'RATE_LIMITED', retryAfter: blockedState.retryAfterSeconds },
      { status: 429 }
    );
  }

  if (!username || !password) {
    registerLoginFailure(rateLimitKey);
    return NextResponse.json({ code: 'INVALID_CREDENTIALS' }, { status: 401 });
  }

  if (username.length > 200 || password.length > 1000) {
    return NextResponse.json({ code: 'INVALID_CREDENTIALS' }, { status: 401 });
  }
  try {
    const retryAfter = await consumeSharedLoginLimit(username, getClientIp(request));
    if (retryAfter) return NextResponse.json({ code: 'RATE_LIMITED', retryAfter }, {
      status: 429, headers: { 'Retry-After': String(retryAfter) }
    });
  } catch {
    return NextResponse.json({ code: 'LOGIN_TEMPORARILY_UNAVAILABLE' }, { status: 503 });
  }

  const { data, error } = await supabaseAdmin.rpc('authenticate_user', {
    p_username: username,
    p_password: password
  });

  if (error) {
    registerLoginFailure(rateLimitKey);
    const code = getErrorCode(error.message, error.code);
    const status = code === 'INACTIVE' ? 403 : 401;
    return NextResponse.json({ code }, { status });
  }

  const row = (Array.isArray(data) ? data[0] : data) as DbUserRow | null;
  if (!row) {
    registerLoginFailure(rateLimitKey);
    return NextResponse.json({ code: 'INVALID_CREDENTIALS' }, { status: 401 });
  }

  const groupsByUserId = await loadUserGroupsByUserIds([row.id]);
  const user = mapDbUser(row, groupsByUserId.get(row.id) ?? []);
  const resetExpiry = Date.parse(String((row.access as Record<string, unknown> | null)?.passwordResetExpiresAt ?? ''));
  if (user.mustChangePassword && Number.isFinite(resetExpiry) && resetExpiry <= Date.now()) {
    registerLoginFailure(rateLimitKey);
    return NextResponse.json({ code: 'INVALID_CREDENTIALS' }, { status: 401 });
  }
  clearLoginFailures(rateLimitKey);
  const sessionId = randomUUID();
  const { data: sessionRow, error: sessionError } = await supabaseAdmin
    .from('app_users')
    .update({ active_session_id: sessionId })
    .eq('id', user.id)
    .eq('is_active', true)
    .eq('access', JSON.stringify(row.access ?? {}))
    .select('id')
    .maybeSingle();

  if (sessionError) {
    return NextResponse.json({ code: 'UNKNOWN' }, { status: 500 });
  }
  if (!sessionRow) {
    return NextResponse.json({ code: 'INACTIVE' }, { status: 403 });
  }

  const response = NextResponse.json(user);
  setSessionCookie(response, user.id, sessionId, rememberMe);
  return response;
}
