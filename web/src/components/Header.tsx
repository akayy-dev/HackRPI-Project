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

export default function Header({ status }: { status: ProxyStatus }) {
  return (
    <header className="relative mx-auto flex w-full max-w-7xl flex-col items-stretch justify-between gap-4 overflow-hidden rounded-xl border border-obsidian-700 bg-obsidian-900/90 p-3.5 shadow-2xl backdrop-blur-md sm:p-4 lg:flex-row lg:items-center">
      <div className="pointer-events-none absolute -left-16 -top-16 h-48 w-48 rounded-full bg-tactical/5 blur-3xl" />
      <h1 className="z-10 font-sans text-lg font-bold tracking-tight text-white md:text-xl">Security Operations Center</h1>

      <div className="z-10 flex flex-wrap items-center gap-2.5 text-xs sm:gap-3.5">
        <div className={`${chip} hidden border-obsidian-800 bg-obsidian-950/70 text-gray-300 sm:flex`}>
          <span className="text-[10px] text-tactical/60">UTC</span>
          <UtcClock />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-tactical" />
        </div>
        <div className={`${chip} border-obsidian-800 bg-obsidian-950/70 text-gray-300`}>
          <span className="text-[10px] text-gray-400">LATENCY</span>
          <span className="font-bold tabular-nums text-tactical">{status.latencyMs.toFixed(1)}ms</span>
        </div>
        <div className={`${chip} border-obsidian-700 bg-obsidian-850 text-gray-300`}>
          <span className={`h-2 w-2 rounded-full ${status.active ? "bg-tactical shadow-[0_0_8px_#00ff88]" : "bg-gray-600"}`} />
          <span>
            Proxy <span className="font-semibold text-tactical">{status.active ? "Active" : "Down"}</span>
          </span>
        </div>
        <button
          type="button"
          className={`${chip} border-tactical/30 bg-obsidian-850 text-white shadow-[0_0_10px_rgba(0,255,136,0.1)] transition-all hover:bg-obsidian-800`}
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
