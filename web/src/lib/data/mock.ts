import {
  ATTACK_LABELS,
  type AttackLabel,
  type AttackProbabilities,
  type DashboardData,
  type RequestHeaders,
  type RequestLog,
  type ServerNode,
} from "@/lib/types";
import "server-only";
import { getGeoResolver } from "@/lib/geo";
import { heuristicSummary } from "@/lib/ai/analyst";
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

type Seed = [
  secondsAgo: number,
  remoteAddr: string,
  method: string,
  url: string,
  risk: number,
  label: AttackLabel,
  headers: RequestHeaders,
];

const SEEDS: Seed[] = [
  [3, "127.0.0.1:54344", "GET", "/", 0.1994, "normal", browserHeaders(UA.firefox)],
  [7, "203.0.113.12:51022", "GET", "/index", 0.04, "normal", browserHeaders(UA.chrome)],
  [9, "198.51.100.7:40112", "POST", "/login", 0.97, "sql_injection", toolHeaders(UA.sqlmap, { "Content-Type": ["application/x-www-form-urlencoded"] })],
  [16, "203.0.113.45:62310", "GET", "/products", 0.11, "normal", { ...browserHeaders(UA.firefox), Cookie: ["[REDACTED]"] }],
  [20, "192.0.2.88:33891", "GET", "/admin?id=1%20OR%201=1", 0.92, "sql_injection", toolHeaders(UA.sqlmap)],
  [28, "203.0.113.3:50544", "GET", "/about", 0.02, "normal", browserHeaders(UA.chrome)],
  [36, "198.51.100.23:44120", "POST", "/api/upload", 0.88, "code_injection", toolHeaders(UA.python, { "Content-Type": ["multipart/form-data; boundary=x"] })],
  [52, "203.0.113.77:58001", "GET", "/pricing", 0.06, "normal", browserHeaders(UA.chrome)],
  [75, "198.51.100.9:39004", "GET", "/admin", 0.81, "vulnerability_scanning", toolHeaders(UA.nikto)],
  [110, "203.0.113.150:61002", "GET", "/docs", 0.03, "normal", browserHeaders(UA.firefox)],
  [140, "192.0.2.14:41877", "POST", "/wp-login.php", 0.9, "dictionary_password_attack", toolHeaders(UA.python)],
  [200, "203.0.113.201:52219", "GET", "/", 0.05, "normal", browserHeaders(UA.chrome)],
  [600, "203.0.113.90:60123", "GET", "/blog", 0.07, "normal", browserHeaders(UA.firefox)],
  [1500, "192.0.2.201:37761", "GET", "/.env", 0.95, "vulnerability_scanning", toolHeaders(UA.curl)],
  [2400, "203.0.113.31:49152", "GET", "/status", 0.01, "normal", toolHeaders(UA.curl)],
  [9000, "198.51.100.66:45678", "POST", "/graphql", 0.76, "input_data_manipulation", toolHeaders(UA.python, { "Content-Type": ["application/json"] })],
  [30000, "203.0.113.8:53311", "GET", "/products/42", 0.08, "normal", browserHeaders(UA.chrome)],
  [60000, "192.0.2.50:34567", "GET", "/../../etc/passwd", 0.99, "path_traversal", toolHeaders(UA.curl)],
];

/** Sigmoid-head-shaped scores: normal = 1 - risk, the seed's label scores high, the rest near zero. */
function probabilities(risk: number, label: AttackLabel, i: number): AttackProbabilities {
  const p = Object.fromEntries(
    ATTACK_LABELS.map((l, j) => [l, Number((0.002 + ((i * 7 + j * 13) % 17) / 1000).toFixed(4))]),
  ) as AttackProbabilities;
  p.normal = Number((1 - risk).toFixed(4));
  if (label !== "normal") p[label] = Number(Math.min(0.995, risk + 0.01).toFixed(4));
  return p;
}

function seedToLog([secondsAgo, remote_addr, method, url, risk, label, headers]: Seed, i: number, now: number): RequestLog {
  return {
    timestamp: new Date(now - secondsAgo * 1000).toISOString(),
    risk,
    attack_probabilities: probabilities(risk, label, i),
    simulated: false,
    method,
    url,
    host: HOST,
    remote_addr,
    destination_addr: "172.18.0.5:8080",
    protocol: "HTTP/1.1",
    headers: { ...headers, Host: [HOST] },
  };
}

export async function getMockDashboard(now = Date.now()): Promise<DashboardData> {
  const geo = await getGeoResolver(MOCK_SERVER.location);
  const connections = SEEDS.map((s, i) => toConnectionEvent(seedToLog(s, i, now), `mock-${i}`, geo));
  return {
    server: MOCK_SERVER,
    status: { active: true, dbLatencyMs: null },
    connections,
    summary: heuristicSummary(connections, now),
    generatedAt: new Date(now).toISOString(),
    source: "mock",
  };
}
