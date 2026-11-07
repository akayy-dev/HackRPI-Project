# SOC Dashboard (web)

Next.js 15 (App Router) + Tailwind v4 UI for the reverse-proxy security handler.
Design spec: [`../docs/DESIGN.md`](../docs/DESIGN.md).

## Run

```bash
cd web
npm install
cp .env.example .env.local   # optional
npm run dev                  # http://localhost:3000
```

## Layout

| Path | What |
|---|---|
| `src/app/page.tsx` | Server component → loads initial data |
| `src/app/api/dashboard` | `GET` — dashboard JSON (client polls every 5s) |
| `src/app/api/chat` | `POST` — AI chat (stub until a provider is set) |
| `src/components/ConnectionMap.tsx` | In-house world map (d3-geo + world-atlas) |
| `src/lib/data/` | `mock.ts` (hard-coded) · `mongo.ts` (MongoDB) · `index.ts` (picks one) |
| `src/lib/ai/provider.ts` | Grok / Gemini plug-in point |
| `src/lib/types.ts` | Shared data contracts |

## Data: mock → MongoDB

- No `MONGODB_URI` → mock data (timestamps relative to now, so filters work).
- Set `MONGODB_URI` → reads `connections` collection (last 24h, newest 500).
- Mongo errors fall back to mock (logged).

### MongoDB schema — `connections`

```js
{
  timestamp: ISODate,          // indexed: { timestamp: -1 }
  ip: "198.51.100.7",
  method: "POST",
  path: "/login",
  verdict: "allowed" | "blocked",
  mlScore: 0.97,               // 0..1 from the ML classifier
  threat: "SQLi" | null,
  location: { code: "RU-MOW", city: "Moscow", country: "RU", lat: 55.76, lon: 37.62 }
}
```

Tip: resolve IP → `location` at ingest time (e.g. MaxMind GeoLite2) so the UI stays dumb.

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
