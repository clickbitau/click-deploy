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
import { TraefikManager, RegistryManager, TailscaleManager, sshManager, type RegistryS3Config } from '@click-deploy/docker';
import { decryptPrivateKey } from '../crypto';

// ── Docker Hub API helpers ─────────────────────────────────
interface DockerHubTag {
  name: string;
  digest: string;
  last_updated: string;
}

/**
 * Fetch the latest stable tag + digest for a Docker Hub image.
 * For traefik: latest v3.x tag. For registry: latest 2.x tag.
 */
async function getLatestDockerHubVersion(
  image: string,
  tagPattern: RegExp
): Promise<{ tag: string; digest: string; lastUpdated: string } | null> {
  try {
    const url = `https://hub.docker.com/v2/repositories/library/${image}/tags?page_size=50&ordering=last_updated`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const data = await res.json();
    const tags = (data.results || []) as DockerHubTag[];
    // Find the latest tag matching the pattern (e.g. v3.x for traefik)
    const match = tags.find((t: DockerHubTag) => tagPattern.test(t.name));
    if (!match) return null;
    return { tag: match.name, digest: match.digest, lastUpdated: match.last_updated };
  } catch {
    return null;
  }
}

/** Infra component version metadata */
const INFRA_COMPONENTS = {
  traefik: {
    image: 'traefik',
    serviceName: 'click-deploy-traefik',
    tagPattern: /^v3\.\d+(\.\d+)?$/,   // v3.x or v3.x.y
    fallbackTag: 'v3.3',
  },
  registry: {
    image: 'registry',
    serviceName: 'click-deploy-registry',
    tagPattern: /^2(\.\d+)*$/,           // 2 or 2.x or 2.x.y
    fallbackTag: '2',
  },
} as const;

/**
 * Helper: Get the manager node with decrypted SSH key.
 */
async function getManagerNode(db: typeof import('@click-deploy/database').db, organizationId: string) {
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
async function setupTunnelConfig(db: typeof import('@click-deploy/database').db, organizationId: string, targetHost: string) {
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

  /** Join a node to the Docker Swarm */
  joinNodeToSwarm: adminProcedure
    .input(z.object({
      nodeId: z.string(),
      role: z.enum(['manager', 'worker']).default('worker'),
    }))
    .mutation(async ({ ctx, input }) => {
      const manager = await getManagerNode(ctx.db, ctx.session.organizationId);
      const managerSshConfig = {
        host: manager.host,
        port: manager.port,
        username: manager.sshUser,
        privateKey: manager.privateKey,
      };

      // Get join token from the manager
      const tokenResult = await sshManager.exec(managerSshConfig,
        `docker swarm join-token ${input.role} -q`
      );
      if (tokenResult.code !== 0) {
        throw new Error(`Failed to get swarm join token: ${tokenResult.stderr}`);
      }
      const token = tokenResult.stdout.trim();

      // Get the manager's advertise address (Tailscale or LAN)
      const managerAddr = `${manager.host}:2377`;

      // Get the target node's SSH config
      const targetNode = await ctx.db.query.nodes.findFirst({
        where: and(
          eq(nodes.id, input.nodeId),
          eq(nodes.organizationId, ctx.session.organizationId),
        ),
        with: { sshKey: true },
      });

      if (!targetNode?.sshKey) {
        throw new Error('Target node not found or has no SSH key');
      }

      // Setup Tailscale tunnel if needed
      await setupTunnelConfig(ctx.db, ctx.session.organizationId, targetNode.host);

      const targetSshConfig = {
        host: targetNode.host,
        port: targetNode.port,
        username: targetNode.sshUser,
        privateKey: decryptPrivateKey(targetNode.sshKey.privateKey),
      };

      // Check if already in swarm
      const swarmCheck = await sshManager.exec(targetSshConfig,
        `docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null`
      );
      if (swarmCheck.stdout.trim() === 'active') {
        return { success: true, message: `${targetNode.name} is already in the Swarm` };
      }

      // Leave any old swarm state first
      await sshManager.exec(targetSshConfig, `docker swarm leave --force 2>/dev/null || true`);

      // Join the swarm — advertise the node's own IP
      const joinResult = await sshManager.exec(targetSshConfig,
        `docker swarm join --token ${token} --advertise-addr ${targetNode.host} ${managerAddr}`
      );

      if (joinResult.code !== 0) {
        throw new Error(`Failed to join swarm: ${joinResult.stderr}`);
      }

      return {
        success: true,
        message: `${targetNode.name} joined the Swarm as ${input.role}`,
      };
    }),

  /** Deploy self-hosted Docker registry */
  deployRegistry: adminProcedure
    .input(z.object({
      name: z.string().default('Self-Hosted Registry'),
      hostname: z.string().optional(),
      s3: z.object({
        endpoint: z.string().min(1),
        accessKey: z.string().min(1),
        secretKey: z.string().min(1),
        bucket: z.string().min(1),
        region: z.string().default('us-east-1'),
      }).optional(),
      replicas: z.number().int().min(1).max(5).default(2),
    }))
    .mutation(async ({ ctx, input }) => {
      const manager = await getManagerNode(ctx.db, ctx.session.organizationId);
      const registry = new RegistryManager(manager);

      const result = await registry.deploy({
        hostname: input.hostname,
        sslEnabled: !!input.hostname,
        s3: input.s3 as RegistryS3Config | undefined,
        replicas: input.s3 ? input.replicas : undefined,
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
          ? `Registry deployed at ${result.registryUrl} (${result.storageMode} storage)`
          : 'Registry already running.',
      };
    }),

  /** Migrate existing registry to S3-backed HA mode */
  configureRegistryS3: adminProcedure
    .input(z.object({
      endpoint: z.string().min(1),
      accessKey: z.string().min(1),
      secretKey: z.string().min(1),
      bucket: z.string().min(1),
      region: z.string().default('us-east-1'),
      replicas: z.number().int().min(1).max(5).default(2),
    }))
    .mutation(async ({ ctx, input }) => {
      const manager = await getManagerNode(ctx.db, ctx.session.organizationId);
      const registry = new RegistryManager(manager);

      const result = await registry.migrateToS3({
        endpoint: input.endpoint,
        accessKey: input.accessKey,
        secretKey: input.secretKey,
        bucket: input.bucket,
        region: input.region,
      }, {
        replicas: input.replicas,
      });

      return {
        ...result,
        message: result.success
          ? `Registry migrated to S3-backed HA mode (${input.replicas} replicas)`
          : 'Migration failed — registry may need manual recovery.',
      };
    }),

  /** Check registry status */
  registryStatus: adminProcedure.query(async ({ ctx }) => {
    try {
      const manager = await getManagerNode(ctx.db, ctx.session.organizationId);
      const registry = new RegistryManager(manager);
      const status = await registry.getStatus();
      return {
        running: status.running,
        url: status.running ? registry.getRegistryUrl() : undefined,
        replicas: status.replicas,
        storageMode: status.storageMode,
      };
    } catch {
      return { running: false, replicas: 0, storageMode: 'unknown' as const };
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

      const [traefikStatus, registryStatus, tailscaleStatus, nixpacksStatus] = await Promise.allSettled([
        traefik.getStatus(),
        registry.getStatus(),
        tailscale.getStatus(),
        sshManager.exec({
          host: manager.host,
          port: manager.port,
          username: manager.sshUser,
          privateKey: manager.privateKey
        }, 'nixpacks --version 2>/dev/null || echo "not installed"').then(r => r.stdout.trim())
      ]);

      // Log any failures for debugging
      if (traefikStatus.status === 'rejected') {
        console.error('[infra.status] Traefik check failed:', traefikStatus.reason);
      }
      if (registryStatus.status === 'rejected') {
        console.error('[infra.status] Registry check failed:', registryStatus.reason);
      }

      const regStatus = registryStatus.status === 'fulfilled'
        ? registryStatus.value
        : { running: false, replicas: 0, storageMode: 'unknown' as const };

      return {
        managerNode: { name: manager.name, host: manager.host },
        managerNodes: allManagers.map(m => ({ name: m.name, host: m.host })),
        traefik: traefikStatus.status === 'fulfilled' ? traefikStatus.value : { running: false },
        registry: {
          running: regStatus.running,
          url: regStatus.running ? registry.getRegistryUrl() : undefined,
          replicas: regStatus.replicas,
          storageMode: regStatus.storageMode,
        },
        tailscale: tailscaleStatus.status === 'fulfilled'
          ? tailscaleStatus.value
          : { installed: false, running: false, authenticated: false },
        nixpacks: nixpacksStatus.status === 'fulfilled' ? nixpacksStatus.value : 'unknown',
      };
    } catch (err) {
      console.error('[infra.status] Failed to get infrastructure status:', err);
      return {
        managerNode: null,
        managerNodes: [],
        traefik: { running: false },
        registry: { running: false, replicas: 0, storageMode: 'unknown' as const },
        tailscale: { installed: false, running: false, authenticated: false },
        nixpacks: 'unknown',
      };
    }
  }),

  /**
   * Check for available updates on all infra components.
   * Compares running image digest with Docker Hub latest.
   */
  checkForUpdates: adminProcedure.query(async ({ ctx }) => {
    try {
      const manager = await getManagerNode(ctx.db, ctx.session.organizationId);
      const sshConfig = {
        host: manager.host, port: manager.port,
        username: manager.sshUser, privateKey: manager.privateKey,
      };

      const results: Record<string, {
        currentVersion: string;
        currentDigest: string;
        latestVersion: string | null;
        latestDigest: string | null;
        updateAvailable: boolean;
        lastChecked: string;
      }> = {};

      for (const [key, comp] of Object.entries(INFRA_COMPONENTS)) {
        // Get running image info from Swarm
        const inspectResult = await sshManager.exec(
          sshConfig,
          `docker service inspect ${comp.serviceName} --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' 2>/dev/null`
        );
        const runningImage = inspectResult.code === 0 ? inspectResult.stdout.trim() : '';
        if (!runningImage) {
          results[key] = {
            currentVersion: 'not deployed',
            currentDigest: '',
            latestVersion: null,
            latestDigest: null,
            updateAvailable: false,
            lastChecked: new Date().toISOString(),
          };
          continue;
        }

        // Parse current version and digest
        // Format: image:tag@sha256:digest or image:tag
        const currentTag = runningImage.split(':')[1]?.split('@')[0] || 'unknown';
        const currentDigest = runningImage.includes('@') ? runningImage.split('@')[1] : '';

        // Check Docker Hub for latest
        const latest = await getLatestDockerHubVersion(comp.image, comp.tagPattern);

        const updateAvailable = latest
          ? (currentDigest && latest.digest)
            ? !currentDigest.includes(latest.digest) && latest.tag !== currentTag
            : latest.tag !== currentTag
          : false;

        results[key] = {
          currentVersion: currentTag,
          currentDigest: currentDigest || '',
          latestVersion: latest?.tag || null,
          latestDigest: latest?.digest || null,
          updateAvailable,
          lastChecked: new Date().toISOString(),
        };
      }

      // Tailscale + Nixpacks are binary-based, not Swarm services
      // Just report current installed version
      try {
        const tsResult = await sshManager.exec(
          sshConfig,
          'tailscale version 2>/dev/null | head -1 || echo "not installed"'
        );
        const nixResult = await sshManager.exec(
          sshConfig,
          'nixpacks --version 2>/dev/null || echo "not installed"'
        );
        results['tailscale'] = {
          currentVersion: tsResult.stdout.trim(),
          currentDigest: '',
          latestVersion: null,
          latestDigest: null,
          updateAvailable: false, // Binary updates checked via `tailscale update`
          lastChecked: new Date().toISOString(),
        };
        results['nixpacks'] = {
          currentVersion: nixResult.stdout.trim(),
          currentDigest: '',
          latestVersion: null,
          latestDigest: null,
          updateAvailable: false, // Re-installed via curl
          lastChecked: new Date().toISOString(),
        };
      } catch { /* non-fatal */ }

      return results;
    } catch (err: any) {
      return { error: err.message };
    }
  }),

  /** Update a specific infrastructure component to the latest version */
  updateComponent: adminProcedure
    .input(z.object({
      component: z.enum(['traefik', 'registry', 'nixpacks', 'tailscale']),
      /** Optional: specific version tag to update to (e.g. "v3.4"). If omitted, resolves latest from Docker Hub. */
      targetVersion: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const manager = await getManagerNode(ctx.db, ctx.session.organizationId);
      
      const sshConfig = {
        host: manager.host,
        port: manager.port,
        username: manager.sshUser,
        privateKey: manager.privateKey,
      };

      let command = '';
      let resolvedVersion = input.targetVersion;

      switch (input.component) {
        case 'traefik': {
          if (!resolvedVersion) {
            const latest = await getLatestDockerHubVersion('traefik', INFRA_COMPONENTS.traefik.tagPattern);
            resolvedVersion = latest?.tag || INFRA_COMPONENTS.traefik.fallbackTag;
          }
          command = `docker service update --image traefik:${resolvedVersion} click-deploy-traefik --force`;
          break;
        }
        case 'registry': {
          if (!resolvedVersion) {
            const latest = await getLatestDockerHubVersion('registry', INFRA_COMPONENTS.registry.tagPattern);
            resolvedVersion = latest?.tag || INFRA_COMPONENTS.registry.fallbackTag;
          }
          command = `docker service update --image registry:${resolvedVersion} click-deploy-registry --force`;
          break;
        }
        case 'nixpacks':
          command = 'curl -sSL https://nixpacks.com/install.sh | bash';
          break;
        case 'tailscale':
          command = 'tailscale update --yes || true';
          break;
      }

      await sshManager.exec(sshConfig, command);
      return {
        success: true,
        component: input.component,
        version: resolvedVersion || 'latest',
      };
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
          orderBy: (nodes, { asc }) => [asc(nodes.name)],
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
          const timer = setTimeout(() => reject(new Error('Command timeout after 60s')), 60_000);
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
        orderBy: (nodes, { asc }) => [asc(nodes.name)],
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
