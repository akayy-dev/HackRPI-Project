import type {
  AiSummary,
  ConnectionEvent,
  DashboardData,
  GeoLocation,
  HttpMethod,
  ServerNode,
} from "@/lib/types";

/**
 * Hard-coded demo data. Timestamps are generated relative to "now" so the
 * 5m / 1h / 24h filters behave like real traffic. Replace by setting MONGODB_URI.
 */

export const LOCATIONS: Record<string, GeoLocation> = {
  "US-NYC": { code: "US-NYC", city: "New York", country: "US", lat: 40.71, lon: -74.0 },
  "US-SFO": { code: "US-SFO", city: "San Francisco", country: "US", lat: 37.77, lon: -122.42 },
  "BR-SAO": { code: "BR-SAO", city: "São Paulo", country: "BR", lat: -23.55, lon: -46.63 },
  "UK-LON": { code: "UK-LON", city: "London", country: "GB", lat: 51.51, lon: -0.13 },
  "DE-FRA": { code: "DE-FRA", city: "Frankfurt", country: "DE", lat: 50.11, lon: 8.68 },
  "RU-MOW": { code: "RU-MOW", city: "Moscow", country: "RU", lat: 55.76, lon: 37.62 },
  "IN-BOM": { code: "IN-BOM", city: "Mumbai", country: "IN", lat: 19.08, lon: 72.88 },
  "JP-TYO": { code: "JP-TYO", city: "Tokyo", country: "JP", lat: 35.68, lon: 139.69 },
  "AU-SYD": { code: "AU-SYD", city: "Sydney", country: "AU", lat: -33.87, lon: 151.21 },
  "ZA-JNB": { code: "ZA-JNB", city: "Johannesburg", country: "ZA", lat: -26.2, lon: 28.05 },
  "SG-SIN": { code: "SG-SIN", city: "Singapore", country: "SG", lat: 1.35, lon: 103.82 },
};

export const MOCK_SERVER: ServerNode = {
  id: "fra-01",
  label: "FRA-01",
  location: { code: "DE-FRA", city: "Frankfurt", country: "DE", lat: 50.11, lon: 8.68 },
};

type Seed = [
  secondsAgo: number,
  ip: string,
  loc: keyof typeof LOCATIONS,
  method: HttpMethod,
  path: string,
  score: number,
  threat: string | null,
];

// verdict is derived: score >= 0.5 → blocked
const SEEDS: Seed[] = [
  [7, "203.0.113.12", "US-NYC", "GET", "/index", 0.04, null],
  [9, "198.51.100.7", "RU-MOW", "POST", "/login", 0.97, "SQLi"],
  [16, "203.0.113.45", "UK-LON", "GET", "/products", 0.11, null],
  [20, "192.0.2.88", "BR-SAO", "GET", "/admin?id=1 OR 1=1", 0.92, "SQLi"],
  [28, "203.0.113.3", "JP-TYO", "GET", "/about", 0.02, null],
  [36, "198.51.100.23", "AU-SYD", "POST", "/api/upload", 0.88, "Payload"],
  [52, "203.0.113.77", "US-SFO", "GET", "/pricing", 0.06, null],
  [75, "198.51.100.9", "RU-MOW", "GET", "/admin", 0.81, "Recon"],
  [110, "203.0.113.150", "SG-SIN", "GET", "/docs", 0.03, null],
  [140, "192.0.2.14", "ZA-JNB", "POST", "/wp-login.php", 0.9, "Brute force"],
  [200, "203.0.113.201", "IN-BOM", "GET", "/", 0.05, null],
  [600, "203.0.113.90", "UK-LON", "GET", "/blog", 0.07, null],
  [1500, "192.0.2.201", "IN-BOM", "GET", "/.env", 0.95, "Path traversal"],
  [2400, "203.0.113.31", "DE-FRA", "GET", "/status", 0.01, null],
  [9000, "198.51.100.66", "BR-SAO", "POST", "/graphql", 0.76, "XSS"],
  [30000, "203.0.113.8", "JP-TYO", "GET", "/products/42", 0.08, null],
  [60000, "192.0.2.50", "US-NYC", "GET", "/../../etc/passwd", 0.99, "Path traversal"],
];

function seedToEvent(seed: Seed, now: number, i: number): ConnectionEvent {
  const [secondsAgo, ip, loc, method, path, score, threat] = seed;
  return {
    id: `mock-${i}`,
    timestamp: new Date(now - secondsAgo * 1000).toISOString(),
    ip,
    method,
    path,
    verdict: score >= 0.5 ? "blocked" : "allowed",
    mlScore: score,
    threat,
    location: LOCATIONS[loc],
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

export function getMockDashboard(now = Date.now()): DashboardData {
  return {
    server: MOCK_SERVER,
    status: { active: true, latencyMs: 1.4 },
    connections: SEEDS.map((s, i) => seedToEvent(s, now, i)),
    summary: MOCK_SUMMARY,
    generatedAt: new Date(now).toISOString(),
    source: "mock",
  };
}
