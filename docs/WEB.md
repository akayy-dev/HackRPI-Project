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

- Set `MONGODB_URI` → reads `MONGODB_COLLECTION` (default `connections`; last 24h, newest 500).
  Mongo errors fall back to mock (logged).
- No `MONGODB_URI` but `data/live-feed.ndjson` exists → local JSON feed (written by `npm run test:live`).
- Otherwise → mock data (timestamps relative to now, so filters work).

### MongoDB schema — one document per proxied request (written by the proxy)

```js
{
  _id: ObjectId,
  timestamp: ISODate,            // indexed: { timestamp: -1 }
  risk: 0.199,                   // Double 0..1 from the ML classifier
  method: "GET",
  url: "/login?next=/",          // request URI incl. query
  host: "localhost:8080",
  remote_addr: "127.0.0.1:54344",// "ip:port" ("[::1]:port" for IPv6)
  protocol: "HTTP/1.1",
  headers: { "User-Agent": ["Mozilla/5.0 ..."], Accept: ["text/html"], ... } // name → [values]
}
```

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

Not configured. To plug in:
1. `AI_PROVIDER=grok` + `XAI_API_KEY` (or `gemini` + `GEMINI_API_KEY`)
2. Implement `chat()` in `src/lib/ai/provider.ts`
   - Grok: OpenAI-compatible `POST https://api.x.ai/v1/chat/completions`
   - Gemini: `@google/genai` SDK

`/api/chat` already passes recent traffic as `context`.

## Map

Built in-house: `d3-geo` (projection) + `world-atlas` (country shapes) + plain SVG.
- Lat/lon → x/y via Natural Earth projection
- One node per origin location; arcs animate toward our server
- Pan (drag), zoom (+/−/reset), click node → inspector

Upgrade options if needed:
- **deck.gl + MapLibre** — WebGL, 10k+ arcs, real tile basemap
- **react-globe.gl** — 3D globe with arcs (flashy demo)
- **react-simple-maps** — similar to ours, less control
