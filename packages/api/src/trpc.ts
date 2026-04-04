// ============================================================
// Click-Deploy — tRPC Base Configuration
// ============================================================
import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import type { Context } from './context';

/**
 * tRPC initialization with superjson transformer.
 * SuperJSON handles Date, Map, Set, BigInt etc. serialization
 * so we don't lose type fidelity over the wire.
 */
const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof Error
            ? error.cause.message
            : null,
      },
    };
  },
});

// ── Base building blocks ──────────────────────────────────
export const createCallerFactory = t.createCallerFactory;
export const createRouter = t.router;
export const mergeRouters = t.mergeRouters;

/**
 * Public procedure — no authentication required.
 * Used for: health checks, login, register, public info.
 */
export const publicProcedure = t.procedure;

/**
 * Protected procedure — requires authenticated session.
 * Throws UNAUTHORIZED if no valid session is present.
 */
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'You must be logged in to perform this action',
    });
  }
  return next({
    ctx: {
      ...ctx,
      // Override session type to be non-nullable
      session: ctx.session,
    },
  });
});

/**
 * Admin procedure — requires admin or owner role.
 * Used for: node management, organization settings, user management.
 */
export const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (ctx.session.role !== 'owner' && ctx.session.role !== 'admin') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You need admin permissions to perform this action',
    });
  }
  return next({ ctx });
});

/**
 * Owner procedure — requires owner role only.
 * Used for: deleting organization, billing, transferring ownership.
 */
export const ownerProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (ctx.session.role !== 'owner') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only the organization owner can perform this action',
    });
  }
  return next({ ctx });
});
