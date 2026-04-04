// ============================================================
// Click-Deploy — Tunnel Router (Cloudflare Tunnel)
// ============================================================
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { tunnels, tunnelRoutes } from '@click-deploy/database';
import { createRouter, protectedProcedure, adminProcedure } from '../trpc';

export const tunnelRouter = createRouter({
  /** List tunnels for org */
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.query.tunnels.findMany({
      where: eq(tunnels.organizationId, ctx.session.organizationId),
      with: {
        node: { columns: { id: true, name: true, host: true } },
        routes: true,
      },
    });
  }),

  /** Get tunnel details */
  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const tunnel = await ctx.db.query.tunnels.findFirst({
        where: and(
          eq(tunnels.id, input.id),
          eq(tunnels.organizationId, ctx.session.organizationId)
        ),
        with: {
          node: true,
          routes: true,
          domains: true,
        },
      });

      if (!tunnel) throw new Error('Tunnel not found');
      return tunnel;
    }),

  /** Create a new Cloudflare tunnel */
  create: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      cloudflareAccountId: z.string().optional(),
      nodeId: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      // TODO: Call Cloudflare API to create tunnel
      // TODO: Deploy cloudflared container on the target node

      const [tunnel] = await ctx.db
        .insert(tunnels)
        .values({
          name: input.name,
          organizationId: ctx.session.organizationId,
          cloudflareAccountId: input.cloudflareAccountId,
          nodeId: input.nodeId,
          status: 'inactive',
        })
        .returning();

      return tunnel;
    }),

  /** Add a route to a tunnel */
  addRoute: adminProcedure
    .input(z.object({
      tunnelId: z.string().uuid(),
      hostname: z.string().min(1).max(255),
      service: z.string().min(1).max(500), // e.g., "http://traefik:80"
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify tunnel ownership
      const tunnel = await ctx.db.query.tunnels.findFirst({
        where: and(
          eq(tunnels.id, input.tunnelId),
          eq(tunnels.organizationId, ctx.session.organizationId)
        ),
      });

      if (!tunnel) throw new Error('Tunnel not found');

      // TODO: Update Cloudflare tunnel config via API
      // TODO: Create CNAME DNS record

      const [route] = await ctx.db
        .insert(tunnelRoutes)
        .values(input)
        .returning();

      return route;
    }),

  /** Remove a route from a tunnel */
  removeRoute: adminProcedure
    .input(z.object({ routeId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // TODO: Remove from Cloudflare tunnel config
      // TODO: Remove DNS record

      await ctx.db
        .delete(tunnelRoutes)
        .where(eq(tunnelRoutes.id, input.routeId));

      return { success: true };
    }),

  /** Delete a tunnel entirely */
  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // TODO: Call CF API to delete tunnel
      // TODO: Remove cloudflared container from node

      await ctx.db
        .delete(tunnels)
        .where(
          and(
            eq(tunnels.id, input.id),
            eq(tunnels.organizationId, ctx.session.organizationId)
          )
        );

      return { success: true };
    }),
});
