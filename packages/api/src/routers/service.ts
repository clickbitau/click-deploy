// ============================================================
// Click-Deploy — Service Router
// ============================================================
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import { services, projects, nodes } from '@click-deploy/database';
import { createRouter, protectedProcedure } from '../trpc';
import { sanitizeDockerName, sanitizeEnvPair } from '../shell';

/** Consistent service naming — MUST match engine.ts getSwarmServiceName */
function getSwarmServiceName(serviceName: string): string {
  return sanitizeDockerName(`cd-${serviceName}`);
}

const serviceInput = z.object({
  name: z.string().min(1).max(100),
  projectId: z.string().uuid(),
  type: z.enum(['application', 'database', 'compose', 'redis', 'postgres', 'mysql', 'mongo', 'mariadb']).default('application'),
  sourceType: z.enum(['git', 'image', 'compose']),

  // Git source
  gitUrl: z.string().url().optional(),
  gitBranch: z.string().max(255).default('main'),
  gitProvider: z.enum(['github', 'gitlab', 'gitea', 'bitbucket']).optional(),

  // Dockerfile
  dockerfilePath: z.string().max(500).default('Dockerfile'),
  dockerContext: z.string().max(500).default('.'),

  // Image source
  imageName: z.string().max(500).optional(),
  imageTag: z.string().max(255).default('latest'),

  // Compose
  composeFile: z.string().optional(),

  // Node placement
  buildNodeId: z.string().uuid().optional(),
  targetNodeId: z.string().uuid().optional(), // Legacy single-node
  deployNodeIds: z.array(z.string().uuid()).default([]),

  // Config
  replicasPerNode: z.number().int().min(1).max(10).default(1),
  replicas: z.number().int().min(0).max(100).default(1),
  envVars: z.record(z.string()).default({}),
  ports: z.array(z.object({
    host: z.number().int().min(1).max(65535).optional(),
    container: z.number().int().min(1).max(65535),
    protocol: z.enum(['tcp', 'udp']).default('tcp'),
  })).default([]),
  volumes: z.array(z.object({
    type: z.enum(['volume', 'bind']).default('volume'),
    name: z.string(),
    mountPath: z.string(),
    readOnly: z.boolean().default(false),
  })).default([]),
  healthCheck: z.object({
    path: z.string().default('/'),
    interval: z.number().int().default(30),
    timeout: z.number().int().default(10),
    retries: z.number().int().default(3),
    startPeriod: z.number().int().default(30),
  }).optional(),
  resourceLimits: z.object({
    cpuLimit: z.number().optional(),
    memoryLimit: z.string().optional(), // e.g. "512m", "2g"
    cpuReservation: z.number().optional(),
    memoryReservation: z.string().optional(),
  }).optional(),
  labels: z.record(z.string()).default({}),
  autoDeploy: z.boolean().default(true),
});

export const serviceRouter = createRouter({
  /** List services for a project */
  listByProject: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Verify project belongs to org
      const project = await ctx.db.query.projects.findFirst({
        where: and(
          eq(projects.id, input.projectId),
          eq(projects.organizationId, ctx.session.organizationId)
        ),
      });

      if (!project) {
        throw new Error('Project not found');
      }

      const svcs = await ctx.db.query.services.findMany({
        where: eq(services.projectId, input.projectId),
        orderBy: [desc(services.updatedAt)],
      });
      const { decryptEnvVars } = await import('../crypto');
      return svcs.map(s => ({ ...s, envVars: decryptEnvVars(s.envVars) }));
    }),

  /** Get a single service with full details */
  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const service = await ctx.db.query.services.findFirst({
        where: eq(services.id, input.id),
        with: {
          project: true,
        },
      });

      if (!service || service.project.organizationId !== ctx.session.organizationId) {
        throw new Error('Service not found');
      }

      const { decryptEnvVars } = await import('../crypto');
      return { ...service, envVars: decryptEnvVars(service.envVars) };
    }),

  /** Create a new service */
  create: protectedProcedure
    .input(serviceInput)
    .mutation(async ({ ctx, input }) => {
      // Verify project belongs to org
      const project = await ctx.db.query.projects.findFirst({
        where: and(
          eq(projects.id, input.projectId),
          eq(projects.organizationId, ctx.session.organizationId)
        ),
      });

      if (!project) {
        throw new Error('Project not found');
      }

      let { buildNodeId, targetNodeId, deployNodeIds, replicasPerNode } = input;
      const perNode = replicasPerNode ?? 1;

      // Fetch org nodes
      const orgNodes = await ctx.db.query.nodes.findMany({
        where: eq(nodes.organizationId, ctx.session.organizationId),
      });

      // If no deploy nodes selected, auto-assign all online deploy-capable nodes
      if (!deployNodeIds || deployNodeIds.length === 0) {
        deployNodeIds = orgNodes
          .filter(n => n.canDeploy && n.status === 'online')
          .map(n => n.id);
        // Fallback: at least use the first online node
        if (deployNodeIds.length === 0) {
          const fallback = orgNodes.find(n => n.status === 'online') || orgNodes[0];
          if (fallback) deployNodeIds = [fallback.id];
        }
      }

      // Set targetNodeId to first deploy node for backward compat
      if (!targetNodeId && deployNodeIds.length > 0) {
        targetNodeId = deployNodeIds[0];
      }

      // Auto-assign build node — prefer online + canBuild
      if (!buildNodeId && orgNodes.length > 0) {
        const buildCapable = orgNodes.filter(n => n.canBuild && n.status === 'online');
        const buildNode = buildCapable[0] || orgNodes.find(n => n.status === 'online') || orgNodes[0];
        if (buildNode) buildNodeId = buildNode.id;
      }

      // Auto-calculate replicas: nodes × replicas_per_node
      const replicas = deployNodeIds.length * perNode;

      // Strip non-DB fields before insert
      const { replicasPerNode: _rpn, deployNodeIds: _dni, ...dbInput } = input;

      const { encryptEnvVars } = await import('../crypto');
      const envVars = encryptEnvVars(dbInput.envVars);

      const [service] = await ctx.db
        .insert(services)
        .values({
          ...dbInput,
          envVars,
          buildNodeId,
          targetNodeId,
          deployNodeIds,
          replicas,
        })
        .returning();

      return service;
    }),

  /** Update a service */
  update: protectedProcedure
    .input(
      z.object({ id: z.string().uuid() }).merge(serviceInput.partial().omit({ projectId: true }))
    )
    .mutation(async ({ ctx, input }) => {
      const { id, replicasPerNode, ...data } = input;

      // Verify ownership
      const existing = await ctx.db.query.services.findFirst({
        where: eq(services.id, id),
        with: { project: true },
      });

      if (!existing || existing.project.organizationId !== ctx.session.organizationId) {
        throw new Error('Service not found');
      }

      const updateData: any = { ...data, updatedAt: new Date() };
      if (data.envVars) {
        const { encryptEnvVars } = await import('../crypto');
        updateData.envVars = encryptEnvVars(data.envVars);
      }

      const [updated] = await ctx.db
        .update(services)
        .set(updateData)
        .where(eq(services.id, id))
        .returning();

      return updated;
    }),

  /** Delete a service */
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.services.findFirst({
        where: eq(services.id, input.id),
        with: { project: true },
      });

      if (!existing || existing.project.organizationId !== ctx.session.organizationId) {
        throw new Error('Service not found');
      }

      // 1. Cancel any active deployments for this service
      const { deployments } = await import('@click-deploy/database');
      const activeDeployments = await ctx.db.query.deployments.findMany({
        where: and(
          eq(deployments.serviceId, input.id),
          // pending, building, or deploying
        ),
      });
      for (const d of activeDeployments) {
        if (['pending', 'building', 'deploying'].includes(d.deployStatus)) {
          try {
            const { deploymentEngine } = await import('../engine');
            await deploymentEngine.cancelDeployment(d.id);
          } catch { /* best-effort */ }
          await ctx.db.update(deployments).set({
            buildStatus: d.buildStatus === 'building' ? 'cancelled' : d.buildStatus,
            deployStatus: 'cancelled',
            errorMessage: 'Service deleted',
            completedAt: new Date(),
          }).where(eq(deployments.id, d.id));
        }
      }

      // 2. Stop and remove Docker Swarm service if it exists
      if (existing.swarmServiceId) {
        try {
          const { nodes: nodesTable } = await import('@click-deploy/database');
          const { sshManager } = await import('@click-deploy/docker');
          const { decryptPrivateKey } = await import('../crypto');

          const managerNode = await ctx.db.query.nodes.findFirst({
            where: and(
              eq(nodesTable.organizationId, ctx.session.organizationId),
              eq(nodesTable.role, 'manager'),
              eq(nodesTable.status, 'online'),
            ),
            with: { sshKey: true },
          });

          if (managerNode?.sshKey) {
            const sshConfig = {
              host: managerNode.tailscaleIp || managerNode.host,
              port: managerNode.port,
              username: managerNode.sshUser,
              privateKey: decryptPrivateKey(managerNode.sshKey.privateKey),
            };

            const serviceName = getSwarmServiceName(existing.name);

            // Remove the Docker Swarm service
            await sshManager.exec(sshConfig, `docker service rm ${serviceName} 2>/dev/null || true`);
          }
        } catch (err) {
          console.error('[service.delete] Failed to remove Docker service:', err);
          // Continue anyway — DB cleanup is more important
        }
      }

      // 3. Delete the service record (deployments cascade via FK)
      await ctx.db.delete(services).where(eq(services.id, input.id));

      return { success: true };
    }),

  /** Restart/reload a service — force-update containers without rebuilding */
  restart: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const service = await ctx.db.query.services.findFirst({
        where: eq(services.id, input.id),
        with: { project: true },
      });

      if (!service || service.project.organizationId !== ctx.session.organizationId) {
        throw new Error('Service not found');
      }

      if (!service.swarmServiceId) {
        throw new Error('Service has no active deployment to restart');
      }

      // Get manager node to execute swarm commands
      const { sshKeys, nodes: nodesTable } = await import('@click-deploy/database');
      const { sshManager } = await import('@click-deploy/docker');
      const { decryptPrivateKey } = await import('../crypto');

      const managerNode = await ctx.db.query.nodes.findFirst({
        where: and(
          eq(nodesTable.organizationId, ctx.session.organizationId),
          eq(nodesTable.role, 'manager'),
          eq(nodesTable.status, 'online'),
        ),
        with: { sshKey: true },
      });

      if (!managerNode?.sshKey) {
        throw new Error('No online manager node found');
      }

      const sshConfig = {
        host: managerNode.tailscaleIp || managerNode.host,
        port: managerNode.port,
        username: managerNode.sshUser,
        privateKey: decryptPrivateKey(managerNode.sshKey.privateKey),
      };

      const { decryptEnvVars } = await import('../crypto');
      const envVars = decryptEnvVars(service.envVars);
      const envArgs = Object.entries(envVars)
        .map(([k, v]) => {
          const safe = sanitizeEnvPair(k, v);
          return `--env-add "${safe.key}=${safe.value}"`;
        })
        .join(' ');

      // Determine swarm service name
      const serviceName = getSwarmServiceName(service.name);

      const cmd = `docker service update --force ${envArgs} ${serviceName}`;
      const result = await sshManager.exec(sshConfig, cmd);

      if (result.code !== 0) {
        throw new Error(`Restart failed: ${result.stderr}`);
      }

      return { success: true, message: 'Service restarting with updated configuration' };
    }),

  /** Stop a service — scale to 0 replicas */
  stop: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const service = await ctx.db.query.services.findFirst({
        where: eq(services.id, input.id),
        with: { project: true },
      });
      if (!service || service.project.organizationId !== ctx.session.organizationId) {
        throw new Error('Service not found');
      }
      if (!service.swarmServiceId) throw new Error('No active deployment');

      const { nodes: nodesTable } = await import('@click-deploy/database');
      const { sshManager } = await import('@click-deploy/docker');
      const { decryptPrivateKey } = await import('../crypto');

      const managerNode = await ctx.db.query.nodes.findFirst({
        where: and(eq(nodesTable.organizationId, ctx.session.organizationId), eq(nodesTable.role, 'manager'), eq(nodesTable.status, 'online')),
        with: { sshKey: true },
      });
      if (!managerNode?.sshKey) throw new Error('No online manager node');

      const sshConfig = { host: managerNode.tailscaleIp || managerNode.host, port: managerNode.port, username: managerNode.sshUser, privateKey: decryptPrivateKey(managerNode.sshKey.privateKey) };
      const serviceName = getSwarmServiceName(service.name);

      const result = await sshManager.exec(sshConfig, `docker service scale ${serviceName}=0`);
      if (result.code !== 0) throw new Error(`Stop failed: ${result.stderr}`);

      await ctx.db.update(services).set({ status: 'stopped', updatedAt: new Date() }).where(eq(services.id, input.id));
      return { success: true };
    }),

  /** Start a stopped service — scale back to configured replicas */
  start: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const service = await ctx.db.query.services.findFirst({
        where: eq(services.id, input.id),
        with: { project: true },
      });
      if (!service || service.project.organizationId !== ctx.session.organizationId) {
        throw new Error('Service not found');
      }
      if (!service.swarmServiceId) throw new Error('No active deployment');

      const { nodes: nodesTable } = await import('@click-deploy/database');
      const { sshManager } = await import('@click-deploy/docker');
      const { decryptPrivateKey } = await import('../crypto');

      const managerNode = await ctx.db.query.nodes.findFirst({
        where: and(eq(nodesTable.organizationId, ctx.session.organizationId), eq(nodesTable.role, 'manager'), eq(nodesTable.status, 'online')),
        with: { sshKey: true },
      });
      if (!managerNode?.sshKey) throw new Error('No online manager node');

      const sshConfig = { host: managerNode.tailscaleIp || managerNode.host, port: managerNode.port, username: managerNode.sshUser, privateKey: decryptPrivateKey(managerNode.sshKey.privateKey) };
      const serviceName = getSwarmServiceName(service.name);
      const replicas = service.replicas || 1;

      const result = await sshManager.exec(sshConfig, `docker service scale ${serviceName}=${replicas}`);
      if (result.code !== 0) throw new Error(`Start failed: ${result.stderr}`);

      await ctx.db.update(services).set({ status: 'running', updatedAt: new Date() }).where(eq(services.id, input.id));
      return { success: true };
    }),

  /** Rebuild — redeploy using existing code (no git pull) */
  rebuild: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const service = await ctx.db.query.services.findFirst({
        where: eq(services.id, input.id),
        with: { project: true },
      });
      if (!service || service.project.organizationId !== ctx.session.organizationId) {
        throw new Error('Service not found');
      }

      // Auto-resolve build node (same logic as deployment trigger)
      const orgNodes = await ctx.db.query.nodes.findMany({
        where: eq(nodes.organizationId, ctx.session.organizationId),
      });

      let buildNodeId = service.buildNodeId;
      const buildCapable = orgNodes.filter((n: any) => n.canBuild && n.status === 'online');
      if (buildCapable.length > 0) {
        const configured = buildCapable.find((n: any) => n.id === service.buildNodeId);
        buildNodeId = configured ? configured.id : buildCapable[0]!.id;
      } else if (orgNodes.length > 0) {
        buildNodeId = orgNodes[0]!.id;
      }

      let deployNodeId = service.targetNodeId;
      if (!deployNodeId) {
        const deployCap = orgNodes.filter((n: any) => n.canDeploy && n.status === 'online');
        deployNodeId = deployCap.length > 0 ? deployCap[0]!.id : orgNodes[0]?.id ?? null;
      }

      // Create a new deployment
      const { deployments } = await import('@click-deploy/database');
      const [deployment] = await ctx.db.insert(deployments).values({
        serviceId: service.id,
        buildStatus: 'pending',
        deployStatus: 'pending',
        commitSha: 'rebuild',
        commitMessage: 'Manual rebuild',
        triggeredBy: 'manual',
        buildNodeId,
        deployNodeId,
      }).returning();

      // Fire the engine asynchronously
      const { deploymentEngine } = await import('../engine');
      deploymentEngine.runDeployment(deployment!.id).catch(console.error);

      return { success: true, deploymentId: deployment!.id };
    }),

  /** Get live logs for a running service */
  logs: protectedProcedure
    .input(z.object({ id: z.string().uuid(), tail: z.number().int().min(10).max(500).default(100) }))
    .query(async ({ ctx, input }) => {
      const service = await ctx.db.query.services.findFirst({
        where: eq(services.id, input.id),
        with: { project: true },
      });
      if (!service || service.project.organizationId !== ctx.session.organizationId) {
        throw new Error('Service not found');
      }
      if (!service.swarmServiceId) return { logs: 'No active deployment — no logs available.' };

      const { nodes: nodesTable } = await import('@click-deploy/database');
      const { sshManager } = await import('@click-deploy/docker');
      const { decryptPrivateKey } = await import('../crypto');

      const managerNode = await ctx.db.query.nodes.findFirst({
        where: and(eq(nodesTable.organizationId, ctx.session.organizationId), eq(nodesTable.role, 'manager'), eq(nodesTable.status, 'online')),
        with: { sshKey: true },
      });
      if (!managerNode?.sshKey) throw new Error('No online manager node');

      const sshConfig = { host: managerNode.tailscaleIp || managerNode.host, port: managerNode.port, username: managerNode.sshUser, privateKey: decryptPrivateKey(managerNode.sshKey.privateKey) };
      const serviceName = getSwarmServiceName(service.name);
      const tail = Math.max(10, Math.min(500, input.tail)); // clamp to safe range

      const result = await sshManager.exec(sshConfig, `docker service logs --tail ${tail} --no-trunc ${serviceName} 2>&1`);
      return { logs: result.stdout || result.stderr || 'No output' };
    }),

  /** Fetch live stats (CPU/Memory) for a service container */
  stats: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const serviceRecord = await ctx.db.query.services.findFirst({
        where: eq(services.id, input.id),
        with: { project: true },
      });

      if (!serviceRecord || serviceRecord.project.organizationId !== ctx.session.organizationId) {
        throw new Error('Service not found');
      }

      // Ensure we query the active node
      const { nodes: nodesTable } = await import('@click-deploy/database');
      const { sshManager } = await import('@click-deploy/docker');
      const { decryptPrivateKey } = await import('../crypto');

      const managerNode = await ctx.db.query.nodes.findFirst({
        where: and(
          eq(nodesTable.organizationId, ctx.session.organizationId),
          eq(nodesTable.role, 'manager'),
          eq(nodesTable.status, 'online')
        ),
        with: { sshKey: true },
      });

      if (!managerNode?.sshKey) return { cpu_percent: 0, mem_usage: "0B" };

      const sshConfig = {
        host: managerNode.tailscaleIp || managerNode.host,
        port: managerNode.port,
        username: managerNode.sshUser,
        privateKey: decryptPrivateKey(managerNode.sshKey.privateKey),
      };

      try {
        const serviceName = serviceRecord.name;
        // Run docker ps -q filter, then pipe to docker stats
        const statsCmd = await sshManager.exec(
          sshConfig,
          `CONTAINERS=$(docker ps -q -f "label=com.docker.swarm.service.name=${serviceName}" 2>/dev/null) && if [ -z "$CONTAINERS" ]; then echo "[]"; else docker stats --no-stream --format '{"CPUPerc":"{{.CPUPerc}}","MemUsage":"{{.MemUsage}}","MemPerc":"{{.MemPerc}}","NetIO":"{{.NetIO}}","BlockIO":"{{.BlockIO}}"}' $CONTAINERS | head -n 1; fi`
        );

        if (!statsCmd.stdout.trim() || statsCmd.stdout.trim() === '[]') {
           return { cpu_percent: 0, mem_usage: "0B" };
        }

        const statJson = JSON.parse(statsCmd.stdout.trim());
        return {
          cpu_percent: parseFloat((statJson.CPUPerc || "0").replace('%', '')),
          mem_usage: (statJson.MemUsage || "0B / 0B").split(' / ')[0],
          mem_percent: parseFloat((statJson.MemPerc || "0").replace('%', '')),
          net_io: statJson.NetIO || "0B",
          block_io: statJson.BlockIO || "0B"
        };
      } catch (err) {
        return { cpu_percent: 0, mem_usage: "0B" };
      }
    }),
});
