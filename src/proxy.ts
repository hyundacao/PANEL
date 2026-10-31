import { NextRequest, NextResponse } from 'next/server';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const getRequestOrigin = (request: NextRequest) => {
  // Next.js normalizes loopback URLs to localhost in development; Host retains the browser's address.
  if (process.env.NODE_ENV === 'development' && request.nextUrl.protocol === 'http:' &&
      LOOPBACK_HOSTS.has(request.nextUrl.hostname)) {
    const host = request.headers.get('host');
    if (host) {
      try {
        const localUrl = new URL(`http://${host}`);
        if (localUrl.host === host && LOOPBACK_HOSTS.has(localUrl.hostname)) return localUrl.origin;
      } catch {
        // An invalid Host must not widen the accepted origin.
      }
    }
  }
  return request.nextUrl.origin;
};

export function proxy(request: NextRequest) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const origin = request.headers.get('origin');
    if (request.headers.get('sec-fetch-site') === 'cross-site' ||
        (origin && origin !== getRequestOrigin(request))) {
      return NextResponse.json({ code: 'FORBIDDEN_ORIGIN' }, { status: 403 });
    }
  }
  const response = NextResponse.next();
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export const config = { matcher: '/api/:path*' };
