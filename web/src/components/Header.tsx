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

const chip = "flex items-center gap-2 whitespace-nowrap rounded-lg border px-3 py-1.5";

/** Latency above this is shown in red. */
const LATENCY_WARN_MS = 100;

export default function Header({ status }: { status: ProxyStatus }) {
  const slow = status.latencyMs > LATENCY_WARN_MS;
  return (
    <header className="relative mx-auto flex w-full max-w-7xl flex-col items-stretch justify-between gap-4 overflow-hidden rounded-xl border border-obsidian-700 bg-obsidian-900/90 p-3.5 shadow-2xl backdrop-blur-md sm:p-4 lg:flex-row lg:items-center">
      <h1 className="z-10 font-sans text-lg font-bold tracking-tight text-white md:text-xl">Security Operations Center</h1>

      <div className="z-10 flex flex-wrap items-center gap-2.5 text-xs sm:gap-3.5">
        <div className={`${chip} hidden border-obsidian-800 bg-obsidian-950/70 text-gray-300 sm:flex`}>
          <span className="text-[10px] text-tactical/60">UTC</span>
          <UtcClock />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-tactical" />
        </div>
        <div className={`${chip} ${slow ? "border-threat/50" : "border-obsidian-800"} bg-obsidian-950/70 text-gray-300`}>
          <span className="text-[10px] text-gray-400">LATENCY</span>
          <span className={`font-bold tabular-nums ${slow ? "text-threat" : "text-tactical"}`}>{status.latencyMs.toFixed(1)}ms</span>
        </div>
        <div className={`${chip} ${status.active ? "border-obsidian-700" : "border-threat/50"} bg-obsidian-850 text-gray-300`}>
          <span className={`h-2 w-2 rounded-full ${status.active ? "bg-tactical" : "bg-threat"}`} />
          <span>
            Proxy <span className={`font-semibold ${status.active ? "text-tactical" : "text-threat"}`}>{status.active ? "Active" : "Down"}</span>
          </span>
        </div>
        <button
          type="button"
          className={`${chip} border-tactical/30 bg-obsidian-850 text-white transition-all hover:bg-obsidian-800`}
        >
          <span className="h-2 w-2 rounded-sm bg-tactical/80" />
          <span className="font-medium">Admin</span>
          <svg className="h-3.5 w-3.5 fill-current text-tactical/80" viewBox="0 0 20 20" aria-hidden>
            <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
          </svg>
        </button>
      </div>
    </header>
  );
}
