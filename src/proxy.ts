import { NextRequest, NextResponse } from 'next/server';

export function proxy(request: NextRequest) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const origin = request.headers.get('origin');
    if (request.headers.get('sec-fetch-site') === 'cross-site' ||
        (origin && origin !== request.nextUrl.origin)) {
      return NextResponse.json({ code: 'FORBIDDEN_ORIGIN' }, { status: 403 });
    }
  }
  const response = NextResponse.next();
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export const config = { matcher: '/api/:path*' };
