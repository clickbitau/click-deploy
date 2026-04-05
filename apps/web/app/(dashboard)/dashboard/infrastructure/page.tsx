'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Server, RefreshCw, Activity, Layers, Cpu } from 'lucide-react';

export default function InfrastructurePage() {
  const [autoRefresh, setAutoRefresh] = useState(true);

  const { data: nodes, isLoading: nodesLoading, refetch: refetchNodes } = trpc.infra.getSwarmNodes.useQuery(
    undefined,
    { refetchInterval: autoRefresh ? 15000 : false }
  );

  const { data: services, isLoading: servicesLoading, refetch: refetchServices } = trpc.infra.getServiceHealth.useQuery(
    undefined,
    { refetchInterval: autoRefresh ? 15000 : false }
  );

  const handleRefresh = () => {
    refetchNodes();
    refetchServices();
  };

  const getServiceStatusColor = (replicas: string) => {
    if (!replicas) return 'bg-white/20';
    const [running, desired] = replicas.split('/').map(Number);
    if (running === 0 && desired > 0) return 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]';
    if (running < desired) return 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)] animate-pulse';
    return 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]';
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-500/10 flex items-center justify-center border border-brand-500/20">
            <Server className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white/90">Infrastructure Health</h1>
            <p className="text-sm text-white/40">Live Swarm cluster operations and service state</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-3 py-1.5 rounded-lg border text-sm flex items-center gap-2 transition-colors ${
              autoRefresh
                ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                : 'border-white/10 text-white/40 hover:bg-white/5'
            }`}
          >
            {autoRefresh && <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />}
            {autoRefresh ? 'Auto-refreshing (15s)' : 'Auto-refresh Paused'}
          </button>
          <button
            onClick={handleRefresh}
            className="px-3 py-1.5 rounded-lg border border-white/10 text-sm text-white/60 hover:bg-white/5 transition-colors flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${(nodesLoading || servicesLoading) ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Nodes Section */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-white/80">
          <Cpu className="w-4 h-4 text-brand-400" />
          <h2 className="text-lg font-semibold">Swarm Nodes</h2>
        </div>
        
        {nodesLoading && !nodes ? (
          <div className="h-32 glass-card flex items-center justify-center text-white/40">Loading nodes...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {nodes?.map((node: any) => (
              <div key={node.id} className="glass-card p-5 space-y-3 relative overflow-hidden group">
                <div className="absolute top-0 left-0 w-1 h-full bg-brand-500/30 transition-colors group-hover:bg-brand-500" />
                
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-white/90 text-lg flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${node.status === 'Ready' ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]'}`} />
                    {node.hostname}
                  </h3>
                  {node.managerStatus && (
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                      node.managerStatus === 'Leader' ? 'bg-brand-500/20 text-brand-400 border border-brand-500/30' :
                      node.managerStatus === 'Reachable' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' :
                      'bg-red-500/20 text-red-500 border border-red-500/30'
                    }`}>
                      {node.managerStatus}
                    </span>
                  )}
                </div>
                
                <div className="flex items-center justify-between text-xs text-white/50 border-t border-white/5 pt-3">
                  <span className="font-mono">{node.id.substring(0, 12)}</span>
                  <span className="flex items-center gap-1">
                    v{node.engineVersion}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Services Section */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-white/80">
          <Layers className="w-4 h-4 text-brand-400" />
          <h2 className="text-lg font-semibold">Live Services</h2>
        </div>

        <div className="glass-card overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-white/40 uppercase bg-black/20 border-b border-white/5">
              <tr>
                <th className="px-6 py-4 font-medium">Status</th>
                <th className="px-6 py-4 font-medium">Service Name</th>
                <th className="px-6 py-4 font-medium">Mode</th>
                <th className="px-6 py-4 font-medium">Replicas</th>
                <th className="px-6 py-4 font-medium">Image</th>
                <th className="px-6 py-4 font-medium">Ports</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {servicesLoading && !services ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-white/40">Loading services...</td>
                </tr>
              ) : services?.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-white/40">No services active</td>
                </tr>
              ) : (
                services?.map((svc: any) => (
                  <tr key={svc.name} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-6 py-3">
                      <div className={`w-3 h-3 rounded-full ${getServiceStatusColor(svc.replicas)}`} />
                    </td>
                    <td className="px-6 py-3 font-medium text-white/80">{svc.name}</td>
                    <td className="px-6 py-3 text-white/50">
                      <span className="px-2 py-1 rounded bg-black/30 border border-white/5 text-[10px] uppercase">
                        {svc.mode}
                      </span>
                    </td>
                    <td className="px-6 py-3 font-mono text-white/70">{svc.replicas}</td>
                    <td className="px-6 py-3 text-white/50 text-xs max-w-[200px] truncate" title={svc.image}>
                      {svc.image.split('@')[0]}
                    </td>
                    <td className="px-6 py-3 text-white/50 text-xs font-mono">{svc.ports || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
