"use client";

import { useMemo, useRef, useState } from "react";
import { geoNaturalEarth1, geoPath, geoGraticule10 } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { FeatureCollection } from "geojson";
import countriesTopo from "world-atlas/countries-110m.json";
import type { MapNode, ServerNode } from "@/lib/types";

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

/** Curved arc from origin → server, bowed "upward" like a flight path. */
function arcPath([x1, y1]: [number, number], [x2, y2]: [number, number]): string {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dist = Math.hypot(x2 - x1, y2 - y1);
  return `M${x1},${y1} Q${mx},${my - dist * 0.35} ${x2},${y2}`;
}

interface Props {
  server: ServerNode;
  nodes: MapNode[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
}

export default function ConnectionMap({ server, nodes, selectedKey, onSelect }: Props) {
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const drag = useRef<{ px: number; py: number; x: number; y: number; moved: boolean } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const serverXY = project(server.location.lon, server.location.lat);

  const placed = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        xy: project(n.location.lon, n.location.lat),
        r: 3.5 + Math.min(4, Math.log2(n.total + 1)),
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
          <radialGradient id="serverBeacon" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#00ff88" stopOpacity="0.28" />
            <stop offset="60%" stopColor="#00ff88" stopOpacity="0.06" />
            <stop offset="100%" stopColor="#00ff88" stopOpacity="0" />
          </radialGradient>
        </defs>

        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {/* Globe outline + graticule */}
          <path d={SPHERE} fill="#090b0d" stroke="#00ff88" strokeOpacity={0.12} strokeWidth={0.8 / view.k} />
          <path d={GRATICULE} fill="none" stroke="#00ff88" strokeOpacity={0.06} strokeWidth={0.6 / view.k} strokeDasharray="2 4" />

          {/* Range rings + beacon around our server */}
          <circle cx={serverXY[0]} cy={serverXY[1]} r={360} fill="url(#serverBeacon)" />
          {[80, 170, 270].map((r, i) => (
            <circle key={r} cx={serverXY[0]} cy={serverXY[1]} r={r} fill="none" stroke="#00ff88" strokeOpacity={0.1 - i * 0.025} strokeWidth={1 / view.k} strokeDasharray={i === 1 ? "3 5" : undefined} />
          ))}

          {/* Countries */}
          <g fill="#0c1014" stroke="#00ff88" strokeOpacity={0.22} strokeWidth={0.6 / view.k} strokeLinejoin="round">
            {COUNTRY_PATHS.map((c) => (
              <path key={c.id} d={c.d} />
            ))}
          </g>

          {/* Radar sweep */}
          <line
            className="radar-sweep"
            style={{ transformOrigin: `${serverXY[0]}px ${serverXY[1]}px` }}
            x1={serverXY[0]}
            y1={serverXY[1]}
            x2={serverXY[0] + 320}
            y2={serverXY[1] + 70}
            stroke="#00ff88"
            strokeOpacity={0.16}
            strokeWidth={2 / view.k}
          />

          {/* Arcs: origin → our server */}
          <g fill="none" pointerEvents="none">
            {placed.map((n) => {
              const blockedOnly = n.allowed === 0;
              const isSel = n.key === selectedKey;
              return (
                <path
                  key={`arc-${n.key}`}
                  d={arcPath(n.xy, serverXY)}
                  className="travel-line"
                  stroke="#00ff88"
                  strokeOpacity={isSel ? 0.9 : blockedOnly ? 0.25 : 0.55}
                  strokeWidth={(isSel ? 1.8 : 1.1) / view.k}
                />
              );
            })}
          </g>

          {/* Origin nodes */}
          {placed.map((n) => {
            const [x, y] = n.xy;
            const isSel = n.key === selectedKey;
            const isBlocked = n.blocked > 0;
            const s = 1 / view.k; // keep markers same visual size when zoomed
            return (
              <g
                key={n.key}
                transform={`translate(${x},${y}) scale(${s})`}
                className="cursor-pointer"
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(isSel ? null : n.key);
                }}
                role="button"
                aria-label={`${n.location.city}: ${n.total} requests, ${n.blocked} blocked`}
              >
                <circle r={14} fill="transparent" />
                {isBlocked ? (
                  <>
                    <circle r={n.r + 0.5} fill="#07080a" stroke="#00ff88" strokeWidth={isSel ? 2.5 : 1.8} />
                    <circle r={1.6} fill="#00ff88" />
                  </>
                ) : (
                  <>
                    <circle r={n.r} fill="#00ff88" filter="url(#nodeGlow)" />
                    <circle r={n.r} fill="none" stroke="#00ff88" className="pulse-ring" />
                  </>
                )}
                {isSel && (
                  <g stroke="#00ff88" strokeWidth={1.5}>
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

          {/* Our server (diamond bastion) */}
          <g transform={`translate(${serverXY[0]},${serverXY[1]}) scale(${1 / view.k})`} pointerEvents="none">
            <circle r={9} fill="none" stroke="#00ff88" className="pulse-ring" />
            <rect x={-8} y={-8} width={16} height={16} transform="rotate(45)" fill="#07080a" stroke="#00ff88" strokeWidth={2} filter="url(#nodeGlow)" />
            <rect x={-2.8} y={-2.8} width={5.6} height={5.6} transform="rotate(45)" fill="#00ff88" />
            <g transform="translate(0,22)">
              <rect x={-52} y={-8} width={104} height={16} rx={3} fill="#0d0e12" fillOpacity={0.95} stroke="#00ff88" strokeOpacity={0.5} />
              <text textAnchor="middle" dy={3.5} fill="#fff" fontSize={9.5} fontWeight={700} fontFamily="var(--font-mono)">
                Our server [{server.label}]
              </text>
            </g>
          </g>
        </g>
      </svg>
    </div>
  );
}
