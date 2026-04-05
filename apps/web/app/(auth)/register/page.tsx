'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signUp, signIn } from '@/lib/auth-client';
import { toast } from 'sonner';
import { Github } from 'lucide-react';

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orgName, setOrgName] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const result = await signUp.email({
        email,
        password,
        name,
      });

      if (result.error) {
        toast.error(result.error.message || 'Registration failed');
        return;
      }

      // Create organization for the user
      // NOTE: userId is intentionally omitted — the server reads it from the session
      // established by signUp.email() above. This prevents account hijacking.
      const setupRes = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          orgName: orgName || `${name}'s Org`,
          orgSlug: (orgName || name).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        }),
      });

      if (!setupRes.ok) {
        const err = await setupRes.json();
        toast.error(err.error || 'Organization setup failed');
        return;
      }

      toast.success('Account created successfully');
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      toast.error('An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGitHubSignUp = async () => {
    try {
      await signIn.social({
        provider: 'github',
        callbackURL: '/dashboard',
      });
    } catch {
      toast.error('GitHub sign-up failed');
    }
  };

  return (
    <div>
      <div className="text-center mb-8">
        <h2 className="text-xl font-semibold text-white">Create an account</h2>
        <p className="text-sm text-white/40 mt-1">Get started with Click-Deploy</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-white/60 mb-1.5 ml-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/50 transition-all"
            placeholder="Admin User"
            required
            disabled={isLoading}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-white/60 mb-1.5 ml-1">Organization</label>
          <input
            type="text"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/50 transition-all"
            placeholder="My Company"
            disabled={isLoading}
          />
          <p className="text-[10px] text-white/25 mt-1 ml-1">Optional — defaults to your name</p>
        </div>

        <div>
          <label className="block text-xs font-medium text-white/60 mb-1.5 ml-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/50 transition-all"
            placeholder="admin@example.com"
            required
            disabled={isLoading}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-white/60 mb-1.5 ml-1">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/50 transition-all"
            placeholder="••••••••"
            required
            minLength={8}
            disabled={isLoading}
          />
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full bg-brand-500 hover:bg-brand-400 text-white font-medium py-2.5 rounded-lg text-sm transition-colors mt-2"
        >
          {isLoading ? 'Creating account...' : 'Sign Up'}
        </button>
      </form>

      <div className="relative my-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-white/10" />
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="bg-surface-800 px-3 text-white/30">or continue with</span>
        </div>
      </div>

      <button
        onClick={handleGitHubSignUp}
        type="button"
        className="w-full flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
      >
        <Github className="w-4 h-4" />
        GitHub
      </button>

      <div className="mt-6 text-center">
        <p className="text-xs text-white/40">
          Already have an account?{' '}
          <Link href="/login" className="text-brand-400 hover:text-brand-300 transition-colors">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
