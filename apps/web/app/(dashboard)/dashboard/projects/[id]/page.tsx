'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Plus,
  Container,
  Globe,
  GitBranch,
  Box,
  Settings2,
  Trash2,
  MoreVertical,
  Loader2,
  Rocket,
  CheckCircle2,
  XCircle,
  Clock,
  Play,
} from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { formatDistanceToNow } from 'date-fns';
import { SlideOver, FormField, FormInput, FormSelect, FormTextarea } from '@/components/slide-over';

const statusConfig: Record<string, { class: string; dot: string; label: string }> = {
  running: { class: 'text-success-400', dot: 'status-running', label: 'Running' },
  deploying: { class: 'text-warning-500', dot: 'status-deploying', label: 'Deploying' },
  building: { class: 'text-warning-500', dot: 'status-deploying', label: 'Building' },
  stopped: { class: 'text-white/30', dot: 'status-stopped', label: 'Stopped' },
  failed: { class: 'text-danger-400', dot: 'status-failed', label: 'Failed' },
};

const envBadge: Record<string, string> = {
  production: 'bg-success-500/10 text-success-400 border-success-500/20',
  staging: 'bg-warning-500/10 text-warning-500 border-warning-500/20',
  development: 'bg-brand-500/10 text-brand-400 border-brand-500/20',
};

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const { data: project, isLoading, refetch } = trpc.project.byId.useQuery(
    { id: projectId },
    { retry: 1, enabled: !!projectId }
  );
  const deleteProject = trpc.project.delete.useMutation();
  const deleteService = trpc.service.delete.useMutation();
  const triggerDeploy = trpc.deployment.trigger.useMutation();

  const [showAddService, setShowAddService] = useState(false);
  const [showEditProject, setShowEditProject] = useState(false);
  const [deployingServiceId, setDeployingServiceId] = useState<string | null>(null);

  const handleDeleteProject = () => {
    if (!confirm('Delete this project and all its services? This action cannot be undone.')) return;
    deleteProject.mutate({ id: projectId }, {
      onSuccess: () => router.push('/dashboard/projects'),
    });
  };

  const handleDeleteService = (serviceId: string) => {
    if (!confirm('Delete this service?')) return;
    deleteService.mutate({ id: serviceId }, { onSuccess: () => refetch() });
  };

  const handleDeploy = (serviceId: string) => {
    setDeployingServiceId(serviceId);
    triggerDeploy.mutate({ serviceId }, {
      onSuccess: () => setDeployingServiceId(null),
      onError: () => setDeployingServiceId(null),
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-10 w-64 bg-white/5 rounded-lg animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="glass-card h-48 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="glass-card flex flex-col items-center justify-center py-20">
        <XCircle className="w-10 h-10 text-danger-400 mb-3" />
        <h3 className="text-sm font-semibold text-white/60 mb-1">Project not found</h3>
        <Link href="/dashboard/projects" className="text-xs text-brand-400 mt-3">
          ← Back to Projects
        </Link>
      </div>
    );
  }

  const services = project.services || [];

  return (
    <div>
      {/* Breadcrumb + Header */}
      <div className="mb-8">
        <Link
          href="/dashboard/projects"
          className="inline-flex items-center gap-1.5 text-xs text-white/30 hover:text-white/50 transition-colors mb-4"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Projects
        </Link>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-500/20 to-brand-600/10 flex items-center justify-center border border-brand-500/10">
              <Box className="w-6 h-6 text-brand-400" />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border capitalize ${envBadge[project.environment] || envBadge.production}`}>
                  {project.environment}
                </span>
              </div>
              {project.description && (
                <p className="text-sm text-white/40 mt-0.5">{project.description}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => setShowAddService(true)} className="btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Add Service
            </button>
            <button
              onClick={() => setShowEditProject(true)}
              className="p-2 hover:bg-white/5 rounded-lg transition-colors text-white/30 hover:text-white/60"
            >
              <Settings2 className="w-4 h-4" />
            </button>
            <button
              onClick={handleDeleteProject}
              className="p-2 hover:bg-red-500/10 rounded-lg transition-colors text-white/30 hover:text-danger-400"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="glass-card p-4">
          <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Services</p>
          <p className="text-2xl font-bold">{services.length}</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Environment</p>
          <p className="text-lg font-semibold capitalize">{project.environment}</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Created</p>
          <p className="text-sm font-medium text-white/60">
            {project.createdAt ? formatDistanceToNow(new Date(project.createdAt), { addSuffix: true }) : '-'}
          </p>
        </div>
      </div>

      {/* Services */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Services</h2>
        <span className="text-xs text-white/30">{services.length} service{services.length !== 1 ? 's' : ''}</span>
      </div>

      {services.length === 0 ? (
        <div className="glass-card flex flex-col items-center justify-center py-16">
          <Container className="w-10 h-10 text-white/15 mb-3" />
          <p className="text-sm text-white/40 mb-1">No services in this project</p>
          <p className="text-xs text-white/20 mb-5">Add a service to deploy an application or database</p>
          <button onClick={() => setShowAddService(true)} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Add Service
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {services.map((service: any) => {
            const status = statusConfig[service.status] || statusConfig.stopped;
            const isDeploying = deployingServiceId === service.id;
            return (
              <div key={service.id} className="glass-card glass-card-hover group">
                <Link href={`/dashboard/projects/${projectId}/services/${service.id}`} className="block px-5 py-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-brand-500/20 to-brand-600/10 flex items-center justify-center border border-brand-500/10 mt-0.5">
                        <Container className="w-5 h-5 text-brand-400" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-white">{service.name}</h3>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`${status.dot}`} />
                          <span className={`text-[10px] font-medium ${status.class}`}>{status.label}</span>
                        </div>
                      </div>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-white/30 border border-white/[0.05] capitalize">
                      {service.sourceType}
                    </span>
                  </div>

                  <div className="flex items-center gap-4 text-[10px] text-white/25">
                    {service.gitUrl && (
                      <span className="flex items-center gap-1 truncate max-w-[200px]">
                        <GitBranch className="w-3 h-3" />
                        {service.gitBranch || 'main'}
                      </span>
                    )}
                    {service.imageName && (
                      <span className="flex items-center gap-1 truncate max-w-[200px]">
                        <Box className="w-3 h-3" />
                        {service.imageName}:{service.imageTag || 'latest'}
                      </span>
                    )}
                    {service.replicas !== undefined && (
                      <span>{service.replicas} replica{service.replicas !== 1 ? 's' : ''}</span>
                    )}
                  </div>
                </Link>

                {/* Quick Actions */}
                <div className="px-5 pb-3 flex items-center gap-2 border-t border-white/[0.03] pt-3">
                  <button
                    onClick={(e) => { e.preventDefault(); handleDeploy(service.id); }}
                    disabled={isDeploying}
                    className="text-[11px] font-medium px-3 py-1.5 rounded-md bg-brand-500/10 text-brand-400 hover:bg-brand-500/20 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {isDeploying ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                    Deploy
                  </button>
                  <button
                    onClick={(e) => { e.preventDefault(); handleDeleteService(service.id); }}
                    className="text-[11px] font-medium px-3 py-1.5 rounded-md text-white/30 hover:bg-red-500/10 hover:text-danger-400 transition-colors opacity-0 group-hover:opacity-100"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Service SlideOver */}
      <AddServiceSlideOver
        open={showAddService}
        onClose={() => setShowAddService(false)}
        projectId={projectId}
        onSuccess={() => { setShowAddService(false); refetch(); }}
      />

      {/* Edit Project SlideOver */}
      <EditProjectSlideOver
        open={showEditProject}
        onClose={() => setShowEditProject(false)}
        project={project}
        onSuccess={() => { setShowEditProject(false); refetch(); }}
      />
    </div>
  );
}

// ── Add Service SlideOver ────────────────────────────────────

function AddServiceSlideOver({ open, onClose, projectId, onSuccess }: {
  open: boolean; onClose: () => void; projectId: string; onSuccess: () => void;
}) {
  const createService = trpc.service.create.useMutation();
  const { data: nodesList } = trpc.node.list.useQuery(undefined, { enabled: open });
  const { data: ghStatus } = trpc.github.status.useQuery(undefined, { enabled: open });
  const { data: repos, isLoading: reposLoading } = trpc.github.listRepositories.useQuery(undefined, {
    enabled: open && !!ghStatus?.connected && (ghStatus?.installations?.length ?? 0) > 0,
  });

  const [name, setName] = useState('');
  const [sourceType, setSourceType] = useState<'git' | 'image'>('git');
  const [gitUrl, setGitUrl] = useState('');
  const [gitBranch, setGitBranch] = useState('main');
  const [selectedRepo, setSelectedRepo] = useState('');
  const [imageName, setImageName] = useState('');
  const [imageTag, setImageTag] = useState('latest');
  const [port, setPort] = useState('3000');
  const [buildNodeId, setBuildNodeId] = useState('');
  const [targetNodeId, setTargetNodeId] = useState('');
  const [useManualUrl, setUseManualUrl] = useState(false);

  const githubConnected = ghStatus?.connected && (ghStatus?.installations?.length ?? 0) > 0;

  // Fetch branches when a repo is selected
  const { data: branches, isLoading: branchesLoading } = trpc.github.listBranches.useQuery(
    { repoFullName: selectedRepo },
    { enabled: !!selectedRepo && !!githubConnected }
  );

  const handleRepoChange = (repoFullName: string) => {
    setSelectedRepo(repoFullName);
    const repo = repos?.find((r: any) => r.name === repoFullName);
    if (repo) {
      setGitUrl(repo.url);
      setGitBranch(repo.defaultBranch || 'main');
      // Auto-derive service name if empty
      if (!name) {
        const shortName = repoFullName.split('/').pop() || '';
        setName(shortName);
      }
    }
  };

  const handleClose = () => {
    setName(''); setGitUrl(''); setImageName(''); setPort('3000');
    setGitBranch('main'); setImageTag('latest'); setSelectedRepo('');
    setSourceType('git'); setBuildNodeId(''); setTargetNodeId('');
    setUseManualUrl(false);
    onClose();
  };

  const handleCreate = () => {
    if (!name) return;
    createService.mutate({
      name,
      projectId,
      sourceType,
      gitUrl: sourceType === 'git' ? gitUrl || undefined : undefined,
      gitBranch: sourceType === 'git' ? gitBranch : undefined,
      gitProvider: sourceType === 'git' && githubConnected && !useManualUrl ? 'github' as const : undefined,
      imageName: sourceType === 'image' ? imageName || undefined : undefined,
      imageTag: sourceType === 'image' ? imageTag : undefined,
      ports: port ? [{ container: Number(port), protocol: 'tcp' as const }] : [],
      buildNodeId: buildNodeId || undefined,
      targetNodeId: targetNodeId || undefined,
    }, {
      onSuccess: () => { handleClose(); onSuccess(); },
    });
  };

  const nodes = nodesList || [];

  return (
    <SlideOver open={open} onClose={handleClose} title="Add Service" description="Add a new service to this project">
      <div className="space-y-5">
        <FormField label="Service Name">
          <FormInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. web-api" autoFocus />
        </FormField>

        <FormField label="Source Type">
          <FormSelect value={sourceType} onChange={(e) => setSourceType(e.target.value as any)}>
            <option value="git">Git Repository</option>
            <option value="image">Docker Image</option>
          </FormSelect>
        </FormField>

        {sourceType === 'git' && (
          <>
            {githubConnected && !useManualUrl ? (
              <>
                <FormField label="Repository">
                  <FormSelect
                    value={selectedRepo}
                    onChange={(e) => handleRepoChange(e.target.value)}
                  >
                    <option value="">
                      {reposLoading ? 'Loading repositories...' : '— Select a repository —'}
                    </option>
                    {(repos || []).map((repo: any) => (
                      <option key={repo.id} value={repo.name}>
                        {repo.name} {repo.private ? '🔒' : ''}
                      </option>
                    ))}
                  </FormSelect>
                </FormField>

                <FormField label="Branch">
                  <FormSelect
                    value={gitBranch}
                    onChange={(e) => setGitBranch(e.target.value)}
                    disabled={!selectedRepo}
                  >
                    {branchesLoading ? (
                      <option>Loading branches...</option>
                    ) : branches && branches.length > 0 ? (
                      branches.map((b: string) => (
                        <option key={b} value={b}>{b}</option>
                      ))
                    ) : (
                      <option value={gitBranch}>{gitBranch}</option>
                    )}
                  </FormSelect>
                </FormField>

                <button
                  type="button"
                  onClick={() => setUseManualUrl(true)}
                  className="text-[11px] text-white/30 hover:text-white/50 transition-colors"
                >
                  Or enter repository URL manually →
                </button>
              </>
            ) : (
              <>
                <FormField label="Repository URL">
                  <FormInput value={gitUrl} onChange={(e) => setGitUrl(e.target.value)} placeholder="https://github.com/user/repo.git" />
                </FormField>
                <FormField label="Branch">
                  <FormInput value={gitBranch} onChange={(e) => setGitBranch(e.target.value)} placeholder="main" />
                </FormField>
                {githubConnected && (
                  <button
                    type="button"
                    onClick={() => setUseManualUrl(false)}
                    className="text-[11px] text-white/30 hover:text-white/50 transition-colors"
                  >
                    ← Select from connected GitHub repos
                  </button>
                )}
                {!githubConnected && (
                  <p className="text-[10px] text-white/20">
                    💡 Connect GitHub in Settings → Integrations to select repos from a dropdown
                  </p>
                )}
              </>
            )}
          </>
        )}

        {sourceType === 'image' && (
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <FormField label="Image Name">
                <FormInput value={imageName} onChange={(e) => setImageName(e.target.value)} placeholder="nginx" />
              </FormField>
            </div>
            <FormField label="Tag">
              <FormInput value={imageTag} onChange={(e) => setImageTag(e.target.value)} placeholder="latest" />
            </FormField>
          </div>
        )}

        <FormField label="Container Port">
          <FormInput type="number" value={port} onChange={(e) => setPort(e.target.value)} placeholder="3000" />
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Build Node">
            <FormSelect value={buildNodeId} onChange={(e) => setBuildNodeId(e.target.value)}>
              <option value="">Auto</option>
              {nodes.map((n: any) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </FormSelect>
          </FormField>
          <FormField label="Deploy Node">
            <FormSelect value={targetNodeId} onChange={(e) => setTargetNodeId(e.target.value)}>
              <option value="">Auto</option>
              {nodes.map((n: any) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </FormSelect>
          </FormField>
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
          {createService.isPending ? 'Creating...' : 'Add Service'}
        </button>
      </div>
    </SlideOver>
  );
}

// ── Edit Project SlideOver ───────────────────────────────────

function EditProjectSlideOver({ open, onClose, project, onSuccess }: {
  open: boolean; onClose: () => void; project: any; onSuccess: () => void;
}) {
  const updateProject = trpc.project.update.useMutation();
  const [name, setName] = useState(project?.name || '');
  const [description, setDescription] = useState(project?.description || '');
  const [environment, setEnvironment] = useState(project?.environment || 'production');

  const handleSave = () => {
    updateProject.mutate({
      id: project.id,
      name,
      description,
      environment,
    }, {
      onSuccess: () => { onClose(); onSuccess(); },
    });
  };

  return (
    <SlideOver open={open} onClose={onClose} title="Edit Project" description="Update project settings">
      <div className="space-y-5">
        <FormField label="Project Name">
          <FormInput value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </FormField>
        <FormField label="Description">
          <FormTextarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </FormField>
        <FormField label="Environment">
          <FormSelect value={environment} onChange={(e) => setEnvironment(e.target.value)}>
            <option value="production">Production</option>
            <option value="staging">Staging</option>
            <option value="development">Development</option>
          </FormSelect>
        </FormField>

        <button
          onClick={handleSave}
          disabled={!name || updateProject.isPending}
          className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {updateProject.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Settings2 className="w-4 h-4" />}
          {updateProject.isPending ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </SlideOver>
  );
}
