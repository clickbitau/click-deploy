// ============================================================
// Click-Deploy — Deployment Engine
// ============================================================
// Orchestrates the full deployment pipeline:
// 1. Resolve service + node + SSH key
// 2. Clone repo on build node
// 3. Docker build on build node
// 4. Push image to registry
// 5. Create/update Swarm service on deploy node
// 6. Monitor convergence
// 7. Cleanup build artifacts
// ============================================================
import { eq, and } from 'drizzle-orm';
import {
  db,
  deployments,
  services,
  nodes,
  sshKeys,
  registries,
  domains,
  inAppNotifications,
} from '@click-deploy/database';
import { sshManager, SwarmManager, generateTraefikLabels, type NodeConnectionInfo, type TraefikRouteConfig } from '@click-deploy/docker';
import { decryptPrivateKey } from './crypto';
import { getInstallationToken } from './routers/github';

// ── Reserved Ports ──────────────────────────────────────────
// These ports are used by the platform and should not be assigned to user services
const RESERVED_PORTS = new Set([22, 80, 443, 2377, 3000, 4789, 5000, 7946]);

// ── Types ───────────────────────────────────────────────────

interface DeploymentContext {
  deploymentId: string;
  service: {
    id: string;
    name: string;
    gitUrl: string | null;
    gitBranch: string | null;
    dockerfilePath: string | null;
    dockerContext: string | null;
    sourceType: string;
    imageName: string | null;
    imageTag: string | null;
    envVars: Record<string, string>;
    ports: Array<{ host?: number; container: number; protocol: string }>;
    replicas: number;
    healthCheck: any;
    resourceLimits: any;
    labels: Record<string, string>;
    swarmServiceId: string | null;
    projectId: string;
    deployNodeIds: string[];
  };
  buildNode: NodeConnectionInfo | null;
  deployNode: NodeConnectionInfo;
  managerNode: NodeConnectionInfo;
  registry: {
    url: string;
    username: string | null;
    password: string | null;
  } | null;
  branch: string;
  commitSha: string | null;
  organizationId: string;
  /** Domains assigned to this service — used to generate Traefik labels */
  domains: Array<{
    hostname: string;
    sslEnabled: boolean;
    sslProvider: string | null;
  }>;
}

export type DeploymentLog = {
  step: string;
  message: string;
  timestamp: Date;
  level: 'info' | 'error' | 'success';
};

// ── Helpers ─────────────────────────────────────────────────

function nodeToConnectionInfo(
  node: any,
  sshKey: any
): NodeConnectionInfo {
  return {
    id: node.id,
    name: node.name,
    host: node.host,
    port: node.port,
    sshUser: node.sshUser,
    privateKey: decryptPrivateKey(sshKey.privateKey),
  };
}

async function updateDeployment(
  deploymentId: string,
  data: Record<string, any>
) {
  await db
    .update(deployments)
    .set(data)
    .where(eq(deployments.id, deploymentId));
}

// ── Deployment Engine ───────────────────────────────────────

export class DeploymentEngine {
  /** Per-deployment log buffers — keyed by deploymentId */
  private deploymentLogs = new Map<string, DeploymentLog[]>();

  /** Track active deployments so we can cancel them mid-flight */
  private activeDeployments = new Map<string, AbortController>();

  /** Check if a deployment is currently in-flight */
  isDeploymentActive(deploymentId: string): boolean {
    return this.activeDeployments.has(deploymentId);
  }

  /**
   * Cancel a running deployment. Aborts the in-flight pipeline so SSH commands
   * stop at the next step boundary, then cleans up build artifacts.
   */
  async cancelDeployment(deploymentId: string): Promise<boolean> {
    const controller = this.activeDeployments.get(deploymentId);
    if (!controller) return false;

    console.log(`[deploy] Cancelling deployment ${deploymentId}`);
    controller.abort();
    this.activeDeployments.delete(deploymentId);

    // Also kill any lingering docker/nixpacks build on the build node
    try {
      const deployment = await db.query.deployments.findFirst({
        where: eq(deployments.id, deploymentId),
        with: { buildNode: true },
      });
      if (deployment?.buildNode) {
        const sshKey = await db.query.sshKeys.findFirst({
          where: eq(sshKeys.id, deployment.buildNode.sshKeyId),
        });
        if (sshKey) {
          const sshConfig = {
            host: deployment.buildNode.host,
            port: deployment.buildNode.port,
            username: deployment.buildNode.sshUser,
            privateKey: decryptPrivateKey(sshKey.privateKey),
          };
          // Kill build processes by their build directory path (more reliable than deploymentId)
          const buildDir = `/tmp/click-deploy-builds/${deploymentId}`;
          await sshManager.exec(sshConfig, [
            `pkill -9 -f "${buildDir}" 2>/dev/null`,
            `pkill -9 -f "docker build.*${deployment.imageName || deploymentId}" 2>/dev/null`,
            `pkill -9 -f "nixpacks build.*${buildDir}" 2>/dev/null`,
            `rm -rf ${buildDir} 2>/dev/null`,
          ].join('; ') + ' || true').catch(() => {});
        }
      }
    } catch { /* best-effort cleanup */ }

    return true;
  }

  /** Throw if the deployment has been cancelled */
  private checkCancelled(deploymentId: string) {
    const controller = this.activeDeployments.get(deploymentId);
    if (!controller || controller.signal.aborted) {
      throw new Error('Deployment was cancelled');
    }
  }

  private log(deploymentId: string, step: string, message: string, level: DeploymentLog['level'] = 'info') {
    if (!this.deploymentLogs.has(deploymentId)) {
      this.deploymentLogs.set(deploymentId, []);
    }
    const logs = this.deploymentLogs.get(deploymentId)!;
    logs.push({ step, message, timestamp: new Date(), level });
    console.log(`[deploy] [${step}] ${message}`);

    // Fire-and-forget DB update to enable live streaming of logs to the UI
    updateDeployment(deploymentId, { buildLogs: this.logsToText(deploymentId) }).catch(() => {});
  }

  /**
   * Run a full deployment: build → push → deploy → monitor
   */
  async runDeployment(deploymentId: string): Promise<void> {
    this.deploymentLogs.set(deploymentId, []);
    let buildStartTime: number | null = null;
    let deployStartTime: number | null = null;

    // Register this deployment as active (cancellable)
    const controller = new AbortController();
    this.activeDeployments.set(deploymentId, controller);

    // ── Auto-timeout: 30 minutes max per deployment ─────────
    const DEPLOY_TIMEOUT_MS = 30 * 60 * 1000;
    const timeoutHandle = setTimeout(() => {
      if (this.activeDeployments.has(deploymentId)) {
        console.log(`[deploy] Deployment ${deploymentId} timed out after 30 minutes`);
        controller.abort();
      }
    }, DEPLOY_TIMEOUT_MS);

    try {
      // ── Step 1: Resolve ──────────────────────────────────
      this.log(deploymentId, 'resolve', 'Loading deployment context...');
      const ctx = await this.resolveContext(deploymentId);

      // ── Step 2: Build ────────────────────────────────────
      if (ctx.service.sourceType === 'git' && ctx.buildNode) {
        buildStartTime = Date.now();
        await updateDeployment(deploymentId, {
          buildStatus: 'building',
          deployStatus: 'building',
        });

        // 2a. Clone repository
        this.log(deploymentId, 'clone', `Cloning ${ctx.service.gitUrl} (branch: ${ctx.branch})`);
        // Build dir: /tmp on Unix, %TEMP% on Windows — detected at clone time
        // We use /tmp by default; Windows path detection happens in cloneRepo via the ':' heuristic
        const buildDir = `/tmp/click-deploy-builds/${deploymentId}`;
        await this.cloneRepo(deploymentId, ctx.buildNode, ctx.service.gitUrl!, ctx.branch, buildDir, ctx.organizationId);
        this.checkCancelled(deploymentId);

        // Capture commit info from the cloned repo
        const buildSshConfig = {
          host: ctx.buildNode.host, port: ctx.buildNode.port,
          username: ctx.buildNode.sshUser, privateKey: ctx.buildNode.privateKey,
        };
        const shaResult = await sshManager.exec(buildSshConfig, `cd ${buildDir} && git rev-parse HEAD`);
        const msgResult = await sshManager.exec(buildSshConfig, `cd ${buildDir} && git log -1 --format=%s`);
        const commitSha = shaResult.code === 0 ? shaResult.stdout.trim() : undefined;
        const commitMessage = msgResult.code === 0 ? msgResult.stdout.trim() : undefined;

        if (commitSha) {
          ctx.commitSha = commitSha;
          this.log(deploymentId, 'clone', `Commit: ${commitSha.slice(0, 7)} — ${commitMessage || '(no message)'}`);
          await updateDeployment(deploymentId, { commitSha, commitMessage });
        }

        // 2b. Docker build (auto-prune cache first to prevent export stalls)
        const imageName = this.getImageName(ctx);
        const imageTag = commitSha?.slice(0, 7) || Date.now().toString();
        const fullImage = `${imageName}:${imageTag}`;

        try {
          const pruneConfig = { host: ctx.buildNode.host, port: ctx.buildNode.port, username: ctx.buildNode.sshUser, privateKey: ctx.buildNode.privateKey };
          await sshManager.exec(pruneConfig, 'docker builder prune -f --keep-storage 2G 2>/dev/null || true');
        } catch { /* non-fatal */ }

        this.log(deploymentId, 'build', `Building image: ${fullImage}`);
        const signal = this.activeDeployments.get(deploymentId)?.signal;
        await this.dockerBuild(deploymentId, ctx.buildNode, buildDir, fullImage, ctx.service, signal);
        this.checkCancelled(deploymentId);

        await updateDeployment(deploymentId, {
          buildStatus: 'built',
          imageName: fullImage,
          buildDurationMs: Date.now() - buildStartTime,
          buildLogs: this.logsToText(deploymentId),
        });

        // 2c. Push to registry
        if (ctx.registry) {
          this.log(deploymentId, 'push', `Pushing to ${ctx.registry.url}`);
          await this.dockerPush(deploymentId, ctx.buildNode, fullImage, ctx.registry);
        }

        // 2d. Cleanup build dir
        this.log(deploymentId, 'cleanup', 'Removing build artifacts');
        const cleanupCmd = buildDir.includes(':')
          ? `powershell -Command "Remove-Item -Recurse -Force '${buildDir}' -ErrorAction SilentlyContinue"`
          : `rm -rf ${buildDir}`;
        await sshManager.exec(
          { host: ctx.buildNode.host, port: ctx.buildNode.port, username: ctx.buildNode.sshUser, privateKey: ctx.buildNode.privateKey },
          cleanupCmd
        );

        // ── Step 3: Deploy ─────────────────────────────────
        deployStartTime = Date.now();
        await updateDeployment(deploymentId, { deployStatus: 'deploying' });
        await this.deployToSwarm(deploymentId, ctx, fullImage);

      } else if (ctx.service.sourceType === 'image') {
        // Direct image deployment (no build needed)
        const fullImage = `${ctx.service.imageName || ''}:${ctx.service.imageTag || 'latest'}`;
        await updateDeployment(deploymentId, {
          buildStatus: 'built',
          deployStatus: 'deploying',
          imageName: fullImage,
        });

        deployStartTime = Date.now();
        await this.deployToSwarm(deploymentId, ctx, fullImage);

      } else {
        throw new Error(`Unsupported source type: ${ctx.service.sourceType}`);
      }

      // ── Step 4: Monitor convergence ──────────────────────
      this.log(deploymentId, 'monitor', 'Watching service convergence...');
      const swarm = new SwarmManager(ctx.managerNode);
      const serviceName = this.getSwarmServiceName(ctx.service);
      const convergence = await swarm.watchServiceConvergence(serviceName, 120_000);

      if (convergence.converged) {
        this.log(deploymentId, 'complete', 'Deployment successful!', 'success');
        await updateDeployment(deploymentId, {
          deployStatus: 'running',
          deployDurationMs: deployStartTime ? Date.now() - deployStartTime : null,
          deployLogs: this.logsToText(deploymentId),
          completedAt: new Date(),
        });

        // Update service status
        await db.update(services)
          .set({ status: 'running', updatedAt: new Date() })
          .where(eq(services.id, ctx.service.id));

        // Notify: deploy success
        db.insert(inAppNotifications).values({
          organizationId: ctx.organizationId,
          title: `Deploy succeeded: ${ctx.service.name}`,
          message: ctx.commitSha ? `Commit ${ctx.commitSha.slice(0, 7)} is now live` : 'Service is now running',
          level: 'success',
          category: 'deployment',
          resourceId: deploymentId,
        }).catch(() => {});
      } else {
        throw new Error(`Service failed to converge: ${convergence.error}`);
      }

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isCancelled = message.includes('cancelled') || controller.signal.aborted;

      if (isCancelled) {
        const isTimeout = !message.includes('cancelled');
        const reason = isTimeout ? 'Timed out after 30 minutes' : 'Cancelled by user';
        this.log(deploymentId, 'cancelled', `Deployment ${isTimeout ? 'timed out' : 'was cancelled by user'}`, 'error');
        await updateDeployment(deploymentId, {
          buildStatus: buildStartTime && !deployStartTime ? 'cancelled' : undefined,
          deployStatus: 'cancelled',
          errorMessage: reason,
          buildLogs: this.logsToText(deploymentId),
          completedAt: new Date(),
        });
      } else {
        this.log(deploymentId, 'error', `Deployment failed: ${message}`, 'error');
        await updateDeployment(deploymentId, {
          buildStatus: buildStartTime && !deployStartTime ? 'failed' : undefined,
          deployStatus: 'failed',
          errorMessage: message,
          buildLogs: this.logsToText(deploymentId),
          completedAt: new Date(),
        });

        // Notify: deploy failure
        try {
          const failCtx = await db.query.deployments.findFirst({
            where: eq(deployments.id, deploymentId),
            with: { service: { with: { project: true } } },
          });
          if (failCtx?.service) {
            db.insert(inAppNotifications).values({
              organizationId: failCtx.service.project.organizationId,
              title: `Deploy failed: ${failCtx.service.name}`,
              message: message.slice(0, 200),
              level: 'error',
              category: 'deployment',
              resourceId: deploymentId,
            }).catch(() => {});
          }
        } catch { /* best-effort */ }
      }
    } finally {
      // Clear the auto-timeout timer
      clearTimeout(timeoutHandle);
      // Unregister from active deployments and clean up log buffer
      this.activeDeployments.delete(deploymentId);
      this.deploymentLogs.delete(deploymentId);
    }
  }

  /**
   * Deploy-only (skip build) — used for rollbacks
   */
  async runDeployOnly(deploymentId: string): Promise<void> {
    this.deploymentLogs.set(deploymentId, []);

    try {
      const ctx = await this.resolveContext(deploymentId);
      const deployment = await db.query.deployments.findFirst({
        where: eq(deployments.id, deploymentId),
      });

      if (!deployment?.imageName) {
        throw new Error('No image name found for deploy-only execution');
      }

      await updateDeployment(deploymentId, { deployStatus: 'deploying' });
      const deployStartTime = Date.now();

      await this.deployToSwarm(deploymentId, ctx, deployment.imageName);

      const swarm = new SwarmManager(ctx.deployNode);
      const serviceName = this.getSwarmServiceName(ctx.service);
      const convergence = await swarm.watchServiceConvergence(serviceName, 120_000);

      if (convergence.converged) {
        this.log(deploymentId, 'complete', 'Rollback deployment successful!', 'success');
        await updateDeployment(deploymentId, {
          deployStatus: 'running',
          deployDurationMs: Date.now() - deployStartTime,
          deployLogs: this.logsToText(deploymentId),
          completedAt: new Date(),
        });
      } else {
        throw new Error(`Service failed to converge: ${convergence.error}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log(deploymentId, 'error', message, 'error');
      await updateDeployment(deploymentId, {
        deployStatus: 'failed',
        errorMessage: message,
        deployLogs: this.logsToText(deploymentId),
        completedAt: new Date(),
      });
    }
  }

  /**
   * Test connectivity to a node — SSH + Docker check
   */
  async testNodeConnectivity(node: NodeConnectionInfo): Promise<{
    success: boolean;
    dockerVersion?: string;
    os?: string;
    cpuCores?: number;
    memoryTotal?: number;
    diskTotal?: number;
    error?: string;
    /** 'host' or 'container' — detected automatically */
    runtimeType?: string;
  }> {
    try {
      const sshConfig = {
        host: node.host,
        port: node.port,
        username: node.sshUser,
        privateKey: node.privateKey,
      };

      // Test SSH connectivity
      const whoami = await sshManager.exec(sshConfig, 'whoami');
      if (whoami.code !== 0) {
        return { success: false, error: `SSH failed: ${whoami.stderr}` };
      }

      // Check Docker version (--format works on all platforms, quotes are portable)
      const dockerVer = await sshManager.exec(
        sshConfig,
        'docker version --format "{{.Server.Version}}"'
      );
      if (dockerVer.code !== 0) {
        return { success: false, error: 'Docker not installed or not running' };
      }

      // Detect OS family first — Windows OpenSSH returns MINGW/MSYS/CYGWIN from uname, or fails entirely
      const unameCheck = await sshManager.exec(sshConfig, 'uname -s 2>/dev/null || echo WINDOWS');
      const unamePlatform = unameCheck.stdout.trim().toUpperCase();
      const isWindows = unamePlatform.includes('MINGW') || unamePlatform.includes('MSYS') ||
                        unamePlatform.includes('CYGWIN') || unamePlatform === 'WINDOWS';

      let os: string | undefined;
      let cpuCores: number | undefined;
      let memoryTotal: number | undefined;
      let diskTotal: number | undefined;
      let runtimeType = 'host';

      if (isWindows) {
        // ── Windows (OpenSSH / WSL boundary) ──────────────
        const osInfo = await sshManager.exec(sshConfig,
          'powershell -Command "(Get-CimInstance Win32_OperatingSystem).Caption"'
        );
        os = osInfo.stdout.trim() || 'Windows';

        const cpuInfo = await sshManager.exec(sshConfig,
          'powershell -Command "(Get-CimInstance Win32_Processor).NumberOfLogicalProcessors"'
        );
        cpuCores = parseInt(cpuInfo.stdout.trim()) || undefined;

        const memInfo = await sshManager.exec(sshConfig,
          'powershell -Command "(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory"'
        );
        memoryTotal = parseInt(memInfo.stdout.trim()) || undefined;

        const diskInfo = await sshManager.exec(sshConfig,
          'powershell -Command "(Get-CimInstance Win32_LogicalDisk -Filter \\\"DeviceID=\'C:\'\\\").Size"'
        );
        diskTotal = parseInt(diskInfo.stdout.trim()) || undefined;

        // Check if running inside WSL2 or Hyper-V container
        const hyperVCheck = await sshManager.exec(sshConfig,
          'powershell -Command "if ((Get-CimInstance Win32_ComputerSystem).Model -match \'Virtual\') { echo \'container\' } else { echo \'host\' }"'
        );
        runtimeType = hyperVCheck.stdout.trim() || 'host';
      } else {
        // ── Unix/Linux/macOS (works on Alpine, Busybox, Debian, RHEL, macOS, LXC) ──
        const osInfo = await sshManager.exec(sshConfig,
          "(cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d'\"' -f2) || uname -sr"
        );
        os = osInfo.stdout.trim() || undefined;

        const cpuInfo = await sshManager.exec(sshConfig,
          "nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 1"
        );
        cpuCores = parseInt(cpuInfo.stdout.trim()) || undefined;

        const memInfo = await sshManager.exec(sshConfig,
          "grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2 * 1024}' || sysctl -n hw.memsize 2>/dev/null || echo 0"
        );
        memoryTotal = parseInt(memInfo.stdout.trim()) || undefined;

        const diskInfo = await sshManager.exec(sshConfig,
          "df -P / 2>/dev/null | awk 'NR==2{print $2 * 1024}' || echo 0"
        );
        diskTotal = parseInt(diskInfo.stdout.trim()) || undefined;

        // Detect if running inside a container (LXC, Docker-in-Docker, K8s)
        const containerCheck = await sshManager.exec(sshConfig,
          "cat /proc/1/cgroup 2>/dev/null | grep -qE 'docker|lxc|kubepods' && echo 'container' || echo 'host'"
        );
        runtimeType = containerCheck.stdout.trim() || 'host';
      }

      return {
        success: true,
        dockerVersion: dockerVer.stdout.trim(),
        os,
        cpuCores,
        memoryTotal,
        diskTotal,
        runtimeType,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ── Private helpers ─────────────────────────────────────────

  private async resolveContext(deploymentId: string): Promise<DeploymentContext> {
    const deployment = await db.query.deployments.findFirst({
      where: eq(deployments.id, deploymentId),
      with: {
        service: {
          with: {
            project: true,
          },
        },
        buildNode: true,
        deployNode: true,
      },
    });

    if (!deployment) throw new Error(`Deployment ${deploymentId} not found`);
    if (!deployment.service) throw new Error('Service not found for deployment');

    // Get deploy node (required)
    const deployNodeRecord = deployment.deployNode;
    if (!deployNodeRecord) throw new Error('No deploy node assigned');

    const deployNodeKey = await db.query.sshKeys.findFirst({
      where: eq(sshKeys.id, deployNodeRecord.sshKeyId),
    });
    if (!deployNodeKey) throw new Error('SSH key not found for deploy node');

    const deployNode = nodeToConnectionInfo(deployNodeRecord, deployNodeKey);

    // Get build node (optional — only for git source)
    let buildNode: NodeConnectionInfo | null = null;
    const buildNodeRecord = deployment.buildNode;
    if (buildNodeRecord) {
      const buildNodeKey = await db.query.sshKeys.findFirst({
        where: eq(sshKeys.id, buildNodeRecord.sshKeyId),
      });
      if (buildNodeKey) {
        buildNode = nodeToConnectionInfo(buildNodeRecord, buildNodeKey);
      }
    }

    // Get default registry
    const registry = await db.query.registries.findFirst({
      where: and(
        eq(registries.organizationId, deployment.service.project.organizationId),
        eq(registries.isDefault, true)
      ),
    });

    // Get manager node (needed to orchestrate swarm commands)
    const managerNodeRecord = await db.query.nodes.findFirst({
      where: and(
        eq(nodes.organizationId, deployment.service.project.organizationId),
        eq(nodes.role, 'manager')
      ),
    });
    if (!managerNodeRecord) throw new Error('No manager node available in organization to orchestrate deployment');

    const managerNodeKey = await db.query.sshKeys.findFirst({
      where: eq(sshKeys.id, managerNodeRecord.sshKeyId),
    });
    if (!managerNodeKey) throw new Error('SSH key not found for manager node');

    const managerNode = nodeToConnectionInfo(managerNodeRecord, managerNodeKey);

    // Set up SSH tunnelling so Tailscale IPs (100.x.x.x) route through the manager node
    sshManager.setManagerConfig({
      host: managerNode.host,
      port: managerNode.port,
      username: managerNode.sshUser,
      privateKey: managerNode.privateKey,
    });

    const context: DeploymentContext = {
      deploymentId,
      service: {
        id: deployment.service.id,
        name: deployment.service.name,
        gitUrl: deployment.service.gitUrl,
        gitBranch: deployment.service.gitBranch,
        dockerfilePath: deployment.service.dockerfilePath,
        dockerContext: deployment.service.dockerContext,
        sourceType: deployment.service.sourceType,
        imageName: deployment.service.imageName,
        imageTag: deployment.service.imageTag,
        envVars: (deployment.service.envVars as Record<string, string>) || {},
        ports: (deployment.service.ports as any[]) || [],
        replicas: deployment.service.replicas,
        healthCheck: deployment.service.healthCheck,
        resourceLimits: deployment.service.resourceLimits,
        labels: (deployment.service.labels as Record<string, string>) || {},
        swarmServiceId: deployment.service.swarmServiceId,
        projectId: deployment.service.projectId,
        deployNodeIds: (deployment.service.deployNodeIds as string[]) || [],
      },
      buildNode,
      deployNode,
      managerNode,
      registry: registry
        ? { url: registry.url, username: registry.username, password: registry.password }
        : null,
      branch: deployment.branch || deployment.service.gitBranch || 'main',
      commitSha: deployment.commitSha,
      organizationId: deployment.service.project.organizationId,
      domains: [],
    };

    // Fetch domains assigned to this service
    const serviceDomains = await db.query.domains.findMany({
      where: eq(domains.serviceId, context.service.id),
    });
    context.domains = serviceDomains.map(d => ({
      hostname: d.hostname,
      sslEnabled: d.sslEnabled,
      sslProvider: d.sslProvider,
    }));

    return context;
  }

  private async cloneRepo(
    deploymentId: string,
    node: NodeConnectionInfo,
    gitUrl: string,
    branch: string,
    buildDir: string,
    organizationId?: string
  ) {
    const sshConfig = {
      host: node.host,
      port: node.port,
      username: node.sshUser,
      privateKey: node.privateKey,
    };

    // Attempt to inject GitHub App token for private repo access
    let authedUrl = gitUrl;
    if (organizationId && gitUrl.startsWith('https://github.com')) {
      const token = await getInstallationToken(organizationId);
      if (token) {
        authedUrl = gitUrl.replace('https://github.com', `https://x-access-token:${token}@github.com`);
        this.log(deploymentId, 'clone', 'Using GitHub App token for private repo access');
      }
    }

    // Clean previous build dir and clone
    const cleanCmd = buildDir.includes(':')
      ? `powershell -Command "if (Test-Path '${buildDir}') { Remove-Item -Recurse -Force '${buildDir}' }; git clone --depth 1 --branch ${branch} ${authedUrl} '${buildDir}'"`
      : `rm -rf ${buildDir} && git clone --depth 1 --branch ${branch} ${authedUrl} ${buildDir}`;

    const result = await sshManager.exec(sshConfig, cleanCmd);

    if (result.code !== 0) {
      throw new Error(`Git clone failed: ${result.stderr}`);
    }

    this.log(deploymentId, 'clone', `Cloned successfully to ${buildDir}`, 'success');
  }

  private async dockerBuild(
    deploymentId: string,
    node: NodeConnectionInfo,
    buildDir: string,
    imageName: string,
    service: DeploymentContext['service'],
    signal?: AbortSignal
  ) {
    const sshConfig = {
      host: node.host,
      port: node.port,
      username: node.sshUser,
      privateKey: node.privateKey,
    };

    const context = service.dockerContext || '.';
    const contextPath = context === '.' ? buildDir : `${buildDir}/${context}`;

    // Determine which Dockerfile path to look for
    const dockerfile = service.dockerfilePath || 'Dockerfile';

    // Check if the Dockerfile actually exists in the cloned repo
    const checkResult = await sshManager.exec(
      sshConfig,
      `test -f ${buildDir}/${dockerfile} && echo "EXISTS" || echo "MISSING"`
    );
    const dockerfileExists = checkResult.stdout.trim().includes('EXISTS');
    const isCustomPath = dockerfile !== 'Dockerfile';

    // If user explicitly set a custom path but it doesn't exist, that's an error
    if (isCustomPath && !dockerfileExists) {
      throw new Error(`Specified Dockerfile not found: ${dockerfile}`);
    }

    // Use Dockerfile if it exists, otherwise fall back to nixpacks (auto-detect)
    let useDockerfile = dockerfileExists;

    if (useDockerfile) {
      // Dockerfile build (auto-detected or explicitly specified)
      this.log(deploymentId, 'build', `Using Dockerfile: ${dockerfile}`);

      const sanitize = (s: string) => s.replace(/['"\\$`!;|&(){}]/g, '');
      const buildArgs: string[] = [];
      for (const [key, value] of Object.entries(service.envVars)) {
        buildArgs.push(`--build-arg ${sanitize(key)}="${sanitize(value)}"`);
      }

      const cmd = [
        buildDir.includes(':') ? `cd /d "${buildDir}" &&` : `cd ${buildDir} &&`,
        'docker build',
        `-t ${imageName}`,
        `-f ${dockerfile}`,
        ...buildArgs,
        contextPath,
      ].join(' ');

      const result = await sshManager.execStream(sshConfig, cmd, (line) => {
        this.log(deploymentId, 'build', line);
      }, { idleTimeoutMs: 1800000, signal }); // 30 minutes timeout

      if (result.code !== 0) {
        throw new Error(`Docker build failed: ${result.stderr}`);
      }
    } else {
      // Nixpacks — default builder
      this.log(deploymentId, 'build', `Building with nixpacks (auto-detect)...`);

      // Ensure nixpacks is installed
      const nixCheck = await sshManager.exec(sshConfig, 'which nixpacks || echo "NOT_FOUND"');
      if (nixCheck.stdout.trim().includes('NOT_FOUND')) {
        this.log(deploymentId, 'build', `Installing nixpacks on build node...`);
        const installResult = await sshManager.exec(
          sshConfig,
          'curl -sSL https://nixpacks.com/install.sh | bash'
        );
        if (installResult.code !== 0) {
          throw new Error(`Failed to install nixpacks: ${installResult.stderr}`);
        }
        this.log(deploymentId, 'build', `Nixpacks installed successfully`);
      }

      // Build environment args
      const sanitize = (s: string) => s.replace(/['"\\$`!;|&(){}]/g, '');
      const envArgs: string[] = [];
      for (const [key, value] of Object.entries(service.envVars)) {
        envArgs.push(`--env ${sanitize(key)}="${sanitize(value)}"`);
      }

      const nixCmd = [
        `cd ${buildDir} &&`,
        `DOCKER_BUILDKIT=1`,
        'nixpacks build',
        contextPath,
        `--name ${imageName}`,
        ...envArgs,
      ].join(' ');

      const result = await sshManager.execStream(sshConfig, nixCmd, (line) => {
        this.log(deploymentId, 'build', line);
      }, { idleTimeoutMs: 1800000, signal }); // 30 minutes timeout

      if (result.code !== 0) {
        throw new Error(`Nixpacks build failed: ${result.stderr}`);
      }
    }

    this.log(deploymentId, 'build', `Image ${imageName} built successfully`, 'success');
  }

  private async dockerPush(
    deploymentId: string,
    node: NodeConnectionInfo,
    imageName: string,
    registry: DeploymentContext['registry']
  ) {
    const sshConfig = {
      host: node.host,
      port: node.port,
      username: node.sshUser,
      privateKey: node.privateKey,
    };

    // Login to registry if credentials provided
    if (registry && registry.username && registry.password) {
      const safePass = registry.password.replace(/["\\$`]/g, '\\$&');
      const safeUser = registry.username.replace(/["\\$`]/g, '\\$&');
      const loginResult = await sshManager.exec(
        sshConfig,
        `echo "${safePass}" | docker login ${registry.url} -u "${safeUser}" --password-stdin`
      );
      if (loginResult.code !== 0) {
        throw new Error(`Registry login failed: ${loginResult.stderr}`);
      }
    }

    const result = await sshManager.exec(sshConfig, `docker push ${imageName}`);
    if (result.code !== 0) {
      throw new Error(`Docker push failed: ${result.stderr}`);
    }

    this.log(deploymentId, 'push', `Pushed ${imageName} to registry`, 'success');
  }

  private async deployToSwarm(
    deploymentId: string,
    ctx: DeploymentContext,
    image: string,
  ) {
    const swarm = new SwarmManager(ctx.managerNode);
    const serviceName = this.getSwarmServiceName(ctx.service);

    // Check if service already exists
    const sshConfig = {
      host: ctx.managerNode.host,
      port: ctx.managerNode.port,
      username: ctx.managerNode.sshUser,
      privateKey: ctx.managerNode.privateKey,
    };
    const inspectResult = await sshManager.exec(
      sshConfig,
      `docker service inspect ${serviceName} --format '{{.ID}}' 2>/dev/null`
    );

    const serviceExists = inspectResult.code === 0 && inspectResult.stdout.trim().length > 0;

    // ── Multi-node placement ─────────────────────────────
    // Label selected deploy nodes so Swarm places replicas on them.
    // Only add placement constraints if at least one node was successfully labeled.
    const deployNodeIds = ctx.service.deployNodeIds || [];
    const placementLabel = `click-deploy.svc-${ctx.service.id}`;
    const constraints: string[] = [];
    let labeledCount = 0;

    if (deployNodeIds.length > 0) {
      this.log(deploymentId, 'deploy', `Targeting ${deployNodeIds.length} node(s) for deployment`);

      // Pre-fetch all Swarm node info once (ID, hostname, addr)
      const swarmNodesResult = await sshManager.exec(
        sshConfig,
        `docker node ls --format '{{.ID}} {{.Hostname}} {{.Status}}' 2>/dev/null`
      );
      const swarmNodes = swarmNodesResult.stdout.split('\n')
        .filter((l: string) => l.trim())
        .map((l: string) => {
          const parts = l.trim().split(/\s+/);
          // ID may have a trailing * for the current leader
          return { id: (parts[0] || '').replace('*', ''), hostname: parts[1] || '', status: parts[2] || '' };
        });

      for (const nodeId of deployNodeIds) {
        const nodeRecord = await db.query.nodes.findFirst({
          where: eq(nodes.id, nodeId),
        });
        if (!nodeRecord) {
          this.log(deploymentId, 'deploy', `Deploy node ${nodeId} not found in database, skipping`, 'error');
          continue;
        }

        let swarmId = nodeRecord.swarmNodeId;

        // If we don't have a cached swarmNodeId, resolve it now
        if (!swarmId) {
          // Match by hostname or by host IP — Swarm node hostnames can be anything
          const match = swarmNodes.find(
            (sn: { id: string; hostname: string; status: string }) =>
              sn.hostname === nodeRecord.host ||
              sn.hostname === nodeRecord.name ||
              sn.hostname.toLowerCase() === nodeRecord.name.toLowerCase()
          );

          if (match) {
            swarmId = match.id;
            // Cache for future deployments
            await db.update(nodes).set({ swarmNodeId: swarmId }).where(eq(nodes.id, nodeId));
            this.log(deploymentId, 'deploy', `Resolved Swarm node for "${nodeRecord.name}": ${swarmId}`);
          } else {
            this.log(deploymentId, 'deploy', `Could not resolve Swarm node for "${nodeRecord.name}" (host: ${nodeRecord.host}). Skipping placement label.`, 'error');
            continue;
          }
        }

        // Apply the placement label
        const labelResult = await sshManager.exec(
          sshConfig,
          `docker node update --label-add ${placementLabel}=true ${swarmId}`
        );
        if (labelResult.code === 0) {
          labeledCount++;
        } else {
          this.log(deploymentId, 'deploy', `Failed to label Swarm node ${swarmId}: ${labelResult.stderr}`, 'error');
        }
      }

      // Only add the constraint if we actually labeled at least one node
      if (labeledCount > 0) {
        constraints.push(`node.labels.${placementLabel}==true`);
        this.log(deploymentId, 'deploy', `Placement constraint active: ${labeledCount}/${deployNodeIds.length} node(s) labeled`);
      } else {
        this.log(deploymentId, 'deploy', `No nodes could be labeled — deploying without placement constraints (Swarm will schedule freely)`, 'error');
      }
    }

    if (serviceExists) {
      // Update existing service — zero-downtime rolling update
      this.log(deploymentId, 'deploy', `Updating existing service: ${serviceName}`);
      await swarm.updateService(serviceName, image, {
        envVars: ctx.service.envVars,
        replicas: ctx.service.replicas,
        constraints,
        labels: {
          'click-deploy.service-id': ctx.service.id,
          'click-deploy.deployment-id': deploymentId,
          ...this.buildTraefikLabels(deploymentId, ctx, serviceName),
        },
      });
    } else {
      // Create new service
      this.log(deploymentId, 'deploy', `Creating new service: ${serviceName}`);
      
      this.log(deploymentId, 'deploy', `Checking network prerequisites...`);
      await sshManager.exec(
        sshConfig,
        `docker network inspect click-deploy-net >/dev/null 2>&1 || docker network create --driver overlay --attachable click-deploy-net`
      );

      // When domains are assigned, Traefik handles HTTP routing via overlay network.
      // No need to publish host ports — avoids conflicts when multiple services use the same container port.
      // Only publish host ports when NO domains are set (direct TCP/UDP access).
      const hasDomains = ctx.domains && ctx.domains.length > 0;
      if (hasDomains) {
        this.log(deploymentId, 'deploy', `${ctx.domains.length} domain(s) assigned — Traefik handles routing (no host ports published)`);
      }

      await swarm.createService({
        name: serviceName,
        image,
        replicas: ctx.service.replicas,
        constraints,

        ports: hasDomains
          ? [] // Traefik routes traffic — no host port publishing needed
          : ctx.service.ports
            .filter(p => {
              const hostPort = p.host || p.container;
              if (hostPort <= 0 || hostPort > 65535 || p.container <= 0 || p.container > 65535) return false;
              if (RESERVED_PORTS.has(hostPort)) {
                this.log(deploymentId, 'deploy', `Skipping reserved port ${hostPort} (used by platform)`, 'error');
                return false;
              }
              return true;
            })
            .map((p) => ({
              published: p.host || p.container,
              target: p.container,
              protocol: p.protocol as 'tcp' | 'udp',
            })),
        envVars: ctx.service.envVars,
        labels: {
          ...ctx.service.labels,
          'click-deploy.service-id': ctx.service.id,
          'click-deploy.deployment-id': deploymentId,
          // Add Traefik routing labels based on assigned domains
          ...this.buildTraefikLabels(deploymentId, ctx, serviceName),
        },
        healthCheck: ctx.service.healthCheck
          ? {
              cmd: `CMD-SHELL ${ctx.service.healthCheck.path ? `curl -f http://localhost:${ctx.service.ports[0]?.container || 3000}${ctx.service.healthCheck.path} || exit 1` : 'exit 0'}`,
              interval: `${ctx.service.healthCheck.interval || 30}s`,
              timeout: `${ctx.service.healthCheck.timeout || 10}s`,
              retries: ctx.service.healthCheck.retries || 3,
              startPeriod: `${ctx.service.healthCheck.startPeriod || 30}s`,
            }
          : undefined,
        resourceLimits: ctx.service.resourceLimits || undefined,
        networks: ['click-deploy-net'],
      });

      // Store swarm service reference
      const swarmInspect = await sshManager.exec(
        sshConfig,
        `docker service inspect ${serviceName} --format '{{.ID}}'`
      );
      if (swarmInspect.code === 0) {
        await db.update(services)
          .set({ swarmServiceId: swarmInspect.stdout.trim() })
          .where(eq(services.id, ctx.service.id));
      }
    }

    this.log(deploymentId, 'deploy', `Waiting for service ${serviceName} to converge (verifying health)...`);
    
    const convergence = await swarm.watchServiceConvergence(serviceName, 180000);
    
    if (!convergence.converged) {
      this.log(deploymentId, 'deploy', `Container crash/healthcheck failed. Attempting to fetch logs...`, 'error');
      
      // Pull crash logs
      const logsResult = await sshManager.exec(sshConfig, `docker service logs --tail 30 ${serviceName} 2>&1`);
      if (logsResult.stdout) {
        logsResult.stdout.split(/[\r\n]+/)
          .filter(Boolean)
          .forEach((line: string) => this.log(deploymentId, 'deploy', `> ${line.trim()}`, 'error'));
      }
      
      // Clean up orphaned service or rollback
      if (!serviceExists) {
        await swarm.removeService(serviceName).catch(() => {});
      } else {
        await swarm.rollbackService(serviceName).catch(() => {});
      }
      
      throw new Error(`Service failed to converge: ${convergence.error || 'Unknown error'}`);
    }

    this.log(deploymentId, 'deploy', `Service ${serviceName} deployed`, 'success');
  }

  private getSwarmServiceName(service: DeploymentContext['service']): string {
    // Convention: prefix with project context for uniqueness
    return `cd-${service.name}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  }

  private getImageName(ctx: DeploymentContext): string {
    const registryPrefix = ctx.registry ? `${ctx.registry.url}/` : '';
    return `${registryPrefix}${ctx.service.name}`.toLowerCase().replace(/[^a-z0-9/:.-]/g, '-');
  }

  private logsToText(deploymentId: string): string {
    const logs = this.deploymentLogs.get(deploymentId) || [];
    return logs
      .map((l: DeploymentLog) => `[${l.timestamp.toISOString()}] [${l.step}] ${l.message}`)
      .join('\n');
  }

  /**
   * Build Traefik routing labels from the service's assigned domains.
   * If no domains are assigned, returns empty (service won't be exposed via Traefik).
   */
  private buildTraefikLabels(
    deploymentId: string,
    ctx: DeploymentContext,
    serviceName: string
  ): Record<string, string> {
    if (ctx.domains.length === 0) return {};

    const targetPort = ctx.service.ports[0]?.container || 3000;

    const routes: TraefikRouteConfig[] = ctx.domains.map((d, idx) => ({
      routerName: idx === 0 ? serviceName : `${serviceName}-${idx}`,
      hostname: d.hostname,
      targetPort,
      sslEnabled: d.sslEnabled,
      sslProvider: d.sslProvider as any,
    }));

    this.log(deploymentId, 'traefik', `Configuring ${routes.length} domain(s): ${ctx.domains.map(d => d.hostname).join(', ')}`);

    return generateTraefikLabels(serviceName, routes);
  }
}

// Singleton engine instance
export const deploymentEngine = new DeploymentEngine();
