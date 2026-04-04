export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-brand-900/20 via-[#0a0a0a] to-[#0a0a0a]">
      <div className="w-full max-w-md p-6">
        {/* Logo Header */}
        <div className="flex flex-col items-center justify-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center shadow-[0_0_20px_theme(colors.brand.500/20)] mb-4">
            <svg
              className="w-6 h-6 text-brand-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Click-Deploy</h1>
          <p className="text-sm text-white/40 mt-1">Self-Hosted PaaS</p>
        </div>

        {/* Card Content */}
        <div className="glass-card p-8 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-brand-500/50 to-transparent" />
          {children}
        </div>
      </div>
    </div>
  );
}
