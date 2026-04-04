'use client';

import { useState } from 'react';
import {
  Plus,
  Server,
  Cpu,
  MemoryStick,
  HardDrive,
  Shield,
  Clock,
  Terminal,
  MoreVertical,
  Wifi,
  WifiOff,
  Wrench,
  Key,
  Loader2,
  CheckCircle,
  Copy,
} from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { formatDistanceToNow } from 'date-fns';
import { SlideOver, FormField, FormInput, FormSelect } from '@/components/slide-over';
import Link from 'next/link';

function ProgressBar({ value, size = 'md' }: { value: number; size?: 'sm' | 'md' }) {
  const barColor = value > 80 ? 'bg-danger-500' : value > 60 ? 'bg-warning-500' : 'bg-brand-500';
  const h = size === 'sm' ? 'h-1' : 'h-1.5';
  return (
    <div className={`w-full ${h} bg-white/5 rounded-full overflow-hidden`}>
      <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${Math.min(value, 100)}%` }} />
    </div>
  );
}

const statusConfig: Record<string, { icon: typeof Wifi; class: string; bg: string; label: string }> = {
  online: { icon: Wifi, class: 'text-success-400', bg: 'bg-success-500/10 border-success-500/20', label: 'Online' },
  offline: { icon: WifiOff, class: 'text-danger-400', bg: 'bg-danger-500/10 border-danger-500/20', label: 'Offline' },
  maintenance: { icon: Wrench, class: 'text-warning-500', bg: 'bg-warning-500/10 border-warning-500/20', label: 'Maintenance' },
};

const roleColors: Record<string, string> = {
  manager: 'from-brand-500/20 to-brand-600/10 border-brand-500/10',
  worker: 'from-success-500/20 to-success-600/10 border-success-500/10',
  build: 'from-accent-500/20 to-accent-600/10 border-accent-500/10',
};

export default function NodesPage() {
  const { data: nodes, isLoading, refetch } = trpc.node.list.useQuery(undefined, { retry: 1 });
  const { data: clusterStats } = trpc.node.clusterStats.useQuery(undefined, { retry: 1 });
  const [showAddNode, setShowAddNode] = useState(false);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Nodes</h1>
          <p className="text-sm text-white/40 mt-1">Manage your infrastructure nodes</p>
        </div>
        <button onClick={() => setShowAddNode(true)} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Add Node
        </button>
      </div>

      {/* Cluster Stats */}
      {clusterStats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-8">
          {[
            { label: 'Total', value: clusterStats.total },
            { label: 'Online', value: clusterStats.online },
            { label: 'Offline', value: clusterStats.offline },
            { label: 'Maintenance', value: clusterStats.maintenance },
            { label: 'Managers', value: clusterStats.managers },
            { label: 'Workers', value: clusterStats.workers },
            { label: 'Builders', value: clusterStats.buildServers },
          ].map((s) => (
            <div key={s.label} className="glass-card px-4 py-3 text-center">
              <p className="text-lg font-bold text-white">{s.value}</p>
              <p className="text-[10px] text-white/30 uppercase tracking-wider">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="glass-card h-52 animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty */}
      {!isLoading && (!nodes || nodes.length === 0) && (
        <div className="glass-card flex flex-col items-center justify-center py-20">
          <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-5">
            <Server className="w-8 h-8 text-white/20" />
          </div>
          <h3 className="text-sm font-semibold text-white/60 mb-1">No nodes connected</h3>
          <p className="text-xs text-white/30 mb-6 max-w-sm text-center">
            Add your first server node to start deploying. You&apos;ll need SSH access to the target machine.
          </p>
          <button onClick={() => setShowAddNode(true)} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Add First Node
          </button>
        </div>
      )}

      {/* Node Cards */}
      {!isLoading && nodes && nodes.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {nodes.map((node: any) => {
            const status = statusConfig[node.status] || statusConfig.offline;
            const StatusIcon = status.icon;
            const r = (node.resources as any) || {};
            const cpu = r.cpuUsage || 0;
            const memPct = r.memoryTotal && r.memoryUsed ? Math.round((r.memoryUsed / r.memoryTotal) * 100) : 0;
            const diskPct = r.diskTotal && r.diskUsed ? Math.round((r.diskUsed / r.diskTotal) * 100) : 0;
            const memGb = r.memoryTotal ? (r.memoryTotal / 1073741824).toFixed(0) : '-';
            const diskGb = r.diskTotal ? (r.diskTotal / 1073741824).toFixed(0) : '-';

            return (
              <Link href={`/dashboard/nodes/${node.id}`} key={node.id} className="glass-card glass-card-hover cursor-pointer group block">
                <div className="px-5 py-4 flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${roleColors[node.role] || roleColors.worker} flex items-center justify-center border mt-0.5`}>
                      <Server className="w-5 h-5 text-white/70" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-white">{node.name}</h3>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${status.bg}`}>
                          {status.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="text-[11px] text-white/30">{node.host}:{node.port} · {node.role}</span>
                        {node.canBuild && <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-accent-500/10 text-accent-400 border border-accent-500/15">Build</span>}
                        {node.canDeploy && <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-brand-500/10 text-brand-400 border border-brand-500/15">Deploy</span>}
                        {node.dockerVersion && <span className="text-[10px] text-white/20 ml-1">Docker {node.dockerVersion}</span>}
                      </div>
                    </div>
                  </div>
                  <button className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-white/5 rounded">
                    <MoreVertical className="w-3.5 h-3.5 text-white/30" />
                  </button>
                </div>
                <div className="px-5 pb-4 space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5 text-[10px] text-white/30"><Cpu className="w-3 h-3" /> CPU ({r.cpuCores || '-'} cores)</div>
                      <span className="text-[10px] font-mono text-white/50">{cpu}%</span>
                    </div>
                    <ProgressBar value={cpu} />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5 text-[10px] text-white/30"><MemoryStick className="w-3 h-3" /> Memory ({memGb} GB)</div>
                      <span className="text-[10px] font-mono text-white/50">{memPct}%</span>
                    </div>
                    <ProgressBar value={memPct} />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5 text-[10px] text-white/30"><HardDrive className="w-3 h-3" /> Disk ({diskGb} GB)</div>
                      <span className="text-[10px] font-mono text-white/50">{diskPct}%</span>
                    </div>
                    <ProgressBar value={diskPct} />
                  </div>
                </div>
                <div className="px-5 py-3 border-t border-white/[0.03] flex items-center justify-between">
                  <div className="flex items-center gap-3 text-[10px] text-white/25">
                    <span className="flex items-center gap-1"><Shield className="w-3 h-3" />{node.sshKey?.name || 'No SSH key'}</span>
                    {node.lastHeartbeatAt && (
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatDistanceToNow(new Date(node.lastHeartbeatAt), { addSuffix: true })}</span>
                    )}
                  </div>
                  <Terminal className="w-3.5 h-3.5 text-white/15 group-hover:text-white/30 transition-colors" />
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Add Node SlideOver */}
      <AddNodeSlideOver
        open={showAddNode}
        onClose={() => setShowAddNode(false)}
        onSuccess={() => {
          setShowAddNode(false);
          refetch();
        }}
      />
    </div>
  );
}

// ── Add Node SlideOver ───────────────────────────────────────

function AddNodeSlideOver({ open, onClose, onSuccess }: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { data: sshKeys } = trpc.sshKey.list.useQuery(undefined, { enabled: open });
  const generateKey = trpc.sshKey.generate.useMutation();
  const createNode = trpc.node.create.useMutation();
  const injectKey = trpc.node.injectKey.useMutation();

  const [step, setStep] = useState<'key' | 'node'>('key');
  const [selectedKeyId, setSelectedKeyId] = useState('');
  const [generatedPublicKey, setGeneratedPublicKey] = useState('');
  const [keyName, setKeyName] = useState('');
  const [copied, setCopied] = useState(false);

  // Node form
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [sshUser, setSshUser] = useState('root');
  const [role, setRole] = useState<'manager' | 'worker' | 'build'>('manager');
  const [serverPassword, setServerPassword] = useState('');

  // Reset on close
  const handleClose = () => {
    setStep('key');
    setSelectedKeyId('');
    setGeneratedPublicKey('');
    setKeyName('');
    setName('');
    setHost('');
    setPort('22');
    setSshUser('root');
    setRole('manager');
    setServerPassword('');
    setCopied(false);
    onClose();
  };

  const handleGenerateKey = () => {
    const keyLabel = keyName || `key-${Date.now()}`;
    generateKey.mutate({ name: keyLabel }, {
      onSuccess: (data) => {
        setSelectedKeyId(data.id);
        setGeneratedPublicKey(data.publicKey ?? '');
        setKeyName(keyLabel);
      },
    });
  };

  const copyPublicKey = () => {
    navigator.clipboard.writeText(generatedPublicKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCreateNode = async () => {
    const finalKeyId = selectedKeyId;
    if (!finalKeyId || !name || !host) return;

    // If password provided, auto-inject the SSH key first
    if (serverPassword) {
      try {
        await injectKey.mutateAsync({
          host,
          port: parseInt(port),
          username: sshUser,
          password: serverPassword,
          sshKeyId: finalKeyId,
        });
      } catch (err: any) {
        // Show error but don't block — user can still try
        console.error('Key injection failed:', err);
      }
    }

    createNode.mutate({
      name,
      host,
      port: parseInt(port),
      sshUser,
      sshKeyId: finalKeyId,
      role,
    }, {
      onSuccess: () => {
        onSuccess();
        handleClose();
      },
    });
  };

  const hasKeys = sshKeys && sshKeys.length > 0;

  return (
    <SlideOver
      open={open}
      onClose={handleClose}
      title="Add Node"
      description="Connect a server to your Click-Deploy cluster"
      width="md"
    >
      {step === 'key' && (
        <div className="space-y-6">
          <div className="bg-brand-500/5 border border-brand-500/10 rounded-lg p-4">
            <p className="text-xs text-white/50">
              <span className="text-white/70 font-medium">Step 1:</span> Select an existing key or generate a new one. The same key works for all nodes — just add the public key to each server&apos;s <code className="text-brand-400">~/.ssh/authorized_keys</code>.
            </p>
          </div>

          {/* Existing keys */}
          {hasKeys && (
            <div>
              <p className="text-xs font-medium text-white/60 mb-2">Existing SSH Keys</p>
              <div className="space-y-2">
                {sshKeys.map((key: any) => (
                  <button
                    key={key.id}
                    onClick={() => { setSelectedKeyId(key.id); setStep('node'); }}
                    className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                      selectedKeyId === key.id
                        ? 'bg-brand-500/10 border-brand-500/30 text-white'
                        : 'bg-white/[0.02] border-white/[0.05] text-white/60 hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Key className="w-3.5 h-3.5" />
                      <span className="text-sm font-medium">{key.name}</span>
                    </div>
                    {key.fingerprint && <p className="text-[10px] text-white/30 mt-1 font-mono">{key.fingerprint}</p>}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="relative">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/[0.06]" /></div>
            <div className="relative flex justify-center"><span className="bg-[var(--bg-card)] px-3 text-[10px] text-white/25 uppercase tracking-wider">or generate new</span></div>
          </div>

          {/* Generate key */}
          <div className="space-y-3">
            <FormField label="Key Name">
              <FormInput
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                placeholder="e.g. production-server"
              />
            </FormField>

            <button
              onClick={handleGenerateKey}
              disabled={generateKey.isPending}
              className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {generateKey.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Key className="w-4 h-4" />
              )}
              {generateKey.isPending ? 'Generating...' : 'Generate Ed25519 Key'}
            </button>
          </div>

          {/* Show generated public key */}
          {generatedPublicKey && (
            <div className="space-y-3 animate-fade-in">
              <div className="flex items-center gap-2 text-xs text-emerald-400">
                <CheckCircle className="w-3.5 h-3.5" />
                Key generated! Add the public key to your server:
              </div>
              <div className="relative">
                <pre className="bg-black/60 border border-white/10 rounded-lg p-3 text-[11px] text-white/70 font-mono overflow-x-auto whitespace-pre-wrap break-all max-h-24">
                  {generatedPublicKey}
                </pre>
                <button
                  onClick={copyPublicKey}
                  className="absolute top-2 right-2 p-1.5 rounded bg-white/5 hover:bg-white/10 transition-colors"
                  title="Copy public key"
                >
                  {copied ? <CheckCircle className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-white/40" />}
                </button>
              </div>

              <div className="bg-amber-500/5 border border-amber-500/10 rounded-lg p-3 space-y-2">
                <p className="text-[11px] text-amber-400/80 font-medium">Run this on each server you want to add:</p>
                <div className="relative">
                  <pre className="bg-black/40 rounded p-2 text-[10px] text-white/60 font-mono overflow-x-auto whitespace-pre-wrap break-all">
{`mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo "${generatedPublicKey}" >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`}
                  </pre>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo "${generatedPublicKey}" >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    className="absolute top-1 right-1 p-1 rounded bg-white/5 hover:bg-white/10 transition-colors"
                    title="Copy install command"
                  >
                    <Copy className="w-3 h-3 text-white/30" />
                  </button>
                </div>
                <p className="text-[10px] text-white/25">This same key works for all your nodes — run it once on each server.</p>
              </div>

              <button
                onClick={() => setStep('node')}
                className="btn-primary w-full"
              >
                Continue → Add Node Details
              </button>
            </div>
          )}
        </div>
      )}

      {step === 'node' && (
        <div className="space-y-5">
          <div className="bg-brand-500/5 border border-brand-500/10 rounded-lg p-4">
            <p className="text-xs text-white/50">
              <span className="text-white/70 font-medium">Step 2:</span> Enter the server connection details. We&apos;ll auto-test SSH connectivity and Docker status.
            </p>
          </div>

          <FormField label="Node Name" hint="A friendly name for this server">
            <FormInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. prod-server-1" />
          </FormField>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <FormField label="Host / IP">
                <FormInput value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.100 or server.example.com" />
              </FormField>
            </div>
            <FormField label="Port">
              <FormInput type="number" value={port} onChange={(e) => setPort(e.target.value)} />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="SSH User">
              <FormInput value={sshUser} onChange={(e) => setSshUser(e.target.value)} />
            </FormField>
            <FormField label="Role">
              <FormSelect value={role} onChange={(e) => setRole(e.target.value as any)}>
                <option value="manager">Manager</option>
                <option value="worker">Worker</option>
                <option value="build">Build Server</option>
              </FormSelect>
            </FormField>
          </div>

          {/* Optional password for auto key injection */}
          <FormField
            label="Server Password (optional)"
            hint="One-time use — we'll auto-install the SSH key, then discard the password"
          >
            <FormInput
              type="password"
              value={serverPassword}
              onChange={(e) => setServerPassword(e.target.value)}
              placeholder="Leave empty if key is already installed"
            />
          </FormField>

          {injectKey.isError && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-xs text-amber-400">
              ⚠ Key injection failed: {injectKey.error?.message}. Make sure the password is correct.
            </div>
          )}

          {injectKey.isPending && (
            <div className="bg-brand-500/10 border border-brand-500/20 rounded-lg p-3 text-xs text-brand-400 flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin" />
              Installing SSH key on server...
            </div>
          )}

          {createNode.isError && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-400">
              ✗ {createNode.error?.message}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button onClick={() => setStep('key')} className="px-4 py-2.5 rounded-lg border border-white/10 text-sm text-white/60 hover:bg-white/5 transition-colors">
              Back
            </button>
            <button
              onClick={handleCreateNode}
              disabled={!name || !host || createNode.isPending}
              className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {createNode.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Server className="w-4 h-4" />
              )}
              {createNode.isPending ? 'Connecting...' : 'Add Node & Test Connection'}
            </button>
          </div>
        </div>
      )}
    </SlideOver>
  );
}
