'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Container,
  GitBranch,
  Globe,
  Box,
  Settings2,
  Play,
  Square,
  RotateCcw,
  Hammer,
  Plus,
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Terminal,
  Key,
  Copy,
  Eye,
  EyeOff,
  ScrollText,
  Cpu,
  RefreshCw,
} from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { formatDistanceToNow } from 'date-fns';
import { SlideOver, FormField, FormInput, FormSelect } from '@/components/slide-over';
import { useConfirm } from '@/components/confirm-dialog';
import { toast } from 'sonner';
import { useRealtimeTable } from '@/lib/use-realtime';

const deployStatusConfig: Record<string, { icon: typeof CheckCircle2; class: string; dot: string; label: string }> = {
  running: { icon: CheckCircle2, class: 'text-success-400', dot: 'status-running', label: 'Running' },
  built: { icon: CheckCircle2, class: 'text-success-400', dot: 'status-running', label: 'Built' },
  deploying: { icon: Clock, class: 'text-warning-500', dot: 'status-deploying', label: 'Deploying' },
  building: { icon: Clock, class: 'text-warning-500', dot: 'status-deploying', label: 'Building' },
  pending: { icon: Clock, class: 'text-white/40', dot: 'status-stopped', label: 'Pending' },
  failed: { icon: XCircle, class: 'text-danger-400', dot: 'status-failed', label: 'Failed' },
  cancelled: { icon: XCircle, class: 'text-white/30', dot: 'status-stopped', label: 'Cancelled' },
};

export default function ServiceDetailPage() {
  const params = useParams();
  const projectId = params.id as string;
  const serviceId = params.serviceId as string;

  const [hasActiveDeployment, setHasActiveDeployment] = useState(false);

  const { data: service, isLoading, refetch } = trpc.service.byId.useQuery(
    { id: serviceId },
    { retry: 1, enabled: !!serviceId }
  );
  const { data: deployments, refetch: refetchDeploys } = trpc.deployment.listByService.useQuery(
    { serviceId, limit: 15 },
    {
      retry: 1,
      enabled: !!serviceId,
      // Fallback polling only during active deployments; Realtime handles instant updates
      refetchInterval: hasActiveDeployment ? 5000 : false,
    }
  );
  const { data: domains, refetch: refetchDomains } = trpc.domain.listByService.useQuery(
    { serviceId },
    { retry: 1, enabled: !!serviceId }
  );

  // ── Realtime: instant updates via Supabase broadcast triggers ──
  useRealtimeTable({
    table: 'deployments',
    onchange: () => refetchDeploys(),
  });
  useRealtimeTable({
    table: 'services',
    onchange: () => refetch(),
  });

  // Track whether any deployment is active to control polling
  useEffect(() => {
    const active = deployments?.some((d: any) =>
      ['building', 'deploying', 'pending'].includes(d.deployStatus) ||
      ['pending', 'building'].includes(d.buildStatus)
    ) ?? false;
    setHasActiveDeployment(active);
  }, [deployments]);

  const triggerDeploy = trpc.deployment.trigger.useMutation();
  const restartService = trpc.service.restart.useMutation();
  const stopService = trpc.service.stop.useMutation();
  const startService = trpc.service.start.useMutation();
  const rebuildService = trpc.service.rebuild.useMutation();
  const deleteDomain = trpc.domain.delete.useMutation();
  const updateService = trpc.service.update.useMutation();

  const [tab, setTab] = useState<'overview' | 'deployments' | 'domains' | 'env' | 'logs' | 'resources' | 'settings'>('overview');
  const [showAddDomain, setShowAddDomain] = useState(false);
  const [showEnvVars, setShowEnvVars] = useState(false);
  const deploying = hasActiveDeployment || triggerDeploy.isPending;
  const [restarting, setRestarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [expandedDeploy, setExpandedDeploy] = useState<string | null>(null);
  const confirm = useConfirm();

  const handleDeploy = () => {
    triggerDeploy.mutate({ serviceId }, {
      onSuccess: () => { refetchDeploys(); },
    });
  };

  const handleRestart = () => {
    setRestarting(true);
    restartService.mutate({ id: serviceId }, {
      onSuccess: () => { setRestarting(false); refetch(); },
      onError: () => setRestarting(false),
    });
  };

  const isStopped = service?.status === 'stopped';

  const handleStopStart = () => {
    setStopping(true);
    const mutation = isStopped ? startService : stopService;
    mutation.mutate({ id: serviceId }, {
      onSuccess: () => { setStopping(false); refetch(); },
      onError: () => setStopping(false),
    });
  };

  const handleRebuild = async () => {
    const ok = await confirm({ title: 'Rebuild Service', message: 'This will rebuild from existing code without pulling latest changes. Use "Deploy Now" to fetch latest.', confirmText: 'Rebuild', variant: 'warning' });
    if (!ok) return;
    setRebuilding(true);
    rebuildService.mutate({ id: serviceId }, {
      onSuccess: () => { setRebuilding(false); refetchDeploys(); },
      onError: () => setRebuilding(false),
    });
  };

  const handleDeleteDomain = async (domainId: string, hostname: string) => {
    const ok = await confirm({
      title: 'Remove Domain',
      message: 'This will remove the domain from this service.',
      confirmText: 'Remove',
      variant: 'danger',
      verificationText: hostname,
    });
    if (!ok) return;
    deleteDomain.mutate({ id: domainId }, { onSuccess: () => refetchDomains() });
  };

  if (isLoading || !service) {
    return (
      <div className="space-y-6">
        <div className="h-10 w-64 bg-white/5 rounded-lg animate-pulse" />
        <div className="h-64 glass-card animate-pulse" />
      </div>
    );
  }

  const envVars = (service.envVars as Record<string, string>) || {};
  const ports = (service.ports as any[]) || [];
  const volumes = (service.volumes as any[]) || [];

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'deployments', label: `Deployments (${deployments?.length || 0})` },
    { key: 'domains', label: `Domains (${domains?.length || 0})` },
    { key: 'env', label: 'Environment' },
    { key: 'logs', label: 'Logs' },
    { key: 'resources', label: 'Resources' },
    { key: 'settings', label: 'Settings' },
  ];

  return (
    <div>
      {/* Breadcrumb + Header */}
      <div className="mb-6">
        <Link
          href={`/dashboard/projects/${projectId}`}
          className="inline-flex items-center gap-1.5 text-xs text-white/30 hover:text-white/50 transition-colors mb-4"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {service.project?.name || 'Project'}
        </Link>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-500/20 to-brand-600/10 flex items-center justify-center border border-brand-500/10">
              <Container className="w-6 h-6 text-brand-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{service.name}</h1>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-white/30 capitalize">
                  {service.sourceType}
                </span>
                {service.gitBranch && (
                  <span className="flex items-center gap-1 text-[11px] text-white/30">
                    <GitBranch className="w-3 h-3" />
                    {service.gitBranch}
                  </span>
                )}
                {service.imageName && (
                  <span className="flex items-center gap-1 text-[11px] text-white/30 font-mono">
                    <Box className="w-3 h-3" />
                    {service.imageName}:{service.imageTag || 'latest'}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Stop / Start */}
            <button
              onClick={handleStopStart}
              disabled={stopping || deploying}
              className={`px-3 py-2 rounded-lg border text-xs transition-colors flex items-center gap-1.5 disabled:opacity-50 ${
                isStopped
                  ? 'border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10'
                  : 'border-red-500/20 text-red-400 hover:bg-red-500/10'
              }`}
              title={isStopped ? 'Start service' : 'Stop service (scale to 0)'}
            >
              {stopping ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : isStopped ? <Play className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
              {stopping ? (isStopped ? 'Starting...' : 'Stopping...') : isStopped ? 'Start' : 'Stop'}
            </button>
            {/* Reload */}
            <button
              onClick={handleRestart}
              disabled={restarting || deploying}
              className="px-3 py-2 rounded-lg border border-white/10 text-xs text-white/60 hover:bg-white/5 transition-colors flex items-center gap-1.5 disabled:opacity-50"
              title="Restart containers without rebuilding"
            >
              {restarting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
              {restarting ? 'Restarting...' : 'Reload'}
            </button>
            {/* Rebuild */}
            <button
              onClick={handleRebuild}
              disabled={rebuilding || deploying}
              className="px-3 py-2 rounded-lg border border-amber-500/20 text-xs text-amber-400 hover:bg-amber-500/10 transition-colors flex items-center gap-1.5 disabled:opacity-50"
              title="Rebuild from existing code (no git pull)"
            >
              {rebuilding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Hammer className="w-3.5 h-3.5" />}
              {rebuilding ? 'Rebuilding...' : 'Rebuild'}
            </button>
            {/* Deploy */}
            <button
              onClick={handleDeploy}
              disabled={deploying || restarting}
              className="btn-primary flex items-center gap-2 disabled:opacity-50"
            >
              {deploying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {deploying ? 'Deploying...' : 'Deploy Now'}
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-white/[0.03] p-1 rounded-lg w-fit">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as any)}
            className={`px-4 py-1.5 rounded-md text-xs font-medium transition-colors ${
              tab === t.key ? 'bg-brand-500/20 text-brand-400' : 'text-white/40 hover:text-white/60'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Overview ──────────────────────────────────── */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Source Info */}
          <div className="glass-card p-5">
            <h3 className="text-xs text-white/40 uppercase tracking-wider font-medium mb-4">Source</h3>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-xs text-white/30">Type</span>
                <span className="text-xs text-white/60 capitalize">{service.sourceType}</span>
              </div>
              {service.gitUrl && (
                <div className="flex justify-between">
                  <span className="text-xs text-white/30">Repository</span>
                  <span className="text-xs text-white/60 font-mono truncate max-w-[250px]">{service.gitUrl}</span>
                </div>
              )}
              {service.gitBranch && (
                <div className="flex justify-between">
                  <span className="text-xs text-white/30">Branch</span>
                  <span className="text-xs text-white/60">{service.gitBranch}</span>
                </div>
              )}
              {service.imageName && (
                <div className="flex justify-between">
                  <span className="text-xs text-white/30">Image</span>
                  <span className="text-xs text-white/60 font-mono">{service.imageName}:{service.imageTag || 'latest'}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-xs text-white/30">Dockerfile</span>
                <span className="text-xs text-white/60 font-mono">{service.dockerfilePath || 'Dockerfile'}</span>
              </div>
            </div>
          </div>

          {/* Runtime Config */}
          <div className="glass-card p-5">
            <h3 className="text-xs text-white/40 uppercase tracking-wider font-medium mb-4">Runtime</h3>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-xs text-white/30">Replicas</span>
                <span className="text-xs text-white/60">{service.replicas ?? 1}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-white/30">Auto Deploy</span>
                <span className="text-xs text-white/60">{service.autoDeploy ? 'Yes' : 'No'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-white/30">Ports</span>
                <span className="text-xs text-white/60 font-mono">
                  {ports.length > 0 ? ports.map((p: any) => `${p.container}/${p.protocol || 'tcp'}`).join(', ') : 'None'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-white/30">Volumes</span>
                <span className="text-xs text-white/60">{volumes.length > 0 ? `${volumes.length} mount(s)` : 'None'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-white/30">Env Vars</span>
                <span className="text-xs text-white/60">{Object.keys(envVars).length} variable(s)</span>
              </div>
            </div>
          </div>

          {/* Recent Activity */}
          <div className="glass-card lg:col-span-2">
            <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Latest Deployments</h3>
              <button onClick={() => setTab('deployments')} className="text-xs text-brand-400 hover:text-brand-300">View All</button>
            </div>
            {deployments && deployments.length > 0 ? (
              <div className="divide-y divide-white/[0.03]">
                {deployments.slice(0, 5).map((deploy: any) => {
                  const st = deployStatusConfig[deploy.deployStatus] || deployStatusConfig.pending;
                  const Icon = st.icon;
                  return (
                    <div
                      key={deploy.id}
                      onClick={() => { setTab('deployments'); setExpandedDeploy(deploy.id); }}
                      className="px-5 py-3 flex items-center gap-3 cursor-pointer hover:bg-white/[0.02] transition-colors"
                    >
                      <div className={st.dot} />
                      <div className="flex-1 min-w-0">
                        <span className="text-xs text-white/60 font-mono">{deploy.commitSha?.slice(0, 7) || '-'}</span>
                        <span className="text-[10px] text-white/25 ml-2">{deploy.triggeredBy}</span>
                      </div>
                      <Icon className={`w-3.5 h-3.5 ${st.class}`} />
                      <span className="text-[10px] text-white/20">
                        {formatDistanceToNow(new Date(deploy.createdAt), { addSuffix: true })}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-10 text-center text-xs text-white/25">No deployments yet</div>
            )}
          </div>
        </div>
      )}

      {/* ── Deployments ───────────────────────────────── */}
      {tab === 'deployments' && (
        <div className="glass-card">
          {deployments && deployments.length > 0 ? (
            <div className="divide-y divide-white/[0.03]">
              {deployments.map((deploy: any) => {
                const st = deployStatusConfig[deploy.deployStatus] || deployStatusConfig.pending;
                const buildSt = deployStatusConfig[deploy.buildStatus] || deployStatusConfig.pending;
                const Icon = st.icon;
                const isExpanded = expandedDeploy === deploy.id;
                return (
                  <div key={deploy.id}>
                    <div
                      onClick={() => setExpandedDeploy(isExpanded ? null : deploy.id)}
                      className="px-5 py-4 flex items-center gap-4 hover:bg-white/[0.02] transition-colors cursor-pointer"
                    >
                      <div className={st.dot} />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-white/80 font-mono">{deploy.commitSha?.slice(0, 7) || '-'}</span>
                          {deploy.commitMessage && (
                            <span className="text-[11px] text-white/30 truncate max-w-[300px]">{deploy.commitMessage}</span>
                          )}
                        </div>
                        <p className="text-[10px] text-white/25 mt-0.5">
                          {deploy.branch || '-'} · {deploy.triggeredBy}
                          {deploy.buildNode && ` · Built on ${deploy.buildNode.name}`}
                          {(() => {
                            const totalMs = (deploy.buildDurationMs || 0) + (deploy.deployDurationMs || 0);
                            if (!totalMs && deploy.completedAt) {
                              const elapsed = new Date(deploy.completedAt).getTime() - new Date(deploy.createdAt).getTime();
                              if (elapsed > 0) return ` · ${Math.floor(elapsed / 60000)}m ${Math.floor((elapsed % 60000) / 1000)}s`;
                            }
                            if (totalMs) return ` · ${Math.floor(totalMs / 60000)}m ${Math.floor((totalMs % 60000) / 1000)}s`;
                            return '';
                          })()}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`text-[10px] font-medium px-2 py-1 rounded-md ${buildSt.class} bg-white/5`}>
                          Build: {buildSt.label}
                        </span>
                        <span className={`flex items-center gap-1 text-xs font-medium ${st.class}`}>
                          <Icon className="w-3.5 h-3.5" />
                          {st.label}
                        </span>
                      </div>
                      <span className="text-[10px] text-white/20 shrink-0 w-20 text-right">
                        {formatDistanceToNow(new Date(deploy.createdAt), { addSuffix: true })}
                      </span>
                    </div>

                    {isExpanded && (
                      <div className="px-5 pb-4 space-y-3 animate-fade-in">
                        <div className="grid grid-cols-3 gap-3">
                          <div className="bg-white/[0.02] rounded-lg p-3">
                            <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Build</p>
                            <p className={`text-sm font-medium ${buildSt.class}`}>{buildSt.label}</p>
                            {deploy.buildDurationMs ? (
                              <p className="text-[10px] text-white/25 mt-0.5">{Math.floor(deploy.buildDurationMs / 60000)}m {Math.floor((deploy.buildDurationMs % 60000) / 1000)}s</p>
                            ) : null}
                          </div>
                          <div className="bg-white/[0.02] rounded-lg p-3">
                            <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Deploy</p>
                            <p className={`text-sm font-medium ${st.class}`}>{st.label}</p>
                            {deploy.deployDurationMs ? (
                              <p className="text-[10px] text-white/25 mt-0.5">{Math.floor(deploy.deployDurationMs / 60000)}m {Math.floor((deploy.deployDurationMs % 60000) / 1000)}s</p>
                            ) : null}
                          </div>
                          <div className="bg-white/[0.02] rounded-lg p-3">
                            <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Total Duration</p>
                            <p className="text-sm text-white/80 font-mono">
                              {(() => {
                                const totalMs = (deploy.buildDurationMs || 0) + (deploy.deployDurationMs || 0);
                                const elapsed = totalMs || (deploy.completedAt ? new Date(deploy.completedAt).getTime() - new Date(deploy.createdAt).getTime() : 0);
                                if (elapsed <= 0) return '—';
                                return `${Math.floor(elapsed / 60000)}m ${Math.floor((elapsed % 60000) / 1000)}s`;
                              })()}
                            </p>
                          </div>
                          <div className="bg-white/[0.02] rounded-lg p-3">
                            <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Commit</p>
                            <p className="text-sm text-white/80 font-mono">{deploy.commitSha?.slice(0, 7) || '-'}</p>
                          </div>
                          <div className="bg-white/[0.02] rounded-lg p-3 col-span-2">
                            <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Triggered</p>
                            <p className="text-sm text-white/60">
                              {new Date(deploy.createdAt).toLocaleTimeString()} · {new Date(deploy.createdAt).toLocaleDateString()}
                            </p>
                          </div>
                        </div>

                        <DeployLogViewer deploy={deploy} isActive={['building', 'deploying', 'pending'].includes(deploy.deployStatus)} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-16 text-center">
              <Play className="w-8 h-8 text-white/15 mx-auto mb-3" />
              <p className="text-sm text-white/40">No deployment history</p>
              <button onClick={handleDeploy} className="text-xs text-brand-400 mt-3">Trigger first deploy</button>
            </div>
          )}
        </div>
      )}

      {/* ── Domains ───────────────────────────────────── */}
      {tab === 'domains' && (
        <div>
          <div className="flex justify-end mb-4">
            <button onClick={() => setShowAddDomain(true)} className="btn-primary flex items-center gap-2 text-xs">
              <Plus className="w-3.5 h-3.5" />
              Add Domain
            </button>
          </div>

          {domains && domains.length > 0 ? (
            <div className="glass-card divide-y divide-white/[0.03]">
              {domains.map((domain: any) => (
                <div key={domain.id} className="px-5 py-3 flex items-center justify-between group">
                  <div className="flex items-center gap-3">
                    <Globe className="w-4 h-4 text-brand-400" />
                    <div>
                      <a href={`https://${domain.hostname}`} target="_blank" rel="noopener noreferrer"
                         className="text-sm font-medium text-white/80 hover:text-brand-400 transition-colors">
                        {domain.hostname}
                      </a>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-white/25 capitalize">{domain.sslProvider || 'letsencrypt'}</span>
                        {domain.sslStatus === 'active' && (
                          <span className="text-[10px] text-success-400 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />SSL
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteDomain(domain.id, domain.hostname)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 hover:bg-red-500/10 rounded"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-danger-400" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="glass-card flex flex-col items-center justify-center py-16">
              <Globe className="w-8 h-8 text-white/15 mb-3" />
              <p className="text-sm text-white/40">No domains configured</p>
              <button onClick={() => setShowAddDomain(true)} className="text-xs text-brand-400 mt-3">Add first domain</button>
            </div>
          )}

          <AddDomainSlideOver
            open={showAddDomain}
            onClose={() => setShowAddDomain(false)}
            serviceId={serviceId}
            onSuccess={() => { setShowAddDomain(false); refetchDomains(); }}
          />
        </div>
      )}

      {/* ── Environment Variables ─────────────────────── */}
      {tab === 'env' && (
        <EnvVarsEditor service={service} onSave={() => refetch()} />
      )}

      {/* ── Logs ───────────────────────────────────────── */}
      {tab === 'logs' && (
        <ServiceLogs serviceId={serviceId} />
      )}

      {/* ── Resources ──────────────────────────────────── */}
      {tab === 'resources' && (
        <ResourcesEditor service={service} onSave={() => refetch()} />
      )}

      {/* ── Settings ──────────────────────────────────── */}
      {tab === 'settings' && (
        <ServiceSettings service={service} onSave={() => refetch()} />
      )}
    </div>
  );
}

// ── Env Vars Editor ──────────────────────────────────────────

function EnvVarsEditor({ service, onSave }: { service: any; onSave: () => void }) {
  const updateService = trpc.service.update.useMutation();
  const envVars = (service.envVars as Record<string, string>) || {};
  const [vars, setVars] = useState<{ key: string; value: string }[]>(
    Object.entries(envVars).map(([key, value]) => ({ key, value }))
  );
  const [showValues, setShowValues] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkText, setBulkText] = useState('');

  const addVar = () => setVars([...vars, { key: '', value: '' }]);
  const removeVar = (index: number) => setVars(vars.filter((_, i) => i !== index));
  const updateVar = (index: number, field: 'key' | 'value', val: string) => {
    const updated = [...vars];
    updated[index]![field] = val;
    setVars(updated);
  };

  // Parse .env format text into key-value pairs
  const parseBulkText = (text: string) => {
    const lines = text.split('\n');
    const parsed: { key: string; value: string }[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      // Remove surrounding quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key) parsed.push({ key, value });
    }
    return parsed;
  };

  const applyBulk = () => {
    const parsed = parseBulkText(bulkText);
    if (parsed.length === 0) return;
    // Merge: overwrite existing keys, add new ones
    const existing = new Map(vars.map(v => [v.key, v.value]));
    for (const p of parsed) {
      existing.set(p.key, p.value);
    }
    setVars(Array.from(existing.entries()).map(([key, value]) => ({ key, value })));
    setBulkMode(false);
    setBulkText('');
  };

  // Switch to bulk mode and populate textarea from current vars
  const enterBulkMode = () => {
    const text = vars.map(v => `${v.key}=${v.value}`).join('\n');
    setBulkText(text);
    setBulkMode(true);
  };

  const handleSave = () => {
    const envRecord: Record<string, string> = {};
    vars.forEach((v) => { if (v.key) envRecord[v.key] = v.value; });
    updateService.mutate({ id: service.id, envVars: envRecord }, {
      onSuccess: () => onSave(),
    });
  };

  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold">Environment Variables</h3>
          <p className="text-[11px] text-white/30 mt-0.5">Set runtime environment variables for this service</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowValues(!showValues)} className="p-1.5 hover:bg-white/5 rounded text-white/30">
            {showValues ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
          <button
            onClick={bulkMode ? () => setBulkMode(false) : enterBulkMode}
            className={`text-xs px-2 py-1 rounded ${bulkMode ? 'bg-brand-500/20 text-brand-400' : 'text-white/40 hover:text-white/60 hover:bg-white/5'}`}
          >
            {bulkMode ? 'Cancel' : 'Paste .env'}
          </button>
          {!bulkMode && (
            <button onClick={addVar} className="text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1">
              <Plus className="w-3.5 h-3.5" />
              Add
            </button>
          )}
        </div>
      </div>

      {/* Bulk paste mode */}
      {bulkMode && (
        <div className="space-y-3 mb-4">
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder={"# Paste your .env file here\nKEY=value\nDATABASE_URL=postgres://...\nSECRET_KEY=abc123"}
            rows={12}
            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white/80 placeholder:text-white/20 focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/20 outline-none resize-y"
            autoFocus
          />
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-white/30">
              {parseBulkText(bulkText).length} variables detected (comments and blanks ignored)
            </p>
            <button
              onClick={applyBulk}
              disabled={parseBulkText(bulkText).length === 0}
              className="btn-primary text-xs px-4 py-1.5 disabled:opacity-50"
            >
              Apply {parseBulkText(bulkText).length} Variables
            </button>
          </div>
        </div>
      )}

      {/* Individual key-value mode */}
      {!bulkMode && (
        <>
          {vars.length === 0 ? (
            <div className="py-8 text-center">
              <Key className="w-6 h-6 text-white/15 mx-auto mb-2" />
              <p className="text-xs text-white/30">No environment variables configured</p>
              <div className="flex justify-center gap-3 mt-3">
                <button onClick={addVar} className="text-xs text-brand-400">Add variable</button>
                <span className="text-xs text-white/15">or</span>
                <button onClick={() => setBulkMode(true)} className="text-xs text-brand-400">Paste .env file</button>
              </div>
            </div>
          ) : (
            <div className="space-y-2 mb-4">
              {vars.map((v, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={v.key}
                    onChange={(e) => updateVar(i, 'key', e.target.value)}
                    placeholder="KEY"
                    className="flex-1 bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white/80 placeholder:text-white/20 focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/20 outline-none"
                  />
                  <span className="text-white/15">=</span>
                  <input
                    value={v.value}
                    onChange={(e) => updateVar(i, 'value', e.target.value)}
                    placeholder="value"
                    type={showValues ? 'text' : 'password'}
                    className="flex-[2] bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white/80 placeholder:text-white/20 focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/20 outline-none"
                  />
                  <button onClick={() => removeVar(i)} className="p-1.5 hover:bg-red-500/10 rounded text-white/20 hover:text-danger-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {vars.length > 0 && !bulkMode && (
        <button
          onClick={handleSave}
          disabled={updateService.isPending}
          className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {updateService.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {updateService.isPending ? 'Saving...' : 'Save Environment Variables'}
        </button>
      )}
    </div>
  );
}

// ── Service Settings ─────────────────────────────────────────

function ServiceSettings({ service, onSave }: { service: any; onSave: () => void }) {
  const updateService = trpc.service.update.useMutation();
  const { data: nodesList } = trpc.node.list.useQuery();

  const getInitialDeployNodeIds = () => (service.deployNodeIds as string[]) || [];
  const getInitialReplicasPerNode = () => {
    const ids = getInitialDeployNodeIds();
    return ids.length > 0
      ? Math.max(1, Math.round((service.replicas || 1) / ids.length))
      : (service.replicas || 1);
  };

  const [autoDeploy, setAutoDeploy] = useState(service.autoDeploy ?? true);
  const [gitUrl, setGitUrl] = useState(service.gitUrl || '');
  const [gitBranch, setGitBranch] = useState(service.gitBranch || 'main');
  const [dockerfilePath, setDockerfilePath] = useState(service.dockerfilePath || '');
  const [dockerContext, setDockerContext] = useState(service.dockerContext || '.');
  const [buildNodeId, setBuildNodeId] = useState(service.buildNodeId || '');
  const [replicasPerNode, setReplicasPerNode] = useState(getInitialReplicasPerNode());
  const [deployNodeIds, setDeployNodeIds] = useState<string[]>(getInitialDeployNodeIds());
  const [settingsSaved, setSettingsSaved] = useState(false);

  // Re-sync local state when the service data changes (e.g., after refetch)
  useEffect(() => {
    setAutoDeploy(service.autoDeploy ?? true);
    setGitUrl(service.gitUrl || '');
    setGitBranch(service.gitBranch || 'main');
    setDockerfilePath(service.dockerfilePath || '');
    setDockerContext(service.dockerContext || '.');
    setBuildNodeId(service.buildNodeId || '');
    const ids = (service.deployNodeIds as string[]) || [];
    setDeployNodeIds(ids);
    setReplicasPerNode(
      ids.length > 0
        ? Math.max(1, Math.round((service.replicas || 1) / ids.length))
        : (service.replicas || 1)
    );
  }, [service.id, service.updatedAt]);

  const nodes = nodesList || [];
  const deployNodes = nodes.filter((n: any) => n.canDeploy);
  const totalReplicas = deployNodeIds.length > 0 ? deployNodeIds.length * replicasPerNode : replicasPerNode;

  const toggleDeployNode = (nodeId: string) => {
    setDeployNodeIds(prev =>
      prev.includes(nodeId)
        ? prev.filter(id => id !== nodeId)
        : [...prev, nodeId]
    );
  };

  const handleSave = () => {
    updateService.mutate({
      id: service.id,
      replicas: totalReplicas,
      replicasPerNode,
      autoDeploy,
      gitUrl: gitUrl || undefined,
      gitBranch: gitBranch || 'main',
      dockerfilePath: dockerfilePath || 'Dockerfile',
      dockerContext: dockerContext || '.',
      buildNodeId: buildNodeId || undefined,
      deployNodeIds,
      targetNodeId: deployNodeIds[0] || undefined,
    }, {
      onSuccess: () => {
        setSettingsSaved(true);
        setTimeout(() => setSettingsSaved(false), 3000);
        onSave();
      },
      onError: (err: any) => {
        toast.error(`Failed to save settings: ${err.message}`);
      },
    });
  };

  return (
    <div className="glass-card p-5 max-w-xl">
      <h3 className="text-sm font-semibold mb-4">Service Settings</h3>
      <div className="space-y-4">
        {/* Git Source */}
        {service.sourceType === 'git' && (
          <>
            <FormField label="Git Repository URL">
              <FormInput value={gitUrl} onChange={(e) => setGitUrl(e.target.value)} placeholder="https://github.com/user/repo" />
            </FormField>
            <FormField label="Branch">
              <FormInput value={gitBranch} onChange={(e) => setGitBranch(e.target.value)} placeholder="main" />
            </FormField>
          </>
        )}

        {/* Build Node */}
        <FormField label="Build Node">
          <FormSelect value={buildNodeId} onChange={(e) => setBuildNodeId(e.target.value)}>
            <option value="">Auto (first available)</option>
            {nodes.filter((n: any) => n.canBuild).map((n: any) => (
              <option key={n.id} value={n.id}>{n.name}</option>
            ))}
          </FormSelect>
        </FormField>

        {/* Deploy Nodes — multi-select */}
        <div>
          <label className="block text-xs font-medium text-white/50 mb-2">
            Deploy Nodes
            <span className="text-white/20 font-normal ml-1">— select where replicas run</span>
          </label>
          {deployNodes.length === 0 ? (
            <p className="text-[10px] text-white/25">No deploy-capable nodes found</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {deployNodes.map((n: any) => {
                const selected = deployNodeIds.includes(n.id);
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => toggleDeployNode(n.id)}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${
                      selected
                        ? 'bg-brand-500/15 border-brand-500/30 text-brand-400'
                        : 'bg-white/[0.02] border-white/[0.06] text-white/40 hover:bg-white/[0.04]'
                    }`}
                  >
                    {selected ? '✓ ' : ''}{n.name}
                  </button>
                );
              })}
            </div>
          )}
          {deployNodeIds.length === 0 && (
            <p className="text-[10px] text-white/20 mt-1.5">Auto — Swarm decides placement</p>
          )}
        </div>

        {/* Replicas per node */}
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Replicas per Node" hint="Processes per node (use 2+ for multi-core)">
            <FormInput type="number" value={String(replicasPerNode)} min="1" max="10"
              onChange={(e) => setReplicasPerNode(Math.max(1, Number(e.target.value)))} />
          </FormField>
          <div className="flex flex-col justify-end pb-0.5">
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2 text-center">
              <span className="text-lg font-bold text-white">{totalReplicas}</span>
              <p className="text-[9px] text-white/25 uppercase tracking-wider">Total Replicas</p>
              {deployNodeIds.length > 0 && (
                <p className="text-[9px] text-white/15 mt-0.5">
                  {deployNodeIds.length} node{deployNodeIds.length > 1 ? 's' : ''} × {replicasPerNode}
                </p>
              )}
            </div>
          </div>
        </div>

        <FormField label="Dockerfile Path (optional)">
          <FormInput value={dockerfilePath} onChange={(e) => setDockerfilePath(e.target.value)} placeholder="Leave empty for nixpacks auto-build" />
          <p className="text-[10px] text-white/20 mt-1">Nixpacks auto-detects your language by default. Set a path only to use a custom Dockerfile.</p>
        </FormField>
        <FormField label="Docker Context">
          <FormInput value={dockerContext} onChange={(e) => setDockerContext(e.target.value)} />
        </FormField>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={autoDeploy} onChange={(e) => setAutoDeploy(e.target.checked)}
            className="w-4 h-4 rounded border-white/10 bg-black/40 text-brand-500" />
          <span className="text-xs text-white/50">Auto-deploy on push</span>
        </label>

        {updateService.isError && (
          <div className="text-xs px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 flex items-center gap-2 animate-fade-in mb-2">
            <XCircle className="w-3.5 h-3.5 shrink-0" /> {updateService.error?.message || 'Failed to save settings'}
          </div>
        )}

        {settingsSaved && (
          <div className="text-xs px-3 py-2 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center gap-2 animate-fade-in mb-2">
            <CheckCircle2 className="w-3.5 h-3.5" /> Settings saved successfully
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={updateService.isPending}
          className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg font-medium text-sm transition-all disabled:opacity-50 ${
            settingsSaved
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
              : 'btn-primary'
          }`}
        >
          {updateService.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : settingsSaved ? (
            <CheckCircle2 className="w-4 h-4" />
          ) : (
            <Settings2 className="w-4 h-4" />
          )}
          {updateService.isPending ? 'Saving...' : settingsSaved ? 'Saved!' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}

// ── Add Domain SlideOver ──────────────────────────────────────

function AddDomainSlideOver({ open, onClose, serviceId, onSuccess }: {
  open: boolean; onClose: () => void; serviceId: string; onSuccess: () => void;
}) {
  const createDomain = trpc.domain.create.useMutation();
  const [hostname, setHostname] = useState('');
  const [sslProvider, setSslProvider] = useState('letsencrypt');

  const handleClose = () => { setHostname(''); onClose(); };

  const handleCreate = () => {
    if (!hostname) return;
    createDomain.mutate({
      hostname,
      serviceId,
      sslProvider: sslProvider as any,
    }, {
      onSuccess: () => { handleClose(); onSuccess(); },
    });
  };

  return (
    <SlideOver open={open} onClose={handleClose} title="Add Domain" description="Route a custom domain to this service">
      <div className="space-y-5">
        <div className="bg-brand-500/5 border border-brand-500/10 rounded-lg p-4">
          <p className="text-xs text-white/50">
            Point your domain&apos;s DNS A record to your server&apos;s IP, then add it here. SSL will be provisioned automatically.
          </p>
        </div>

        <FormField label="Domain">
          <FormInput value={hostname} onChange={(e) => setHostname(e.target.value)} placeholder="app.example.com" autoFocus />
        </FormField>

        <FormField label="SSL Provider">
          <FormSelect value={sslProvider} onChange={(e) => setSslProvider(e.target.value)}>
            <option value="letsencrypt">Let&apos;s Encrypt (auto)</option>
            <option value="cloudflare">Cloudflare</option>
            <option value="custom">Custom Certificate</option>
          </FormSelect>
        </FormField>

        {createDomain.isError && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-400">
            ✗ {createDomain.error?.message}
          </div>
        )}

        <button
          onClick={handleCreate}
          disabled={!hostname || createDomain.isPending}
          className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {createDomain.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
          {createDomain.isPending ? 'Adding...' : 'Add Domain'}
        </button>
      </div>
    </SlideOver>
  );
}

// ── Deploy Log Viewer with auto-scroll ───────────────────────────
function DeployLogViewer({ deploy, isActive }: { deploy: any; isActive: boolean }) {
  const logRef = useRef<HTMLPreElement>(null);

  // Merge logs: during build phase only deployLogs has real-time data
  const logs = [deploy.buildLogs, deploy.deployLogs].filter(Boolean).join('\n') || null;

  // Auto-scroll to bottom when logs change during active deployments
  useEffect(() => {
    if (isActive && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs, isActive]);

  if (!logs) {
    if (isActive) {
      return (
        <div className="flex items-center gap-2 text-xs text-white/30 py-2">
          <Loader2 className="w-3 h-3 animate-spin" />
          Waiting for logs...
        </div>
      );
    }
    return null;
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <p className="text-[10px] text-white/40 uppercase tracking-wider">Deployment Logs</p>
        {isActive && (
          <span className="flex items-center gap-1 text-[10px] text-emerald-400">
            <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
            Live
          </span>
        )}
      </div>
      <pre
        ref={logRef}
        className="bg-black/60 border border-white/10 rounded-lg p-3 text-[11px] text-white/60 font-mono max-h-60 overflow-auto whitespace-pre-wrap scroll-smooth"
      >
        {logs}
      </pre>
    </div>
  );
}

// ── Service Logs (live Docker service logs) ──────────────────
function ServiceLogs({ serviceId }: { serviceId: string }) {
  const [tail, setTail] = useState(100);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  const { data: containers } = trpc.service.getContainers.useQuery(
    { serviceId },
    { refetchInterval: autoRefresh ? 5000 : false }
  );

  const { data, isLoading, isError, error, refetch } = trpc.service.getLogs.useQuery(
    { serviceId, tail, taskId: selectedTaskId || undefined },
    { retry: 1, refetchInterval: autoRefresh ? 5000 : false }
  );

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [data?.logs]);

  const getSlotColor = (slot: string | number) => {
    const colors = ['text-blue-400', 'text-emerald-400', 'text-amber-400', 'text-purple-400', 'text-pink-400', 'text-cyan-400'];
    const s = typeof slot === 'number' ? slot : parseInt(String(slot).replace(/\D/g, '') || '0', 10);
    return colors[s % colors.length];
  };

  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <ScrollText className="w-4 h-4 text-brand-400" />
          <div>
            <h3 className="text-sm font-semibold">Service Logs</h3>
            <p className="text-[11px] text-white/30">Live output from running containers</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={tail}
            onChange={(e) => setTail(Number(e.target.value))}
            className="bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-xs text-white/60 focus:outline-none"
          >
            <option value={100}>Last 100</option>
            <option value={500}>Last 500</option>
            <option value={1000}>Last 1000</option>
          </select>
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-2.5 py-1 rounded-lg border text-xs flex items-center gap-1.5 transition-colors ${
              autoRefresh
                ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                : 'border-white/10 text-white/40 hover:bg-white/5'
            }`}
          >
            {autoRefresh && <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />}
            {autoRefresh ? 'Auto' : 'Paused'}
          </button>
          <button
            onClick={() => refetch()}
            className="px-2.5 py-1 rounded-lg border border-white/10 text-xs text-white/40 hover:bg-white/5 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button
          onClick={() => setSelectedTaskId(null)}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all border ${
            selectedTaskId === null
              ? 'bg-brand-500/15 border-brand-500/30 text-brand-400'
              : 'bg-white/[0.02] border-white/[0.06] text-white/40 hover:bg-white/[0.04]'
          }`}
        >
          All Replicas
        </button>
        {containers?.map((c) => {
          const isSelected = selectedTaskId === c.taskId;
          return (
            <button
              key={c.taskId}
              onClick={() => setSelectedTaskId(c.taskId || null)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all border ${
                isSelected
                  ? 'bg-brand-500/15 border-brand-500/30 text-brand-400'
                  : 'bg-white/[0.02] border-white/[0.06] text-white/50 hover:bg-white/[0.04]'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${c.state === 'Running' ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
              Replica .{c.slot}
              <span className="text-white/30 truncate max-w-[80px]">({c.node})</span>
            </button>
          );
        })}
      </div>

      <pre
        ref={logRef}
        className="bg-black/80 border border-white/10 rounded-lg p-4 text-[11px] text-white/60 font-mono max-h-[500px] overflow-auto whitespace-pre-wrap scroll-smooth leading-5"
      >
        {isLoading ? 'Loading logs...' : isError ? (
          <span className="text-danger-400">Error: {(error as any)?.message || 'No manager node available'}</span>
        ) : (
          data?.logs?.map((log: any, idx: number) => (
            <div key={idx} className="break-all">
              {log.container !== '?' && selectedTaskId === null && (
                <span className={`mr-2 font-bold ${getSlotColor(log.container)}`}>
                  [{log.container}@{log.node}]
                </span>
              )}
              {log.message}
            </div>
          )) || 'No logs available'
        )}
      </pre>
    </div>
  );
}

// ── Resources Editor ─────────────────────────────────────────
const MEMORY_PRESETS = [
  { label: '128 MB', value: '128m' },
  { label: '256 MB', value: '256m' },
  { label: '512 MB', value: '512m' },
  { label: '1 GB', value: '1g' },
  { label: '2 GB', value: '2g' },
  { label: '4 GB', value: '4g' },
  { label: '8 GB', value: '8g' },
  { label: '16 GB', value: '16g' },
];
const CPU_PRESETS = [
  { label: '0.25 CPU', value: 0.25 },
  { label: '0.5 CPU', value: 0.5 },
  { label: '1 CPU', value: 1 },
  { label: '2 CPUs', value: 2 },
  { label: '4 CPUs', value: 4 },
  { label: '8 CPUs', value: 8 },
];

function ResourcesEditor({ service, onSave }: { service: any; onSave: () => void }) {
  const resourceLimits = (service.resourceLimits as any) || {};

  const [memoryLimit, setMemoryLimit] = useState(resourceLimits.memoryLimit || '');
  const [memoryReserve, setMemoryReserve] = useState(resourceLimits.memoryReservation || '');
  const [cpuLimit, setCpuLimit] = useState<number>(resourceLimits.cpuLimit || 0);
  const [cpuReserve, setCpuReserve] = useState<number>(resourceLimits.cpuReservation || 0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const updateService = trpc.service.update.useMutation();

  const handleSave = () => {
    setSaving(true);
    updateService.mutate({
      id: service.id,
      resourceLimits: {
        memoryLimit: memoryLimit || undefined,
        memoryReservation: memoryReserve || undefined,
        cpuLimit: cpuLimit || undefined,
        cpuReservation: cpuReserve || undefined,
      },
    }, {
      onSuccess: () => {
        setSaving(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
        onSave();
      },
      onError: () => setSaving(false),
    });
  };

  return (
    <div className="glass-card p-6">
      <div className="flex items-center gap-3 mb-1">
        <Cpu className="w-4 h-4 text-brand-400" />
        <h3 className="text-sm font-semibold">Resource Limits</h3>
      </div>
      <p className="text-[11px] text-white/30 mb-6">
        Control memory and CPU allocation. Click Save then Redeploy to apply.
      </p>

      <div className="grid grid-cols-2 gap-6">
        {/* Memory Limit */}
        <div>
          <label className="block text-xs font-medium text-white/60 mb-1.5">Memory Limit</label>
          <select
            value={memoryLimit}
            onChange={(e) => setMemoryLimit(e.target.value)}
            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-brand-500/50"
          >
            <option value="">No limit</option>
            {MEMORY_PRESETS.map(p => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
          <p className="text-[10px] text-white/20 mt-1">Max memory the container can use</p>
        </div>

        {/* Memory Reservation */}
        <div>
          <label className="block text-xs font-medium text-white/60 mb-1.5">Memory Reservation</label>
          <select
            value={memoryReserve}
            onChange={(e) => setMemoryReserve(e.target.value)}
            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-brand-500/50"
          >
            <option value="">No reservation</option>
            {MEMORY_PRESETS.map(p => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
          <p className="text-[10px] text-white/20 mt-1">Guaranteed memory for scheduling</p>
        </div>

        {/* CPU Limit */}
        <div>
          <label className="block text-xs font-medium text-white/60 mb-1.5">CPU Limit</label>
          <select
            value={cpuLimit}
            onChange={(e) => setCpuLimit(Number(e.target.value))}
            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-brand-500/50"
          >
            <option value={0}>No limit</option>
            {CPU_PRESETS.map(p => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
          <p className="text-[10px] text-white/20 mt-1">Max CPU cores the container can use</p>
        </div>

        {/* CPU Reservation */}
        <div>
          <label className="block text-xs font-medium text-white/60 mb-1.5">CPU Reservation</label>
          <select
            value={cpuReserve}
            onChange={(e) => setCpuReserve(Number(e.target.value))}
            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-brand-500/50"
          >
            <option value={0}>No reservation</option>
            {CPU_PRESETS.map(p => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
          <p className="text-[10px] text-white/20 mt-1">Guaranteed CPU for scheduling</p>
        </div>
      </div>

      <div className="flex items-center justify-between mt-6 pt-4 border-t border-white/5">
        <p className="text-[11px] text-amber-400/70">
          ⚠ After saving, click <strong>Rebuild</strong> or <strong>Deploy Now</strong> to apply changes
        </p>
        <button
          onClick={handleSave}
          disabled={saving}
          className={`px-4 py-2 rounded-lg text-xs font-medium flex items-center gap-2 transition-all ${
            saved
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
              : 'btn-primary'
          } disabled:opacity-50`}
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Cpu className="w-3.5 h-3.5" />}
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Resources'}
        </button>
      </div>
    </div>
  );
}

