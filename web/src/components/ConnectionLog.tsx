"use client";

import { useEffect, useRef, useState } from "react";
import type { ConnectionEvent } from "@/lib/types";
import { formatTime, isThreatScore } from "@/lib/aggregate";
import { SectionTitle } from "./ui";

interface Props {
  events: ConnectionEvent[]; // newest first
  onInspect: (e: ConnectionEvent) => void;
}

type Mode = "auto" | "paused";

export default function ConnectionLog({ events, onInspect }: Props) {
  const [mode, setMode] = useState<Mode>("auto");
  const [frozen, setFrozen] = useState<ConnectionEvent[] | null>(null);
  const [clearedAt, setClearedAt] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const source = mode === "paused" && frozen ? frozen : events;
  const rows = clearedAt ? source.filter((e) => e.timestamp > clearedAt) : source;

  // Newest is at the top, so "auto-scroll" keeps the view pinned to the top.
  useEffect(() => {
    if (mode === "auto") listRef.current?.scrollTo({ top: 0 });
  }, [rows.length, mode]);

  const btn = (active: boolean) =>
    `whitespace-nowrap rounded px-2.5 py-1 transition-all ${active ? "border border-obsidian-600 bg-obsidian-800 font-semibold text-white" : "border border-transparent text-gray-400 hover:text-white"}`;

  return (
    <section className="mx-auto w-full max-w-7xl space-y-3 rounded-xl border border-obsidian-700 bg-obsidian-900 p-4 shadow-2xl sm:p-5" data-purpose="connection-log">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-obsidian-800 pb-3">
        <div className="flex flex-wrap items-center gap-3">
          <SectionTitle>Connection log</SectionTitle>
          <span className="whitespace-nowrap text-[11px] text-gray-400">
            <span className="tabular-nums text-gray-200">{rows.length}</span> requests
          </span>
        </div>
        <div className="inline-flex rounded-lg border border-obsidian-700 bg-obsidian-950 p-0.5 text-[11px]" role="group" aria-label="Log controls">
          <button type="button" className={btn(mode === "auto")} onClick={() => { setMode("auto"); setFrozen(null); }}>
            AUTO-SCROLL{mode === "auto" ? ": ON" : ""}
          </button>
          <button type="button" className={btn(mode === "paused")} onClick={() => { setMode("paused"); setFrozen(events); }}>
            PAUSE
          </button>
          <button type="button" className={btn(false)} onClick={() => setClearedAt(events[0]?.timestamp ?? new Date().toISOString())}>
            CLEAR
          </button>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-lg border border-obsidian-800 bg-obsidian-950">
        <div ref={listRef} className="max-h-[360px] divide-y divide-obsidian-800/60 overflow-y-auto text-xs tabular-nums">
          {rows.length === 0 && <div className="p-6 text-center text-[11px] text-gray-500">No connections in this window.</div>}
          {rows.map((e) => {
            const blocked = e.verdict === "blocked";
            return (
              <div
                key={e.id}
                className={`flex flex-wrap items-center justify-between gap-2 border-l-2 p-2.5 transition-all hover:bg-obsidian-850 ${blocked ? "border-l-threat bg-threat/5" : "border-l-transparent"}`}
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                  <span className="text-[11px] text-gray-500">[{formatTime(e.timestamp)}]</span>
                  {blocked ? (
                    <span className="inline-flex items-center gap-1 rounded border border-threat/50 bg-threat/15 px-1.5 text-[10px] font-bold text-threat">
                      <span className="h-1 w-1 rounded-full bg-threat" />DROP
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded border border-obsidian-700 px-1.5 text-[10px] font-bold text-gray-400">
                      <span className="h-1 w-1 rounded-full bg-gray-500" />PASS
                    </span>
                  )}
                  <span className="font-medium text-white">{e.ip}</span>
                  <span className="text-[11px] text-gray-400">({e.location.code})</span>
                  <span className="whitespace-nowrap rounded border border-obsidian-700 bg-obsidian-850 px-1.5 text-[10px] font-bold text-gray-400">
                    {e.method}
                  </span>
                  <span className="break-all text-gray-300">{e.path}</span>
                </div>
                <div className="flex items-center gap-3">
                  {e.threat ? (
                    <span className="whitespace-nowrap rounded border border-threat/40 bg-threat/15 px-1.5 py-0.5 text-[10px] font-bold text-threat">
                      ML: {e.mlScore.toFixed(2)} [{e.threat}]
                    </span>
                  ) : (
                    <span className="whitespace-nowrap text-[11px] text-gray-400">
                      ML: <span className={isThreatScore(e.mlScore) ? "text-threat" : "text-gray-300"}>{e.mlScore.toFixed(2)}</span>
                    </span>
                  )}
                  <button type="button" onClick={() => onInspect(e)} className="whitespace-nowrap text-[11px] text-gray-500 transition-colors hover:text-white hover:underline">
                    [INSPECT]
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-2 border-t border-obsidian-800 bg-obsidian-900/90 px-3 py-2 text-[11px] text-gray-400">
          <span className={`h-1.5 w-1.5 rounded-full ${mode === "auto" ? "bg-tactical" : "bg-gray-600"}`} />
          <span>{mode === "auto" ? "Live" : "Paused"}</span>
        </div>
      </div>
    </section>
  );
}
