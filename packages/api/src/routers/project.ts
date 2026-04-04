// ============================================================
// Click-Deploy — Project Router
// ============================================================
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import { projects, services } from '@click-deploy/database';
import { createRouter, protectedProcedure, adminProcedure } from '../trpc';

export const projectRouter = createRouter({
  /** List all projects for the current organization */
  list: protectedProcedure
    .input(
      z.object({
        environment: z.enum(['production', 'staging', 'development']).optional(),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(projects.organizationId, ctx.session.organizationId)];
      if (input?.environment) {
        conditions.push(eq(projects.environment, input.environment));
      }

      return ctx.db.query.projects.findMany({
        where: and(...conditions),
        with: {
          services: true,
        },
        orderBy: [desc(projects.updatedAt)],
      });
    }),

  /** Get a single project by ID */
  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const project = await ctx.db.query.projects.findFirst({
        where: and(
          eq(projects.id, input.id),
          eq(projects.organizationId, ctx.session.organizationId)
        ),
        with: {
          services: true,
        },
      });

      if (!project) {
        throw new Error('Project not found');
      }

      return project;
    }),

  /** Create a new project */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        description: z.string().optional(),
        environment: z.enum(['production', 'staging', 'development']).default('production'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [project] = await ctx.db
        .insert(projects)
        .values({
          name: input.name,
          description: input.description,
          organizationId: ctx.session.organizationId,
          environment: input.environment,
        })
        .returning();

      return project;
    }),

  /** Update a project */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(100).optional(),
        description: z.string().optional(),
        environment: z.enum(['production', 'staging', 'development']).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const [updated] = await ctx.db
        .update(projects)
        .set({ ...data, updatedAt: new Date() })
        .where(
          and(
            eq(projects.id, id),
            eq(projects.organizationId, ctx.session.organizationId)
          )
        )
        .returning();

      return updated;
    }),

  /** Delete a project and all its services */
  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(projects)
        .where(
          and(
            eq(projects.id, input.id),
            eq(projects.organizationId, ctx.session.organizationId)
          )
        );

      return { success: true };
    }),
});
