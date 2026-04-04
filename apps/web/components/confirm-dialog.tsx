'use client';

import { useState, useCallback, createContext, useContext, useRef } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────
interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
}

interface ConfirmContextType {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextType | null>(null);

/** Hook: returns a `confirm()` function that opens the modal dialog. */
export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within <ConfirmProvider>');
  return ctx.confirm;
}

// ── Provider ─────────────────────────────────────────────────

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setOptions(opts);
      setIsOpen(true);
    });
  }, []);

  const handleClose = (result: boolean) => {
    setIsOpen(false);
    setTimeout(() => {
      resolveRef.current?.(result);
      resolveRef.current = null;
      setOptions(null);
    }, 200); // wait for exit animation
  };

  const variantStyles = {
    danger: {
      icon: 'bg-red-500/10 text-red-400 border-red-500/20',
      button: 'bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30',
    },
    warning: {
      icon: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      button: 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border border-amber-500/30',
    },
    info: {
      icon: 'bg-brand-500/10 text-brand-400 border-brand-500/20',
      button: 'bg-brand-500/20 text-brand-400 hover:bg-brand-500/30 border border-brand-500/30',
    },
  };

  const v = options?.variant || 'danger';
  const styles = variantStyles[v];

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}

      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center"
          onClick={() => handleClose(false)}
        >
          {/* Overlay */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" />

          {/* Dialog */}
          <div
            className="relative z-10 w-full max-w-sm mx-4 animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="glass-card border border-white/10 shadow-2xl shadow-black/40 overflow-hidden">
              {/* Header */}
              <div className="px-5 pt-5 pb-0 flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-lg border flex items-center justify-center shrink-0 ${styles.icon}`}>
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">{options?.title}</h3>
                    <p className="text-xs text-white/40 mt-1 leading-relaxed">{options?.message}</p>
                  </div>
                </div>
                <button
                  onClick={() => handleClose(false)}
                  className="p-1 hover:bg-white/5 rounded text-white/30 hover:text-white/60 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Actions */}
              <div className="px-5 py-4 flex items-center justify-end gap-2 mt-2">
                <button
                  onClick={() => handleClose(false)}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-white/50 hover:text-white/70 hover:bg-white/5 transition-colors"
                >
                  {options?.cancelText || 'Cancel'}
                </button>
                <button
                  onClick={() => handleClose(true)}
                  className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${styles.button}`}
                >
                  {options?.confirmText || 'Confirm'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
