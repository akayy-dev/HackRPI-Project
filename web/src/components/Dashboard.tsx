"use client";

import { useMemo, useState } from "react";
import type { DashboardData, TimeWindow, VerdictFilter } from "@/lib/types";
import { filterConnections, toMapNodes } from "@/lib/aggregate";
import { useDashboardData } from "@/hooks/useDashboardData";
import Header from "./Header";
import ConnectionMap from "./ConnectionMap";
import NodeInspector from "./NodeInspector";
import AiPanel from "./AiPanel";
import ConnectionLog from "./ConnectionLog";
import { SectionTitle, Segmented } from "./ui";

export default function Dashboard({ initial }: { initial: DashboardData }) {
  const data = useDashboardData(initial);
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("5m");
  const [verdict, setVerdict] = useState<VerdictFilter>("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const filtered = useMemo(
    () => filterConnections(data.connections, timeWindow, verdict),
    [data.connections, timeWindow, verdict],
  );
  const nodes = useMemo(() => toMapNodes(filtered), [filtered]);
  const unlocated = useMemo(() => filtered.filter((e) => !e.location).length, [filtered]);
  const selected = nodes.find((n) => n.key === selectedKey) ?? null;

  return (
    <div className="flex min-h-screen flex-col gap-5 p-3 md:p-5 lg:p-6">
      <Header status={data.status} />

      <main className="mx-auto grid w-full max-w-7xl grid-cols-1 items-stretch gap-5 lg:grid-cols-12">
        <section className="relative flex flex-col overflow-hidden rounded-xl border border-obsidian-700 bg-obsidian-900 p-4 shadow-2xl sm:p-5 lg:col-span-8" data-purpose="live-connection-map">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <SectionTitle>Live connection map</SectionTitle>
            <div className="flex items-center gap-3.5 text-xs">
              <span className="flex items-center gap-1.5 text-gray-300">
                <span className="h-2.5 w-2.5 rounded-full border-2 border-tactical bg-obsidian-950" />Allowed
              </span>
              <span className="flex items-center gap-1.5 text-gray-300">
                <span className="h-2.5 w-2.5 rounded-full border-2 border-threat bg-obsidian-950" />Blocked
              </span>
              <span className="flex items-center gap-1.5 text-gray-300" title="Ring split = share of allowed vs blocked requests">
                <svg viewBox="-6 -6 12 12" className="h-3 w-3" aria-hidden>
                  <path d="M0,-4.5 A4.5,4.5 0 0 1 0,4.5" fill="none" stroke="#00ff88" strokeWidth={2} />
                  <path d="M0,4.5 A4.5,4.5 0 0 1 0,-4.5" fill="none" stroke="#ff3b4f" strokeWidth={2} />
                </svg>
                Mixed
              </span>
              <span className="flex items-center gap-1.5 whitespace-nowrap text-gray-300">
                <span className="inline-block h-2.5 w-2.5 rotate-45 border border-tactical bg-obsidian-950" />Our server
              </span>
            </div>
          </div>

          {/* Inspector overlays the map on sm+, stacks below it on phones */}
          <div className="relative flex grow flex-col">
            <div className="soc-grid-bg relative min-h-[240px] w-full grow overflow-hidden rounded-lg border border-obsidian-800 bg-obsidian-950 sm:min-h-[410px] md:min-h-[440px]">
              <ConnectionMap server={data.server} nodes={nodes} selectedKey={selectedKey} onSelect={setSelectedKey} />
              <div className="pointer-events-none absolute bottom-2 left-3 text-[10px] text-gray-500">
                {nodes.length} origins · {filtered.length} requests{unlocated > 0 && ` (${unlocated} unlocated)`} · source: {data.source}
              </div>
              {/* Required by the DB-IP Lite licence (CC BY 4.0) */}
              <a
                href="https://db-ip.com"
                target="_blank"
                rel="noreferrer"
                className="absolute bottom-2 right-3 text-[10px] text-gray-600 transition-colors hover:text-gray-400"
              >
                IP Geolocation by DB-IP
              </a>
            </div>
            {selected && <NodeInspector node={selected} onClose={() => setSelectedKey(null)} />}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-obsidian-800 pt-3">
            <Segmented
              ariaLabel="Time window"
              value={timeWindow}
              onChange={setTimeWindow}
              options={[
                { value: "5m", label: "Last 5 min" },
                { value: "1h", label: "1h" },
                { value: "24h", label: "24h" },
              ]}
            />
            <Segmented
              ariaLabel="Verdict filter"
              variant="outline"
              value={verdict}
              onChange={setVerdict}
              options={[
                { value: "all", label: "Show: all" },
                { value: "allowed", label: "Allowed only" },
                { value: "blocked", label: "Blocked only" },
              ]}
            />
          </div>
        </section>

        <AiPanel summary={data.summary} />
      </main>

      <ConnectionLog events={filtered} onInspect={(e) => e.location && setSelectedKey(e.location.code)} />
    </div>
  );
}
