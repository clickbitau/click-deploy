// ============================================================
// Click-Deploy — tRPC HTTP Handler (Next.js App Router)
// ============================================================
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter, createInnerContext, startHeartbeatMonitor } from '@click-deploy/api';
import { auth } from '@/lib/auth';

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
      const sessionData = await auth.api.getSession({
        headers: req.headers
      });

      return createInnerContext({
        session: sessionData ? {
          userId: sessionData.user.id,
          organizationId: sessionData.user.organizationId as string ?? null, 
          role: (sessionData.user.role as any) ?? 'viewer',
        } : null,
      });
    },
    onError: ({ path, error }) => {
      console.error(`❌ tRPC error on '${path}':`, error.message);
    },
  });
};

export { handler as GET, handler as POST };
