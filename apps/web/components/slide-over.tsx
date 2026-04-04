'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface SlideOverProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  width?: 'sm' | 'md' | 'lg';
}

export function SlideOver({ open, onClose, title, description, children, width = 'md' }: SlideOverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (!open) return;
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  const widthClass = width === 'sm' ? 'max-w-sm' : width === 'lg' ? 'max-w-lg' : 'max-w-md';

  return createPortal(
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />
      {/* Panel */}
      <div
        ref={panelRef}
        className={`absolute right-0 top-0 h-full ${widthClass} w-full bg-[var(--bg-surface)] border-l border-[var(--border-subtle)] shadow-[var(--glass-shadow)] flex flex-col animate-slide-in-right`}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-[var(--border-subtle)] flex items-start justify-between shrink-0">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-base)]">{title}</h2>
            {description && <p className="text-xs text-[var(--text-muted)] mt-1">{description}</p>}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-[var(--text-muted)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Form field helpers ───────────────────────────────────────

export function FormField({ label, hint, error, children }: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">{label}</label>
      {children}
      {hint && !error && <p className="text-[11px] text-[var(--text-muted)] opacity-75 mt-1">{hint}</p>}
      {error && <p className="text-[11px] text-danger-500 mt-1">{error}</p>}
    </div>
  );
}

export function FormInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full bg-[var(--bg-base)] shadow-[var(--glass-shadow-inset)] border border-[var(--border-subtle)] rounded-lg px-4 py-2.5 text-sm text-[var(--text-base)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--brand)] transition-all ${props.className || ''}`}
    />
  );
}

export function FormSelect({ children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full bg-[var(--bg-base)] shadow-[var(--glass-shadow-inset)] border border-[var(--border-subtle)] rounded-lg px-4 py-2.5 text-sm text-[var(--text-base)] focus:outline-none focus:ring-1 focus:ring-[var(--brand)] transition-all ${props.className || ''}`}
    >
      {children}
    </select>
  );
}

export function FormTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full bg-[var(--bg-base)] shadow-[var(--glass-shadow-inset)] border border-[var(--border-subtle)] rounded-lg px-4 py-2.5 text-sm text-[var(--text-base)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--brand)] transition-all resize-none ${props.className || ''}`}
    />
  );
}
