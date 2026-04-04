'use client';

import { useState } from 'react';
import {
  Plus,
  FolderKanban,
  Container,
  Clock,
  MoreVertical,
  ExternalLink,
  Loader2,
  GitBranch,
  Globe,
  Github,
} from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { formatDistanceToNow } from 'date-fns';
import Link from 'next/link';
import { SlideOver, FormField, FormInput, FormSelect, FormTextarea } from '@/components/slide-over';
import { EmptyState } from '@/components/empty-state';

const envBadge: Record<string, string> = {
  production: 'bg-success-500/10 text-success-400 border-success-500/20',
  staging: 'bg-warning-500/10 text-warning-500 border-warning-500/20',
  development: 'bg-brand-500/10 text-brand-400 border-brand-500/20',
};

const statusDot: Record<string, string> = {
  running: 'status-running',
  deploying: 'status-deploying',
  failed: 'status-failed',
  stopped: 'status-stopped',
  unknown: 'status-unknown',
};

export default function ProjectsPage() {
  const { data: projects, isLoading, refetch } = trpc.project.list.useQuery(undefined, { retry: 1 });
  const [showCreate, setShowCreate] = useState(false);
  const [showAddService, setShowAddService] = useState<string | null>(null); // projectId

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Projects</h1>
          <p className="text-sm text-white/40 mt-1">Organize and manage your services</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />
          New Project
        </button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="glass-card h-44 animate-pulse">
              <div className="px-5 py-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-white/5" />
                  <div className="space-y-1.5 flex-1">
                    <div className="h-4 w-32 bg-white/5 rounded" />
                    <div className="h-3 w-48 bg-white/5 rounded" />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && (!projects || projects.length === 0) && (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          description="Create your first project to start deploying services. A project groups related services together."
          actionLabel="Create Project"
          actionIcon={Plus}
          onAction={() => setShowCreate(true)}
        />
      )}

      {/* Projects Grid */}
      {!isLoading && projects && projects.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {projects.map((project: any) => (
            <Link href={`/dashboard/projects/${project.id}`} key={project.id} className="glass-card glass-card-hover group cursor-pointer block">
              <div className="px-5 py-4 flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-brand-500/20 to-brand-600/10 flex items-center justify-center border border-brand-500/10 mt-0.5">
                    <FolderKanban className="w-5 h-5 text-brand-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white group-hover:text-brand-300 transition-colors">
                      {project.name}
                    </h3>
                    <p className="text-[11px] text-white/30 mt-0.5 line-clamp-1">
                      {project.description || 'No description'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${envBadge[project.environment] || envBadge.production}`}>
                    {project.environment}
                  </span>
                </div>
              </div>

              {/* Services */}
              <div className="px-5 pb-3">
                <div className="flex flex-wrap gap-2">
                  {project.services && project.services.length > 0 ? (
                    project.services.map((svc: any) => (
                      <div
                        key={svc.id}
                        className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/[0.02] border border-white/[0.04] text-[11px] text-white/50"
                      >
                        <span className={`status-dot ${statusDot[svc.status] || 'status-unknown'}`} style={{ width: 6, height: 6 }} />
                        {svc.name}
                      </div>
                    ))
                  ) : (
                    <span className="text-[11px] text-white/20">No services yet</span>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="px-5 py-3 border-t border-white/[0.03] flex items-center justify-between">
                <div className="flex items-center gap-3 text-[10px] text-white/25">
                  <span className="flex items-center gap-1">
                    <Container className="w-3 h-3" />
                    {project.services?.length || 0} services
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {project.updatedAt ? formatDistanceToNow(new Date(project.updatedAt), { addSuffix: true }) : '-'}
                  </span>
                </div>
                <button
                  onClick={() => setShowAddService(project.id)}
                  className="text-[10px] text-brand-400 hover:text-brand-300 font-medium transition-colors"
                >
                  + Add Service
                </button>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Create Project SlideOver */}
      <CreateProjectSlideOver
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSuccess={() => { setShowCreate(false); refetch(); }}
      />

      {/* Add Service SlideOver */}
      <AddServiceSlideOver
        projectId={showAddService}
        onClose={() => setShowAddService(null)}
        onSuccess={() => { setShowAddService(null); refetch(); }}
      />
    </div>
  );
}

// ── Create Project SlideOver ────────────────────────────────

function CreateProjectSlideOver({ open, onClose, onSuccess }: {
  open: boolean; onClose: () => void; onSuccess: () => void;
}) {
  const createProject = trpc.project.create.useMutation();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [environment, setEnvironment] = useState<'production' | 'staging' | 'development'>('production');

  const handleCreate = () => {
    if (!name) return;
    createProject.mutate({ name, description: description || undefined, environment }, {
      onSuccess: () => {
        setName('');
        setDescription('');
        setEnvironment('production');
        onSuccess();
      },
    });
  };

  return (
    <SlideOver open={open} onClose={onClose} title="Create Project" description="A project groups related services">
      <div className="space-y-5">
        <FormField label="Project Name">
          <FormInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. my-web-app" autoFocus />
        </FormField>

        <FormField label="Description" hint="Optional">
          <FormTextarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does this project do?" rows={3} />
        </FormField>

        <FormField label="Environment">
          <FormSelect value={environment} onChange={(e) => setEnvironment(e.target.value as any)}>
            <option value="production">Production</option>
            <option value="staging">Staging</option>
            <option value="development">Development</option>
          </FormSelect>
        </FormField>

        {createProject.isError && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-400">
            ✗ {createProject.error?.message}
          </div>
        )}

        <button
          onClick={handleCreate}
          disabled={!name || createProject.isPending}
          className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {createProject.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderKanban className="w-4 h-4" />}
          {createProject.isPending ? 'Creating...' : 'Create Project'}
        </button>
      </div>
    </SlideOver>
  );
}

// ── Add Service SlideOver ────────────────────────────────────

function AddServiceSlideOver({ projectId, onClose, onSuccess }: {
  projectId: string | null; onClose: () => void; onSuccess: () => void;
}) {
  const { data: nodesList } = trpc.node.list.useQuery(undefined, { enabled: !!projectId });
  const createService = trpc.service.create.useMutation();

  const [name, setName] = useState('');
  const [sourceType, setSourceType] = useState<'git' | 'image' | 'github'>('github');
  const [gitUrl, setGitUrl] = useState('');
  const [gitBranch, setGitBranch] = useState('main');
  const [imageName, setImageName] = useState('');
  const [targetNodeId, setTargetNodeId] = useState('');
  const [buildNodeId, setBuildNodeId] = useState('');
  const [containerPort, setContainerPort] = useState('3000');

  const handleClose = () => {
    setName(''); setGitUrl(''); setGitBranch('main'); setImageName('');
    setTargetNodeId(''); setBuildNodeId(''); setContainerPort('3000');
    setSourceType('git');
    onClose();
  };

  const handleCreate = () => {
    if (!name || !projectId) return;

    createService.mutate({
      projectId,
      name,
      sourceType: sourceType === 'image' ? 'image' : 'git',
      gitUrl: (sourceType === 'git' || sourceType === 'github') ? gitUrl : undefined,
      gitBranch: (sourceType === 'git' || sourceType === 'github') ? gitBranch : undefined,
      gitProvider: sourceType === 'github' ? 'github' : undefined,
      imageName: sourceType === 'image' ? imageName : undefined,
      targetNodeId: targetNodeId || undefined,
      buildNodeId: buildNodeId || undefined,
      ports: containerPort ? [{ container: parseInt(containerPort), host: parseInt(containerPort), protocol: 'tcp' }] : [],
    }, {
      onSuccess: () => {
        handleClose();
        onSuccess();
      },
    });
  };

  const managers = nodesList?.filter((n: any) => n.role === 'manager' || n.role === 'worker') || [];
  const builders = nodesList?.filter((n: any) => n.role === 'build' || n.role === 'manager') || [];

  const githubStatus = trpc.github.status.useQuery();
  const githubRepos = trpc.github.listRepositories.useQuery(undefined, {
    enabled: !!githubStatus.data?.connected && sourceType === 'github',
  });
  const githubBranches = trpc.github.listBranches.useQuery(
    { repoFullName: gitUrl },
    { enabled: !!githubStatus.data?.connected && sourceType === 'github' && !!gitUrl && !gitUrl.startsWith('https://') }
  );

  return (
    <SlideOver open={!!projectId} onClose={handleClose} title="Add Service" description="Deploy a containerized application" width="lg">
      <div className="space-y-5">
        <FormField label="Service Name">
          <FormInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. api, web, worker" autoFocus />
        </FormField>

        {/* Source type toggle */}
        <FormField label="Source">
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => { setSourceType('github'); setGitUrl(''); setGitBranch('main'); }}
              className={`px-3 py-2 rounded-lg border text-xs transition-colors whitespace-nowrap ${
                sourceType === 'github'
                  ? 'bg-brand-500/10 border-brand-500/30 text-brand-400'
                  : 'bg-white/[0.02] border-white/[0.05] text-white/40 hover:bg-white/[0.04]'
              }`}
            >
              <Github className="w-3.5 h-3.5 inline mr-1.5" />GitHub App
            </button>
            <button
              onClick={() => { setSourceType('git'); setGitUrl(''); setGitBranch('main'); }}
              className={`px-3 py-2 rounded-lg border text-xs transition-colors whitespace-nowrap ${
                sourceType === 'git'
                  ? 'bg-brand-500/10 border-brand-500/30 text-brand-400'
                  : 'bg-white/[0.02] border-white/[0.05] text-white/40 hover:bg-white/[0.04]'
              }`}
            >
              <GitBranch className="w-3.5 h-3.5 inline mr-1.5" />Git URL
            </button>
            <button
              onClick={() => { setSourceType('image'); setImageName(''); }}
              className={`px-3 py-2 rounded-lg border text-xs transition-colors whitespace-nowrap ${
                sourceType === 'image'
                  ? 'bg-brand-500/10 border-brand-500/30 text-brand-400'
                  : 'bg-white/[0.02] border-white/[0.05] text-white/40 hover:bg-white/[0.04]'
              }`}
            >
              <Container className="w-3.5 h-3.5 inline mr-1.5" />Docker Image
            </button>
          </div>
        </FormField>

        {sourceType === 'github' && (
          <>
            {!githubStatus.data?.connected ? (
              <div className="bg-white/5 border border-white/10 rounded-lg p-4 text-center">
                <p className="text-xs text-white/40 mb-3">You need to connect the Click-Deploy GitHub App to select repositories directly.</p>
                <Link href="/dashboard/settings?tab=integrations" onClick={onClose} className="btn-primary inline-flex text-xs py-1.5">Configure Integration</Link>
              </div>
            ) : (
              <>
                <FormField label="Repository">
                  <FormSelect 
                    value={gitUrl} 
                    onChange={(e) => {
                      setGitUrl(e.target.value);
                      const tRepo = githubRepos.data?.find((r: any) => r.name === e.target.value);
                      if (tRepo && tRepo.defaultBranch) setGitBranch(tRepo.defaultBranch);
                    }}
                  >
                    <option value="">Select a repository...</option>
                    {githubRepos.data?.map((repo: any) => (
                      <option key={repo.id} value={repo.name}>{repo.name} {repo.private ? '🔒' : ''}</option>
                    ))}
                  </FormSelect>
                  {githubRepos.isLoading && <p className="text-[10px] items-center flex text-white/40 mt-1.5"><Loader2 className="w-3 h-3 animate-spin mr-1"/> Fetching repos...</p>}
                </FormField>

                <FormField label="Branch">
                  <FormSelect value={gitBranch} onChange={(e) => setGitBranch(e.target.value)} disabled={!gitUrl || githubBranches.isLoading}>
                    <option value="">Select branch...</option>
                    {githubBranches.data?.map((branch: string) => (
                      <option key={branch} value={branch}>{branch}</option>
                    ))}
                    {!githubBranches.data && gitBranch && <option value={gitBranch}>{gitBranch}</option>}
                  </FormSelect>
                  {githubBranches.isLoading && <p className="text-[10px] items-center flex text-white/40 mt-1.5"><Loader2 className="w-3 h-3 animate-spin mr-1"/> Fetching branches...</p>}
                </FormField>
              </>
            )}
          </>
        )}

        {sourceType === 'git' && (
          <>
            <FormField label="Git URL" hint="HTTPS or SSH clone URL">
              <FormInput value={gitUrl} onChange={(e) => setGitUrl(e.target.value)} placeholder="https://github.com/user/repo.git" />
            </FormField>
            <FormField label="Branch">
              <FormInput value={gitBranch} onChange={(e) => setGitBranch(e.target.value)} />
            </FormField>
          </>
        )}

        {sourceType === 'image' && (
          <FormField label="Docker Image" hint="e.g. nginx:latest, ghcr.io/user/app:v1">
            <FormInput value={imageName} onChange={(e) => setImageName(e.target.value)} placeholder="nginx:latest" />
          </FormField>
        )}

        <FormField label="Container Port" hint="The port your app listens on">
          <FormInput type="number" value={containerPort} onChange={(e) => setContainerPort(e.target.value)} />
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Deploy Node">
            <FormSelect value={targetNodeId} onChange={(e) => setTargetNodeId(e.target.value)}>
              <option value="">Select node...</option>
              {managers.map((n: any) => (
                <option key={n.id} value={n.id}>{n.name} ({n.role})</option>
              ))}
            </FormSelect>
          </FormField>
          {(sourceType === 'git' || sourceType === 'github') && (
            <FormField label="Build Node">
              <FormSelect value={buildNodeId} onChange={(e) => setBuildNodeId(e.target.value)}>
                <option value="">Select node...</option>
                {builders.map((n: any) => (
                  <option key={n.id} value={n.id}>{n.name} ({n.role})</option>
                ))}
              </FormSelect>
            </FormField>
          )}
        </div>

        {createService.isError && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-400">
            ✗ {createService.error?.message}
          </div>
        )}

        <button
          onClick={handleCreate}
          disabled={!name || createService.isPending}
          className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {createService.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Container className="w-4 h-4" />}
          {createService.isPending ? 'Creating...' : 'Create Service'}
        </button>
      </div>
    </SlideOver>
  );
}
