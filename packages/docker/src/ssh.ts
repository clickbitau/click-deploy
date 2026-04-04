// ============================================================
// Click-Deploy — SSH Connection Manager
// ============================================================
// Manages SSH connections to remote nodes across the world.
// Handles: VPS, dedicated VMs, Proxmox LXC, Mac, Windows, Linux.
// Provides connection pooling, keepalives, and auto-reconnection.
// ============================================================
import { Client as SSHClient, type ConnectConfig } from 'ssh2';
import type { Duplex } from 'stream';

export interface SSHConnectionConfig {
  host: string;
  port: number;
  username: string;
  privateKey: string;
  /** How often to send keepalive packets (ms). Default 10s. */
  keepaliveInterval?: number;
  /** How many failed keepalives before considering dead. Default 3. */
  keepaliveCountMax?: number;
  /** Connection timeout (ms). Default 15s. */
  connectTimeout?: number;
}

export interface SSHConnection {
  client: SSHClient;
  config: SSHConnectionConfig;
  connectedAt: Date;
  lastActivity: Date;
  isAlive: boolean;
}

/**
 * Manages a pool of SSH connections to remote Docker nodes.
 * 
 * Design decisions:
 * - Connections are pooled per host:port to avoid re-establishing SSH
 * - Keepalives detect dead connections before we try to use them
 * - Auto-reconnection on failure with exponential backoff
 * - Cross-platform: handles Linux (/var/run/docker.sock),
 *   macOS (/var/run/docker.sock), and Windows (//./pipe/docker_engine)
 */
export class SSHConnectionManager {
  private connections = new Map<string, SSHConnection>();
  private reconnectTimers = new Map<string, NodeJS.Timeout>();

  /** Manager node config for Tailscale jump connections */
  private managerConfig: SSHConnectionConfig | null = null;

  /** Set the manager node config for proxying Tailscale connections */
  setManagerConfig(config: SSHConnectionConfig | null) {
    this.managerConfig = config;
  }

  private getKey(config: SSHConnectionConfig): string {
    return `${config.host}:${config.port}`;
  }

  /** Check if an IP is a Tailscale CGNAT address (100.64.0.0/10) */
  private isTailscaleIP(host: string): boolean {
    const parts = host.split('.').map(Number);
    if (parts.length !== 4 || parts[0] !== 100) return false;
    // Tailscale uses 100.64.0.0/10 => second octet 64-127
    return parts[1]! >= 64 && parts[1]! <= 127;
  }

  /**
   * Get or create an SSH connection to a remote node.
   * Returns the existing connection if still alive.
   */
  async connect(config: SSHConnectionConfig): Promise<SSHClient> {
    const key = this.getKey(config);
    const existing = this.connections.get(key);

    if (existing?.isAlive) {
      existing.lastActivity = new Date();
      return existing.client;
    }

    // Clean up dead connection if any
    if (existing) {
      this.cleanup(key);
    }

    return this.createConnection(config);
  }

  /**
   * Create a new SSH connection with keepalives and error handling.
   * If the target is a Tailscale IP and a manager config is set,
   * routes the connection through the manager node's SSH tunnel.
   */
  private async createConnection(config: SSHConnectionConfig): Promise<SSHClient> {
    const key = this.getKey(config);

    // For Tailscale IPs, proxy through the manager node
    if (this.isTailscaleIP(config.host) && this.managerConfig && !this.isTailscaleIP(this.managerConfig.host)) {
      console.log(`🔗 Tailscale IP ${config.host} detected — routing through manager ${this.managerConfig.host}`);
      return this.createTunnelledConnection(config);
    }

    return new Promise((resolve, reject) => {
      const client = new SSHClient();
      const timeout = config.connectTimeout ?? 15_000;

      const timer = setTimeout(() => {
        client.end();
        reject(new Error(`SSH connection to ${config.host}:${config.port} timed out after ${timeout}ms`));
      }, timeout);

      client.on('ready', () => {
        clearTimeout(timer);

        const conn: SSHConnection = {
          client,
          config,
          connectedAt: new Date(),
          lastActivity: new Date(),
          isAlive: true,
        };

        this.connections.set(key, conn);
        console.log(`✅ SSH connected: ${config.username}@${config.host}:${config.port}`);
        resolve(client);
      });

      client.on('error', (err) => {
        clearTimeout(timer);
        console.error(`❌ SSH error for ${config.host}:${config.port}:`, err.message);

        const conn = this.connections.get(key);
        if (conn) {
          conn.isAlive = false;
        }

        // Schedule reconnection
        this.scheduleReconnect(config);

        reject(err);
      });

      client.on('close', () => {
        const conn = this.connections.get(key);
        if (conn) {
          conn.isAlive = false;
          console.log(`🔌 SSH disconnected: ${config.host}:${config.port}`);
          this.scheduleReconnect(config);
        }
      });

      client.on('end', () => {
        const conn = this.connections.get(key);
        if (conn) {
          conn.isAlive = false;
        }
      });

      const connectConfig: ConnectConfig = {
        host: config.host,
        port: config.port,
        username: config.username,
        privateKey: config.privateKey,
        keepaliveInterval: config.keepaliveInterval ?? 10_000,
        keepaliveCountMax: config.keepaliveCountMax ?? 3,
        readyTimeout: timeout,
        // Disable host key verification for now
        // TODO: Store and verify host keys for TOFU (Trust On First Use)
        algorithms: {
          serverHostKey: ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'ssh-rsa'],
        },
      };

      client.connect(connectConfig);
    });
  }

  /**
   * Create an SSH connection tunnelled through the manager node.
   * Uses `tailscale nc` on the manager to route through the Tailscale daemon.
   * This works with both TUN and userspace networking modes.
   *
   * Flow: Docker container → SSH to manager → `tailscale nc <IP> <port>` → remote node
   */
  private async createTunnelledConnection(config: SSHConnectionConfig): Promise<SSHClient> {
    const key = this.getKey(config);
    const managerClient = await this.connect(this.managerConfig!);

    return new Promise((resolve, reject) => {
      const timeout = config.connectTimeout ?? 30_000;
      const timer = setTimeout(() => {
        reject(new Error(`SSH tunnel to ${config.host}:${config.port} via manager timed out`));
      }, timeout);

      // Use `tailscale nc` on the manager to create a TCP stream to the Tailscale IP
      // This routes through the Tailscale daemon, works in userspace mode
      managerClient.exec(
        `tailscale nc ${config.host} ${config.port}`,
        (err, stream) => {
          if (err) {
            clearTimeout(timer);
            reject(new Error(`Failed to start tailscale nc for ${config.host}:${config.port}: ${err.message}`));
            return;
          }

          // Now SSH through the tailscale nc stream
          const client = new SSHClient();

          client.on('ready', () => {
            clearTimeout(timer);
            const conn: SSHConnection = {
              client,
              config,
              connectedAt: new Date(),
              lastActivity: new Date(),
              isAlive: true,
            };
            this.connections.set(key, conn);
            console.log(`✅ SSH connected via Tailscale tunnel: ${config.username}@${config.host}:${config.port}`);
            resolve(client);
          });

          client.on('error', (connErr) => {
            clearTimeout(timer);
            console.error(`❌ SSH tunnel error for ${config.host}:`, connErr.message);
            reject(connErr);
          });

          client.on('close', () => {
            const conn = this.connections.get(key);
            if (conn) {
              conn.isAlive = false;
              console.log(`🔌 SSH tunnel disconnected: ${config.host}:${config.port}`);
            }
          });

          client.on('end', () => {
            const conn = this.connections.get(key);
            if (conn) conn.isAlive = false;
          });

          client.connect({
            sock: stream as unknown as Duplex,
            username: config.username,
            privateKey: config.privateKey,
            keepaliveInterval: config.keepaliveInterval ?? 10_000,
            keepaliveCountMax: config.keepaliveCountMax ?? 3,
            readyTimeout: timeout,
            algorithms: {
              serverHostKey: ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'ssh-rsa'],
            },
          });
        },
      );
    });
  }

  /**
   * Inject a public key into a remote node's authorized_keys using password auth.
   * This is a one-time operation — after the key is installed, all future connections
   * use key-based auth. For Tailscale IPs, routes through the manager tunnel.
   */
  async injectPublicKey(opts: {
    host: string;
    port: number;
    username: string;
    password: string;
    publicKey: string;
  }): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      const client = new SSHClient();
      const timeout = 30_000;

      const timer = setTimeout(() => {
        client.end();
        resolve({ success: false, error: 'Connection timed out' });
      }, timeout);

      client.on('ready', () => {
        clearTimeout(timer);
        // Install the public key
        const cmd = `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo "${opts.publicKey}" >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && echo "KEY_INSTALLED"`;

        client.exec(cmd, (err, stream) => {
          if (err) {
            client.end();
            resolve({ success: false, error: err.message });
            return;
          }

          let output = '';
          stream.on('data', (data: Buffer) => { output += data.toString(); });
          stream.stderr.on('data', (data: Buffer) => { output += data.toString(); });
          stream.on('close', () => {
            client.end();
            if (output.includes('KEY_INSTALLED')) {
              resolve({ success: true });
            } else {
              resolve({ success: false, error: output || 'Key installation failed' });
            }
          });
        });
      });

      client.on('error', (err) => {
        clearTimeout(timer);
        resolve({ success: false, error: err.message });
      });

      // Handle keyboard-interactive auth (modern OpenSSH servers)
      client.on('keyboard-interactive', (_name, _instructions, _lang, _prompts, finish) => {
        finish([opts.password]);
      });

      // For Tailscale IPs, create a tunnel through manager first
      if (this.isTailscaleIP(opts.host) && this.managerConfig && !this.isTailscaleIP(this.managerConfig.host)) {
        // Get manager connection, then exec `tailscale nc` to create tunnel
        this.connect(this.managerConfig).then((managerClient) => {
          managerClient.exec(`tailscale nc ${opts.host} ${opts.port}`, (err, stream) => {
            if (err) {
              resolve({ success: false, error: `Tunnel failed: ${err.message}` });
              return;
            }
            client.connect({
              sock: stream as unknown as Duplex,
              username: opts.username,
              password: opts.password,
              tryKeyboard: true,
              readyTimeout: timeout,
              algorithms: {
                serverHostKey: ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'ssh-rsa'],
              },
            });
          });
        }).catch((err) => {
          resolve({ success: false, error: `Manager connection failed: ${err.message}` });
        });
      } else {
        // Direct password connection
        client.connect({
          host: opts.host,
          port: opts.port,
          username: opts.username,
          password: opts.password,
          tryKeyboard: true,
          readyTimeout: timeout,
          algorithms: {
            serverHostKey: ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'ssh-rsa'],
          },
        });
      }
    });
  }

  /**
   * Forward a connection to the remote Docker socket via SSH tunnel.
   * Detects the correct Docker socket path based on OS.
   */
  async forwardToDockerSocket(config: SSHConnectionConfig): Promise<Duplex> {
    const client = await this.connect(config);

    return new Promise((resolve, reject) => {
      // Try common Docker socket paths:
      // Linux/macOS: /var/run/docker.sock (Unix socket)
      // Windows:     //./pipe/docker_engine (Named pipe — not directly accessible via SSH)
      //
      // For Windows nodes, Docker must be configured to listen on a TCP port
      // or use docker context over SSH directly.
      const socketPath = '/var/run/docker.sock';

      client.openssh_forwardOutStreamLocal(socketPath, (err, stream) => {
        if (err) {
          // Fallback: try TCP connection (for Windows or custom Docker configs)
          client.forwardOut('127.0.0.1', 0, '127.0.0.1', 2375, (tcpErr, tcpStream) => {
            if (tcpErr) {
              reject(new Error(
                `Cannot reach Docker on ${config.host}. ` +
                `Tried Unix socket (${socketPath}) and TCP (:2375). ` +
                `Ensure Docker is running and accessible.`
              ));
              return;
            }
            resolve(tcpStream);
          });
          return;
        }
        resolve(stream);
      });
    });
  }

  /**
   * Execute a command on a remote node via SSH.
   * Used for Docker install checks, system info collection, etc.
   */
  async exec(config: SSHConnectionConfig, command: string): Promise<{ stdout: string; stderr: string; code: number }> {
    const client = await this.connect(config);

    return new Promise((resolve, reject) => {
      client.exec(command, (err, stream) => {
        if (err) return reject(err);

        let stdout = '';
        let stderr = '';

        stream.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        stream.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        stream.on('close', (code: number) => {
          resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: code ?? 0 });
        });
      });
    });
  }

  /**
   * Execute a command over SSH with streaming output callback.
   * The onOutput callback is called with each chunk of stdout/stderr as it arrives.
   * Supports AbortSignal for cancellation — when aborted, sends SIGKILL to the remote process.
   */
  async execStream(
    config: SSHConnectionConfig,
    command: string,
    onOutput: (line: string) => void,
    opts?: { idleTimeoutMs?: number; signal?: AbortSignal }
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    const client = await this.connect(config);
    const idleTimeout = opts?.idleTimeoutMs || 10 * 60 * 1000; // 10 min default

    return new Promise((resolve, reject) => {
      // Check if already aborted before starting
      if (opts?.signal?.aborted) {
        resolve({ stdout: '', stderr: 'Cancelled before start', code: 130 });
        return;
      }

      client.exec(command, (err, stream) => {
        if (err) return reject(err);

        let stdout = '';
        let stderr = '';
        let resolved = false;
        let idleTimer: ReturnType<typeof setTimeout> | null = null;

        const finish = (code: number) => {
          if (resolved) return;
          resolved = true;
          if (idleTimer) clearTimeout(idleTimer);
          resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code });
        };

        // Wire up AbortSignal to kill the SSH stream
        if (opts?.signal) {
          const onAbort = () => {
            onOutput('[cancel] ⚠ Deployment cancelled — killing build process');
            // signal('KILL') sends SIGKILL to the remote process
            stream.signal?.('KILL');
            stream.close();
            finish(137); // 137 = SIGKILL
          };
          if (opts.signal.aborted) {
            onAbort();
            return;
          }
          opts.signal.addEventListener('abort', onAbort, { once: true });
        }

        const resetIdleTimer = () => {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            onOutput('[build] ⚠ Build timed out (no output for 10 minutes)');
            stream.close();
            finish(124); // 124 = timeout
          }, idleTimeout);
        };

        resetIdleTimer();

        stream.on('data', (data: Buffer) => {
          const chunk = data.toString();
          stdout += chunk;
          resetIdleTimer();
          chunk.split(/[\r\n]+/).filter(Boolean).forEach(line => onOutput(line));
        });

        stream.stderr.on('data', (data: Buffer) => {
          const chunk = data.toString();
          stderr += chunk;
          resetIdleTimer();
          chunk.split(/[\r\n]+/).filter(Boolean).forEach(line => onOutput(line));
        });

        stream.on('close', (code: number) => {
          finish(code ?? 0);
        });

        stream.on('error', (err: Error) => {
          if (idleTimer) clearTimeout(idleTimer);
          if (!resolved) {
            resolved = true;
            reject(err);
          }
        });
      });
    });
  }

  /**
   * Test connectivity to a remote node.
   * Collects OS, Docker version, and system resources.
   */
  async probe(config: SSHConnectionConfig): Promise<{
    connected: boolean;
    os: string;
    arch: string;
    dockerVersion: string | null;
    dockerRunning: boolean;
    cpuCores: number;
    memoryGb: number;
    diskGb: number;
  }> {
    try {
      const client = await this.connect(config);

      // Detect OS
      const osResult = await this.exec(config, 'uname -s 2>/dev/null || echo WINDOWS');
      const archResult = await this.exec(config, 'uname -m 2>/dev/null || echo unknown');
      const os = osResult.stdout.toLowerCase().includes('darwin')
        ? 'macos'
        : osResult.stdout.toLowerCase().includes('linux')
          ? 'linux'
          : osResult.stdout.toLowerCase().includes('windows') || osResult.stdout === 'WINDOWS'
            ? 'windows'
            : 'unknown';

      // Check Docker
      const dockerResult = await this.exec(config, 'docker version --format "{{.Server.Version}}" 2>/dev/null');
      const dockerRunning = dockerResult.code === 0 && dockerResult.stdout.length > 0;

      // Get CPU count
      let cpuCores = 0;
      if (os === 'linux') {
        const cpuResult = await this.exec(config, 'nproc 2>/dev/null');
        cpuCores = parseInt(cpuResult.stdout) || 0;
      } else if (os === 'macos') {
        const cpuResult = await this.exec(config, 'sysctl -n hw.ncpu 2>/dev/null');
        cpuCores = parseInt(cpuResult.stdout) || 0;
      }

      // Get memory
      let memoryGb = 0;
      if (os === 'linux') {
        const memResult = await this.exec(config, "awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null");
        memoryGb = Math.round((parseInt(memResult.stdout) || 0) / 1024 / 1024 * 100) / 100;
      } else if (os === 'macos') {
        const memResult = await this.exec(config, 'sysctl -n hw.memsize 2>/dev/null');
        memoryGb = Math.round((parseInt(memResult.stdout) || 0) / 1024 / 1024 / 1024 * 100) / 100;
      }

      // Get disk
      let diskGb = 0;
      if (os !== 'windows') {
        const diskResult = await this.exec(config, "df -BG / 2>/dev/null | awk 'NR==2 {print $2}'");
        diskGb = parseInt(diskResult.stdout) || 0;
      }

      return {
        connected: true,
        os,
        arch: archResult.stdout || 'unknown',
        dockerVersion: dockerRunning ? dockerResult.stdout : null,
        dockerRunning,
        cpuCores,
        memoryGb,
        diskGb,
      };
    } catch (err) {
      return {
        connected: false,
        os: 'unknown',
        arch: 'unknown',
        dockerVersion: null,
        dockerRunning: false,
        cpuCores: 0,
        memoryGb: 0,
        diskGb: 0,
      };
    }
  }

  /**
   * Schedule a reconnection attempt with exponential backoff.
   */
  private scheduleReconnect(config: SSHConnectionConfig, attempt = 0): void {
    const key = this.getKey(config);
    const maxAttempts = 5;
    const baseDelay = 2000; // 2s

    if (attempt >= maxAttempts) {
      console.error(`⛔ Max reconnection attempts reached for ${config.host}:${config.port}`);
      return;
    }

    const delay = baseDelay * Math.pow(2, attempt);

    // Clear existing timer
    const existing = this.reconnectTimers.get(key);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      try {
        await this.createConnection(config);
        console.log(`🔄 Reconnected to ${config.host}:${config.port}`);
      } catch {
        this.scheduleReconnect(config, attempt + 1);
      }
    }, delay);

    this.reconnectTimers.set(key, timer);
  }

  /**
   * Close a specific connection.
   */
  private cleanup(key: string): void {
    const conn = this.connections.get(key);
    if (conn) {
      conn.client.end();
      conn.isAlive = false;
    }
    this.connections.delete(key);

    const timer = this.reconnectTimers.get(key);
    if (timer) clearTimeout(timer);
    this.reconnectTimers.delete(key);
  }

  /**
   * Disconnect from a specific node.
   */
  disconnect(host: string, port: number): void {
    this.cleanup(`${host}:${port}`);
  }

  /**
   * Close all connections. Call on shutdown.
   */
  disconnectAll(): void {
    for (const key of this.connections.keys()) {
      this.cleanup(key);
    }
  }

  /**
   * Get status of all managed connections.
   */
  getStatus(): Array<{
    host: string;
    port: number;
    isAlive: boolean;
    connectedAt: Date | null;
    lastActivity: Date | null;
  }> {
    return Array.from(this.connections.entries()).map(([key, conn]) => {
      const [host, portStr] = key.split(':');
      return {
        host: host!,
        port: parseInt(portStr!),
        isAlive: conn.isAlive,
        connectedAt: conn.connectedAt,
        lastActivity: conn.lastActivity,
      };
    });
  }
}

// Singleton — all SSH connections go through this
export const sshManager = new SSHConnectionManager();
