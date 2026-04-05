// ============================================================
// Click-Deploy — Providers (tRPC + React Query + Theme)
// ============================================================
'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import { trpc } from '@/lib/trpc';
import { Toaster } from 'sonner';

function getBaseUrl() {
  if (typeof window !== 'undefined') return '';
  // SSR: use localhost
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Cache responses for 30s — data appears instantly on navigation
            // without showing loading spinners. Still refetches in background.
            staleTime: 30_000,
            gcTime: 5 * 60_000, // Keep unused cache for 5 min
            refetchOnMount: 'always',
            refetchOnWindowFocus: true,
            retry: 1,
          },
        },
      })
  );

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: `${getBaseUrl()}/api/trpc`,
          transformer: superjson,
        }),
      ],
    })
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
        <Toaster
          position="bottom-right"
          theme="dark"
          toastOptions={{
            style: {
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              color: '#e2e8f0',
              backdropFilter: 'blur(12px)',
            },
          }}
        />
      </QueryClientProvider>
    </trpc.Provider>
  );
}
