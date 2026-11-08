"use client";

import { THREAT_HEX } from "@/lib/aggregate";
import { useMemo, useRef, useState } from "react";
import { geoNaturalEarth1, geoPath, geoGraticule10 } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { FeatureCollection } from "geojson";
import countriesTopo from "world-atlas/countries-110m.json";
import type { MapNode } from "@/lib/types";

const W = 760;
const H = 420;
const MIN_ZOOM = 1;
const MAX_ZOOM = 6;

// Computed once at module load: land shapes never change.
const topo = countriesTopo as unknown as Topology<{ countries: GeometryCollection }>;
const countries = feature(topo, topo.objects.countries) as unknown as FeatureCollection;
// Fit to inhabited land (skip Antarctica, id 010) so the map fills the canvas.
const fitTarget: FeatureCollection = {
  type: "FeatureCollection",
  features: countries.features.filter((f) => String(f.id) !== "010"),
};
const projection = geoNaturalEarth1().fitExtent(
  [
    [10, 10],
    [W - 10, H - 10],
  ],
  fitTarget,
);
const pathGen = geoPath(projection);
const COUNTRY_PATHS = countries.features.map((f, i) => ({ id: String(f.id ?? i), d: pathGen(f) ?? "" }));
const GRATICULE = pathGen(geoGraticule10()) ?? "";
const SPHERE = pathGen({ type: "Sphere" }) ?? "";

function project(lon: number, lat: number): [number, number] {
  return projection([lon, lat]) ?? [0, 0];
}

const ALLOWED_HEX = "#00ff88";

/**
 * Donut marker for one location: green arc = share of allowed requests, red arc = share blocked.
 * A location with only one kind is a solid ring. Small shares get a minimum arc so 1 attack in 50 still shows.
 */
function SplitRing({ r, allowed, blocked, width }: { r: number; allowed: number; blocked: number; width: number }) {
  const C = 2 * Math.PI * r;
  const mixed = allowed > 0 && blocked > 0;
  const minArc = Math.min(3, C / 4);
  const gap = mixed ? 1.2 : 0;
  let a = (allowed / (allowed + blocked)) * C;
  if (mixed) a = Math.min(C - minArc, Math.max(minArc, a));
  return (
    <>
      <circle r={r} fill="#07080a" />
      {/* rotate so arcs start at 12 o'clock */}
      <g transform="rotate(-90)" fill="none" strokeWidth={width} filter="url(#nodeGlow)">
        {allowed > 0 && <circle r={r} stroke={ALLOWED_HEX} strokeDasharray={`${a - gap} ${C}`} />}
        {blocked > 0 && <circle r={r} stroke={THREAT_HEX} strokeDasharray={`${C - a - gap} ${C}`} strokeDashoffset={-a} />}
      </g>
    </>
  );
}

const TIP_CHAR_W = 5.5; // ~0.6em of the 9px mono font
const TIP_LINE_H = 12;

/** Hover card drawn inside the SVG, kept at constant size and inside the map bounds. */
function NodeTooltip({ node, view }: { node: MapNode & { xy: [number, number]; r: number }; view: { k: number; x: number; y: number } }) {
  const [x, y] = node.xy;
  const lines: { text: string; parts?: { text: string; fill: string }[] }[] = [
    { text: `${node.location.name} (${node.location.code})` },
    {
      text: `${node.allowed} allowed · ${node.blocked} blocked`,
      parts: [
        { text: `${node.allowed} allowed`, fill: ALLOWED_HEX },
        { text: " · ", fill: "#6b7280" },
        { text: `${node.blocked} blocked`, fill: node.blocked > 0 ? THREAT_HEX : "#9ca3af" },
      ],
    },
    { text: `${node.ips === 1 ? node.latest.ip : `${node.ips} IPs`} · last: ${node.latest.verdict}` },
  ];
  const w = Math.max(...lines.map((l) => l.text.length)) * TIP_CHAR_W + 16;
  const h = lines.length * TIP_LINE_H + 10;

  // Screen-space position of the node, then keep the card on the canvas.
  const sx = x * view.k + view.x;
  const sy = y * view.k + view.y;
  const above = sy - node.r - 10 - h >= 4;
  const top = above ? -node.r - 10 - h : node.r + 10;
  const left = Math.min(W - 4 - sx - w / 2, Math.max(4 - sx + w / 2, 0)) - w / 2;

  return (
    <g transform={`translate(${x},${y}) scale(${1 / view.k})`} pointerEvents="none" fontFamily="var(--font-mono)" fontSize={9}>
      <rect x={left} y={top} width={w} height={h} rx={4} fill="#0d0e12" fillOpacity={0.96} stroke="#2d323e" />
      {lines.map((l, i) => (
        <text key={i} x={left + 8} y={top + 5 + TIP_LINE_H * (i + 1) - 3} fill={i === 0 ? "#ffffff" : "#9ca3af"} fontWeight={i === 0 ? 700 : 400}>
          {l.parts ? l.parts.map((p, j) => <tspan key={j} fill={p.fill}>{p.text}</tspan>) : l.text}
        </text>
      ))}
    </g>
  );
}

interface Props {
  nodes: MapNode[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
}

export default function ConnectionMap({ nodes, selectedKey, onSelect }: Props) {
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const drag = useRef<{ px: number; py: number; x: number; y: number; moved: boolean } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const placed = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        xy: project(n.location.lon, n.location.lat),
        r: 5 + Math.min(4, Math.log2(n.total + 1)),
      })),
    [nodes],
  );

  // ---- zoom / pan -------------------------------------------------------
  const clampView = (k: number, x: number, y: number) => {
    // keep the map covering the viewport
    const minX = W - W * k;
    const minY = H - H * k;
    return { k, x: Math.min(0, Math.max(minX, x)), y: Math.min(0, Math.max(minY, y)) };
  };

  const zoomBy = (factor: number) =>
    setView((v) => {
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k * factor));
      // zoom around viewport centre
      const cx = W / 2;
      const cy = H / 2;
      return clampView(k, cx - ((cx - v.x) * k) / v.k, cy - ((cy - v.y) * k) / v.k);
    });

  const toSvgUnits = (dxPx: number, dyPx: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return [dxPx, dyPx];
    const scale = Math.max(W / rect.width, H / rect.height); // matches preserveAspectRatio="meet"
    return [dxPx * scale, dyPx * scale];
  };

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const [dx, dy] = toSvgUnits(e.clientX - d.px, e.clientY - d.py);
    if (Math.abs(dx) + Math.abs(dy) > 3) {
      d.moved = true;
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    }
    if (d.moved) setView((v) => clampView(v.k, d.x + dx, d.y + dy));
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) onSelect(null); // click on empty map clears selection
  };

  return (
    <div className="relative h-full w-full">
      {/* Zoom controls */}
      <div className="absolute right-3 top-3 z-20 flex gap-0.5 rounded-lg border border-obsidian-700 bg-obsidian-900/90 p-0.5 text-[11px] shadow-lg backdrop-blur-md">
        <button onClick={() => zoomBy(1.5)} className="rounded bg-obsidian-850 px-2 py-1 text-gray-300 transition-colors hover:bg-obsidian-800 hover:text-tactical" title="Zoom in" aria-label="Zoom in">+</button>
        <button onClick={() => zoomBy(1 / 1.5)} className="rounded bg-obsidian-850 px-2 py-1 text-gray-300 transition-colors hover:bg-obsidian-800 hover:text-tactical" title="Zoom out" aria-label="Zoom out">−</button>
        <button onClick={() => setView({ k: 1, x: 0, y: 0 })} className="whitespace-nowrap rounded border border-tactical/30 bg-tactical/10 px-2 py-1 text-tactical transition-colors hover:bg-tactical/20" title="Reset view">RESET</button>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => (drag.current = null)}
        role="img"
        aria-label="World map of live proxy connections"
      >
        <defs>
          <filter id="nodeGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {/* Globe outline + graticule */}
          <path d={SPHERE} fill="#090b0d" stroke="#00ff88" strokeOpacity={0.12} strokeWidth={0.8 / view.k} />
          <path d={GRATICULE} fill="none" stroke="#00ff88" strokeOpacity={0.06} strokeWidth={0.6 / view.k} strokeDasharray="2 4" />

          {/* Countries */}
          <g fill="#0c1014" stroke="#00ff88" strokeOpacity={0.22} strokeWidth={0.6 / view.k} strokeLinejoin="round">
            {COUNTRY_PATHS.map((c) => (
              <path key={c.id} d={c.d} />
            ))}
          </g>

          {/* Origin nodes: split ring — green arc = allowed share, red arc = blocked share; centre dot = latest verdict */}
          {placed.map((n) => {
            const [x, y] = n.xy;
            const isSel = n.key === selectedKey;
            const latestColor = n.latest.verdict === "blocked" ? THREAT_HEX : ALLOWED_HEX;
            const s = 1 / view.k; // keep markers same visual size when zoomed
            return (
              <g
                key={n.key}
                transform={`translate(${x},${y}) scale(${s})`}
                className="cursor-pointer"
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
                onPointerEnter={() => setHoverKey(n.key)}
                onPointerLeave={() => setHoverKey((k) => (k === n.key ? null : k))}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(isSel ? null : n.key);
                }}
                role="button"
                aria-label={`${n.location.name}: ${n.allowed} allowed, ${n.blocked} blocked`}
              >
                <circle r={14} fill="transparent" />
                <SplitRing r={n.r} allowed={n.allowed} blocked={n.blocked} width={isSel ? 3.4 : 2.6} />
                <circle r={1.8} fill={latestColor} />
                {isSel && (
                  <g stroke={latestColor} strokeWidth={1.5}>
                    <line x1={-n.r - 6} x2={-n.r - 2} y1={0} y2={0} />
                    <line x1={n.r + 2} x2={n.r + 6} y1={0} y2={0} />
                    <line x1={0} x2={0} y1={-n.r - 6} y2={-n.r - 2} />
                    <line x1={0} x2={0} y1={n.r + 2} y2={n.r + 6} />
                    <circle r={n.r + 1} fill="none" className="pulse-ring" />
                    <circle r={n.r + 1} fill="none" className="pulse-ring-delayed" />
                  </g>
                )}
                <text y={-n.r - 6} textAnchor="middle" fill="#a0aec0" fontSize={8.5} fontFamily="var(--font-mono)">
                  {n.location.code}
                </text>
              </g>
            );
          })}

          {/* Hover card — last so it sits above everything */}
          {(() => {
            const hovered = placed.find((n) => n.key === hoverKey);
            return hovered ? <NodeTooltip node={hovered} view={view} /> : null;
          })()}
        </g>
      </svg>
    </div>
  );
}
