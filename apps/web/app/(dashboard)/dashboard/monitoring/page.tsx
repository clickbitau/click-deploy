'use client';

import { useState, useEffect } from 'react';
import {
  Activity,
  Cpu,
  MemoryStick,
  HardDrive,
  Network,
  RefreshCw,
  Server,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
} from 'lucide-react';
import { trpc } from '@/lib/trpc';

function ProgressRing({ value, size = 80, stroke = 6, color = '#22d3ee' }: { value: number; size?: number; stroke?: number; color?: string }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;
  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
        className="transition-all duration-700"
      />
    </svg>
  );
}

function ProgressBar({ value }: { value: number }) {
  const barColor = value > 80 ? 'bg-danger-500' : value > 60 ? 'bg-warning-500' : 'bg-brand-500';
  return (
    <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
      <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${Math.min(value, 100)}%` }} />
    </div>
  );
}

type NodeResourceInfo = {
  cpuCores?: number;
  cpuUsage?: number;
  memoryTotal?: number;
  memoryUsed?: number;
  diskTotal?: number;
  diskUsed?: number;
};

export default function MonitoringPage() {
  const { data: nodes, isLoading, refetch } = trpc.node.list.useQuery(undefined, { retry: 1, refetchInterval: 30000 });
  const { data: clusterStats } = trpc.node.clusterStats.useQuery(undefined, { retry: 1, refetchInterval: 30000 });

  const [timeStr, setTimeStr] = useState('--:--:--');
  useEffect(() => {
    const update = () => setTimeStr(new Date().toLocaleTimeString([], { hour12: false }));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  // Aggregate metrics from real node data — CPU weighted by core count
  const allNodes = (nodes || []) as Array<{ resources: NodeResourceInfo | null }>;
  const totalCores = allNodes.reduce((sum, n) => sum + (n.resources?.cpuCores ?? 1), 0);
  const weightedCpuSum = allNodes.reduce((sum, n) => {
    const cores = n.resources?.cpuCores ?? 1;
    const usage = n.resources?.cpuUsage ?? 0;
    return sum + (usage * cores);
  }, 0);
  const aggregateCpu = totalCores > 0 ? Math.round(weightedCpuSum / totalCores) : 0;
  const totalMem = allNodes.reduce((sum, n) => sum + (n.resources?.memoryTotal ?? 0), 0);
  const usedMem = allNodes.reduce((sum, n) => sum + (n.resources?.memoryUsed ?? 0), 0);
  const memPct = totalMem > 0 ? Math.round((usedMem / totalMem) * 100) : 0;
  const totalDisk = allNodes.reduce((sum, n) => sum + (n.resources?.diskTotal ?? 0), 0);
  const usedDisk = allNodes.reduce((sum, n) => sum + (n.resources?.diskUsed ?? 0), 0);
  const diskPct = totalDisk > 0 ? Math.round((usedDisk / totalDisk) * 100) : 0;

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const gb = bytes / (1024 ** 3);
    if (gb >= 1) return `${gb.toFixed(1)} GB`;
    const mb = bytes / (1024 ** 2);
    return `${mb.toFixed(0)} MB`;
  };

  const ringColor = (pct: number) => pct > 80 ? '#ef4444' : pct > 60 ? '#f59e0b' : '#22d3ee';

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Monitoring</h1>
          <p className="text-sm text-white/40 mt-1">Real-time resource monitoring and cluster health</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-white/25 flex items-center gap-1.5">
            <span className="status-dot status-running" style={{ width: 6, height: 6 }} />
            Live · Updated {timeStr}
          </span>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-2 px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {/* Aggregate Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-4 gap-4 mb-8">
        {/* CPU */}
        <div className="glass-card p-5 flex items-center gap-5">
          <div className="relative">
            <ProgressRing value={aggregateCpu} color={ringColor(aggregateCpu)} />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-lg font-bold">{aggregateCpu}%</span>
            </div>
          </div>
          <div>
            <p className="text-xs text-white/40 uppercase tracking-wider font-medium">CPU Usage</p>
            <p className="text-[11px] text-white/25 mt-1">
              {totalCores} cores across {allNodes.length} nodes
            </p>
          </div>
        </div>

        {/* Memory */}
        <div className="glass-card p-5 flex items-center gap-5">
          <div className="relative">
            <ProgressRing value={memPct} color={ringColor(memPct)} />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-lg font-bold">{memPct}%</span>
            </div>
          </div>
          <div>
            <p className="text-xs text-white/40 uppercase tracking-wider font-medium">Memory</p>
            <p className="text-[11px] text-white/25 mt-1">
              {formatBytes(usedMem)} / {formatBytes(totalMem)}
            </p>
          </div>
        </div>

        {/* Disk */}
        <div className="glass-card p-5 flex items-center gap-5">
          <div className="relative">
            <ProgressRing value={diskPct} color={ringColor(diskPct)} />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-lg font-bold">{diskPct}%</span>
            </div>
          </div>
          <div>
            <p className="text-xs text-white/40 uppercase tracking-wider font-medium">Disk</p>
            <p className="text-[11px] text-white/25 mt-1">
              {formatBytes(usedDisk)} / {formatBytes(totalDisk)}
            </p>
          </div>
        </div>

        {/* Cluster Health */}
        <div className="glass-card p-5">
          <p className="text-xs text-white/40 uppercase tracking-wider font-medium mb-3">Cluster Health</p>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-white/40">Online</span>
              <span className="text-success-400 font-medium">{clusterStats?.online ?? 0}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-white/40">Offline</span>
              <span className="text-danger-400 font-medium">{clusterStats?.offline ?? 0}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-white/40">Maintenance</span>
              <span className="text-warning-500 font-medium">{clusterStats?.maintenance ?? 0}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Per-Node Resources */}
      <div className="glass-card">
        <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Node Resources</h2>
            <p className="text-[11px] text-white/30 mt-0.5">Per-node CPU, memory, and disk utilization</p>
          </div>
          <div className="flex items-center gap-3 text-[10px]">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-success-500" /> Healthy</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-warning-500" /> Warning</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-danger-500" /> Critical</span>
          </div>
        </div>

        {isLoading && (
          <div className="p-5 space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-24 bg-white/5 rounded-lg animate-pulse" />
            ))}
          </div>
        )}

        {!isLoading && allNodes.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16">
            <Server className="w-10 h-10 text-white/15 mb-3" />
            <p className="text-sm text-white/40">No nodes to monitor</p>
            <p className="text-xs text-white/20 mt-1">Add nodes to see real-time resource metrics</p>
          </div>
        )}

        {!isLoading && allNodes.length > 0 && (
          <div className="divide-y divide-white/[0.03]">
            {allNodes.map((node: any) => {
              const r = (node.resources as any) || {};
              const cpu = r.cpuUsage || 0;
              const mem = r.memoryTotal && r.memoryUsed ? Math.round((r.memoryUsed / r.memoryTotal) * 100) : 0;
              const disk = r.diskTotal && r.diskUsed ? Math.round((r.diskUsed / r.diskTotal) * 100) : 0;
              const statusDot = node.status === 'online' ? 'bg-success-500' : node.status === 'offline' ? 'bg-danger-500' : 'bg-warning-500';

              return (
                <div key={node.id} className="px-5 py-4 hover:bg-white/[0.02] transition-colors">
                  <div className="flex items-center gap-3 mb-3">
                    <Server className="w-4 h-4 text-white/30" />
                    <span className="text-sm font-medium text-white/80">{node.name}</span>
                    <span className={`w-2 h-2 rounded-full ${statusDot}`} />
                  </div>
                  <div className="grid grid-cols-3 gap-6">
                    <div>
                      <div className="flex justify-between mb-1">
                        <span className="text-[10px] text-white/30">CPU <span className="text-white/15">({r.cpuCores || '?'} cores)</span></span>
                        <span className="text-[10px] font-mono text-white/50">{cpu}%</span>
                      </div>
                      <ProgressBar value={cpu} />
                    </div>
                    <div>
                      <div className="flex justify-between mb-1">
                        <span className="text-[10px] text-white/30">MEM</span>
                        <span className="text-[10px] font-mono text-white/50">{mem}%</span>
                      </div>
                      <ProgressBar value={mem} />
                    </div>
                    <div>
                      <div className="flex justify-between mb-1">
                        <span className="text-[10px] text-white/30">DISK</span>
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
  );
}
