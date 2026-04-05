// ============================================================
// Click-Deploy — Auth Client (Supabase)
// ============================================================
// Drop-in replacement for Better-Auth client.
// Exports the same API surface backed by Supabase Auth.
// ============================================================
import { getSupabaseBrowserClient } from './supabase';

function getClient() {
  const client = getSupabaseBrowserClient();
  if (!client) throw new Error('Supabase client not initialized');
  return client;
}

export const signIn = {
  email: async ({ email, password }: { email: string; password: string }) => {
    const { data, error } = await getClient().auth.signInWithPassword({ email, password });
    if (error) return { error: { message: error.message }, data: null };
    return { error: null, data };
  },
  social: async ({ provider, callbackURL }: { provider: 'github'; callbackURL?: string }) => {
    const { data, error } = await getClient().auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}${callbackURL || '/dashboard'}` },
    });
    if (error) throw error;
    return data;
  },
};

export const signUp = {
  email: async ({ email, password, name }: { email: string; password: string; name: string }) => {
    const { data, error } = await getClient().auth.signUp({
      email,
      password,
      options: {
        data: { name },
        // Skip email confirmation for self-hosted
        emailRedirectTo: `${window.location.origin}/dashboard`,
      },
    });
    if (error) return { error: { message: error.message }, data: null };
    return { error: null, data };
  },
};

export async function signOut() {
  await getClient().auth.signOut();
}

/**
 * React hook replacement for useSession.
 * Returns { data: { user, session } | null, isPending }.
 * Not a true hook — implemented as a fetch-compatible function
 * called from useEffect in the layout.
 */
export async function getSession() {
  const { data: { session }, error } = await getClient().auth.getSession();
  if (error || !session) return null;
  return {
    user: {
      id: session.user.id,
      name: session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'User',
      email: session.user.email || '',
      image: session.user.user_metadata?.avatar_url || null,
    },
    session,
  };
}
