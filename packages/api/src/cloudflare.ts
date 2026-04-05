// ============================================================
// Click-Deploy — Cloudflare API Helper
// ============================================================
// Centralises all Cloudflare API calls:
//   - Tunnel ingress configuration (public hostnames)
//   - DNS record management (CNAME for tunnel)
//   - Zone SSL mode settings
// ============================================================

const CF_BASE = 'https://api.cloudflare.com/client/v4';

function cfHeaders(apiToken: string) {
  return {
    'Authorization': `Bearer ${apiToken}`,
    'Content-Type': 'application/json',
  };
}

async function cfFetch<T = unknown>(
  apiToken: string,
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${CF_BASE}${path}`, {
    ...options,
    headers: { ...cfHeaders(apiToken), ...(options.headers || {}) },
  });
  const json: any = await res.json();
  if (!res.ok || !json.success) {
    const msg = json.errors?.[0]?.message || json.message || res.statusText;
    throw new Error(`Cloudflare API error: ${msg}`);
  }
  return json.result as T;
}

// ── Tunnel Ingress Configuration ──────────────────────────────

export interface TunnelIngressRule {
  hostname: string;
  service: string; // e.g. "http://localhost:80"
  originRequest?: {
    noTLSVerify?: boolean;
    httpHostHeader?: string;
  };
}

/**
 * GET the full tunnel configuration from Cloudflare.
 * Returns the current list of ingress rules.
 */
export async function getTunnelConfig(
  apiToken: string,
  accountId: string,
  tunnelId: string,
): Promise<TunnelIngressRule[]> {
  const result = await cfFetch<{ config: { ingress: TunnelIngressRule[] } }>(
    apiToken,
    `/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`,
  );
  return result.config?.ingress ?? [];
}

/**
 * PUT a complete tunnel configuration, replacing all existing ingress rules.
 * Always appends the mandatory catch-all rule at the end.
 */
export async function setTunnelConfig(
  apiToken: string,
  accountId: string,
  tunnelId: string,
  rules: TunnelIngressRule[],
): Promise<void> {
  // The last rule must always be a catch-all (no hostname)
  const catchAll = rules.find((r) => !r.hostname) ?? { service: 'http_status:404' };
  const withoutCatchAll = rules.filter((r) => r.hostname);

  await cfFetch(
    apiToken,
    `/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`,
    {
      method: 'PUT',
      body: JSON.stringify({
        config: {
          ingress: [
            ...withoutCatchAll,
            catchAll,
          ],
        },
      }),
    },
  );
}

/**
 * Add a public hostname to an existing tunnel.
 * If the hostname already exists, it updates the service target.
 * The Cloudflare daemon picks up the change without restart.
 */
export async function addTunnelHostname(
  apiToken: string,
  accountId: string,
  tunnelId: string,
  hostname: string,
  service = 'http://localhost:80',
): Promise<void> {
  // Fetch current config, upsert rule, put it back
  const currentRules = await getTunnelConfig(apiToken, accountId, tunnelId);
  const existing = currentRules.filter((r) => r.hostname !== hostname);
  const newRule: TunnelIngressRule = { hostname, service };
  await setTunnelConfig(apiToken, accountId, tunnelId, [...existing, newRule]);
}

/**
 * Remove a public hostname from a tunnel.
 */
export async function removeTunnelHostname(
  apiToken: string,
  accountId: string,
  tunnelId: string,
  hostname: string,
): Promise<void> {
  const currentRules = await getTunnelConfig(apiToken, accountId, tunnelId);
  const filtered = currentRules.filter((r) => r.hostname !== hostname);
  await setTunnelConfig(apiToken, accountId, tunnelId, filtered);
}

// ── DNS Record Management ────────────────────────────────────

export interface DnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
}

/**
 * List DNS records for a zone, optionally filtered by name.
 */
export async function listDnsRecords(
  apiToken: string,
  zoneId: string,
  name?: string,
): Promise<DnsRecord[]> {
  const params = name ? `?name=${encodeURIComponent(name)}&type=CNAME` : '';
  return cfFetch<DnsRecord[]>(apiToken, `/zones/${zoneId}/dns_records${params}`);
}

/**
 * Look up a zone ID from a hostname using the Zones API.
 * Walks up the DNS hierarchy to find the zone.
 * e.g. "app.example.com" → find zone for "example.com"
 */
export async function lookupZoneId(
  apiToken: string,
  hostname: string,
): Promise<string | null> {
  // Try stripping subdomains progressively
  const parts = hostname.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join('.');
    const result = await cfFetch<{ id: string; name: string }[]>(
      apiToken,
      `/zones?name=${encodeURIComponent(candidate)}&status=active`,
    ).catch(() => ([] as { id: string; name: string }[]));
    if (Array.isArray(result) && result.length > 0) {
      return result[0]!.id;
    }
  }
  return null;
}

/**
 * Create or update a CNAME record pointing hostname → tunnelId.cfargotunnel.com.
 * Uses "proxied: true" so Cloudflare handles SSL at the edge.
 */
export async function upsertTunnelCname(
  apiToken: string,
  zoneId: string,
  hostname: string,
  tunnelId: string,
): Promise<DnsRecord> {
  const target = `${tunnelId}.cfargotunnel.com`;

  // Check for existing record
  const existing = await listDnsRecords(apiToken, zoneId, hostname);
  const existingRecord = existing.find((r) => r.type === 'CNAME' && r.name === hostname);

  if (existingRecord) {
    // Update if different
    if (existingRecord.content === target && existingRecord.proxied) {
      return existingRecord;
    }
    return cfFetch<DnsRecord>(
      apiToken,
      `/zones/${zoneId}/dns_records/${existingRecord.id}`,
      {
        method: 'PUT',
        body: JSON.stringify({ type: 'CNAME', name: hostname, content: target, proxied: true, ttl: 1 }),
      },
    );
  }

  // Create new
  return cfFetch<DnsRecord>(
    apiToken,
    `/zones/${zoneId}/dns_records`,
    {
      method: 'POST',
      body: JSON.stringify({ type: 'CNAME', name: hostname, content: target, proxied: true, ttl: 1 }),
    },
  );
}

/**
 * Delete a DNS record by hostname (first matching CNAME).
 */
export async function deleteTunnelCname(
  apiToken: string,
  zoneId: string,
  hostname: string,
): Promise<void> {
  const existing = await listDnsRecords(apiToken, zoneId, hostname);
  const record = existing.find((r) => r.type === 'CNAME' && r.name === hostname);
  if (!record) return;
  await cfFetch(apiToken, `/zones/${zoneId}/dns_records/${record.id}`, { method: 'DELETE' });
}

// ── SSL / Zone Settings ──────────────────────────────────────

export type SslMode = 'off' | 'flexible' | 'full' | 'strict';

/**
 * Set the SSL/TLS mode for a zone.
 * "full" allows self-signed origin certs, "strict" requires valid certs.
 * For Cloudflare Tunnel → Traefik, "full" works out of the box.
 */
export async function setZoneSslMode(
  apiToken: string,
  zoneId: string,
  mode: SslMode = 'full',
): Promise<void> {
  await cfFetch(apiToken, `/zones/${zoneId}/settings/ssl`, {
    method: 'PATCH',
    body: JSON.stringify({ value: mode }),
  });
}

/**
 * Enable "Always Use HTTPS" redirect for a zone.
 */
export async function enableAlwaysHttps(
  apiToken: string,
  zoneId: string,
): Promise<void> {
  await cfFetch(apiToken, `/zones/${zoneId}/settings/always_use_https`, {
    method: 'PATCH',
    body: JSON.stringify({ value: 'on' }),
  });
}

// ── High-Level Composite Operations ─────────────────────────

/**
 * Full "provision domain via Cloudflare Tunnel" flow:
 * 1. Add hostname to tunnel config (so cloudflared routes it)
 * 2. Lookup zone ID from hostname
 * 3. Create/update CNAME DNS record
 * 4. Set zone SSL mode to "full"
 * 
 * Returns the CF tunnel target CNAME for display in the UI.
 */
export async function provisionDomainViaTunnel(opts: {
  apiToken: string;
  accountId: string;
  tunnelId: string;
  hostname: string;
  originService?: string; // default: http://localhost:80
}): Promise<{
  cname: string;
  zoneId: string | null;
  dnsCreated: boolean;
}> {
  const { apiToken, accountId, tunnelId, hostname, originService = 'http://localhost:80' } = opts;
  const cname = `${tunnelId}.cfargotunnel.com`;

  // Step 1: Add public hostname to tunnel
  await addTunnelHostname(apiToken, accountId, tunnelId, hostname, originService);

  // Step 2 & 3: DNS CNAME (best-effort — may fail if zone isn't in this account)
  let zoneId: string | null = null;
  let dnsCreated = false;
  try {
    zoneId = await lookupZoneId(apiToken, hostname);
    if (zoneId) {
      await upsertTunnelCname(apiToken, zoneId, hostname, tunnelId);
      await setZoneSslMode(apiToken, zoneId, 'full');
      dnsCreated = true;
    }
  } catch (err) {
    console.warn(`[cloudflare] DNS provisioning skipped for ${hostname}:`, err);
  }

  return { cname, zoneId, dnsCreated };
}

/**
 * Full teardown of a domain from Cloudflare Tunnel:
 * 1. Remove hostname from tunnel config
 * 2. Remove CNAME DNS record
 */
export async function deprovisionDomainFromTunnel(opts: {
  apiToken: string;
  accountId: string;
  tunnelId: string;
  hostname: string;
}): Promise<void> {
  const { apiToken, accountId, tunnelId, hostname } = opts;

  // Remove from tunnel config
  await removeTunnelHostname(apiToken, accountId, tunnelId, hostname);

  // Remove DNS (best-effort)
  try {
    const zoneId = await lookupZoneId(apiToken, hostname);
    if (zoneId) {
      await deleteTunnelCname(apiToken, zoneId, hostname);
    }
  } catch (err) {
    console.warn(`[cloudflare] DNS cleanup skipped for ${hostname}:`, err);
  }
}
