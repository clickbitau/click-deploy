'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { RefreshCcw, BellRing, Sparkles, Loader2, X, GitCommit } from 'lucide-react';
import { SlideOver } from './slide-over';

export function UpdateNotification() {
  const [showModal, setShowModal] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  // Poll every 6 hours (6 * 60 * 60 * 1000)
  const { data, isLoading } = trpc.system.checkUpdate.useQuery(undefined, {
    refetchInterval: 21600000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const triggerUpdate = trpc.system.triggerUpdate.useMutation();

  const handleUpdate = () => {
    setIsUpdating(true);
    triggerUpdate.mutate(undefined, {
      onSuccess: () => {
        // We do not close the modal or reset isUpdating immediately, 
        // because the dashboard will restart and connection will be lost.
        // We'll show a persistent message instead.
      },
      onError: (err) => {
        setIsUpdating(false);
        alert('Update failed: ' + err.message);
      }
    });
  };

  // Mocking true for testing
  const isAvailable = process.env.NODE_ENV === 'development' ? true : data?.updateAvailable;
  
  if (!isAvailable) return null;

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-full bg-brand-500/10 text-brand-400 border border-brand-500/20 hover:bg-brand-500/20 transition-all hover:scale-105"
      >
        <Sparkles className="w-3.5 h-3.5 animate-pulse" />
        Update Available
      </button>

      <SlideOver
        open={showModal}
        onClose={() => { if (!isUpdating) setShowModal(false); }}
        title="Platform Update Available"
        description="A new version of Click-Deploy is ready to install."
      >
        <div className="space-y-6">
          <div className="bg-brand-500/10 border border-brand-500/20 rounded-xl p-4 flex gap-3 text-brand-300 text-sm">
            <RefreshCcw className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <p>
              Applying this update will download the latest code from the main repository and rebuild the dashboard container. 
              <strong> During this process, your dashboard will be temporarily unavailable for roughly 1-2 minutes.</strong> Your deployed applications and services will remain running completely unaffected.
            </p>
          </div>

          <div>
            <h4 className="text-sm font-semibold mb-3">Incoming Changes:</h4>
            <div className="space-y-2 max-h-64 overflow-y-auto pr-2 custom-scrollbar">
              {(data?.commits || ['a1b2c3d Updated platform UI with one-click update feature']).map((commit, i) => {
                const [hash, ...msg] = commit.split(' ');
                return (
                  <div key={i} className="glass-card p-3 rounded-lg flex items-start gap-3">
                    <GitCommit className="w-4 h-4 text-white/30 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-white/90">{msg.length > 0 ? msg.join(' ') : hash}</p>
                      <span className="text-[10px] text-white/40 font-mono mt-1">{msg.length > 0 ? hash : 'dummy-hash'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="pt-4 border-t border-white/[0.05]">
            {isUpdating ? (
              <div className="bg-success-500/10 border border-success-500/20 rounded-xl p-6 flex flex-col items-center justify-center text-center">
                <Loader2 className="w-8 h-8 text-success-400 animate-spin mb-4" />
                <h3 className="text-lg font-semibold text-white mb-2">Update in progress...</h3>
                <p className="text-sm text-white/60">
                  The dashboard container is currently rebuilding in the background. 
                  This page will automatically lose connection and reload once the new version is live.
                </p>
              </div>
            ) : (
              <button
                onClick={handleUpdate}
                className="btn-primary w-full flex items-center justify-center gap-2 py-3"
              >
                <RefreshCcw className="w-4 h-4" />
                Start Auto-Update
              </button>
            )}
            
            {!isUpdating && triggerUpdate.isError && (
              <p className="text-danger-400 text-xs mt-3 text-center">
                Failed to trigger update: {triggerUpdate.error?.message}
              </p>
            )}
          </div>
        </div>
      </SlideOver>
    </>
  );
}
