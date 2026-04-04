'use client';

import {
  Server,
  Rocket,
  Globe,
  Container,
  CheckCircle2,
  Clock,
  XCircle,
  Cpu,
  HardDrive,
  MemoryStick,
  Plus,
  ArrowRight,
} from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { formatDistanceToNow } from 'date-fns';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const statusConfig: Record<string, { icon: typeof CheckCircle2; class: string; dot: string; label: string }> = {
  running: { icon: CheckCircle2, class: 'text-success-400', dot: 'status-running', label: 'Running' },
  built: { icon: CheckCircle2, class: 'text-success-400', dot: 'status-running', label: 'Built' },
  deploying: { icon: Clock, class: 'text-warning-500', dot: 'status-deploying', label: 'Deploying' },
  building: { icon: Clock, class: 'text-warning-500', dot: 'status-deploying', label: 'Building' },
  pending: { icon: Clock, class: 'text-warning-500', dot: 'status-deploying', label: 'Pending' },
  failed: { icon: XCircle, class: 'text-danger-400', dot: 'status-failed', label: 'Failed' },
  cancelled: { icon: XCircle, class: 'text-white/30', dot: 'status-stopped', label: 'Cancelled' },
};

function ProgressBar({ value }: { value: number }) {
  const barColor = value > 80 ? 'bg-danger-500' : value > 60 ? 'bg-warning-500' : 'bg-brand-500';
  return (
    <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${barColor}`}
        style={{ width: `${Math.min(value, 100)}%` }}
      />
    </div>
  );
}

function EmptyState({ icon: Icon, title, description, actionLabel, actionHref }: {
  icon: typeof Container;
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center mb-4">
        <Icon className="w-6 h-6 text-white/20" />
      </div>
      <p className="text-sm font-medium text-white/50 mb-1">{title}</p>
      <p className="text-xs text-white/25 mb-4 max-w-[250px]">{description}</p>
      {actionLabel && actionHref && (
        <Link
          href={actionHref}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-400 hover:text-brand-300 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          {actionLabel}
        </Link>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const { data: stats, isLoading: statsLoading } = trpc.dashboard.stats.useQuery(undefined, { retry: 1 });
  const { data: recentDeployments, isLoading: deploysLoading } = trpc.deployment.listRecent.useQuery({ limit: 5 }, { retry: 1 });
  const { data: nodesData, isLoading: nodesLoading } = trpc.node.list.useQuery(undefined, { retry: 1 });

  const statItems = [
    { label: 'Total Services', value: stats?.totalServices ?? 0, icon: Container, accent: 'from-brand-500/20 to-brand-600/10' },
    { label: 'Active Nodes', value: stats?.activeNodes ?? 0, icon: Server, accent: 'from-success-500/20 to-success-500/5' },
    { label: 'Deployments (24h)', value: stats?.recentDeployments ?? 0, icon: Rocket, accent: 'from-accent-500/20 to-accent-500/5' },
    { label: 'Active Domains', value: stats?.activeDomains ?? 0, icon: Globe, accent: 'from-brand-400/20 to-brand-500/5' },
  ];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-white/40 mt-1">Overview of your infrastructure and deployments</p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statItems.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="metric-card glass-card-hover">
              <div className="flex items-center justify-between mb-3">
                <p className="metric-label">{stat.label}</p>
                <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${stat.accent} flex items-center justify-center`}>
                  <Icon className="w-4 h-4 text-brand-400" />
                </div>
              </div>
              <div className="flex items-end gap-2">
                <p className="metric-value">
                  {statsLoading ? (
                    <span className="inline-block w-8 h-7 bg-white/5 rounded animate-pulse" />
                  ) : (
                    stat.value
                  )}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Recent Deployments */}
        <div className="xl:col-span-2">
          <div className="glass-card h-full">
            <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold">Recent Deployments</h2>
                <p className="text-[11px] text-white/30 mt-0.5">Latest deployment activity</p>
              </div>
              <Link href="/dashboard/deployments" className="text-xs text-brand-400 hover:text-brand-300 font-medium transition-colors flex items-center gap-1">
                View All <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            {deploysLoading ? (
              <div className="p-5 space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-12 bg-white/5 rounded-lg animate-pulse" />
                ))}
              </div>
            ) : !recentDeployments?.items || recentDeployments.items.length === 0 ? (
              <EmptyState
                icon={Rocket}
                title="No deployments yet"
                description="Deploy your first service to see activity here"
                actionLabel="New Project"
                actionHref="/dashboard/projects"
              />
            ) : (
              <div className="divide-y divide-white/[0.03]">
                {recentDeployments.items.map((deploy: any) => {
                  const statusInfo = statusConfig[deploy.deployStatus] || statusConfig.failed;
                  const StatusIcon = statusInfo.icon;
                  return (
                    <div
                      key={deploy.id}
                      onClick={() => deploy.service?.projectId && router.push(`/dashboard/projects/${deploy.service.projectId}/services/${deploy.serviceId}`)}
                      className="px-5 py-3.5 flex items-center gap-4 hover:bg-white/[0.02] transition-colors cursor-pointer group"
                    >
                      <div className={`${statusInfo.dot}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-white/90">{deploy.service?.name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/30 font-mono">
                            {deploy.commitSha?.slice(0, 7) || '-'}
                          </span>
                        </div>
                        <p className="text-[11px] text-white/30 mt-0.5">
                          {deploy.service?.project?.name} · {deploy.branch} · {deploy.triggeredBy}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={`flex items-center gap-1.5 text-xs font-medium justify-end ${statusInfo.class}`}>
                          <StatusIcon className="w-3.5 h-3.5" />
                          {statusInfo.label}
                        </div>
                        <p className="text-[10px] text-white/20 mt-0.5">
                          {formatDistanceToNow(new Date(deploy.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Node Overview */}
        <div>
          <div className="glass-card h-full">
            <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold">Cluster Nodes</h2>
                <p className="text-[11px] text-white/30 mt-0.5">{nodesData?.length ?? 0} nodes</p>
              </div>
              <Link href="/dashboard/nodes" className="text-xs text-brand-400 hover:text-brand-300 font-medium transition-colors flex items-center gap-1">
                Manage <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="p-4">
              {nodesLoading ? (
                <div className="space-y-3">
                  {[...Array(2)].map((_, i) => (
                    <div key={i} className="h-28 bg-white/5 rounded-lg animate-pulse" />
                  ))}
                </div>
              ) : !nodesData || nodesData.length === 0 ? (
                <EmptyState
                  icon={Server}
                  title="No nodes connected"
                  description="Add your first server node to start deploying"
                  actionLabel="Add Node"
                  actionHref="/dashboard/nodes"
                />
              ) : (
                <div className="space-y-4">
                  {nodesData.slice(0, 4).map((node: any) => {
                    const r = (node.resources as any) || {};
                    const cpu = r.cpuUsage || 0;
                    const memo = r.memoryTotal && r.memoryUsed ? Math.round((r.memoryUsed / r.memoryTotal) * 100) : 0;
                    const disk = r.diskTotal && r.diskUsed ? Math.round((r.diskUsed / r.diskTotal) * 100) : 0;
                    return (
                      <div
                        key={node.id}
                        onClick={() => router.push(`/dashboard/nodes/${node.id}`)}
                        className="glass-card p-3 glass-card-hover cursor-pointer"
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <span className={`status-dot ${node.status === 'online' ? 'status-running' : node.status === 'offline' ? 'status-failed' : 'status-stopped'}`} />
                            <span className="text-xs font-medium text-white/80">{node.name}</span>
                          </div>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/30 font-medium capitalize">
                            {node.role}
                          </span>
                        </div>
                        <div className="space-y-2.5">
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-1.5 text-[10px] text-white/30">
                                <Cpu className="w-3 h-3" /> CPU
                              </div>
                              <span className="text-[10px] font-mono text-white/50">{cpu}%</span>
                            </div>
                            <ProgressBar value={cpu} />
                          </div>
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-1.5 text-[10px] text-white/30">
                                <MemoryStick className="w-3 h-3" /> Memory
                              </div>
                              <span className="text-[10px] font-mono text-white/50">{memo}%</span>
                            </div>
                            <ProgressBar value={memo} />
                          </div>
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-1.5 text-[10px] text-white/30">
                                <HardDrive className="w-3 h-3" /> Disk
                              </div>
                              <span className="text-[10px] font-mono text-white/50">{disk}%</span>
                            </div>
                            <ProgressBar value={disk} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
