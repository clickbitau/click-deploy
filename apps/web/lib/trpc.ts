// ============================================================
// Click-Deploy — tRPC React Client
// ============================================================
'use client';

import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '@click-deploy/api';

export const trpc = createTRPCReact<AppRouter>();
