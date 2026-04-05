'use client';

import { useState } from 'react';
import {
  Plus,
  Globe,
  ShieldCheck,
  ExternalLink,
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Wifi,
  RefreshCw,
} from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { SlideOver, FormField, FormInput, FormSelect } from '@/components/slide-over';
import { useConfirm } from '@/components/confirm-dialog';

const sslBadge: Record<string, string> = {
  letsencrypt: 'bg-success-500/10 text-success-400 border-success-500/20',
  cloudflare:  'bg-[#F6821F]/10 text-[#F6821F] border-[#F6821F]/20',
  custom:      'bg-accent-500/10 text-accent-400 border-accent-500/20',
  none:        'bg-white/5 text-white/30 border-white/10',
};

const dnsStatus: Record<string, { icon: React.ReactNode; color: string }> = {
  tunnel_ok:        { icon: <CheckCircle2 className="w-3.5 h-3.5" />, color: 'text-success-400' },
  cname_other:      { icon: <AlertCircle className="w-3.5 h-3.5" />,  color: 'text-amber-400' },
  a_record:         { icon: <CheckCircle2 className="w-3.5 h-3.5" />, color: 'text-brand-400' },
  no_record:        { icon: <XCircle className="w-3.5 h-3.5" />,      color: 'text-red-400' },
  not_in_cloudflare:{ icon: <AlertCircle className="w-3.5 h-3.5" />,  color: 'text-white/30' },
  error:            { icon: <XCircle className="w-3.5 h-3.5" />,      color: 'text-red-400' },
  unknown:          { icon: <AlertCircle className="w-3.5 h-3.5" />,  color: 'text-white/20' },
};

function DnsStatusBadge({ hostname }: { hostname: string }) {
  const { data, isLoading, refetch } = trpc.domain.checkDns.useQuery(
    { hostname },
    { retry: false, refetchOnWindowFocus: false }
  );

  const s = data?.status ?? 'unknown';
  const meta = dnsStatus[s] ?? dnsStatus.unknown!;

  return (
    <button
      onClick={(e) => { e.stopPropagation(); refetch(); }}
      title={data?.message ?? 'Check DNS…'}
      className={`flex items-center gap-1 text-[10px] font-medium transition-opacity hover:opacity-80 ${meta.color}`}
    >
      {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : meta.icon}
      <span className="hidden sm:inline">{s === 'tunnel_ok' ? 'DNS ✓' : s === 'no_record' ? 'No DNS' : 'DNS?'}</span>
    </button>
  );
}

export default function DomainsPage() {
  const { data: domains, isLoading, refetch } = trpc.domain.listAll.useQuery(undefined, { retry: 1 });
  const [showAdd, setShowAdd] = useState(false);
  const deleteDomain = trpc.domain.delete.useMutation();
  const confirm = useConfirm();

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: 'Remove Domain',
      message: 'This will remove the domain from Traefik routing and the Cloudflare Tunnel. The DNS CNAME will also be deleted.',
      confirmText: 'Remove',
      variant: 'danger',
    });
    if (!ok) return;
    deleteDomain.mutate({ id }, { onSuccess: () => refetch() });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Domains</h1>
          <p className="text-sm text-white/40 mt-1">
            Custom domains are auto-routed via Cloudflare Tunnel + Traefik — zero DNS manual config
          </p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Add Domain
        </button>
      </div>

      {/* Info banner */}
      <div className="mb-6 bg-[#F6821F]/5 border border-[#F6821F]/15 rounded-xl px-4 py-3 flex items-start gap-3">
        <Wifi className="w-4 h-4 text-[#F6821F] mt-0.5 shrink-0" />
        <div className="text-xs text-white/50 leading-relaxed">
          <span className="text-white/70 font-medium">Zero-touch DNS.</span>{' '}
          When you add a domain with the{' '}
          <span className="text-[#F6821F] font-medium">Cloudflare</span> provider, the platform
          automatically adds the public hostname to your Cloudflare Tunnel and creates a proxied{' '}
          <code className="text-white/60">CNAME</code> record. No manual DNS changes required.
        </div>
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
            Add a custom domain to route traffic to your services. Choose &ldquo;Cloudflare&rdquo; for
            fully automated SSL + DNS via your Cloudflare Tunnel — no nameserver changes needed.
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
              <div
                key={domain.id}
                className="px-5 py-4 flex items-center justify-between hover:bg-white/[0.02] transition-colors group"
              >
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
                  {/* Live DNS status check */}
                  <DnsStatusBadge hostname={domain.hostname} />

                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${sslBadge[domain.sslProvider] ?? sslBadge.none}`}>
                    {domain.sslProvider === 'cloudflare' ? '☁ Cloudflare' : domain.sslProvider || 'No SSL'}
                  </span>

                  <a
                    href={`https://${domain.hostname}`}
                    target="_blank"
                    rel="noopener"
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-white/5 rounded transition-all"
                  >
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
  const [sslProvider, setSslProvider] = useState<'letsencrypt' | 'cloudflare' | 'custom' | 'none'>('cloudflare');
  const [cfResult, setCfResult] = useState<{ cname: string; dnsCreated: boolean } | null>(null);

  const handleClose = () => {
    setHostname('');
    setSelectedServiceId('');
    setSslProvider('cloudflare');
    setCfResult(null);
    onClose();
  };

  const handleCreate = () => {
    if (!hostname || !selectedServiceId) return;
    createDomain.mutate(
      {
        serviceId: selectedServiceId,
        hostname,
        sslEnabled: sslProvider !== 'none',
        sslProvider,
      },
      {
        onSuccess: (data: any) => {
          if (data?.cloudflare) {
            setCfResult(data.cloudflare);
          } else {
            handleClose();
            onSuccess();
          }
        },
      }
    );
  };

  // Flatten all services from all projects for the dropdown
  const allServices = (projects || []).flatMap((p: any) =>
    (p.services || []).map((s: any) => ({
      id: s.id,
      name: s.name,
      projectName: p.name,
    }))
  );

  // Success screen after CF provisioning
  if (cfResult) {
    return (
      <SlideOver open={open} onClose={handleClose} title="Domain Added" description="Cloudflare configuration complete">
        <div className="space-y-5">
          <div className="bg-success-500/5 border border-success-500/20 rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2 text-success-400 font-semibold text-sm">
              <CheckCircle2 className="w-5 h-5" />
              Provisioning Complete
            </div>
            <div className="text-xs text-white/50 space-y-2">
              <p>✓ Public hostname added to Cloudflare Tunnel</p>
              {cfResult.dnsCreated ? (
                <p>✓ CNAME DNS record created → <code className="text-white/70">{cfResult.cname}</code></p>
              ) : (
                <p className="text-amber-400/80">
                  ⚠ DNS record could not be auto-created. Manually add a CNAME record pointing{' '}
                  <strong className="text-white/70">{hostname}</strong> →{' '}
                  <code className="text-white/70">{cfResult.cname}</code>
                </p>
              )}
              <p>✓ Traefik routing labels updated</p>
            </div>
          </div>

          {!cfResult.dnsCreated && (
            <div className="bg-white/5 rounded-xl p-4 text-xs text-white/40 space-y-1">
              <p className="text-white/60 font-medium mb-2">Manual DNS step (if needed)</p>
              <p>In your DNS provider, add a CNAME record:</p>
              <div className="mt-2 font-mono bg-black/20 rounded p-3 text-white/60 text-[11px] space-y-1">
                <p>Type: <span className="text-brand-400">CNAME</span></p>
                <p>Name: <span className="text-white/80">{hostname}</span></p>
                <p>Target: <span className="text-white/80">{cfResult.cname}</span></p>
                <p>Proxied: <span className="text-success-400">Yes (orange cloud)</span></p>
              </div>
            </div>
          )}

          <button onClick={() => { onSuccess(); handleClose(); }} className="btn-primary w-full">
            Done
          </button>
        </div>
      </SlideOver>
    );
  }

  return (
    <SlideOver open={open} onClose={handleClose} title="Add Domain" description="Route a custom domain to a service with auto-SSL + auto-DNS">
      <div className="space-y-5">

        {sslProvider === 'cloudflare' ? (
          <div className="bg-[#F6821F]/5 border border-[#F6821F]/15 rounded-lg p-4">
            <p className="text-xs text-white/60 flex items-start gap-2">
              <Wifi className="w-3.5 h-3.5 text-[#F6821F] mt-0.5 shrink-0" />
              <span>
                <span className="text-[#F6821F] font-medium">Zero-touch mode.</span>{' '}
                Your domain will be automatically added to the Cloudflare Tunnel and a proxied CNAME
                record will be created. No manual DNS configuration required.
              </span>
            </p>
          </div>
        ) : (
          <div className="bg-brand-500/5 border border-brand-500/10 rounded-lg p-4">
            <p className="text-xs text-white/50">
              Point your domain&apos;s <span className="text-white/70 font-medium">A record</span> to your
              manager node&apos;s IP, then add it here. Traefik will auto-provision an SSL certificate
              via Let&apos;s Encrypt.
            </p>
          </div>
        )}

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

        <FormField label="SSL / Routing Provider">
          <FormSelect value={sslProvider} onChange={(e) => setSslProvider(e.target.value as any)}>
            <option value="cloudflare">☁ Cloudflare Tunnel (auto DNS + SSL)</option>
            <option value="letsencrypt">Let&apos;s Encrypt (manual A record)</option>
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
          {createDomain.isPending
            ? sslProvider === 'cloudflare' ? 'Provisioning Tunnel + DNS…' : 'Adding…'
            : sslProvider === 'cloudflare' ? 'Add Domain & Auto-Configure DNS' : 'Add Domain & Configure SSL'}
        </button>
      </div>
    </SlideOver>
  );
}
