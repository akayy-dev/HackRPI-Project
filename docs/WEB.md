# SOC Dashboard (web)

Next.js 15 (App Router) + Tailwind v4 UI for the reverse-proxy security handler, in [`web/`](../web).
Design spec: [`DESIGN.md`](DESIGN.md).
External services, setup & where they are used: [`SERVICES.md`](SERVICES.md).
Testing: [`TESTING.md`](TESTING.md).

## Run

```bash
cd web
npm install
cp .env.example .env.local   # optional
npm run geoip:download       # country geo-IP database (see SERVICES.md)
npm run dev                  # http://localhost:3000
```

## Layout

Paths relative to `web/`.

| Path | What |
|---|---|
| `src/app/page.tsx` | Server component → loads initial data |
| `src/app/api/dashboard` | `GET` — dashboard JSON (client polls every 2s) |
| `src/app/api/chat` | `POST` — AI chat (stub until a provider is set) |
| `src/components/ConnectionMap.tsx` | In-house world map (d3-geo + world-atlas) |
| `src/lib/data/` | `mock.ts` (hard-coded) · `mongo.ts` (MongoDB) · `feed.ts` (local JSON feed) · `index.ts` (picks one) |
| `src/lib/ai/provider.ts` | Grok / Gemini plug-in point |
| `src/lib/types.ts` | Shared data contracts |
| `scripts/live-test/` | Live dashboard test (see [`TESTING.md`](TESTING.md)) |

## Data: mock → MongoDB

- Set `MONGODB_URI` → reads `MONGODB_COLLECTION` in `MONGODB_DB` (defaults `requests` / `telemetry`, same as the proxy; last 24h, newest 500).
  Mongo errors fall back to mock (logged).
- No `MONGODB_URI` but `data/live-feed.ndjson` exists → local JSON feed (written by `npm run test:live`).
- Otherwise → mock data (timestamps relative to now, so filters work).

### MongoDB schema — one document per proxied request (written by the proxy)

Mirrors `telemetry.RequestTelemetry` in the Go proxy (networking branch). The proxy writes
to database `telemetry`, collection `requests` by default (`MONGODB_DATABASE` /
`MONGODB_COLLECTION` there; `MONGODB_DB` / `MONGODB_COLLECTION` here).

```js
{
  _id: ObjectId,
  timestamp: ISODate,            // indexed: { timestamp: -1 }. Arrival time (simulations too)
  request_timestamp: ISODate,    // simulations only: the timestamp the Traffic Lab submitted
  risk: 0.0812,                  // Double 0..1 = 1 - attack_probabilities.normal. ABSENT if classification failed
  attack_probabilities: {        // 14 independent sigmoid scores (do not sum to 1). ABSENT if classification failed
    normal: 0.9188, protocol_manipulation: 0.004, code_injection: 0.011, os_command_injection: 0.002,
    path_traversal: 0.003, sql_injection: 0.021, dictionary_password_attack: 0.001,
    vulnerability_scanning: 0.006, input_data_manipulation: 0.009, command_injection: 0.002,
    http_verb_tampering: 0.001, source_spoofing: 0.001, http_response_splitting: 0.001,
    http_request_smuggling: 0.002
  },
  classification_error: "embed request: ...", // only when classification failed (proxy answered 503)
  simulated: false,              // always written; true for Traffic Lab (:8081) submissions
  threshold: 0.5,                // simulations only
  blocked: false,                // simulations only: risk >= threshold
  intended_classification: "sql_injection", // simulations only: the generator's label, not a model input
  generation_mode: "generated",  // simulations only: "generated" | "examples"
  method: "GET",
  url: "/login?next=/",          // request URI incl. query
  host: "localhost:8080",
  remote_addr: "127.0.0.1:54344",// "ip:port" ("[::1]:port" for IPv6)
  destination_addr: "172.18.0.5:8080", // listener that accepted it, when known
  protocol: "HTTP/1.1",
  headers: { Host: ["localhost:8080"], "User-Agent": ["Mozilla/5.0 ..."], Cookie: ["[REDACTED]"], ... }
  // name → [values]; Authorization, Proxy-Authorization, Cookie, X-Api-Key are redacted. Body is never stored.
}
```

Real traffic stores no decision: the proxy blocks (403) when `risk >= proxy.THRESHOLD` (0.5).
Traffic Lab documents use the arrival time as `timestamp`, so they appear in the dashboard's 24 h
window. The date the generator submitted (2020 by default) is kept in `request_timestamp`.

The dashboard derives the rest (`src/lib/requestLog.ts`):
- `ip` ← parsed from `remote_addr`
- `verdict` ← `risk >= 0.5` → `blocked`, else `allowed` (`THREAT_SCORE` in `src/lib/aggregate.ts`)
- `location` ← country-level lookup in `src/lib/geo.ts` (see below)

### Geo-IP (country level)

```bash
npm run geoip:download   # → data/dbip-country-lite.mmdb (~8.5 MB, gitignored); re-run monthly
```

Lookup order for each request's client IP:
1. Loopback / private IP → "LAN" node beside our server
2. `CF-IPCountry` header (only when `TRUST_PROXY_HEADERS=true`)
3. DB-IP country database → dot at the country's center
4. Mock-data demo IPs → fixed countries
5. Otherwise unknown: listed in the log, not drawn on the map

`TRUST_PROXY_HEADERS=true` also takes the client IP from `CF-Connecting-IP` / `X-Real-IP` /
`X-Forwarded-For` instead of `remote_addr`. Enable it **only** when the proxy sits behind a CDN or load
balancer you control. Clients can spoof those headers, though that's handy for demos:
`curl -H "X-Forwarded-For: 8.8.8.8" http://localhost:8080/`.

Data credits: [DB-IP](https://db-ip.com) IP to Country Lite (CC BY 4.0, attribution shown on the map) ·
country centers from [mledoze/countries](https://github.com/mledoze/countries) (ODbL) in `src/lib/countryCentroids.json`.

## AI assistant

"AI Sentinel" is a Tier-1 SOC analyst on Grok (`AI_PROVIDER=grok` + `XAI_API_KEY`; see
[`SERVICES.md`](SERVICES.md)). It has two jobs:

- **Triage** (`GET /api/triage`, polled every 60 s by the panel, cached server-side) fills the summary card
  and suggested actions. Grok writes only the narrative, the anomaly and the actions. Counts and
  traffic/min are computed in `socContext.ts`.
- **Chat** (`POST /api/chat`) answers analyst questions over the same traffic context.

Guards:
- Traffic is sent fenced in `<traffic_data>` and marked untrusted. Fields are truncated and control characters stripped.
- **Severity floor:** Grok may raise `trafficStatus` but never lower it below what the last 5 minutes justify.
  - CRITICAL: ≥ 50 blocked, or ≥ 20 from one IP.
  - ELEVATED: ≥ 5 blocked, or ≥ 5 classifier errors.
- Suggested actions that name an IP or path not present in the traffic are dropped.
- Client chat history is limited to user/assistant turns (last 10, 2000 chars each).
- If Grok is missing, slow or returns an invalid reply, the panel shows the heuristic analyst (badge "Heuristic").

Action buttons are advisory: no blocklist is enforced yet.

## Map

Built in-house: `d3-geo` (projection) + `world-atlas` (country shapes) + plain SVG.
- Lat/lon → x/y via Natural Earth projection
- One node per origin location; arcs animate toward our server
- Pan (drag), zoom (+/−/reset), click node → inspector

Upgrade options if needed:
- **deck.gl + MapLibre** — WebGL, 10k+ arcs, real tile basemap
- **react-globe.gl** — 3D globe with arcs (flashy demo)
- **react-simple-maps** — similar to ours, less control
