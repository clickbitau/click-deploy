"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { trpc } from "@/lib/trpc";

/**
 * Global Realtime listener — subscribes to broadcast triggers on key tables
 * and invalidates the relevant tRPC caches instantly.
 *
 * This runs once in the dashboard layout so ALL pages get instant updates
 * without needing per-page hooks.
 */
export function useRealtimeSync() {
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!supabase) return;

    const tables = ['deployments', 'services', 'projects', 'nodes', 'domains', 'tunnels', 'tunnel_routes'];
    const channels = tables.map((table) => {
      const channelName = `global:${table}`;
      return supabase!
        .channel(channelName, { config: { private: true } })
        .on('broadcast', { event: 'INSERT' }, () => invalidateTable(table))
        .on('broadcast', { event: 'UPDATE' }, () => invalidateTable(table))
        .on('broadcast', { event: 'DELETE' }, () => invalidateTable(table))
        .subscribe();
    });

    function invalidateTable(table: string) {
      switch (table) {
        case 'deployments':
          utils.deployment.invalidate();
          break;
        case 'services':
          utils.service.invalidate();
          break;
        case 'projects':
          utils.project.invalidate();
          break;
        case 'nodes':
          utils.node.invalidate();
          break;
        case 'domains':
          utils.domain.invalidate();
          break;
        case 'tunnels':
        case 'tunnel_routes':
          utils.tunnel.invalidate();
          break;
        default:
          // Fallback: invalidate everything
          utils.invalidate();
      }
    }

    return () => {
      channels.forEach((ch) => supabase!.removeChannel(ch));
    };
  }, [utils]);
}
