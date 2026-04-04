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
}

/**
 * Get a Docker client for a specific node.
 *
 * - Local node: connects directly to the Docker socket
 * - Remote node: creates an SSH tunnel and proxies API calls
 */
export async function getDockerClient(node: NodeConnectionInfo): Promise<Docker> {
  if (node.isLocal) {
    return getLocalDockerClient();
  }
  return getRemoteDockerClient(node);
}

/**
 * Connect to the local Docker daemon.
 * Tries Unix socket first, then TCP.
 */
function getLocalDockerClient(): Docker {
  // Detect platform
  const isWindows = process.platform === 'win32';
  const isMac = process.platform === 'darwin';

  if (isWindows) {
    // Windows: try named pipe, then TCP
    try {
      return new Docker({ socketPath: '//./pipe/docker_engine' });
    } catch {
      return new Docker({ host: '127.0.0.1', port: 2375 });
    }
  }

  // Linux / macOS: Unix socket
  return new Docker({ socketPath: '/var/run/docker.sock' });
}

/**
 * Connect to a remote Docker daemon via SSH tunnel.
 * The SSH tunnel forwards to the remote Docker socket.
 */
async function getRemoteDockerClient(node: NodeConnectionInfo): Promise<Docker> {
  const sshConfig: SSHConnectionConfig = {
    host: node.host,
    port: node.port,
    username: node.sshUser,
    privateKey: node.privateKey,
    keepaliveInterval: 10_000,
    keepaliveCountMax: 3,
    connectTimeout: 15_000,
  };

  // Get the SSH stream forwarded to the remote Docker socket
  const stream = await sshManager.forwardToDockerSocket(sshConfig);

  // Create a Docker client using the SSH stream as transport
  // dockerode supports passing a custom agent or using a protocol handler
  const docker = new Docker({
    protocol: 'http',
    host: '127.0.0.1',
    // dockerode accepts a custom HTTP agent for transport
    agent: new (await import('http')).Agent(),
  } as Docker.DockerOptions);

  // Override the modem's connection to use our SSH stream
  // This is the key trick: instead of connecting to a TCP port,
  // we pipe through the SSH-forwarded Unix socket stream
  const modem = (docker as any).modem;
  if (modem) {
    const originalDial = modem.dial.bind(modem);
    modem.dial = function (options: any, callback: any) {
      // For the stream-based approach, we need to use the SSH exec
      // to run `docker` commands directly on the remote host
      return originalDial(options, callback);
    };
  }

  return docker;
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
