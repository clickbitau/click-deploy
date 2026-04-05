#!/usr/bin/env node
// ============================================================
// Click-Deploy — Production Server with WebSocket Support
// ============================================================
// Uses Next.js getRequestHandler() to handle HTTP, with
// WebSocket upgrade handling for /ws/terminal and /ws/logs.
// Runs from /app (Docker workdir), loads Next.js from
// apps/web/node_modules/next (standalone trace output).
// ============================================================

const path = require('node:path');
const http = require('node:http');
const { URL } = require('node:url');
const crypto = require('node:crypto');

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOSTNAME = process.env.HOSTNAME || '0.0.0.0';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '';

const appDir = path.join(__dirname, 'apps', 'web');

// ── Load Next.js from standalone output ──────────────────────
// Standalone traces Next.js under apps/web/node_modules/next
const nextModule = require(path.join(appDir, 'node_modules', 'next'));
const nextConfig = require(path.join(appDir, '.next', 'required-server-files.json')).config;

// Set the standalone config env var (same as generated server.js)
process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig);
process.env.NODE_ENV = 'production';

const app = nextModule({ dev: false, hostname: HOSTNAME, port: PORT, dir: appDir, conf: nextConfig });
const handle = app.getRequestHandler();

// ── Crypto ───────────────────────────────────────────────────
function decryptPrivateKey(encryptedData) {
  if (!ENCRYPTION_KEY) return encryptedData;
  try {
    const data = JSON.parse(encryptedData);
    const key = crypto.scryptSync(ENCRYPTION_KEY, data.salt, 32);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(data.iv, 'hex'));
    return decipher.update(data.encrypted, 'hex', 'utf8') + decipher.final('utf8');
  } catch { return encryptedData; }
}

// ── DB (lightweight postgres) ────────────────────────────────
let pgPool = null;
function getPool() {
  if (pgPool) return pgPool;
  if (!process.env.DATABASE_URL) return null;
  try {
    const postgres = require('postgres');
    pgPool = postgres(process.env.DATABASE_URL, { max: 2, idle_timeout: 20, prepare: false });
    return pgPool;
  } catch { return null; }
}

async function resolveSSHConfig(serverId) {
  const sql = getPool(); if (!sql) return null;
  try {
    const rows = await sql`
      SELECT n.host, n.port, n.ssh_user, n.tailscale_ip, k.private_key
      FROM nodes n LEFT JOIN ssh_keys k ON n.ssh_key_id = k.id
      WHERE n.id = ${serverId} LIMIT 1`;
    if (!rows.length || !rows[0].private_key) return null;
    const r = rows[0];
    return { host: r.tailscale_ip || r.host, port: r.port, username: r.ssh_user, privateKey: decryptPrivateKey(r.private_key) };
  } catch (e) { console.error('[ws]', e.message); return null; }
}

async function resolveServiceAndManager(serviceId) {
  const sql = getPool(); if (!sql) return {};
  try {
    const svcRows = await sql`
      SELECT s.name, s.swarm_service_id, p.organization_id
      FROM services s JOIN projects p ON s.project_id = p.id
      WHERE s.id = ${serviceId} LIMIT 1`;
    if (!svcRows.length || !svcRows[0].swarm_service_id) return {};
    const svc = svcRows[0];
    const serviceName = `cd-${svc.name}`.replace(/[^a-z0-9_-]/gi, '-').toLowerCase();

    const mgrRows = await sql`
      SELECT n.host, n.port, n.ssh_user, n.tailscale_ip, k.private_key
      FROM nodes n LEFT JOIN ssh_keys k ON n.ssh_key_id = k.id
      WHERE n.organization_id = ${svc.organization_id} AND n.role = 'manager' AND n.status = 'online' LIMIT 1`;
    if (!mgrRows.length || !mgrRows[0].private_key) return { serviceName };
    const m = mgrRows[0];
    return { serviceName, sshConfig: { host: m.tailscale_ip || m.host, port: m.port, username: m.ssh_user, privateKey: decryptPrivateKey(m.private_key) } };
  } catch (e) { console.error('[ws]', e.message); return {}; }
}

// ── WebSocket setup ──────────────────────────────────────────
function setupWebSockets(server) {
  let WebSocketServer, SSHClient;
  try {
    ({ WebSocketServer } = require('ws'));
    ({ Client: SSHClient } = require('ssh2'));
  } catch (e) {
    console.warn('[ws] modules unavailable:', e.message);
    return;
  }

  const terminalWss = new WebSocketServer({ noServer: true });
  const logsWss = new WebSocketServer({ noServer: true });

  // Terminal
  terminalWss.on('connection', (ws, req) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const cid = url.searchParams.get('containerId');
    const sid = url.searchParams.get('serverId');
    const shell = url.searchParams.get('shell') || 'sh';
    if (!cid || !/^[a-zA-Z0-9._-]+$/.test(cid)) { ws.close(4000, 'bad cid'); return; }
    if (!['sh','bash','ash','zsh'].includes(shell)) { ws.close(4000, 'bad shell'); return; }
    if (!sid) { ws.send('Error: serverId required\r\n'); ws.close(); return; }

    resolveSSHConfig(sid).then(cfg => {
      if (!cfg) { ws.send('Error: no SSH config\r\n'); ws.close(); return; }
      const conn = new SSHClient();
      conn.once('ready', () => {
        conn.exec(`docker exec -it -w / ${cid} ${shell}`, { pty: true }, (err, stream) => {
          if (err) { ws.send(`Error: ${err.message}\r\n`); ws.close(); conn.end(); return; }
          stream.on('data', d => { if (ws.readyState===1) ws.send(d.toString()); });
          stream.stderr.on('data', d => { if (ws.readyState===1) ws.send(d.toString()); });
          stream.on('close', () => { conn.end(); if (ws.readyState===1) ws.close(); });
          ws.on('message', m => { try { stream.write(Buffer.isBuffer(m)?m.toString('utf8'):m.toString()); } catch{} });
          ws.on('close', () => { stream.end(); conn.end(); });
        });
      });
      conn.on('error', e => { ws.send(`SSH Error: ${e.message}\r\n`); if (ws.readyState===1) ws.close(); });
      conn.connect({ host:cfg.host, port:cfg.port, username:cfg.username, privateKey:cfg.privateKey, readyTimeout:30000,
        algorithms:{ serverHostKey:['ssh-ed25519','ecdsa-sha2-nistp256','ssh-rsa'] } });
    }).catch(e => { ws.send(`Error: ${e.message}\r\n`); ws.close(); });
  });

  // Logs
  logsWss.on('connection', (ws, req) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const serviceId = url.searchParams.get('serviceId');
    const tail = url.searchParams.get('tail') || '100';
    if (!serviceId) { ws.close(4000, 'no serviceId'); return; }

    resolveServiceAndManager(serviceId).then(({ serviceName, sshConfig }) => {
      if (!sshConfig || !serviceName) { ws.send('Error: no service/manager\r\n'); ws.close(); return; }
      const safeTail = Math.max(10, Math.min(5000, parseInt(tail)||100));
      const cmd = `docker service logs --timestamps --follow --tail ${safeTail} ${serviceName} 2>&1`;

      const conn = new SSHClient();
      conn.once('ready', () => {
        conn.exec(cmd, { pty: true }, (err, stream) => {
          if (err) { ws.send(`Error: ${err.message}\r\n`); ws.close(); conn.end(); return; }
          stream.on('data', d => { if (ws.readyState===1) ws.send(d.toString()); });
          stream.stderr.on('data', d => { if (ws.readyState===1) ws.send(d.toString()); });
          stream.on('close', () => { if (ws.readyState===1) ws.close(); conn.end(); });
          ws.on('close', () => { stream.close(); conn.end(); });
        });
      });
      conn.on('error', e => { ws.send(`SSH Error: ${e.message}\r\n`); if (ws.readyState===1) ws.close(); });
      conn.connect({ host:sshConfig.host, port:sshConfig.port, username:sshConfig.username, privateKey:sshConfig.privateKey,
        readyTimeout:30000, algorithms:{ serverHostKey:['ssh-ed25519','ecdsa-sha2-nistp256','ssh-rsa'] } });

      const ping = setInterval(() => { if (ws.readyState===1) ws.ping(); else clearInterval(ping); }, 30000);
      ws.on('close', () => clearInterval(ping));
    }).catch(e => { ws.send(`Error: ${e.message}\r\n`); ws.close(); });
  });

  // Route upgrades
  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url || '', `http://${req.headers.host}`);
    if (pathname === '/ws/terminal') terminalWss.handleUpgrade(req, socket, head, ws => terminalWss.emit('connection', ws, req));
    else if (pathname === '/ws/logs') logsWss.handleUpgrade(req, socket, head, ws => logsWss.emit('connection', ws, req));
  });

  console.log('   WebSocket: /ws/terminal, /ws/logs');
}

// ── Start ────────────────────────────────────────────────────
async function main() {
  console.log('⚡ Click-Deploy starting with WebSocket support...');

  await app.prepare();

  const server = http.createServer((req, res) => handle(req, res));
  setupWebSockets(server);

  server.listen(PORT, HOSTNAME, () => {
    console.log(`✅ Click-Deploy ready at http://${HOSTNAME}:${PORT}`);
  });
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
