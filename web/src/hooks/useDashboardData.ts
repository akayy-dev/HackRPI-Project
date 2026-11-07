"use client";

import { useEffect, useState } from "react";
import type { DashboardData } from "@/lib/types";

/**
 * Starts from server-rendered data, then polls /api/dashboard.
 * Swap for SSE / WebSocket (or Mongo change streams) later without touching components.
 */
export function useDashboardData(initial: DashboardData, intervalMs = 5000) {
  const [data, setData] = useState(initial);

  useEffect(() => {
    let alive = true;
    const id = setInterval(async () => {
      try {
        const res = await fetch("/api/dashboard", { cache: "no-store" });
        if (res.ok && alive) setData(await res.json());
      } catch {
        /* keep last good data */
      }
    }, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [intervalMs]);

  return data;
}
