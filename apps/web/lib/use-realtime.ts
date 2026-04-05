'use client';

import { useEffect, useRef } from 'react';
import { supabase } from './supabase';

type RealtimeEvent = 'INSERT' | 'UPDATE' | 'DELETE';

interface UseRealtimeOptions {
  /** Table name in the public schema */
  table: string;
  /** Which events to listen for (default: all) */
  events?: RealtimeEvent[];
  /** Callback when a change is detected */
  onchange?: (event: RealtimeEvent, payload: any) => void;
  /** Whether the subscription is enabled (default: true) */
  enabled?: boolean;
}

/**
 * Subscribe to Supabase Realtime broadcast events for a specific table.
 * Uses the broadcast triggers set up via `public.realtime_broadcast_row_changes()`.
 *
 * Usage:
 * ```tsx
 * useRealtimeTable({
 *   table: 'deployments',
 *   onchange: () => refetch(),
 * });
 * ```
 */
export function useRealtimeTable({
  table,
  events = ['INSERT', 'UPDATE', 'DELETE'],
  onchange,
  enabled = true,
}: UseRealtimeOptions) {
  // Use ref so callback changes don't cause re-subscription
  const callbackRef = useRef(onchange);
  callbackRef.current = onchange;

  useEffect(() => {
    if (!supabase || !enabled) return;

    const channelName = `table:public:${table}`;
    let channel = supabase.channel(channelName, {
      config: { private: true },
    });

    for (const event of events) {
      channel = channel.on('broadcast', { event }, (payload) => {
        callbackRef.current?.(event, payload);
      });
    }

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        // Authenticate for private channels
        await supabase!.realtime.setAuth();
      }
    });

    return () => {
      supabase!.removeChannel(channel);
    };
  }, [table, enabled, events.join(',')]);
}

/**
 * Subscribe to multiple tables at once.
 */
export function useRealtimeTables(
  tables: string[],
  onchange: (table: string, event: RealtimeEvent, payload: any) => void,
  enabled = true,
) {
  const callbackRef = useRef(onchange);
  callbackRef.current = onchange;

  useEffect(() => {
    if (!supabase || !enabled || tables.length === 0) return;

    const channels = tables.map((table) => {
      const channelName = `table:public:${table}`;
      const channel = supabase!
        .channel(channelName, { config: { private: true } })
        .on('broadcast', { event: 'INSERT' }, (p) => callbackRef.current?.(table, 'INSERT', p))
        .on('broadcast', { event: 'UPDATE' }, (p) => callbackRef.current?.(table, 'UPDATE', p))
        .on('broadcast', { event: 'DELETE' }, (p) => callbackRef.current?.(table, 'DELETE', p))
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            await supabase!.realtime.setAuth();
          }
        });
      return channel;
    });

    return () => {
      channels.forEach((ch) => supabase!.removeChannel(ch));
    };
  }, [tables.join(','), enabled]);
}
