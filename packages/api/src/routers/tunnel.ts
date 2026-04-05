// ============================================================
// Click-Deploy — Tunnel Router (Cloudflare Tunnel)
// ============================================================
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { tunnels, tunnelRoutes, nodes, sshKeys } from '@click-deploy/database';
import { createRouter, protectedProcedure, adminProcedure } from '../trpc';
import * as crypto from 'crypto';
import { SwarmManager } from '@click-deploy/docker';
import { decryptPrivateKey } from '../crypto';

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
      const apiToken = process.env.CLOUDFLARE_API_TOKEN;
      if (!apiToken) {
        throw new Error('CLOUDFLARE_API_TOKEN is not configured on the server environment');
      }
      
      const accountId = input.cloudflareAccountId || process.env.CLOUDFLARE_ACCOUNT_ID;
      if (!accountId) {
        throw new Error('Cloudflare Account ID is required');
      }

      // Generate a required 32-byte secret for the tunnel
      const tunnelSecret = crypto.randomBytes(32);
      const secretBase64 = tunnelSecret.toString('base64');

      // 1. Call Cloudflare API to create tunnel
      const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/cfd_tunnel`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: input.name,
          tunnel_secret: secretBase64,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(`Cloudflare API Error: ${errJson.errors?.[0]?.message || res.statusText}`);
      }

      const cfData = await res.json();
      const cfTunnelId = cfData.result.id;

      // Generate the authentication token needed by `cloudflared`
      // token = base64(json({ a: accountTag, t: tunnelId, s: tunnelSecretBase64 }))
      const tokenPayload = {
        a: accountId,
        t: cfTunnelId,
        s: secretBase64,
      };
      const tokenString = Buffer.from(JSON.stringify(tokenPayload)).toString('base64');

      // 2. Fetch the target node and deploy cloudflared container via Swarm
      const nodeRecord = await ctx.db.query.nodes.findFirst({
        where: eq(nodes.id, input.nodeId),
        with: { sshKey: true },
      });

      if (!nodeRecord || !nodeRecord.sshKey) {
        throw new Error('Target node or SSH key not found');
      }

      // We deploy it as a swarm service on the target node
      const swarmNodeId = nodeRecord.swarmNodeId;
      if (!swarmNodeId) {
        throw new Error('Target node is not initialized in the Swarm');
      }

      const managerNode = await ctx.db.query.nodes.findFirst({
        where: and(
          eq(nodes.organizationId, ctx.session.organizationId),
          eq(nodes.role, 'manager'),
          eq(nodes.status, 'online')
        ),
        with: { sshKey: true },
      });

      if (!managerNode?.sshKey) throw new Error('No online manager node found to deploy the tunnel');

      const swarm = new SwarmManager({
        id: managerNode.id,
        name: managerNode.name,
        host: managerNode.tailscaleIp || managerNode.host,
        port: managerNode.port,
        sshUser: managerNode.sshUser,
        privateKey: decryptPrivateKey(managerNode.sshKey.privateKey),
      });

      const serviceName = `click-deploy-tunnel-${cfTunnelId}`;
      
      try {
        await swarm.createService({
          name: serviceName,
          image: 'cloudflare/cloudflared:latest',
          replicas: 1,
          envVars: {},
          constraints: [`node.id==${swarmNodeId}`],
          networks: ['click-deploy-net'],
        });

        // Run the cloudflared tunnel command by overriding the entrypoint config via service update
        await swarm.updateService(serviceName, 'cloudflare/cloudflared:latest', {
          force: true,
          // Docker service doesn't easily let us change CMD without re-creating, but we can pass args by re-creating it 
        });
      } catch (err) {
        // If it fails, we fall back to a manual docker command logic below or ignore
      }

      // Alternative safer Swarm stack deploy since we need exact arguments:
      const composeContent = `
version: '3.8'
services:
  tunnel:
    image: cloudflare/cloudflared:latest
    command: tunnel run --token ${tokenString}
    networks:
      - click-deploy-net
    deploy:
      replicas: 1
      placement:
        constraints:
          - node.id == ${swarmNodeId}
networks:
  click-deploy-net:
    external: true
`;
      await swarm.deployStack(`cf-${cfTunnelId}`, composeContent);

      // Save to database
      const [tunnel] = await ctx.db
        .insert(tunnels)
        .values({
          name: input.name,
          organizationId: ctx.session.organizationId,
          cloudflareTunnelId: cfTunnelId,
          cloudflareAccountId: accountId,
          token: 'REDACTED', 
          nodeId: input.nodeId,
          status: 'active',
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
      const tunnelRecord = await ctx.db.query.tunnels.findFirst({
        where: and(
          eq(tunnels.id, input.id),
          eq(tunnels.organizationId, ctx.session.organizationId)
        ),
      });

      if (!tunnelRecord) return { success: true };

      const apiToken = process.env.CLOUDFLARE_API_TOKEN;
      if (apiToken && tunnelRecord.cloudflareAccountId && tunnelRecord.cloudflareTunnelId) {
        // Call CF API to delete tunnel
        await fetch(`https://api.cloudflare.com/client/v4/accounts/${tunnelRecord.cloudflareAccountId}/cfd_tunnel/${tunnelRecord.cloudflareTunnelId}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
          },
        }).catch(console.error);
      }

      // Remove cloudflared compose stack from node
      if (tunnelRecord.cloudflareTunnelId) {
        try {
          const managerNode = await ctx.db.query.nodes.findFirst({
            where: and(
              eq(nodes.organizationId, ctx.session.organizationId),
              eq(nodes.role, 'manager'),
              eq(nodes.status, 'online')
            ),
            with: { sshKey: true },
          });

          if (managerNode?.sshKey) {
            const swarm = new SwarmManager({
              id: managerNode.id,
              name: managerNode.name,
              host: managerNode.tailscaleIp || managerNode.host,
              port: managerNode.port,
              sshUser: managerNode.sshUser,
              privateKey: decryptPrivateKey(managerNode.sshKey.privateKey),
            });
            await swarm.removeStack(`cf-${tunnelRecord.cloudflareTunnelId}`);
          }
        } catch {}
      }

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
