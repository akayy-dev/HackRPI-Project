/**
 * Shared data contracts. Dates are ISO strings on the wire.
 * `RequestLog` mirrors exactly what the proxy writes to MongoDB
 * (see docs/WEB.md → "MongoDB schema"); `ConnectionEvent` adds the
 * fields the UI derives from it.
 */

export type Verdict = "allowed" | "blocked";

/** HTTP headers as Go's net/http serializes them: name → list of values. */
export type RequestHeaders = Record<string, string[]>;

/** The 14 independent sigmoid labels of the proxy's classifier (Go: classifier.AttackProbabilities). */
export const ATTACK_LABELS = [
  "normal",
  "protocol_manipulation",
  "code_injection",
  "os_command_injection",
  "path_traversal",
  "sql_injection",
  "dictionary_password_attack",
  "vulnerability_scanning",
  "input_data_manipulation",
  "command_injection",
  "http_verb_tampering",
  "source_spoofing",
  "http_response_splitting",
  "http_request_smuggling",
] as const;
export type AttackLabel = (typeof ATTACK_LABELS)[number];
/** Each score is 0..1; they are independent, so they do not sum to 1. */
export type AttackProbabilities = Record<AttackLabel, number>;

/**
 * One request document as stored by the reverse proxy (Go: telemetry.RequestTelemetry).
 * Real traffic (port 8080) and Traffic Lab simulations (port 8081) share the collection;
 * simulations have `simulated: true` plus `threshold`, `blocked`, `intended_classification`
 * and `generation_mode`. When classification fails, `risk` and `attack_probabilities` are
 * absent and `classification_error` is set (the proxy answered 503).
 */
export interface RequestLog {
  timestamp: string; // ISO 8601 (ISODate in Mongo)
  /** Riskiness 0..1 = 1 - attack_probabilities.normal. Absent when classification failed. */
  risk?: number;
  attack_probabilities?: AttackProbabilities;
  classification_error?: string;
  /** true for Traffic Lab submissions; always written by the proxy */
  simulated?: boolean;
  /** Simulations only: blocking threshold in effect (proxy.THRESHOLD) */
  threshold?: number;
  /** Simulations only: risk >= threshold. Real traffic stores no decision. */
  blocked?: boolean;
  /** Simulations only: the label the generator intended (never shown to the model) */
  intended_classification?: AttackLabel | string;
  /** Simulations only: "generated" (new payloads) or "examples" (reference replay) */
  generation_mode?: "generated" | "examples" | string;
  method: string;
  /** Request URI incl. query string, e.g. "/login?next=/" */
  url: string;
  host: string;
  /** "ip:port", e.g. "127.0.0.1:54344" or "[::1]:54344" */
  remote_addr: string;
  /** Proxy listener "ip:port" that accepted the request, when known */
  destination_addr?: string;
  protocol: string;
  /** Authorization, Proxy-Authorization, Cookie and X-Api-Key values are "[REDACTED]" */
  headers: RequestHeaders;
}

export interface GeoLocation {
  /** Code shown on the map: ISO country code ("US") or "LAN" */
  code: string;
  /** Display name, e.g. "United States" or "Local network" */
  name: string;
  /** ISO 3166-1 alpha-2 */
  country: string;
  lat: number;
  lon: number;
}

/** A RequestLog plus fields derived for the UI. */
export interface ConnectionEvent extends RequestLog {
  /** Always set: a missing/invalid stored risk becomes 0 */
  risk: number;
  /** Mongo `_id` as a string */
  id: string;
  /** Client IP: remote_addr, or a forwarding header when TRUST_PROXY_HEADERS=true */
  ip: string;
  /** Derived from risk: risk >= THREAT_SCORE → blocked */
  verdict: Verdict;
  /** Country-level location from ip; null when unknown (not drawn on the map) */
  location: GeoLocation | null;
}

export interface ServerNode {
  id: string;
  label: string;
  location: GeoLocation;
}

export interface ProxyStatus {
  active: boolean;
  /**
   * Round trip of the dashboard's latest MongoDB query (dashboard server → database),
   * in ms. null when no database is in use (mock data or the local feed).
   * Not the proxy's own request latency: the proxy doesn't record timings yet.
   */
  dbLatencyMs: number | null;
}

export interface SuggestedAction {
  id: string;
  label: string;
  actionLabel: string;
  variant: "primary" | "secondary";
}

export interface AiSummary {
  trafficPerMin: number;
  trafficStatus: "NORMAL" | "ELEVATED" | "CRITICAL";
  activeAnomaly: string | null;
  /** Markdown-free plain text */
  summary: string;
  suggestedActions: SuggestedAction[];
}

export interface DashboardData {
  server: ServerNode;
  status: ProxyStatus;
  connections: ConnectionEvent[];
  summary: AiSummary;
  generatedAt: string;
  source: "mock" | "mongodb" | "feed";
}

/** Connections grouped by origin location — what the map draws as one node. */
export interface MapNode {
  key: string;
  location: GeoLocation;
  total: number;
  blocked: number;
  allowed: number;
  maxRisk: number;
  /** Number of distinct client IPs at this location */
  ips: number;
  latest: ConnectionEvent;
}

export type TimeWindow = "5m" | "1h" | "24h";
export type VerdictFilter = "all" | Verdict;

export const TIME_WINDOW_MS: Record<TimeWindow, number> = {
  "5m": 5 * 60_000,
  "1h": 60 * 60_000,
  "24h": 24 * 60 * 60_000,
};
