// ============================================================
// Click-Deploy — Node Heartbeat Monitor
// ============================================================
// Background process that polls node health every 60 seconds.
// Collects CPU, memory, disk usage and updates the database.
// Marks nodes as offline after 3 consecutive SSH failures.
// ============================================================
import { eq, and, ne } from 'drizzle-orm';
import { db, nodes, sshKeys } from '@click-deploy/database';
import { sshManager } from '@click-deploy/docker';
import { decryptPrivateKey } from './crypto';

const HEARTBEAT_INTERVAL_MS = 60_000; // 1 minute
const MAX_CONSECUTIVE_FAILURES = 3;

// Track consecutive failures per node
const failureCount = new Map<string, number>();

// Counter for offline re-probe cycles (every 5th cycle = ~5 minutes)
let heartbeatCycleCount = 0;
const OFFLINE_REPROBE_INTERVAL = 5; // re-check offline nodes every N cycles

let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the heartbeat monitor.
 * Runs in-process — no external job queue needed.
 */
export function startHeartbeatMonitor() {
  if (heartbeatInterval) return; // Already running

  console.log('[heartbeat] Starting node health monitor (interval: 60s)');

  // Run immediately, then on interval
  runHeartbeat().catch(console.error);
  heartbeatInterval = setInterval(() => {
    runHeartbeat().catch(console.error);
  }, HEARTBEAT_INTERVAL_MS);
}

/**
 * Stop the heartbeat monitor.
 */
export function stopHeartbeatMonitor() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
    console.log('[heartbeat] Stopped node health monitor');
  }
}

/**
 * Single heartbeat cycle — poll all online/maintenance nodes.
 */
async function runHeartbeat() {
  try {
    heartbeatCycleCount++;
    const shouldReprobeOffline = heartbeatCycleCount % OFFLINE_REPROBE_INTERVAL === 0;

    // Get all nodes that should be monitored
    // Normally skip offline nodes, but periodically re-probe them
    const allNodes = shouldReprobeOffline
      ? await db.query.nodes.findMany({ with: { sshKey: true } })
      : await db.query.nodes.findMany({
          where: ne(nodes.status, 'offline'),
          with: { sshKey: true },
        });

    if (allNodes.length === 0) return;

    if (shouldReprobeOffline) {
      const offlineCount = allNodes.filter(n => n.status === 'offline').length;
      if (offlineCount > 0) {
        console.log(`[heartbeat] Re-probing ${offlineCount} offline node(s) (cycle ${heartbeatCycleCount})`);
      }
    }

    // Set up Tailscale tunnel config: find the manager node so
    // heartbeats to Tailscale IPs (100.x.x.x) route through it
    const managerNode = allNodes.find(n => n.role === 'manager' && n.sshKey);
    if (managerNode?.sshKey) {
      sshManager.setManagerConfig({
        host: managerNode.tailscaleIp || managerNode.host,
        port: managerNode.port,
        username: managerNode.sshUser,
        privateKey: decryptPrivateKey(managerNode.sshKey.privateKey),
      });
    }

    // Poll each node concurrently (max 5 at a time)
    const batchSize = 5;
    for (let i = 0; i < allNodes.length; i += batchSize) {
      const batch = allNodes.slice(i, i + batchSize);
      await Promise.allSettled(
        batch.map((node) => pollNode(node, node.sshKey))
      );
    }
  } catch (err) {
    console.error('[heartbeat] Error running heartbeat cycle:', err);
  }
}

/**
 * Poll a single node for resource usage.
 */
async function pollNode(node: typeof nodes.$inferSelect, sshKey: typeof sshKeys.$inferSelect) {
  if (!sshKey) {
    console.warn(`[heartbeat] Node ${node.name} has no SSH key`);
    return;
  }

  const sshConfig = {
    host: node.tailscaleIp || node.host, // Prefer Tailscale IP for mesh connectivity
    port: node.port,
    username: node.sshUser,
    privateKey: decryptPrivateKey(sshKey.privateKey),
  };

  try {
    // Single SSH command that collects all metrics at once
    const result = await sshManager.exec(
      sshConfig,
      `echo "CPU:$(top -bn1 | head -3 | grep '%Cpu' | awk '{print $2}' 2>/dev/null || mpstat 1 1 | tail -1 | awk '{print 100-$NF}' 2>/dev/null || echo 0)" && \
       echo "MEM_USED:$(free -b 2>/dev/null | awk '/^Mem:/{print $3}' || echo 0)" && \
       echo "MEM_TOTAL:$(free -b 2>/dev/null | awk '/^Mem:/{print $2}' || echo 0)" && \
       echo "DISK_USED:$(df -B1 / 2>/dev/null | awk 'NR==2{print $3}' || echo 0)" && \
       echo "DISK_TOTAL:$(df -B1 / 2>/dev/null | awk 'NR==2{print $2}' || echo 0)" && \
       echo "DOCKER:$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo unknown)" && \
       echo "CPUS:$(nproc 2>/dev/null || echo 0)"`
    );

    if (result.code !== 0) {
      throw new Error(`SSH command failed: ${result.stderr}`);
    }

    // Parse metrics
    const lines = result.stdout.split('\n');
    const getValue = (prefix: string) => {
      const line = lines.find((l: string) => l.startsWith(prefix));
      return line ? line.split(':')[1]?.trim() : '0';
    };

    const cpuUsage = parseFloat(getValue('CPU') || '0') || 0;
    const memUsed = parseInt(getValue('MEM_USED') || '0') || 0;
    const memTotal = parseInt(getValue('MEM_TOTAL') || '0') || 0;
    const diskUsed = parseInt(getValue('DISK_USED') || '0') || 0;
    const diskTotal = parseInt(getValue('DISK_TOTAL') || '0') || 0;
    const dockerVersion = getValue('DOCKER') || undefined;
    const cpuCores = parseInt(getValue('CPUS') || '0') || undefined;

    // Update node in database
    await db
      .update(nodes)
      .set({
        status: 'online',
        lastHeartbeatAt: new Date(),
        dockerVersion: dockerVersion !== 'unknown' ? dockerVersion : node.dockerVersion,
        resources: {
          cpuUsage: Math.round(cpuUsage * 10) / 10,
          cpuCores,
          memoryUsed: memUsed,
          memoryTotal: memTotal,
          diskUsed,
          diskTotal,
        },
      })
      .where(eq(nodes.id, node.id));

    // Reset failure count on success
    failureCount.delete(node.id);

  } catch (err) {
    const count = (failureCount.get(node.id) || 0) + 1;
    failureCount.set(node.id, count);

    console.warn(
      `[heartbeat] Node ${node.name} (${node.host}) probe failed (${count}/${MAX_CONSECUTIVE_FAILURES}):`,
      err instanceof Error ? err.message : err
    );

    if (count >= MAX_CONSECUTIVE_FAILURES) {
      console.error(`[heartbeat] Marking node ${node.name} as OFFLINE`);
      await db
        .update(nodes)
        .set({ status: 'offline' })
        .where(eq(nodes.id, node.id));
      failureCount.delete(node.id);
    }
  }
}
