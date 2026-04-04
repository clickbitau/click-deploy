'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Clock,
  Terminal,
  Rocket,
  GitBranch,
  Loader2,
  Copy,
  StopCircle,
  Timer,
} from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { formatDistanceToNow, format } from 'date-fns';
import { useState, useEffect, useRef } from 'react';

const statusConfig: Record<string, { icon: typeof CheckCircle2; class: string; label: string; bg: string }> = {
  running: { icon: CheckCircle2, class: 'text-success-400', bg: 'bg-success-500/10 border-success-500/20', label: 'Running' },
  built: { icon: CheckCircle2, class: 'text-success-400', bg: 'bg-success-500/10 border-success-500/20', label: 'Built' },
  deployed: { icon: CheckCircle2, class: 'text-success-400', bg: 'bg-success-500/10 border-success-500/20', label: 'Deployed' },
  deploying: { icon: Clock, class: 'text-warning-500', bg: 'bg-warning-500/10 border-warning-500/20', label: 'Deploying' },
  building: { icon: Clock, class: 'text-warning-500', bg: 'bg-warning-500/10 border-warning-500/20', label: 'Building' },
  pending: { icon: Clock, class: 'text-white/40', bg: 'bg-white/5 border-white/10', label: 'Pending' },
  failed: { icon: XCircle, class: 'text-danger-400', bg: 'bg-danger-500/10 border-danger-500/20', label: 'Failed' },
  cancelled: { icon: XCircle, class: 'text-white/30', bg: 'bg-white/5 border-white/10', label: 'Cancelled' },
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

function CancelButton({ deploymentId, onCancel }: { deploymentId: string; onCancel: () => void }) {
  const utils = trpc.useUtils();
  const cancelDeploy = trpc.deployment.cancel.useMutation({
    onSuccess: () => {
      utils.deployment.byId.invalidate({ id: deploymentId });
      onCancel();
    },
  });

  const handleCancel = () => {
    if (!confirm('Cancel this deployment? Any in-progress build will be killed.')) return;
    cancelDeploy.mutate({ id: deploymentId });
  };

  return (
    <button
      onClick={handleCancel}
      disabled={cancelDeploy.isPending}
      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-danger-500/10 border border-danger-500/20 text-danger-400 hover:bg-danger-500/20 transition-all text-sm font-medium disabled:opacity-50"
    >
      {cancelDeploy.isPending ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <StopCircle className="w-4 h-4" />
      )}
      {cancelDeploy.isPending ? 'Cancelling...' : 'Cancel'}
    </button>
  );
}

function LogViewer({ title, logs, icon: Icon }: { title: string; logs: string | null | undefined; icon: typeof Terminal }) {
  const [copied, setCopied] = useState(false);
  const lines = logs ? logs.split('\n') : [];

  const handleCopy = () => {
    if (logs) {
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(logs).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      } else {
        // Fallback for non-HTTPS connections
        const textArea = document.createElement("textarea");
        textArea.value = logs;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
          document.execCommand('copy');
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch (err) {
          console.error('Fallback: Oops, unable to copy', err);
        }
        document.body.removeChild(textArea);
      }
    }
  };

  return (
    <div className="glass-card overflow-hidden">
      <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-brand-400" />
          <h3 className="text-sm font-semibold">{title}</h3>
          <span className="text-[10px] text-white/20">{lines.length} lines</span>
        </div>
        {logs && (
          <button onClick={handleCopy} className="text-xs text-white/30 hover:text-white/50 flex items-center gap-1 transition-colors">
            <Copy className="w-3 h-3" />
            {copied ? 'Copied!' : 'Copy'}
          </button>
        )}
      </div>
      {lines.length > 0 ? (
        <LogScrollArea lines={lines} />
      ) : (
        <div className="py-12 text-center">
          <Terminal className="w-6 h-6 text-white/10 mx-auto mb-2" />
          <p className="text-xs text-white/20">No logs available</p>
        </div>
      )}
    </div>
  );
}

function LogScrollArea({ lines }: { lines: string[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevLenRef = useRef(0);

  useEffect(() => {
    // Auto-scroll to bottom when new lines appear
    if (lines.length > prevLenRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
    prevLenRef.current = lines.length;
  }, [lines.length]);

  return (
    <div ref={containerRef} className="max-h-[500px] overflow-y-auto p-4 bg-black/40">
      <pre className="text-[11px] leading-5 font-mono text-white/60 whitespace-pre-wrap break-words">
        {lines.map((line, i) => (
          <div key={i} className="flex hover:bg-white/[0.02] transition-colors">
            <span className="text-white/15 select-none w-10 shrink-0 text-right pr-3 text-[10px] leading-5">{i + 1}</span>
            <span className={`flex-1 ${
              line.includes('ERROR') || line.includes('error') ? 'text-danger-400' :
              line.includes('WARNING') || line.includes('warn') ? 'text-warning-500' :
              line.includes('SUCCESS') || line.includes('✓') || line.includes('done') ? 'text-success-400' :
              line.startsWith('+') ? 'text-success-400' :
              line.startsWith('-') ? 'text-danger-400' :
              'text-white/60'
            }`}>
              {line || '\u00A0'}
            </span>
          </div>
        ))}
      </pre>
    </div>
  );
}

export default function DeploymentDetailPage() {
  const params = useParams();
  const deploymentId = params.deploymentId as string;

  const isActive = (d: any) =>
    d && ['building', 'deploying', 'pending'].includes(d.deployStatus);

  const { data: deployment, isLoading } = trpc.deployment.byId.useQuery(
    { id: deploymentId },
    {
      retry: 1,
      enabled: !!deploymentId,
      refetchInterval: (query) => {
        const d = query.state.data;
        return isActive(d) ? 2000 : false;
      },
    }
  );

  if (isLoading || !deployment) {
    return (
      <div className="space-y-6">
        <div className="h-10 w-64 bg-white/5 rounded-lg animate-pulse" />
        <div className="h-96 glass-card animate-pulse" />
      </div>
    );
  }

  const buildSt = statusConfig[deployment.buildStatus] || statusConfig.pending;
  const deploySt = statusConfig[deployment.deployStatus] || statusConfig.pending;
  const BuildIcon = buildSt.icon;
  const DeployIcon = deploySt.icon;

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-6">
        <Link
          href="/dashboard/deployments"
          className="inline-flex items-center gap-1.5 text-xs text-white/30 hover:text-white/50 transition-colors mb-4"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Deployments
        </Link>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-500/20 to-brand-600/10 flex items-center justify-center border border-brand-500/10">
              <Rocket className="w-6 h-6 text-brand-400" />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-bold tracking-tight font-mono">
                  {deployment.commitSha?.slice(0, 7) || deployment.id.slice(0, 8)}
                </h1>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${deploySt.bg} ${deploySt.class}`}>
                  {deploySt.label}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-xs text-white/40">{deployment.service?.name || '-'}</span>
                {deployment.branch && (
                  <span className="flex items-center gap-1 text-[11px] text-white/25">
                    <GitBranch className="w-3 h-3" />{deployment.branch}
                  </span>
                )}
                <span className="text-[11px] text-white/25">
                  {deployment.triggeredBy} · {deployment.createdAt ? formatDistanceToNow(new Date(deployment.createdAt), { addSuffix: true }) : '-'}
                </span>
              </div>
            </div>
          </div>

          {/* Cancel button — only on active deployments */}
          {isActive(deployment) && (
            <CancelButton deploymentId={deployment.id} onCancel={() => {}} />
          )}
        </div>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="glass-card p-4">
          <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Build Status</p>
          <div className={`flex items-center gap-2 ${buildSt.class}`}>
            <BuildIcon className="w-4 h-4" />
            <span className="text-sm font-semibold">{buildSt.label}</span>
          </div>
        </div>
        <div className="glass-card p-4">
          <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Deploy Status</p>
          <div className={`flex items-center gap-2 ${deploySt.class}`}>
            <DeployIcon className="w-4 h-4" />
            <span className="text-sm font-semibold">{deploySt.label}</span>
          </div>
        </div>
        <div className="glass-card p-4">
          <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Commit</p>
          <p className="text-sm font-mono text-white/60">{deployment.commitSha?.slice(0, 12) || '-'}</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Triggered</p>
          <p className="text-sm text-white/60">
            {deployment.createdAt ? format(new Date(deployment.createdAt), 'HH:mm:ss · MMM d') : '-'}
          </p>
        </div>
        <div className="glass-card p-4">
          <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Duration</p>
          <div className="flex items-center gap-1.5">
            <Timer className="w-3.5 h-3.5 text-white/30" />
            <span className="text-sm font-mono text-white/60">
              {deployment.buildDurationMs || deployment.deployDurationMs
                ? formatDuration((deployment.buildDurationMs || 0) + (deployment.deployDurationMs || 0))
                : isActive(deployment) ? 'In progress...' : '-'}
            </span>
          </div>
        </div>
      </div>

      {/* Commit message */}
      {deployment.commitMessage && (
        <div className="glass-card p-4 mb-6">
          <p className="text-[10px] text-white/25 uppercase tracking-wider mb-1">Commit Message</p>
          <p className="text-sm text-white/60">{deployment.commitMessage}</p>
        </div>
      )}

      {/* Logs — unified stream */}
      <LogViewer
        title="Deployment Logs"
        logs={[deployment.buildLogs, deployment.deployLogs].filter(Boolean).join('\n') || null}
        icon={Terminal}
      />

      {/* Metadata */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
        {deployment.buildNode && (
          <div className="glass-card p-4">
            <p className="text-[10px] text-white/25 uppercase tracking-wider mb-2">Build Node</p>
            <p className="text-sm text-white/60">{deployment.buildNode.name}</p>
          </div>
        )}
        {deployment.deployNode && (
          <div className="glass-card p-4">
            <p className="text-[10px] text-white/25 uppercase tracking-wider mb-2">Deploy Node</p>
            <p className="text-sm text-white/60">{deployment.deployNode.name}</p>
          </div>
        )}
      </div>
    </div>
  );
}
