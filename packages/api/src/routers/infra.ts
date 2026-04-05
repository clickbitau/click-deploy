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
    stackServiceName: 'click-deploy_traefik',
    tagPattern: /^v?\d+\.\d+(\.\d+)?$/,  // v3.x.y or 3.x.y
    fallbackTag: 'latest',
  },
  registry: {
    image: 'registry',
    serviceName: 'click-deploy-registry',
    stackServiceName: 'click-deploy_registry',
    tagPattern: /^2(\.\d+)*$/,           // 2 or 2.x or 2.x.y
    fallbackTag: '2',
  },
} as const;

/** Resolve the actual running service name — try stack name (underscore) first */
async function resolveInfraServiceName(
  sshConfig: { host: string; port: number; username: string; privateKey: string },
  comp: { serviceName: string; stackServiceName: string }
): Promise<string> {
  const stackCheck = await sshManager.exec(sshConfig,
    `docker service inspect ${comp.stackServiceName} --format '{{.ID}}' 2>/dev/null`
  );
  if (stackCheck.code === 0 && stackCheck.stdout.trim().length > 0) {
    return comp.stackServiceName;
  }
  return comp.serviceName;
}

/**
 * Generate the streaming-optimized OpenResty nginx.conf for the S3 proxy.
 *
 * Key optimization: UploadPart PUTs (detected by ?partNumber= in URI) are streamed
 * directly to Supabase with proxy_request_buffering off — no disk spool.
 * All other requests (listings, DeleteObjects, CompleteMultipart) remain buffered.
 * All 3 Supabase bug fixes (XML rewrite, DeleteObjects mock, empty-body PutObject) preserved.
 */
export function generateS3ProxyNginxConfig(supabaseHost: string): string {
  return `worker_processes 1;
error_log /dev/stderr info;
pid /tmp/nginx.pid;

events {
    worker_connections 1024;
}

http {
    resolver 1.1.1.1 valid=30s;
    proxy_temp_path /tmp/nginx_proxy_temp;

    server {
        listen 443 ssl;
        server_name ${supabaseHost};

        ssl_certificate /etc/nginx/certs/proxy.crt;
        ssl_certificate_key /etc/nginx/certs/proxy.key;
        client_max_body_size 0;

        # BUG 3 FIX: Empty-body PutObject guard (skip for UploadPart — always has body)
        rewrite_by_lua_block {
            if ngx.req.get_method() == "PUT" then
                local args = ngx.req.get_uri_args()
                if not args["partNumber"] then
                    ngx.req.read_body()
                    local body = ngx.req.get_body_data()
                    if not body then
                        local file = ngx.req.get_body_file()
                        if not file then
                            ngx.req.set_body_data("")
                            ngx.req.set_header("Content-Length", "0")
                        end
                    end
                end
            end
        }

        # ROUTE 1: UploadPart streaming path — proxy_request_buffering off
        location ~ "^/storage/v1/s3/.+\\?.*partNumber=" {
            proxy_request_buffering off;
            proxy_buffering off;
            proxy_pass https://${supabaseHost};
            proxy_ssl_server_name on;
            proxy_ssl_name ${supabaseHost};
            proxy_set_header Host ${supabaseHost};
            proxy_set_header Accept-Encoding "";
            proxy_pass_request_headers on;
            proxy_pass_request_body on;
            proxy_http_version 1.1;
            proxy_set_header Connection "";
        }

        # ROUTE 2: Bucket-level ops (DeleteObjects interceptor)
        location ~ "^/storage/v1/s3/([^/]+)$" {
            set \$bucket_name \$1;
            access_by_lua_block {
                local method = ngx.req.get_method()
                local args = ngx.req.get_uri_args()
                if method == "POST" and args["delete"] ~= nil then
                    ngx.req.read_body()
                    local body = ngx.req.get_body_data() or ""
                    local resp = '<?xml version="1.0" encoding="UTF-8"?>'
                    resp = resp .. '<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
                    for key in body:gmatch("<Key>(.-)</Key>") do
                        resp = resp .. '<Deleted><Key>' .. key .. '</Key></Deleted>'
                    end
                    resp = resp .. '</DeleteResult>'
                    ngx.status = 200
                    ngx.header["Content-Type"] = "application/xml"
                    ngx.print(resp)
                    return ngx.exit(200)
                end
            }
            proxy_pass https://${supabaseHost}/storage/v1/s3/\$bucket_name\$is_args\$args;
            proxy_ssl_server_name on;
            proxy_ssl_name ${supabaseHost};
            proxy_set_header Host ${supabaseHost};
            proxy_set_header Accept-Encoding "";
            proxy_pass_request_headers on;
            proxy_pass_request_body on;
            proxy_request_buffering on;
            proxy_buffering on;
            proxy_buffer_size 128k;
            proxy_buffers 16 128k;
            proxy_http_version 1.1;
            proxy_set_header Connection "";
            sub_filter_types application/xml text/xml;
            sub_filter_once off;
            sub_filter '<PartNumberMarker/>' '<PartNumberMarker>0</PartNumberMarker>';
            sub_filter '<NextPartNumberMarker/>' '<NextPartNumberMarker>0</NextPartNumberMarker>';
            sub_filter '<EncodingType/>' '<EncodingType></EncodingType>';
            sub_filter '<Delimiter/>' '<Delimiter></Delimiter>';
            sub_filter '<KeyMarker/>' '<KeyMarker></KeyMarker>';
            sub_filter '<UploadIdMarker/>' '<UploadIdMarker></UploadIdMarker>';
            sub_filter '<NextKeyMarker/>' '<NextKeyMarker></NextKeyMarker>';
            sub_filter '<NextUploadIdMarker/>' '<NextUploadIdMarker></NextUploadIdMarker>';
            sub_filter '<Prefix/>' '<Prefix></Prefix>';
            sub_filter '<ContinuationToken/>' '<ContinuationToken></ContinuationToken>';
        }

        # ROUTE 3: All other S3 paths (GetObject, PutObject, CompleteMultipart, etc.)
        location /storage/v1/s3/ {
            proxy_pass https://${supabaseHost}/storage/v1/s3/;
            proxy_ssl_server_name on;
            proxy_ssl_name ${supabaseHost};
            proxy_set_header Host ${supabaseHost};
            proxy_set_header Accept-Encoding "";
            proxy_pass_request_headers on;
            proxy_pass_request_body on;
            proxy_request_buffering on;
            proxy_buffering on;
            proxy_buffer_size 128k;
            proxy_buffers 16 128k;
            proxy_http_version 1.1;
            proxy_set_header Connection "";
            sub_filter_types application/xml text/xml;
            sub_filter_once off;
            sub_filter '<PartNumberMarker/>' '<PartNumberMarker>0</PartNumberMarker>';
            sub_filter '<NextPartNumberMarker/>' '<NextPartNumberMarker>0</NextPartNumberMarker>';
            sub_filter '<EncodingType/>' '<EncodingType></EncodingType>';
            sub_filter '<Delimiter/>' '<Delimiter></Delimiter>';
            sub_filter '<KeyMarker/>' '<KeyMarker></KeyMarker>';
            sub_filter '<UploadIdMarker/>' '<UploadIdMarker></UploadIdMarker>';
            sub_filter '<NextKeyMarker/>' '<NextKeyMarker></NextKeyMarker>';
            sub_filter '<NextUploadIdMarker/>' '<NextUploadIdMarker></NextUploadIdMarker>';
            sub_filter '<Prefix/>' '<Prefix></Prefix>';
            sub_filter '<ContinuationToken/>' '<ContinuationToken></ContinuationToken>';
        }
    }
}
`;
}

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
    host: node.tailscaleIp || node.host,
    port: node.port,
    sshUser: node.sshUser,
    privateKey: decryptPrivateKey(node.sshKey.privateKey),
    tailscaleIp: node.tailscaleIp,
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
      host: managerNode.tailscaleIp || managerNode.host,
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
      role: z.enum(['manager', 'worker']).default('manager'),
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

      // Get the manager's Swarm advertise address (could be Tailscale or LAN)
      const managerSwarmAddr = await sshManager.exec(managerSshConfig,
        `docker node inspect self --format '{{.ManagerStatus.Addr}}' 2>/dev/null`
      );
      const swarmEndpoint = managerSwarmAddr.stdout.trim() || `${manager.host}:2377`;

      // Also get the manager's LAN IP for LAN-only nodes
      const managerLanIp = manager.host;

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

      // Determine if target is a Tailscale node (100.64.0.0/10)
      const isTailscale = (ip: string) => {
        const parts = ip.split('.').map(Number);
        return parts[0] === 100 && parts[1]! >= 64 && parts[1]! <= 127;
      };

      const targetIsTailscale = isTailscale(targetNode.host);

      // Tailscale nodes join via the Swarm's advertise address (Tailscale IP)
      // LAN nodes join via the manager's LAN IP on port 2377
      const joinAddr = targetIsTailscale
        ? swarmEndpoint
        : `${managerLanIp}:2377`;

      const joinCmd = [
        `docker swarm join`,
        `--token ${token}`,
        `--advertise-addr ${targetNode.host}`,
        `--listen-addr 0.0.0.0:2377`,
        joinAddr,
      ].join(' ');

      const joinResult = await sshManager.exec(targetSshConfig, joinCmd);

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

      const sshConfig = { host: manager.host, port: manager.port, username: manager.sshUser, privateKey: manager.privateKey };

      const [traefikStatus, registryStatus, tailscaleStatus, nixpacksStatus, proxyStatus] = await Promise.allSettled([
        traefik.getStatus(),
        registry.getStatus(),
        tailscale.getStatus(),
        sshManager.exec(sshConfig, 'nixpacks --version 2>/dev/null || echo "not installed"').then(r => r.stdout.trim()),
        // Check the OpenResty S3 proxy — the critical XML-fixer that enables Supabase S3 storage
        // Try both stack name (underscore) and standalone name (hyphen)
        sshManager.exec(sshConfig,
          `docker service ls --filter name=click-deploy_s3-proxy --filter name=click-deploy-s3-proxy --format '{{.Name}}\t{{.Replicas}}\t{{.Image}}' 2>/dev/null`
        ).then(r => {
          const line = r.stdout.trim().split('\n')[0]; // take first match
          if (!line) return { running: false, replicas: '0/0', image: null };
          const [, replicas, image] = line.split('\t');
          const [running, desired] = (replicas || '0/0').split('/');
          return {
            running: parseInt(running || '0') > 0 && running === desired,
            replicas: replicas || '0/0',
            image: image || null,
          };
        })
      ]);

      // Log any failures for debugging
      if (traefikStatus.status === 'rejected') {
        console.error('[infra.status] Traefik check failed:', traefikStatus.reason);
      }
      if (registryStatus.status === 'rejected') {
        console.error('[infra.status] Registry check failed:', registryStatus.reason);
      }
      if (proxyStatus.status === 'rejected') {
        console.error('[infra.status] S3 proxy check failed:', proxyStatus.reason);
      }

      const regStatus = registryStatus.status === 'fulfilled'
        ? registryStatus.value
        : { running: false, replicas: 0, storageMode: 'unknown' as const, mode: 'unknown' as const };

      // Use DB-stored registry URL (correct for global-mode registries)
      let registryUrl = regStatus.running ? registry.getRegistryUrl() : undefined;
      try {
        const dbRegistry = await ctx.db.query.registries.findFirst({
          where: and(
            eq(registries.organizationId, ctx.session.organizationId),
            eq(registries.isDefault, true),
          ),
        });
        if (dbRegistry?.url) registryUrl = dbRegistry.url;
      } catch { /* fall back to dynamic URL */ }

      return {
        managerNode: { name: manager.name, host: manager.host },
        managerNodes: allManagers.map(m => ({ name: m.name, host: m.host })),
        traefik: traefikStatus.status === 'fulfilled' ? traefikStatus.value : { running: false },
        registry: {
          running: regStatus.running,
          url: registryUrl,
          replicas: regStatus.replicas,
          storageMode: regStatus.storageMode,
          mode: regStatus.mode,
        },
        s3Proxy: proxyStatus.status === 'fulfilled'
          ? proxyStatus.value
          : { running: false, replicas: '0/0', image: null },
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
        s3Proxy: { running: false, replicas: '0/0', image: null },
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
        // Resolve actual service name (stack vs standalone)
        const actualName = await resolveInfraServiceName(sshConfig, comp as any);
        // Get running image info from Swarm
        const inspectResult = await sshManager.exec(
          sshConfig,
          `docker service inspect ${actualName} --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' 2>/dev/null`
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
        let currentTag = runningImage.split(':')[1]?.split('@')[0] || 'unknown';
        const currentDigest = runningImage.includes('@') ? runningImage.split('@')[1] : '';

        // If tag is 'latest', resolve actual version from OCI image labels
        if (currentTag === 'latest') {
          try {
            const labelResult = await sshManager.exec(sshConfig,
              `docker image inspect ${comp.image}:latest --format '{{index .Config.Labels "org.opencontainers.image.version"}}' 2>/dev/null`
            );
            const resolved = labelResult.stdout.trim();
            if (resolved && resolved !== '<no value>') {
              currentTag = resolved.startsWith('v') ? resolved : `v${resolved}`;
            }
          } catch { /* keep 'latest' */ }
        }

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
          const traefikName = await resolveInfraServiceName(sshConfig, INFRA_COMPONENTS.traefik);
          command = `docker service update --image traefik:${resolvedVersion} ${traefikName} --force`;
          break;
        }
        case 'registry': {
          if (!resolvedVersion) {
            const latest = await getLatestDockerHubVersion('registry', INFRA_COMPONENTS.registry.tagPattern);
            resolvedVersion = latest?.tag || INFRA_COMPONENTS.registry.fallbackTag;
          }
          const registryName = await resolveInfraServiceName(sshConfig, INFRA_COMPONENTS.registry);
          command = `docker service update --image registry:${resolvedVersion} ${registryName} --force`;
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
  /** Hot-reload the S3 proxy nginx config without restarting the container.
   * Writes the streaming-optimized config and sends a reload signal to OpenResty.
   */
  hotReloadS3Proxy: adminProcedure
    .input(z.object({
      supabaseHost: z.string().optional(),
    }).optional())
    .mutation(async ({ ctx, input }) => {
      const manager = await getManagerNode(ctx.db, ctx.session.organizationId);
      const sshConfig = {
        host: manager.host, port: manager.port,
        username: manager.sshUser, privateKey: manager.privateKey,
      };

      // Auto-detect Supabase host from running proxy config if not provided
      let supabaseHost = input?.supabaseHost;
      if (!supabaseHost) {
        const detect = await sshManager.exec(sshConfig,
          `grep -m1 "server_name" /opt/click-deploy/s3-proxy/nginx.conf 2>/dev/null | awk '{print $2}' | tr -d ';'`
        );
        supabaseHost = detect.stdout.trim() || 'htsgmthciflwefrippwf.supabase.co';
      }

      const newConfig = generateS3ProxyNginxConfig(supabaseHost);
      const safeConfig = newConfig.replace(/'/g, "'\\''"  );

      // Write config to disk
      const writeResult = await sshManager.exec(sshConfig,
        `cat > /opt/click-deploy/s3-proxy/nginx.conf << 'NGINX_EOF'\n${newConfig}\nNGINX_EOF`
      );
      if (writeResult.code !== 0) {
        throw new Error(`Failed to write nginx.conf: ${writeResult.stderr}`);
      }

      // Get proxy container ID
      const ctrResult = await sshManager.exec(sshConfig,
        `docker ps --filter name=s3-proxy --format '{{.ID}}' | head -1`
      );
      const ctrId = ctrResult.stdout.trim();
      if (!ctrId) {
        throw new Error('S3 proxy container not running — cannot reload');
      }

      // Validate config syntax in container
      const validateResult = await sshManager.exec(sshConfig,
        `docker cp /opt/click-deploy/s3-proxy/nginx.conf ${ctrId}:/tmp/nginx-reload.conf && docker exec ${ctrId} openresty -t -c /tmp/nginx-reload.conf 2>&1`
      );
      if (validateResult.code !== 0) {
        throw new Error(`nginx config syntax error: ${validateResult.stdout}`);
      }

      // Hot-reload
      const reloadResult = await sshManager.exec(sshConfig,
        `docker exec ${ctrId} openresty -s reload 2>&1`
      );
      if (reloadResult.code !== 0) {
        throw new Error(`Failed to reload nginx: ${reloadResult.stderr}`);
      }

      return {
        success: true,
        message: `S3 proxy reloaded with streaming-optimized config (supabase host: ${supabaseHost})`,
        containerId: ctrId,
      };
    }),

  /** Set a swarm node's availability (active / drain / pause) */
  setNodeAvailability: adminProcedure
    .input(z.object({
      hostname: z.string(),
      availability: z.enum(['active', 'drain', 'pause']),
    }))
    .mutation(async ({ ctx, input }) => {
      const manager = await getManagerNode(ctx.db, ctx.session.organizationId);
      const sshConfig = {
        host: manager.host, port: manager.port,
        username: manager.sshUser, privateKey: manager.privateKey,
      };

      const result = await sshManager.exec(sshConfig,
        `docker node update --availability ${input.availability} ${input.hostname} 2>&1`
      );
      if (result.code !== 0) {
        throw new Error(`Failed to set node availability: ${result.stderr}`);
      }

      return { success: true, hostname: input.hostname, availability: input.availability };
    }),

  /** Get live status of all Docker Swarm nodes */
  getSwarmNodes: adminProcedure.query(async ({ ctx }) => {
    const manager = await getManagerNode(ctx.db, ctx.session.organizationId);
    const sshConfig = {
      host: manager.host, port: manager.port,
      username: manager.sshUser, privateKey: manager.privateKey,
    };
    const result = await sshManager.exec(sshConfig, 'docker node ls --format "{{.ID}}|{{.Hostname}}|{{.Status}}|{{.ManagerStatus}}|{{.EngineVersion}}"');
    if (result.code !== 0) throw new Error(`Failed to fetch swarm nodes: ${result.stderr}`);
    
    return result.stdout.trim().split('\n').filter(Boolean).map(line => {
      const [id, hostname, status, managerStatus, engineVersion] = line.split('|');
      return { id: id?.trim(), hostname: hostname?.trim(), status: status?.trim(), managerStatus: managerStatus?.trim(), engineVersion: engineVersion?.trim() };
    });
  }),

  /** Get live health matrix of all Docker Swarm services */
  getServiceHealth: adminProcedure.query(async ({ ctx }) => {
    const manager = await getManagerNode(ctx.db, ctx.session.organizationId);
    const sshConfig = {
      host: manager.host, port: manager.port,
      username: manager.sshUser, privateKey: manager.privateKey,
    };
    const result = await sshManager.exec(sshConfig, 'docker service ls --format "{{.Name}}|{{.Mode}}|{{.Replicas}}|{{.Image}}|{{.Ports}}"');
    if (result.code !== 0) throw new Error(`Failed to fetch swarm services: ${result.stderr}`);
    
    return result.stdout.trim().split('\n').filter(Boolean).map(line => {
      const [name, mode, replicas, image, ports] = line.split('|');
      return { name: name?.trim(), mode: mode?.trim(), replicas: replicas?.trim(), image: image?.trim(), ports: ports?.trim() };
    });
  }),
});
