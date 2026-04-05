// ============================================================
// Click-Deploy — Custom Server with WebSocket Support
// ============================================================
// Wraps the Next.js standalone server to add WebSocket endpoints:
//   - /ws/terminal   — Interactive terminal into Docker containers
//   - /ws/logs       — Live streaming container logs
//
// Built with the `ws` WebSocket library (zero-dependency, production-grade).
// ============================================================

import http from 'node:http';
import * as net from 'node:net';
import { parse } from 'node:url';
// @ts-expect-error — standalone output has no types
import next from 'next/dist/server/next.js';
import { WebSocketServer, WebSocket } from 'ws';
import { Client as SSHClient } from 'ssh2';

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOSTNAME = process.env.HOSTNAME || '0.0.0.0';

// ── Auth helper: validate session from cookie ────────────────
async function validateSession(req: http.IncomingMessage): Promise<{ userId: string } | null> {
  try {
    const cookieHeader = req.headers.cookie || '';
    // Quick check — just verify a Supabase session cookie exists
    // Full auth is handled by tRPC; WS only needs basic session presence
    if (!cookieHeader.includes('sb-')) {
      return null;
    }
    // For now, allow any authenticated user
    // TODO: Full Supabase token validation
    return { userId: 'ws-user' };
  } catch {
    return null;
  }
}

// ── SSH config resolver: fetches connection details from DB ──
async function resolveSSHConfig(serverId: string, db: any): Promise<{
  host: string; port: number; username: string; privateKey: string;
} | null> {
  try {
    const { nodes, sshKeys } = await import('@click-deploy/database');
    const { eq, and } = await import('drizzle-orm');
    const { decryptPrivateKey } = await import('@click-deploy/api');

    const node = await db.query.nodes.findFirst({
      where: eq(nodes.id, serverId),
      with: { sshKey: true },
    });

    if (!node?.sshKey) return null;

    return {
      host: node.tailscaleIp || node.host,
      port: node.port,
      username: node.sshUser,
      privateKey: decryptPrivateKey(node.sshKey.privateKey),
    };
  } catch (err) {
    console.error('[ws] Failed to resolve SSH config:', err);
    return null;
  }
}

// ── Terminal WebSocket Handler ───────────────────────────────
function setupTerminalWss(server: http.Server) {
  const wss = new WebSocketServer({ noServer: true, path: '/ws/terminal' });

  wss.on('connection', async (ws: WebSocket, req: http.IncomingMessage) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const containerId = url.searchParams.get('containerId');
    const serverId = url.searchParams.get('serverId');
    const shell = url.searchParams.get('shell') || 'sh';

    if (!containerId) {
      ws.close(4000, 'containerId not provided');
      return;
    }

    // Validate container ID format (alphanumeric + dash/underscore/dot)
    if (!/^[a-zA-Z0-9._-]+$/.test(containerId)) {
      ws.close(4000, 'Invalid container ID format');
      return;
    }

    // Validate shell
    if (!['sh', 'bash', 'ash', 'zsh'].includes(shell)) {
      ws.close(4000, 'Invalid shell');
      return;
    }

    try {
      if (serverId) {
        // Remote node — SSH into it, then docker exec
        const { db } = await import('@click-deploy/database');
        const sshConfig = await resolveSSHConfig(serverId, db);
        if (!sshConfig) {
          ws.send('Error: Cannot resolve SSH connection for this node\r\n');
          ws.close();
          return;
        }

        const conn = new SSHClient();
        conn.once('ready', () => {
          const dockerCommand = `docker exec -it -w / ${containerId} ${shell}`;
          conn.exec(dockerCommand, { pty: true }, (err, stream) => {
            if (err) {
              console.error('[ws/terminal] SSH exec error:', err);
              ws.send(`Error: ${err.message}\r\n`);
              ws.close();
              conn.end();
              return;
            }

            stream.on('close', () => {
              ws.send('\r\n[Terminal session closed]\r\n');
              conn.end();
              if (ws.readyState === WebSocket.OPEN) ws.close();
            });

            stream.on('data', (data: Buffer) => {
              if (ws.readyState === WebSocket.OPEN) ws.send(data.toString());
            });

            stream.stderr.on('data', (data: Buffer) => {
              if (ws.readyState === WebSocket.OPEN) ws.send(data.toString());
            });

            ws.on('message', (message) => {
              try {
                const cmd = Buffer.isBuffer(message) ? message.toString('utf8') : message.toString();
                stream.write(cmd);
              } catch (e: any) {
                ws.send(`Error: ${e.message}\r\n`);
              }
            });

            ws.on('close', () => {
              stream.end();
              conn.end();
            });
          });
        });

        conn.on('error', (err) => {
          console.error('[ws/terminal] SSH error:', err);
          ws.send(`SSH Error: ${err.message}\r\n`);
          ws.close();
        });

        conn.connect({
          host: sshConfig.host,
          port: sshConfig.port,
          username: sshConfig.username,
          privateKey: sshConfig.privateKey,
          readyTimeout: 30000,
          algorithms: {
            serverHostKey: ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'ssh-rsa'],
          },
        });
      } else {
        // Local node — direct docker exec (not applicable in production where
        // the platform runs in its own container, but useful for development)
        ws.send('Error: serverId required for terminal access\r\n');
        ws.close();
      }
    } catch (error: any) {
      ws.send(`Error: ${error.message}\r\n`);
      ws.close();
    }
  });

  return wss;
}

// ── Live Logs WebSocket Handler ──────────────────────────────
function setupLogsWss(server: http.Server) {
  const wss = new WebSocketServer({ noServer: true, path: '/ws/logs' });

  wss.on('connection', async (ws: WebSocket, req: http.IncomingMessage) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const serviceId = url.searchParams.get('serviceId');
    const tail = url.searchParams.get('tail') || '100';
    const since = url.searchParams.get('since') || '';
    const search = url.searchParams.get('search') || '';

    if (!serviceId) {
      ws.close(4000, 'serviceId not provided');
      return;
    }

    try {
      const { db, services, nodes: nodesTable } = await import('@click-deploy/database');
      const { eq, and } = await import('drizzle-orm');
      const { decryptPrivateKey } = await import('@click-deploy/api');
      const { sshManager } = await import('@click-deploy/docker');

      // Fetch service details
      const service = await db.query.services.findFirst({
        where: eq(services.id, serviceId),
        with: { project: true },
      });

      if (!service?.swarmServiceId) {
        ws.send('No active deployment — no logs available.\r\n');
        ws.close();
        return;
      }

      // Get manager node
      const managerNode = await db.query.nodes.findFirst({
        where: and(
          eq(nodesTable.organizationId, service.project.organizationId),
          eq(nodesTable.role, 'manager'),
          eq(nodesTable.status, 'online'),
        ),
        with: { sshKey: true },
      });

      if (!managerNode?.sshKey) {
        ws.send('Error: No manager node available\r\n');
        ws.close();
        return;
      }

      const sshConfig = {
        host: managerNode.tailscaleIp || managerNode.host,
        port: managerNode.port,
        username: managerNode.sshUser,
        privateKey: decryptPrivateKey(managerNode.sshKey.privateKey),
      };

      // Build docker logs command
      const safeTail = Math.max(10, Math.min(5000, parseInt(tail) || 100));
      const serviceName = `cd-${service.name}`.replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
      let cmd = `docker service logs --timestamps --follow --tail ${safeTail} ${serviceName}`;
      if (since) cmd += ` --since ${since}`;
      cmd += ' 2>&1';
      if (search) {
        const safeSearch = search.replace(/'/g, "'\\''");
        cmd += ` | grep --line-buffered -iF '${safeSearch}'`;
      }

      // Connect & stream
      const client = await sshManager.connect(sshConfig);
      client.exec(cmd, { pty: true }, (err, stream) => {
        if (err) {
          ws.send(`Error: ${err.message}\r\n`);
          ws.close();
          return;
        }

        stream.on('data', (data: Buffer) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(data.toString());
        });

        stream.stderr.on('data', (data: Buffer) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(data.toString());
        });

        stream.on('close', () => {
          if (ws.readyState === WebSocket.OPEN) ws.close();
        });

        ws.on('close', () => {
          stream.close();
        });
      });

      // Keep-alive ping
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.ping();
      }, 30000);

      ws.on('close', () => {
        clearInterval(pingInterval);
      });
    } catch (error: any) {
      ws.send(`Error: ${error.message}\r\n`);
      ws.close();
    }
  });

  return wss;
}

// ── Main: Start Next.js + WebSocket server ───────────────────
async function main() {
  console.log('⚡ Click-Deploy starting with WebSocket support...');

  const app = next({ dev: false, hostname: HOSTNAME, port: PORT });
  const handle = app.getRequestHandler();

  await app.prepare();

  const server = http.createServer((req, res) => {
    handle(req, res);
  });

  // Set up WebSocket servers
  const terminalWss = setupTerminalWss(server);
  const logsWss = setupLogsWss(server);

  // Handle WebSocket upgrades
  server.on('upgrade', (req: http.IncomingMessage, socket: net.Socket, head: Buffer) => {
    const { pathname } = parse(req.url || '', true);

    if (pathname === '/ws/terminal') {
      terminalWss.handleUpgrade(req, socket, head, (ws) => {
        terminalWss.emit('connection', ws, req);
      });
    } else if (pathname === '/ws/logs') {
      logsWss.handleUpgrade(req, socket, head, (ws) => {
        logsWss.emit('connection', ws, req);
      });
    } else {
      // Let Next.js handle HMR and other upgrades
      // Don't destroy the socket — Next.js may need it
    }
  });

  server.listen(PORT, HOSTNAME, () => {
    console.log(`✅ Click-Deploy ready at http://${HOSTNAME}:${PORT}`);
    console.log(`   WebSocket endpoints:`);
    console.log(`   → /ws/terminal  (container terminal)`);
    console.log(`   → /ws/logs      (live log streaming)`);
  });
}

main().catch((err) => {
  console.error('Fatal error starting server:', err);
  process.exit(1);
});
