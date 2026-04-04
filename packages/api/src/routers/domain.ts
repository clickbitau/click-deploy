// ============================================================
// Click-Deploy — Domain Router
// ============================================================
// Manages domain → service routing.
// When a domain is added/removed, updates Traefik labels
// on the running Swarm service for live routing changes.
// ============================================================
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { domains, services, projects, nodes, sshKeys } from '@click-deploy/database';
import { createRouter, protectedProcedure, adminProcedure } from '../trpc';
import {
  TraefikManager,
  generateTraefikLabels,
  type TraefikRouteConfig,
} from '@click-deploy/docker';
import { decryptPrivateKey } from '../crypto';

export const domainRouter = createRouter({
  /** List all domains for a service */
  listByService: protectedProcedure
    .input(z.object({ serviceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.query.domains.findMany({
        where: eq(domains.serviceId, input.serviceId),
        with: {
          tunnel: {
            columns: { id: true, name: true, status: true },
          },
        },
      });
    }),

  /** List all domains across the organization */
  listAll: protectedProcedure.query(async ({ ctx }) => {
    const orgProjects = await ctx.db.query.projects.findMany({
      where: eq(projects.organizationId, ctx.session.organizationId),
      columns: { id: true },
    });

    if (orgProjects.length === 0) return [];

    const allDomains = await ctx.db.query.domains.findMany({
      with: {
        service: {
          columns: { id: true, name: true, projectId: true },
          with: {
            project: {
              columns: { id: true, name: true, organizationId: true },
            },
          },
        },
        tunnel: {
          columns: { id: true, name: true, status: true },
        },
      },
    });

    return allDomains.filter(
      (d) => d.service.project.organizationId === ctx.session.organizationId
    );
  }),

  /** Add a domain to a service — auto-configures Traefik routing */
  create: adminProcedure
    .input(z.object({
      serviceId: z.string().uuid(),
      hostname: z.string().min(1).max(255)
        .regex(/^(\*\.)?([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/, {
          message: 'Must be a valid hostname (e.g. app.example.com or *.example.com)',
        }),
      sslEnabled: z.boolean().default(true),
      sslProvider: z.enum(['letsencrypt', 'cloudflare', 'custom', 'none']).default('letsencrypt'),
      tunnelId: z.string().uuid().optional(),
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

      const [domain] = await ctx.db
        .insert(domains)
        .values(input)
        .returning();

      // Update Traefik labels on the running Swarm service (fire-and-forget)
      updateTraefikForService(ctx.db, service.id, ctx.session.organizationId).catch((err) => {
        console.error('[domain] Failed to update Traefik labels:', err);
      });

      return domain;
    }),

  /** Delete a domain — removes Traefik routing */
  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Verify ownership through service → project → org chain
      const domain = await ctx.db.query.domains.findFirst({
        where: eq(domains.id, input.id),
        with: {
          service: { with: { project: true } },
        },
      });

      if (!domain || domain.service.project.organizationId !== ctx.session.organizationId) {
        throw new Error('Domain not found');
      }

      const serviceId = domain.serviceId;

      await ctx.db.delete(domains).where(eq(domains.id, input.id));

      // Update Traefik labels on the running Swarm service (fire-and-forget)
      updateTraefikForService(ctx.db, serviceId, ctx.session.organizationId).catch((err) => {
        console.error('[domain] Failed to update Traefik labels:', err);
      });

      return { success: true };
    }),
});

/**
 * Re-sync ALL Traefik labels for a service based on its current domains.
 * Called when domains are added or removed.
 */
async function updateTraefikForService(
  db: any,
  serviceId: string,
  organizationId: string,
): Promise<void> {
  // 1. Get the service with its Swarm name
  const service = await db.query.services.findFirst({
    where: eq(services.id, serviceId),
    with: {
      project: true,
    },
  });
  if (!service?.swarmServiceId) return; // Not deployed yet — labels will be added on next deploy

  // 2. Get all domains for this service
  const serviceDomains = await db.query.domains.findMany({
    where: eq(domains.serviceId, serviceId),
  });

  // 3. Get the manager node to execute the update
  const managerNode = await db.query.nodes.findFirst({
    where: and(
      eq(nodes.organizationId, organizationId),
      eq(nodes.role, 'manager'),
      eq(nodes.status, 'online'),
    ),
    with: { sshKey: true },
  });

  if (!managerNode?.sshKey) {
    console.warn('[domain] No online manager node found — Traefik labels will be applied on next deploy');
    return;
  }

  const swarmServiceName = `cd-${service.name}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const containerPort = (service.ports as any[])?.[0]?.container || 3000;

  // 4. Build the Traefik labels from current domains
  const routes: TraefikRouteConfig[] = serviceDomains.map((d: any, idx: number) => ({
    routerName: idx === 0 ? swarmServiceName : `${swarmServiceName}-${idx}`,
    hostname: d.hostname,
    targetPort: containerPort,
    sslEnabled: d.sslEnabled,
    sslProvider: d.sslProvider,
  }));

  const labels = serviceDomains.length > 0
    ? generateTraefikLabels(swarmServiceName, routes)
    : { 'traefik.enable': 'false' };

  // 5. Apply labels to the running Swarm service
  const traefik = new TraefikManager({
    id: managerNode.id,
    name: managerNode.name,
    host: managerNode.host,
    port: managerNode.port,
    sshUser: managerNode.sshUser,
    privateKey: decryptPrivateKey(managerNode.sshKey.privateKey),
  });

  await traefik.updateServiceLabels(swarmServiceName, labels);
  console.log(`[domain] Updated Traefik labels for ${swarmServiceName} (${serviceDomains.length} domain(s))`);
}
