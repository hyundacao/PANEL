import { NextRequest, NextResponse } from 'next/server';
import { clearSessionCookie, getAuthenticatedUser } from '@/lib/auth/session';
import {
  isWebPushConfigured,
  normalizePushSubscription,
  upsertPushSubscriptionForUser
} from '@/lib/push/server';

export const dynamic = 'force-dynamic';

type SubscribeBody = {
  subscription?: unknown;
};

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (!auth.user) {
      const response = NextResponse.json({ code: auth.code }, { status: 401 });
      if (auth.code === 'SESSION_EXPIRED') {
        clearSessionCookie(response);
      }
      return response;
    }

    if (!isWebPushConfigured()) {
      return NextResponse.json({ code: 'PUSH_NOT_CONFIGURED' }, { status: 503 });
    }

    const body = (await request.json().catch(() => ({}))) as SubscribeBody;
    const normalized = normalizePushSubscription(body.subscription);
    if (!normalized) {
      return NextResponse.json({ code: 'INVALID_SUBSCRIPTION' }, { status: 400 });
    }

    await upsertPushSubscriptionForUser(
      auth.user.id,
      normalized,
      request.headers.get('user-agent')
    );
    return NextResponse.json({ enabled: true });
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: string }).code ?? 'UNKNOWN')
        : 'UNKNOWN';
    if (code === '42P01' || code === '42703') {
      return NextResponse.json({ code: 'MIGRATION_REQUIRED' }, { status: 503 });
    }
    return NextResponse.json({ code: 'UNKNOWN' }, { status: 500 });
  }
}
