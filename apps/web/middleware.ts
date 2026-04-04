// ============================================================
// Click-Deploy — Auth Middleware
// ============================================================
// Protects /dashboard routes — redirects to /login if no session.
// Redirects authenticated users away from /login and /register.
// ============================================================
import { NextRequest, NextResponse } from 'next/server';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Check for session cookie (better-auth uses this prefix)
  const sessionCookie = req.cookies.get('click-deploy.session_token')
    || req.cookies.get('better-auth.session_token')
    || req.cookies.get('__Secure-click-deploy.session_token');
  const hasSession = !!sessionCookie?.value;

  // Protected routes — require auth
  if (pathname.startsWith('/dashboard')) {
    if (!hasSession) {
      const loginUrl = req.nextUrl.clone();
      loginUrl.pathname = '/login';
      loginUrl.searchParams.set('redirect', pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  // Auth routes — redirect to dashboard if already logged in
  if (pathname === '/login' || pathname === '/register') {
    if (hasSession) {
      const dashUrl = req.nextUrl.clone();
      dashUrl.pathname = '/dashboard';
      return NextResponse.redirect(dashUrl);
    }
  }

  // Root — redirect to dashboard or login
  if (pathname === '/') {
    const target = req.nextUrl.clone();
    target.pathname = hasSession ? '/dashboard' : '/login';
    return NextResponse.redirect(target);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/',
    '/dashboard/:path*',
    '/login',
    '/register',
  ],
};
