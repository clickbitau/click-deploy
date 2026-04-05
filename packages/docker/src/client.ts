// ============================================================
// Click-Deploy — Docker Client Factory
// ============================================================
// Creates Docker API clients for local and remote nodes.
// Remote nodes connect via SSH tunnel to the Docker socket.
// Supports Linux, macOS, and Windows Docker installations.
// ============================================================
import Docker from 'dockerode';
import { sshManager, type SSHConnectionConfig } from './ssh';

export interface NodeConnectionInfo {
  id: string;
  name: string;
  host: string;
  port: number;
  sshUser: string;
  privateKey: string; // decrypted
  isLocal?: boolean;
  tailscaleIp?: string | null;
}



/**
 * Simplified remote Docker client that executes `docker` CLI
 * commands over SSH. More reliable than socket forwarding for
 * cross-platform (Windows, macOS, Proxmox LXC) scenarios.
 *
 * This is the "honest" approach — instead of trying to proxy
 * the Docker API over SSH Unix socket (which has edge cases),
 * we exec Docker commands directly and parse the JSON output.
 */
export class RemoteDockerCLI {
  constructor(private sshConfig: SSHConnectionConfig) {}

  /** Execute a docker command and return parsed JSON output */
  async exec(args: string): Promise<any> {
    const result = await sshManager.exec(
      this.sshConfig,
      `docker ${args}`
    );

    if (result.code !== 0) {
      throw new Error(`Docker command failed (exit ${result.code}): ${result.stderr || result.stdout}`);
    }

    return result.stdout;
  }

  /** Execute a docker command and parse JSON output */
  async execJson<T = any>(args: string): Promise<T> {
    const stdout = await this.exec(`${args} --format '{{json .}}'`);

    // Handle multi-line JSON (like `docker ps --format`)
    const lines = stdout.split('\n').filter((l: string) => l.trim());
    if (lines.length === 1) {
      return JSON.parse(lines[0]);
    }
    return lines.map((l: string) => JSON.parse(l)) as T;
  }

  /** Get Docker system info */
  async info(): Promise<any> {
    return this.execJson('system info');
  }

  /** Get Docker version */
  async version(): Promise<string> {
    const result = await sshManager.exec(
      this.sshConfig,
      'docker version --format "{{.Server.Version}}"'
    );
    return result.stdout;
  }

  /** List containers */
  async listContainers(all = false): Promise<any[]> {
    return this.execJson(`ps ${all ? '-a' : ''}`);
  }

  /** Get Swarm info */
  async swarmInfo(): Promise<{ isManager: boolean; nodeId: string | null; managers: number; nodes: number }> {
    try {
      const info = await this.exec('info --format "{{.Swarm.LocalNodeState}} {{.Swarm.NodeID}} {{.Swarm.Managers}} {{.Swarm.Nodes}}"');
      const parts = info.split(' ');
      return {
        isManager: parts[0] === 'active',
        nodeId: parts[1] || null,
        managers: parseInt(parts[2]) || 0,
        nodes: parseInt(parts[3]) || 0,
      };
    } catch {
      return { isManager: false, nodeId: null, managers: 0, nodes: 0 };
    }
  }

  /** List Swarm services */
  async listServices(): Promise<any[]> {
    return this.execJson('service ls');
  }

  /** Get container stats (non-streaming) */
  async containerStats(containerId: string): Promise<any> {
    return this.execJson(`stats ${containerId} --no-stream`);
  }
}

/**
 * Create a RemoteDockerCLI client for a node.
 * Preferred over raw dockerode for cross-platform reliability.
 */
export function createRemoteCLI(node: NodeConnectionInfo): RemoteDockerCLI {
  return new RemoteDockerCLI({
    host: node.host,
    port: node.port,
    username: node.sshUser,
    privateKey: node.privateKey,
  });
}
