// ============================================================
// Click-Deploy — Domain Router
// ============================================================
// Manages domain → service routing.
// When a domain is added/removed, updates Traefik labels
// on the running Swarm service for live routing changes.
// When sslProvider is 'cloudflare', also provisions the
// Cloudflare Tunnel public hostname + DNS CNAME automatically.
// ============================================================
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { domains, services, projects, nodes, sshKeys, tunnels } from '@click-deploy/database';
import { createRouter, protectedProcedure, adminProcedure } from '../trpc';
import {
  TraefikManager,
  generateTraefikLabels,
  type TraefikRouteConfig,
} from '@click-deploy/docker';
import { decryptPrivateKey } from '../crypto';
import {
  provisionDomainViaTunnel,
  deprovisionDomainFromTunnel,
  lookupZoneId,
} from '../cloudflare';

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

  /** Add a domain to a service — auto-configures Traefik routing + optional CF Tunnel */
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

      // Determine if we should provision via Cloudflare Tunnel
      const apiToken = process.env.CLOUDFLARE_API_TOKEN;
      const envTunnelId = process.env.CLOUDFLARE_TUNNEL_ID;
      const envAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;

      const shouldUseTunnel =
        input.sslProvider === 'cloudflare' ||
        (!!envTunnelId && !!envAccountId && !!apiToken);

      let cfResult: { cname: string; zoneId: string | null; dnsCreated: boolean } | null = null;

      if (shouldUseTunnel && apiToken) {
        // Resolve the tunnel ID: prefer explicit tunnelId arg, then env, then DB tunnel for org
        let resolvedTunnelId = envTunnelId;
        let resolvedAccountId = envAccountId;

        if (input.tunnelId) {
          const dbTunnel = await ctx.db.query.tunnels.findFirst({
            where: and(
              eq(tunnels.id, input.tunnelId),
              eq(tunnels.organizationId, ctx.session.organizationId),
            ),
          });
          if (dbTunnel?.cloudflareTunnelId && dbTunnel?.cloudflareAccountId) {
            resolvedTunnelId = dbTunnel.cloudflareTunnelId;
            resolvedAccountId = dbTunnel.cloudflareAccountId;
          }
        } else if (!resolvedTunnelId) {
          // Auto-detect first tunnel for org
          const orgTunnel = await ctx.db.query.tunnels.findFirst({
            where: eq(tunnels.organizationId, ctx.session.organizationId),
          });
          if (orgTunnel?.cloudflareTunnelId && orgTunnel?.cloudflareAccountId) {
            resolvedTunnelId = orgTunnel.cloudflareTunnelId;
            resolvedAccountId = orgTunnel.cloudflareAccountId;
          }
        }

        if (resolvedTunnelId && resolvedAccountId) {
          cfResult = await provisionDomainViaTunnel({
            apiToken,
            accountId: resolvedAccountId,
            tunnelId: resolvedTunnelId,
            hostname: input.hostname,
            originService: 'http://localhost:80', // Traefik on host:80
          }).catch((err) => {
            console.error('[domain] CF tunnel provisioning failed:', err);
            return null;
          });
        }
      }

      // Update Traefik labels on the running Swarm service (fire-and-forget)
      updateTraefikForService(ctx.db, service.id, ctx.session.organizationId).catch((err) => {
        console.error('[domain] Failed to update Traefik labels:', err);
      });

      return { ...domain, cloudflare: cfResult };
    }),

  /** Delete a domain — removes Traefik routing + CF Tunnel hostname */
  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Verify ownership through service → project → org chain
      const domain = await ctx.db.query.domains.findFirst({
        where: eq(domains.id, input.id),
        with: {
          service: { with: { project: true } },
          tunnel: true,
        },
      });

      if (!domain || domain.service.project.organizationId !== ctx.session.organizationId) {
        throw new Error('Domain not found');
      }

      const serviceId = domain.serviceId;

      // Deprovision from Cloudflare Tunnel (best-effort)
      const apiToken = process.env.CLOUDFLARE_API_TOKEN;
      const envTunnelId = process.env.CLOUDFLARE_TUNNEL_ID;
      const envAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;

      if (apiToken) {
        let tunnelId = domain.tunnel?.cloudflareTunnelId ?? null;
        let accountId = domain.tunnel?.cloudflareAccountId ?? null;

        // Fall back to env-configured global tunnel
        if (!tunnelId && envTunnelId && envAccountId) {
          tunnelId = envTunnelId;
          accountId = envAccountId;
        }

        if (tunnelId && accountId) {
          deprovisionDomainFromTunnel({
            apiToken,
            accountId,
            tunnelId,
            hostname: domain.hostname,
          }).catch((err) => console.warn('[domain] CF deprovision error:', err));
        }
      }

      await ctx.db.delete(domains).where(eq(domains.id, input.id));

      // Update Traefik labels on the running Swarm service (fire-and-forget)
      updateTraefikForService(ctx.db, serviceId, ctx.session.organizationId).catch((err) => {
        console.error('[domain] Failed to update Traefik labels:', err);
      });

      return { success: true };
    }),

  /**
   * Check the live DNS status of a hostname.
   * Returns whether the hostname is:  
   *   - pointed to our CF tunnel CNAME (.cfargotunnel.com)
   *   - pointed to a direct IP (A record mode)
   *   - unresolvable (not configured yet)
   */
  checkDns: protectedProcedure
    .input(z.object({ hostname: z.string() }))
    .query(async ({ ctx, input }) => {
      const apiToken = process.env.CLOUDFLARE_API_TOKEN;
      if (!apiToken) return { status: 'unknown' as const, message: 'Cloudflare API not configured' };

      try {
        const zoneId = await lookupZoneId(apiToken, input.hostname);
        if (!zoneId) {
          return { status: 'not_in_cloudflare' as const, message: 'Domain zone not found in your Cloudflare account' };
        }

        // Query CF DNS API
        const res = await fetch(
          `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?name=${encodeURIComponent(input.hostname)}`,
          { headers: { Authorization: `Bearer ${apiToken}` } },
        );
        const json: any = await res.json();
        const records: any[] = json.result ?? [];

        const cname = records.find((r: any) => r.type === 'CNAME');
        const aRecord = records.find((r: any) => r.type === 'A');

        const envTunnelId = process.env.CLOUDFLARE_TUNNEL_ID;
        if (cname && envTunnelId && cname.content === `${envTunnelId}.cfargotunnel.com`) {
          return { status: 'tunnel_ok' as const, message: `✓ CNAME → ${cname.content}` };
        } else if (cname) {
          return { status: 'cname_other' as const, message: `CNAME → ${cname.content}` };
        } else if (aRecord) {
          return { status: 'a_record' as const, message: `A → ${aRecord.content}` };
        } else {
          return { status: 'no_record' as const, message: 'No DNS record found' };
        }
      } catch (err: any) {
        return { status: 'error' as const, message: err.message };
      }
    }),
});

/**
 * Re-sync ALL Traefik labels for a service based on its current domains.
 * Called when domains are added or removed.
 */
async function updateTraefikForService(
  db: typeof import('@click-deploy/database').db,
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
  const routes: TraefikRouteConfig[] = serviceDomains.map((d: typeof domains.$inferSelect, idx: number) => ({
    routerName: idx === 0 ? swarmServiceName : `${swarmServiceName}-${idx}`,
    hostname: d.hostname,
    targetPort: containerPort,
    sslEnabled: d.sslEnabled,
    sslProvider: (d.sslProvider as "custom" | "letsencrypt" | "cloudflare" | "none") || undefined,
  }));

  const labels = serviceDomains.length > 0
    ? generateTraefikLabels(swarmServiceName, routes)
    : { 'traefik.enable': 'false' };

  // 5. Apply labels to the running Swarm service
  const traefik = new TraefikManager({
    id: managerNode.id,
    name: managerNode.name,
    host: managerNode.tailscaleIp || managerNode.host,
    port: managerNode.port,
    sshUser: managerNode.sshUser,
    privateKey: decryptPrivateKey(managerNode.sshKey.privateKey),
  });

  await traefik.updateServiceLabels(swarmServiceName, labels);
  console.log(`[domain] Updated Traefik labels for ${swarmServiceName} (${serviceDomains.length} domain(s))`);
}
