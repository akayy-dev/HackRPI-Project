import type { ConnectionEvent, MapNode, TimeWindow, VerdictFilter } from "./types";
import { TIME_WINDOW_MS } from "./types";

export function filterConnections(
  events: ConnectionEvent[],
  window: TimeWindow,
  verdict: VerdictFilter,
  now = Date.now(),
): ConnectionEvent[] {
  const since = now - TIME_WINDOW_MS[window];
  return events.filter(
    (e) => new Date(e.timestamp).getTime() >= since && (verdict === "all" || e.verdict === verdict),
  );
}

/** Group events by origin location so the map draws one node per place. */
export function toMapNodes(events: ConnectionEvent[]): MapNode[] {
  const byKey = new Map<string, MapNode>();
  for (const e of events) {
    const key = e.location.code;
    const node = byKey.get(key);
    if (!node) {
      byKey.set(key, {
        key,
        location: e.location,
        total: 1,
        blocked: e.verdict === "blocked" ? 1 : 0,
        allowed: e.verdict === "allowed" ? 1 : 0,
        maxScore: e.mlScore,
        topThreat: e.threat,
        latest: e,
      });
      continue;
    }
    node.total++;
    if (e.verdict === "blocked") node.blocked++;
    else node.allowed++;
    if (e.mlScore > node.maxScore) {
      node.maxScore = e.mlScore;
      node.topThreat = e.threat ?? node.topThreat;
    }
    if (e.timestamp > node.latest.timestamp) node.latest = e;
  }
  return [...byKey.values()];
}

/** ML scores at or above this ("Medium" and up) are shown as threats (red). */
export const THREAT_SCORE = 0.5;
export const isThreatScore = (score: number) => score >= THREAT_SCORE;

/** Hex for SVG attributes, which can't use Tailwind classes. Mirrors --color-threat. */
export const THREAT_HEX = "#ff3b4f";

export function severityLabel(score: number): string {
  if (score >= 0.9) return "Critical";
  if (score >= 0.7) return "High";
  if (score >= 0.5) return "Medium";
  return "Low";
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`;
}
