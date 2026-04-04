'use client';

import { useState } from 'react';
import {
  Plus,
  Cloud,
  Route,
  Trash2,
  Loader2,
  MoreVertical,
  X,
} from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { SlideOver, FormField, FormInput, FormSelect } from '@/components/slide-over';
import { useConfirm } from '@/components/confirm-dialog';

const statusStyle: Record<string, string> = {
  active: 'bg-success-500/10 text-success-400 border-success-500/20',
  inactive: 'bg-white/5 text-white/30 border-white/10',
  error: 'bg-danger-500/10 text-danger-400 border-danger-500/20',
};

export default function TunnelsPage() {
  const { data: tunnels, isLoading, refetch } = trpc.tunnel.list.useQuery(undefined, { retry: 1 });
  const [showCreate, setShowCreate] = useState(false);
  const deleteTunnel = trpc.tunnel.delete.useMutation();
  const removeRoute = trpc.tunnel.removeRoute.useMutation();
  const confirm = useConfirm();

  const handleDeleteTunnel = async (id: string) => {
    const ok = await confirm({ title: 'Delete Tunnel', message: 'This will remove the tunnel and all its routes. The cloudflared connector will be stopped.', confirmText: 'Delete', variant: 'danger' });
    if (!ok) return;
    deleteTunnel.mutate({ id }, { onSuccess: () => refetch() });
  };

  const handleRemoveRoute = async (routeId: string) => {
    const ok = await confirm({ title: 'Remove Route', message: 'This will remove this ingress route from the tunnel.', confirmText: 'Remove', variant: 'warning' });
    if (!ok) return;
    removeRoute.mutate({ routeId }, { onSuccess: () => refetch() });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Tunnels</h1>
          <p className="text-sm text-white/40 mt-1">Cloudflare Tunnel connections for secure ingress</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Create Tunnel
        </button>
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="glass-card h-44 animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && (!tunnels || tunnels.length === 0) && (
        <div className="glass-card flex flex-col items-center justify-center py-20">
          <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-5">
            <Cloud className="w-8 h-8 text-white/20" />
          </div>
          <h3 className="text-sm font-semibold text-white/60 mb-1">No tunnels configured</h3>
          <p className="text-xs text-white/30 mb-6 max-w-sm text-center">
            Create a Cloudflare Tunnel to securely expose services without opening ports. Requires a Cloudflare account.
          </p>
          <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Create Tunnel
          </button>
        </div>
      )}

      {!isLoading && tunnels && tunnels.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {tunnels.map((tunnel: any) => (
            <div key={tunnel.id} className="glass-card glass-card-hover group">
              <div className="px-5 py-4 flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-accent-500/20 to-accent-600/10 flex items-center justify-center border border-accent-500/10 mt-0.5">
                    <Cloud className="w-5 h-5 text-accent-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">{tunnel.name}</h3>
                    <p className="text-[11px] text-white/30 mt-0.5">
                      {tunnel.node?.name || 'Unassigned'} · {tunnel.cloudflareAccountId || 'No CF account'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${statusStyle[tunnel.status] || statusStyle.inactive}`}>
                    {tunnel.status}
                  </span>
                  <button
                    onClick={() => handleDeleteTunnel(tunnel.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-red-500/10 rounded"
                    title="Delete tunnel"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-danger-400" />
                  </button>
                </div>
              </div>
              <div className="px-5 pb-4">
                <p className="text-[10px] text-white/25 uppercase tracking-wider mb-2">Routes ({tunnel.routes?.length || 0})</p>
                {tunnel.routes && tunnel.routes.length > 0 ? (
                  <div className="space-y-1.5">
                    {tunnel.routes.map((route: any) => (
                      <div key={route.id} className="flex items-center gap-2 text-[11px] text-white/40 px-2 py-1 bg-white/[0.02] rounded group/route">
                        <Route className="w-3 h-3 text-white/20" />
                        <span className="font-mono">{route.hostname}</span>
                        <span className="text-white/15">→</span>
                        <span className="font-mono text-white/25 flex-1">{route.service}</span>
                        <button
                          onClick={() => handleRemoveRoute(route.id)}
                          className="opacity-0 group-hover/route:opacity-100 transition-opacity p-0.5 hover:bg-red-500/10 rounded"
                          title="Remove route"
                        >
                          <X className="w-3 h-3 text-danger-400" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-white/20">No routes configured</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <CreateTunnelSlideOver
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSuccess={() => { setShowCreate(false); refetch(); }}
      />
    </div>
  );
}

// ── Create Tunnel SlideOver ──────────────────────────────────

function CreateTunnelSlideOver({ open, onClose, onSuccess }: {
  open: boolean; onClose: () => void; onSuccess: () => void;
}) {
  const { data: nodesList } = trpc.node.list.useQuery(undefined, { enabled: open });
  const createTunnel = trpc.tunnel.create.useMutation();

  const [name, setName] = useState('');
  const [nodeId, setNodeId] = useState('');
  const [cfAccountId, setCfAccountId] = useState('');

  const handleClose = () => {
    setName(''); setNodeId(''); setCfAccountId('');
    onClose();
  };

  const handleCreate = () => {
    if (!name || !nodeId) return;
    createTunnel.mutate({
      name,
      nodeId,
      cloudflareAccountId: cfAccountId || undefined,
    }, {
      onSuccess: () => { handleClose(); onSuccess(); },
    });
  };

  const nodes = nodesList || [];

  return (
    <SlideOver open={open} onClose={handleClose} title="Create Tunnel" description="Set up a Cloudflare Tunnel for secure ingress">
      <div className="space-y-5">
        <div className="bg-accent-500/5 border border-accent-500/10 rounded-lg p-4">
          <p className="text-xs text-white/50">
            A Cloudflare Tunnel creates an encrypted connection between your node and Cloudflare&apos;s network.
            No public IP or open ports required.
          </p>
        </div>

        <FormField label="Tunnel Name">
          <FormInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. production-tunnel" autoFocus />
        </FormField>

        <FormField label="Target Node" hint="Where cloudflared will run">
          <FormSelect value={nodeId} onChange={(e) => setNodeId(e.target.value)}>
            <option value="">Select a node...</option>
            {nodes.map((n: any) => (
              <option key={n.id} value={n.id}>{n.name} ({n.role}) — {n.host}</option>
            ))}
          </FormSelect>
          {nodes.length === 0 && (
            <p className="text-[11px] text-amber-400/70 mt-1.5">
              ⚠ No nodes found. Add a node first.
            </p>
          )}
        </FormField>

        <FormField label="Cloudflare Account ID" hint="Optional — from Cloudflare dashboard">
          <FormInput value={cfAccountId} onChange={(e) => setCfAccountId(e.target.value)} placeholder="e.g. abc123def456" />
        </FormField>

        {createTunnel.isError && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-400">
            ✗ {createTunnel.error?.message}
          </div>
        )}

        <button
          onClick={handleCreate}
          disabled={!name || !nodeId || createTunnel.isPending}
          className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {createTunnel.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cloud className="w-4 h-4" />}
          {createTunnel.isPending ? 'Creating...' : 'Create Tunnel'}
        </button>
      </div>
    </SlideOver>
  );
}
