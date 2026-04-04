"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { trpc } from "@/lib/trpc";

export function useRealtimeSync() {
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!supabase) return;

    // Listen exclusively to the secure public.ui_events broadcast table
    const channel = supabase
      .channel("global-ui-sync")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ui_events",
        },
        (payload) => {
          console.log("Secure UI Broadcast received:", payload.new);
          // Invalidate all TRPC queries so the UI immediately refetches the freshest data
          utils.invalidate();
        }
      )
      .subscribe();

    return () => {
      supabase?.removeChannel(channel);
    };
  }, [utils]);
}
