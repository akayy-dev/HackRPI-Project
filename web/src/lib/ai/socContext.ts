/**
 * Turns raw connection events into the compact, deterministic view the AI analyst
 * reasons over. Every number the dashboard shows comes from here, never from the model.
 * Pure: no server-only imports, so it is unit-testable and reusable by the watcher.
 */
import type { AttackLabel, ConnectionEvent } from "@/lib/types";

const RECENT_MS = 5 * 60_000;
const LABEL_MIN = 0.5;
const URL_MAX = 200;
const UA_MAX = 120;

export interface IpStat {
  ip: string;
  country: string | null;
  total: number;
  blocked: number;
  maxRisk: number;
  topLabels: AttackLabel[];
}

export interface ContextSample {
  id: string;
  t: string;
  ip: string;
  method: string;
  url: string;
  ua: string;
  risk: number;
  verdict: string;
  label: AttackLabel | null;
  simulated: boolean;
}

export interface SocContext {
  windowStart: string;
  windowEnd: string;
  total: number;
  blocked: number;
  /** Requests in the last 5 min / 5 */
  perMin: number;
  /** Last-5-minute counters: what severityFloor and the watcher use */
  blocked5m: number;
  maxIpBlocked5m: number;
  errors5m: number;
  simulated: number;
  classificationErrors: number;
  labelCounts: Partial<Record<AttackLabel, number>>;
  topIps: IpStat[];
  topBlockedPaths: { path: string; count: number }[];
  samples: ContextSample[];
  /** For parseTriage's hallucination guard; not rendered */
  knownIps: Set<string>;
  knownPaths: Set<string>;
}

/** Control characters out, length capped: request fields are attacker-controlled. */
const clean = (s: string, max: number) => s.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, max);

export const pathOf = (url: string) => url.split(/[?#]/, 1)[0] || "/";

/** Non-normal labels the classifier scored >= 0.5, highest first. */
function labelsOf(e: ConnectionEvent): AttackLabel[] {
  const p = e.attack_probabilities;
  if (!p) return [];
  return (Object.entries(p) as [AttackLabel, number][])
    .filter(([l, v]) => l !== "normal" && v >= LABEL_MIN)
    .sort((a, b) => b[1] - a[1])
    .map(([l]) => l);
}

function header(e: ConnectionEvent, name: string): string {
  const key = Object.keys(e.headers ?? {}).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? (e.headers[key]?.[0] ?? "") : "";
}

const topN = <K>(m: Map<K, number>, n: number) =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

export function buildSocContext(events: ConnectionEvent[], now: number): SocContext {
  const recentFrom = now - RECENT_MS;
  const ipMap = new Map<string, IpStat & { labelTally: Map<AttackLabel, number>; blocked5m: number }>();
  const labelCounts: Partial<Record<AttackLabel, number>> = {};
  const blockedPaths = new Map<string, number>();
  const knownPaths = new Set<string>();
  let blocked = 0, recent = 0, blocked5m = 0, errors5m = 0, simulated = 0, classificationErrors = 0;
  let minT = Infinity, maxT = -Infinity;

  for (const e of events) {
    const t = Date.parse(e.timestamp);
    const isRecent = t >= recentFrom;
    const isBlocked = e.verdict === "blocked";
    const labels = labelsOf(e);
    const path = pathOf(e.url);
    if (t < minT) minT = t;
    if (t > maxT) maxT = t;
    knownPaths.add(path);
    if (isRecent) recent++;
    if (e.simulated) simulated++;
    if (e.classification_error) {
      classificationErrors++;
      if (isRecent) errors5m++;
    }
    if (isBlocked) {
      blocked++;
      if (isRecent) blocked5m++;
      blockedPaths.set(path, (blockedPaths.get(path) ?? 0) + 1);
    }
    for (const l of labels) labelCounts[l] = (labelCounts[l] ?? 0) + 1;

    let s = ipMap.get(e.ip);
    if (!s) {
      s = { ip: e.ip, country: e.location?.country ?? null, total: 0, blocked: 0, maxRisk: 0, topLabels: [], labelTally: new Map(), blocked5m: 0 };
      ipMap.set(e.ip, s);
    }
    s.total++;
    if (isBlocked) s.blocked++;
    if (isBlocked && isRecent) s.blocked5m++;
    s.maxRisk = Math.max(s.maxRisk, e.risk);
    for (const l of labels) s.labelTally.set(l, (s.labelTally.get(l) ?? 0) + 1);
  }

  const ipStats = [...ipMap.values()];
  const topIps: IpStat[] = ipStats
    .sort((a, b) => b.blocked - a.blocked || b.total - a.total)
    .slice(0, 10)
    .map(({ ip, country, total, blocked: b, maxRisk, labelTally }) => ({
      ip, country, total, blocked: b, maxRisk,
      topLabels: topN(labelTally, 3).map(([l]) => l),
    }));

  // Samples: the riskiest 30 plus the newest 10, deduplicated, newest first
  const byRisk = [...events].sort((a, b) => b.risk - a.risk).slice(0, 30);
  const byTime = [...events].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  const picked = new Map<string, ConnectionEvent>();
  for (const e of [...byRisk, ...byTime.slice(0, 10)]) picked.set(e.id, e);
  const samples = [...picked.values()]
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .map((e) => ({
      id: e.id,
      t: e.timestamp,
      ip: e.ip,
      method: clean(e.method, 10),
      url: clean(e.url, URL_MAX),
      ua: clean(header(e, "User-Agent"), UA_MAX),
      risk: Number(e.risk.toFixed(3)),
      verdict: e.verdict,
      label: labelsOf(e)[0] ?? null,
      simulated: Boolean(e.simulated),
    }));

  const iso = (t: number) => new Date(Number.isFinite(t) ? t : now).toISOString();
  return {
    windowStart: iso(minT),
    windowEnd: iso(maxT),
    total: events.length,
    blocked,
    perMin: Math.round((recent / 5) * 10) / 10,
    blocked5m,
    maxIpBlocked5m: ipStats.reduce((m, s) => Math.max(m, s.blocked5m), 0),
    errors5m,
    simulated,
    classificationErrors,
    labelCounts,
    topIps,
    topBlockedPaths: topN(blockedPaths, 5).map(([path, count]) => ({ path, count })),
    samples,
    knownIps: new Set(ipMap.keys()),
    knownPaths,
  };
}

/** Fenced, JSON-encoded context for the model. The fence's closing tag is escaped inside the data. */
export function renderContext(ctx: SocContext): string {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { knownIps, knownPaths, ...rest } = ctx;
  const json = JSON.stringify(rest).replace(/<\/traffic_data>/gi, "<\\/traffic_data>");
  return `<traffic_data>\n${json}\n</traffic_data>`;
}
