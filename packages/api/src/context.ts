// ============================================================
// Click-Deploy — tRPC Context
// ============================================================
import { db, type Database } from '@click-deploy/database';

export interface CreateContextOptions {
  /**
   * Current authenticated user session, if any.
   * Will be null for unauthenticated requests.
   */
  session: {
    userId: string;
    organizationId: string;
    role: 'owner' | 'admin' | 'member' | 'viewer';
  } | null;
}

/**
 * Inner context — doesn't depend on request/response.
 * Used for testing and server-side calls.
 */
export function createInnerContext(opts: CreateContextOptions) {
  return {
    db,
    session: opts.session,
  };
}

export type Context = ReturnType<typeof createInnerContext>;
