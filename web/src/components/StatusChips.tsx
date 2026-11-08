"use client";

import { useEffect, useState } from "react";
import type { ProxyStatus } from "@/lib/types";

function UtcClock() {
  const [now, setNow] = useState<string>("--:--:--");
  useEffect(() => {
    const tick = () => setNow(new Date().toISOString().slice(11, 19));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="font-bold tabular-nums tracking-wider text-white">{now}</span>;
}

const chip = "flex items-center gap-1.5 whitespace-nowrap rounded-md border bg-obsidian-950/70 px-2 py-1 text-gray-300";

/** DB round trips above this are shown in red (a cloud cluster over a hotspot is ~100–300 ms). */
const LATENCY_WARN_MS = 500;

/** UTC clock + database round-trip latency, shown in the live map's header. */
export default function StatusChips({ status }: { status: ProxyStatus }) {
  const ms = status.dbLatencyMs;
  const slow = ms !== null && ms > LATENCY_WARN_MS;
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <div className={`${chip} border-obsidian-800`}>
        <span className="text-[10px] text-tactical/60">UTC</span>
        <UtcClock />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-tactical" />
      </div>
      <div
        className={`${chip} ${slow ? "border-threat/50" : "border-obsidian-800"}`}
        title="Round trip of the dashboard's latest database query (not proxy latency)"
      >
        <span className="text-[10px] text-gray-400">DB LATENCY</span>
        {ms === null ? (
          <span className="font-bold text-gray-500">n/a</span>
        ) : (
          <span className={`font-bold tabular-nums ${slow ? "text-threat" : "text-tactical"}`}>{Math.round(ms)}ms</span>
        )}
      </div>
    </div>
  );
}
