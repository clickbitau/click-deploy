// ============================================================
// Click-Deploy — Deployment Router
// ============================================================
import { z } from 'zod';
import { eq, and, desc, inArray, sql } from 'drizzle-orm';
import { deployments, services, projects, nodes, inAppNotifications } from '@click-deploy/database';
import { createRouter, protectedProcedure, adminProcedure } from '../trpc';
import { deploymentEngine } from '../engine';

export const deploymentRouter = createRouter({
  /** List deployments for a service */
  listByService: protectedProcedure
    .input(z.object({
      serviceId: z.string().uuid(),
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      // Verify service ownership
      const service = await ctx.db.query.services.findFirst({
        where: eq(services.id, input.serviceId),
        with: { project: true },
      });

      if (!service || service.project.organizationId !== ctx.session.organizationId) {
        throw new Error('Service not found');
      }

      return ctx.db.query.deployments.findMany({
        where: eq(deployments.serviceId, input.serviceId),
        orderBy: [desc(deployments.createdAt)],
        limit: input.limit,
        offset: input.offset,
        with: {
          buildNode: {
            columns: { id: true, name: true },
          },
          deployNode: {
            columns: { id: true, name: true },
          },
        },
      });
    }),

  /** List recent deployments across all services in the org */
  listRecent: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(50).default(10),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 10;
      const offset = input?.offset ?? 0;

      // Get all project IDs for this org
      const orgProjects = await ctx.db.query.projects.findMany({
        where: eq(projects.organizationId, ctx.session.organizationId),
        columns: { id: true },
      });

      const projectIds = orgProjects.map((p) => p.id);

      if (projectIds.length === 0) return { items: [], total: 0 };

      // Get all service IDs belonging to this org's projects
      const orgServices = await ctx.db.query.services.findMany({
        where: inArray(services.projectId, projectIds),
        columns: { id: true },
      });

      const serviceIds = orgServices.map((s) => s.id);
      if (serviceIds.length === 0) return { items: [], total: 0 };

      // SQL-level filtered query — only fetches this org's deployments
      const recent = await ctx.db.query.deployments.findMany({
        where: inArray(deployments.serviceId, serviceIds),
        orderBy: [desc(deployments.createdAt)],
        limit: limit,
        offset: offset,
        with: {
          service: {
            columns: { id: true, name: true, projectId: true },
            with: {
              project: {
                columns: { id: true, name: true, organizationId: true },
              },
            },
          },
          buildNode: { columns: { id: true, name: true } },
          deployNode: { columns: { id: true, name: true } },
        },
      });

      // For total count, use a count query on the same filter
      const [countResult] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(deployments)
        .where(inArray(deployments.serviceId, serviceIds));

      return {
        items: recent,
        total: countResult?.count ?? recent.length,
      };
    }),

  /** Get a single deployment with full details */
  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const deployment = await ctx.db.query.deployments.findFirst({
        where: eq(deployments.id, input.id),
        with: {
          service: {
            with: {
              project: true,
            },
          },
          buildNode: true,
          deployNode: true,
        },
      });

      if (!deployment || deployment.service.project.organizationId !== ctx.session.organizationId) {
        throw new Error('Deployment not found');
      }

      return deployment;
    }),

  /** Trigger a new deployment */
  trigger: protectedProcedure
    .input(z.object({
      serviceId: z.string().uuid(),
      branch: z.string().optional(),
      commitSha: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify service ownership
      const service = await ctx.db.query.services.findFirst({
        where: eq(services.id, input.serviceId),
        with: { project: true },
      });

      if (!service || service.project.organizationId !== ctx.session.organizationId) {
        throw new Error('Service not found');
      }

      // ── Auto-resolve build node ──────────────────────────
      // Always pick a node with can_build=true at trigger time,
      // Don't trust the service's stale buildNodeId.
      const orgNodes = await ctx.db.query.nodes.findMany({
        where: eq(nodes.organizationId, ctx.session.organizationId),
      });

      let buildNodeId = service.buildNodeId;
      if (service.sourceType === 'git') {
        const buildCapable = orgNodes.filter((n) => n.canBuild && n.status === 'online');
        if (buildCapable.length > 0) {
          // Prefer the configured one if it's still capable, otherwise pick first capable
          const configured = buildCapable.find((n) => n.id === service.buildNodeId);
          buildNodeId = configured ? configured.id : buildCapable[0]!.id;
        } else if (orgNodes.length > 0) {
          // Fallback: any online node
          const online = orgNodes.filter((n) => n.status === 'online');
          buildNodeId = online.length > 0 ? online[0]!.id : orgNodes[0]!.id;
        }
        // Update the service's buildNodeId if it changed
        if (buildNodeId && buildNodeId !== service.buildNodeId) {
          await ctx.db.update(services)
            .set({ buildNodeId })
            .where(eq(services.id, input.serviceId));
        }
      }

      // ── Auto-resolve deploy node ─────────────────────────
      let deployNodeId = service.targetNodeId;
      if (!deployNodeId) {
        const deployCap = orgNodes.filter((n) => n.canDeploy && n.status === 'online');
        deployNodeId = deployCap.length > 0 ? deployCap[0]!.id : orgNodes[0]?.id ?? null;
      }

      if (!buildNodeId && !deployNodeId) {
        throw new Error('No nodes available — add at least one node to your organization before deploying.');
      }

      const [deployment] = await ctx.db
        .insert(deployments)
        .values({
          serviceId: input.serviceId,
          triggeredBy: 'manual',
          branch: input.branch ?? service.gitBranch ?? 'main',
          commitSha: input.commitSha,
          buildStatus: 'pending',
          deployStatus: 'pending',
          buildNodeId: buildNodeId,
          deployNodeId: deployNodeId,
        })
        .returning();

      // Fire-and-forget: run deployment in background
      deploymentEngine.runDeployment(deployment!.id).catch((err) => {
        console.error('[deploy] Background deployment failed:', err);
      });

      // Create in-app notification for the deploy trigger
      await ctx.db.insert(inAppNotifications).values({
        organizationId: ctx.session.organizationId,
        title: `Deployment started: ${service.name}`,
        message: `Building from branch ${input.branch ?? service.gitBranch ?? 'main'}`,
        level: 'info',
        category: 'deployment',
        resourceId: deployment!.id,
      }).catch(() => {}); // best-effort

      return deployment;
    }),

  /** Cancel a running deployment */
  cancel: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const deployment = await ctx.db.query.deployments.findFirst({
        where: eq(deployments.id, input.id),
        with: { service: { with: { project: true } } },
      });

      if (!deployment || deployment.service.project.organizationId !== ctx.session.organizationId) {
        throw new Error('Deployment not found');
      }

      // Allow cancel unless the deploy is already in a terminal state
      const terminalStates = ['failed', 'cancelled', 'rolled_back'];
      if (terminalStates.includes(deployment.deployStatus)) {
        throw new Error('Deployment is already in a terminal state');
      }

      // Try to abort the in-flight engine pipeline and kill SSH build processes
      const wasActive = await deploymentEngine.cancelDeployment(input.id);

      // Update DB status regardless of whether the engine had it tracked
      const [updated] = await ctx.db
        .update(deployments)
        .set({
          buildStatus: ['building', 'pending'].includes(deployment.buildStatus) ? 'cancelled' : deployment.buildStatus,
          deployStatus: 'cancelled',
          errorMessage: 'Cancelled by user',
          completedAt: new Date(),
        })
        .where(eq(deployments.id, input.id))
        .returning();

      return updated;
    }),

  /** Rollback to a previous deployment */
  rollback: protectedProcedure
    .input(z.object({
      serviceId: z.string().uuid(),
      targetDeploymentId: z.string().uuid(), // The deployment to roll back to
    }))
    .mutation(async ({ ctx, input }) => {
      const targetDeploy = await ctx.db.query.deployments.findFirst({
        where: eq(deployments.id, input.targetDeploymentId),
        with: { service: { with: { project: true } } },
      });

      if (!targetDeploy || targetDeploy.service.project.organizationId !== ctx.session.organizationId) {
        throw new Error('Target deployment not found');
      }

      if (!targetDeploy.imageName || !targetDeploy.imageDigest) {
        throw new Error('Target deployment has no image to roll back to');
      }

      // Create a new deployment record for the rollback
      const [rollbackDeploy] = await ctx.db
        .insert(deployments)
        .values({
          serviceId: input.serviceId,
          triggeredBy: 'rollback',
          branch: targetDeploy.branch,
          commitSha: targetDeploy.commitSha,
          commitMessage: `Rollback to ${targetDeploy.commitSha?.slice(0, 7) ?? targetDeploy.imageName}`,
          imageName: targetDeploy.imageName,
          imageDigest: targetDeploy.imageDigest,
          buildStatus: 'built', // No build needed — reusing existing image
          deployStatus: 'pending',
          deployNodeId: targetDeploy.deployNodeId,
        })
        .returning();

      // Fire-and-forget: run deploy-only (skip build) in background
      deploymentEngine.runDeployOnly(rollbackDeploy!.id).catch((err) => {
        console.error('[deploy] Background rollback failed:', err);
      });

      return rollbackDeploy;
    }),
});
