import type { AiSummary, DashboardData, RequestHeaders, RequestLog, ServerNode } from "@/lib/types";
import "server-only";
import { getGeoResolver } from "@/lib/geo";
import { toConnectionEvent } from "./toEvent";

/**
 * Hard-coded demo data in the same shape the proxy writes to MongoDB.
 * Timestamps are generated relative to "now" so the 5m / 1h / 24h filters
 * behave like real traffic. Replace by setting MONGODB_URI.
 */

export const MOCK_SERVER: ServerNode = {
  id: "fra-01",
  label: "FRA-01",
  location: { code: "DE", name: "Frankfurt", country: "DE", lat: 50.11, lon: 8.68 },
};

const UA = {
  firefox: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:159.0) Gecko/20100101 Firefox/159.0",
  chrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  curl: "curl/8.9.1",
  sqlmap: "sqlmap/1.8.6#stable (https://sqlmap.org)",
  python: "python-requests/2.32.3",
  nikto: "Mozilla/5.00 (Nikto/2.5.0) (Evasions:None) (Test:000562)",
};

const HOST = "localhost:8080";

function browserHeaders(ua: string): RequestHeaders {
  return {
    Host: [HOST],
    "User-Agent": [ua],
    Accept: ["text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"],
    "Accept-Language": ["en-US,en;q=0.9"],
    "Accept-Encoding": ["gzip, deflate, br, zstd"],
    Connection: ["keep-alive"],
    "Sec-Fetch-Dest": ["document"],
    "Sec-Fetch-Mode": ["navigate"],
    "Sec-Fetch-Site": ["none"],
  };
}

function toolHeaders(ua: string, extra: RequestHeaders = {}): RequestHeaders {
  return { Host: [HOST], "User-Agent": [ua], Accept: ["*/*"], ...extra };
}

type Seed = [secondsAgo: number, remoteAddr: string, method: string, url: string, risk: number, headers: RequestHeaders];

const SEEDS: Seed[] = [
  [3, "127.0.0.1:54344", "GET", "/", 0.19936596037236387, browserHeaders(UA.firefox)],
  [7, "203.0.113.12:51022", "GET", "/index", 0.04, browserHeaders(UA.chrome)],
  [9, "198.51.100.7:40112", "POST", "/login", 0.97, toolHeaders(UA.sqlmap, { "Content-Type": ["application/x-www-form-urlencoded"] })],
  [16, "203.0.113.45:62310", "GET", "/products", 0.11, browserHeaders(UA.firefox)],
  [20, "192.0.2.88:33891", "GET", "/admin?id=1%20OR%201=1", 0.92, toolHeaders(UA.sqlmap)],
  [28, "203.0.113.3:50544", "GET", "/about", 0.02, browserHeaders(UA.chrome)],
  [36, "198.51.100.23:44120", "POST", "/api/upload", 0.88, toolHeaders(UA.python, { "Content-Type": ["multipart/form-data; boundary=x"] })],
  [52, "203.0.113.77:58001", "GET", "/pricing", 0.06, browserHeaders(UA.chrome)],
  [75, "198.51.100.9:39004", "GET", "/admin", 0.81, toolHeaders(UA.nikto)],
  [110, "203.0.113.150:61002", "GET", "/docs", 0.03, browserHeaders(UA.firefox)],
  [140, "192.0.2.14:41877", "POST", "/wp-login.php", 0.9, toolHeaders(UA.python)],
  [200, "203.0.113.201:52219", "GET", "/", 0.05, browserHeaders(UA.chrome)],
  [600, "203.0.113.90:60123", "GET", "/blog", 0.07, browserHeaders(UA.firefox)],
  [1500, "192.0.2.201:37761", "GET", "/.env", 0.95, toolHeaders(UA.curl)],
  [2400, "203.0.113.31:49152", "GET", "/status", 0.01, toolHeaders(UA.curl)],
  [9000, "198.51.100.66:45678", "POST", "/graphql", 0.76, toolHeaders(UA.python, { "Content-Type": ["application/json"] })],
  [30000, "203.0.113.8:53311", "GET", "/products/42", 0.08, browserHeaders(UA.chrome)],
  [60000, "192.0.2.50:34567", "GET", "/../../etc/passwd", 0.99, toolHeaders(UA.curl)],
];

function seedToLog([secondsAgo, remote_addr, method, url, risk, headers]: Seed, now: number): RequestLog {
  return {
    timestamp: new Date(now - secondsAgo * 1000).toISOString(),
    risk,
    method,
    url,
    host: HOST,
    remote_addr,
    protocol: "HTTP/1.1",
    headers,
  };
}

const MOCK_SUMMARY: AiSummary = {
  trafficPerMin: 2400,
  trafficStatus: "NORMAL",
  activeAnomaly: "SQLi",
  summary:
    "Unusual request volume on /admin from subnet 198.51.100.0/24. All payloads intercepted and quarantined.",
  suggestedActions: [
    { id: "block-subnet", label: "Block subnet 198.51.100.0/24", actionLabel: "Apply", variant: "primary" },
    { id: "inspect-admin", label: "Inspect /admin queries", actionLabel: "View", variant: "secondary" },
  ],
};

export async function getMockDashboard(now = Date.now()): Promise<DashboardData> {
  const geo = await getGeoResolver(MOCK_SERVER.location);
  return {
    server: MOCK_SERVER,
    status: { active: true, latencyMs: 1.4 },
    connections: SEEDS.map((s, i) => toConnectionEvent(seedToLog(s, now), `mock-${i}`, geo)),
    summary: MOCK_SUMMARY,
    generatedAt: new Date(now).toISOString(),
    source: "mock",
  };
}
