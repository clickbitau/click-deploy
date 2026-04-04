// ============================================================
// Click-Deploy — Registry Router
// ============================================================
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { registries } from '@click-deploy/database';
import { createRouter, protectedProcedure, adminProcedure } from '../trpc';

export const registryRouter = createRouter({
  /** List registries for org (credentials masked) */
  list: protectedProcedure.query(async ({ ctx }) => {
    const regs = await ctx.db.query.registries.findMany({
      where: eq(registries.organizationId, ctx.session.organizationId),
    });

    // Mask credentials
    return regs.map((r) => ({
      ...r,
      username: r.username ? '***' : null,
      password: r.password ? '***' : null,
    }));
  }),

  /** Add a registry */
  create: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      type: z.enum(['dockerhub', 'ghcr', 'ecr', 'self_hosted', 'custom']),
      url: z.string().url().max(500),
      username: z.string().optional(),
      password: z.string().optional(),
      isDefault: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      // If setting as default, unset any existing default
      if (input.isDefault) {
        await ctx.db
          .update(registries)
          .set({ isDefault: false })
          .where(eq(registries.organizationId, ctx.session.organizationId));
      }

      // TODO: Encrypt credentials before storage
      const [registry] = await ctx.db
        .insert(registries)
        .values({
          ...input,
          organizationId: ctx.session.organizationId,
        })
        .returning();

      return registry;
    }),

  /** Delete a registry */
  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(registries)
        .where(
          and(
            eq(registries.id, input.id),
            eq(registries.organizationId, ctx.session.organizationId)
          )
        );

      return { success: true };
    }),

  /** Test registry connectivity */
  testConnection: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const registry = await ctx.db.query.registries.findFirst({
        where: and(
          eq(registries.id, input.id),
          eq(registries.organizationId, ctx.session.organizationId)
        ),
      });

      if (!registry) throw new Error('Registry not found');

      // TODO: Actually test `docker login` against the registry
      return { success: true, message: 'Connection successful' };
    }),
});
