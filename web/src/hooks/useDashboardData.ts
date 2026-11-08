"use client";

import { useEffect, useState } from "react";
import type { DashboardData } from "@/lib/types";

/**
 * Starts from server-rendered data, then polls /api/dashboard.
 * Swap for SSE / WebSocket (or Mongo change streams) later without touching components.
 */
export function useDashboardData(initial: DashboardData, intervalMs = 2000) {
  const [data, setData] = useState(initial);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    // Wait for each response before scheduling the next poll, so a slow or unreachable
    // database never piles up overlapping requests.
    const poll = async () => {
      try {
        const res = await fetch("/api/dashboard", { cache: "no-store" });
        if (res.ok && alive) setData(await res.json());
      } catch {
        /* keep last good data */
      }
      if (alive) timer = setTimeout(poll, intervalMs);
    };
    timer = setTimeout(poll, intervalMs);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [intervalMs]);

  return data;
}
