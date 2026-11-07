/**
 * Shared data contracts. These match the documents we expect to store in MongoDB
 * (see web/README.md → "MongoDB schema"). Dates are ISO strings on the wire.
 */

export type Verdict = "allowed" | "blocked";
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export interface GeoLocation {
  /** Short region code shown on the map, e.g. "US-NYC" */
  code: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
}

/** One request seen by the reverse proxy. */
export interface ConnectionEvent {
  id: string;
  timestamp: string; // ISO 8601
  ip: string;
  method: HttpMethod;
  path: string;
  verdict: Verdict;
  /** ML threat score 0..1 from the classifier */
  mlScore: number;
  /** Threat label when the model flags something, e.g. "SQLi" */
  threat: string | null;
  location: GeoLocation;
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
  source: "mock" | "mongodb";
}

/** Connections grouped by origin location — what the map draws as one node. */
export interface MapNode {
  key: string;
  location: GeoLocation;
  total: number;
  blocked: number;
  allowed: number;
  maxScore: number;
  topThreat: string | null;
  latest: ConnectionEvent;
}

export type TimeWindow = "5m" | "1h" | "24h";
export type VerdictFilter = "all" | Verdict;

export const TIME_WINDOW_MS: Record<TimeWindow, number> = {
  "5m": 5 * 60_000,
  "1h": 60 * 60_000,
  "24h": 24 * 60 * 60_000,
};
