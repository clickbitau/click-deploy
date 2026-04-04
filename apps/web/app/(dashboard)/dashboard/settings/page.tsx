'use client';

import { useState, useEffect, useRef } from 'react';
import { updateUser, changePassword, changeEmail, authClient } from '@/lib/auth-client';
import {
  Settings2,
  Shield,
  Users,
  Key,
  Save,
  Globe,
  Lock,
  Server,
  Container,
  Zap,
  CheckCircle,
  XCircle,
  Loader2,
  Rocket,
  Github,
  User,
  Network,
  HardDrive,
  Trash2,
  Mail,
  Camera,
  RefreshCw,
  Download,
  GitCommit,
  ArrowUpCircle,
  Copy,
  Clock,
  Plus,
  AlertTriangle,
  Box,
} from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { useConfirm } from '@/components/confirm-dialog';

const tabs = [
  { id: 'infrastructure', label: 'Infrastructure', icon: Server },
  { id: 'storage', label: 'Storage', icon: HardDrive },
  { id: 'integrations', label: 'Integrations', icon: Github },
  { id: 'general', label: 'Organization', icon: Settings2 },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'api-keys', label: 'API Keys', icon: Key },
  { id: 'updates', label: 'Updates', icon: ArrowUpCircle },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('infrastructure');
  const [user, setUser] = useState<{ name?: string; email?: string; image?: string } | null>(null);


  // Fetch from DB (not session cache) to get accurate image
  const { data: profileData } = trpc.system.getProfile.useQuery(undefined, { retry: 1 });

  useEffect(() => {
    if (profileData) {
      setUser({ name: profileData.name, email: profileData.email, image: profileData.image ?? undefined });
    }
  }, [profileData]);

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <p className="text-sm text-white/40 mt-1">Organization settings and platform configuration</p>
        </div>
      </div>

      <div className="flex gap-8">
        {/* Sidebar */}
        <div className="w-48 shrink-0">
          <nav className="space-y-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                    activeTab === tab.id
                      ? 'bg-brand-500/10 text-brand-400 font-medium'
                      : 'text-white/40 hover:text-white/60 hover:bg-white/[0.03]'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 max-w-2xl">
          {activeTab === 'infrastructure' && <InfrastructureTab />}
          {activeTab === 'storage' && <StorageTab />}

          {activeTab === 'general' && (
            <div className="space-y-6">
              <div className="glass-card p-6">
                <h2 className="text-sm font-semibold mb-1">Organization</h2>
                <p className="text-[11px] text-white/30 mb-5">General organization settings and branding</p>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-white/60 mb-1.5">Organization Name</label>
                    <input
                      type="text"
                      defaultValue={`${user?.name || 'My'} Organization`}
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/50 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-white/60 mb-1.5">URL Slug</label>
                    <div className="flex">
                      <span className="flex items-center px-3 bg-white/[0.03] border border-r-0 border-white/10 rounded-l-lg text-xs text-white/30 font-mono">
                        app.clickdeploy.io/
                      </span>
                      <input
                        type="text"
                        defaultValue="clickdeploy"
                        className="flex-1 bg-black/40 border border-white/10 rounded-r-lg px-4 py-2.5 text-sm text-white font-mono placeholder-white/20 focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/50 transition-all"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end">
                <button className="btn-primary flex items-center gap-2">
                  <Save className="w-4 h-4" />
                  Save Changes
                </button>
              </div>
            </div>
          )}



          {activeTab === 'security' && (
            <div className="glass-card p-6">
              <h2 className="text-sm font-semibold mb-1">Security</h2>
              <p className="text-[11px] text-white/30 mb-5">Authentication and access control settings</p>

              <div className="space-y-5">
                <div className="flex items-center justify-between py-3 border-b border-white/[0.05]">
                  <div>
                    <p className="text-sm text-white/80">Two-Factor Authentication</p>
                    <p className="text-[11px] text-white/30 mt-0.5">Require 2FA for all team members</p>
                  </div>
                  <button className="w-10 h-6 rounded-full bg-white/10 relative transition-colors">
                    <span className="absolute left-1 top-1 w-4 h-4 rounded-full bg-white/50 transition-transform" />
                  </button>
                </div>
                <div className="flex items-center justify-between py-3 border-b border-white/[0.05]">
                  <div>
                    <p className="text-sm text-white/80">Session Timeout</p>
                    <p className="text-[11px] text-white/30 mt-0.5">Auto-logout after inactivity</p>
                  </div>
                  <select className="bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white/70">
                    <option>30 days</option>
                    <option>7 days</option>
                    <option>24 hours</option>
                    <option>1 hour</option>
                  </select>
                </div>
                <div className="flex items-center justify-between py-3 hover:bg-white/[0.02] -mx-6 px-6 transition-colors">
                  <div>
                    <p className="text-sm text-white/80">Active Sessions</p>
                    <p className="text-[11px] text-white/30 mt-0.5">Currently signed in: {user?.email || '-'}</p>
                  </div>
                  <button className="text-xs text-danger-400 hover:text-danger-300 font-medium transition-colors">
                    Revoke All
                  </button>
                </div>
                
                <div className="pt-3 border-t border-white/[0.05]">
                  <h3 className="text-sm font-semibold text-white/80 mb-1">Single Sign-On (SSO)</h3>
                  <p className="text-[11px] text-white/30 mb-4">Link external accounts to log in seamlessly</p>
                  <div className="flex items-center justify-between bg-white/[0.02] p-3 rounded-lg border border-white/5">
                    <div className="flex items-center gap-2.5">
                      <Github className="w-4 h-4 text-white" />
                      <span className="text-xs font-medium text-white/80">GitHub Account</span>
                    </div>
                    <button 
                      onClick={() => authClient.linkSocial({ provider: 'github', callbackURL: '/dashboard/settings' })}
                      className="px-3 py-1.5 text-[11px] font-semibold bg-white/5 hover:bg-white/10 rounded transition-colors"
                    >
                      Link Account
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'team' && (
            <TeamTab user={user} />
          )}

          {activeTab === 'api-keys' && <ApiKeysTab />}

          {activeTab === 'integrations' && <IntegrationsTab />}
          {activeTab === 'updates' && <UpdatesTab />}
        </div>
      </div>
    </div>
  );
}

// ── Integrations Tab ────────────────────────────────────────
function IntegrationsTab() {
  const status = trpc.github.status.useQuery();
  const disconnect = trpc.github.disconnect.useMutation();

  const handleCreateManifest = () => {
    // Generate the manifest JSON dynamically
    const manifest = {
      name: `Click-Deploy-${Math.random().toString(36).substring(2, 8)}`,
      url: window.location.origin,
      hook_attributes: {
        url: `${window.location.origin}/api/webhooks/github`
      },
      redirect_url: `${window.location.origin}/dashboard/settings?setup_action=github_manifest`,
      public: false,
      default_permissions: {
        administration: 'read',
        contents: 'read',
        metadata: 'read',
        pull_requests: 'read',
        webhooks: 'write'
      },
      default_events: ['push', 'pull_request']
    };

    // Use query parameter approach (more reliable than POST form)
    const encodedManifest = encodeURIComponent(JSON.stringify(manifest));
    window.location.href = `https://github.com/settings/apps/new?manifest=${encodedManifest}`;
  };

  const handleInstallApp = () => {
    if (status.data?.appName) {
      window.location.href = `https://github.com/apps/${status.data.appName}/installations/new`;
    }
  };

  // Check if we came back from the manifest creation flow
  const createApp = trpc.github.createAppFromManifest.useMutation();
  const saveInstallation = trpc.github.saveInstallation.useMutation();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const setupAction = params.get('setup_action');
    const installationId = params.get('installation_id');

    if (code && setupAction === 'github_manifest' && !createApp.isPending) {
      createApp.mutate({ code }, {
        onSuccess: () => {
          window.history.replaceState({}, '', '/dashboard/settings');
          status.refetch();
        }
      });
    }

    if (installationId && setupAction === 'install' && !saveInstallation.isPending) {
      saveInstallation.mutate({ installationId, setupAction }, {
        onSuccess: () => {
          window.history.replaceState({}, '', '/dashboard/settings');
          status.refetch();
        }
      });
    }
  }, []);

  return (
    <div className="space-y-6">
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center">
              <Github className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">GitHub Integration</h2>
              <p className="text-[11px] text-white/30">Connect repositories and automate continuous deployments</p>
            </div>
          </div>
          {status.data?.connected && (
            <span className="flex items-center gap-1.5 text-xs text-emerald-400">
              <CheckCircle className="w-3.5 h-3.5" /> Connected
            </span>
          )}
        </div>

        {status.isLoading ? (
          <div className="flex items-center gap-2 text-white/30 py-4 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        ) : !status.data?.connected ? (
          <div className="space-y-4">
             <div className="bg-white/[0.02] border border-white/[0.05] rounded-lg p-4 text-xs text-white/60">
              <p className="mb-2">Click-Deploy uses a native GitHub App to seamlessly fetch your private repositories and automatically wire up webhooks.</p>
              <p>Since you are self-hosting, you need to create a private GitHub App on your account. The button below will automatically pre-fill all required scopes via GitHub's manifest flow.</p>
            </div>
            
            <button
              onClick={handleCreateManifest}
              disabled={createApp.isPending}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {createApp.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Github className="w-4 h-4" />}
              {createApp.isPending ? 'Exchanging credentials...' : 'Automated Setup: Create GitHub App'}
            </button>
            {createApp.isError && (
              <p className="text-xs text-red-400 mt-2">✗ {createApp.error.message}</p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-white/[0.02] border border-white/[0.05] rounded-lg p-4">
               <p className="text-xs text-white/50 mb-1">Configured App:</p>
               <p className="text-sm font-medium">{status.data.appName}</p>
            </div>

            {status.data.installations.length === 0 ? (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p className="text-xs text-amber-400 mb-3">
                  App is configured, but not installed on any accounts. Install it on your personal account or organization to give Click-Deploy access to repositories.
                </p>
                <button onClick={handleInstallApp} className="btn-primary flex items-center justify-center gap-2 w-full">
                  <Lock className="w-4 h-4" /> Install App to Account
                </button>
              </div>
            ) : (
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-4">
                <p className="text-xs text-emerald-400 mb-3 font-medium">Installed Accounts:</p>
                <ul className="space-y-2">
                  {status.data.installations.map((inst: any, idx: number) => (
                    <li key={idx} className="flex items-center gap-2 text-sm text-white/80">
                      <CheckCircle className="w-4 h-4 text-emerald-400" /> {inst.account}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="pt-4 border-t border-white/10 flex justify-end">
              <button 
                onClick={() => disconnect.mutate(undefined, { onSuccess: () => status.refetch() })}
                disabled={disconnect.isPending}
                className="px-4 py-2 text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors border border-transparent hover:border-red-500/20"
              >
                Disconnect GitHub App
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── SMTP / Email ──────────────────────────────── */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-xl bg-brand-500/10 flex items-center justify-center">
            <Mail className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">SMTP / Email</h2>
            <p className="text-[11px] text-white/30">Configure email delivery for invitations and notifications</p>
          </div>
        </div>
        <SmtpConfigForm />
      </div>
    </div>
  );
}

// ── Infrastructure Tab ──────────────────────────────────────

function InfrastructureTab() {
  const infraStatus = trpc.infra.status.useQuery();
  const updateCheck = trpc.infra.checkForUpdates.useQuery(undefined, {
    retry: 1,
    refetchInterval: 300_000, // Check every 5 minutes
  });
  const deployTraefik = trpc.infra.deployTraefik.useMutation();
  const deployRegistry = trpc.infra.deployRegistry.useMutation();
  const deployTailscale = trpc.infra.deployTailscale.useMutation();
  const updateComponent = trpc.infra.updateComponent.useMutation();
  const [acmeEmail, setAcmeEmail] = useState('');
  const [tsAuthKey, setTsAuthKey] = useState('');
  const [updatingComponent, setUpdatingComponent] = useState<string | null>(null);
  const confirm = useConfirm();

  // Type guard for update data (vs error)
  const updates = updateCheck.data && !('error' in updateCheck.data) ? updateCheck.data as Record<string, any> : null;

  const handleUpdate = async (component: 'traefik' | 'registry' | 'nixpacks' | 'tailscale', confirmMsg?: string) => {
    if (confirmMsg) {
      const ok = await confirm({ title: `Update ${component.charAt(0).toUpperCase() + component.slice(1)}`, message: confirmMsg, confirmText: 'Update', variant: 'warning' });
      if (!ok) return;
    }
    setUpdatingComponent(component);
    try {
      await updateComponent.mutateAsync({ component });
      await infraStatus.refetch();
    } catch (err) {
      // Error is shown via mutation error state
      console.error(`Update failed:`, err);
    }
    setUpdatingComponent(null);
  };

  const status = infraStatus.data;
  const isLoading = infraStatus.isLoading;
  const tsStatus = (status as any)?.tailscale || { installed: false, running: false, authenticated: false };

  return (
    <div className="space-y-6">
      {/* Overview Card */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500/20 to-accent-500/20 flex items-center justify-center">
            <Server className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Infrastructure Overview</h2>
            <p className="text-[11px] text-white/30">Core services running on your cluster</p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-white/30 py-8 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Checking infrastructure...</span>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatusCard
              label="Manager Nodes"
              value={status?.managerNodes?.length ? status.managerNodes.map((m: any) => m.name).join(', ') : 'Not configured'}
              detail={status?.managerNodes?.length ? `${status.managerNodes.length} nodes active` : undefined}
              active={status?.managerNodes !== undefined && status.managerNodes.length > 0}
            />
            <StatusCard
              label="Reverse Proxy"
              value={status?.traefik?.running ? `Traefik ${(status.traefik as any).version || ''}` : 'Not deployed'}
              detail={status?.traefik?.running ? 'Ports 80, 443' : undefined}
              active={!!status?.traefik?.running}
              updateBadge={updates?.traefik?.updateAvailable ? `→ ${updates.traefik.latestVersion}` : undefined}
            />
            <StatusCard
              label="Docker Registry"
              value={status?.registry?.running ? 'Running' : 'Not deployed'}
              detail={status?.registry?.url}
              active={!!status?.registry?.running}
              updateBadge={updates?.registry?.updateAvailable ? `→ ${updates.registry.latestVersion}` : undefined}
            />
            <StatusCard
              label="Tailscale VPN"
              value={tsStatus.authenticated ? 'Connected' : tsStatus.installed ? 'Installed' : 'Not installed'}
              detail={tsStatus.ipAddress}
              active={tsStatus.authenticated}
            />
            <StatusCard
              label="Nixpacks Builder"
              value={status?.nixpacks ? `v${status.nixpacks}` : 'Not installed'}
              detail="Auto-detects build environments"
              active={status?.nixpacks !== 'unknown' && status?.nixpacks !== 'not installed'}
            />
          </div>
        )}
      </div>

      {/* Traefik Setup */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Globe className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Traefik Reverse Proxy</h3>
              <p className="text-[11px] text-white/30">Routes domains to services with automatic SSL via Let's Encrypt</p>
            </div>
          </div>
          {status?.traefik?.running && (
            <span className="flex items-center gap-1.5 text-xs text-emerald-400">
              <CheckCircle className="w-3.5 h-3.5" />
              Running
            </span>
          )}
        </div>

        {!status?.traefik?.running && (
          <div className="space-y-4">
            <div className="bg-blue-500/5 border border-blue-500/10 rounded-lg p-4">
              <div className="flex gap-3">
                <Zap className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                <div className="text-xs text-white/50 space-y-1">
                  <p><span className="text-white/70 font-medium">What Traefik does:</span></p>
                  <ul className="list-disc list-inside space-y-0.5 text-white/40">
                    <li>Routes <code className="text-brand-400">yourdomain.com</code> → your deployed service</li>
                    <li>Auto-provisions <span className="text-emerald-400">SSL certificates</span> via Let's Encrypt</li>
                    <li>HTTP → HTTPS redirect for all traffic</li>
                    <li>Zero-config — discovers services via Docker labels</li>
                  </ul>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-white/60 mb-1.5">
                SSL Email (for Let's Encrypt notifications)
              </label>
              <input
                type="email"
                value={acmeEmail}
                onChange={(e) => setAcmeEmail(e.target.value)}
                placeholder="admin@yourdomain.com"
                className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/50 transition-all"
              />
            </div>

            <button
              onClick={() => deployTraefik.mutate({ acmeEmail }, {
                onSuccess: () => infraStatus.refetch(),
              })}
              disabled={!acmeEmail || deployTraefik.isPending || !status?.managerNode}
              className="btn-primary flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {deployTraefik.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Rocket className="w-4 h-4" />
              )}
              {deployTraefik.isPending ? 'Deploying...' : 'Deploy Traefik'}
            </button>

            {!status?.managerNode && (
              <p className="text-[11px] text-amber-400/70">
                ⚠ Add a manager node first before deploying Traefik
              </p>
            )}
          </div>
        )}

        {status?.traefik?.running && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white/[0.02] rounded-lg p-3">
                <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Version</p>
                <p className="text-sm text-white/80 font-mono">{(status.traefik as any).version || 'v3.3'}</p>
              </div>
              <div className="bg-white/[0.02] rounded-lg p-3">
                <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Listening</p>
                <p className="text-sm text-white/80 font-mono">:80 :443</p>
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-white/5 pt-4">
              <p className="text-[11px] text-white/30">
                Traefik is running. Add domains to your services and SSL will auto-provision.
              </p>
              <button
                onClick={() => handleUpdate('traefik')}
                disabled={!!updatingComponent}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-colors disabled:opacity-50 ${
                  updates?.traefik?.updateAvailable
                    ? 'bg-brand-500/10 border-brand-500/20 text-brand-400 hover:bg-brand-500/20'
                    : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10'
                }`}
              >
                {updatingComponent === 'traefik' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : updates?.traefik?.updateAvailable ? <ArrowUpCircle className="w-3.5 h-3.5" /> : <RefreshCw className="w-3.5 h-3.5" />}
                {updatingComponent === 'traefik'
                  ? 'Updating...'
                  : updates?.traefik?.updateAvailable
                    ? `Update → ${updates.traefik.latestVersion}`
                    : 'Re-pull Image'}
              </button>
            </div>
          </div>
        )}

        {deployTraefik.isSuccess && (
          <div className="mt-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 text-xs text-emerald-400">
            ✓ {deployTraefik.data?.message}
          </div>
        )}

        {deployTraefik.isError && (
          <div className="mt-3 bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-400">
            ✗ {deployTraefik.error?.message}
          </div>
        )}
      </div>

      {/* Registry Setup */}
      <RegistryCard
        status={status}
        updates={updates}
        updatingComponent={updatingComponent}
        handleUpdate={handleUpdate}
        infraStatus={infraStatus}
      />

      {/* Tailscale VPN Setup */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Network className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Tailscale VPN</h3>
              <p className="text-[11px] text-white/30">Secure mesh network for cross-region node connectivity</p>
            </div>
          </div>
          {tsStatus.authenticated && (
            <span className="flex items-center gap-1.5 text-xs text-emerald-400">
              <CheckCircle className="w-3.5 h-3.5" />
              Connected
            </span>
          )}
        </div>

        {!tsStatus.authenticated && (
          <div className="space-y-4">
            <div className="bg-blue-500/5 border border-blue-500/10 rounded-lg p-4">
              <div className="flex gap-3">
                <Network className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                <div className="text-xs text-white/50 space-y-1">
                  <p><span className="text-white/70 font-medium">What Tailscale does:</span></p>
                  <ul className="list-disc list-inside space-y-0.5 text-white/40">
                    <li>Creates a <span className="text-blue-400">private mesh network</span> between all your nodes</li>
                    <li>Enables SSH and container access to servers in <span className="text-emerald-400">any country</span></li>
                    <li>Advertises Docker overlay routes — access containers by internal IP</li>
                    <li>Zero config — auto-installed on manager nodes</li>
                  </ul>
                </div>
              </div>
            </div>

            {tsStatus.installed && !tsStatus.authenticated && (
              <div className="bg-amber-500/5 border border-amber-500/10 rounded-lg p-3 text-[11px] text-amber-400/80">
                Tailscale is installed but not authenticated. Provide an auth key to connect this node to your Tailnet.
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-white/60 mb-1.5">
                Tailscale Auth Key
              </label>
              <input
                type="password"
                value={tsAuthKey}
                onChange={(e) => setTsAuthKey(e.target.value)}
                placeholder="tskey-auth-..."
                className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white font-mono placeholder-white/20 focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/50 transition-all"
              />
              <p className="text-[10px] text-white/25 mt-1">
                Generate at <a href="https://login.tailscale.com/admin/settings/keys" target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:text-brand-300">Tailscale Admin → Settings → Keys</a>. Use a reusable key for multiple nodes.
              </p>
            </div>

            <button
              onClick={() => deployTailscale.mutate({ authKey: tsAuthKey }, {
                onSuccess: () => { setTsAuthKey(''); infraStatus.refetch(); },
              })}
              disabled={!tsAuthKey || deployTailscale.isPending || !status?.managerNode}
              className="btn-primary flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {deployTailscale.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Network className="w-4 h-4" />
              )}
              {deployTailscale.isPending ? 'Authenticating...' : 'Authenticate Tailscale'}
            </button>

            {!status?.managerNode && (
              <p className="text-[11px] text-amber-400/70">
                ⚠ Add a manager node first before authenticating Tailscale
              </p>
            )}
          </div>
        )}

        {tsStatus.authenticated && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white/[0.02] rounded-lg p-3">
                <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Tailscale IP</p>
                <p className="text-sm text-white/80 font-mono">{tsStatus.ipAddress || '-'}</p>
              </div>
              <div className="bg-white/[0.02] rounded-lg p-3">
                <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Tailnet</p>
                <p className="text-sm text-white/80">{tsStatus.tailnetName || '-'}</p>
              </div>
              <div className="bg-white/[0.02] rounded-lg p-3">
                <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Hostname</p>
                <p className="text-sm text-white/80">{tsStatus.hostname || '-'}</p>
              </div>
              <div className="bg-white/[0.02] rounded-lg p-3">
                <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Version</p>
                <p className="text-sm text-white/80 font-mono">{tsStatus.version || '-'}</p>
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-white/5 pt-4">
              <p className="text-[11px] text-white/30">
                Tailscale is connected. Add remote nodes using their Tailscale IP as the Host.
              </p>
              <button
                onClick={() => handleUpdate('tailscale', 'Updating Tailscale might briefly drop active terminal connections to your nodes. Continue?')}
                disabled={!!updatingComponent}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white/70 hover:bg-white/10 transition-colors disabled:opacity-50"
              >
                {updatingComponent === 'tailscale' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                {updatingComponent === 'tailscale' ? 'Updating...' : 'Update Binary'}
              </button>
            </div>
          </div>
        )}

        {deployTailscale.isSuccess && (
          <div className="mt-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 text-xs text-emerald-400">
            ✓ {(deployTailscale.data as any)?.message}
          </div>
        )}

        {deployTailscale.isError && (
          <div className="mt-3 bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-400">
            ✗ {deployTailscale.error?.message}
          </div>
        )}
      </div>

      {/* Nixpacks Setup */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <Box className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Nixpacks Builder</h3>
              <p className="text-[11px] text-white/30">Builds Docker images from source without a Dockerfile</p>
            </div>
          </div>
          {status?.nixpacks && status.nixpacks !== 'unknown' && status.nixpacks !== 'not installed' && (
            <span className="flex items-center gap-1.5 text-xs text-emerald-400">
              <CheckCircle className="w-3.5 h-3.5" />
              Installed
            </span>
          )}
        </div>

        {status?.nixpacks && status.nixpacks !== 'unknown' && status.nixpacks !== 'not installed' ? (
          <div className="space-y-3">
            <div className="bg-white/[0.02] rounded-lg p-3 w-max min-w-[200px]">
              <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Version</p>
              <p className="text-sm text-white/80 font-mono">{status.nixpacks}</p>
            </div>
            
            <div className="flex items-center justify-between border-t border-white/5 pt-4 mt-4">
              <p className="text-[11px] text-white/30">
                Nixpacks automatically detects your project language and builds optimized images.
              </p>
              <button
                onClick={() => handleUpdate('nixpacks')}
                disabled={!!updatingComponent}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white/70 hover:bg-white/10 transition-colors disabled:opacity-50"
              >
                {updatingComponent === 'nixpacks' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                {updatingComponent === 'nixpacks' ? 'Updating...' : 'Update Binary'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-lg p-4">
              <div className="flex gap-3">
                <Box className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <p className="text-xs text-white/40">
                  Nixpacks is not installed. Deployments without a Dockerfile will fail until it is installed.
                </p>
              </div>
            </div>
            
            <button
              onClick={() => handleUpdate('nixpacks')}
              disabled={!!updatingComponent || !status?.managerNode}
              className="btn-primary flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {updatingComponent === 'nixpacks' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              {updatingComponent === 'nixpacks' ? 'Installing...' : 'Install Nixpacks'}
            </button>
          </div>
        )}
      </div>

      {/* Webhook Info */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center">
            <Lock className="w-4 h-4 text-white/40" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">GitHub Webhook</h3>
            <p className="text-[11px] text-white/30">Auto-deploy on push — add this URL to your GitHub repo settings</p>
          </div>
        </div>

        <div className="bg-white/[0.02] rounded-lg p-3">
          <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Webhook URL</p>
          <p className="text-sm text-white/80 font-mono break-all">
            {typeof window !== 'undefined' ? `${window.location.origin}/api/webhooks/github` : '/api/webhooks/github'}
          </p>
        </div>
        <p className="text-[11px] text-white/30 mt-2">
          Set <code className="text-brand-400">GITHUB_WEBHOOK_SECRET</code> env var to enable signature verification.
          Content type: <code className="text-white/50">application/json</code>
        </p>
      </div>
    </div>
  );
}

// ── Status Card Component ────────────────────────────────────

function StatusCard({ label, value, detail, active, updateBadge }: {
  label: string;
  value: string;
  detail?: string;
  active: boolean;
  updateBadge?: string;
}) {
  return (
    <div className={`rounded-lg p-3 border ${
      active
        ? 'bg-emerald-500/5 border-emerald-500/10'
        : 'bg-white/[0.02] border-white/[0.05]'
    }`}>
      <div className="flex items-center gap-1.5 mb-2">
        {active ? (
          <CheckCircle className="w-3 h-3 text-emerald-400" />
        ) : (
          <XCircle className="w-3 h-3 text-white/20" />
        )}
        <span className="text-[10px] text-white/40 uppercase tracking-wider">{label}</span>
        {updateBadge && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-brand-500/15 border border-brand-500/20 text-brand-400 font-medium ml-auto animate-pulse">
            ⬆ {updateBadge}
          </span>
        )}
      </div>
      <p className={`text-sm font-medium ${active ? 'text-white/80' : 'text-white/30'}`}>{value}</p>
      {detail && <p className="text-[11px] text-white/30 mt-0.5 font-mono">{detail}</p>}
    </div>
  );
}

// ── Registry Card with S3 HA support ───────────────────────────────
function RegistryCard({ status, updates, updatingComponent, handleUpdate, infraStatus }: {
  status: any;
  updates: Record<string, any> | null;
  updatingComponent: string | null;
  handleUpdate: (component: 'traefik' | 'registry' | 'nixpacks' | 'tailscale', confirmMsg?: string) => void;
  infraStatus: any;
}) {
  const deployRegistry = trpc.infra.deployRegistry.useMutation();
  const configureS3 = trpc.infra.configureRegistryS3.useMutation();
  const [showS3Config, setShowS3Config] = useState(false);
  const [s3Config, setS3Config] = useState({
    endpoint: '',
    accessKey: '',
    secretKey: '',
    bucket: 'docker-registry',
    region: 'us-east-1',
  });

  const registryStatus = status?.registry;
  const isS3 = registryStatus?.storageMode === 's3';
  const replicas = registryStatus?.replicas || 0;

  const handleMigrateToS3 = async () => {
    if (!s3Config.endpoint || !s3Config.accessKey || !s3Config.secretKey) {
      alert('Please fill in all S3 credentials.');
      return;
    }
    if (!window.confirm(
      'This will restart the registry service with S3 storage. Existing locally-stored images will NOT be migrated. Continue?'
    )) return;

    configureS3.mutate(s3Config, {
      onSuccess: () => {
        infraStatus.refetch();
        setShowS3Config(false);
      },
    });
  };

  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
            <Container className="w-4 h-4 text-purple-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Self-Hosted Docker Registry</h3>
            <p className="text-[11px] text-white/30">Stores built images on your infrastructure — no Docker Hub needed</p>
          </div>
        </div>
        {registryStatus?.running && (
          <span className="flex items-center gap-1.5 text-xs text-emerald-400">
            <CheckCircle className="w-3.5 h-3.5" />
            Running
          </span>
        )}
      </div>

      {!registryStatus?.running && (
        <div className="space-y-4">
          <div className="bg-purple-500/5 border border-purple-500/10 rounded-lg p-4">
            <div className="flex gap-3">
              <Container className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
              <p className="text-xs text-white/40">
                Deploys a Docker Registry v2 on port <code className="text-purple-400">5000</code> of your manager node.
                Built images are pushed here before deployment — your data stays on your infrastructure.
              </p>
            </div>
          </div>

          <button
            onClick={() => deployRegistry.mutate({}, {
              onSuccess: () => infraStatus.refetch(),
            })}
            disabled={deployRegistry.isPending || !status?.managerNode}
            className="btn-primary flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {deployRegistry.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Rocket className="w-4 h-4" />
            )}
            {deployRegistry.isPending ? 'Deploying...' : 'Deploy Registry'}
          </button>

          {!status?.managerNode && (
            <p className="text-[11px] text-amber-400/70">
              ⚠ Add a manager node first before deploying the registry
            </p>
          )}
        </div>
      )}

      {registryStatus?.running && (
        <div className="space-y-3">
          {/* Status info */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white/[0.02] rounded-lg p-3">
              <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Registry URL</p>
              <p className="text-sm text-white/80 font-mono">{registryStatus.url}</p>
            </div>
            <div className="bg-white/[0.02] rounded-lg p-3">
              <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Storage</p>
              <p className={`text-sm font-medium ${isS3 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {isS3 ? '☁ S3 (HA)' : '💾 Local Volume'}
              </p>
            </div>
            <div className="bg-white/[0.02] rounded-lg p-3">
              <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Replicas</p>
              <p className={`text-sm font-medium ${replicas >= 2 ? 'text-emerald-400' : 'text-white/80'}`}>
                {registryStatus?.mode === 'global'
                  ? `${replicas} (Global — all nodes)`
                  : `${replicas} ${replicas >= 2 ? '(HA)' : '(Single)'}`}
              </p>
            </div>
          </div>

          {/* SPOF warning for local mode */}
          {!isS3 && (
            <div className="bg-amber-500/5 border border-amber-500/10 rounded-lg p-3">
              <div className="flex gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[11px] text-amber-400/80">
                    Registry is using local storage — single point of failure. Enable S3 storage for High Availability.
                  </p>
                  <button
                    onClick={() => setShowS3Config(!showS3Config)}
                    className="text-[11px] text-brand-400 hover:text-brand-300 font-medium mt-1 transition-colors"
                  >
                    {showS3Config ? 'Hide S3 config ↑' : 'Enable HA Storage (S3) →'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* S3 Configuration Form */}
          {showS3Config && !isS3 && (
            <div className="border border-purple-500/10 rounded-lg p-4 space-y-3 bg-purple-500/[0.02]">
              <h4 className="text-xs font-semibold text-white/70">S3-Compatible Storage (Supabase / R2 / AWS)</h4>
              <p className="text-[10px] text-white/30">
                Connect an S3-compatible bucket to store registry data. The registry will be redeployed with multiple replicas across your nodes.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-[10px] font-medium text-white/50 mb-1">S3 Endpoint</label>
                  <input
                    type="text"
                    value={s3Config.endpoint}
                    onChange={(e) => setS3Config(p => ({ ...p, endpoint: e.target.value }))}
                    placeholder="https://xxx.supabase.co/storage/v1/s3"
                    className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder-white/20 focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/50 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-white/50 mb-1">Access Key</label>
                  <input
                    type="text"
                    value={s3Config.accessKey}
                    onChange={(e) => setS3Config(p => ({ ...p, accessKey: e.target.value }))}
                    placeholder="Access Key ID"
                    className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder-white/20 focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/50 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-white/50 mb-1">Secret Key</label>
                  <input
                    type="password"
                    value={s3Config.secretKey}
                    onChange={(e) => setS3Config(p => ({ ...p, secretKey: e.target.value }))}
                    placeholder="Secret Access Key"
                    className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder-white/20 focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/50 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-white/50 mb-1">Bucket Name</label>
                  <input
                    type="text"
                    value={s3Config.bucket}
                    onChange={(e) => setS3Config(p => ({ ...p, bucket: e.target.value }))}
                    placeholder="docker-registry"
                    className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder-white/20 focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/50 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-white/50 mb-1">Region</label>
                  <input
                    type="text"
                    value={s3Config.region}
                    onChange={(e) => setS3Config(p => ({ ...p, region: e.target.value }))}
                    placeholder="us-east-1"
                    className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder-white/20 focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/50 transition-all"
                  />
                </div>
              </div>
              <button
                onClick={handleMigrateToS3}
                disabled={configureS3.isPending || !s3Config.endpoint || !s3Config.accessKey || !s3Config.secretKey}
                className="btn-primary flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed w-full justify-center"
              >
                {configureS3.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Server className="w-4 h-4" />
                )}
                {configureS3.isPending ? 'Migrating...' : 'Migrate to S3 (HA Mode)'}
              </button>
              {configureS3.isError && (
                <p className="text-xs text-red-400">✗ {configureS3.error?.message}</p>
              )}
            </div>
          )}

          {/* HA success indicator */}
          {isS3 && (
            <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-lg p-3">
              <div className="flex gap-2">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-emerald-400/80">
                  Registry is running in HA mode with S3 storage. {replicas} replicas across your cluster — no single point of failure.
                </p>
              </div>
            </div>
          )}

          {/* Update button */}
          <div className="flex items-center justify-between border-t border-white/5 pt-4">
            <p className="text-[11px] text-white/30">
              Registry is running. Built images will be automatically pushed here.
            </p>
            <button
              onClick={() => handleUpdate('registry')}
              disabled={!!updatingComponent}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-colors disabled:opacity-50 ${
                updates?.registry?.updateAvailable
                  ? 'bg-brand-500/10 border-brand-500/20 text-brand-400 hover:bg-brand-500/20'
                  : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10'
              }`}
            >
              {updatingComponent === 'registry' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : updates?.registry?.updateAvailable ? <ArrowUpCircle className="w-3.5 h-3.5" /> : <RefreshCw className="w-3.5 h-3.5" />}
              {updatingComponent === 'registry'
                ? 'Updating...'
                : updates?.registry?.updateAvailable
                  ? `Update → ${updates.registry.latestVersion}`
                  : 'Re-pull Image'}
            </button>
          </div>
        </div>
      )}

      {deployRegistry.isSuccess && (
        <div className="mt-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 text-xs text-emerald-400">
          ✓ {deployRegistry.data?.message}
        </div>
      )}

      {deployRegistry.isError && (
        <div className="mt-3 bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-400">
          ✗ {deployRegistry.error?.message}
        </div>
      )}

      {configureS3.isSuccess && (
        <div className="mt-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 text-xs text-emerald-400">
          ✓ {configureS3.data?.message}
        </div>
      )}
    </div>
  );
}

// ── Storage Management Tab ─────────────────────────────────────────
function StorageTab() {
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined);
  const { data: storage, isLoading, refetch } = trpc.infra.dockerStorage.useQuery(
    selectedNodeId ? { nodeId: selectedNodeId } : undefined
  );
  const prune = trpc.infra.dockerPrune.useMutation({
    onSuccess: () => {
      // Refetch storage data for the SAME node we just pruned
      refetch();
    },
  });

  const [pruneOptions, setPruneOptions] = useState({
    buildCache: true,
    danglingImages: true,
    stoppedContainers: true,
    allUnusedImages: false,
  });

  const diskPercent = storage?.disk?.usedPercent || 0;
  const diskColor = diskPercent > 80 ? 'text-red-400' : diskPercent > 60 ? 'text-amber-400' : 'text-emerald-400';
  const diskBarColor = diskPercent > 80 ? 'bg-red-500' : diskPercent > 60 ? 'bg-amber-500' : 'bg-emerald-500';
  const availableNodes = (storage as any)?.availableNodes || [];

  return (
    <div className="space-y-6">
      {/* Node Selector */}
      {availableNodes.length > 1 && (
        <div className="glass-card p-4">
          <div className="flex items-center gap-3">
            <Server className="w-4 h-4 text-white/40" />
            <select
              value={selectedNodeId || ''}
              onChange={(e) => setSelectedNodeId(e.target.value || undefined)}
              className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500/50"
            >
              <option value="">Auto (first manager)</option>
              {availableNodes.map((n: any) => (
                <option key={n.id} value={n.id}>{n.name} — {n.host} ({n.role})</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Error display */}
      {(storage as any)?.error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-400">
          ✗ {(storage as any).error}
        </div>
      )}

      {/* Disk Overview */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold">Disk Usage</h2>
            <p className="text-[11px] text-white/30">
              {(storage as any)?.selectedNode || 'Manager node'} storage overview
            </p>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isLoading}
            className="text-xs text-white/40 hover:text-white/60 transition-colors"
          >
            {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Refresh'}
          </button>
        </div>

        {storage?.disk ? (
          <div className="space-y-3">
            <div className="flex items-end justify-between">
              <div>
                <span className={`text-3xl font-bold ${diskColor}`}>{diskPercent}%</span>
                <span className="text-xs text-white/30 ml-2">used</span>
              </div>
              <div className="text-right text-xs text-white/40">
                {storage.disk.used} / {storage.disk.total}
                <span className="text-white/20 ml-1">({storage.disk.available} free)</span>
              </div>
            </div>
            <div className="h-2.5 bg-white/[0.05] rounded-full overflow-hidden">
              <div className={`h-full ${diskBarColor} rounded-full transition-all duration-500`} style={{ width: `${diskPercent}%` }} />
            </div>
          </div>
        ) : (
          <div className="text-xs text-white/30">Loading...</div>
        )}
      </div>

      {/* Docker Resource Breakdown */}
      <div className="glass-card p-6">
        <h2 className="text-sm font-semibold mb-1">Docker Resources</h2>
        <p className="text-[11px] text-white/30 mb-4">Breakdown of Docker storage by resource type</p>

        {storage?.dockerUsage && storage.dockerUsage.length > 0 ? (
          <div className="space-y-2">
            {storage.dockerUsage.map((item: any) => (
              <div key={item.type} className="flex items-center justify-between py-2 border-b border-white/[0.04] last:border-0">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-white/[0.03] flex items-center justify-center">
                    {item.type === 'Images' ? <Container className="w-4 h-4 text-blue-400" /> :
                     item.type === 'Containers' ? <Server className="w-4 h-4 text-purple-400" /> :
                     item.type === 'Build Cache' ? <Zap className="w-4 h-4 text-amber-400" /> :
                     <HardDrive className="w-4 h-4 text-white/40" />}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-white/80">{item.type}</p>
                    <p className="text-[10px] text-white/30">{item.active} active / {item.total} total</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs font-mono text-white/60">{item.size}</p>
                  <p className="text-[10px] text-emerald-400/60">{item.reclaimable} reclaimable</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-white/30">No data available</div>
        )}
      </div>

      {/* Images List */}
      {storage?.images && storage.images.length > 0 && (
        <div className="glass-card p-6">
          <h2 className="text-sm font-semibold mb-1">Docker Images</h2>
          <p className="text-[11px] text-white/30 mb-4">{storage.images.length} images on manager node</p>

          <div className="space-y-1">
            {storage.images.map((img: any) => (
              <div key={img.id} className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-white/[0.02] transition-colors">
                <div>
                  <p className="text-xs font-mono text-white/70">
                    {img.repository}
                    <span className="text-white/30">:{img.tag}</span>
                  </p>
                  <p className="text-[10px] text-white/25">{img.created}</p>
                </div>
                <span className="text-xs font-mono text-white/40">{img.size}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stopped Containers */}
      {storage?.stoppedContainers && storage.stoppedContainers.length > 0 && (
        <div className="glass-card p-6">
          <h2 className="text-sm font-semibold mb-1">Stopped Containers</h2>
          <p className="text-[11px] text-white/30 mb-4">{storage.stoppedContainers.length} stopped containers using disk space</p>

          <div className="space-y-1">
            {storage.stoppedContainers.map((c: any) => (
              <div key={c.id} className="flex items-center justify-between py-1.5 px-2 text-xs">
                <span className="font-mono text-white/50">{c.name}</span>
                <span className="text-white/25">{c.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cleanup */}
      <div className="glass-card p-6">
        <h2 className="text-sm font-semibold mb-1">Cleanup</h2>
        <p className="text-[11px] text-white/30 mb-4">Remove unused Docker resources to free disk space</p>

        <div className="space-y-3 mb-5">
          {[
            { key: 'buildCache' as const, label: 'Build Cache', desc: 'Remove all build cache (largest savings)', icon: Zap, color: 'text-amber-400' },
            { key: 'danglingImages' as const, label: 'Dangling Images', desc: 'Untagged images from failed/old builds', icon: Container, color: 'text-blue-400' },
            { key: 'stoppedContainers' as const, label: 'Stopped Containers', desc: 'Exited containers no longer needed', icon: Server, color: 'text-purple-400' },
            { key: 'allUnusedImages' as const, label: 'All Unused Images', desc: 'Remove all images not used by running containers', icon: Trash2, color: 'text-red-400' },
          ].map(({ key, label, desc, icon: Icon, color }) => (
            <label key={key} className="flex items-center gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={pruneOptions[key]}
                onChange={(e) => setPruneOptions(prev => ({ ...prev, [key]: e.target.checked }))}
                className="w-4 h-4 rounded border-white/20 bg-white/5 text-brand-500 focus:ring-brand-500/50"
              />
              <Icon className={`w-4 h-4 ${color}`} />
              <div>
                <p className="text-xs text-white/70 group-hover:text-white/90 transition-colors">{label}</p>
                <p className="text-[10px] text-white/25">{desc}</p>
              </div>
            </label>
          ))}
        </div>

        {prune.isSuccess && (
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 text-xs text-emerald-400 mb-4 flex items-center gap-2">
            <CheckCircle className="w-3.5 h-3.5" />
            Cleanup complete! Reclaimed: {prune.data?.spaceReclaimed}
          </div>
        )}

        {prune.isError && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-400 mb-4">
            ✗ {prune.error?.message}
          </div>
        )}

        <button
          onClick={() => prune.mutate({ ...pruneOptions, nodeId: selectedNodeId })}
          disabled={prune.isPending || !Object.values(pruneOptions).some(Boolean)}
          className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {prune.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Trash2 className="w-4 h-4" />
          )}
          {prune.isPending ? 'Cleaning up...' : 'Clean Up Docker Storage'}
        </button>
      </div>
    </div>
  );
}

// ── SMTP Configuration Form ─────────────────────────────────

function SmtpConfigForm() {
  const smtpQuery = trpc.system.getSmtp.useQuery();
  const saveSmtp = trpc.system.saveSmtp.useMutation();
  const testSmtp = trpc.system.testSmtp.useMutation();

  const [host, setHost] = useState('');
  const [port, setPort] = useState('587');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [from, setFrom] = useState('');
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);

  useEffect(() => {
    if (smtpQuery.data) {
      setHost(smtpQuery.data.host);
      setPort(smtpQuery.data.port);
      setUser(smtpQuery.data.user);
      setFrom(smtpQuery.data.from);
    }
  }, [smtpQuery.data]);

  const handleSave = () => {
    saveSmtp.mutate({ host, port, user, password, from }, {
      onSuccess: () => smtpQuery.refetch(),
    });
  };

  const handleTest = () => {
    setTestResult(null);
    testSmtp.mutate({ host, port, user, password, from }, {
      onSuccess: (res) => setTestResult(res),
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] text-white/30 uppercase tracking-wider mb-1 block">SMTP Host</label>
          <input value={host} onChange={e => setHost(e.target.value)} placeholder="smtp.gmail.com"
            className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white/80 placeholder:text-white/20 focus:border-brand-500/50 outline-none" />
        </div>
        <div>
          <label className="text-[10px] text-white/30 uppercase tracking-wider mb-1 block">Port</label>
          <input value={port} onChange={e => setPort(e.target.value)} placeholder="587"
            className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white/80 placeholder:text-white/20 focus:border-brand-500/50 outline-none" />
        </div>
      </div>
      <div>
        <label className="text-[10px] text-white/30 uppercase tracking-wider mb-1 block">Username / Email</label>
        <input value={user} onChange={e => setUser(e.target.value)} placeholder="you@gmail.com"
          className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white/80 placeholder:text-white/20 focus:border-brand-500/50 outline-none" />
      </div>
      <div>
        <label className="text-[10px] text-white/30 uppercase tracking-wider mb-1 block">Password / App Password</label>
        <input value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter password" type="password"
          className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white/80 placeholder:text-white/20 focus:border-brand-500/50 outline-none" />
      </div>
      <div>
        <label className="text-[10px] text-white/30 uppercase tracking-wider mb-1 block">From Address (optional)</label>
        <input value={from} onChange={e => setFrom(e.target.value)} placeholder="noreply@yourdomain.com"
          className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white/80 placeholder:text-white/20 focus:border-brand-500/50 outline-none" />
      </div>

      {testResult && (
        <div className={`text-xs px-3 py-2 rounded-lg ${testResult.success ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
          {testResult.success ? '✓ Test email sent successfully!' : `✗ ${testResult.error}`}
        </div>
      )}

      <div className="flex items-center gap-2 pt-2">
        <button onClick={handleTest} disabled={!host || !user || !password || testSmtp.isPending}
          className="px-4 py-2 rounded-lg border border-white/10 text-xs text-white/60 hover:bg-white/5 transition-colors disabled:opacity-50 flex items-center gap-2">
          {testSmtp.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
          Send Test Email
        </button>
        <button onClick={handleSave} disabled={!host || !user || !password || saveSmtp.isPending}
          className="btn-primary flex items-center gap-2 disabled:opacity-50">
          {saveSmtp.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {saveSmtp.isPending ? 'Saving...' : 'Save SMTP Settings'}
        </button>
      </div>

      {smtpQuery.data?.configured && (
        <p className="text-[10px] text-emerald-400/60 flex items-center gap-1">
          <CheckCircle className="w-3 h-3" /> SMTP is configured
        </p>
      )}
    </div>
  );
}

// ── Team Tab ────────────────────────────────────────────────

function TeamTab({ user }: { user: any }) {
  const team = trpc.system.getTeam.useQuery();
  const inviteMember = trpc.system.inviteMember.useMutation();
  const cancelInvite = trpc.system.cancelInvite.useMutation();

  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member' | 'viewer'>('member');
  const [inviteResult, setInviteResult] = useState<{ link?: string; emailSent?: boolean; error?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const handleInvite = () => {
    setInviteResult(null);
    inviteMember.mutate({ email: inviteEmail, role: inviteRole }, {
      onSuccess: (res) => {
        if (res.success) {
          setInviteResult({ link: res.inviteLink, emailSent: res.emailSent });
          setInviteEmail('');
          team.refetch();
        } else {
          setInviteResult({ error: (res as any).error || 'Failed to invite' });
        }
      },
    });
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const roleColors: Record<string, string> = {
    owner: 'bg-brand-500/10 text-brand-400 border-brand-500/20',
    admin: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    member: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    viewer: 'bg-white/5 text-white/40 border-white/10',
  };

  return (
    <div className="space-y-4">
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-sm font-semibold">Team Members</h2>
            <p className="text-[11px] text-white/30 mt-0.5">Manage who has access to this organization</p>
          </div>
          <button onClick={() => setShowInvite(!showInvite)} className="btn-primary flex items-center gap-2 text-xs py-1.5">
            <Users className="w-3.5 h-3.5" />
            Invite Member
          </button>
        </div>

        {/* Invite form */}
        {showInvite && (
          <div className="bg-white/[0.02] border border-white/10 rounded-lg p-4 mb-5 space-y-3 animate-fade-in">
            <div className="flex gap-2">
              <input
                value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                placeholder="email@example.com" type="email"
                className="flex-1 bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-xs text-white/80 placeholder:text-white/20 focus:border-brand-500/50 outline-none"
              />
              <select value={inviteRole} onChange={e => setInviteRole(e.target.value as any)}
                className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-xs text-white/80 focus:border-brand-500/50 outline-none">
                <option value="admin">Admin</option>
                <option value="member">Member</option>
                <option value="viewer">Viewer</option>
              </select>
              <button onClick={handleInvite} disabled={!inviteEmail || inviteMember.isPending}
                className="btn-primary text-xs px-4 disabled:opacity-50 flex items-center gap-1.5">
                {inviteMember.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
                Send
              </button>
            </div>

            {inviteResult?.error && (
              <p className="text-xs text-red-400">✗ {inviteResult.error}</p>
            )}

            {inviteResult?.link && (
              <div className="bg-black/30 border border-white/10 rounded-lg p-3 space-y-2">
                {inviteResult.emailSent && (
                  <p className="text-[11px] text-emerald-400 flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" /> Invitation email sent!
                  </p>
                )}
                <p className="text-[10px] text-white/30 uppercase tracking-wider">Invite Link</p>
                <div className="flex items-center gap-2">
                  <input value={inviteResult.link} readOnly
                    className="flex-1 bg-transparent text-[11px] font-mono text-white/50 outline-none truncate" />
                  <button onClick={() => handleCopy(inviteResult.link!)}
                    className="text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1 shrink-0">
                    {copied ? <CheckCircle className="w-3 h-3" /> : <Globe className="w-3 h-3" />}
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                {!inviteResult.emailSent && (
                  <p className="text-[10px] text-white/25">SMTP not configured — share this link manually</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Member list */}
        <div className="divide-y divide-white/[0.05]">
          {(team.data?.members || (user ? [{ ...user, role: 'owner' }] : [])).map((m: any) => (
            <div key={m.id || m.email} className="flex items-center justify-between py-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-brand-500/20 flex items-center justify-center text-xs font-medium text-brand-400">
                  {m.name?.[0]?.toUpperCase() || m.email?.[0]?.toUpperCase() || '?'}
                </div>
                <div>
                  <p className="text-sm text-white/80">{m.name || m.email}</p>
                  <p className="text-[11px] text-white/30">{m.email}</p>
                </div>
              </div>
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${roleColors[m.role] || roleColors.member}`}>
                {m.role || 'member'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Pending invites */}
      {team.data?.pendingInvites && team.data.pendingInvites.length > 0 && (
        <div className="glass-card p-6">
          <h3 className="text-sm font-semibold mb-3">Pending Invitations</h3>
          <div className="divide-y divide-white/[0.05]">
            {team.data.pendingInvites.map((inv: any) => (
              <div key={inv.email} className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-xs text-white/30">
                    <Mail className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <p className="text-sm text-white/60">{inv.email}</p>
                    <p className="text-[10px] text-white/25">Invited {new Date(inv.invitedAt).toLocaleDateString()}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${roleColors[inv.role] || roleColors.member}`}>
                    {inv.role}
                  </span>
                  <button onClick={() => cancelInvite.mutate({ email: inv.email }, { onSuccess: () => team.refetch() })}
                    className="text-[10px] text-red-400/60 hover:text-red-400 transition-colors">Cancel</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Profile Tab ─────────────────────────────────────────────

function ProfileTab({ user, onUserUpdate }: { user: any; onUserUpdate: (u: any) => void }) {
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [image, setImage] = useState(user?.image || '');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [pwdFeedback, setPwdFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [changingPwd, setChangingPwd] = useState(false);
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');

  useEffect(() => {
    if (user) {
      setName(user.name || '');
      setEmail(user.email || '');
      setImage(user.image || '');
    }
  }, [user]);

  const handleAvatarUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) {
        setFeedback({ type: 'error', msg: 'Image must be under 5MB' });
        return;
      }
      // Resize to 128x128 avatar via canvas to keep data URL small
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const size = 128;
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d')!;
          // Crop to square from center
          const min = Math.min(img.width, img.height);
          const sx = (img.width - min) / 2;
          const sy = (img.height - min) / 2;
          ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
          setImage(dataUrl);
          setFeedback({ type: 'success', msg: 'Avatar loaded — click Save to apply' });
          setTimeout(() => setFeedback(null), 3000);
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const updateProfileMutation = trpc.system.updateProfile.useMutation();

  const handleSaveProfile = async () => {
    if (!name) { setFeedback({ type: 'error', msg: 'Name is required' }); return; }
    if (!email) { setFeedback({ type: 'error', msg: 'Email is required' }); return; }
    setSaving(true);
    setFeedback(null);
    try {
      await updateProfileMutation.mutateAsync({ name, email, image: image || undefined });
      onUserUpdate({ ...user, name, email, image });
      setFeedback({ type: 'success', msg: 'Profile updated successfully' });
      setTimeout(() => setFeedback(null), 3000);
    } catch (err: any) {
      setFeedback({ type: 'error', msg: err.message || 'Failed to update profile' });
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPwd || !newPwd) { setPwdFeedback({ type: 'error', msg: 'Fill both fields' }); return; }
    if (newPwd.length < 8) { setPwdFeedback({ type: 'error', msg: 'New password must be at least 8 characters' }); return; }
    setChangingPwd(true);
    setPwdFeedback(null);
    try {
      const { error } = await changePassword({ newPassword: newPwd, currentPassword: currentPwd, revokeOtherSessions: true });
      if (error) {
        setPwdFeedback({ type: 'error', msg: error.message || 'Failed to change password' });
      } else {
        setPwdFeedback({ type: 'success', msg: 'Password updated successfully' });
        setCurrentPwd('');
        setNewPwd('');
        setTimeout(() => setPwdFeedback(null), 3000);
      }
    } catch (err: any) {
      setPwdFeedback({ type: 'error', msg: err.message || 'Unexpected error' });
    } finally {
      setChangingPwd(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="glass-card p-6">
        {/* Avatar + header */}
        <div className="flex items-center gap-4 mb-6">
          <div className="relative group cursor-pointer" onClick={handleAvatarUpload}>
            {image ? (
              <img src={image} alt="Avatar" className="w-16 h-16 rounded-full object-cover shadow-lg shadow-brand-500/20" />
            ) : (
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-brand-500 to-accent-500 flex items-center justify-center text-white text-2xl font-bold shadow-lg shadow-brand-500/20">
                {name?.[0]?.toUpperCase() || 'U'}
              </div>
            )}
            <div className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <Camera className="w-5 h-5 text-white" />
            </div>
          </div>
          <div>
            <h2 className="text-lg font-semibold">{name || 'Loading...'}</h2>
            <p className="text-sm text-white/40">{email}</p>
            <button onClick={handleAvatarUpload} className="text-[10px] text-brand-400 hover:text-brand-300 mt-0.5 transition-colors">
              Change avatar
            </button>
          </div>
        </div>

        <h3 className="text-sm font-semibold mb-1">Profile Details</h3>
        <p className="text-[11px] text-white/30 mb-5">Update your personal information</p>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-white/60 mb-1.5">Display Name</label>
            <input value={name} onChange={e => setName(e.target.value)}
              className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/50 transition-all" />
          </div>
          <div>
            <label className="block text-xs font-medium text-white/60 mb-1.5">Email Address</label>
            <input value={email} onChange={e => setEmail(e.target.value)} type="email"
              className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/50 transition-all" />
          </div>
        </div>

        {feedback && (
          <div className={`mt-4 text-xs px-3 py-2 rounded-lg flex items-center gap-2 animate-fade-in ${
            feedback.type === 'success' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
          }`}>
            {feedback.type === 'success' ? <CheckCircle className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
            {feedback.msg}
          </div>
        )}

        <div className="mt-5 flex justify-end">
          <button onClick={handleSaveProfile} disabled={saving}
            className="btn-primary flex items-center gap-2 disabled:opacity-50 min-w-[140px] justify-center">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving...' : 'Save Profile'}
          </button>
        </div>
      </div>

      {/* Password */}
      <div className="glass-card p-6">
        <h3 className="text-sm font-semibold mb-1">Change Password</h3>
        <p className="text-[11px] text-white/30 mb-5">Ensure your account is using a long, random password to stay secure.</p>
        <div className="space-y-3 max-w-sm">
          <input value={currentPwd} onChange={e => setCurrentPwd(e.target.value)} type="password" placeholder="Current Password"
            className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-brand-500/50 transition-all" />
          <input value={newPwd} onChange={e => setNewPwd(e.target.value)} type="password" placeholder="New Password (min 8 chars)"
            className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-brand-500/50 transition-all" />

          {pwdFeedback && (
            <div className={`text-xs px-3 py-2 rounded-lg flex items-center gap-2 animate-fade-in ${
              pwdFeedback.type === 'success' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
            }`}>
              {pwdFeedback.type === 'success' ? <CheckCircle className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
              {pwdFeedback.msg}
            </div>
          )}

          <button onClick={handleChangePassword} disabled={changingPwd}
            className="w-full py-2.5 text-xs font-medium rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition-colors flex items-center justify-center gap-2 disabled:opacity-50">
            {changingPwd ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
            {changingPwd ? 'Updating...' : 'Update Password'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Updates Tab ─────────────────────────────────────────────

function UpdatesTab() {
  const versionQuery = trpc.system.version.useQuery();
  const checkUpdate = trpc.system.checkUpdate.useQuery(undefined, { enabled: false, retry: 1 });
  const triggerUpdate = trpc.system.triggerUpdate.useMutation();
  const [updateTriggered, setUpdateTriggered] = useState(false);
  const [confirmingUpdate, setConfirmingUpdate] = useState(false);
  const terminalRef = useRef<HTMLPreElement>(null);

  // Poll update logs while update is in progress
  const updateLogs = trpc.system.getUpdateLogs.useQuery(undefined, {
    enabled: updateTriggered,
    refetchInterval: updateTriggered ? 2000 : false,
  });

  // Auto-scroll terminal to bottom
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [updateLogs.data?.logs]);

  // Stop polling when update is done
  useEffect(() => {
    if (updateTriggered && updateLogs.data && !updateLogs.data.running && updateLogs.data.logs.length > 0) {
      // Give it a couple more polls to capture final output, then auto-refresh
      const timer = setTimeout(() => {
        window.location.reload();
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [updateTriggered, updateLogs.data]);

  const handleCheckUpdate = () => {
    checkUpdate.refetch();
  };

  const handleUpdate = () => {
    setConfirmingUpdate(false);
    triggerUpdate.mutate(undefined, {
      onSuccess: () => setUpdateTriggered(true),
    });
  };

  const isUpdateDone = updateTriggered && updateLogs.data && !updateLogs.data.running && updateLogs.data.logs.length > 0;

  return (
    <div className="space-y-6">
      {/* Current Version */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500/20 to-accent-500/20 flex items-center justify-center">
            <ArrowUpCircle className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Platform Version</h2>
            <p className="text-[11px] text-white/30">Click-Deploy self-hosted instance</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-5">
          <div className="bg-white/[0.02] rounded-lg p-4 border border-white/5">
            <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Version</p>
            <p className="text-lg font-bold text-white/90 font-mono">
              {versionQuery.isLoading ? '...' : `v${versionQuery.data?.version || '0.1.0'}`}
            </p>
          </div>
          <div className="bg-white/[0.02] rounded-lg p-4 border border-white/5">
            <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Commit</p>
            <div className="flex items-center gap-1.5">
              <GitCommit className="w-4 h-4 text-white/30" />
              <p className="text-sm font-mono text-white/60">
                {versionQuery.isLoading ? '...' : versionQuery.data?.commitSha || 'unknown'}
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={handleCheckUpdate}
          disabled={checkUpdate.isFetching}
          className="btn-primary flex items-center gap-2 w-full justify-center"
        >
          {checkUpdate.isFetching ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          {checkUpdate.isFetching ? 'Checking...' : 'Check for Updates'}
        </button>
      </div>

      {/* Update Results */}
      {checkUpdate.data && (
        <div className="glass-card p-6">
          {checkUpdate.data.error ? (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-xs text-red-400">
              <p className="font-medium mb-1">Cannot check for updates</p>
              <p className="text-red-400/70">{checkUpdate.data.error}</p>
            </div>
          ) : !checkUpdate.data.updateAvailable ? (
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-4 flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
              <div>
                <p className="text-sm font-medium text-emerald-400">You're up to date!</p>
                <p className="text-[11px] text-emerald-400/60 mt-0.5">No new commits on the remote repository.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Download className="w-4 h-4 text-brand-400" />
                  <span className="text-sm font-semibold text-white/80">
                    {checkUpdate.data.commits.length} update{checkUpdate.data.commits.length !== 1 ? 's' : ''} available
                  </span>
                </div>
              </div>

              {/* Commit list */}
              <div className="bg-black/30 rounded-lg border border-white/5 divide-y divide-white/5 max-h-64 overflow-y-auto">
                {checkUpdate.data.commits.map((commit: string, idx: number) => (
                  <div key={idx} className="px-4 py-2.5 flex items-start gap-2.5">
                    <GitCommit className="w-3.5 h-3.5 text-white/20 mt-0.5 shrink-0" />
                    <span className="text-xs text-white/60 font-mono leading-relaxed">{commit}</span>
                  </div>
                ))}
              </div>

              {/* Update button / confirmation */}
              {!updateTriggered && !confirmingUpdate && (
                <button
                  onClick={() => setConfirmingUpdate(true)}
                  disabled={triggerUpdate.isPending}
                  className="w-full py-3 rounded-lg bg-gradient-to-r from-brand-500 to-accent-500 text-white font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {triggerUpdate.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  {triggerUpdate.isPending ? 'Starting update...' : 'Update Now'}
                </button>
              )}

              {!updateTriggered && confirmingUpdate && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 space-y-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs font-medium text-amber-400">Confirm Platform Update</p>
                      <p className="text-[11px] text-amber-400/60 mt-1">
                        This will pull the latest code and rebuild the platform. The dashboard may be temporarily unavailable during the update.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleUpdate}
                      disabled={triggerUpdate.isPending}
                      className="flex-1 py-2 rounded-lg bg-amber-500/20 border border-amber-500/30 text-amber-300 font-medium text-xs hover:bg-amber-500/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      {triggerUpdate.isPending ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                      {triggerUpdate.isPending ? 'Starting...' : 'Yes, Update Now'}
                    </button>
                    <button
                      onClick={() => setConfirmingUpdate(false)}
                      className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white/50 font-medium text-xs hover:bg-white/10 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {triggerUpdate.isError && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-400">
                  ✗ {triggerUpdate.error?.message}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Live Update Terminal ──────────────────────────────── */}
      {updateTriggered && (
        <div className="glass-card overflow-hidden">
          {/* Terminal header */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/5 bg-black/40">
            <div className="flex gap-1.5">
              <div className={`w-2.5 h-2.5 rounded-full ${isUpdateDone ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
              <div className="w-2.5 h-2.5 rounded-full bg-white/10" />
              <div className="w-2.5 h-2.5 rounded-full bg-white/10" />
            </div>
            <span className="text-[11px] text-white/40 font-mono ml-2">
              {isUpdateDone ? '● Update complete' : '● Updating platform...'}
            </span>
            {!isUpdateDone && <Loader2 className="w-3 h-3 text-brand-400 animate-spin ml-auto" />}
            {isUpdateDone && <CheckCircle className="w-3.5 h-3.5 text-emerald-400 ml-auto" />}
          </div>

          {/* Terminal body */}
          <pre
            ref={terminalRef}
            className="bg-[#0a0a0f] text-[11px] leading-[1.6] text-emerald-300/80 font-mono p-4 max-h-[400px] overflow-y-auto whitespace-pre-wrap break-all select-text scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent"
          >
            {updateLogs.data?.logs || 'Waiting for build output...'}
          </pre>

          {/* Completion banner */}
          {isUpdateDone && (
            <div className="px-4 py-3 border-t border-white/5 bg-emerald-500/5 flex items-center justify-between">
              <span className="text-xs text-emerald-400 font-medium">
                ✓ Update finished — refresh the page to load the new version
              </span>
              <button
                onClick={() => window.location.reload()}
                className="text-xs text-brand-400 hover:text-brand-300 font-medium transition-colors"
              >
                Reload now →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── API Keys Tab ────────────────────────────────────────────

function ApiKeysTab() {
  const apiKeys = trpc.system.listApiKeys.useQuery();
  const createKey = trpc.system.createApiKey.useMutation();
  const deleteKey = trpc.system.deleteApiKey.useMutation();
  const [keyName, setKeyName] = useState('');
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleCreate = () => {
    if (!keyName.trim()) return;
    createKey.mutate({ name: keyName.trim() }, {
      onSuccess: (data) => {
        setNewKey(data.key);
        setKeyName('');
        apiKeys.refetch();
      },
    });
  };

  const handleCopy = () => {
    if (newKey) {
      navigator.clipboard.writeText(newKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDelete = (id: string) => {
    setDeletingId(id);
    deleteKey.mutate({ id }, {
      onSuccess: () => { setDeletingId(null); apiKeys.refetch(); },
      onError: () => setDeletingId(null),
    });
  };

  return (
    <div className="space-y-6">
      {/* Create Key */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500/20 to-accent-500/20 flex items-center justify-center">
            <Key className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">API Keys</h2>
            <p className="text-[11px] text-white/30">Generate keys for programmatic access via REST API</p>
          </div>
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="Key name (e.g. CI/CD Pipeline)"
            className="flex-1 bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/50 transition-all"
          />
          <button
            onClick={handleCreate}
            disabled={!keyName.trim() || createKey.isPending}
            className="btn-primary flex items-center gap-2 disabled:opacity-40"
          >
            {createKey.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Generate
          </button>
        </div>
      </div>

      {/* Newly Created Key (shown once) */}
      {newKey && (
        <div className="glass-card p-6 border-brand-500/30">
          <div className="bg-brand-500/10 border border-brand-500/20 rounded-lg p-4 mb-3">
            <p className="text-xs text-brand-400 font-semibold mb-2">⚠ Copy this key now — it won't be shown again</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-black/50 rounded-lg px-3 py-2 text-sm font-mono text-white/80 break-all select-all">
                {newKey}
              </code>
              <button
                onClick={handleCopy}
                className="shrink-0 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 transition-colors flex items-center gap-1.5 text-xs"
              >
                {copied ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-white/40" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
          <button
            onClick={() => setNewKey(null)}
            className="text-xs text-white/30 hover:text-white/50 transition-colors"
          >Dismiss</button>
        </div>
      )}

      {/* Key List */}
      {apiKeys.isLoading ? (
        <div className="glass-card p-6 flex items-center justify-center">
          <Loader2 className="w-4 h-4 animate-spin text-white/30" />
        </div>
      ) : apiKeys.data && apiKeys.data.length > 0 ? (
        <div className="glass-card">
          <div className="px-5 py-3 border-b border-white/5">
            <p className="text-xs text-white/30">{apiKeys.data.length} key{apiKeys.data.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="divide-y divide-white/[0.03]">
            {apiKeys.data.map((k: any) => (
              <div key={k.id} className="px-5 py-3 flex items-center justify-between group">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white/80">{k.name}</p>
                  <div className="flex items-center gap-3 mt-1 text-[11px] text-white/25">
                    <span className="font-mono">{k.keyPrefix}•••••••</span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(k.createdAt).toLocaleDateString()}
                    </span>
                    {k.lastUsedAt && (
                      <span>Last used {new Date(k.lastUsedAt).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(k.id)}
                  disabled={deletingId === k.id}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 hover:bg-danger-500/10 rounded-lg text-white/20 hover:text-danger-400 disabled:opacity-50"
                  title="Delete key"
                >
                  {deletingId === k.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : !newKey ? (
        <div className="glass-card flex flex-col items-center justify-center py-12">
          <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center mb-3">
            <Key className="w-6 h-6 text-white/15" />
          </div>
          <p className="text-xs text-white/30">No API keys yet. Generate one above.</p>
        </div>
      ) : null}

      {/* Usage Examples */}
      <div className="glass-card p-6">
        <h3 className="text-sm font-semibold mb-3">Usage</h3>
        <div className="space-y-3">
          <div>
            <p className="text-[11px] text-white/40 mb-1">List services</p>
            <code className="block bg-black/40 rounded-lg px-3 py-2 text-xs font-mono text-white/60 whitespace-pre-wrap">
{`curl -H "Authorization: Bearer cd_YOUR_KEY" \\\n  ${typeof window !== 'undefined' ? window.location.origin : ''}/api/v1`}
            </code>
          </div>
          <div>
            <p className="text-[11px] text-white/40 mb-1">Trigger a deployment</p>
            <code className="block bg-black/40 rounded-lg px-3 py-2 text-xs font-mono text-white/60 whitespace-pre-wrap">
{`curl -X POST \\\n  -H "Authorization: Bearer cd_YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"serviceName": "my-app"}' \\\n  ${typeof window !== 'undefined' ? window.location.origin : ''}/api/v1`}
            </code>
          </div>
        </div>
      </div>
    </div>
  );
}
