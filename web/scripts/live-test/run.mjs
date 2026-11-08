#!/usr/bin/env node
/**
 * Live dashboard test: replays mock request logs into the dashboard's local feed
 * one by one with random delays (simulated real-time traffic), and checks that every
 * request shows up in /api/dashboard — the endpoint the admin panel polls.
 *
 *   npm run dev            # in another terminal (no MONGODB_URI set)
 *   npm run test:live      # open http://localhost:3000 and watch it fill up
 *
 * Options:
 *   --input <file>   mock requests JSON array   (default scripts/live-test/mock-requests.json)
 *   --count <n>      replay only the first n     (default: all)
 *   --min <ms>       min delay between requests  (default 300)
 *   --max <ms>       max delay between requests  (default 2500)
 *   --url <url>      dashboard base URL          (default http://localhost:3000)
 *   --timeout <ms>   max time for a request to appear on the dashboard (default 10000)
 *   --loop           keep replaying forever (Ctrl+C to stop)
 *   --no-verify      only write the feed, don't check the dashboard
 *   --append         keep the existing feed instead of starting from an empty one
 *
 * The feed is data/live-feed.ndjson (override with MOCK_FEED_FILE). While it exists and
 * MONGODB_URI is unset, the dashboard reads it instead of the built-in mock data.
 * Delete it to go back to mock data.
 */
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : def;
};

const INPUT = path.resolve(opt("input", "scripts/live-test/mock-requests.json"));
const FEED = path.resolve(process.env.MOCK_FEED_FILE ?? "data/live-feed.ndjson");
const MIN = Number(opt("min", 300));
const MAX = Number(opt("max", 2500));
const URL_BASE = opt("url", "http://localhost:3000").replace(/\/$/, "");
const TIMEOUT = Number(opt("timeout", 10_000));
const LOOP = flag("loop");
const VERIFY = !flag("no-verify");
const APPEND = flag("append");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const c = { dim: (s) => `\x1b[2m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m` };

/** Random gap; ~15% of the time a short burst, like a scanner hammering the proxy. */
const nextDelay = () => (Math.random() < 0.15 ? rand(40, 200) : rand(MIN, MAX));

async function fetchDashboard() {
  const res = await fetch(`${URL_BASE}/api/dashboard`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// --- verification: poll the API the panel uses, time how long each request takes to appear
const pending = new Map(); // id → { insertedAt, label }
const latencies = [];
const missing = [];
let wrongSource = null;
let pollerStop = false;

async function poller() {
  while (!pollerStop) {
    try {
      const data = await fetchDashboard();
      if (data.source !== "feed") wrongSource = data.source;
      const seen = new Set(data.connections.map((e) => e.id));
      const now = Date.now();
      for (const [id, p] of pending) {
        if (seen.has(id)) {
          latencies.push(now - p.insertedAt);
          pending.delete(id);
        } else if (now - p.insertedAt > TIMEOUT) {
          missing.push(p.label);
          pending.delete(id);
        }
      }
    } catch {
      /* server hiccup (e.g. dev recompiling) — retry */
    }
    await sleep(250);
  }
}

const pct = (xs, p) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))] : 0);

let inserted = 0;
let summarized = false;
function summary() {
  if (summarized) return;
  summarized = true;
  console.log("");
  console.log(`Inserted ${inserted} requests into ${path.relative(process.cwd(), FEED)}`);
  if (!VERIFY) return;
  console.log(`Seen on dashboard: ${latencies.length}/${inserted}` +
    (latencies.length ? c.dim(`  (latency p50 ${pct(latencies, 0.5)}ms · p95 ${pct(latencies, 0.95)}ms · max ${Math.max(...latencies)}ms)`) : ""));
  if (wrongSource) console.log(c.red(`Dashboard served source "${wrongSource}" instead of "feed" — is MONGODB_URI set, or is the server running from another folder?`));
  if (missing.length) console.log(c.red(`Never appeared within ${TIMEOUT}ms:\n  ${missing.join("\n  ")}`));
  const pass = missing.length === 0 && pending.size === 0 && !wrongSource && latencies.length === inserted;
  console.log(pass ? c.green("PASS — dashboard updated live for every request") : c.red("FAIL"));
  process.exitCode = pass ? 0 : 1;
}

async function main() {
  const logs = JSON.parse(await readFile(INPUT, "utf8"));
  if (!Array.isArray(logs) || logs.length === 0) throw new Error(`${INPUT} must be a non-empty JSON array`);
  const count = Math.min(Number(opt("count", logs.length)), logs.length);

  if (VERIFY) {
    try {
      await fetchDashboard();
    } catch (err) {
      console.error(c.red(`Can't reach ${URL_BASE}/api/dashboard (${err.message}).`));
      console.error(`Start the dashboard first (\`npm run dev\`), pass --url, or use --no-verify.`);
      process.exit(1);
    }
  }

  await mkdir(path.dirname(FEED), { recursive: true });
  if (!APPEND) await writeFile(FEED, "");

  console.log(`Replaying ${count} requests${LOOP ? " (looping)" : ""} → ${path.relative(process.cwd(), FEED)}` +
    c.dim(`  delay ${MIN}–${MAX}ms · watching ${URL_BASE}`));
  const poll = VERIFY ? poller() : null;

  let interrupted = false;
  process.on("SIGINT", () => {
    interrupted = true;
  });

  do {
    for (let i = 0; i < count && !interrupted; i++) {
      await sleep(nextDelay());
      if (interrupted) break;
      const _id = randomBytes(12).toString("hex"); // ObjectId-shaped
      const doc = { _id, ...logs[i], timestamp: new Date().toISOString() };
      await appendFile(FEED, JSON.stringify(doc) + "\n");
      inserted++;
      const label = `${doc.method} ${doc.url} ${doc.remote_addr}`;
      if (VERIFY) pending.set(_id, { insertedAt: Date.now(), label });
      const tag = doc.risk >= 0.5 ? c.red("THREAT") : c.green("ok    ");
      console.log(`${c.dim(doc.timestamp.slice(11, 23))} ${tag} ${doc.risk.toFixed(2)} ${label}`);
    }
  } while (LOOP && !interrupted);

  if (VERIFY) {
    // let the last requests reach the dashboard
    const deadline = Date.now() + TIMEOUT + 500;
    while (pending.size && Date.now() < deadline && !interrupted) await sleep(100);
    pollerStop = true;
    await poll;
  }
  summary();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
