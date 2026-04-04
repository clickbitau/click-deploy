'use client';

import { useState } from 'react';
import {
  Rocket,
  CheckCircle2,
  XCircle,
  Clock,
  GitBranch,
  GitCommit,
  RotateCcw,
  Loader2,
  Play,
  Container,
  StopCircle,
  Timer,
  Hash,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { formatDistanceToNow } from 'date-fns';
import { SlideOver, FormField, FormSelect } from '@/components/slide-over';
import Link from 'next/link';

const statusConfig: Record<string, { icon: typeof CheckCircle2; class: string; bg: string; label: string }> = {
  running: { icon: CheckCircle2, class: 'text-success-400', bg: 'bg-success-500/10 text-success-400', label: 'Running' },
  built: { icon: CheckCircle2, class: 'text-success-400', bg: 'bg-success-500/10 text-success-400', label: 'Built' },
  deploying: { icon: Clock, class: 'text-warning-500', bg: 'bg-warning-500/10 text-warning-500', label: 'Deploying' },
  building: { icon: Clock, class: 'text-warning-500', bg: 'bg-warning-500/10 text-warning-500', label: 'Building' },
  pending: { icon: Clock, class: 'text-white/40', bg: 'bg-white/5 text-white/40', label: 'Pending' },
  failed: { icon: XCircle, class: 'text-danger-400', bg: 'bg-danger-500/10 text-danger-400', label: 'Failed' },
  cancelled: { icon: XCircle, class: 'text-white/30', bg: 'bg-white/5 text-white/30', label: 'Cancelled' },
};

function formatDuration(ms: number): string {
  if (ms <= 0) return '-';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

const PAGE_SIZE = 10;

export default function DeploymentsPage() {
  const [page, setPage] = useState(0);
  const { data, isLoading, refetch } = trpc.deployment.listRecent.useQuery(
    { limit: PAGE_SIZE, offset: page * PAGE_SIZE },
    { retry: 1, refetchInterval: (query) => {
      const d = query.state.data;
      if (d?.items?.some((dep: any) => ['building', 'deploying', 'pending'].includes(dep.deployStatus))) return 3000;
      return false;
    }}
  );
  const deployments = data?.items;
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const [showTrigger, setShowTrigger] = useState(false);
  const rollback = trpc.deployment.rollback.useMutation();
  const cancelDeploy = trpc.deployment.cancel.useMutation();
  const [rollingBackId, setRollingBackId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [confirmingCancelId, setConfirmingCancelId] = useState<string | null>(null);

  const handleRollback = (deployId: string, serviceId: string) => {
    setRollingBackId(deployId);
    rollback.mutate({ serviceId, targetDeploymentId: deployId }, {
      onSuccess: () => { setRollingBackId(null); refetch(); },
      onError: () => setRollingBackId(null),
    });
  };

  const handleCancelClick = (e: React.MouseEvent, deployId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setConfirmingCancelId(deployId);
  };

  const handleCancelConfirm = (e: React.MouseEvent, deployId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setConfirmingCancelId(null);
    setCancellingId(deployId);
    cancelDeploy.mutate({ id: deployId }, {
      onSuccess: () => { setCancellingId(null); refetch(); },
      onError: () => setCancellingId(null),
    });
  };

  const handleCancelDismiss = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setConfirmingCancelId(null);
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Deployments</h1>
          <p className="text-sm text-white/40 mt-1">Track and manage all deployments</p>
        </div>
        <button onClick={() => setShowTrigger(true)} className="btn-primary flex items-center gap-2">
          <Play className="w-4 h-4" />
          Manual Deploy
        </button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="glass-card">
          <div className="space-y-0 divide-y divide-white/[0.03]">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="px-5 py-4 flex items-center gap-4">
                <div className="w-2 h-2 rounded-full bg-white/5" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-4 w-48 bg-white/5 rounded animate-pulse" />
                  <div className="h-3 w-64 bg-white/5 rounded animate-pulse" />
                </div>
                <div className="h-6 w-20 bg-white/5 rounded animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty */}
      {!isLoading && (!deployments || deployments.length === 0) && total === 0 && (
        <div className="glass-card flex flex-col items-center justify-center py-20">
          <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-5">
            <Rocket className="w-8 h-8 text-white/20" />
          </div>
          <h3 className="text-sm font-semibold text-white/60 mb-1">No deployments yet</h3>
          <p className="text-xs text-white/30 mb-6 max-w-sm text-center">
            Deployments will appear here when you deploy a service. Push to GitHub or trigger a manual deploy.
          </p>
          <button onClick={() => setShowTrigger(true)} className="btn-primary flex items-center gap-2">
            <Play className="w-4 h-4" />
            Trigger Deploy
          </button>
        </div>
      )}

      {/* Deployment List */}
      {!isLoading && deployments && deployments.length > 0 && (
        <div className="glass-card">
          <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
            <p className="text-xs text-white/30">
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total} deployments
            </p>
          </div>
          <div className="divide-y divide-white/[0.03]">
            {deployments.map((deploy: any, index: number) => {
              const deployStatus = statusConfig[deploy.deployStatus] || statusConfig.pending;
              const DeployIcon = deployStatus.icon;
              const canRollback = deploy.deployStatus === 'running' || deploy.buildStatus === 'built';
              const isActive = ['building', 'deploying', 'pending'].includes(deploy.deployStatus);
              const totalDuration = (deploy.buildDurationMs || 0) + (deploy.deployDurationMs || 0);
              return (
                <Link href={`/dashboard/deployments/${deploy.id}`} key={deploy.id} className="px-5 py-4 hover:bg-white/[0.02] transition-colors group block">
                  <div className="flex items-start gap-4">
                    {/* Number + Status */}
                    <div className="flex items-center gap-3 pt-0.5 shrink-0">
                      <span className="text-xs text-white/15 font-mono w-5 text-right">{page * PAGE_SIZE + index + 1}.</span>
                      <div className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-md border ${
                        deploy.deployStatus === 'running' ? 'bg-success-500/10 border-success-500/20 text-success-400' :
                        deploy.deployStatus === 'failed' ? 'bg-danger-500/10 border-danger-500/20 text-danger-400' :
                        isActive ? 'bg-warning-500/10 border-warning-500/20 text-warning-500' :
                        deploy.deployStatus === 'cancelled' ? 'bg-white/5 border-white/10 text-white/30' :
                        'bg-white/5 border-white/10 text-white/40'
                      }`}>
                        {isActive ? <Loader2 className="w-3 h-3 animate-spin" /> : <DeployIcon className="w-3 h-3" />}
                        {deploy.deployStatus === 'running' ? 'done' : deploy.deployStatus === 'failed' ? 'error' : deployStatus.label.toLowerCase()}
                      </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      {/* Commit message */}
                      <CommitMessage message={deploy.commitMessage} />

                      {/* Meta row */}
                      <div className="flex items-center gap-3 mt-1.5 text-[11px] text-white/25">
                        {deploy.commitSha && (
                          <span className="font-mono flex items-center gap-1">
                            <GitCommit className="w-3 h-3" />
                            {deploy.commitSha.slice(0, 12)}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <GitBranch className="w-3 h-3" />
                          {deploy.branch || 'main'}
                        </span>
                        <span>{deploy.service?.name}</span>
                      </div>
                    </div>

                    {/* Right side: time + duration + actions */}
                    <div className="flex items-center gap-3 shrink-0">
                      {/* Cancel — active deployments */}
                      {isActive && confirmingCancelId === deploy.id ? (
                        <div className="flex items-center gap-1.5" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                          <span className="text-[10px] text-white/40">Kill build?</span>
                          <button
                            onClick={(e) => handleCancelConfirm(e, deploy.id)}
                            className="px-2 py-0.5 rounded bg-danger-500/20 border border-danger-500/30 text-danger-400 text-[10px] font-semibold hover:bg-danger-500/30 transition-colors"
                          >Yes</button>
                          <button
                            onClick={handleCancelDismiss}
                            className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-white/40 text-[10px] font-semibold hover:bg-white/10 transition-colors"
                          >No</button>
                        </div>
                      ) : isActive && (
                        <button
                          onClick={(e) => handleCancelClick(e, deploy.id)}
                          disabled={cancellingId === deploy.id}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-danger-500/10 border border-danger-500/20 text-danger-400 hover:bg-danger-500/20 transition-all text-[11px] font-medium disabled:opacity-50"
                          title="Cancel deployment"
                        >
                          {cancellingId === deploy.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <StopCircle className="w-3 h-3" />
                          )}
                          Cancel
                        </button>
                      )}

                      {/* Rollback — completed deployments */}
                      {canRollback && (
                        <button
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleRollback(deploy.id, deploy.serviceId); }}
                          disabled={rollingBackId === deploy.id}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 hover:bg-white/5 rounded-lg text-white/30 hover:text-white/60 disabled:opacity-50"
                          title="Rollback to this version"
                        >
                          {rollingBackId === deploy.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <RotateCcw className="w-3.5 h-3.5" />
                          )}
                        </button>
                      )}

                      {/* Time + Duration column */}
                      <div className="text-right min-w-[80px]">
                        <p className="text-[11px] text-white/25">
                          {deploy.createdAt ? formatDistanceToNow(new Date(deploy.createdAt), { addSuffix: true }) : '-'}
                        </p>
                        {totalDuration > 0 && (
                          <p className="text-[10px] text-white/15 font-mono flex items-center gap-1 justify-end mt-0.5">
                            <Timer className="w-2.5 h-2.5" />
                            {formatDuration(totalDuration)}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="px-5 py-3 border-t border-white/5 flex items-center justify-between">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="flex items-center gap-1 text-xs text-white/40 hover:text-white/70 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Previous
              </button>
              <div className="flex items-center gap-1">
                {Array.from({ length: totalPages }, (_, i) => (
                  <button
                    key={i}
                    onClick={() => setPage(i)}
                    className={`w-7 h-7 rounded-md text-xs font-medium transition-colors ${
                      i === page
                        ? 'bg-brand-500/20 text-brand-400 border border-brand-500/30'
                        : 'text-white/30 hover:text-white/60 hover:bg-white/5'
                    }`}
                  >{i + 1}</button>
                ))}
              </div>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="flex items-center gap-1 text-xs text-white/40 hover:text-white/70 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Next <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      )}
      {/* Trigger Deploy SlideOver */}
      <TriggerDeploySlideOver
        open={showTrigger}
        onClose={() => setShowTrigger(false)}
        onSuccess={() => { setShowTrigger(false); refetch(); }}
      />
    </div>
  );
}

// ── Commit Message with Show More ────────────────────────────

function CommitMessage({ message }: { message?: string | null }) {
  const [expanded, setExpanded] = useState(false);
  if (!message) return <p className="text-sm text-white/40 italic">No commit message</p>;

  const maxLen = 120;
  const isLong = message.length > maxLen;
  const displayText = isLong && !expanded ? message.slice(0, maxLen) + '...' : message;

  return (
    <div>
      <p className="text-sm text-white/70 leading-relaxed whitespace-pre-line">{displayText}</p>
      {isLong && (
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setExpanded(!expanded); }}
          className="text-[11px] text-brand-400/60 hover:text-brand-400 mt-0.5 transition-colors"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

// ── Trigger Deploy SlideOver ─────────────────────────────────

function TriggerDeploySlideOver({ open, onClose, onSuccess }: {
  open: boolean; onClose: () => void; onSuccess: () => void;
}) {
  const { data: projects } = trpc.project.list.useQuery(undefined, { enabled: open });
  const triggerDeploy = trpc.deployment.trigger.useMutation();
  const [serviceId, setServiceId] = useState('');

  const handleClose = () => { setServiceId(''); onClose(); };

  const handleDeploy = () => {
    if (!serviceId) return;
    triggerDeploy.mutate({ serviceId }, {
      onSuccess: () => { handleClose(); onSuccess(); },
    });
  };

  const allServices = (projects || []).flatMap((p: any) =>
    (p.services || []).map((s: any) => ({
      id: s.id,
      name: s.name,
      projectName: p.name,
      sourceType: s.sourceType,
    }))
  );

  return (
    <SlideOver open={open} onClose={handleClose} title="Manual Deploy" description="Trigger a fresh deploy for a service">
      <div className="space-y-5">
        <div className="bg-brand-500/5 border border-brand-500/10 rounded-lg p-4">
          <p className="text-xs text-white/50">
            This will pull the latest code from the configured branch, build a new container image, and deploy it via rolling update.
          </p>
        </div>

        <FormField label="Service">
          <FormSelect value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            <option value="">Select a service to deploy...</option>
            {allServices.map((s: any) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.projectName}) — {s.sourceType}
              </option>
            ))}
          </FormSelect>
          {allServices.length === 0 && (
            <p className="text-[11px] text-amber-400/70 mt-1.5">
              ⚠ No services found. Create a project and service first.
            </p>
          )}
        </FormField>

        {triggerDeploy.isError && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-400">
            ✗ {triggerDeploy.error?.message}
          </div>
        )}

        <button
          onClick={handleDeploy}
          disabled={!serviceId || triggerDeploy.isPending}
          className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {triggerDeploy.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
          {triggerDeploy.isPending ? 'Deploying...' : 'Deploy Now'}
        </button>
      </div>
    </SlideOver>
  );
}
