#!/usr/bin/env node
/**
 * Generates mock request logs in the exact MongoDB document shape the Go proxy writes
 * (networking branch: telemetry.RequestTelemetry, see docs/WEB.md → "MongoDB schema")
 * and saves them as a JSON array.
 *
 *   node scripts/live-test/generate.mjs [--count 120] [--seed 42] [--simulated 30] [--errors 0]
 *                                       [--out scripts/live-test/mock-requests.json]
 *
 *   --simulated <pct>  share of Traffic Lab documents (simulated: true, port 8081)   default 30
 *   --errors <pct>     share of failed classifications (no risk, classification_error) default 0
 *
 * Two kinds of document share the collection, like in production:
 *  - real proxy traffic (port 8080): risk + all 14 attack_probabilities, simulated: false,
 *    no threshold/blocked/intended_classification
 *  - Traffic Lab simulations (port 8081): the same, plus threshold, blocked = risk >= threshold,
 *    intended_classification and generation_mode; payloads modelled on simulation/web/generator.js
 *
 * Scores mimic the independent sigmoid head: risk = 1 - normal, the true label scores high,
 * related labels moderately, the rest near zero; a few attacks are missed and a few benign
 * requests are flagged, since the classifier is not perfect.
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
const SIMULATED_PCT = Number(args.simulated ?? 30);
const ERROR_PCT = Number(args.errors ?? 0);
const OUT = path.resolve(args.out ?? "scripts/live-test/mock-requests.json");
const GEO_DB = path.resolve(process.env.GEOIP_DB_PATH ?? "data/dbip-country-lite.mmdb");

const THRESHOLD = 0.5; // proxy.THRESHOLD
const PROXY_LISTENER = "172.18.0.5:8080"; // destination_addr for real traffic (proxy container)

// Seeded PRNG so the fixture is reproducible.
let s = SEED >>> 0;
const rand = () => ((s = (s + 0x6d2b79f5) >>> 0), (((s ^ (s >>> 15)) * (1 | s)) >>> 0) / 2 ** 32);
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const between = (lo, hi) => lo + rand() * (hi - lo);
const round4 = (x) => Number(x.toFixed(4));
const chance = (pct) => rand() * 100 < pct;
const token = () => Math.floor(rand() * 36 ** 6).toString(36).padStart(6, "0");
const word = () => pick(["garden", "archive", "travel", "books", "camera", "summer", "music", "profile"]);
const slug = () => `${word()}-${token()}`;
const enc = (v) => encodeURIComponent(v).replace(/%20/g, "+");
const qs = (pairs) => pairs.map(([k, v]) => `${enc(k)}=${enc(String(v))}`).join("&");

// ---------------------------------------------------------------- classifier scores
const LABELS = [
  "normal", "protocol_manipulation", "code_injection", "os_command_injection", "path_traversal",
  "sql_injection", "dictionary_password_attack", "vulnerability_scanning", "input_data_manipulation",
  "command_injection", "http_verb_tampering", "source_spoofing", "http_response_splitting",
  "http_request_smuggling",
];
/** Labels the head tends to co-fire with a given attack (independent sigmoids). */
const RELATED = {
  sql_injection: ["code_injection", "input_data_manipulation"],
  code_injection: ["sql_injection", "command_injection"],
  os_command_injection: ["command_injection", "code_injection"],
  command_injection: ["os_command_injection"],
  path_traversal: ["vulnerability_scanning"],
  vulnerability_scanning: ["path_traversal", "http_verb_tampering"],
  dictionary_password_attack: ["input_data_manipulation"],
  input_data_manipulation: ["dictionary_password_attack"],
  http_request_smuggling: ["protocol_manipulation", "http_response_splitting"],
  http_response_splitting: ["code_injection", "http_request_smuggling"],
  protocol_manipulation: ["http_verb_tampering", "http_request_smuggling"],
  http_verb_tampering: ["protocol_manipulation"],
  source_spoofing: ["http_verb_tampering"],
};

/** Score a request whose true label is `label`. Returns { risk, attack_probabilities }. */
function score(label) {
  const p = Object.fromEntries(LABELS.map((l) => [l, between(0.0005, 0.04)]));
  if (label === "normal") {
    if (chance(4)) {
      // false positive: something about it looks off
      p.normal = between(0.3, 0.49);
      p[pick(LABELS.slice(1))] = between(0.35, 0.6);
    } else {
      p.normal = between(0.8, 0.995);
      if (chance(25)) p[pick(LABELS.slice(1))] = between(0.04, 0.18);
    }
  } else if (chance(8)) {
    // missed attack: the model leans normal
    p.normal = between(0.52, 0.85);
    p[label] = between(0.15, 0.45);
  } else {
    p.normal = between(0.005, 0.3);
    p[label] = between(0.7, 0.995);
    for (const r of RELATED[label] ?? []) if (chance(60)) p[r] = between(0.12, 0.55);
  }
  const attack_probabilities = Object.fromEntries(LABELS.map((l) => [l, round4(p[l])]));
  return { risk: round4(1 - attack_probabilities.normal), attack_probabilities };
}

// ---------------------------------------------------------------- request shapes
const UA = {
  firefox: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:159.0) Gecko/20100101 Firefox/159.0",
  chrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  safari: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  curl: "curl/8.9.1",
  sqlmap: "sqlmap/1.8.6#stable (https://sqlmap.org)",
  python: "python-requests/2.32.3",
  nikto: "Mozilla/5.00 (Nikto/2.5.0) (Evasions:None) (Test:000562)",
  gobuster: "gobuster/3.6",
  hydra: "Mozilla/4.0 (Hydra)",
};
const REDACTED = ["[REDACTED]"];

/** Real traffic through the proxy on :8080. */
const PROXY_HOST = "localhost:8080";
const browserHeaders = (ua) => ({
  "User-Agent": [ua],
  Accept: ["text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"],
  "Accept-Language": [pick(["en-US,en;q=0.9", "de-DE,de;q=0.8", "fr-FR,fr;q=0.8", "ja-JP,ja;q=0.9"])],
  "Accept-Encoding": ["gzip, deflate, br, zstd"],
  Connection: ["keep-alive"],
  "Sec-Fetch-Dest": ["document"],
  "Sec-Fetch-Mode": ["navigate"],
  "Sec-Fetch-Site": ["none"],
});
const toolHeaders = (ua, extra = {}) => ({ "User-Agent": [ua], Accept: ["*/*"], ...extra });

/** [weight, label, build() → { method, url, headers, protocol? }] */
const REAL_PROFILES = [
  [52, "normal", () => ({
    method: "GET",
    url: pick(["/", "/index", "/products", `/products/${int(1, 99)}`, "/pricing", "/about", "/docs", "/blog", `/blog/post-${int(1, 30)}`, "/login?next=/"]),
    headers: { ...browserHeaders(pick([UA.firefox, UA.chrome, UA.safari])), ...(chance(40) ? { Cookie: REDACTED } : {}) },
  })],
  [8, "normal", () => ({
    method: "POST",
    url: "/login",
    headers: { ...browserHeaders(pick([UA.firefox, UA.chrome])), "Content-Type": ["application/x-www-form-urlencoded"], Cookie: REDACTED },
  })],
  [4, "normal", () => ({ method: "GET", url: pick(["/status", "/healthz"]), headers: toolHeaders(UA.curl) })],
  [3, "normal", () => ({ method: "GET", url: `/api/orders/${int(1000, 9999)}`, headers: toolHeaders(UA.python, { Authorization: REDACTED, Accept: ["application/json"] }) })],
  [9, "sql_injection", () => ({
    method: "GET",
    url: pick(["/admin?id=1%20OR%201=1", "/login?user=admin'--", "/search?q=%27%20UNION%20SELECT%20*%20FROM%20users--", "/products?id=1;DROP%20TABLE%20users", `/products?id=${int(1, 99)}%20AND%20SLEEP(5)`]),
    headers: toolHeaders(UA.sqlmap),
  })],
  [8, "vulnerability_scanning", () => ({
    method: pick(["GET", "HEAD"]),
    url: pick(["/.env", "/.git/config", "/wp-admin/install.php", "/phpmyadmin/", "/backup.zip", "/server-status", "/wp-config.php.bak"]),
    headers: toolHeaders(pick([UA.nikto, UA.gobuster])),
  })],
  [4, "path_traversal", () => ({
    method: "GET",
    url: pick(["/../../etc/passwd", "/static/..%2f..%2f..%2fetc%2fshadow", "/download?file=../../../../windows/win.ini", "/assets/view.php?path=....//....//etc/passwd"]),
    headers: toolHeaders(UA.curl),
  })],
  [4, "dictionary_password_attack", () => ({
    method: "POST",
    url: pick(["/login", "/wp-login.php", "/account/login"]),
    headers: toolHeaders(UA.hydra, { "Content-Type": ["application/x-www-form-urlencoded"] }),
  })],
  [3, "os_command_injection", () => ({
    method: "GET",
    url: `/tools/ping?host=${enc(`127.0.0.1;${pick(["cat /etc/passwd", "id", "uname -a", "sleep 5"])}`)}`,
    headers: toolHeaders(UA.python),
  })],
  [2, "code_injection", () => ({
    method: "GET",
    url: pick(["/search?q=%7B%7B7*7%7D%7D", "/comment?body=%3C%3Fphp%20system(%24_GET%5Bc%5D)%3B%20%3F%3E", "/render?template=%24%7B7*7%7D"]),
    headers: browserHeaders(UA.chrome),
  })],
  [1, "http_verb_tampering", () => ({ method: pick(["TRACE", "PUT", "DELETE", "PROPFIND"]), url: "/admin/", headers: toolHeaders(UA.curl) })],
  [1, "source_spoofing", () => ({
    method: "GET",
    url: "/admin/",
    headers: toolHeaders(UA.curl, { "X-Forwarded-For": ["127.0.0.1"], "X-Real-Ip": [`127.0.0.${int(1, 254)}`] }),
  })],
  [1, "http_request_smuggling", () => ({
    method: "POST",
    url: "/",
    headers: toolHeaders(UA.python, { "Transfer-Encoding": ["chunked"], "Content-Length": [String(int(1, 12))] }),
  })],
];

/** Traffic Lab (simulation/web/generator.js) payloads, keyed by intended_classification. */
const LAB_HOSTS = ["test-site.com", "www.test-site.com", "shop.test-site.com"];
const LAB_UA = [
  "Mozilla/5.0 (X11; Linux x86_64; rv:70.0) Gecko/20100101 Firefox/70.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:72.0) Gecko/20100101 Firefox/72.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_9_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/44.0.2403.155 Safari/537.36",
];
const labScript = () => pick(["/blog/index.php", "/blog/search.php", "/shop/catalog.php", "/search.php"]);
const labQuery = (r, p, pairs) => { r.url = `${p}?${qs(pairs)}`; };
const labForm = (r, p) => { r.method = "POST"; r.url = p; r.headers["Content-Type"] = ["application/x-www-form-urlencoded"]; };
const labInject = (r, payload, field) => (chance(50) ? labForm(r, labScript()) : labQuery(r, labScript(), [[field, payload], ["page", token()]]));
const LAB_ATTACKS = {
  protocol_manipulation: (r) => { r.protocol = pick(["HTTP/0.9", "HTTP/1.0", "HTTP/2.0"]); r.method = pick(["OPTIONS", "TRACE"]); r.headers.Connection = [pick(["upgrade", "keep-alive, upgrade", "close"])]; },
  code_injection: (r) => labInject(r, pick([`<?php echo '${token()}'; ?>`, `{{${int(2, 99)}*${int(2, 99)}}}`]), pick(["template", "content", "user_login"])),
  os_command_injection: (r) => labInject(r, `${slug()}${pick([`\`sleep ${int(1, 9)}\``, `;echo ${token()}`, `&& sleep ${int(1, 9)}`])}`, pick(["user_login", "host", "name"])),
  path_traversal: (r) => labQuery(r, pick(["/blog/download.php", "/assets/view.php"]), [[pick(["file", "path", "template"]), pick(["../", "..\\"]).repeat(int(2, 8)) + pick(["etc/passwd", "wp-config.php", "windows/win.ini"])], ["name", slug()]]),
  sql_injection: (r) => labInject(r, pick([`' OR '${int(2, 999)}'='${int(2, 999)}' -- `, `' UNION SELECT ${Array(int(1, 6)).fill("NULL").join(",")} -- `, `${int(1, 999)} AND SLEEP(${int(1, 9)})`]), pick(["q", "id", "search", "username"])),
  dictionary_password_attack: (r) => labForm(r, pick(["/blog/wp-login.php", "/login.php", "/account/login"])),
  vulnerability_scanning: (r) => { labQuery(r, pick(["/blog/wp-admin/install.php", "/blog/.git/config", "/phpmyadmin/", "/.env"]), [["ver", token()]]); r.method = pick(["GET", "HEAD"]); r.headers["User-Agent"] = [`${pick(["Nikto/", "Nmap Scripting Engine/", "sqlmap/"])}${int(1, 5)}.${int(0, 9)}`]; },
  input_data_manipulation: (r) => labForm(r, pick(["/blog/index.php/my-account/", "/shop/checkout.php", "/api/profile"])),
  command_injection: (r) => labInject(r, `${slug()}${pick([";echo ", "&& printf ", "| echo "])}${token()}`, pick(["filename", "command", "convert"])),
  http_verb_tampering: (r) => { r.method = pick(["TRACE", "CONNECT", "DELETE", "PUT", "PROPFIND"]); r.url = `/blog/wp-admin/${slug()}/`; },
  source_spoofing: (r) => { r.url = `/blog/wp-admin/${slug()}/`; r.headers["X-Forwarded-For"] = [pick(["127.0.0.1", `10.0.0.${int(1, 254)}`])]; r.headers["X-Real-Ip"] = [`127.0.0.${int(1, 254)}`]; },
  http_response_splitting: (r) => labQuery(r, pick(["/blog/redirect.php", "/go.php"]), [[pick(["next", "redirect_to"]), `/${slug()}\r\n${pick(["Set-Cookie: Tamper=", "Location: /"])}${token()}`]]),
  http_request_smuggling: (r) => { r.method = "POST"; r.url = `/blog/${slug()}/`; r.headers["Transfer-Encoding"] = [pick(["chunked", "gzip, chunked"])]; r.headers["Content-Length"] = [String(int(1, 12))]; },
};

function labRequest(ip) {
  const r = {
    method: pick(["GET", "GET", "HEAD"]),
    url: `/blog/index.php/${slug()}/`,
    host: pick(LAB_HOSTS),
    remote_addr: `${ip}:${int(1024, 65535)}`,
    destination_addr: `172.26.0.${pick([4, 8, 12])}:80`,
    protocol: "HTTP/1.1",
    headers: {
      "User-Agent": [pick(LAB_UA)],
      Accept: [pick(["*/*", "text/html,application/xhtml+xml", "application/json"])],
      "Accept-Encoding": [pick(["gzip, deflate", "gzip, deflate, br"])],
      Connection: [pick(["keep-alive", "close"])],
    },
  };
  if (chance(30)) r.headers.Referer = [`http://${r.host}/blog/${word()}/`];
  let label = "normal";
  if (chance(50)) {
    label = pick(Object.keys(LAB_ATTACKS));
    LAB_ATTACKS[label](r);
  }
  return { r, label };
}

const CLASSIFICATION_ERRORS = [
  'embed request: Post "http://ollama:11434/api/embed": context deadline exceeded',
  'embed request: ollama: model "embeddinggemma:300m" not found, try pulling it first',
  "classification probabilities must be finite and between 0 and 1",
];

// ---------------------------------------------------------------- main
function isReservedV4([a, b]) {
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

const TOTAL_WEIGHT = REAL_PROFILES.reduce((n, [w]) => n + w, 0);
function pickRealProfile() {
  let r = rand() * TOTAL_WEIGHT;
  for (const p of REAL_PROFILES) if ((r -= p[0]) < 0) return p;
  return REAL_PROFILES[0];
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
    if (geo.get(ip)?.country?.iso_code) pool.push(ip);
  }

  const start = Date.now() - COUNT * 1500;
  const logs = Array.from({ length: COUNT }, (_, i) => {
    const simulated = chance(SIMULATED_PCT);
    const ip = !simulated && chance(5) ? `192.168.1.${int(2, 250)}` : pick(pool); // a little LAN traffic
    let req;
    let label;
    if (simulated) {
      ({ r: req, label } = labRequest(ip));
    } else {
      const [, l, build] = pickRealProfile();
      const b = build();
      label = l;
      req = { host: PROXY_HOST, remote_addr: `${ip}:${int(32768, 65535)}`, destination_addr: PROXY_LISTENER, protocol: "HTTP/1.1", ...b };
    }

    // Field order follows telemetry.RequestTelemetry; Host is always set from r.Host.
    const doc = { timestamp: new Date(start + i * 1500).toISOString() }; // replaced with "now" when replayed
    if (chance(ERROR_PCT)) {
      doc.classification_error = pick(CLASSIFICATION_ERRORS);
    } else {
      Object.assign(doc, score(label));
    }
    doc.simulated = simulated;
    if (simulated) {
      doc.threshold = THRESHOLD;
      if (doc.risk !== undefined) doc.blocked = doc.risk >= THRESHOLD;
      doc.intended_classification = label;
      doc.generation_mode = chance(90) ? "generated" : "examples";
    }
    Object.assign(doc, {
      method: req.method,
      url: req.url,
      host: req.host,
      remote_addr: req.remote_addr,
      destination_addr: req.destination_addr,
      protocol: req.protocol,
      headers: { ...req.headers, Host: [req.host] },
    });
    return doc;
  });

  await writeFile(OUT, JSON.stringify(logs, null, 2) + "\n");
  const threats = logs.filter((l) => (l.risk ?? 0) >= THRESHOLD).length;
  const sims = logs.filter((l) => l.simulated).length;
  const errors = logs.filter((l) => l.classification_error).length;
  const countries = new Set(pool.map((ip) => geo.get(ip)?.country?.iso_code));
  console.log(
    `Wrote ${logs.length} requests (${threats} threats, ${sims} simulated, ${errors} classification errors, ` +
      `${countries.size} countries) → ${path.relative(process.cwd(), OUT)}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
