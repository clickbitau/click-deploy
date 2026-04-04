'use client';

import { useState, useRef, useEffect, useCallback, createContext, useContext } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bell,
  CheckCheck,
  Rocket,
  Server,
  Globe,
  AlertTriangle,
  CheckCircle2,
  Info,
  XCircle,
  Zap,
  X,
  ExternalLink,
  Filter,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { supabase } from '@/lib/supabase';
import { formatDistanceToNow } from 'date-fns';

// ── Level & Category configs ─────────────────────────────────

const levelConfig: Record<string, { icon: typeof Info; color: string; bg: string; border: string; glow: string }> = {
  info: {
    icon: Info,
    color: 'text-brand-400',
    bg: 'bg-brand-500/10',
    border: 'border-brand-500/20',
    glow: 'shadow-brand-500/20',
  },
  success: {
    icon: CheckCircle2,
    color: 'text-success-400',
    bg: 'bg-success-500/10',
    border: 'border-success-500/20',
    glow: 'shadow-success-500/20',
  },
  warning: {
    icon: AlertTriangle,
    color: 'text-warning-500',
    bg: 'bg-warning-500/10',
    border: 'border-warning-500/20',
    glow: 'shadow-warning-500/20',
  },
  error: {
    icon: XCircle,
    color: 'text-danger-400',
    bg: 'bg-danger-500/10',
    border: 'border-danger-500/20',
    glow: 'shadow-danger-500/20',
  },
};

const categoryConfig: Record<string, { icon: typeof Rocket; label: string }> = {
  deployment: { icon: Rocket, label: 'Deployment' },
  node: { icon: Server, label: 'Node' },
  domain: { icon: Globe, label: 'Domain' },
  system: { icon: Zap, label: 'System' },
};

// ── Toast System ─────────────────────────────────────────────

interface Toast {
  id: string;
  title: string;
  message?: string;
  level: string;
  category?: string;
  resourceId?: string;
  createdAt: Date;
}

const ToastContext = createContext<{
  addToast: (toast: Omit<Toast, 'id' | 'createdAt'>) => void;
}>({ addToast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const router = useRouter();

  const addToast = useCallback((toast: Omit<Toast, 'id' | 'createdAt'>) => {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev, { ...toast, id, createdAt: new Date() }]);
    // Auto-dismiss after 6 seconds
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 6000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const handleToastClick = useCallback((toast: Toast) => {
    dismissToast(toast.id);
    if (toast.category === 'deployment' && toast.resourceId) {
      router.push(`/dashboard/deployments/${toast.resourceId}`);
    } else if (toast.category === 'node') {
      router.push('/dashboard/nodes');
    } else if (toast.category === 'domain') {
      router.push('/dashboard/domains');
    }
  }, [router, dismissToast]);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}

      {/* Toast Container */}
      <div className="fixed bottom-6 right-6 z-[100] flex flex-col-reverse gap-3 pointer-events-none">
        {toasts.map((toast, i) => {
          const cfg = levelConfig[toast.level] || levelConfig.info;
          const LevelIcon = cfg.icon;
          const catCfg = categoryConfig[toast.category || 'system'] || categoryConfig.system;

          return (
            <div
              key={toast.id}
              className={`pointer-events-auto w-80 rounded-xl border ${cfg.border} bg-[var(--glass-bg)] backdrop-blur-xl shadow-xl ${cfg.glow} animate-toast-in cursor-pointer group`}
              onClick={() => handleToastClick(toast)}
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <div className="p-4 flex gap-3">
                {/* Icon */}
                <div className={`w-9 h-9 rounded-xl ${cfg.bg} flex items-center justify-center shrink-0 shadow-sm`}
                  style={{ boxShadow: 'var(--glass-shadow)' }}>
                  <LevelIcon className={`w-4.5 h-4.5 ${cfg.color}`} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-white/90 truncate">{toast.title}</p>
                    <button
                      onClick={(e) => { e.stopPropagation(); dismissToast(toast.id); }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-white/10 shrink-0 ml-2"
                    >
                      <X className="w-3 h-3 text-white/30" />
                    </button>
                  </div>
                  {toast.message && (
                    <p className="text-[11px] text-white/40 mt-0.5 truncate">{toast.message}</p>
                  )}
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <span className={`text-[9px] font-bold uppercase tracking-wider ${cfg.color}`}>
                      {catCfg.label}
                    </span>
                    <span className="text-[9px] text-white/15">·</span>
                    <span className="text-[9px] text-white/20">just now</span>
                  </div>
                </div>
              </div>

              {/* Progress bar */}
              <div className="h-0.5 bg-white/5 rounded-b-xl overflow-hidden">
                <div className={`h-full ${cfg.bg.replace('/10', '/40')} animate-toast-progress`} />
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

// ── Notification Bell ────────────────────────────────────────

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const prevCountRef = useRef(0);
  const { addToast } = useToast();

  const { data: unreadCount = 0 } = trpc.notification.inAppUnreadCount.useQuery(
    undefined,
    { retry: 1, refetchInterval: 60000 }, // Slow poll as fallback; realtime is primary
  );
  const { data: notifications, refetch } = trpc.notification.inAppList.useQuery(
    { limit: 50 },
    { retry: 1, refetchInterval: 60000 },
  );
  const markRead = trpc.notification.inAppMarkRead.useMutation();
  const utils = trpc.useUtils();

  // Supabase Realtime: instant notification updates
  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel('notif-bell')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'in_app_notifications' },
        () => {
          utils.notification.inAppUnreadCount.invalidate();
          refetch();
        }
      )
      .subscribe();
    return () => { supabase?.removeChannel(channel); };
  }, [utils, refetch]);

  // Toast on new notifications
  useEffect(() => {
    if (notifications && notifications.length > 0 && prevCountRef.current > 0) {
      const newCount = unreadCount;
      if (newCount > prevCountRef.current) {
        // Find the newest unread notification
        const newest = notifications.find((n: any) => !n.readAt);
        if (newest) {
          addToast({
            title: (newest as any).title,
            message: (newest as any).message,
            level: (newest as any).level,
            category: (newest as any).category,
            resourceId: (newest as any).resourceId ?? undefined,
          });
        }
      }
    }
    prevCountRef.current = unreadCount;
  }, [unreadCount, notifications, addToast]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const handleMarkAllRead = () => {
    markRead.mutate({ all: true }, {
      onSuccess: () => {
        utils.notification.inAppUnreadCount.invalidate();
        refetch();
      },
    });
  };

  const handleMarkOneRead = (id: string) => {
    markRead.mutate({ id }, {
      onSuccess: () => {
        utils.notification.inAppUnreadCount.invalidate();
        refetch();
      },
    });
  };

  const handleClick = (notif: any) => {
    if (!notif.readAt) {
      handleMarkOneRead(notif.id);
    }

    if (notif.category === 'deployment' && notif.resourceId) {
      router.push(`/dashboard/deployments/${notif.resourceId}`);
    } else if (notif.category === 'node') {
      router.push('/dashboard/nodes');
    } else if (notif.category === 'domain') {
      router.push('/dashboard/domains');
    }

    setOpen(false);
  };

  // Group notifications by date
  const filteredNotifications = (notifications || []).filter((n: any) =>
    filter ? n.category === filter : true
  );

  const todayNotifs = filteredNotifications.filter((n: any) => {
    const d = new Date(n.createdAt);
    const today = new Date();
    return d.toDateString() === today.toDateString();
  });

  const olderNotifs = filteredNotifications.filter((n: any) => {
    const d = new Date(n.createdAt);
    const today = new Date();
    return d.toDateString() !== today.toDateString();
  });

  const categories = ['deployment', 'node', 'domain', 'system'];

  return (
    <div className="relative">
      {/* Bell Button */}
      <button
        ref={buttonRef}
        onClick={() => setOpen(!open)}
        className={`relative p-2.5 rounded-xl transition-all duration-200 ${
          open
            ? 'bg-brand-500/10 text-brand-400'
            : 'text-white/40 hover:text-white/70 hover:bg-white/5'
        }`}
        style={{ boxShadow: open ? 'var(--glass-shadow-inset)' : 'var(--glass-shadow)' }}
        title="Notifications"
        id="notification-bell"
      >
        <Bell className={`w-4.5 h-4.5 transition-transform duration-200 ${open ? 'scale-110' : ''}`} />
        {unreadCount > 0 && (
          <>
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-danger-500 text-white text-[9px] font-bold flex items-center justify-center shadow-lg shadow-danger-500/40 border-2 border-[var(--bg-base)]">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-danger-500 animate-ping opacity-25" />
          </>
        )}
      </button>

      {/* Notification Panel */}
      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

          {/* Panel */}
          <div
            ref={panelRef}
            className="absolute bottom-full left-0 mb-3 w-[380px] max-h-[520px] rounded-2xl border border-white/10 bg-[var(--glass-bg)] backdrop-blur-xl flex flex-col animate-fade-in z-50"
            style={{ boxShadow: 'var(--glass-shadow-hover)' }}
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-white/5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-brand-500/10 flex items-center justify-center"
                    style={{ boxShadow: 'var(--glass-shadow)' }}>
                    <Bell className="w-3.5 h-3.5 text-brand-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold tracking-tight">Notifications</h3>
                    {unreadCount > 0 && (
                      <p className="text-[10px] text-white/30">{unreadCount} unread</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {unreadCount > 0 && (
                    <button
                      onClick={handleMarkAllRead}
                      disabled={markRead.isPending}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold text-brand-400 hover:bg-brand-500/10 transition-all disabled:opacity-50"
                      style={{ boxShadow: 'var(--glass-shadow)' }}
                    >
                      <CheckCheck className="w-3 h-3" />
                      Read all
                    </button>
                  )}
                  <button
                    onClick={() => setOpen(false)}
                    className="p-1.5 rounded-lg text-white/30 hover:text-white/60 hover:bg-white/5 transition-all"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Category Filter Chips */}
              <div className="flex gap-1.5">
                <button
                  onClick={() => setFilter(null)}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all ${
                    !filter
                      ? 'text-brand-400 bg-brand-500/10'
                      : 'text-white/30 hover:text-white/50 hover:bg-white/5'
                  }`}
                  style={{ boxShadow: !filter ? 'var(--glass-shadow-inset)' : 'var(--glass-shadow)' }}
                >
                  All
                </button>
                {categories.map(cat => {
                  const cfg = categoryConfig[cat];
                  const CatIcon = cfg?.icon || Zap;
                  return (
                    <button
                      key={cat}
                      onClick={() => setFilter(filter === cat ? null : cat)}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all ${
                        filter === cat
                          ? 'text-brand-400 bg-brand-500/10'
                          : 'text-white/30 hover:text-white/50 hover:bg-white/5'
                      }`}
                      style={{ boxShadow: filter === cat ? 'var(--glass-shadow-inset)' : 'var(--glass-shadow)' }}
                    >
                      <CatIcon className="w-2.5 h-2.5" />
                      {cfg?.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Notification List */}
            <div className="flex-1 overflow-y-auto">
              {filteredNotifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center mb-4"
                    style={{ boxShadow: 'var(--glass-shadow-inset)' }}>
                    <Bell className="w-6 h-6 text-white/10" />
                  </div>
                  <p className="text-xs font-medium text-white/30">No notifications</p>
                  <p className="text-[10px] text-white/15 mt-1">
                    {filter ? 'Try a different filter' : "You're all caught up!"}
                  </p>
                </div>
              ) : (
                <div>
                  {/* Today */}
                  {todayNotifs.length > 0 && (
                    <div>
                      <div className="px-5 py-2 sticky top-0 bg-[var(--glass-bg)]/90 backdrop-blur-sm z-10">
                        <span className="text-[9px] font-bold uppercase tracking-widest text-white/20">Today</span>
                      </div>
                      {todayNotifs.map((notif: any) => (
                        <NotificationItem key={notif.id} notif={notif} onClick={handleClick} />
                      ))}
                    </div>
                  )}

                  {/* Older */}
                  {olderNotifs.length > 0 && (
                    <div>
                      <div className="px-5 py-2 sticky top-0 bg-[var(--glass-bg)]/90 backdrop-blur-sm z-10">
                        <span className="text-[9px] font-bold uppercase tracking-widest text-white/20">Earlier</span>
                      </div>
                      {olderNotifs.map((notif: any) => (
                        <NotificationItem key={notif.id} notif={notif} onClick={handleClick} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-white/5">
              <button
                onClick={() => { router.push('/dashboard/notifications'); setOpen(false); }}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-[11px] font-medium text-white/30 hover:text-white/50 hover:bg-white/5 transition-all"
                style={{ boxShadow: 'var(--glass-shadow)' }}
              >
                View all & manage channels
                <ExternalLink className="w-3 h-3" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Individual Notification Item ─────────────────────────────

function NotificationItem({ notif, onClick }: { notif: any; onClick: (n: any) => void }) {
  const cfg = levelConfig[notif.level] || levelConfig.info;
  const LevelIcon = cfg.icon;
  const catCfg = categoryConfig[notif.category] || categoryConfig.system;
  const CategoryIcon = catCfg.icon;
  const isUnread = !notif.readAt;

  return (
    <button
      onClick={() => onClick(notif)}
      className={`w-full text-left px-5 py-3.5 hover:bg-white/[0.03] transition-all flex gap-3 group relative ${
        isUnread ? '' : 'opacity-60'
      }`}
    >
      {/* Unread indicator line */}
      {isUnread && (
        <div className={`absolute left-0 top-3 bottom-3 w-0.5 rounded-r ${cfg.bg.replace('/10', '/60')}`} />
      )}

      {/* Icon */}
      <div className={`w-9 h-9 rounded-xl ${cfg.bg} border ${cfg.border} flex items-center justify-center shrink-0`}
        style={{ boxShadow: 'var(--glass-shadow)' }}>
        <LevelIcon className={`w-4 h-4 ${cfg.color}`} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className={`text-xs font-semibold leading-relaxed ${isUnread ? 'text-white/90' : 'text-white/50'}`}>
            {notif.title}
          </p>
          <span className="text-[9px] text-white/15 shrink-0 mt-0.5 font-mono">
            {formatDistanceToNow(new Date(notif.createdAt), { addSuffix: false })}
          </span>
        </div>
        {notif.message && (
          <p className="text-[11px] text-white/30 mt-0.5 line-clamp-2 leading-relaxed">{notif.message}</p>
        )}
        <div className="flex items-center gap-2 mt-1.5">
          <div className="flex items-center gap-1">
            <CategoryIcon className="w-2.5 h-2.5 text-white/15" />
            <span className="text-[9px] text-white/20 font-medium">{catCfg.label}</span>
          </div>
          {isUnread && (
            <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
          )}
        </div>
      </div>
    </button>
  );
}
