// ============================================================
// Click-Deploy — Node Router
// ============================================================
// Nodes are distributed worldwide — VPS, dedicated VMs, Proxmox LXC.
// The SSH layer handles NAT traversal, diverse OSes, and varying latency.
// Each node needs connectivity probing and heartbeat monitoring.
// ============================================================
import { z } from 'zod';
import { eq, and, desc, sql } from 'drizzle-orm';
import { nodes, sshKeys } from '@click-deploy/database';
import { createRouter, protectedProcedure, adminProcedure } from '../trpc';
import { deploymentEngine } from '../engine';
import { decryptPrivateKey } from '../crypto';
import { TraefikManager, RegistryManager, TailscaleManager, sshManager } from '@click-deploy/docker';
import { users } from '@click-deploy/database/src/schema/auth';
import { registries } from '@click-deploy/database/src/schema/networking';

const nodeInput = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  role: z.enum(['manager', 'worker', 'build']),
  host: z.string().min(1).max(255), // IP, hostname, or domain
  port: z.number().int().min(1).max(65535).default(22),
  sshUser: z.string().min(1).max(100).default('root'),
  sshKeyId: z.string().uuid(),
  canBuild: z.boolean().default(true),
  canDeploy: z.boolean().default(true),
  labels: z.record(z.string()).default({}),
  resources: z.object({
    cpuCores: z.number().int().optional(),
    memoryGb: z.number().optional(),
    diskGb: z.number().optional(),
    // Location metadata — critical for multi-region deployments
    region: z.string().optional(),         // e.g. "sg-1", "us-east", "eu-west"
    provider: z.string().optional(),       // e.g. "hetzner", "vultr", "proxmox", "bare-metal"
    datacenter: z.string().optional(),     // e.g. "fsn1-dc14"
    networkType: z.enum(['public', 'private', 'tailscale', 'wireguard', 'cloudflare-tunnel']).optional(),
  }).default({}),
});

export const nodeRouter = createRouter({
  /** List all nodes for the current organization */
  list: protectedProcedure
    .input(
      z.object({
        role: z.enum(['manager', 'worker', 'build']).optional(),
        status: z.enum(['online', 'offline', 'maintenance']).optional(),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(nodes.organizationId, ctx.session.organizationId)];
      if (input?.role) conditions.push(eq(nodes.role, input.role));
      if (input?.status) conditions.push(eq(nodes.status, input.status));

      return ctx.db.query.nodes.findMany({
        where: and(...conditions),
        with: {
          sshKey: {
            columns: {
              id: true,
              name: true,
              fingerprint: true,
              // Never expose private key in list queries
            },
          },
        },
        orderBy: [desc(nodes.lastHeartbeatAt)],
      });
    }),

  /** Get a single node with details */
  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const node = await ctx.db.query.nodes.findFirst({
        where: and(
          eq(nodes.id, input.id),
          eq(nodes.organizationId, ctx.session.organizationId)
        ),
        with: {
          sshKey: {
            columns: {
              id: true,
              name: true,
              fingerprint: true,
            },
          },
        },
      });

      if (!node) {
        throw new Error('Node not found');
      }

      return node;
    }),

  /** Add a new node to the cluster */
  create: adminProcedure
    .input(nodeInput)
    .mutation(async ({ ctx, input }) => {
      // Verify SSH key belongs to org
      const key = await ctx.db.query.sshKeys.findFirst({
        where: and(
          eq(sshKeys.id, input.sshKeyId),
          eq(sshKeys.organizationId, ctx.session.organizationId)
        ),
      });

      if (!key) {
        throw new Error('SSH key not found');
      }

      const [node] = await ctx.db
        .insert(nodes)
        .values({
          ...input,
          organizationId: ctx.session.organizationId,
          status: 'offline', // Will change to 'online' after connectivity test
        })
        .returning();

      // Fire-and-forget: test connectivity and update status
      (async () => {
        try {
          const result = await deploymentEngine.testNodeConnectivity({
            id: node!.id,
            name: node!.name,
            host: input.host,
            port: input.port,
            sshUser: input.sshUser,
            privateKey: decryptPrivateKey(key.privateKey),
          });

          if (result.success) {
            await ctx.db.update(nodes).set({
              status: 'online',
              dockerVersion: result.dockerVersion,
              resources: {
                cpuCores: result.cpuCores,
                memoryTotal: result.memoryTotal,
                diskTotal: result.diskTotal,
                os: result.os,
              },
              lastHeartbeatAt: new Date(),
            }).where(eq(nodes.id, node!.id));
            // Note: Auto-deploy Traefik & Registry happens in testConnectivity
          }
        } catch (err) {
          console.error('[node] Connectivity test failed:', err);
        }
      })();

      return node;
    }),

  /** Update a node */
  update: adminProcedure
    .input(
      z.object({ id: z.string().uuid() }).merge(nodeInput.partial())
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const [updated] = await ctx.db
        .update(nodes)
        .set({ ...data, updatedAt: new Date() })
        .where(
          and(
            eq(nodes.id, id),
            eq(nodes.organizationId, ctx.session.organizationId)
          )
        )
        .returning();

      return updated;
    }),

  /** Remove a node from the cluster */
  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const node = await ctx.db.query.nodes.findFirst({
        where: and(
          eq(nodes.id, input.id),
          eq(nodes.organizationId, ctx.session.organizationId),
        ),
        with: { sshKey: true },
      });

      if (!node) throw new Error('Node not found');

      // 1. Drain the node from Swarm if it has a swarmNodeId
      if (node.swarmNodeId) {
        try {
          const managerNode = await ctx.db.query.nodes.findFirst({
            where: and(
              eq(nodes.organizationId, ctx.session.organizationId),
              eq(nodes.role, 'manager'),
              eq(nodes.status, 'online'),
            ),
            with: { sshKey: true },
          });

          if (managerNode?.sshKey) {
            const sshConfig = {
              host: managerNode.host,
              port: managerNode.port,
              username: managerNode.sshUser,
              privateKey: decryptPrivateKey(managerNode.sshKey.privateKey),
            };
            // Drain then remove from Swarm
            await sshManager.exec(sshConfig, `docker node update --availability drain ${node.swarmNodeId} 2>/dev/null || true`);
            // Wait a moment for tasks to migrate
            await new Promise(r => setTimeout(r, 3000));
            await sshManager.exec(sshConfig, `docker node rm --force ${node.swarmNodeId} 2>/dev/null || true`);
          }
        } catch (err) {
          console.error('[node.delete] Failed to drain/remove from Swarm:', err);
        }
      }

      // 2. Null-out services referencing this node
      const { services } = await import('@click-deploy/database');
      await ctx.db.update(services)
        .set({ buildNodeId: null })
        .where(eq(services.buildNodeId, input.id));
      await ctx.db.update(services)
        .set({ targetNodeId: null })
        .where(eq(services.targetNodeId, input.id));

      // 3. Delete the node record
      await ctx.db
        .delete(nodes)
        .where(
          and(
            eq(nodes.id, input.id),
            eq(nodes.organizationId, ctx.session.organizationId)
          )
        );

      return { success: true };
    }),

  /** Set a node to maintenance mode (drain in Swarm) */
  setMaintenance: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      maintenance: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const node = await ctx.db.query.nodes.findFirst({
        where: and(
          eq(nodes.id, input.id),
          eq(nodes.organizationId, ctx.session.organizationId),
        ),
      });

      if (!node) throw new Error('Node not found');

      // Actually drain/activate the node in Docker Swarm
      if (node.swarmNodeId) {
        try {
          const managerNode = await ctx.db.query.nodes.findFirst({
            where: and(
              eq(nodes.organizationId, ctx.session.organizationId),
              eq(nodes.role, 'manager'),
              eq(nodes.status, 'online'),
            ),
            with: { sshKey: true },
          });

          if (managerNode?.sshKey) {
            const sshConfig = {
              host: managerNode.host,
              port: managerNode.port,
              username: managerNode.sshUser,
              privateKey: decryptPrivateKey(managerNode.sshKey.privateKey),
            };
            const availability = input.maintenance ? 'drain' : 'active';
            await sshManager.exec(sshConfig, `docker node update --availability ${availability} ${node.swarmNodeId}`);
          }
        } catch (err) {
          console.error('[node.setMaintenance] Failed to update Swarm availability:', err);
        }
      }

      const [updated] = await ctx.db
        .update(nodes)
        .set({
          status: input.maintenance ? 'maintenance' : 'online',
          swarmStatus: input.maintenance ? 'drain' : 'active',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(nodes.id, input.id),
            eq(nodes.organizationId, ctx.session.organizationId)
          )
        )
        .returning();

      return updated;
    }),

  /** Update heartbeat — called by the health monitoring system */
  heartbeat: protectedProcedure
    .input(z.object({
      nodeId: z.string().uuid(),
      dockerVersion: z.string().optional(),
      resources: z.object({
        cpuUsage: z.number().optional(),
        memoryUsed: z.number().optional(),
        memoryTotal: z.number().optional(),
        diskUsed: z.number().optional(),
        diskTotal: z.number().optional(),
      }).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(nodes)
        .set({
          lastHeartbeatAt: new Date(),
          status: 'online',
          ...(input.dockerVersion && { dockerVersion: input.dockerVersion }),
          ...(input.resources && { resources: input.resources }),
        })
        .where(
          and(
            eq(nodes.id, input.nodeId),
            eq(nodes.organizationId, ctx.session.organizationId)
          )
        );

      return { success: true };
    }),

  /** Get cluster overview stats */
  clusterStats: protectedProcedure.query(async ({ ctx }) => {
    const allNodes = await ctx.db.query.nodes.findMany({
      where: eq(nodes.organizationId, ctx.session.organizationId),
    });

    return {
      total: allNodes.length,
      online: allNodes.filter((n) => n.status === 'online').length,
      offline: allNodes.filter((n) => n.status === 'offline').length,
      maintenance: allNodes.filter((n) => n.status === 'maintenance').length,
      managers: allNodes.filter((n) => n.role === 'manager').length,
      workers: allNodes.filter((n) => n.role === 'worker').length,
      buildServers: allNodes.filter((n) => n.role === 'build').length,
    };
  }),

  /** Inject SSH public key onto a remote server using password auth */
  injectKey: adminProcedure
    .input(z.object({
      host: z.string().min(1),
      port: z.number().int().default(22),
      username: z.string().min(1).default('root'),
      password: z.string().min(1),
      sshKeyId: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Get the public key to inject
      const key = await ctx.db.query.sshKeys.findFirst({
        where: and(
          eq(sshKeys.id, input.sshKeyId),
          eq(sshKeys.organizationId, ctx.session.organizationId)
        ),
      });

      if (!key?.publicKey) {
        throw new Error('SSH key not found or has no public key');
      }

      // Set up manager config for Tailscale tunnelling
      const managerNode = await ctx.db.query.nodes.findFirst({
        where: and(
          eq(nodes.organizationId, ctx.session.organizationId),
          eq(nodes.role, 'manager'),
          eq(nodes.status, 'online'),
        ),
        with: { sshKey: true },
      });

      if (managerNode?.sshKey) {
        sshManager.setManagerConfig({
          host: managerNode.host,
          port: managerNode.port,
          username: managerNode.sshUser,
          privateKey: decryptPrivateKey(managerNode.sshKey.privateKey),
        });
      }

      // Connect via password and install the public key
      const result = await sshManager.injectPublicKey({
        host: input.host,
        port: input.port,
        username: input.username,
        password: input.password,
        publicKey: key.publicKey,
      });

      if (!result.success) {
        throw new Error(`Key injection failed: ${result.error}`);
      }

      return { success: true };
    }),

  /** Test connectivity to a specific node */
  testConnectivity: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const node = await ctx.db.query.nodes.findFirst({
        where: and(
          eq(nodes.id, input.id),
          eq(nodes.organizationId, ctx.session.organizationId)
        ),
        with: { sshKey: true },
      });

      if (!node) throw new Error('Node not found');
      if (!node.sshKey) throw new Error('SSH key not found for node');

      // Set up manager config for Tailscale IP tunnelling
      // (Docker container can't reach 100.x.x.x directly — routes through manager SSH)
      const managerNode = await ctx.db.query.nodes.findFirst({
        where: and(
          eq(nodes.organizationId, ctx.session.organizationId),
          eq(nodes.role, 'manager'),
          eq(nodes.status, 'online'),
        ),
        with: { sshKey: true },
      });

      if (managerNode?.sshKey) {
        sshManager.setManagerConfig({
          host: managerNode.host,
          port: managerNode.port,
          username: managerNode.sshUser,
          privateKey: decryptPrivateKey(managerNode.sshKey.privateKey),
        });
      }

      const result = await deploymentEngine.testNodeConnectivity({
        id: node.id,
        name: node.name,
        host: node.host,
        port: node.port,
        sshUser: node.sshUser,
        privateKey: decryptPrivateKey(node.sshKey.privateKey),
      });

      if (result.success) {
        await ctx.db.update(nodes).set({
          status: 'online',
          dockerVersion: result.dockerVersion,
          runtimeType: result.runtimeType || 'host',
          resources: {
            cpuCores: result.cpuCores,
            memoryTotal: result.memoryTotal,
            diskTotal: result.diskTotal,
            os: result.os,
          },
          lastHeartbeatAt: new Date(),
        }).where(eq(nodes.id, node.id));

        // Auto-deploy Traefik and Registry if this is a manager node
        if (node.role === 'manager') {
          try {
            const user = await ctx.db.query.users.findFirst({
              where: eq(users.id, ctx.session.userId)
            });

            const managerNodeConfig = {
              id: node.id,
              name: node.name,
              host: node.host,
              port: node.port,
              sshUser: node.sshUser,
              privateKey: decryptPrivateKey(node.sshKey.privateKey)
            };

            const traefik = new TraefikManager(managerNodeConfig);
            await traefik.deploy({ acmeEmail: user?.email || 'admin@example.com', dashboardEnabled: true, logLevel: 'INFO' });

            const registry = new RegistryManager(managerNodeConfig);
            const regResult = await registry.deploy({ sslEnabled: false });

            if (regResult.created) {
              await ctx.db.insert(registries).values({
                name: 'Self-Hosted Registry',
                organizationId: ctx.session.organizationId,
                type: 'self_hosted',
                url: regResult.registryUrl,
                isDefault: true,
              }).onConflictDoNothing();
            }

            // Auto-install Tailscale binary (auth happens via UI)
            const tailscale = new TailscaleManager(managerNodeConfig);
            await tailscale.install();
          } catch (e) {
            console.error('[node] Auto-deploy infrastructure failed:', e);
          }
        }
      }

      return result;
    }),
});
