'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn } from '@/lib/auth-client';
import { toast } from 'sonner';
import { Github } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const result = await signIn.email({
        email,
        password,
      });

      if (result.error) {
        toast.error(result.error.message || 'Login failed');
      } else {
        toast.success('Successfully logged in');
        router.push('/dashboard');
        router.refresh();
      }
    } catch (err) {
      toast.error('An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGitHubSignIn = async () => {
    try {
      await signIn.social({
        provider: 'github',
        callbackURL: '/dashboard',
      });
    } catch {
      toast.error('GitHub sign-in failed');
    }
  };

  return (
    <div>
      <div className="text-center mb-8">
        <h2 className="text-xl font-semibold text-white">Welcome back</h2>
        <p className="text-sm text-white/40 mt-1">Sign in to your account</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
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
            disabled={isLoading}
          />
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full bg-brand-500 hover:bg-brand-400 text-white font-medium py-2.5 rounded-lg text-sm transition-colors mt-2"
        >
          {isLoading ? 'Signing in...' : 'Sign In'}
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
        onClick={handleGitHubSignIn}
        type="button"
        className="w-full flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
      >
        <Github className="w-4 h-4" />
        GitHub
      </button>

      <div className="mt-6 text-center">
        <p className="text-xs text-white/40">
          Don't have an account?{' '}
          <Link href="/register" className="text-brand-400 hover:text-brand-300 transition-colors">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
