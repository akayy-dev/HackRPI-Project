import { ATTACK_LABELS, type AttackLabel, type AttackProbabilities, type ConnectionEvent } from "@/lib/types";

/** Fixed clock for tests: 2026-11-08T12:00:00Z */
export const NOW = Date.parse("2026-11-08T12:00:00Z");

let seq = 0;

export interface EvOpts {
  ip?: string;
  risk?: number;
  /** minutes before NOW (default 1) */
  minsAgo?: number;
  url?: string;
  ua?: string;
  label?: AttackLabel;
  error?: string;
  simulated?: boolean;
}

/** Minimal ConnectionEvent for unit tests. risk >= 0.5 → blocked. */
export function ev(o: EvOpts = {}): ConnectionEvent {
  const risk = o.risk ?? 0.1;
  const probs = Object.fromEntries(ATTACK_LABELS.map((l) => [l, 0])) as AttackProbabilities;
  probs.normal = 1 - risk;
  if (o.label) probs[o.label] = risk;
  const ip = o.ip ?? "198.51.100.7";
  return {
    id: `t-${++seq}`,
    timestamp: new Date(NOW - (o.minsAgo ?? 1) * 60_000).toISOString(),
    risk,
    attack_probabilities: o.error ? undefined : probs,
    classification_error: o.error,
    simulated: o.simulated ?? false,
    method: "GET",
    url: o.url ?? "/",
    host: "app.example.test",
    remote_addr: `${ip}:50000`,
    protocol: "HTTP/1.1",
    headers: { "User-Agent": [o.ua ?? "curl/8.0"] },
    ip,
    verdict: risk >= 0.5 ? "blocked" : "allowed",
    location: { code: "US", name: "United States", country: "US", lat: 0, lon: 0 },
  };
}

export const times = <T>(n: number, f: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => f(i));
