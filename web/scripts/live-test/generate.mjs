#!/usr/bin/env node
/**
 * Generates mock request logs in the exact MongoDB schema the proxy writes
 * (docs/WEB.md → "MongoDB schema") and saves them as a JSON array.
 *
 *   node scripts/live-test/generate.mjs [--count 120] [--seed 42] [--out scripts/live-test/mock-requests.json]
 *
 * Client IPs are random public IPv4s that resolve in the DB-IP country database
 * (data/dbip-country-lite.mmdb, `npm run geoip:download`), so every request lands on the map.
 */
import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import maxmind from "maxmind";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const COUNT = Number(args.count ?? 120);
const SEED = Number(args.seed ?? 42);
const OUT = path.resolve(args.out ?? "scripts/live-test/mock-requests.json");
const GEO_DB = path.resolve(process.env.GEOIP_DB_PATH ?? "data/dbip-country-lite.mmdb");

// Seeded PRNG so the fixture is reproducible.
let s = SEED >>> 0;
const rand = () => ((s = (s + 0x6d2b79f5) >>> 0), (((s ^ (s >>> 15)) * (1 | s)) >>> 0) / 2 ** 32);
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const between = (lo, hi) => Number((lo + rand() * (hi - lo)).toFixed(4));

const HOST = "localhost:8080";
const UA = {
  firefox: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:159.0) Gecko/20100101 Firefox/159.0",
  chrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  safari: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  curl: "curl/8.9.1",
  sqlmap: "sqlmap/1.8.6#stable (https://sqlmap.org)",
  python: "python-requests/2.32.3",
  nikto: "Mozilla/5.00 (Nikto/2.5.0) (Evasions:None) (Test:000562)",
  gobuster: "gobuster/3.6",
};

const browserHeaders = (ua) => ({
  Host: [HOST],
  "User-Agent": [ua],
  Accept: ["text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"],
  "Accept-Language": [pick(["en-US,en;q=0.9", "de-DE,de;q=0.8", "fr-FR,fr;q=0.8", "ja-JP,ja;q=0.9"])],
  "Accept-Encoding": ["gzip, deflate, br, zstd"],
  Connection: ["keep-alive"],
  "Sec-Fetch-Dest": ["document"],
  "Sec-Fetch-Mode": ["navigate"],
  "Sec-Fetch-Site": ["none"],
});
const toolHeaders = (ua, extra = {}) => ({ Host: [HOST], "User-Agent": [ua], Accept: ["*/*"], ...extra });

/** Traffic profiles: [weight, build()] → { method, url, risk, headers } */
const PROFILES = [
  [55, () => ({
    method: "GET",
    url: pick(["/", "/index", "/products", `/products/${int(1, 99)}`, "/pricing", "/about", "/docs", "/blog", `/blog/post-${int(1, 30)}`, "/login?next=/"]),
    risk: between(0.0, 0.25),
    headers: browserHeaders(pick([UA.firefox, UA.chrome, UA.safari])),
  })],
  [8, () => ({
    method: "POST",
    url: "/login",
    risk: between(0.05, 0.35),
    headers: { ...browserHeaders(pick([UA.firefox, UA.chrome])), "Content-Type": ["application/x-www-form-urlencoded"] },
  })],
  [5, () => ({ method: "GET", url: pick(["/status", "/healthz"]), risk: between(0.0, 0.05), headers: toolHeaders(UA.curl) })],
  [10, () => ({
    method: pick(["GET", "POST"]),
    url: pick(["/admin?id=1%20OR%201=1", "/login?user=admin'--", "/search?q=%27%20UNION%20SELECT%20*%20FROM%20users--", "/products?id=1;DROP%20TABLE%20users"]),
    risk: between(0.85, 0.99),
    headers: toolHeaders(UA.sqlmap),
  })],
  [8, () => ({
    method: "GET",
    url: pick(["/.env", "/.git/config", "/wp-admin", "/phpmyadmin", "/admin", "/backup.zip", "/server-status"]),
    risk: between(0.6, 0.95),
    headers: toolHeaders(pick([UA.nikto, UA.gobuster, UA.curl])),
  })],
  [5, () => ({
    method: "GET",
    url: pick(["/../../etc/passwd", "/static/..%2f..%2f..%2fetc%2fshadow", "/download?file=../../../../windows/win.ini"]),
    risk: between(0.9, 0.99),
    headers: toolHeaders(UA.curl),
  })],
  [5, () => ({
    method: "POST",
    url: pick(["/api/upload", "/graphql", "/wp-login.php", "/xmlrpc.php"]),
    risk: between(0.5, 0.9),
    headers: toolHeaders(UA.python, { "Content-Type": [pick(["application/json", "multipart/form-data; boundary=x"])] }),
  })],
  [4, () => ({
    method: "GET",
    url: pick(["/", "/search?q=<script>alert(1)</script>", "/comment?body=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E"]),
    risk: between(0.4, 0.8),
    headers: browserHeaders(UA.chrome),
  })],
];
const TOTAL_WEIGHT = PROFILES.reduce((n, [w]) => n + w, 0);
function pickProfile() {
  let r = rand() * TOTAL_WEIGHT;
  for (const [w, build] of PROFILES) if ((r -= w) < 0) return build;
  return PROFILES[0][1];
}

function isReservedV4([a, b]) {
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

async function main() {
  if (!existsSync(GEO_DB)) {
    console.error(`Geo DB not found at ${GEO_DB} — run \`npm run geoip:download\` first.`);
    process.exit(1);
  }
  const geo = await maxmind.open(GEO_DB);

  // A pool of client IPs, reused so some origins repeat (like real attackers / regulars).
  const pool = [];
  while (pool.length < Math.ceil(COUNT / 3)) {
    const oct = [int(1, 223), int(0, 255), int(0, 255), int(1, 254)];
    if (isReservedV4(oct)) continue;
    const ip = oct.join(".");
    const country = geo.get(ip)?.country?.iso_code;
    if (country) pool.push(ip);
  }

  const start = Date.now() - COUNT * 1500;
  const logs = Array.from({ length: COUNT }, (_, i) => {
    const { method, url, risk, headers } = pickProfile()();
    const ip = rand() < 0.05 ? `192.168.1.${int(2, 250)}` : pick(pool); // a little LAN traffic
    return {
      timestamp: new Date(start + i * 1500).toISOString(), // replaced with "now" when replayed
      risk,
      method,
      url,
      host: HOST,
      remote_addr: `${ip}:${int(32768, 65535)}`,
      protocol: "HTTP/1.1",
      headers,
    };
  });

  await writeFile(OUT, JSON.stringify(logs, null, 2) + "\n");
  const threats = logs.filter((l) => l.risk >= 0.5).length;
  const countries = new Set(pool.map((ip) => geo.get(ip)?.country?.iso_code));
  console.log(`Wrote ${logs.length} requests (${threats} threats, ${countries.size} countries) → ${path.relative(process.cwd(), OUT)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
