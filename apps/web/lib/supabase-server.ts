// ============================================================
// Click-Deploy — Supabase Server Client
// ============================================================
// Server-side Supabase client for API routes and middleware.
// Uses @supabase/ssr for cookie-based session management.
// ============================================================
import { createServerClient as createSSRServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

/**
 * Create a server-side Supabase client that reads/writes cookies.
 * Call this in Server Components, API routes, and server actions.
 */
export async function createServerClient() {
  const cookieStore = await cookies();

  return createSSRServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Component — can't set cookies, but that's fine
          // for read-only operations. The middleware handles refresh.
        }
      },
    },
  });
}
