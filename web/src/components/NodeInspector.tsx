"use client";

import { useState } from "react";
import type { MapNode } from "@/lib/types";
import { isThreatScore, severityLabel } from "@/lib/aggregate";
import { getHeader } from "@/lib/requestLog";

const subnet24 = (ip: string) => ip.split(".").slice(0, 3).join(".") + ".0/24";

export default function NodeInspector({ node, onClose }: { node: MapNode; onClose: () => void }) {
  const [note, setNote] = useState<string | null>(null);
  const e = node.latest;
  const blocked = node.blocked > 0;
  const threat = blocked || isThreatScore(node.maxRisk);
  const ua = getHeader(e, "User-Agent");

  const rows: [string, React.ReactNode][] = [
    ["IP", <span key="ip" className="font-bold text-white">{e.ip}{node.ips > 1 && <span className="font-normal text-gray-400"> +{node.ips - 1}</span>}</span>],
    ["Location", `${node.location.name} (${node.location.country})`],
    ["Requests", `${node.total} (${node.blocked} blocked)`],
    [
      "Max risk",
      <span key="s" className={`whitespace-nowrap rounded border px-1.5 font-bold ${isThreatScore(node.maxRisk) ? "border-threat/40 bg-threat/15 text-threat" : "border-tactical/30 bg-tactical/10 text-tactical"}`}>
        {node.maxRisk.toFixed(2)} {severityLabel(node.maxRisk)}
      </span>,
    ],
    ["Last request", <span key="r" className="break-all text-gray-200">{e.method} {e.url}</span>],
    ["User-Agent", <span key="ua" className="line-clamp-2 break-all text-gray-300" title={ua ?? undefined}>{ua ?? "—"}</span>],
  ];

  return (
    <div
      className={`relative z-30 mt-3 w-full rounded-lg sm:absolute sm:right-3 sm:top-12 sm:mt-0 sm:w-72 border ${threat ? "border-threat/60" : "border-tactical/60"} bg-obsidian-900/95 p-3.5 text-[11px] text-gray-200 shadow-[0_0_25px_rgba(0,0,0,0.8)] backdrop-blur-md`}
      data-purpose="node-inspector"
    >
      <div className="mb-2.5 flex items-center justify-between gap-2 border-b border-obsidian-700/80 pb-2">
        <span className="flex items-center gap-1.5 whitespace-nowrap font-bold uppercase tracking-wider text-white">
          <span className={`h-2 w-2 animate-ping rounded-full ${threat ? "bg-threat" : "bg-tactical"}`} />
          Target Telemetry
        </span>
        <div className="flex items-center gap-1.5">
          <span className={`whitespace-nowrap rounded border px-2 py-0.5 text-[9px] font-bold ${blocked ? "border-threat/40 bg-threat/15 text-threat" : "border-tactical/40 bg-tactical/15 text-tactical"}`}>
            {blocked ? "Intercepted" : "Nominal"}
          </span>
          <button onClick={onClose} aria-label="Close" className="px-1 text-gray-400 hover:text-white">✕</button>
        </div>
      </div>

      <dl className="space-y-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-start justify-between gap-3">
            <dt className="shrink-0 text-gray-400">{k}</dt>
            <dd className="min-w-0 text-right">{v}</dd>
          </div>
        ))}
        <div className="flex items-center justify-between border-t border-obsidian-800 pt-1.5">
          <dt className="text-gray-400">Status</dt>
          <dd className={`font-semibold uppercase ${blocked ? "text-threat" : "text-tactical"}`}>{blocked ? "Blocked" : "Allowed"}</dd>
        </div>
      </dl>

      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-obsidian-800 pt-2">
        {/* TODO: wire to proxy control API */}
        <button
          onClick={() => setNote(`Trace queued for ${e.ip}`)}
          className="rounded border border-obsidian-700 bg-obsidian-800 px-2 py-1.5 text-[10px] text-gray-200 transition-colors hover:bg-obsidian-750"
        >
          Trace
        </button>
        <button
          onClick={() => setNote(`Ban queued for ${subnet24(e.ip)}`)}
          className="rounded bg-threat px-2 py-1.5 text-[10px] font-bold text-white transition-all hover:bg-threat-dim"
        >
          Ban Subnet
        </button>
      </div>
      {note && <p className="mt-2 text-[10px] text-tactical/80">{note} (not wired yet)</p>}
    </div>
  );
}
