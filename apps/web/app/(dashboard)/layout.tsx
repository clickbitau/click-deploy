'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  FolderKanban,
  Rocket,
  Server,
  Globe,
  Shield,
  Container,
  Settings,
  Activity,
  CloudCog,
  Bell,
  ChevronDown,
  LogOut,
  User,
  Plus,
  Zap,
  Camera,
  Save,
  Loader2,
  CheckCircle,
  XCircle,
  Lock,
  X,
} from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { NotificationBell, ToastProvider } from '@/components/notification-bell';
import { signOut } from '@/lib/auth-client';
import { UpdateNotification } from '@/components/update-notification';
import { ConfirmProvider } from '@/components/confirm-dialog';
import { trpc } from '@/lib/trpc';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Projects', href: '/dashboard/projects', icon: FolderKanban },
  { name: 'Deployments', href: '/dashboard/deployments', icon: Rocket },
  { name: 'Nodes', href: '/dashboard/nodes', icon: Server },
  { name: 'Domains', href: '/dashboard/domains', icon: Globe },
  { name: 'Tunnels', href: '/dashboard/tunnels', icon: CloudCog },
  { name: 'Registry', href: '/dashboard/registry', icon: Container },
  { name: 'Monitoring', href: '/dashboard/monitoring', icon: Activity },
  { name: 'Infrastructure', href: '/dashboard/infrastructure', icon: Server },
];

const secondaryNav = [
  { name: 'Notifications', href: '/dashboard/notifications', icon: Bell },
  { name: 'Settings', href: '/dashboard/settings', icon: Settings },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  useRealtimeSync();

  const isActive = (href: string) => {
    if (href === '/dashboard') return pathname === '/dashboard';
    return pathname.startsWith(href);
  };

  return (
    <ConfirmProvider>
    <ToastProvider>
    <div className="flex h-screen overflow-hidden">
      {/* ── Sidebar ─────────────────────────────────── */}
      <aside className="sidebar w-64 flex flex-col h-full shrink-0">
        {/* Logo */}
        <div className="px-5 py-5 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center shadow-lg">
            <Zap className="w-4.5 h-4.5 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white tracking-tight">Click-Deploy</h1>
            <p className="text-[10px] text-white/30 font-medium uppercase tracking-wider">Platform</p>
          </div>
        </div>

        {/* Quick deploy button */}
        <div className="px-3 mb-2">
          <Link href="/dashboard/projects" className="btn-primary w-full flex items-center justify-center gap-2 py-2.5">
            <Plus className="w-4 h-4" />
            <span>New Project</span>
          </Link>
        </div>

        {/* Main navigation */}
        <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
          {navigation.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`sidebar-item ${active ? 'active' : ''}`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.name}</span>
              </Link>
            );
          })}

          <div className="!my-3 h-px bg-white/5" />

          {secondaryNav.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`sidebar-item ${active ? 'active' : ''}`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>

        {/* Update Notification */}
        <div className="px-3 mb-2 flex justify-center">
          <UpdateNotification />
        </div>

        {/* User section */}
        <div className="px-3 pb-4 mt-auto">
          <div className="flex items-center justify-between px-2 mb-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-white/40 uppercase tracking-widest">Theme</span>
              <ThemeToggle />
            </div>
            <NotificationBell />
          </div>
          <UserCard />
          {/* auto-deploy-test-ping-v1 */}
        </div>
      </aside>

      {/* ── Main Content ────────────────────────────── */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-6 lg:p-8 max-w-[1600px] mx-auto animate-fade-in">
          {children}
        </div>
      </main>
    </div>
    </ToastProvider>
    </ConfirmProvider>
  );
}

function UserCard() {
  const router = useRouter();
  const [user, setUser] = useState<{ name?: string; email?: string; image?: string } | null>(null);
  const [showProfile, setShowProfile] = useState(false);

  useEffect(() => {
    fetch('/api/auth/get-session', { credentials: 'include' })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data?.user) {
          setUser({ name: data.user.name, email: data.user.email, image: data.user.image });
        }
      })
      .catch(() => {});
  }, []);

  const handleSignOut = async () => {
    await signOut();
    router.push('/login');
    router.refresh();
  };

  const initials = user?.name
    ? user.name.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)
    : '?';

  return (
    <>
      <div
        onClick={() => setShowProfile(true)}
        className="glass-card p-3 flex items-center gap-3 group cursor-pointer hover:bg-white/[0.02]"
      >
        {user?.image ? (
          <img src={user.image} alt="Avatar" className="w-8 h-8 rounded-full object-cover shrink-0" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-accent-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
            {initials}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white/80 truncate">{user?.name || 'Loading...'}</p>
          <p className="text-[11px] text-white/30 truncate">{user?.email || ''}</p>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); handleSignOut(); }}
          className="p-1 rounded hover:bg-white/5 text-white/20 hover:text-danger-400 transition-colors shrink-0"
          title="Sign out"
        >
          <LogOut className="w-3.5 h-3.5" />
        </button>
      </div>

      {showProfile && (
        <ProfileModal
          user={user}
          onClose={() => setShowProfile(false)}
          onUpdate={(u) => setUser(u)}
          onSignOut={handleSignOut}
        />
      )}
    </>
  );
}

// ── Profile Modal ─────────────────────────────────────────────
function ProfileModal({ user, onClose, onUpdate, onSignOut }: {
  user: { name?: string; email?: string; image?: string } | null;
  onClose: () => void;
  onUpdate: (u: any) => void;
  onSignOut: () => void;
}) {
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [image, setImage] = useState(user?.image || '');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [changingPwd, setChangingPwd] = useState(false);
  const [pwdFeedback, setPwdFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const updateProfileMutation = trpc.system.updateProfile.useMutation();

  const handleAvatarUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e: any) => {
      const file = e.target?.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = 128; canvas.height = 128;
          const ctx = canvas.getContext('2d')!;
          const s = Math.min(img.width, img.height);
          const sx = (img.width - s) / 2, sy = (img.height - s) / 2;
          ctx.drawImage(img, sx, sy, s, s, 0, 0, 128, 128);
          setImage(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.src = ev.target?.result as string;
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const handleSave = async () => {
    if (!name) { setFeedback({ type: 'error', msg: 'Name is required' }); return; }
    setSaving(true);
    setFeedback(null);
    try {
      await updateProfileMutation.mutateAsync({ name, email, image: image || undefined });
      onUpdate({ name, email, image });
      setFeedback({ type: 'success', msg: 'Profile updated' });
      setTimeout(() => setFeedback(null), 3000);
    } catch (err: any) {
      setFeedback({ type: 'error', msg: err.message || 'Failed' });
    } finally {
      setSaving(false);
    }
  };

  const changePasswordMutation = trpc.system.changePassword.useMutation();

  const handleChangePassword = async () => {
    if (!currentPwd || !newPwd) { setPwdFeedback({ type: 'error', msg: 'Fill both fields' }); return; }
    if (newPwd.length < 8) { setPwdFeedback({ type: 'error', msg: 'Min 8 characters' }); return; }
    setChangingPwd(true);
    setPwdFeedback(null);
    try {
      await changePasswordMutation.mutateAsync({ currentPassword: currentPwd, newPassword: newPwd });
      setPwdFeedback({ type: 'success', msg: 'Password updated' });
      setCurrentPwd(''); setNewPwd('');
      setTimeout(() => setPwdFeedback(null), 3000);
    } catch (err: any) {
      setPwdFeedback({ type: 'error', msg: err.message || 'Error' });
    } finally {
      setChangingPwd(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md mx-4 glass-card border border-white/10 rounded-2xl shadow-2xl shadow-black/50 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/5">
          <h2 className="text-sm font-semibold">My Account</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/5 text-white/30 hover:text-white/60 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Avatar */}
          <div className="flex items-center gap-4">
            <div className="relative group cursor-pointer" onClick={handleAvatarUpload}>
              {image ? (
                <img src={image} alt="Avatar" className="w-14 h-14 rounded-full object-cover shadow-lg" />
              ) : (
                <div className="w-14 h-14 rounded-full bg-gradient-to-br from-brand-500 to-accent-500 flex items-center justify-center text-white text-xl font-bold shadow-lg">
                  {name?.[0]?.toUpperCase() || 'U'}
                </div>
              )}
              <div className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <Camera className="w-4 h-4 text-white" />
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold">{name || 'User'}</p>
              <p className="text-[11px] text-white/30">{email}</p>
              <button onClick={handleAvatarUpload} className="text-[10px] text-brand-400 hover:text-brand-300 mt-0.5">
                Change avatar
              </button>
            </div>
          </div>

          {/* Name + Email */}
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] font-medium text-white/50 mb-1">Display Name</label>
              <input value={name} onChange={e => setName(e.target.value)}
                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500/50 transition-all" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-white/50 mb-1">Email</label>
              <input value={email} onChange={e => setEmail(e.target.value)} type="email"
                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500/50 transition-all" />
            </div>
          </div>

          {feedback && (
            <div className={`text-xs px-3 py-2 rounded-lg flex items-center gap-2 ${
              feedback.type === 'success' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
            }`}>
              {feedback.type === 'success' ? <CheckCircle className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
              {feedback.msg}
            </div>
          )}

          <button onClick={handleSave} disabled={saving}
            className="btn-primary w-full flex items-center justify-center gap-2 py-2 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving...' : 'Save Profile'}
          </button>

          {/* Password */}
          <div className="pt-3 border-t border-white/5">
            <h3 className="text-xs font-semibold text-white/60 mb-3 flex items-center gap-1.5">
              <Lock className="w-3 h-3" /> Change Password
            </h3>
            <div className="space-y-2">
              <input type="password" value={currentPwd} onChange={e => setCurrentPwd(e.target.value)}
                placeholder="Current Password"
                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-brand-500/50" />
              <input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)}
                placeholder="New Password (min 8 chars)"
                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-brand-500/50" />
            </div>

            {pwdFeedback && (
              <div className={`mt-2 text-xs px-3 py-2 rounded-lg flex items-center gap-2 ${
                pwdFeedback.type === 'success' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
              }`}>
                {pwdFeedback.type === 'success' ? <CheckCircle className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                {pwdFeedback.msg}
              </div>
            )}

            <button onClick={handleChangePassword} disabled={changingPwd}
              className="mt-2 w-full px-4 py-2 rounded-lg border border-white/10 text-xs text-white/60 hover:bg-white/5 transition-colors flex items-center justify-center gap-2 disabled:opacity-50">
              {changingPwd ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
              {changingPwd ? 'Updating...' : 'Update Password'}
            </button>
          </div>

          {/* Sign Out */}
          <button onClick={onSignOut}
            className="w-full px-4 py-2 rounded-lg border border-red-500/20 text-xs text-red-400 hover:bg-red-500/10 transition-colors flex items-center justify-center gap-2">
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
