#!/usr/bin/env node
// ============================================================
// Click-Deploy — Production Server with WebSocket Support
// ============================================================
// Wraps the Next.js standalone server and adds WebSocket endpoints.
// Uses direct postgres queries for DB access (standalone output
// doesn't have workspace packages compiled).
// ============================================================

const http = require('node:http');
const { URL } = require('node:url');
const { WebSocketServer } = require('ws');
const { Client: SSHClient } = require('ssh2');
const path = require('node:path');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOSTNAME = process.env.HOSTNAME || '0.0.0.0';
const DATABASE_URL = process.env.DATABASE_URL;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '';

// ── Load the Next.js standalone handler ──────────────────────
const NextServer = require('next/dist/server/next-server').default;
const conf = require('./apps/web/.next/required-server-files.json');

const nextApp = new NextServer({
  hostname: HOSTNAME,
  port: PORT,
  dir: path.join(__dirname, 'apps/web'),
  dev: false,
  customServer: true,
  conf: conf.config,
});
const handle = nextApp.getRequestHandler();

// ── Crypto: same as packages/api/src/crypto.ts ───────────────
function decryptPrivateKey(encryptedData) {
  if (!ENCRYPTION_KEY) return encryptedData; // fallback: assume unencrypted
  try {
    const data = JSON.parse(encryptedData);
    const key = crypto.scryptSync(ENCRYPTION_KEY, data.salt, 32);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(data.iv, 'hex'));
    let decrypted = decipher.update(data.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return encryptedData; // if decryption fails, return raw
  }
}

// ── Lightweight DB queries (direct postgres, no ORM) ─────────
let pgPool = null;
function getPool() {
  if (pgPool) return pgPool;
  if (!DATABASE_URL) return null;
  // Use the built-in pg that ships with postgres-js in node_modules
  // Or fall back to a simple fetch-based approach
  try {
    const postgres = require('postgres');
    pgPool = postgres(DATABASE_URL, { max: 2, idle_timeout: 20, prepare: false });
    return pgPool;
  } catch (e) {
    console.warn('[ws] postgres module not available:', e.message);
    return null;
  }
}

async function resolveSSHConfig(serverId) {
  const sql = getPool();
  if (!sql) return null;
  try {
    const rows = await sql`
      SELECT n.host, n.port, n.ssh_user, n.tailscale_ip, k.private_key
      FROM nodes n
      LEFT JOIN ssh_keys k ON n.ssh_key_id = k.id
      WHERE n.id = ${serverId}
      LIMIT 1
    `;
    if (!rows.length || !rows[0].private_key) return null;
    const r = rows[0];
    return {
      host: r.tailscale_ip || r.host,
      port: r.port,
      username: r.ssh_user,
      privateKey: decryptPrivateKey(r.private_key),
    };
  } catch (err) {
    console.error('[ws] resolveSSHConfig error:', err.message);
    return null;
  }
}

async function resolveServiceAndManager(serviceId) {
  const sql = getPool();
  if (!sql) return {};
  try {
    // Get service + project org
    const svcRows = await sql`
      SELECT s.name, s.swarm_service_id, p.organization_id
      FROM services s
      JOIN projects p ON s.project_id = p.id
      WHERE s.id = ${serviceId}
      LIMIT 1
    `;
    if (!svcRows.length || !svcRows[0].swarm_service_id) return {};
    const svc = svcRows[0];
    const serviceName = `cd-${svc.name}`.replace(/[^a-z0-9_-]/gi, '-').toLowerCase();

    // Get manager node
    const mgrRows = await sql`
      SELECT n.host, n.port, n.ssh_user, n.tailscale_ip, k.private_key
      FROM nodes n
      LEFT JOIN ssh_keys k ON n.ssh_key_id = k.id
      WHERE n.organization_id = ${svc.organization_id}
        AND n.role = 'manager'
        AND n.status = 'online'
      LIMIT 1
    `;
    if (!mgrRows.length || !mgrRows[0].private_key) return { serviceName };
    const m = mgrRows[0];

    return {
      serviceName,
      sshConfig: {
        host: m.tailscale_ip || m.host,
        port: m.port,
        username: m.ssh_user,
        privateKey: decryptPrivateKey(m.private_key),
      },
    };
  } catch (err) {
    console.error('[ws] resolveServiceAndManager error:', err.message);
    return {};
  }
}

// ── WebSocket: Container Terminal ────────────────────────────
function setupTerminalWss() {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const containerId = url.searchParams.get('containerId');
    const serverId = url.searchParams.get('serverId');
    const shell = url.searchParams.get('shell') || 'sh';

    if (!containerId || !/^[a-zA-Z0-9._-]+$/.test(containerId)) {
      ws.close(4000, 'Invalid containerId');
      return;
    }
    if (!['sh', 'bash', 'ash', 'zsh'].includes(shell)) {
      ws.close(4000, 'Invalid shell');
      return;
    }
    if (!serverId) {
      ws.send('Error: serverId required\r\n');
      ws.close();
      return;
    }

    resolveSSHConfig(serverId).then((sshConfig) => {
      if (!sshConfig) {
        ws.send('Error: Cannot resolve SSH config\r\n');
        ws.close();
        return;
      }

      const conn = new SSHClient();
      conn.once('ready', () => {
        conn.exec(`docker exec -it -w / ${containerId} ${shell}`, { pty: true }, (err, stream) => {
          if (err) {
            ws.send(`Error: ${err.message}\r\n`);
            ws.close();
            conn.end();
            return;
          }

          stream.on('close', () => {
            ws.send('\r\n[Session closed]\r\n');
            conn.end();
            if (ws.readyState === 1) ws.close();
          });

          stream.on('data', (data) => {
            if (ws.readyState === 1) ws.send(data.toString());
          });

          stream.stderr.on('data', (data) => {
            if (ws.readyState === 1) ws.send(data.toString());
          });

          ws.on('message', (msg) => {
            try {
              stream.write(Buffer.isBuffer(msg) ? msg.toString('utf8') : msg.toString());
            } catch (e) {
              ws.send(`Error: ${e.message}\r\n`);
            }
          });

          ws.on('close', () => { stream.end(); conn.end(); });
        });
      });

      conn.on('error', (err) => {
        ws.send(`SSH Error: ${err.message}\r\n`);
        if (ws.readyState === 1) ws.close();
      });

      conn.connect({
        host: sshConfig.host,
        port: sshConfig.port,
        username: sshConfig.username,
        privateKey: sshConfig.privateKey,
        readyTimeout: 30000,
        algorithms: { serverHostKey: ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'ssh-rsa'] },
      });
    }).catch((err) => {
      ws.send(`Error: ${err.message}\r\n`);
      ws.close();
    });
  });

  return wss;
}

// ── WebSocket: Live Container Logs ───────────────────────────
function setupLogsWss() {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const serviceId = url.searchParams.get('serviceId');
    const tail = url.searchParams.get('tail') || '100';

    if (!serviceId) {
      ws.close(4000, 'serviceId required');
      return;
    }

    resolveServiceAndManager(serviceId).then(({ serviceName, sshConfig }) => {
      if (!sshConfig || !serviceName) {
        ws.send('Error: Cannot resolve service or manager\r\n');
        ws.close();
        return;
      }

      const safeTail = Math.max(10, Math.min(5000, parseInt(tail) || 100));
      const cmd = `docker service logs --timestamps --follow --tail ${safeTail} ${serviceName} 2>&1`;

      const conn = new SSHClient();
      conn.once('ready', () => {
        conn.exec(cmd, { pty: true }, (err, stream) => {
          if (err) {
            ws.send(`Error: ${err.message}\r\n`);
            ws.close();
            conn.end();
            return;
          }

          stream.on('data', (data) => {
            if (ws.readyState === 1) ws.send(data.toString());
          });

          stream.stderr.on('data', (data) => {
            if (ws.readyState === 1) ws.send(data.toString());
          });

          stream.on('close', () => {
            if (ws.readyState === 1) ws.close();
            conn.end();
          });

          ws.on('close', () => { stream.close(); conn.end(); });
        });
      });

      conn.on('error', (err) => {
        ws.send(`SSH Error: ${err.message}\r\n`);
        if (ws.readyState === 1) ws.close();
      });

      conn.connect({
        host: sshConfig.host,
        port: sshConfig.port,
        username: sshConfig.username,
        privateKey: sshConfig.privateKey,
        readyTimeout: 30000,
        algorithms: { serverHostKey: ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'ssh-rsa'] },
      });

      // Keep-alive ping
      const ping = setInterval(() => {
        if (ws.readyState === 1) ws.ping();
        else clearInterval(ping);
      }, 30000);
      ws.on('close', () => clearInterval(ping));
    }).catch((err) => {
      ws.send(`Error: ${err.message}\r\n`);
      ws.close();
    });
  });

  return wss;
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
  console.log('⚡ Click-Deploy starting with WebSocket support...');

  await nextApp.prepare();

  const server = http.createServer((req, res) => {
    handle(req, res);
  });

  const terminalWss = setupTerminalWss();
  const logsWss = setupLogsWss();

  // Route WebSocket upgrades
  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url || '', `http://${req.headers.host}`);

    if (pathname === '/ws/terminal') {
      terminalWss.handleUpgrade(req, socket, head, (ws) => terminalWss.emit('connection', ws, req));
    } else if (pathname === '/ws/logs') {
      logsWss.handleUpgrade(req, socket, head, (ws) => logsWss.emit('connection', ws, req));
    }
    // else: let Next.js handle (HMR, etc.)
  });

  server.listen(PORT, HOSTNAME, () => {
    console.log(`✅ Click-Deploy ready at http://${HOSTNAME}:${PORT}`);
    console.log(`   WebSocket: /ws/terminal, /ws/logs`);
  });
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
