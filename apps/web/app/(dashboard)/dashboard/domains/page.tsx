'use client';

import { useState } from 'react';
import {
  Plus,
  Globe,
  ShieldCheck,
  ExternalLink,
  Trash2,
  Loader2,
} from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { SlideOver, FormField, FormInput, FormSelect } from '@/components/slide-over';
import { useConfirm } from '@/components/confirm-dialog';

const sslBadge: Record<string, string> = {
  letsencrypt: 'bg-success-500/10 text-success-400 border-success-500/20',
  cloudflare: 'bg-brand-500/10 text-brand-400 border-brand-500/20',
  custom: 'bg-accent-500/10 text-accent-400 border-accent-500/20',
  none: 'bg-white/5 text-white/30 border-white/10',
};

export default function DomainsPage() {
  const { data: domains, isLoading, refetch } = trpc.domain.listAll.useQuery(undefined, { retry: 1 });
  const [showAdd, setShowAdd] = useState(false);
  const deleteDomain = trpc.domain.delete.useMutation();
  const confirm = useConfirm();

  const handleDelete = async (id: string) => {
    const ok = await confirm({ title: 'Remove Domain', message: 'This will remove the domain and update Traefik routing. SSL certificates will be revoked.', confirmText: 'Remove', variant: 'danger' });
    if (!ok) return;
    deleteDomain.mutate({ id }, { onSuccess: () => refetch() });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Domains</h1>
          <p className="text-sm text-white/40 mt-1">Manage custom domains and SSL certificates</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Add Domain
        </button>
      </div>

      {isLoading && (
        <div className="glass-card">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="px-5 py-4 border-b border-white/[0.03] last:border-0">
              <div className="h-5 w-48 bg-white/5 rounded animate-pulse mb-2" />
              <div className="h-3 w-32 bg-white/5 rounded animate-pulse" />
            </div>
          ))}
        </div>
      )}

      {!isLoading && (!domains || domains.length === 0) && (
        <div className="glass-card flex flex-col items-center justify-center py-20">
          <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-5">
            <Globe className="w-8 h-8 text-white/20" />
          </div>
          <h3 className="text-sm font-semibold text-white/60 mb-1">No domains configured</h3>
          <p className="text-xs text-white/30 mb-6 max-w-sm text-center">
            Add a custom domain to route traffic to your services. SSL is auto-provisioned via Let&apos;s Encrypt.
          </p>
          <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Add Domain
          </button>
        </div>
      )}

      {!isLoading && domains && domains.length > 0 && (
        <div className="glass-card">
          <div className="divide-y divide-white/[0.03]">
            {domains.map((domain: any) => (
              <div key={domain.id} className="px-5 py-4 flex items-center justify-between hover:bg-white/[0.02] transition-colors group">
                <div className="flex items-center gap-4">
                  <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-500/20 to-brand-600/10 flex items-center justify-center border border-brand-500/10">
                    <Globe className="w-4 h-4 text-brand-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white/90">{domain.hostname}</span>
                      {domain.sslEnabled && <ShieldCheck className="w-3.5 h-3.5 text-success-400" />}
                    </div>
                    <p className="text-[11px] text-white/30 mt-0.5">
                      → {domain.service?.name || 'Unlinked'} · {domain.service?.project?.name || '-'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${sslBadge[domain.sslProvider] || sslBadge.none}`}>
                    {domain.sslProvider || 'No SSL'}
                  </span>
                  <a href={`https://${domain.hostname}`} target="_blank" rel="noopener" className="opacity-0 group-hover:opacity-100 p-1 hover:bg-white/5 rounded transition-all">
                    <ExternalLink className="w-3.5 h-3.5 text-white/30" />
                  </a>
                  <button
                    onClick={() => handleDelete(domain.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/10 rounded transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-danger-400" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add Domain SlideOver */}
      <AddDomainSlideOver
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onSuccess={() => { setShowAdd(false); refetch(); }}
      />
    </div>
  );
}

// ── Add Domain SlideOver ─────────────────────────────────────

function AddDomainSlideOver({ open, onClose, onSuccess }: {
  open: boolean; onClose: () => void; onSuccess: () => void;
}) {
  const { data: projects } = trpc.project.list.useQuery(undefined, { enabled: open });
  const createDomain = trpc.domain.create.useMutation();

  const [hostname, setHostname] = useState('');
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [sslProvider, setSslProvider] = useState<'letsencrypt' | 'cloudflare' | 'custom' | 'none'>('letsencrypt');

  const handleClose = () => {
    setHostname('');
    setSelectedServiceId('');
    setSslProvider('letsencrypt');
    onClose();
  };

  const handleCreate = () => {
    if (!hostname || !selectedServiceId) return;
    createDomain.mutate({
      serviceId: selectedServiceId,
      hostname,
      sslEnabled: sslProvider !== 'none',
      sslProvider,
    }, {
      onSuccess: () => {
        handleClose();
        onSuccess();
      },
    });
  };

  // Flatten all services from all projects for the dropdown
  const allServices = (projects || []).flatMap((p: any) =>
    (p.services || []).map((s: any) => ({
      id: s.id,
      name: s.name,
      projectName: p.name,
    }))
  );

  return (
    <SlideOver open={open} onClose={handleClose} title="Add Domain" description="Route a custom domain to a service with auto-SSL">
      <div className="space-y-5">
        <div className="bg-brand-500/5 border border-brand-500/10 rounded-lg p-4">
          <p className="text-xs text-white/50">
            Point your domain&apos;s <span className="text-white/70 font-medium">A record</span> to your manager node&apos;s IP, then add it here.
            Traefik will auto-provision an SSL certificate via Let&apos;s Encrypt.
          </p>
        </div>

        <FormField label="Domain / Hostname">
          <FormInput
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            placeholder="e.g. myapp.example.com"
            autoFocus
          />
        </FormField>

        <FormField label="Route to Service">
          <FormSelect value={selectedServiceId} onChange={(e) => setSelectedServiceId(e.target.value)}>
            <option value="">Select a service...</option>
            {allServices.map((s: any) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.projectName})
              </option>
            ))}
          </FormSelect>
          {allServices.length === 0 && (
            <p className="text-[11px] text-amber-400/70 mt-1.5">
              ⚠ No services found. Create a project and service first.
            </p>
          )}
        </FormField>

        <FormField label="SSL Provider">
          <FormSelect value={sslProvider} onChange={(e) => setSslProvider(e.target.value as any)}>
            <option value="letsencrypt">Let&apos;s Encrypt (auto)</option>
            <option value="cloudflare">Cloudflare</option>
            <option value="custom">Custom Certificate</option>
            <option value="none">No SSL</option>
          </FormSelect>
        </FormField>

        {createDomain.isError && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-400">
            ✗ {createDomain.error?.message}
          </div>
        )}

        <button
          onClick={handleCreate}
          disabled={!hostname || !selectedServiceId || createDomain.isPending}
          className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {createDomain.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
          {createDomain.isPending ? 'Adding...' : 'Add Domain & Configure SSL'}
        </button>
      </div>
    </SlideOver>
  );
}
