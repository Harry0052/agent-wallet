import { NextResponse, type NextRequest } from 'next/server';
import { isProtectedApi, isProtectedPage } from '@/lib/auth/protection';

const AUTH_COOKIE = 'aw_session';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(AUTH_COOKIE)?.value);

  if (!hasSession && isProtectedPage(pathname)) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (!hasSession && isProtectedApi(pathname)) {
    return NextResponse.json({
      ok: false,
      error: 'Authentication required.',
    }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
