// ============================================================
// Click-Deploy — Tailscale Integration
// ============================================================
// Manages Tailscale as a host-level VPN service on nodes.
// Unlike Traefik/Registry (Swarm services), Tailscale runs
// directly on the host OS because it manages the network
// interface itself.
//
// Flow:
//   1. Auto-install: `tailscale` binary installed on node connect
//   2. Authenticate: User provides auth key via dashboard UI
//   3. Status: `tailscale status --json` for connection info
// ============================================================
import { sshManager } from './ssh';
import { type NodeConnectionInfo } from './client';

export interface TailscaleStatus {
  installed: boolean;
  running: boolean;
  authenticated: boolean;
  tailnetName?: string;
  ipAddress?: string;
  hostname?: string;
  version?: string;
  os?: string;
}

export class TailscaleManager {
  constructor(private node: NodeConnectionInfo) {}

  private get sshConfig() {
    return {
      host: this.node.host,
      port: this.node.port,
      username: this.node.sshUser,
      privateKey: this.node.privateKey,
    };
  }

  /**
   * Install Tailscale on the host if not already present.
   * Idempotent — safe to call multiple times.
   *
   * Handles DNS-blocked networks where tailscale.com / pkgs.tailscale.com
   * resolve to 0.0.0.0. Falls back to resolving via Google DNS (8.8.8.8)
   * and adding /etc/hosts entries before running the install script.
   */
  async install(): Promise<{ installed: boolean; alreadyPresent: boolean }> {
    // Check if already installed
    const check = await sshManager.exec(this.sshConfig,
      `which tailscale 2>/dev/null && echo "FOUND" || echo "MISSING"`
    );

    if (check.stdout.includes('FOUND')) {
      // Ensure tailscaled is running
      await sshManager.exec(this.sshConfig,
        `systemctl is-active tailscaled >/dev/null 2>&1 || systemctl start tailscaled 2>/dev/null || true`
      );
      return { installed: true, alreadyPresent: true };
    }

    // Check if tailscale.com is reachable (some networks DNS-block it)
    const dnsCheck = await sshManager.exec(this.sshConfig,
      `curl -fsSL --max-time 3 https://tailscale.com/install.sh -o /dev/null 2>&1 && echo "OK" || echo "BLOCKED"`
    );

    if (dnsCheck.stdout.includes('BLOCKED')) {
      // DNS is likely blocking tailscale.com — resolve via Google DNS and add hosts entries
      console.log('[tailscale] DNS block detected, resolving via Google DNS...');
      await sshManager.exec(this.sshConfig, [
        // Resolve real IPs via Google DNS
        `TS_IP=$(dig +short tailscale.com @8.8.8.8 2>/dev/null | head -1)`,
        `PKG_IP=$(dig +short pkgs.tailscale.com @8.8.8.8 2>/dev/null | grep -E '^[0-9]' | head -1)`,
        // Add to /etc/hosts if not already present
        `grep -q 'tailscale.com' /etc/hosts || echo "$TS_IP tailscale.com" >> /etc/hosts`,
        `grep -q 'pkgs.tailscale.com' /etc/hosts || echo "$PKG_IP pkgs.tailscale.com" >> /etc/hosts`,
      ].join(' && '));
    }

    // Install Tailscale via official installer
    const installResult = await sshManager.exec(this.sshConfig,
      `curl -fsSL https://tailscale.com/install.sh | sh 2>&1`
    );

    if (installResult.code !== 0) {
      throw new Error(`Failed to install Tailscale: ${installResult.stderr || installResult.stdout}`);
    }

    // Enable and start tailscaled
    await sshManager.exec(this.sshConfig,
      `systemctl enable --now tailscaled 2>/dev/null || true`
    );

    return { installed: true, alreadyPresent: false };
  }

  /**
   * Authenticate Tailscale with an auth key.
   * Enables subnet routing for the Docker overlay network by default.
   * Handles Proxmox LXC / VPS environments where /dev/net/tun is unavailable
   * by configuring userspace networking mode.
   */
  async authenticate(authKey: string): Promise<{ success: boolean; ipAddress?: string }> {
    // Ensure installed first
    await this.install();

    // Check if TUN device is available (missing in Proxmox LXC / some VPS)
    const tunCheck = await sshManager.exec(this.sshConfig,
      `test -e /dev/net/tun && echo "TUN_OK" || echo "TUN_MISSING"`
    );

    if (tunCheck.stdout.includes('TUN_MISSING')) {
      // Configure userspace networking (no TUN needed)
      console.log('[tailscale] /dev/net/tun unavailable, configuring userspace networking...');
      await sshManager.exec(this.sshConfig, [
        `mkdir -p /etc/systemd/system/tailscaled.service.d`,
        `cat > /etc/systemd/system/tailscaled.service.d/override.conf << 'EOFCONF'
[Service]
ExecStart=
ExecStart=/usr/sbin/tailscaled --state=/var/lib/tailscale/tailscaled.state --socket=/run/tailscale/tailscaled.sock --tun=userspace-networking
EOFCONF`,
        `systemctl daemon-reload`,
      ].join(' && '));
    }

    // Ensure tailscaled is running and wait for it to be ready
    await sshManager.exec(this.sshConfig,
      `systemctl reset-failed tailscaled 2>/dev/null; systemctl enable --now tailscaled 2>/dev/null; sleep 2`
    );

    // Bring Tailscale up with the auth key
    // --accept-routes: Accept routes from other Tailscale nodes
    // Note: --advertise-routes requires TUN, skip in userspace mode
    const advertiseRoutes = tunCheck.stdout.includes('TUN_OK')
      ? '--advertise-routes=10.0.0.0/8,172.16.0.0/12'
      : '';
    const upResult = await sshManager.exec(this.sshConfig,
      `tailscale up --authkey="${authKey}" ${advertiseRoutes} --accept-routes 2>&1`
    );

    if (upResult.code !== 0) {
      throw new Error(`Tailscale authentication failed: ${upResult.stderr || upResult.stdout}`);
    }

    // Get the assigned IP
    const ipResult = await sshManager.exec(this.sshConfig,
      `tailscale ip -4 2>/dev/null`
    );

    return {
      success: true,
      ipAddress: ipResult.stdout.trim() || undefined,
    };
  }

  /**
   * Get comprehensive Tailscale status.
   */
  async getStatus(): Promise<TailscaleStatus> {
    // Check if installed
    const whichResult = await sshManager.exec(this.sshConfig,
      `which tailscale 2>/dev/null && echo "FOUND" || echo "MISSING"`
    );

    if (whichResult.stdout.includes('MISSING')) {
      return { installed: false, running: false, authenticated: false };
    }

    // Check if tailscaled is running
    const daemonResult = await sshManager.exec(this.sshConfig,
      `systemctl is-active tailscaled 2>/dev/null || echo "inactive"`
    );
    const running = daemonResult.stdout.trim() === 'active';

    if (!running) {
      return { installed: true, running: false, authenticated: false };
    }

    // Get status JSON
    const statusResult = await sshManager.exec(this.sshConfig,
      `tailscale status --json 2>/dev/null`
    );

    if (statusResult.code !== 0) {
      return { installed: true, running: true, authenticated: false };
    }

    try {
      const status = JSON.parse(statusResult.stdout);
      const self = status.Self || {};

      // Get version
      const versionResult = await sshManager.exec(this.sshConfig,
        `tailscale version 2>/dev/null | head -1`
      );

      return {
        installed: true,
        running: true,
        authenticated: !!self.Online || !!self.TailscaleIPs?.length,
        tailnetName: status.MagicDNSSuffix?.replace(/\.ts\.net$/, '') || status.CurrentTailnet?.Name || undefined,
        ipAddress: self.TailscaleIPs?.[0] || undefined,
        hostname: self.HostName || undefined,
        version: versionResult.stdout.trim() || undefined,
        os: self.OS || undefined,
      };
    } catch {
      return { installed: true, running: true, authenticated: false };
    }
  }

  /**
   * Check if Tailscale is installed and running.
   */
  async isRunning(): Promise<boolean> {
    const result = await sshManager.exec(this.sshConfig,
      `systemctl is-active tailscaled 2>/dev/null`
    );
    return result.stdout.trim() === 'active';
  }

  /**
   * Disconnect Tailscale (but don't uninstall).
   */
  async disconnect(): Promise<void> {
    await sshManager.exec(this.sshConfig, `tailscale down 2>/dev/null || true`);
  }

  /**
   * Fully remove Tailscale from the node.
   */
  async remove(): Promise<void> {
    await sshManager.exec(this.sshConfig, `tailscale down 2>/dev/null || true`);
    await sshManager.exec(this.sshConfig,
      `systemctl stop tailscaled 2>/dev/null; systemctl disable tailscaled 2>/dev/null; apt-get remove -y tailscale 2>/dev/null || yum remove -y tailscale 2>/dev/null || true`
    );
  }
}
