// Headless Traffic Lab: same generator as http://localhost:8081, no browser clicks needed.
// Usage: node scripts/demo-traffic.mjs [--rate 3] [--malicious 30] [--count 0] [--lab http://127.0.0.1:8081]
//   --count 0 runs until Ctrl+C.
import { ATTACKS, makeRequest } from "../simulation/web/generator.js";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const rate = Math.min(100, Math.max(0.2, Number(args.rate ?? 3)));
const malicious = Math.min(100, Math.max(0, Number(args.malicious ?? 30)));
const count = Number(args.count ?? 0);
const lab = (args.lab ?? "http://127.0.0.1:8081").replace(/\/$/, "");
const MAX_ACTIVE = 8; // same cap as the Lab page

const stats = { sent: 0, accepted: 0, rejected: 0, errors: 0, active: 0 };
let lastError = "";

async function waitForLab() {
  process.stdout.write(`waiting for Traffic Lab at ${lab} `);
  for (;;) {
    try {
      const res = await fetch(lab + "/", { signal: AbortSignal.timeout(2000) });
      if (res.ok) break;
    } catch {}
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(" up");
}

async function sendOne() {
  const { request } = makeRequest(malicious, ATTACKS, "public", "generated");
  stats.sent++;
  stats.active++;
  try {
    const res = await fetch(lab + "/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(60_000),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok || typeof result.blocked !== "boolean") throw new Error(result.classification_error || result.error || `HTTP ${res.status}`);
    result.blocked ? stats.rejected++ : stats.accepted++;
  } catch (err) {
    stats.errors++;
    lastError = err.message;
  } finally {
    stats.active--;
  }
}

await waitForLab();
console.log(`sending ${rate}/s, ${malicious}% malicious${count ? `, ${count} total` : " until Ctrl+C"}`);

const report = setInterval(() => {
  console.log(
    `sent ${stats.sent} | accepted ${stats.accepted} | rejected ${stats.rejected} | errors ${stats.errors}` +
      (stats.errors && lastError ? ` (last: ${lastError})` : ""),
  );
}, 5000);

const timer = setInterval(() => {
  if (count && stats.sent >= count) {
    if (stats.active === 0) {
      clearInterval(timer);
      clearInterval(report);
      console.log("done", stats);
    }
    return;
  }
  if (stats.active < MAX_ACTIVE) void sendOne();
}, 1000 / rate);
