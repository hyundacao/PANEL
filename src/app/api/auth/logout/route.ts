import { NextResponse } from 'next/server';
import { clearSessionCookie, revokeRequestSession } from '@/lib/auth/session';

export async function POST(request: Request) {
  try {
    await revokeRequestSession(request);
  } catch {
    return NextResponse.json({ code: 'LOGOUT_FAILED' }, { status: 503 });
  }
  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
}
