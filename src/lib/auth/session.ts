import { createHmac, timingSafeEqual } from 'crypto';
import type { NextResponse } from 'next/server';
import type { AppUser } from '@/lib/api/types';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { mapDbUser, type DbUserRow } from '@/lib/supabase/users';
import { loadUserGroupsByUserIds } from '@/lib/supabase/permission-groups';

const COOKIE = 'apka_session';
const TTL = 60 * 60 * 12;
const REMEMBER_TTL = 60 * 60 * 24 * 30;
type Payload = { v: number; sub: string; sid: string; iat: number; exp: number; iatMs?: number };
export type AuthResult =
  | { user: AppUser; code: null }
  | { user: null; code: 'UNAUTHORIZED' | 'SESSION_EXPIRED' | 'PASSWORD_CHANGE_REQUIRED' };

const secret = () => {
  const value = process.env.APP_SESSION_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value) throw new Error('Missing session secret');
  return value;
};
const sign = (value: string) => createHmac('sha256', secret()).update(value).digest();

const readToken = (request: Request): Payload | null => {
  const raw = request.headers.get('cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith(COOKIE + '='));
  if (!raw) return null;
  try {
    const [body, signature, ...rest] = decodeURIComponent(raw.slice(COOKIE.length + 1)).split('.');
    if (!body || !signature || rest.length) return null;
    const supplied = Buffer.from(signature, 'base64url');
    const expected = sign(body);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Payload;
    if (p.v !== 1 || typeof p.sub !== 'string' || !p.sub.trim() ||
        typeof p.sid !== 'string' || !p.sid.trim() || !Number.isFinite(p.iat) ||
        !Number.isFinite(p.exp) || (p.iatMs !== undefined && !Number.isFinite(p.iatMs))) return null;
    return p;
  } catch { return null; }
};

export const setSessionCookie = (response: NextResponse, userId: string, sessionId: string, rememberMe = false) => {
  const now = Date.now();
  const ttl = rememberMe ? REMEMBER_TTL : TTL;
  const payload: Payload = { v: 1, sub: userId, sid: sessionId, iat: Math.floor(now / 1000), iatMs: now, exp: Math.floor(now / 1000) + ttl };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  response.cookies.set({ name: COOKIE, value: body + '.' + sign(body).toString('base64url'),
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/',
    ...(rememberMe ? { maxAge: ttl } : {}) });
};
export const clearSessionCookie = (response: NextResponse) => {
  response.cookies.set({ name: COOKIE, value: '', httpOnly: true, sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 0 });
};
export const revokeRequestSession = async (request: Request) => {
  const p = readToken(request);
  if (!p) return;
  // Compare IDs so a delayed logout cannot revoke a later login.
  const { error } = await supabaseAdmin.from('app_users').update({ active_session_id: null })
    .eq('id', p.sub).eq('active_session_id', p.sid);
  if (error) throw error;
};
export const getAuthenticatedUser = async (
  request: Request, options: { allowPasswordChange?: boolean } = {}
): Promise<AuthResult> => {
  const p = readToken(request);
  if (!p) return { user: null, code: 'UNAUTHORIZED' };
  if (p.exp * 1000 <= Date.now()) return { user: null, code: 'SESSION_EXPIRED' };
  // Always check persisted revocation, including across serverless instances.
  const [result, groups] = await Promise.all([
    supabaseAdmin.from('app_users')
      .select('id, name, username, role, access, is_active, created_at, last_login, active_session_id')
      .eq('id', p.sub).maybeSingle(),
    loadUserGroupsByUserIds([p.sub])
  ]);
  if (result.error) throw result.error;
  if (!result.data) return { user: null, code: 'UNAUTHORIZED' };
  const row = result.data as DbUserRow & { active_session_id: string | null };
  if (!row.active_session_id || row.active_session_id !== p.sid) return { user: null, code: 'SESSION_EXPIRED' };
  const access = row.access as Record<string, unknown> | null;
  const changed = Date.parse(String(access?.passwordChangedAt ?? ''));
  const resetExpiry = Date.parse(String(access?.passwordResetExpiresAt ?? ''));
  if ((Number.isFinite(changed) && (p.iatMs ?? p.iat * 1000) <= changed) ||
      (access?.mustChangePassword && Number.isFinite(resetExpiry) && resetExpiry <= Date.now())) {
    return { user: null, code: 'SESSION_EXPIRED' };
  }
  const user = mapDbUser(row, groups.get(row.id) ?? []);
  if (!user.isActive) return { user: null, code: 'UNAUTHORIZED' };
  if (user.mustChangePassword && !options.allowPasswordChange) return { user: null, code: 'PASSWORD_CHANGE_REQUIRED' };
  return { user, code: null };
};
