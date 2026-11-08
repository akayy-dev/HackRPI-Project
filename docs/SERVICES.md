# External Services & Data

Everything the admin dashboard (`web/`) depends on outside its own code: what it is, how to set it
up, and where it's used. All of it is free; none of it needs a paid account.

| Service / data | What for | Account needed | Status |
|---|---|---|---|
| [MongoDB](#mongodb) | Request logs written by the proxy | Only if you use Atlas | Wired (falls back to mock data) |
| [DB-IP IP to Country Lite](#db-ip-ip-to-country-lite-geo-ip) | IP → country for the map | No | Wired |
| [`maxmind` npm package](#maxmind-npm-package) | Reads the DB-IP `.mmdb` file | No | Wired |
| [mledoze/countries](#mledozecountries-country-centers) | Country center lat/lon | No (data committed) | Wired |
| [world-atlas + d3-geo + topojson-client](#world-atlas--d3-geo--topojson-client-map) | Drawing the world map | No | Wired |
| [Grok / Gemini](#grok--gemini-ai-assistant) | AI SOC analyst (triage, chat, alerts) | Yes (API key) | Grok wired · Gemini stub |

All settings live in `web/.env.local` (copy from [`web/.env.example`](../web/.env.example)).

---

## MongoDB

**What:** The bridge between the reverse proxy and the dashboard. The proxy writes one document per
request; the dashboard reads them. The dashboard never talks to the proxy directly.

**Setup**
1. Run MongoDB locally (`mongod`, Docker `mongo:7`) or create a free Atlas cluster.
2. In `web/.env.local`:
   ```bash
   MONGODB_URI=mongodb://localhost:27017      # or your Atlas connection string
   MONGODB_DB=proxy                            # database name
   MONGODB_COLLECTION=connections              # collection the proxy writes to
   ```
3. Recommended index: `db.connections.createIndex({ timestamp: -1 })`.

With `MONGODB_URI` empty the dashboard serves mock data. If a Mongo read fails, it logs the error
and also serves mock data.

**Document shape** (written by the proxy):
```js
{
  _id: ObjectId, timestamp: ISODate, risk: Double /* 0..1 */,
  method: "GET", url: "/", host: "localhost:8080",
  remote_addr: "127.0.0.1:54344", protocol: "HTTP/1.1",
  headers: { "User-Agent": ["..."], ... }   // name → [values]
}
```

**In the code**
| File | Role |
|---|---|
| [`web/src/lib/db/mongodb.ts`](../web/src/lib/db/mongodb.ts) | Cached `MongoClient` (one per process, survives hot reload) |
| [`web/src/lib/data/mongo.ts`](../web/src/lib/data/mongo.ts) | Reads last 24 h, newest 500, sorted by `timestamp` |
| [`web/src/lib/data/index.ts`](../web/src/lib/data/index.ts) | Picks Mongo vs mock, falls back to mock on error |
| [`web/src/lib/data/toEvent.ts`](../web/src/lib/data/toEvent.ts) | Turns a stored document into what the UI renders |
| [`web/src/lib/types.ts`](../web/src/lib/types.ts) | `RequestLog` (stored shape) and `ConnectionEvent` (UI shape) |
| [`web/src/app/api/dashboard/route.ts`](../web/src/app/api/dashboard/route.ts) | `GET /api/dashboard`; the browser polls it every 5 s |

**Fields the dashboard derives** (not stored by the proxy):
- `ip` ← parsed from `remote_addr` ([`requestLog.ts`](../web/src/lib/requestLog.ts) `clientIp`)
- `verdict` ← `risk >= 0.5` → blocked (`THREAT_SCORE` in [`aggregate.ts`](../web/src/lib/aggregate.ts)).
  This assumes the proxy uses the same threshold; storing the real decision would remove the guess.
- `location` ← geo-IP lookup (next section)

---

## DB-IP IP to Country Lite (geo-IP)

**What:** A free database that maps IP ranges to countries. It's a single `.mmdb` file (~8.5 MB)
that is read locally, so visitor IPs are never sent to a third party.
Site: <https://db-ip.com/db/download/ip-to-country-lite>

**License:** CC BY 4.0, free including commercial use, **attribution required**. The dashboard
shows an "IP Geolocation by DB-IP" link in the corner of the map
([`Dashboard.tsx`](../web/src/components/Dashboard.tsx)); keep it.

**Setup**
```bash
cd web
npm run geoip:download      # → web/data/dbip-country-lite.mmdb
```
- Downloads `https://download.db-ip.com/free/dbip-country-lite-YYYY-MM.mmdb.gz`. It tries this
  month's file, falls back to last month's, then gunzips the result
  ([`web/scripts/download-geoip.mjs`](../web/scripts/download-geoip.mjs)).
- The file is **gitignored**, so every machine/deploy runs the command once.
- DB-IP publishes a new file monthly; re-run the command to refresh.
- Optional: `GEOIP_DB_PATH=...` to store it elsewhere.
- If the file is missing, the app still runs: it logs a warning and public IPs show as "unlocated".

**Optional: running behind a CDN / load balancer**
```bash
TRUST_PROXY_HEADERS=true
```
When it's `true`, the client IP is taken from `CF-Connecting-IP` → `X-Real-IP` → `X-Forwarded-For`
(first entry) instead of `remote_addr`, and Cloudflare's `CF-IPCountry` header is used if present.
**Leave it `false` when the proxy is exposed directly.** Clients can forge these headers, though
that's handy for demos:
```bash
curl -H "X-Forwarded-For: 8.8.8.8" http://localhost:8080/
```

**In the code** — [`web/src/lib/geo.ts`](../web/src/lib/geo.ts) (server-only):
- `getGeoResolver(server)` opens the `.mmdb` once per process and returns a synchronous lookup
  function (about 1–10 µs per IP).
- Lookup order for each request:
  1. Loopback/private IP → "LAN" node next to our server
  2. `CF-IPCountry` header (only if `TRUST_PROXY_HEADERS=true`)
  3. DB-IP database → country
  4. Demo IPs used by the mock data (RFC 5737 ranges) → fixed countries
  5. Otherwise `null`: shown in the log, not drawn on the map
- Called from [`data/mock.ts`](../web/src/lib/data/mock.ts) and [`data/mongo.ts`](../web/src/lib/data/mongo.ts) via
  [`data/toEvent.ts`](../web/src/lib/data/toEvent.ts).

**Accuracy:** Country is right ~99% of the time. Local `127.0.0.1` traffic has no country by
definition, so it's drawn as "LAN".

---

## `maxmind` npm package

**What:** A pure-JS reader for `.mmdb` files (the format used by MaxMind and DB-IP). It has no
native build and no network access.

**Setup:** Already in `web/package.json` (`maxmind@5`). It's listed in `serverExternalPackages` in
[`web/next.config.ts`](../web/next.config.ts) so Next.js loads it from `node_modules` at runtime
instead of bundling it.

**In the code:** Used only in [`web/src/lib/geo.ts`](../web/src/lib/geo.ts)
(`maxmind.open<CountryResponse>(path)`, `reader.get(ip)?.country?.iso_code`). It never reaches the
browser bundle.

**Swapping to MaxMind GeoLite2:** Create a free MaxMind account, download `GeoLite2-Country.mmdb`,
and set `GEOIP_DB_PATH` to it. No code change is needed because the format is the same. GeoLite2's
license forbids committing the file and requires keeping it updated.

---

## mledoze/countries (country centers)

**What:** Open data on world countries, used only for each country's approximate center
(lat/lon) so the map knows where to put a country's dot. The DB-IP country file has country codes
but no coordinates.
Source: <https://github.com/mledoze/countries> (npm `world-countries@5.1.0`).

**License:** ODbL; credited in [`docs/WEB.md`](WEB.md).

**Setup:** None. The data was extracted once into
[`web/src/lib/countryCentroids.json`](../web/src/lib/countryCentroids.json) (250 countries, 8.7 KB):
`{ "US": ["United States", 38, -97], ... }`. The npm package is **not** a dependency. To regenerate,
`npm pack world-countries` and map each entry's `cca2` → `[name.common, latlng[0], latlng[1]]`.

**In the code:** `countryLocation(code)` in [`geo.ts`](../web/src/lib/geo.ts).

---

## world-atlas + d3-geo + topojson-client (map)

**What:** Country outlines (`world-atlas/countries-110m.json`, Natural Earth data, public domain)
projected to SVG with `d3-geo` (Natural Earth projection) and decoded with `topojson-client`. The
map is built in-house: no tile server, no API key.

**Setup:** None; these are regular npm dependencies.

**In the code:** [`web/src/components/ConnectionMap.tsx`](../web/src/components/ConnectionMap.tsx)
projects each country's center to x/y, draws one node per origin, draws arcs to our server, and
handles pan/zoom. Nodes are grouped by `location.code` in `toMapNodes`
([`aggregate.ts`](../web/src/lib/aggregate.ts)).

---

## Grok / Gemini (AI assistant)

**Status:** Grok is wired as "AI Sentinel", a Tier-1 SOC analyst. Gemini is still a stub.
Without a key, the dashboard uses a rule-based (heuristic) analyst, so the summary card always works.

**Setup**
```bash
AI_PROVIDER=grok
XAI_API_KEY=...            # xAI console
XAI_MODEL=grok-4           # optional
AI_TRIAGE_TTL_SEC=60       # optional: how long one triage result is reused
```

**In the code**
| File | Role |
|---|---|
| [`web/src/lib/ai/grok.ts`](../web/src/lib/ai/grok.ts) | xAI Chat Completions client (`fetch`, 30 s timeout) |
| [`web/src/lib/ai/socContext.ts`](../web/src/lib/ai/socContext.ts) | Traffic → stats + samples; all numbers come from here, never from the model |
| [`web/src/lib/ai/analyst.ts`](../web/src/lib/ai/analyst.ts) | Analyst prompt, triage JSON validator, severity floor, heuristic fallback |
| [`web/src/lib/ai/provider.ts`](../web/src/lib/ai/provider.ts) | Provider interface (`chat`, `triage`) |
| [`web/src/lib/ai/triageService.ts`](../web/src/lib/ai/triageService.ts) | Shared cache + refresh throttle + fallback |
| [`web/src/app/api/triage/route.ts`](../web/src/app/api/triage/route.ts) | `GET /api/triage` (`?refresh=1` to re-analyze) |
| [`web/src/app/api/chat/route.ts`](../web/src/app/api/chat/route.ts) | `POST /api/chat` |
| [`web/src/components/AiPanel.tsx`](../web/src/components/AiPanel.tsx) | Summary card, Re-analyze, quick prompts, chat |

**Cost:** about one Grok call per minute while a dashboard is open (shared by all tabs), plus one per chat message.

Note: the context sent to xAI includes client IPs, request URLs and user agents (no other headers, no bodies).

### Alerts (escalation watcher)

The Next.js server checks the last 5 minutes of traffic every `AI_WATCH_INTERVAL_SEC` (default 30; `0` disables).
The check itself uses no AI.
- **Fires** when severity rises (NORMAL → ELEVATED → CRITICAL): one Grok write-up (heuristic if Grok is down), one alert.
- **Stays quiet** while an attack continues at the same level, and for 10 min after an alert at a level (no flapping spam).
- **Re-arms** once traffic is back to NORMAL.
- **Ignores mock data**, so it only watches MongoDB or the local feed.

Each alert goes to:
- the server console (`[SOC ALERT] …`);
- MongoDB collection `alerts`, when `MONGODB_URI` is set (documents contain attacker IPs);
- `ALERT_WEBHOOK_URL`, if set: a Slack or Discord incoming webhook. The JSON has both `text` and `content`.

The watcher shares the triage cache, so an alert also refreshes the dashboard's summary card.
Code: [`watcher.ts`](../web/src/lib/ai/watcher.ts) (logic) · [`watchLoop.ts`](../web/src/lib/ai/watchLoop.ts) (timer, delivery) · [`instrumentation.ts`](../web/src/instrumentation.ts) (startup).

---

## Quick start (fresh machine)

```bash
cd web
npm install
cp .env.example .env.local     # fill MONGODB_URI if you have data; leave empty for mock
npm run geoip:download
npm run dev                    # http://localhost:3000
```
