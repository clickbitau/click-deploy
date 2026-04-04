// ============================================================
// Click-Deploy — Notification Router
// ============================================================
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import { notificationChannels, notificationRules, auditLogs } from '@click-deploy/database';
import { createRouter, protectedProcedure, adminProcedure } from '../trpc';

export const notificationRouter = createRouter({
  /** List notification channels for org */
  listChannels: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.query.notificationChannels.findMany({
      where: eq(notificationChannels.organizationId, ctx.session.organizationId),
      with: { rules: true },
      orderBy: [desc(notificationChannels.createdAt)],
    });
  }),

  /** Create a notification channel */
  createChannel: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      type: z.enum(['slack', 'discord', 'telegram', 'email', 'webhook']),
      config: z.record(z.string()).default({}),
      events: z.array(z.enum([
        'deploy_success', 'deploy_fail', 'service_down', 'service_up',
        'node_offline', 'node_online', 'build_fail', 'certificate_expiring',
      ])).default([]),
    }))
    .mutation(async ({ ctx, input }) => {
      const [channel] = await ctx.db
        .insert(notificationChannels)
        .values({
          name: input.name,
          organizationId: ctx.session.organizationId,
          type: input.type,
          config: input.config,
        })
        .returning();

      // Create event rules
      if (input.events.length > 0) {
        await ctx.db.insert(notificationRules).values(
          input.events.map((event) => ({
            channelId: channel!.id,
            event,
          }))
        );
      }

      return channel;
    }),

  /** Toggle channel enabled/disabled */
  toggleChannel: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const channel = await ctx.db.query.notificationChannels.findFirst({
        where: and(
          eq(notificationChannels.id, input.id),
          eq(notificationChannels.organizationId, ctx.session.organizationId),
        ),
      });

      if (!channel) throw new Error('Channel not found');

      const [updated] = await ctx.db
        .update(notificationChannels)
        .set({ enabled: channel.enabled === 'true' ? 'false' : 'true' })
        .where(eq(notificationChannels.id, input.id))
        .returning();

      return updated;
    }),

  /** Delete a notification channel */
  deleteChannel: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(notificationChannels)
        .where(
          and(
            eq(notificationChannels.id, input.id),
            eq(notificationChannels.organizationId, ctx.session.organizationId),
          )
        );
      return { success: true };
    }),

  /** Get recent audit logs */
  auditLogs: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(50) }))
    .query(async ({ ctx, input }) => {
      return ctx.db.query.auditLogs.findMany({
        where: eq(auditLogs.organizationId, ctx.session.organizationId),
        orderBy: [desc(auditLogs.createdAt)],
        limit: input.limit,
        with: { user: { columns: { id: true, name: true, email: true } } },
      });
    }),
});
