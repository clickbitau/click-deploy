'use client';

import { useState } from 'react';
import {
  Plus,
  Box,
  ShieldCheck,
  MoreVertical,
  Trash2,
  Loader2,
  Save,
} from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { SlideOver, FormField, FormInput, FormSelect } from '@/components/slide-over';
import { useConfirm } from '@/components/confirm-dialog';

const typeBadge: Record<string, string> = {
  dockerhub: 'bg-brand-500/10 text-brand-400',
  ghcr: 'bg-white/5 text-white/50',
  ecr: 'bg-accent-500/10 text-accent-400',
  self_hosted: 'bg-success-500/10 text-success-400',
  custom: 'bg-warning-500/10 text-warning-500',
};

const typeLabels: Record<string, string> = {
  dockerhub: 'Docker Hub',
  ghcr: 'GitHub Container Registry',
  ecr: 'Amazon ECR',
  self_hosted: 'Self-Hosted',
  custom: 'Custom',
};

export default function RegistryPage() {
  const { data: registries, isLoading, refetch } = trpc.registry.list.useQuery(undefined, { retry: 1 });
  const [showAdd, setShowAdd] = useState(false);
  const [editingReg, setEditingReg] = useState<any>(null);
  const deleteReg = trpc.registry.delete.useMutation();
  const confirm = useConfirm();

  const handleDelete = async (id: string) => {
    const ok = await confirm({ title: 'Remove Registry', message: 'This will remove the registry configuration. Existing images will not be deleted.', confirmText: 'Remove', variant: 'danger' });
    if (!ok) return;
    deleteReg.mutate({ id }, { onSuccess: () => refetch() });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Registry</h1>
          <p className="text-sm text-white/40 mt-1">Docker image registries for build &amp; deploy</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Add Registry
        </button>
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="glass-card h-36 animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && (!registries || registries.length === 0) && (
        <div className="glass-card flex flex-col items-center justify-center py-20">
          <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-5">
            <Box className="w-8 h-8 text-white/20" />
          </div>
          <h3 className="text-sm font-semibold text-white/60 mb-1">No registries configured</h3>
          <p className="text-xs text-white/30 mb-6 max-w-sm text-center">
            Add a Docker registry to store your built images. A self-hosted registry is recommended for self-hosted PaaS.
          </p>
          <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Add Registry
          </button>
        </div>
      )}

      {!isLoading && registries && registries.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {registries.map((reg: any) => (
            <div key={reg.id} className="glass-card glass-card-hover group cursor-pointer" onClick={() => setEditingReg(reg)}>
              <div className="px-5 py-4 flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-brand-500/20 to-brand-600/10 flex items-center justify-center border border-brand-500/10 mt-0.5">
                    <Box className="w-5 h-5 text-brand-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-white">{reg.name}</h3>
                      {reg.isDefault && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-brand-500/20 text-brand-400 uppercase tracking-wider">
                          Default
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-white/30 mt-0.5 font-mono">{reg.url}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${typeBadge[reg.type] || typeBadge.custom}`}>
                    {typeLabels[reg.type] || reg.type}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(reg.id); }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-red-500/10 rounded"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-danger-400" />
                  </button>
                </div>
              </div>
              <div className="px-5 pb-4 flex items-center gap-4 text-[10px] text-white/25">
                <span className="flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" />
                  {reg.username && reg.username !== '***' ? 'Authenticated' : reg.username === '***' ? 'Credentials set' : 'No auth'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <AddRegistrySlideOver
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onSuccess={() => { setShowAdd(false); refetch(); }}
      />

      <EditRegistrySlideOver
        open={!!editingReg}
        registry={editingReg}
        onClose={() => setEditingReg(null)}
        onSuccess={() => { setEditingReg(null); refetch(); }}
      />
    </div>
  );
}

// ── Add Registry SlideOver ───────────────────────────────────

function AddRegistrySlideOver({ open, onClose, onSuccess }: {
  open: boolean; onClose: () => void; onSuccess: () => void;
}) {
  const createReg = trpc.registry.create.useMutation();
  const [name, setName] = useState('');
  const [type, setType] = useState<'dockerhub' | 'ghcr' | 'ecr' | 'self_hosted' | 'custom'>('self_hosted');
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isDefault, setIsDefault] = useState(true);

  const handleClose = () => {
    setName(''); setUrl(''); setUsername(''); setPassword('');
    setType('self_hosted'); setIsDefault(true);
    onClose();
  };

  // Auto-fill URL based on type
  const handleTypeChange = (t: string) => {
    setType(t as any);
    if (t === 'dockerhub') setUrl('https://index.docker.io/v1/');
    else if (t === 'ghcr') setUrl('https://ghcr.io');
    else if (t === 'self_hosted') setUrl('http://localhost:5000');
    else setUrl('');
  };

  const handleCreate = () => {
    if (!name || !url) return;
    createReg.mutate({
      name, type, url,
      username: username || undefined,
      password: password || undefined,
      isDefault,
    }, {
      onSuccess: () => { handleClose(); onSuccess(); },
    });
  };

  return (
    <SlideOver open={open} onClose={handleClose} title="Add Registry" description="Configure a Docker image registry">
      <div className="space-y-5">
        <FormField label="Registry Name">
          <FormInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Production Registry" autoFocus />
        </FormField>

        <FormField label="Type">
          <FormSelect value={type} onChange={(e) => handleTypeChange(e.target.value)}>
            <option value="self_hosted">Self-Hosted (port 5000)</option>
            <option value="dockerhub">Docker Hub</option>
            <option value="ghcr">GitHub Container Registry</option>
            <option value="ecr">Amazon ECR</option>
            <option value="custom">Custom</option>
          </FormSelect>
        </FormField>

        <FormField label="Registry URL">
          <FormInput value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://registry.example.com" />
        </FormField>

        <div className="relative">
          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/[0.06]" /></div>
          <div className="relative flex justify-center"><span className="bg-[var(--bg-card)] px-3 text-[10px] text-white/25 uppercase tracking-wider">credentials (optional)</span></div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Username">
            <FormInput value={username} onChange={(e) => setUsername(e.target.value)} placeholder="optional" />
          </FormField>
          <FormField label="Password / Token">
            <FormInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="optional" />
          </FormField>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
            className="w-4 h-4 rounded border-white/10 bg-black/40 text-brand-500 focus:ring-brand-500/50"
          />
          <span className="text-xs text-white/50">Set as default registry for new services</span>
        </label>

        {createReg.isError && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-400">
            ✗ {createReg.error?.message}
          </div>
        )}

        <button
          onClick={handleCreate}
          disabled={!name || !url || createReg.isPending}
          className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {createReg.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Box className="w-4 h-4" />}
          {createReg.isPending ? 'Adding...' : 'Add Registry'}
        </button>
      </div>
    </SlideOver>
  );
}

// ── Edit Registry SlideOver ──────────────────────────────────

function EditRegistrySlideOver({ open, registry, onClose, onSuccess }: {
  open: boolean; registry: any; onClose: () => void; onSuccess: () => void;
}) {
  const updateReg = trpc.registry.update.useMutation();
  const [name, setName] = useState('');
  const [type, setType] = useState<'dockerhub' | 'ghcr' | 'ecr' | 'self_hosted' | 'custom'>('self_hosted');
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isDefault, setIsDefault] = useState(false);

  // Populate fields when registry changes
  const regId = registry?.id;
  useState(() => {
    if (registry) {
      setName(registry.name || '');
      setType(registry.type || 'self_hosted');
      setUrl(registry.url || '');
      setUsername('');
      setPassword('');
      setIsDefault(registry.isDefault || false);
    }
  });

  // Re-populate when registry changes
  const [lastRegId, setLastRegId] = useState<string | null>(null);
  if (regId && regId !== lastRegId) {
    setLastRegId(regId);
    setName(registry.name || '');
    setType(registry.type || 'self_hosted');
    setUrl(registry.url || '');
    setUsername('');
    setPassword('');
    setIsDefault(registry.isDefault || false);
  }

  const handleSave = () => {
    if (!name || !url || !regId) return;
    updateReg.mutate({
      id: regId,
      name, type, url,
      username: username || undefined,
      password: password || undefined,
      isDefault,
    }, {
      onSuccess: () => { onClose(); onSuccess(); },
    });
  };

  return (
    <SlideOver open={open} onClose={onClose} title="Edit Registry" description="Update registry configuration">
      <div className="space-y-5">
        <FormField label="Registry Name">
          <FormInput value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </FormField>

        <FormField label="Type">
          <FormSelect value={type} onChange={(e) => setType(e.target.value as any)}>
            <option value="self_hosted">Self-Hosted</option>
            <option value="dockerhub">Docker Hub</option>
            <option value="ghcr">GitHub Container Registry</option>
            <option value="ecr">Amazon ECR</option>
            <option value="custom">Custom</option>
          </FormSelect>
        </FormField>

        <FormField label="Registry URL">
          <FormInput value={url} onChange={(e) => setUrl(e.target.value)} />
        </FormField>

        <div className="relative">
          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/[0.06]" /></div>
          <div className="relative flex justify-center"><span className="bg-[var(--bg-card)] px-3 text-[10px] text-white/25 uppercase tracking-wider">update credentials</span></div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Username">
            <FormInput value={username} onChange={(e) => setUsername(e.target.value)} placeholder="leave blank to keep" />
          </FormField>
          <FormField label="Password / Token">
            <FormInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="leave blank to keep" />
          </FormField>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
            className="w-4 h-4 rounded border-white/10 bg-black/40 text-brand-500 focus:ring-brand-500/50"
          />
          <span className="text-xs text-white/50">Set as default registry</span>
        </label>

        {updateReg.isError && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-400">
            ✗ {updateReg.error?.message}
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={!name || !url || updateReg.isPending}
          className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {updateReg.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {updateReg.isPending ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </SlideOver>
  );
}
