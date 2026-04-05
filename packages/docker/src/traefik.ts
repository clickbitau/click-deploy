// ============================================================
// Click-Deploy — Traefik Integration
// ============================================================
// Manages Traefik as a Docker Swarm service.
// Handles:
// - Auto-deployment of Traefik to manager nodes
// - Traefik label generation for service routing
// - Let's Encrypt automatic SSL via ACME
// - Self-hosted Docker registry deployment
// ============================================================
import * as crypto from 'crypto';
import { sshManager } from './ssh';
import { type NodeConnectionInfo } from './client';

// ── Types ───────────────────────────────────────────────────

export interface TraefikConfig {
  /** Email for Let's Encrypt ACME registration */
  acmeEmail: string;
  /** Dashboard enabled (default: true, only accessible internally) */
  dashboardEnabled?: boolean;
  /** Log level: DEBUG | INFO | WARN | ERROR */
  logLevel?: string;
  /** Custom entrypoint ports (default: 80/443) */
  httpPort?: number;
  httpsPort?: number;
}

export interface TraefikRouteConfig {
  /** Unique router name (derived from service/domain) */
  routerName: string;
  /** Domain hostname (e.g. myapp.example.com) */
  hostname: string;
  /** Target service port inside the container */
  targetPort: number;
  /** Enable SSL via Let's Encrypt */
  sslEnabled: boolean;
  /** SSL provider (only letsencrypt auto-provision supported) */
  sslProvider?: 'letsencrypt' | 'cloudflare' | 'custom' | 'none';
  /** Path prefix routing (default: /) */
  pathPrefix?: string;
  /** Enable websocket support */
  websocket?: boolean;
  /** Custom middlewares (rate-limit, basic-auth, etc.) */
  middlewares?: string[];
}

// ── Traefik Label Generator ─────────────────────────────────

/**
 * Generate Docker labels that Traefik reads to configure routing.
 * These go on the Swarm service, NOT on Traefik itself.
 */
export function generateTraefikLabels(
  serviceName: string,
  routes: TraefikRouteConfig[]
): Record<string, string> {
  const labels: Record<string, string> = {
    // Enable Traefik for this service
    'traefik.enable': 'true',
    // Docker Swarm mode — use endpoint mode VIP
    'traefik.docker.network': 'click-deploy-net',
  };

  for (const route of routes) {
    const name = route.routerName;

    // HTTP router — host-based routing
    labels[`traefik.http.routers.${name}.rule`] = route.pathPrefix && route.pathPrefix !== '/'
      ? `Host(\`${route.hostname}\`) && PathPrefix(\`${route.pathPrefix}\`)`
      : `Host(\`${route.hostname}\`)`;

    labels[`traefik.http.routers.${name}.entrypoints`] = 'websecure';

    // SSL / TLS configuration
    if (route.sslEnabled && route.sslProvider !== 'none') {
      labels[`traefik.http.routers.${name}.tls`] = 'true';
      labels[`traefik.http.routers.${name}.tls.certresolver`] = 'letsencrypt';
    }

    // Target port (load balancer server port)
    labels[`traefik.http.services.${name}.loadbalancer.server.port`] = String(route.targetPort);

    // Health check via load balancer
    labels[`traefik.http.services.${name}.loadbalancer.healthcheck.path`] = '/';
    labels[`traefik.http.services.${name}.loadbalancer.healthcheck.interval`] = '10s';

    // HTTP → HTTPS redirect middleware
    if (route.sslEnabled) {
      labels[`traefik.http.routers.${name}-http.rule`] = labels[`traefik.http.routers.${name}.rule`];
      labels[`traefik.http.routers.${name}-http.entrypoints`] = 'web';
      labels[`traefik.http.routers.${name}-http.middlewares`] = `${name}-redirect`;
      labels[`traefik.http.middlewares.${name}-redirect.redirectscheme.scheme`] = 'https';
      labels[`traefik.http.middlewares.${name}-redirect.redirectscheme.permanent`] = 'true';
    }

    // WebSocket support
    if (route.websocket) {
      labels[`traefik.http.services.${name}.loadbalancer.passhostheader`] = 'true';
    }

    // Custom middlewares
    if (route.middlewares && route.middlewares.length > 0) {
      const existing = labels[`traefik.http.routers.${name}.middlewares`] || '';
      const all = existing ? `${existing},${route.middlewares.join(',')}` : route.middlewares.join(',');
      labels[`traefik.http.routers.${name}.middlewares`] = all;
    }
  }

  return labels;
}

/**
 * Generate simple Traefik labels for a single domain → service mapping.
 * Convenience wrapper around generateTraefikLabels.
 */
export function generateSimpleTraefikLabels(
  serviceName: string,
  hostname: string,
  containerPort: number,
  sslEnabled = true,
): Record<string, string> {
  return generateTraefikLabels(serviceName, [{
    routerName: serviceName,
    hostname,
    targetPort: containerPort,
    sslEnabled,
  }]);
}

// ── Traefik Service Manager ─────────────────────────────────

export class TraefikManager {
  constructor(private managerNode: NodeConnectionInfo) {}

  private get sshConfig() {
    return {
      host: this.managerNode.host,
      port: this.managerNode.port,
      username: this.managerNode.sshUser,
      privateKey: this.managerNode.privateKey,
    };
  }

  /**
   * Deploy Traefik as a Swarm service on the manager node.
   * Idempotent — updates if already exists.
   */
  async deploy(config: TraefikConfig): Promise<{ created: boolean; updated: boolean }> {
    const serviceName = 'click-deploy-traefik';

    // 1. Ensure overlay network exists
    await this.ensureNetwork();

    // 2. Create acme.json volume for Let's Encrypt certificates
    await sshManager.exec(this.sshConfig,
      `docker volume create click-deploy-traefik-certs 2>/dev/null || true`
    );

    // 3. Check if Traefik is already running
    const inspect = await sshManager.exec(this.sshConfig,
      `docker service inspect ${serviceName} --format '{{.ID}}' 2>/dev/null`
    );
    const exists = inspect.code === 0 && inspect.stdout.trim().length > 0;

    const httpPort = config.httpPort || 80;
    const httpsPort = config.httpsPort || 443;
    const logLevel = config.logLevel || 'INFO';
    const dashboardEnabled = config.dashboardEnabled ?? true;

    if (exists) {
      // Update existing Traefik service
      const updateCmd = [
        `docker service update`,
        `--image traefik:latest`,
        `--force`,
        serviceName,
      ].join(' ');

      await sshManager.exec(this.sshConfig, updateCmd);
      return { created: false, updated: true };
    }

    // 4. Remove any services that conflict with Traefik's ports
    const requiredPorts = [httpPort, httpsPort];
    for (const port of requiredPorts) {
      const conflict = await sshManager.exec(this.sshConfig,
        `docker service ls --format '{{.ID}} {{.Name}} {{.Ports}}' | grep ':${port}->' | head -1`
      );
      if (conflict.stdout.trim()) {
        const conflictName = conflict.stdout.trim().split(/\s+/)[1];
        if (conflictName && conflictName !== serviceName) {
          // Remove conflicting service
          await sshManager.exec(this.sshConfig, `docker service rm ${conflictName} 2>/dev/null || true`);
        }
      }
    }

    // 5. Create Traefik service
    const cmd = [
      `docker service create`,
      `--name ${serviceName}`,
      `--constraint 'node.role == manager'`,
      `--publish ${httpPort}:80`,
      `--publish ${httpsPort}:443`,
      // Traefik dashboard is only accessible internally, not published publicly
      `--mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock,readonly`,
      `--mount type=volume,source=click-deploy-traefik-certs,target=/letsencrypt`,
      `--network click-deploy-net`,
      // Labels for Traefik's own dashboard (optional)
      `--label traefik.enable=false`,
      // Traefik image with CLI args
      `traefik:latest`,
      // -- Traefik CLI arguments --
      `--api.dashboard=${dashboardEnabled}`,
      `--api.insecure=false`,
      `--log.level=${logLevel}`,
      // Entrypoints
      `--entrypoints.web.address=:80`,
      `--entrypoints.websecure.address=:443`,
      // Global HTTP → HTTPS redirect
      `--entrypoints.web.http.redirections.entrypoint.to=websecure`,
      `--entrypoints.web.http.redirections.entrypoint.scheme=https`,
      // Docker Swarm provider
      `--providers.swarm=true`,
      `--providers.swarm.exposedByDefault=false`,
      `--providers.swarm.network=click-deploy-net`,
      `--providers.swarm.endpoint=unix:///var/run/docker.sock`,
      // Let's Encrypt ACME
      `--certificatesresolvers.letsencrypt.acme.email=${config.acmeEmail}`,
      `--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json`,
      `--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web`,
    ].filter(Boolean).join(' ');

    const result = await sshManager.exec(this.sshConfig, cmd);
    if (result.code !== 0) {
      throw new Error(`Failed to deploy Traefik: ${result.stderr}`);
    }

    return { created: true, updated: false };
  }

  /**
   * Check if Traefik is running.
   */
  async isRunning(): Promise<boolean> {
    const result = await sshManager.exec(this.sshConfig,
      `docker service inspect click-deploy-traefik --format '{{.Spec.Mode.Replicated.Replicas}}' 2>/dev/null`
    );
    return result.code === 0 && parseInt(result.stdout.trim()) > 0;
  }

  /**
   * Get Traefik service status.
   */
  async getStatus(): Promise<{
    running: boolean;
    version?: string;
    replicas?: number;
    ports?: string[];
  }> {
    const inspect = await sshManager.exec(this.sshConfig,
      `docker service inspect click-deploy-traefik --format '{{.Spec.TaskTemplate.ContainerSpec.Image}} {{.Spec.Mode.Replicated.Replicas}}' 2>/dev/null`
    );

    if (inspect.code !== 0) {
      return { running: false };
    }

    const parts = inspect.stdout.trim().split(' ');
    let version = parts[0]?.replace('traefik:', '').replace(/@sha256:.+$/, '') || 'unknown';

    // If tag is 'latest', query the actual version from OCI image labels
    if (version === 'latest' || version === 'unknown') {
      try {
        const versionCmd = await sshManager.exec(this.sshConfig,
          `docker image inspect traefik:latest --format '{{index .Config.Labels "org.opencontainers.image.version"}}' 2>/dev/null`
        );
        const actualVersion = versionCmd.stdout.trim();
        if (actualVersion && actualVersion !== '' && actualVersion !== '<no value>') {
          version = actualVersion.startsWith('v') ? actualVersion : `v${actualVersion}`;
        }
      } catch {
        // Fall back to 'latest' if we can't get the actual version
      }
    }

    return {
      running: true,
      version,
      replicas: parseInt(parts[1] || '0'),
      ports: ['80', '443'],
    };
  }

  /**
   * Remove Traefik service entirely.
   */
  async remove(): Promise<void> {
    await sshManager.exec(this.sshConfig, `docker service rm click-deploy-traefik 2>/dev/null || true`);
  }

  /**
   * Update Traefik labels on a running Swarm service.
   * Used when adding/removing domains.
   */
  async updateServiceLabels(
    serviceName: string,
    labels: Record<string, string>
  ): Promise<void> {
    const labelArgs = Object.entries(labels)
      .map(([k, v]) => `--label-add '${k}=${v}'`)
      .join(' ');

    if (!labelArgs) return;

    const result = await sshManager.exec(this.sshConfig,
      `docker service update ${labelArgs} ${serviceName}`
    );

    if (result.code !== 0) {
      throw new Error(`Failed to update service labels: ${result.stderr}`);
    }
  }

  /**
   * Remove specific Traefik labels from a running Swarm service.
   * Used when deleting domains.
   */
  async removeServiceLabels(
    serviceName: string,
    labelKeys: string[]
  ): Promise<void> {
    const removeArgs = labelKeys
      .map((k) => `--label-rm '${k}'`)
      .join(' ');

    if (!removeArgs) return;

    await sshManager.exec(this.sshConfig,
      `docker service update ${removeArgs} ${serviceName}`
    );
  }

  /**
   * Ensure the overlay network exists.
   */
  private async ensureNetwork(): Promise<void> {
    // Create overlay network if it doesn't exist
    await sshManager.exec(this.sshConfig,
      `docker network create --driver overlay --attachable click-deploy-net 2>/dev/null || true`
    );
  }
}

// ── Self-Hosted Docker Registry ─────────────────────────────

export interface RegistryS3Config {
  endpoint: string;     // e.g. https://xxx.supabase.co/storage/v1/s3
  accessKey: string;
  secretKey: string;
  bucket: string;       // e.g. docker-registry
  region: string;       // e.g. us-east-1 (Supabase uses us-east-1 format)
}

export class RegistryManager {
  constructor(private managerNode: NodeConnectionInfo) {}

  private get sshConfig() {
    return {
      host: this.managerNode.host,
      port: this.managerNode.port,
      username: this.managerNode.sshUser,
      privateKey: this.managerNode.privateKey,
    };
  }

  /**
   * Deploy a self-hosted Docker registry as a Swarm service.
   *
   * Two storage modes:
   * - **Local volume** (default): single-node, data on manager disk
   * - **S3-backed** (HA): replicated across nodes, data in S3-compatible bucket
   */
  async deploy(opts?: {
    hostname?: string;
    sslEnabled?: boolean;
    s3?: RegistryS3Config;
    replicas?: number;
  }): Promise<{ created: boolean; updated: boolean; registryUrl: string; storageMode: 'local' | 's3' }> {
    const serviceName = 'click-deploy-registry';
    const registryUrl = `127.0.0.1:5000`;
    const useS3 = !!opts?.s3;

    // Check if already running
    const inspect = await sshManager.exec(this.sshConfig,
      `docker service inspect ${serviceName} --format '{{.ID}}' 2>/dev/null`
    );
    const exists = inspect.code === 0 && inspect.stdout.trim().length > 0;

    if (exists) {
      return { created: false, updated: false, registryUrl, storageMode: useS3 ? 's3' : 'local' };
    }

    // Ensure overlay network
    await sshManager.exec(this.sshConfig,
      `docker network create --driver overlay --attachable click-deploy-net 2>/dev/null || true`
    );

    // Build the create command
    const labels: string[] = [
      `--label traefik.enable=${opts?.hostname ? 'true' : 'false'}`,
    ];

    if (opts?.hostname) {
      labels.push(
        `--label 'traefik.http.routers.registry.rule=Host(\`${opts.hostname}\`)'`,
        `--label traefik.http.routers.registry.entrypoints=websecure`,
        `--label traefik.http.routers.registry.tls=true`,
        `--label traefik.http.routers.registry.tls.certresolver=letsencrypt`,
        `--label traefik.http.services.registry.loadbalancer.server.port=5000`,
      );
    }

    const envVars: string[] = [
      `--env REGISTRY_STORAGE_DELETE_ENABLED=true`,
    ];

    const cmdParts: string[] = [
      `docker service create`,
      `--name ${serviceName}`,
      `--publish mode=host,published=5000,target=5000`,
      `--network click-deploy-net`,
    ];

    if (useS3) {
      // ── S3-backed HA mode ──
      // Global mode → one instance per node, auto-scales with cluster
      cmdParts.push(`--mode global`);

      envVars.push(
        `--env REGISTRY_STORAGE=s3`,
        `--env REGISTRY_STORAGE_S3_REGIONENDPOINT=${opts!.s3!.endpoint}`,
        `--env REGISTRY_STORAGE_S3_ACCESSKEY=${opts!.s3!.accessKey}`,
        `--env REGISTRY_STORAGE_S3_SECRETKEY=${opts!.s3!.secretKey}`,
        `--env REGISTRY_STORAGE_S3_BUCKET=${opts!.s3!.bucket}`,
        `--env REGISTRY_STORAGE_S3_REGION=${opts!.s3!.region || 'us-east-1'}`,
        `--env REGISTRY_STORAGE_S3_FORCEPATHSTYLE=true`,
        // HA: shared secret for consistent uploads across replicas
        `--env REGISTRY_HTTP_SECRET=${crypto.randomBytes(32).toString('hex')}`,
        // Disable in-memory cache redirect — S3 handles it
        `--env REGISTRY_STORAGE_REDIRECT_DISABLE=true`,
      );
    } else {
      // ── Local volume mode (original) ──
      cmdParts.push(`--constraint 'node.role == manager'`);

      await sshManager.exec(this.sshConfig,
        `docker volume create click-deploy-registry-data 2>/dev/null || true`
      );
      cmdParts.push(
        `--mount type=volume,source=click-deploy-registry-data,target=/var/lib/registry`,
      );
    }

    const cmd = [
      ...cmdParts,
      ...envVars,
      ...labels,
      `registry:2`,
    ].join(' ');

    const result = await sshManager.exec(this.sshConfig, cmd);
    if (result.code !== 0) {
      throw new Error(`Failed to deploy registry: ${result.stderr}`);
    }

    return { created: true, updated: false, registryUrl, storageMode: useS3 ? 's3' : 'local' };
  }
  /**
   * Migrate an existing local-volume registry to S3-backed HA mode.
   * Uses docker service update to change config in-place, avoiding network race conditions.
   */
  async migrateToS3(s3Config: RegistryS3Config, opts?: {
    hostname?: string;
    replicas?: number;
  }): Promise<{ success: boolean; registryUrl: string }> {
    const serviceName = 'click-deploy-registry';
    const registryUrl = `127.0.0.1:5000`;
    const replicas = opts?.replicas ?? 2;

    // Ensure the overlay network exists before any changes
    await sshManager.exec(this.sshConfig,
      `docker network create --driver overlay --attachable click-deploy-net 2>/dev/null || true`
    );

    // Remove the existing service first
    await sshManager.exec(this.sshConfig,
      `docker service rm ${serviceName} 2>/dev/null || true`
    );

    // Wait for full cleanup
    await new Promise(r => setTimeout(r, 5000));

    // Verify network still exists (recreate if needed)
    const netCheck = await sshManager.exec(this.sshConfig,
      `docker network inspect click-deploy-net --format '{{.ID}}' 2>/dev/null`
    );
    if (netCheck.code !== 0 || !netCheck.stdout.trim()) {
      await sshManager.exec(this.sshConfig,
        `docker network create --driver overlay --attachable click-deploy-net`
      );
      await new Promise(r => setTimeout(r, 2000));
    }

    // Create fresh service with S3 config
    const sharedSecret = crypto.randomBytes(32).toString('hex');
    const cmd = [
      `docker service create`,
      `--name ${serviceName}`,
      `--mode global`,
      `--publish mode=host,published=5000,target=5000`,
      `--network click-deploy-net`,
      `--env REGISTRY_STORAGE_DELETE_ENABLED=true`,
      `--env REGISTRY_STORAGE=s3`,
      `--env REGISTRY_STORAGE_S3_REGIONENDPOINT=${s3Config.endpoint}`,
      `--env REGISTRY_STORAGE_S3_ACCESSKEY=${s3Config.accessKey}`,
      `--env REGISTRY_STORAGE_S3_SECRETKEY=${s3Config.secretKey}`,
      `--env REGISTRY_STORAGE_S3_BUCKET=${s3Config.bucket}`,
      `--env REGISTRY_STORAGE_S3_REGION=${s3Config.region || 'us-east-1'}`,
      `--env REGISTRY_STORAGE_S3_FORCEPATHSTYLE=true`,
      `--env REGISTRY_STORAGE_REDIRECT_DISABLE=true`,
      `--env REGISTRY_HTTP_SECRET=${sharedSecret}`,
      `--label traefik.enable=false`,
      `registry:2`,
    ].join(' ');

    const result = await sshManager.exec(this.sshConfig, cmd);
    if (result.code !== 0) {
      throw new Error(`Failed to create S3-backed registry: ${result.stderr}`);
    }

    return { success: true, registryUrl };
  }

  /**
   * Check if registry is running and accessible.
   */
  async isRunning(): Promise<boolean> {
    const result = await sshManager.exec(this.sshConfig,
      `docker service ps click-deploy-registry --filter 'desired-state=running' --format '{{.ID}}' 2>/dev/null`
    );
    return result.code === 0 && result.stdout.trim().length > 0;
  }

  /**
   * Get detailed status of the registry service.
   */
  async getStatus(): Promise<{
    running: boolean;
    replicas: number;
    storageMode: 'local' | 's3' | 'unknown';
    mode: 'global' | 'replicated' | 'unknown';
  }> {
    // Count running tasks
    const taskCount = await sshManager.exec(this.sshConfig,
      `docker service ps click-deploy-registry --filter 'desired-state=running' --format '{{.ID}}' 2>/dev/null`
    );

    // Get env vars to determine storage mode
    const inspect = await sshManager.exec(this.sshConfig, [
      `docker service inspect click-deploy-registry`,
      `--format '{{if .Spec.Mode.Global}}global{{else}}replicated{{end}}|||{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{.}} {{end}}'`,
      `2>/dev/null`,
    ].join(' '));

    if (taskCount.code !== 0 && inspect.code !== 0) {
      return { running: false, replicas: 0, storageMode: 'unknown', mode: 'unknown' };
    }

    const replicas = taskCount.stdout.trim().split('\n').filter(Boolean).length;
    const inspectParts = inspect.stdout.trim().split('|||');
    const mode = (inspectParts[0] || 'unknown') as 'global' | 'replicated' | 'unknown';
    const envStr = inspectParts[1] || '';
    const storageMode = envStr.includes('REGISTRY_STORAGE=s3') ? 's3' as const : 'local' as const;

    return { running: replicas > 0, replicas, storageMode, mode };
  }

  /**
   * Get the registry URL (always port 5000 on the manager node).
   */
  getRegistryUrl(): string {
    return `${this.managerNode.host}:5000`;
  }
}
