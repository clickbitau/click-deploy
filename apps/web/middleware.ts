// ============================================================
// Click-Deploy — Auth Middleware (Supabase)
// ============================================================
// Protects /dashboard routes — redirects to /login if no session.
// Redirects authenticated users away from /login and /register.
// Uses @supabase/ssr to refresh tokens on every request.
// ============================================================
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  let response = NextResponse.next({ request: req });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  if (!supabaseUrl || !supabaseAnonKey) {
    return response;
  }

  // Create Supabase client that can read/write cookies on the response
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          req.cookies.set(name, value);
        });
        response = NextResponse.next({ request: req });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  // This refreshes the session token if expired
  const { data: { user } } = await supabase.auth.getUser();
  const hasSession = !!user;

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

  return response;
}

export const config = {
  matcher: [
    '/',
    '/dashboard/:path*',
    '/login',
    '/register',
  ],
};
