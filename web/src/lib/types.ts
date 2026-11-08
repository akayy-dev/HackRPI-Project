/**
 * Shared data contracts. Dates are ISO strings on the wire.
 * `RequestLog` mirrors exactly what the proxy writes to MongoDB
 * (see docs/WEB.md → "MongoDB schema"); `ConnectionEvent` adds the
 * fields the UI derives from it.
 */

export type Verdict = "allowed" | "blocked";

/** HTTP headers as Go's net/http serializes them: name → list of values. */
export type RequestHeaders = Record<string, string[]>;

/** One request document as stored by the reverse proxy. */
export interface RequestLog {
  timestamp: string; // ISO 8601 (ISODate in Mongo)
  /** ML classifier risk 0..1 */
  risk: number;
  method: string;
  /** Request URI incl. query string, e.g. "/login?next=/" */
  url: string;
  host: string;
  /** "ip:port", e.g. "127.0.0.1:54344" or "[::1]:54344" */
  remote_addr: string;
  protocol: string;
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
  latencyMs: number;
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
