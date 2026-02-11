import { NextRequest, NextResponse } from 'next/server';
import { clearSessionCookie, getAuthenticatedUser } from '@/lib/auth/session';
import { removePushSubscriptionForUser } from '@/lib/push/server';

export const dynamic = 'force-dynamic';

type UnsubscribeBody = {
  endpoint?: string;
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

    const body = (await request.json().catch(() => ({}))) as UnsubscribeBody;
    await removePushSubscriptionForUser(auth.user.id, body.endpoint);
    return NextResponse.json({ enabled: false });
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
