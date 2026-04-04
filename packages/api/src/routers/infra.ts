// ============================================================
// Click-Deploy — Infrastructure Router
// ============================================================
// Manages Traefik reverse proxy, Docker registry, Tailscale,
// and Docker storage cleanup across all nodes.
// ============================================================
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { nodes, registries } from '@click-deploy/database';
import { createRouter, adminProcedure } from '../trpc';
import { TraefikManager, RegistryManager, TailscaleManager, sshManager } from '@click-deploy/docker';
import { decryptPrivateKey } from '../crypto';

/**
 * Helper: Get the manager node with decrypted SSH key.
 */
async function getManagerNode(db: any, organizationId: string) {
  const node = await db.query.nodes.findFirst({
    where: and(
      eq(nodes.organizationId, organizationId),
      eq(nodes.role, 'manager'),
      eq(nodes.status, 'online'),
    ),
    with: { sshKey: true },
  });

  if (!node?.sshKey) {
    throw new Error('No online manager node found. Add a manager node first.');
  }

  return {
    id: node.id,
    name: node.name,
    host: node.host,
    port: node.port,
    sshUser: node.sshUser,
    privateKey: decryptPrivateKey(node.sshKey.privateKey),
  };
}

/**
 * Helper: Set up the SSH manager with Tailscale tunnel config if needed.
 */
async function setupTunnelConfig(db: any, organizationId: string, targetHost: string) {
  const managerNode = await db.query.nodes.findFirst({
    where: and(
      eq(nodes.organizationId, organizationId),
      eq(nodes.role, 'manager'),
      eq(nodes.status, 'online'),
    ),
    with: { sshKey: true },
  });

  if (managerNode?.sshKey && managerNode.host !== targetHost) {
    sshManager.setManagerConfig({
      host: managerNode.host,
      port: managerNode.port,
      username: managerNode.sshUser,
      privateKey: decryptPrivateKey(managerNode.sshKey.privateKey),
    });
  }
}

export const infraRouter = createRouter({
  /** Deploy or update Traefik on the manager node */
  deployTraefik: adminProcedure
    .input(z.object({
      acmeEmail: z.string().email(),
      dashboardEnabled: z.boolean().default(true),
      logLevel: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']).default('INFO'),
    }))
    .mutation(async ({ ctx, input }) => {
      const manager = await getManagerNode(ctx.db, ctx.session.organizationId);
      const traefik = new TraefikManager(manager);

      const result = await traefik.deploy({
        acmeEmail: input.acmeEmail,
        dashboardEnabled: input.dashboardEnabled,
        logLevel: input.logLevel,
      });

      return {
        ...result,
        message: result.created
          ? 'Traefik deployed successfully. SSL will auto-provision when domains are added.'
          : 'Traefik updated to latest version.',
      };
    }),

  /** Check Traefik status */
  traefikStatus: adminProcedure.query(async ({ ctx }) => {
    try {
      const manager = await getManagerNode(ctx.db, ctx.session.organizationId);
      const traefik = new TraefikManager(manager);
      return await traefik.getStatus();
    } catch {
      return { running: false };
    }
  }),

  /** Remove Traefik */
  removeTraefik: adminProcedure.mutation(async ({ ctx }) => {
    const manager = await getManagerNode(ctx.db, ctx.session.organizationId);
    const traefik = new TraefikManager(manager);
    await traefik.remove();
    return { success: true };
  }),

  /** Deploy self-hosted Docker registry */
  deployRegistry: adminProcedure
    .input(z.object({
      name: z.string().default('Self-Hosted Registry'),
      hostname: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const manager = await getManagerNode(ctx.db, ctx.session.organizationId);
      const registry = new RegistryManager(manager);

      const result = await registry.deploy({
        hostname: input.hostname,
        sslEnabled: !!input.hostname,
      });

      if (result.created) {
        await ctx.db.insert(registries).values({
          name: input.name,
          organizationId: ctx.session.organizationId,
          type: 'self_hosted',
          url: result.registryUrl,
          isDefault: true,
        });
      }

      return {
        ...result,
        message: result.created
          ? `Registry deployed at ${result.registryUrl}`
          : 'Registry already running.',
      };
    }),

  /** Check registry status */
  registryStatus: adminProcedure.query(async ({ ctx }) => {
    try {
      const manager = await getManagerNode(ctx.db, ctx.session.organizationId);
      const registry = new RegistryManager(manager);
      const running = await registry.isRunning();
      return {
        running,
        url: running ? registry.getRegistryUrl() : undefined,
      };
    } catch {
      return { running: false };
    }
  }),

  /** Deploy/authenticate Tailscale on the manager node */
  deployTailscale: adminProcedure
    .input(z.object({
      authKey: z.string().min(1, 'Tailscale auth key is required'),
    }))
    .mutation(async ({ ctx, input }) => {
      const manager = await getManagerNode(ctx.db, ctx.session.organizationId);
      const tailscale = new TailscaleManager(manager);

      const result = await tailscale.authenticate(input.authKey);

      return {
        ...result,
        message: result.ipAddress
          ? `Tailscale authenticated. Node IP: ${result.ipAddress}`
          : 'Tailscale authenticated successfully.',
      };
    }),

  /** Check Tailscale status */
  tailscaleStatus: adminProcedure.query(async ({ ctx }) => {
    try {
      const manager = await getManagerNode(ctx.db, ctx.session.organizationId);
      const tailscale = new TailscaleManager(manager);
      return await tailscale.getStatus();
    } catch {
      return { installed: false, running: false, authenticated: false };
    }
  }),

  /** Remove Tailscale */
  removeTailscale: adminProcedure.mutation(async ({ ctx }) => {
    const manager = await getManagerNode(ctx.db, ctx.session.organizationId);
    const tailscale = new TailscaleManager(manager);
    await tailscale.remove();
    return { success: true };
  }),

  /** Get full infrastructure overview */
  status: adminProcedure.query(async ({ ctx }) => {
    try {
      const manager = await getManagerNode(ctx.db, ctx.session.organizationId);
      
      const allManagers = await ctx.db.query.nodes.findMany({
        where: and(
          eq(nodes.organizationId, ctx.session.organizationId),
          eq(nodes.role, 'manager'),
          eq(nodes.status, 'online')
        )
      });
      const traefik = new TraefikManager(manager);
      const registry = new RegistryManager(manager);
      const tailscale = new TailscaleManager(manager);

      const [traefikStatus, registryRunning, tailscaleStatus] = await Promise.allSettled([
        traefik.getStatus(),
        registry.isRunning(),
        tailscale.getStatus(),
      ]);

      return {
        managerNode: { name: manager.name, host: manager.host },
        managerNodes: allManagers.map(m => ({ name: m.name, host: m.host })),
        traefik: traefikStatus.status === 'fulfilled' ? traefikStatus.value : { running: false },
        registry: {
          running: registryRunning.status === 'fulfilled' ? registryRunning.value : false,
          url: registryRunning.status === 'fulfilled' && registryRunning.value
            ? registry.getRegistryUrl()
            : undefined,
        },
        tailscale: tailscaleStatus.status === 'fulfilled'
          ? tailscaleStatus.value
          : { installed: false, running: false, authenticated: false },
      };
    } catch {
      return {
        managerNode: null,
        managerNodes: [],
        traefik: { running: false },
        registry: { running: false },
        tailscale: { installed: false, running: false, authenticated: false },
      };
    }
  }),

  /** Get Docker storage usage for any node */
  dockerStorage: adminProcedure
    .input(z.object({ nodeId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      try {
        // Get all online nodes
        const allNodes = await ctx.db.query.nodes.findMany({
          where: and(
            eq(nodes.organizationId, ctx.session.organizationId),
            eq(nodes.status, 'online'),
          ),
          with: { sshKey: true },
        });

        if (allNodes.length === 0) {
          throw new Error('No online nodes found');
        }

        // Pick target node
        const targetNode = input?.nodeId
          ? allNodes.find((n: any) => n.id === input.nodeId)
          : allNodes.find((n: any) => n.role === 'manager') || allNodes[0];

        if (!targetNode?.sshKey) {
          throw new Error('Node not found or has no SSH key');
        }

        // Set up tunnel config for Tailscale IPs
        await setupTunnelConfig(ctx.db, ctx.session.organizationId, targetNode.host);

        console.log(`[storage] Connecting to ${targetNode.name} (${targetNode.host})...`);

        const client = await sshManager.connect({
          host: targetNode.host,
          port: targetNode.port,
          username: targetNode.sshUser,
          privateKey: decryptPrivateKey(targetNode.sshKey.privateKey),
        });

        const output = await new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Command timeout after 15s')), 15_000);
          client.exec(
            'echo "===DISK===" && df -h / --output=size,used,avail,pcent 2>/dev/null | tail -1 && echo "===DOCKER===" && docker system df --format "{{.Type}}\t{{.TotalCount}}\t{{.Active}}\t{{.Size}}\t{{.Reclaimable}}" 2>/dev/null && echo "===IMAGES===" && docker image ls --format "{{.ID}}\t{{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedSince}}" 2>/dev/null && echo "===CONTAINERS===" && docker ps -a --filter status=exited --format "{{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Size}}" 2>/dev/null && echo "===END==="',
            (err, stream) => {
              if (err) { clearTimeout(timer); return reject(err); }
              let data = '';
              stream.on('data', (d: Buffer) => { data += d.toString(); });
              stream.stderr.on('data', (d: Buffer) => { data += d.toString(); });
              stream.on('close', () => { clearTimeout(timer); resolve(data); });
            }
          );
        });

        console.log(`[storage] Got ${output.length} bytes from ${targetNode.name}`);

        // Parse sections using regex to extract content between markers
        const getSection = (name: string) => {
          const regex = new RegExp(`===${name}===\\n([\\s\\S]*?)(?====|$)`);
          return regex.exec(output)?.[1]?.trim() || '';
        };

        const diskLine = getSection('DISK').split(/\s+/);
        const disk = {
          total: diskLine[0] || '-',
          used: diskLine[1] || '-',
          available: diskLine[2] || '-',
          usedPercent: parseInt(diskLine[3] || '0'),
        };

        const dockerLines = getSection('DOCKER').split('\n').filter(Boolean);
        const dockerUsage = dockerLines.map(line => {
          const [type, total, active, size, reclaimable] = line.split('\t');
          return { type: type || '', total: total || '0', active: active || '0', size: size || '0B', reclaimable: reclaimable || '0B' };
        });

        const imageLines = getSection('IMAGES').split('\n').filter(Boolean);
        const images = imageLines.map(line => {
          const [id, repository, tag, size, created] = line.split('\t');
          return { id: id || '', repository: repository || '', tag: tag || '', size: size || '', created: created || '' };
        });

        const containerLines = getSection('CONTAINERS').split('\n').filter(Boolean);
        const stoppedContainers = containerLines.map(line => {
          const [id, name, status, size] = line.split('\t');
          return { id: id || '', name: name || '', status: status || '', size: size || '' };
        });

        const availableNodes = allNodes.map((n: any) => ({ id: n.id, name: n.name, host: n.host, role: n.role }));

        return { disk, dockerUsage, images, stoppedContainers, selectedNode: targetNode.name, availableNodes };
      } catch (err: any) {
        console.error('[storage] Error:', err.message);
        return {
          disk: { total: '-', used: '-', available: '-', usedPercent: 0 },
          dockerUsage: [],
          images: [],
          stoppedContainers: [],
          availableNodes: [],
          selectedNode: '',
          error: err.message,
        };
      }
    }),

  /** Prune Docker resources on a specific node */
  dockerPrune: adminProcedure
    .input(z.object({
      nodeId: z.string().uuid().optional(),
      buildCache: z.boolean().default(true),
      danglingImages: z.boolean().default(true),
      stoppedContainers: z.boolean().default(true),
      allUnusedImages: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const allNodes = await ctx.db.query.nodes.findMany({
        where: and(
          eq(nodes.organizationId, ctx.session.organizationId),
          eq(nodes.status, 'online'),
        ),
        with: { sshKey: true },
      });

      const targetNode = input.nodeId
        ? allNodes.find((n: any) => n.id === input.nodeId)
        : allNodes.find((n: any) => n.role === 'manager') || allNodes[0];

      if (!targetNode?.sshKey) {
        throw new Error('Node not found or has no SSH key');
      }

      await setupTunnelConfig(ctx.db, ctx.session.organizationId, targetNode.host);

      const client = await sshManager.connect({
        host: targetNode.host,
        port: targetNode.port,
        username: targetNode.sshUser,
        privateKey: decryptPrivateKey(targetNode.sshKey.privateKey),
      });

      const commands: string[] = [];
      if (input.stoppedContainers) commands.push('docker container prune -f');
      if (input.danglingImages) commands.push('docker image prune -f');
      if (input.allUnusedImages) commands.push('docker image prune -af');
      if (input.buildCache) commands.push('docker builder prune -af');

      // Measure disk BEFORE prune
      const fullCmd = `df -B1 / | awk 'NR==2{print $3}' && ${commands.join(' && ')} && df -B1 / | awk 'NR==2{print $3}'`;

      console.log(`[storage] Pruning ${targetNode.name}...`);

      const output = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Prune timeout')), 120_000);
        client.exec(fullCmd, (err, stream) => {
          if (err) { clearTimeout(timer); return reject(err); }
          let data = '';
          stream.on('data', (d: Buffer) => { data += d.toString(); });
          stream.stderr.on('data', (d: Buffer) => { data += d.toString(); });
          stream.on('close', () => { clearTimeout(timer); resolve(data); });
        });
      });

      // Extract before/after disk usage in bytes
      const lines = output.trim().split('\n');
      const diskBefore = parseInt(lines[0] || '0') || 0;
      const diskAfter = parseInt(lines[lines.length - 1] || '0') || 0;
      const freedBytes = Math.max(0, diskBefore - diskAfter);

      const formatSize = (bytes: number): string => {
        if (bytes < 1024) return `${bytes}B`;
        if (bytes < 1024**2) return `${(bytes / 1024).toFixed(1)}KB`;
        if (bytes < 1024**3) return `${(bytes / 1024**2).toFixed(1)}MB`;
        return `${(bytes / 1024**3).toFixed(2)}GB`;
      };

      const spaceReclaimed = freedBytes > 0 ? formatSize(freedBytes) : 'Nothing to clean';

      console.log(`[storage] Pruned ${targetNode.name}: ${spaceReclaimed} freed (${diskBefore} → ${diskAfter})`);

      return {
        success: true,
        spaceReclaimed,
        nodeName: targetNode.name,
      };
    }),
});
