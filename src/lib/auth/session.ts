import { createHmac, timingSafeEqual } from 'crypto';
import type { NextResponse } from 'next/server';
import type { AppUser } from '@/lib/api/types';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { mapDbUser, type DbUserRow } from '@/lib/supabase/users';

const SESSION_COOKIE_NAME = 'apka_session';
const SESSION_VERSION = 1;
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const SESSION_REMEMBER_TTL_SECONDS = 60 * 60 * 24 * 30;

type SessionPayload = {
  v: number;
  sub: string;
  iat: number;
  exp: number;
};

type SessionTokenState =
  | {
      userId: string;
      expired: boolean;
    }
  | null;

export type AuthResult =
  | {
      user: AppUser;
      code: null;
    }
  | {
      user: null;
      code: 'UNAUTHORIZED' | 'SESSION_EXPIRED';
    };

const getSessionSecret = () => {
  const secret =
    process.env.APP_SESSION_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error(
      'Missing session secret: APP_SESSION_SECRET or SUPABASE_SERVICE_ROLE_KEY'
    );
  }
  return secret;
};

const encodeBase64Url = (value: string) =>
  Buffer.from(value, 'utf8').toString('base64url');

const decodeBase64Url = (value: string) =>
  Buffer.from(value, 'base64url').toString('utf8');

const signPayloadPart = (payloadPart: string) =>
  createHmac('sha256', getSessionSecret()).update(payloadPart).digest();

const buildSessionToken = (userId: string, rememberMe: boolean) => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const ttl = rememberMe ? SESSION_REMEMBER_TTL_SECONDS : SESSION_TTL_SECONDS;
  const payload: SessionPayload = {
    v: SESSION_VERSION,
    sub: userId,
    iat: nowSeconds,
    exp: nowSeconds + ttl
  };
  const payloadPart = encodeBase64Url(JSON.stringify(payload));
  const signaturePart = signPayloadPart(payloadPart).toString('base64url');
  return `${payloadPart}.${signaturePart}`;
};

const parseSessionToken = (token: string | null | undefined): SessionTokenState => {
  if (!token) return null;
  const [payloadPart, signaturePart, ...rest] = token.split('.');
  if (!payloadPart || !signaturePart || rest.length > 0) return null;
  let signature: Buffer;
  try {
    signature = Buffer.from(signaturePart, 'base64url');
  } catch {
    return null;
  }
  const expected = signPayloadPart(payloadPart);
  if (signature.length !== expected.length) return null;
  if (!timingSafeEqual(signature, expected)) return null;
  let payload: SessionPayload;
  try {
    payload = JSON.parse(decodeBase64Url(payloadPart)) as SessionPayload;
  } catch {
    return null;
  }
  if (
    payload?.v !== SESSION_VERSION ||
    typeof payload?.sub !== 'string' ||
    !payload.sub.trim() ||
    typeof payload?.exp !== 'number'
  ) {
    return null;
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (payload.exp <= nowSeconds) {
    return { userId: payload.sub, expired: true };
  }
  return { userId: payload.sub, expired: false };
};

const readCookieValue = (request: Request, name: string) => {
  const header = request.headers.get('cookie');
  if (!header) return null;
  const parts = header.split(';');
  for (const rawPart of parts) {
    const trimmed = rawPart.trim();
    if (!trimmed) continue;
    const splitIndex = trimmed.indexOf('=');
    const key = splitIndex >= 0 ? trimmed.slice(0, splitIndex) : trimmed;
    if (key !== name) continue;
    const rawValue = splitIndex >= 0 ? trimmed.slice(splitIndex + 1) : '';
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }
  return null;
};

export const setSessionCookie = (
  response: NextResponse,
  userId: string,
  rememberMe = false
) => {
  const ttl = rememberMe ? SESSION_REMEMBER_TTL_SECONDS : SESSION_TTL_SECONDS;
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: buildSessionToken(userId, rememberMe),
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    ...(rememberMe ? { maxAge: ttl } : {})
  });
};

export const clearSessionCookie = (response: NextResponse) => {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0
  });
};

export const getAuthenticatedUser = async (request: Request): Promise<AuthResult> => {
  const token = readCookieValue(request, SESSION_COOKIE_NAME);
  const parsed = parseSessionToken(token);
  if (!parsed) {
    return { user: null, code: 'UNAUTHORIZED' };
  }
  if (parsed.expired) {
    return { user: null, code: 'SESSION_EXPIRED' };
  }

  const { data, error } = await supabaseAdmin
    .from('app_users')
    .select(
      'id, name, username, role, access, is_active, created_at, last_login'
    )
    .eq('id', parsed.userId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    return { user: null, code: 'UNAUTHORIZED' };
  }

  const user = mapDbUser(data as DbUserRow);
  if (!user.isActive) {
    return { user: null, code: 'UNAUTHORIZED' };
  }
  return { user, code: null };
};
