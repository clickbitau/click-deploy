import { ReactNode } from 'react';
import { Plus } from 'lucide-react';

interface EmptyStateProps {
  icon: React.ElementType;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  actionIcon?: React.ElementType;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  actionIcon: ActionIcon = Plus,
}: EmptyStateProps) {
  return (
    <div className="glass-card flex flex-col items-center justify-center py-20 px-6 border border-white/[0.05] relative overflow-hidden group">
      {/* Neo-morphic Glow Background */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 bg-brand-500/10 rounded-full blur-[80px] opacity-0 group-hover:opacity-100 transition-opacity duration-1000 pointer-events-none" />
      
      {/* Icon Frame */}
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-white/5 to-white/[0.02] border border-white/10 flex items-center justify-center mb-6 shadow-2xl relative z-10">
        <Icon className="w-8 h-8 text-brand-400/80 drop-shadow-[0_0_15px_rgba(var(--brand-rgb),0.5)]" />
      </div>

      <h3 className="text-base font-semibold text-white tracking-tight mb-2 relative z-10">{title}</h3>
      <p className="text-sm text-white/40 mb-8 max-w-sm text-center leading-relaxed relative z-10">
        {description}
      </p>

      {actionLabel && onAction && (
        <button 
          onClick={onAction} 
          className="btn-primary flex items-center gap-2 shadow-[0_0_20px_rgba(var(--brand-rgb),0.3)] hover:shadow-[0_0_30px_rgba(var(--brand-rgb),0.5)] transition-all relative z-10"
        >
          <ActionIcon className="w-4 h-4" />
          {actionLabel}
        </button>
      )}
    </div>
  );
}
