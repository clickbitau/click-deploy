// ============================================================
// Click-Deploy — Supabase Client
// ============================================================
// Browser + server client factories for Supabase Auth & Realtime.
// ============================================================
import { createBrowserClient as createSSRBrowserClient } from '@supabase/ssr';
import { type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

/**
 * Browser-side Supabase client (singleton).
 * Uses cookie-based auth via @supabase/ssr for SSR compatibility.
 */
let browserClient: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (!supabaseUrl || !supabaseAnonKey) return null;
  if (browserClient) return browserClient;
  browserClient = createSSRBrowserClient(supabaseUrl, supabaseAnonKey);
  return browserClient;
}

// Legacy export — used by Realtime hooks and existing code
export const supabase = typeof window !== 'undefined'
  ? getSupabaseBrowserClient()
  : null;
