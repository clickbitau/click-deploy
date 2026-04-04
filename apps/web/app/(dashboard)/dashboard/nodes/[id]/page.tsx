'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Server,
  Cpu,
  MemoryStick,
  HardDrive,
  Shield,
  Clock,
  Terminal,
  Wifi,
  WifiOff,
  Wrench,
  Key,
  Loader2,
  Trash2,
  Settings2,
  Globe,
  MapPin,
  Cloud,
  XCircle,
  RefreshCw,
  Container,
  Edit2,
  Check,
} from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { formatDistanceToNow } from 'date-fns';
import { SlideOver, FormField, FormInput, FormSelect } from '@/components/slide-over';
import { useConfirm } from '@/components/confirm-dialog';

function ProgressRing({ value, size = 80, strokeWidth = 6, color }: {
  value: number; size?: number; strokeWidth?: number; color: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(value, 100) / 100) * circumference;
  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={strokeWidth} />
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth}
        strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset}
        className="transition-all duration-700" />
    </svg>
  );
}

const statusConfig: Record<string, { icon: typeof Wifi; class: string; bg: string; label: string }> = {
  online: { icon: Wifi, class: 'text-success-400', bg: 'bg-success-500/10 border-success-500/20', label: 'Online' },
  offline: { icon: WifiOff, class: 'text-danger-400', bg: 'bg-danger-500/10 border-danger-500/20', label: 'Offline' },
  maintenance: { icon: Wrench, class: 'text-warning-500', bg: 'bg-warning-500/10 border-warning-500/20', label: 'Maintenance' },
};

const roleColors: Record<string, string> = {
  manager: 'bg-brand-500/10 text-brand-400 border-brand-500/20',
  worker: 'bg-success-500/10 text-success-400 border-success-500/20',
  build: 'bg-accent-500/10 text-accent-400 border-accent-500/20',
};

export default function NodeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const nodeId = params.id as string;

  const { data: node, isLoading, refetch } = trpc.node.byId.useQuery(
    { id: nodeId },
    { retry: 1, enabled: !!nodeId }
  );
  const deleteNode = trpc.node.delete.useMutation();
  const testConn = trpc.node.testConnectivity.useMutation();

  const [tab, setTab] = useState<'overview' | 'services' | 'ssh'>('overview');
  const [showEdit, setShowEdit] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState('');
  const updateNode = trpc.node.update.useMutation();

  const handleUpdateName = async () => {
    if (!newName.trim() || newName.trim() === node?.name) {
      setEditingName(false);
      return;
    }
    await updateNode.mutateAsync({ id: nodeId, name: newName.trim() });
    setEditingName(false);
    refetch();
  };

  const confirm = useConfirm();

  const handleDelete = async () => {
    const ok = await confirm({ title: 'Remove Node', message: 'Remove this node from the cluster? Services already running on it will not be affected.', confirmText: 'Remove Node', variant: 'danger' });
    if (!ok) return;
    deleteNode.mutate({ id: nodeId }, {
      onSuccess: () => router.push('/dashboard/nodes'),
    });
  };

  const handleTestConnection = () => {
    setTesting(true);
    setTestResult(null);
    testConn.mutate({ id: nodeId }, {
      onSuccess: (data: any) => { setTesting(false); setTestResult({ success: data.success, message: data.message || 'Connected' }); },
      onError: (err: any) => { setTesting(false); setTestResult({ success: false, message: err.message }); },
    });
  };

  if (isLoading || !node) {
    return (
      <div className="space-y-6">
        <div className="h-10 w-64 bg-white/5 rounded-lg animate-pulse" />
        <div className="h-64 glass-card animate-pulse" />
      </div>
    );
  }

  const resources: Record<string, any> = (node.resources as Record<string, any>) || {};
  const status = statusConfig[node.status] || statusConfig.offline;
  const StatusIcon = status.icon;

  const cpuUsage = resources.cpuUsage ?? 0;
  
  const memTotalBytes = resources.memoryTotal ?? 0;
  const memUsedBytes = resources.memoryUsed ?? 0;
  const memUsage = memTotalBytes > 0 ? (memUsedBytes / memTotalBytes) * 100 : 0;
  const memoryGb = memTotalBytes > 0 ? (memTotalBytes / (1024 * 1024 * 1024)).toFixed(1) : undefined;
  
  const diskTotalBytes = resources.diskTotal ?? 0;
  const diskUsedBytes = resources.diskUsed ?? 0;
  const diskUsage = diskTotalBytes > 0 ? (diskUsedBytes / diskTotalBytes) * 100 : 0;
  const diskGb = diskTotalBytes > 0 ? (diskTotalBytes / (1024 * 1024 * 1024)).toFixed(1) : undefined;

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'services', label: 'Services' },
    { key: 'ssh', label: 'SSH & Connection' },
  ];

  return (
    <div>
      {/* Breadcrumb + Header */}
      <div className="mb-6">
        <Link
          href="/dashboard/nodes"
          className="inline-flex items-center gap-1.5 text-xs text-white/30 hover:text-white/50 transition-colors mb-4"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Nodes
        </Link>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${
              node.role === 'manager' ? 'from-brand-500/20 to-brand-600/10 border-brand-500/10' :
              node.role === 'build' ? 'from-accent-500/20 to-accent-600/10 border-accent-500/10' :
              'from-success-500/20 to-success-600/10 border-success-500/10'
            } flex items-center justify-center border`}>
              <Server className="w-6 h-6 text-white/60" />
            </div>
            <div>
              <div className="flex items-center gap-3">
                {editingName ? (
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleUpdateName()}
                      className="bg-black/40 border border-brand-500/30 rounded px-2 py-1 text-xl font-bold tracking-tight text-white focus:outline-none focus:border-brand-500 w-48"
                    />
                    <button onClick={handleUpdateName} disabled={updateNode.isPending} className="p-1 hover:bg-white/10 rounded text-brand-400">
                      {updateNode.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    </button>
                    <button onClick={() => setEditingName(false)} className="p-1 hover:bg-white/10 rounded text-white/40">
                      <XCircle className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 group cursor-pointer" onClick={() => { setNewName(node.name); setEditingName(true); }}>
                    <h1 className="text-2xl font-bold tracking-tight">{node.name}</h1>
                    <Edit2 className="w-4 h-4 text-white/0 group-hover:text-white/30 transition-colors" />
                  </div>
                )}
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${status.bg} ${status.class}`}>
                  <StatusIcon className="w-3 h-3 inline mr-1" />{status.label}
                </span>
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border capitalize ${roleColors[node.role] || roleColors.worker}`}>
                  {node.role}
                </span>
              </div>
              {node.description && (
                <p className="text-sm text-white/40 mt-0.5">{node.description}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleTestConnection}
              disabled={testing}
              className="btn-primary flex items-center gap-2 text-xs"
            >
              {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Test Connection
            </button>
            <button onClick={handleDelete}
              className="p-2 hover:bg-red-500/10 rounded-lg transition-colors text-white/30 hover:text-danger-400"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Connection test result */}
        {testResult && (
          <div className={`mt-3 px-4 py-2 rounded-lg text-xs flex items-center gap-2 ${
            testResult.success
              ? 'bg-success-500/10 border border-success-500/20 text-success-400'
              : 'bg-danger-500/10 border border-danger-500/20 text-danger-400'
          }`}>
            {testResult.success ? '✓' : '✗'} {testResult.message}
          </div>
        )}
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
        <div className="space-y-6">
          {/* Resource Rings */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'CPU', value: cpuUsage, total: resources.cpuCores ? `${resources.cpuCores} cores` : '-', color: 'var(--color-brand-400, #38bdf8)' },
              { label: 'Memory', value: memUsage, total: memoryGb ? `${memoryGb} GB` : '-', color: 'var(--color-accent-400, #a78bfa)' },
              { label: 'Disk', value: diskUsage, total: diskGb ? `${diskGb} GB` : '-', color: 'var(--color-success-400, #4ade80)' },
            ].map((metric: { label: string; value: number; total: string; color: string }) => (
              <div key={metric.label} className="glass-card p-5 flex flex-col items-center">
                <div className="relative mb-3">
                  <ProgressRing value={metric.value} color={metric.color} />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-lg font-bold">{Math.round(metric.value)}%</span>
                  </div>
                </div>
                <p className="text-xs font-medium text-white/60">{metric.label}</p>
                <p className="text-[10px] text-white/25">{metric.total}</p>
              </div>
            ))}
          </div>

          {/* Node Info Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="glass-card p-5">
              <h3 className="text-xs text-white/40 uppercase tracking-wider font-medium mb-4">Connection</h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-xs text-white/30">Host</span>
                  <span className="text-xs text-white/60 font-mono">{node.host}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-white/30">Port</span>
                  <span className="text-xs text-white/60 font-mono">{node.port}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-white/30">SSH User</span>
                  <span className="text-xs text-white/60 font-mono">{node.sshUser}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-white/30">SSH Key</span>
                  <span className="text-xs text-white/60 flex items-center gap-1">
                    <Key className="w-3 h-3" />
                    {node.sshKey?.name || '-'}
                  </span>
                </div>
              </div>
            </div>

            <div className="glass-card p-5">
              <h3 className="text-xs text-white/40 uppercase tracking-wider font-medium mb-4">Infrastructure</h3>
              <div className="space-y-3">
                {resources.region && (
                  <div className="flex justify-between">
                    <span className="text-xs text-white/30">Region</span>
                    <span className="text-xs text-white/60 flex items-center gap-1">
                      <MapPin className="w-3 h-3" />{String(resources.region)}
                    </span>
                  </div>
                )}
                {resources.provider && (
                  <div className="flex justify-between">
                    <span className="text-xs text-white/30">Provider</span>
                    <span className="text-xs text-white/60 capitalize flex items-center gap-1">
                      <Cloud className="w-3 h-3" />{String(resources.provider)}
                    </span>
                  </div>
                )}
                {resources.datacenter && (
                  <div className="flex justify-between">
                    <span className="text-xs text-white/30">Datacenter</span>
                    <span className="text-xs text-white/60">{String(resources.datacenter)}</span>
                  </div>
                )}
                {resources.networkType && (
                  <div className="flex justify-between">
                    <span className="text-xs text-white/30">Network</span>
                    <span className="text-xs text-white/60 capitalize">{String(resources.networkType)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-xs text-white/30">Last Heartbeat</span>
                  <span className="text-xs text-white/60">
                    {node.lastHeartbeatAt ? formatDistanceToNow(new Date(node.lastHeartbeatAt), { addSuffix: true }) : 'Never'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-white/30">Added</span>
                  <span className="text-xs text-white/60">
                    {node.createdAt ? formatDistanceToNow(new Date(node.createdAt), { addSuffix: true }) : '-'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Node Capabilities */}
          <NodeCapabilities node={node} onUpdate={() => refetch()} />

          {/* Labels */}
          {node.labels && Object.keys(node.labels as object).length > 0 && (
            <div className="glass-card p-5">
              <h3 className="text-xs text-white/40 uppercase tracking-wider font-medium mb-3">Labels</h3>
              <div className="flex flex-wrap gap-2">
                {Object.entries(node.labels as Record<string, string>).map(([key, value]) => (
                  <span key={key} className="text-[11px] px-2.5 py-1 rounded-md bg-white/[0.03] border border-white/[0.06] text-white/50">
                    <span className="text-white/30">{key}:</span> {value}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Services Tab ──────────────────────────────── */}
      {tab === 'services' && (
        <div className="glass-card flex flex-col items-center justify-center py-16">
          <Container className="w-10 h-10 text-white/15 mb-3" />
          <p className="text-sm text-white/40">Services deployed to this node</p>
          <p className="text-xs text-white/20 mt-1">Services assigned to this node will appear here once deployed</p>
        </div>
      )}

      {/* ── SSH Tab ────────────────────────────────────── */}
      {tab === 'ssh' && (
        <div className="space-y-4 max-w-xl">
          <div className="glass-card p-5">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <Terminal className="w-4 h-4 text-brand-400" />
              Quick Connect
            </h3>
            <div className="bg-black/40 rounded-lg p-4 font-mono text-xs text-white/60 border border-white/5">
              <span className="text-white/25">$</span> ssh {node.sshUser}@{node.host} -p {node.port}
              {node.sshKey?.name && <span className="text-white/25"> -i ~/.ssh/{String(node.sshKey.name)}</span>}
            </div>
          </div>

          <div className="glass-card p-5">
            <h3 className="text-sm font-semibold mb-4">SSH Key</h3>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-xs text-white/30">Key Name</span>
                <span className="text-xs text-white/60">{node.sshKey?.name || '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-white/30">Fingerprint</span>
                <span className="text-xs text-white/60 font-mono text-[10px]">{node.sshKey?.fingerprint || '-'}</span>
              </div>
            </div>
          </div>

          <div className="glass-card p-5">
            <h3 className="text-sm font-semibold mb-4">Connection Status</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs text-white/30">Status</span>
                <span className={`text-xs font-medium flex items-center gap-1.5 ${status.class}`}>
                  <StatusIcon className="w-3 h-3" />{status.label}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-white/30">Last Heartbeat</span>
                <span className="text-xs text-white/60">
                  {node.lastHeartbeatAt ? formatDistanceToNow(new Date(node.lastHeartbeatAt), { addSuffix: true }) : 'Never'}
                </span>
              </div>
            </div>
            <button
              onClick={handleTestConnection}
              disabled={testing}
              className="btn-primary w-full mt-4 flex items-center justify-center gap-2 text-xs"
            >
              {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              {testing ? 'Testing...' : 'Test Connection Now'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Node Capabilities Toggle ─────────────────────────────────

function NodeCapabilities({ node, onUpdate }: { node: any; onUpdate: () => void }) {
  const updateNode = trpc.node.update.useMutation();

  const toggle = (field: 'canBuild' | 'canDeploy') => {
    updateNode.mutate(
      { id: node.id, [field]: !node[field] },
      { onSuccess: () => onUpdate() }
    );
  };

  return (
    <div className="glass-card p-5">
      <h3 className="text-xs text-white/40 uppercase tracking-wider font-medium mb-4">Node Capabilities</h3>
      <div className="grid grid-cols-2 gap-4">
        <button
          onClick={() => toggle('canBuild')}
          disabled={updateNode.isPending}
          className={`p-4 rounded-lg border transition-all text-left ${
            node.canBuild
              ? 'bg-accent-500/10 border-accent-500/20'
              : 'bg-white/[0.02] border-white/[0.06] opacity-50'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-white/80">Build</span>
            <div className={`w-8 h-4 rounded-full transition-colors ${node.canBuild ? 'bg-accent-500' : 'bg-white/10'}`}>
              <div className={`w-3.5 h-3.5 rounded-full bg-white shadow transition-transform mt-[1px] ${node.canBuild ? 'translate-x-4' : 'translate-x-[1px]'}`} />
            </div>
          </div>
          <p className="text-[10px] text-white/30">Can build Docker/nixpacks images</p>
        </button>

        <button
          onClick={() => toggle('canDeploy')}
          disabled={updateNode.isPending}
          className={`p-4 rounded-lg border transition-all text-left ${
            node.canDeploy
              ? 'bg-brand-500/10 border-brand-500/20'
              : 'bg-white/[0.02] border-white/[0.06] opacity-50'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-white/80">Deploy</span>
            <div className={`w-8 h-4 rounded-full transition-colors ${node.canDeploy ? 'bg-brand-500' : 'bg-white/10'}`}>
              <div className={`w-3.5 h-3.5 rounded-full bg-white shadow transition-transform mt-[1px] ${node.canDeploy ? 'translate-x-4' : 'translate-x-[1px]'}`} />
            </div>
          </div>
          <p className="text-[10px] text-white/30">Can run deployed services</p>
        </button>
      </div>
    </div>
  );
}
