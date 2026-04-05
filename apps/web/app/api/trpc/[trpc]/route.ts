// ============================================================
// Click-Deploy — tRPC HTTP Handler (Next.js App Router)
// ============================================================
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter, createInnerContext, startHeartbeatMonitor } from '@click-deploy/api';
import { createServerClient } from '@supabase/ssr';
import { db, users, eq } from '@click-deploy/database';

// Start heartbeat monitor on first request (runs in-process)
let heartbeatStarted = false;

const handler = (req: Request) => {
  if (!heartbeatStarted) {
    heartbeatStarted = true;
    startHeartbeatMonitor();
  }
  return fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: async () => {
      // Extract Supabase auth session from cookies
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

      if (!supabaseUrl || !supabaseAnonKey) {
        return createInnerContext({ session: null });
      }

      // Parse cookies from the request header
      const cookieHeader = req.headers.get('cookie') || '';
      const cookieMap = new Map<string, string>();
      cookieHeader.split(';').forEach((c) => {
        const [key, ...rest] = c.trim().split('=');
        if (key) cookieMap.set(key, rest.join('='));
      });

      const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
        cookies: {
          getAll() {
            return Array.from(cookieMap.entries()).map(([name, value]) => ({
              name,
              value,
            }));
          },
          setAll() {
            // Can't set cookies in tRPC context — middleware handles refresh
          },
        },
      });

      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) {
        return createInnerContext({ session: null });
      }

      // Map Supabase auth user → our users table (by ID first, then email)
      let dbUser = await db.query.users.findFirst({
        where: eq(users.id, authUser.id),
      });

      // Fallback: match by email (for migrated users whose IDs differ)
      if (!dbUser && authUser.email) {
        dbUser = await db.query.users.findFirst({
          where: eq(users.email, authUser.email),
        });

        // If found by email, update the user's ID to match Supabase auth
        if (dbUser) {
          try {
            await db
              .update(users)
              .set({ id: authUser.id, updatedAt: new Date() })
              .where(eq(users.id, dbUser.id));
            dbUser = { ...dbUser, id: authUser.id };
          } catch {
            // ID update may fail if there's a conflict — continue with existing ID
          }
        }
      }

      if (!dbUser) {
        return createInnerContext({ session: null });
      }

      return createInnerContext({
        session: {
          userId: dbUser.id,
          organizationId: dbUser.organizationId as string ?? null,
          role: (dbUser.role as any) ?? 'viewer',
        },
      });
    },
    onError: ({ path, error }) => {
      console.error(`❌ tRPC error on '${path}':`, error.message);
    },
  });
};

export { handler as GET, handler as POST };
