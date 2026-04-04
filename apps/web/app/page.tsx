import Link from 'next/link';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Click-Deploy — Self-Hosted PaaS',
  description: 'Deploy, manage, and scale your applications with a single click. A self-hosted alternative to Heroku, Vercel, and Railway.',
};

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0a0f1c] text-white overflow-hidden">
      {/* Animated background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-brand-500/5 rounded-full blur-[150px]" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-accent-500/5 rounded-full blur-[120px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-brand-600/3 rounded-full blur-[200px]" />
      </div>

      {/* Nav */}
      <nav className="relative z-10 max-w-6xl mx-auto px-6 py-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <span className="text-lg font-bold tracking-tight">Click-Deploy</span>
        </div>
        <div className="flex items-center gap-4">
          <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="text-sm text-white/40 hover:text-white/60 transition-colors hidden sm:block">
            GitHub
          </a>
          <Link href="/login" className="text-sm text-white/50 hover:text-white/70 transition-colors">
            Sign In
          </Link>
          <Link href="/register" className="text-sm px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white font-medium transition-colors">
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative z-10 max-w-4xl mx-auto px-6 pt-20 pb-24 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-500/10 border border-brand-500/20 text-brand-400 text-xs font-medium mb-8">
          <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
          Self-Hosted · Open Source · Free Forever
        </div>

        <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.1] mb-6">
          Deploy anything.
          <br />
          <span className="bg-gradient-to-r from-brand-400 via-brand-500 to-accent-400 bg-clip-text text-transparent">
            Own everything.
          </span>
        </h1>

        <p className="text-lg sm:text-xl text-white/40 max-w-2xl mx-auto mb-10 leading-relaxed">
          A self-hosted PaaS that gives you the power of Heroku, Vercel, and Railway — on your own infrastructure. No vendor lock-in. No surprise bills.
        </p>

        <div className="flex items-center gap-4 justify-center">
          <Link href="/register" className="px-8 py-3.5 bg-gradient-to-r from-brand-500 to-brand-600 rounded-xl text-white font-semibold hover:opacity-90 transition-opacity shadow-lg shadow-brand-500/20 text-sm">
            Start Deploying →
          </Link>
          <a href="#features" className="px-8 py-3.5 bg-white/5 border border-white/10 rounded-xl text-white/60 hover:text-white/80 hover:border-white/20 font-medium transition-all text-sm">
            See Features
          </a>
        </div>

        {/* Terminal mockup */}
        <div className="mt-16 max-w-2xl mx-auto bg-[#0d1117] border border-white/[0.06] rounded-2xl overflow-hidden shadow-2xl shadow-black/40">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
            <div className="w-3 h-3 rounded-full bg-[#ff5f56]" />
            <div className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
            <div className="w-3 h-3 rounded-full bg-[#27c93f]" />
            <span className="ml-3 text-xs text-white/20 font-mono">terminal</span>
          </div>
          <div className="p-6 font-mono text-sm leading-7">
            <div className="text-white/30">
              <span className="text-brand-400">$</span> git push origin main
            </div>
            <div className="text-white/20 mt-1">Enumerating objects: 42, done.</div>
            <div className="text-white/20">Compressing objects: 100%</div>
            <div className="text-success-400 mt-2">
              ✓ Build successful &nbsp;<span className="text-white/20">(12.4s)</span>
            </div>
            <div className="text-success-400">
              ✓ Deployed to production &nbsp;<span className="text-white/20">(3.1s)</span>
            </div>
            <div className="text-brand-400 mt-2">
              → https://app.yourdomain.com &nbsp;<span className="text-white/15">SSL ✓</span>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="relative z-10 max-w-6xl mx-auto px-6 py-24">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">Everything you need to ship</h2>
          <p className="text-lg text-white/40 max-w-2xl mx-auto">
            Built for developers who want full control without the DevOps overhead.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[
            {
              icon: '⚡',
              title: 'One-Click Deploy',
              description: 'Push to git and your app deploys automatically. Or trigger deployments manually from the dashboard.',
            },
            {
              icon: '🔒',
              title: 'Automatic SSL',
              description: 'Free SSL certificates via Let\'s Encrypt, provisioned and renewed automatically for every domain.',
            },
            {
              icon: '🐳',
              title: 'Docker Native',
              description: 'Build from Dockerfile or deploy pre-built images. Full Docker Swarm orchestration under the hood.',
            },
            {
              icon: '🌍',
              title: 'Multi-Node Clusters',
              description: 'Deploy across multiple servers worldwide. Manager, worker, and build nodes for optimal resource usage.',
            },
            {
              icon: '🔄',
              title: 'Instant Rollbacks',
              description: 'Something broke? Roll back to any previous deployment with a single click. Zero-downtime.',
            },
            {
              icon: '📊',
              title: 'Real-Time Monitoring',
              description: 'CPU, memory, and disk usage per node. Health checks, alerts, and uptime tracking built-in.',
            },
            {
              icon: '🔔',
              title: 'Notifications',
              description: 'Get alerted via Slack, Discord, email, or webhooks when deployments succeed, fail, or services go down.',
            },
            {
              icon: '🛡️',
              title: 'Secure by Default',
              description: 'SSH keys encrypted at rest with AES-256-GCM. Webhook signatures verified. No secrets exposed.',
            },
            {
              icon: '🔧',
              title: 'Traefik Integration',
              description: 'Automatic reverse proxy configuration. Add domains and routing rules — Traefik handles the rest.',
            },
          ].map((feature) => (
            <div key={feature.title} className="group p-6 rounded-2xl bg-white/[0.02] border border-white/[0.05] hover:border-white/[0.1] hover:bg-white/[0.03] transition-all duration-300">
              <div className="text-3xl mb-4">{feature.icon}</div>
              <h3 className="text-base font-semibold text-white mb-2 group-hover:text-brand-400 transition-colors">{feature.title}</h3>
              <p className="text-sm text-white/35 leading-relaxed">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="relative z-10 max-w-4xl mx-auto px-6 py-24">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">Three steps. That&apos;s it.</h2>
        </div>

        <div className="space-y-8">
          {[
            { step: '01', title: 'Add Your Server', description: 'Connect any VPS, dedicated server, or cloud instance. Just provide SSH access — we handle the rest.' },
            { step: '02', title: 'Create a Project', description: 'Link your Git repository or Docker image. Configure environment variables, domains, and ports.' },
            { step: '03', title: 'Deploy', description: 'Hit deploy or push to git. Watch your app build, ship, and go live with automatic SSL and routing.' },
          ].map((item) => (
            <div key={item.step} className="flex items-start gap-6 p-6 rounded-2xl bg-white/[0.02] border border-white/[0.05]">
              <div className="text-3xl font-bold text-brand-500/30 shrink-0">{item.step}</div>
              <div>
                <h3 className="text-lg font-semibold mb-1">{item.title}</h3>
                <p className="text-sm text-white/35 leading-relaxed">{item.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="relative z-10 max-w-4xl mx-auto px-6 py-24 text-center">
        <div className="p-12 rounded-3xl bg-gradient-to-br from-brand-500/10 to-accent-500/5 border border-brand-500/10">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
            Ready to own your infrastructure?
          </h2>
          <p className="text-lg text-white/40 mb-8 max-w-xl mx-auto">
            No credit card required. No vendor lock-in. Deploy on your servers, your way.
          </p>
          <Link href="/register" className="inline-flex px-8 py-3.5 bg-gradient-to-r from-brand-500 to-brand-600 rounded-xl text-white font-semibold hover:opacity-90 transition-opacity shadow-lg shadow-brand-500/20 text-sm">
            Get Started for Free →
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 max-w-6xl mx-auto px-6 py-12 border-t border-white/[0.05]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-md bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <span className="text-sm font-semibold text-white/50">Click-Deploy</span>
          </div>
          <p className="text-xs text-white/20">
            Self-hosted PaaS · Built with Next.js, tRPC, Docker, and Traefik
          </p>
        </div>
      </footer>
    </div>
  );
}
