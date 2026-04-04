'use client';

import { useState } from 'react';
import {
  Plus,
  Bell,
  MessageSquare,
  Mail,
  Webhook,
  Send,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Loader2,
  Zap,
  Clock,
} from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { SlideOver, FormField, FormInput, FormSelect } from '@/components/slide-over';
import { formatDistanceToNow } from 'date-fns';

const typeIcons: Record<string, typeof MessageSquare> = {
  slack: MessageSquare,
  discord: MessageSquare,
  email: Mail,
  webhook: Webhook,
  telegram: Send,
};

const typeColors: Record<string, string> = {
  slack: 'from-[#4A154B]/30 to-[#4A154B]/10 border-[#4A154B]/20',
  discord: 'from-[#5865F2]/20 to-[#5865F2]/10 border-[#5865F2]/20',
  email: 'from-brand-500/20 to-brand-600/10 border-brand-500/10',
  webhook: 'from-accent-500/20 to-accent-600/10 border-accent-500/10',
  telegram: 'from-[#0088cc]/20 to-[#0088cc]/10 border-[#0088cc]/20',
};

const eventLabels: Record<string, { label: string; color: string }> = {
  deploy_success: { label: 'Deploy Success', color: 'bg-success-500/10 text-success-400 border-success-500/20' },
  deploy_fail: { label: 'Deploy Failed', color: 'bg-danger-500/10 text-danger-400 border-danger-500/20' },
  service_down: { label: 'Service Down', color: 'bg-danger-500/10 text-danger-400 border-danger-500/20' },
  service_up: { label: 'Service Up', color: 'bg-success-500/10 text-success-400 border-success-500/20' },
  node_offline: { label: 'Node Offline', color: 'bg-danger-500/10 text-danger-400 border-danger-500/20' },
  node_online: { label: 'Node Online', color: 'bg-success-500/10 text-success-400 border-success-500/20' },
  build_fail: { label: 'Build Failed', color: 'bg-warning-500/10 text-warning-500 border-warning-500/20' },
  certificate_expiring: { label: 'Cert Expiring', color: 'bg-warning-500/10 text-warning-500 border-warning-500/20' },
};

const allEvents = Object.keys(eventLabels) as (keyof typeof eventLabels)[];

export default function NotificationsPage() {
  const { data: channels, isLoading, refetch } = trpc.notification.listChannels.useQuery(undefined, { retry: 1 });
  const { data: auditLogs, isLoading: logsLoading } = trpc.notification.auditLogs.useQuery({ limit: 30 }, { retry: 1 });
  const toggleChannel = trpc.notification.toggleChannel.useMutation();
  const deleteChannel = trpc.notification.deleteChannel.useMutation();

  const [showAdd, setShowAdd] = useState(false);
  const [tab, setTab] = useState<'channels' | 'activity'>('channels');

  const handleToggle = (id: string) => {
    toggleChannel.mutate({ id }, { onSuccess: () => refetch() });
  };

  const handleDelete = (id: string) => {
    if (!confirm('Delete this notification channel?')) return;
    deleteChannel.mutate({ id }, { onSuccess: () => refetch() });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
          <p className="text-sm text-white/40 mt-1">Configure deployment and system notification channels</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Add Channel
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-white/[0.03] p-1 rounded-lg w-fit">
        {(['channels', 'activity'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-xs font-medium transition-colors capitalize ${
              tab === t ? 'bg-brand-500/20 text-brand-400' : 'text-white/40 hover:text-white/60'
            }`}
          >
            {t === 'activity' ? 'Activity Log' : t}
          </button>
        ))}
      </div>

      {/* ── Channels Tab ───────────────────────────────── */}
      {tab === 'channels' && (
        <>
          {isLoading && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {[...Array(2)].map((_, i) => (
                <div key={i} className="glass-card h-40 animate-pulse" />
              ))}
            </div>
          )}

          {!isLoading && (!channels || channels.length === 0) && (
            <div className="glass-card flex flex-col items-center justify-center py-20">
              <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-5">
                <Bell className="w-8 h-8 text-white/20" />
              </div>
              <h3 className="text-sm font-semibold text-white/60 mb-1">No notification channels</h3>
              <p className="text-xs text-white/30 mb-6 max-w-sm text-center">
                Set up Slack, email, webhook, or Telegram channels to receive alerts for deployments, failures, and outages.
              </p>
              <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-2">
                <Plus className="w-4 h-4" />
                Add Channel
              </button>
            </div>
          )}

          {!isLoading && channels && channels.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {channels.map((ch: any) => {
                const Icon = typeIcons[ch.type] || Bell;
                const isEnabled = ch.enabled === 'true';
                return (
                  <div key={ch.id} className="glass-card glass-card-hover group">
                    <div className="px-5 py-4 flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${typeColors[ch.type] || typeColors.webhook} flex items-center justify-center border mt-0.5`}>
                          <Icon className="w-5 h-5 text-white/70" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-semibold text-white">{ch.name}</h3>
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${
                              isEnabled ? 'bg-success-500/10 text-success-400' : 'bg-white/5 text-white/30'
                            }`}>
                              {isEnabled ? 'Active' : 'Paused'}
                            </span>
                          </div>
                          <p className="text-[11px] text-white/30 mt-0.5 capitalize">{ch.type}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleToggle(ch.id)}
                          className="text-white/30 hover:text-white/50 transition-colors p-1"
                          title={isEnabled ? 'Pause' : 'Enable'}
                        >
                          {isEnabled ? <ToggleRight className="w-6 h-6 text-brand-400" /> : <ToggleLeft className="w-6 h-6" />}
                        </button>
                        <button
                          onClick={() => handleDelete(ch.id)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-red-500/10 rounded"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-danger-400" />
                        </button>
                      </div>
                    </div>
                    <div className="px-5 pb-4">
                      <p className="text-[10px] text-white/25 uppercase tracking-wider mb-2">Subscribed Events</p>
                      <div className="flex flex-wrap gap-1.5">
                        {ch.rules && ch.rules.length > 0 ? (
                          ch.rules.map((rule: any) => {
                            const ev = eventLabels[rule.event] || { label: rule.event, color: 'bg-white/5 text-white/40 border-white/10' };
                            return (
                              <span key={rule.id} className={`text-[10px] px-2 py-0.5 rounded-full border ${ev.color}`}>
                                {ev.label}
                              </span>
                            );
                          })
                        ) : (
                          <span className="text-[10px] text-white/20">No events subscribed</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── Activity Log Tab ──────────────────────────── */}
      {tab === 'activity' && (
        <div className="glass-card">
          <div className="px-5 py-4 border-b border-white/5">
            <h2 className="text-sm font-semibold">Activity Log</h2>
            <p className="text-[11px] text-white/30 mt-0.5">Recent administrative actions across your infrastructure</p>
          </div>

          {logsLoading && (
            <div className="p-5 space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-10 bg-white/5 rounded animate-pulse" />
              ))}
            </div>
          )}

          {!logsLoading && (!auditLogs || auditLogs.length === 0) && (
            <div className="flex flex-col items-center justify-center py-16">
              <Clock className="w-10 h-10 text-white/15 mb-3" />
              <p className="text-sm text-white/40">No activity recorded</p>
              <p className="text-xs text-white/20 mt-1">Actions like deployments, node changes, and settings updates appear here</p>
            </div>
          )}

          {!logsLoading && auditLogs && auditLogs.length > 0 && (
            <div className="divide-y divide-white/[0.03]">
              {auditLogs.map((log: any) => (
                <div key={log.id} className="px-5 py-3 flex items-center gap-3 hover:bg-white/[0.02] transition-colors">
                  <div className="w-7 h-7 rounded-full bg-white/5 flex items-center justify-center shrink-0">
                    <Zap className="w-3.5 h-3.5 text-white/25" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white/70">
                      <span className="font-medium text-white/90">{log.user?.name || log.user?.email || 'System'}</span>{' '}
                      <span className="text-white/40">{log.action}</span>{' '}
                      <span className="text-white/50">{log.resourceType}</span>
                    </p>
                  </div>
                  <span className="text-[10px] text-white/20 shrink-0">
                    {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add Channel SlideOver */}
      <AddChannelSlideOver
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onSuccess={() => { setShowAdd(false); refetch(); }}
      />
    </div>
  );
}

// ── Add Channel SlideOver ────────────────────────────────────

function AddChannelSlideOver({ open, onClose, onSuccess }: {
  open: boolean; onClose: () => void; onSuccess: () => void;
}) {
  const createChannel = trpc.notification.createChannel.useMutation();
  const [name, setName] = useState('');
  const [type, setType] = useState<'slack' | 'discord' | 'email' | 'webhook' | 'telegram'>('slack');
  const [target, setTarget] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>(['deploy_success', 'deploy_fail', 'service_down']);

  const handleClose = () => {
    setName(''); setTarget('');
    setType('slack');
    setSelectedEvents(['deploy_success', 'deploy_fail', 'service_down']);
    onClose();
  };

  const toggleEvent = (event: string) => {
    setSelectedEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]
    );
  };

  const targetLabel: Record<string, { label: string; placeholder: string }> = {
    slack: { label: 'Webhook URL', placeholder: 'https://hooks.slack.com/services/...' },
    discord: { label: 'Webhook URL', placeholder: 'https://discord.com/api/webhooks/...' },
    email: { label: 'Email Address', placeholder: 'alerts@example.com' },
    webhook: { label: 'Endpoint URL', placeholder: 'https://api.example.com/webhooks/deploy' },
    telegram: { label: 'Bot Token : Chat ID', placeholder: '123456:ABC-DEF : -1001234567890' },
  };

  const handleCreate = () => {
    if (!name || !target) return;
    createChannel.mutate({
      name,
      type,
      config: { target },
      events: selectedEvents as any,
    }, {
      onSuccess: () => { handleClose(); onSuccess(); },
    });
  };

  const tgt = targetLabel[type] || targetLabel.webhook;

  return (
    <SlideOver open={open} onClose={handleClose} title="Add Notification Channel" description="Get alerted on deployments, failures, and outages">
      <div className="space-y-5">
        <FormField label="Channel Name">
          <FormInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Deploy Alerts" autoFocus />
        </FormField>

        <FormField label="Type">
          <FormSelect value={type} onChange={(e) => setType(e.target.value as any)}>
            <option value="slack">Slack</option>
            <option value="discord">Discord</option>
            <option value="email">Email</option>
            <option value="webhook">Webhook</option>
            <option value="telegram">Telegram</option>
          </FormSelect>
        </FormField>

        <FormField label={tgt.label}>
          <FormInput value={target} onChange={(e) => setTarget(e.target.value)} placeholder={tgt.placeholder} />
        </FormField>

        <div>
          <p className="text-xs text-white/50 font-medium mb-3">Subscribe to Events</p>
          <div className="grid grid-cols-2 gap-2">
            {allEvents.map((event) => {
              const ev = eventLabels[event];
              const isSelected = selectedEvents.includes(event);
              return (
                <button
                  key={event}
                  onClick={() => toggleEvent(event)}
                  className={`text-[11px] px-3 py-2 rounded-lg border transition-all text-left ${
                    isSelected
                      ? 'bg-brand-500/10 border-brand-500/30 text-brand-400'
                      : 'bg-white/[0.02] border-white/[0.06] text-white/40 hover:border-white/10'
                  }`}
                >
                  {ev.label}
                </button>
              );
            })}
          </div>
        </div>

        {createChannel.isError && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-400">
            ✗ {createChannel.error?.message}
          </div>
        )}

        <button
          onClick={handleCreate}
          disabled={!name || !target || createChannel.isPending}
          className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {createChannel.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
          {createChannel.isPending ? 'Creating...' : 'Add Channel'}
        </button>
      </div>
    </SlideOver>
  );
}
