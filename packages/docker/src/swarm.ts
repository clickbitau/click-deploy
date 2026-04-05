// ============================================================
// Click-Deploy — Docker Swarm Manager
// ============================================================
// Handles Swarm lifecycle: init, join, node management,
// service deployment with zero-downtime rolling updates.
//
// Deployment Strategy (per user spec):
// - Old version runs until new one passes health checks
// - Once new version is healthy, old MUST die immediately
// - No stale versions served — latest always live
// - Keep last 2 image digests for manual rollback
// ============================================================
import { sshManager, type SSHConnectionConfig } from './ssh';
import { RemoteDockerCLI, type NodeConnectionInfo } from './client';

/**
 * Default deployment configuration.
 *
 * Key: `start-first` order ensures old container stays alive
 * until new one is healthy. Then old is killed immediately.
 * No overlap of old versions being served.
 */
export const DEFAULT_DEPLOY_CONFIG = {
  /** Start new container before stopping old — zero downtime */
  updateOrder: 'start-first' as const,
  /** Automatic rollback if health check fails */
  updateFailureAction: 'rollback' as const,
  /** How long to watch health after update before considering success */
  updateMonitor: '30s',
  /** Deploy 1 replica at a time */
  updateParallelism: 1,
  /** Wait between replica updates */
  updateDelay: '5s',
  /** How many failures before triggering rollback */
  updateMaxFailureRatio: 0,
  /** Rollback config */
  rollbackParallelism: 1,
  rollbackDelay: '5s',
  rollbackOrder: 'start-first' as const,
  taskHistoryRetentionLimit: 2,
};

/** Securely escape strings for bash execution by wrapping in single quotes */
const escapeBash = (str: string) => `'${str.replace(/'/g, "'\\''")}'`;

export class SwarmManager {
  private cli: RemoteDockerCLI;
  private sshConfig: SSHConnectionConfig;

  constructor(node: NodeConnectionInfo) {
    this.cli = new RemoteDockerCLI({
      host: node.host,
      port: node.port,
      username: node.sshUser,
      privateKey: node.privateKey,
    });
    this.sshConfig = {
      host: node.host,
      port: node.port,
      username: node.sshUser,
      privateKey: node.privateKey,
    };
  }

  // ── Swarm Lifecycle ───────────────────────────────────────

  /**
   * Initialize a new Swarm on this node.
   * This node becomes the first manager.
   * Idempotent — if already in a Swarm, returns existing tokens.
   */
  async initSwarm(advertiseAddr?: string): Promise<{
    swarmId: string;
    joinTokenWorker: string;
    joinTokenManager: string;
    alreadyActive: boolean;
  }> {
    // Check if already in a Swarm
    const swarmState = await sshManager.exec(
      this.sshConfig,
      "docker info --format '{{.Swarm.LocalNodeState}}'"
    );

    if (swarmState.stdout.trim() === 'active') {
      // Already in a swarm — just return existing tokens
      const workerToken = await sshManager.exec(this.sshConfig, 'docker swarm join-token worker -q');
      const managerToken = await sshManager.exec(this.sshConfig, 'docker swarm join-token manager -q');
      const info = await this.cli.swarmInfo();

      return {
        swarmId: info.nodeId ?? '',
        joinTokenWorker: workerToken.stdout.trim(),
        joinTokenManager: managerToken.stdout.trim(),
        alreadyActive: true,
      };
    }

    const addrFlag = advertiseAddr ? `--advertise-addr ${advertiseAddr}` : '';
    await this.cli.exec(`swarm init ${addrFlag}`);

    // Get join tokens
    const workerToken = await sshManager.exec(
      this.sshConfig,
      'docker swarm join-token worker -q'
    );
    const managerToken = await sshManager.exec(
      this.sshConfig,
      'docker swarm join-token manager -q'
    );

    // Get swarm ID
    const info = await this.cli.swarmInfo();

    return {
      swarmId: info.nodeId ?? '',
      joinTokenWorker: workerToken.stdout.trim(),
      joinTokenManager: managerToken.stdout.trim(),
      alreadyActive: false,
    };
  }

  /**
   * Join this node to an existing Swarm.
   */
  async joinSwarm(
    joinToken: string,
    managerAddr: string,
    advertiseAddr?: string
  ): Promise<void> {
    const addrFlag = advertiseAddr ? `--advertise-addr ${advertiseAddr}` : '';
    await this.cli.exec(
      `swarm join --token ${joinToken} ${addrFlag} ${managerAddr}`
    );
  }

  /**
   * Leave the Swarm (drain first if worker).
   */
  async leaveSwarm(force = false): Promise<void> {
    await this.cli.exec(`swarm leave ${force ? '--force' : ''}`);
  }

  // ── Node Management ───────────────────────────────────────

  /**
   * List all nodes in the Swarm.
   */
  async listNodes(): Promise<any[]> {
    return this.cli.execJson('node ls');
  }

  /**
   * Set a node's availability (active / drain / pause).
   */
  async setNodeAvailability(nodeId: string, availability: 'active' | 'drain' | 'pause'): Promise<void> {
    await this.cli.exec(`node update --availability ${availability} ${nodeId}`);
  }

  /**
   * Add labels to a node (used for placement constraints).
   * e.g., region=us-east, tier=production
   */
  async addNodeLabels(nodeId: string, labels: Record<string, string>): Promise<void> {
    const labelArgs = Object.entries(labels)
      .map(([k, v]) => `--label-add ${k}=${v}`)
      .join(' ');
    await this.cli.exec(`node update ${labelArgs} ${nodeId}`);
  }

  /**
   * Remove a node from the Swarm.
   */
  async removeNode(nodeId: string, force = false): Promise<void> {
    await this.cli.exec(`node rm ${force ? '--force' : ''} ${nodeId}`);
  }

  // ── Service Deployment ────────────────────────────────────

  /**
   * Create a new Swarm service with our zero-downtime defaults.
   *
   * Strategy: start-first ensures old version stays live until
   * new container is healthy. Then old is killed immediately.
   */
  async createService(opts: {
    name: string;
    image: string;
    replicas?: number;
    ports?: Array<{ published: number; target: number; protocol?: string }>;
    envVars?: Record<string, string>;
    labels?: Record<string, string>;
    constraints?: string[];
    healthCheck?: {
      cmd: string;
      interval?: string;
      timeout?: string;
      retries?: number;
      startPeriod?: string;
    };
    resourceLimits?: {
      cpuLimit?: number;
      memoryLimit?: string;
      cpuReservation?: number;
      memoryReservation?: string;
    };
    networks?: string[];
    mounts?: Array<{ type: string; source: string; target: string; readonly?: boolean }>;
    // Container runtime overrides (matches Dokploy)
    command?: string;            // Custom entrypoint
    args?: string[];             // Custom CMD args
    stopGracePeriod?: string;    // e.g. '30s'
    // Swarm config overrides
    restartPolicy?: { condition?: string; delay?: string; maxAttempts?: number; window?: string };
    updateConfig?: { parallelism?: number; delay?: string; failureAction?: string; monitor?: string; maxFailureRatio?: number; order?: string };
    rollbackConfig?: { parallelism?: number; delay?: string; order?: string };
  }): Promise<string> {
    const args: string[] = ['docker', 'service', 'create', '--detach=true', '--no-resolve-image'];

    // Name
    args.push('--name', opts.name);

    // Replicas
    args.push('--replicas', String(opts.replicas ?? 1));

    // Update config (user overrides or defaults)
    const uc = opts.updateConfig || {};
    args.push('--update-order', uc.order || DEFAULT_DEPLOY_CONFIG.updateOrder);
    args.push('--update-failure-action', uc.failureAction || DEFAULT_DEPLOY_CONFIG.updateFailureAction);
    args.push('--update-monitor', uc.monitor || DEFAULT_DEPLOY_CONFIG.updateMonitor);
    args.push('--update-parallelism', String(uc.parallelism ?? DEFAULT_DEPLOY_CONFIG.updateParallelism));
    args.push('--update-delay', uc.delay || DEFAULT_DEPLOY_CONFIG.updateDelay);
    args.push('--update-max-failure-ratio', String(uc.maxFailureRatio ?? DEFAULT_DEPLOY_CONFIG.updateMaxFailureRatio));

    // Rollback config (user overrides or defaults)
    const rc = opts.rollbackConfig || {};
    args.push('--rollback-parallelism', String(rc.parallelism ?? DEFAULT_DEPLOY_CONFIG.rollbackParallelism));
    args.push('--rollback-delay', rc.delay || DEFAULT_DEPLOY_CONFIG.rollbackDelay);
    args.push('--rollback-order', rc.order || DEFAULT_DEPLOY_CONFIG.rollbackOrder);

    // Restart policy
    if (opts.restartPolicy) {
      if (opts.restartPolicy.condition) args.push('--restart-condition', opts.restartPolicy.condition);
      if (opts.restartPolicy.delay) args.push('--restart-delay', opts.restartPolicy.delay);
      if (opts.restartPolicy.maxAttempts) args.push('--restart-max-attempts', String(opts.restartPolicy.maxAttempts));
      if (opts.restartPolicy.window) args.push('--restart-window', opts.restartPolicy.window);
    }

    // Stop grace period
    if (opts.stopGracePeriod) {
      args.push('--stop-grace-period', opts.stopGracePeriod);
    }

    // Container entrypoint/args override
    if (opts.command) {
      args.push('--entrypoint', escapeBash(opts.command));
    }

    // Ports
    if (opts.ports) {
      for (const port of opts.ports) {
        args.push('--publish', `${port.published}:${port.target}/${port.protocol ?? 'tcp'}`);
      }
    }

    // Environment
    if (opts.envVars) {
      for (const [key, value] of Object.entries(opts.envVars)) {
        args.push('--env', escapeBash(`${key}=${value}`));
      }
    }

    // Labels
    if (opts.labels) {
      for (const [key, value] of Object.entries(opts.labels)) {
        args.push('--label', escapeBash(`${key}=${value}`));
      }
    }

    // Placement constraints
    if (opts.constraints) {
      for (const constraint of opts.constraints) {
        args.push('--constraint', constraint);
      }
    }

    // Health check
    if (opts.healthCheck) {
      args.push('--health-cmd', `"${opts.healthCheck.cmd}"`);
      if (opts.healthCheck.interval) args.push('--health-interval', opts.healthCheck.interval);
      if (opts.healthCheck.timeout) args.push('--health-timeout', opts.healthCheck.timeout);
      if (opts.healthCheck.retries) args.push('--health-retries', String(opts.healthCheck.retries));
      if (opts.healthCheck.startPeriod) args.push('--health-start-period', opts.healthCheck.startPeriod);
    }

    // Resource limits
    if (opts.resourceLimits) {
      if (opts.resourceLimits.cpuLimit) args.push('--limit-cpu', String(opts.resourceLimits.cpuLimit));
      if (opts.resourceLimits.memoryLimit) args.push('--limit-memory', opts.resourceLimits.memoryLimit);
      if (opts.resourceLimits.cpuReservation) args.push('--reserve-cpu', String(opts.resourceLimits.cpuReservation));
      if (opts.resourceLimits.memoryReservation) args.push('--reserve-memory', opts.resourceLimits.memoryReservation);
    }

    // Networks
    if (opts.networks) {
      for (const net of opts.networks) {
        args.push('--network', net);
      }
    }

    // Mounts
    if (opts.mounts) {
      for (const mount of opts.mounts) {
        let mountArg = `type=${mount.type},source=${mount.source},target=${mount.target}`;
        if (mount.readonly) mountArg += ',readonly';
        args.push('--mount', mountArg);
      }
    }

    // Image (must be last positional arg)
    args.push(opts.image);

    // CMD args come after the image
    if (opts.args && opts.args.length > 0) {
      for (const arg of opts.args) {
        args.push(escapeBash(arg));
      }
    }

    const result = await sshManager.exec(this.sshConfig, args.join(' '));
    if (result.code !== 0) {
      throw new Error(`Failed to create service: ${result.stderr}`);
    }

    return result.stdout; // Returns service ID
  }

  /**
   * Update a running service — zero-downtime rolling update.
   *
   * The start-first strategy means:
   * 1. New container starts alongside old container
   * 2. New container passes health check
   * 3. Old container is killed immediately
   * 4. Users get latest version on next request
   *
   * If new container fails health check:
   * - Automatic rollback to previous version
   * - Old container keeps running — never any downtime
   */
  async updateService(
    serviceName: string,
    image: string,
    opts?: {
      envVars?: Record<string, string>;
      replicas?: number;
      labels?: Record<string, string>;
      constraints?: string[];
      force?: boolean;
      mounts?: Array<{ type: string; source: string; target: string; readonly?: boolean }>;
      // Container runtime overrides
      command?: string;
      args?: string[];
      // Swarm config overrides
      restartPolicy?: { condition?: string; delay?: string; maxAttempts?: number; window?: string };
      updateConfig?: { parallelism?: number; delay?: string; failureAction?: string; monitor?: string; order?: string };
      rollbackConfig?: { parallelism?: number; delay?: string; order?: string };
    }
  ): Promise<void> {
    const args: string[] = ['docker', 'service', 'update', '--detach=true', '--no-resolve-image'];

    args.push('--image', image);

    // Update strategy (user overrides or defaults)
    const uc = opts?.updateConfig || {};
    args.push('--update-order', uc.order || DEFAULT_DEPLOY_CONFIG.updateOrder);
    args.push('--update-failure-action', uc.failureAction || DEFAULT_DEPLOY_CONFIG.updateFailureAction);
    args.push('--update-monitor', uc.monitor || DEFAULT_DEPLOY_CONFIG.updateMonitor);

    // Entrypoint override
    if (opts?.command) {
      args.push('--entrypoint', escapeBash(opts.command));
    }

    // Args override
    if (opts?.args && opts.args.length > 0) {
      args.push('--args', opts.args.map(a => escapeBash(a)).join(','));
    }

    // Restart policy
    if (opts?.restartPolicy) {
      if (opts.restartPolicy.condition) args.push('--restart-condition', opts.restartPolicy.condition);
      if (opts.restartPolicy.delay) args.push('--restart-delay', opts.restartPolicy.delay);
      if (opts.restartPolicy.maxAttempts) args.push('--restart-max-attempts', String(opts.restartPolicy.maxAttempts));
      if (opts.restartPolicy.window) args.push('--restart-window', opts.restartPolicy.window);
    }

    if (opts?.envVars) {
      for (const [key, value] of Object.entries(opts?.envVars)) {
        args.push('--env-add', escapeBash(`${key}=${value}`));
      }
    }

    if (opts?.labels) {
      for (const [key, value] of Object.entries(opts?.labels)) {
        args.push('--label-add', escapeBash(`${key}=${value}`));
      }
    }

    if (opts?.replicas !== undefined) {
      args.push('--replicas', String(opts.replicas));
    }

    if (opts?.constraints) {
      // First, remove existing click-deploy placement constraints to prevent accumulation.
      // `--constraint-add` appends, so without removal the same constraint stacks on every deploy.
      const inspectResult = await sshManager.exec(
        this.sshConfig,
        `docker service inspect ${serviceName} --format '{{json .Spec.TaskTemplate.Placement.Constraints}}'`
      );
      try {
        const existing = JSON.parse(inspectResult.stdout.trim() || '[]') as string[];
        for (const c of existing) {
          if (c.includes('click-deploy.svc-')) {
            args.push('--constraint-rm', c);
          }
        }
      } catch { /* ignore parse errors — fresh service has no constraints */ }

      for (const constraint of opts.constraints) {
        args.push('--constraint-add', constraint);
      }
    }

    if (opts?.force) {
      args.push('--force');
    }

    if (opts?.mounts) {
      for (const mount of opts.mounts) {
        let mountArg = `type=${mount.type},source=${mount.source},target=${mount.target}`;
        if (mount.readonly) mountArg += ',readonly';
        args.push('--mount-add', mountArg);
      }
    }

    args.push(serviceName);

    const result = await sshManager.exec(this.sshConfig, args.join(' '));
    if (result.code !== 0) {
      throw new Error(`Failed to update service: ${result.stderr}`);
    }
  }

  /**
   * Rollback a service to its previous version.
   */
  async rollbackService(serviceName: string): Promise<void> {
    const result = await sshManager.exec(
      this.sshConfig,
      `docker service rollback ${serviceName}`
    );
    if (result.code !== 0) {
      throw new Error(`Failed to rollback service: ${result.stderr}`);
    }
  }

  /**
   * Remove a service entirely.
   */
  async removeService(serviceName: string): Promise<void> {
    await this.cli.exec(`service rm ${serviceName}`);
  }

  // ── Swarm Stacks (Docker Compose) ─────────────────────────

  /**
   * Deploy a Docker Compose file as a Swarm Stack
   */
  async deployStack(
    stackName: string,
    composeContent: string,
    opts?: { envVars?: Record<string, string> }
  ): Promise<void> {
    const tmpFile = `/tmp/click-deploy-stack-${stackName}-${Date.now()}.yml`;
    
    // Write compose file to manager node
    const safeContent = composeContent.replace(/'/g, "'\\''");
    await sshManager.exec(this.sshConfig, `echo '${safeContent}' > ${tmpFile}`);

    try {
      // Build env vars
      const envExports = [];
      if (opts?.envVars) {
        for (const [key, value] of Object.entries(opts.envVars)) {
          envExports.push(`export ${key}=${escapeBash(value)}`);
        }
      }

      const envCmd = envExports.length > 0 ? `${envExports.join('; ')}; ` : '';
      const deployCmd = `${envCmd}docker stack deploy --compose-file ${tmpFile} ${stackName}`;

      const result = await sshManager.exec(this.sshConfig, deployCmd);
      if (result.code !== 0) {
        throw new Error(`Failed to deploy stack: ${result.stderr}`);
      }
    } finally {
      // Cleanup
      await sshManager.exec(this.sshConfig, `rm ${tmpFile}`);
    }
  }

  /**
   * Remove a Swarm Stack
   */
  async removeStack(stackName: string): Promise<void> {
    const result = await sshManager.exec(this.sshConfig, `docker stack rm ${stackName}`);
    if (result.code !== 0 && !result.stderr.includes('not found')) {
      throw new Error(`Failed to remove stack: ${result.stderr}`);
    }
  }

  /**
   * Watch service health status after a deployment.
   * Returns when the service converges or fails.
   */
  async watchServiceConvergence(
    serviceName: string,
    timeoutMs = 120_000
  ): Promise<{ converged: boolean; error?: string }> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const result = await sshManager.exec(
        this.sshConfig,
        `docker service ps ${serviceName} --format "{{.CurrentState}} {{.Error}}" --filter "desired-state=running"`
      );

      const lines = result.stdout.split('\n').filter((l: string) => l.trim());

      // Check if all tasks are Running
      const allRunning = lines.every((l: string) =>
        l.toLowerCase().startsWith('running')
      );

      if (allRunning && lines.length > 0) {
        return { converged: true };
      }

      // Check for failures
      const failed = lines.some((l: string) =>
        l.toLowerCase().includes('failed') ||
        l.toLowerCase().includes('rejected') ||
        l.toLowerCase().includes('shutdown')
      );

      if (failed) {
        const errorLine = lines.find((l: string) =>
          l.toLowerCase().includes('failed') || l.toLowerCase().includes('rejected')
        );
        return {
          converged: false,
          error: errorLine || 'Service failed to converge',
        };
      }

      // Wait 3s before checking again
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    return {
      converged: false,
      error: `Service did not converge within ${timeoutMs / 1000}s`,
    };
  }

  // ── Network Management ────────────────────────────────────

  /**
   * Create an overlay network for cross-node communication.
   */
  async createOverlayNetwork(name: string, opts?: {
    encrypted?: boolean;
    attachable?: boolean;
    subnet?: string;
  }): Promise<void> {
    const args = ['network', 'create', '--driver', 'overlay'];
    if (opts?.encrypted) args.push('--opt', 'encrypted=true');
    if (opts?.attachable) args.push('--attachable');
    if (opts?.subnet) args.push('--subnet', opts.subnet);
    args.push(name);

    await this.cli.exec(args.join(' '));
  }

  /**
   * List overlay networks.
   */
  async listNetworks(): Promise<any[]> {
    return this.cli.execJson('network ls --filter driver=overlay');
  }
}
