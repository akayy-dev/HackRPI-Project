# HackRPI Project: ML-Powered Reverse Proxy + SOC Dashboard

A reverse proxy that scores every HTTP request with an ML classifier, **blocks the malicious ones (403)**, forwards the rest, and logs every decision to MongoDB. A Next.js dashboard reads those logs and adds an AI SOC analyst (Grok).

| Part | Path | What it does |
|---|---|---|
| Proxy | `main.go`, `proxy/` | Classifies, blocks or forwards, logs. Listens on `:8080` |
| Classifier | `classifier/` | Serializes the request, embeds it (EmbeddingGemma via Ollama), runs a 14-label sigmoid head (`weights.json`). Risk = `1 - normal` |
| Telemetry | `telemetry/` | MongoDB logging (secrets in headers redacted, bodies not stored) |
| Traffic Lab | `simulation/` | Synthetic traffic generator and control panel on `:8081` |
| Dashboard | `web/` | Next.js 15 SOC dashboard: map, connection log, Grok triage, chat, alerts |

## Quick start (Docker)

Requires Docker with Compose. The first run downloads the embedding model.

```bash
docker compose up --build -d
curl http://localhost:8080                    # allowed → Nginx welcome page
curl "http://localhost:8080/?id=1' OR 1=1--"  # should be blocked (403)
```

Open **http://localhost:8081** for the Traffic Lab. Stop with `docker compose down` (add `-v` to also delete the MongoDB and model volumes).

## Run locally (development)

**Prerequisites:** Go 1.26+, Node 20+, MongoDB, [Ollama](https://ollama.com).

**1. Models and database**

```bash
ollama pull embeddinggemma:300m
# make sure MongoDB is running on 127.0.0.1:27017
```

**2. Backend to protect.** Any HTTP server works. A tiny one is included:

```bash
node scripts/demo-backend.mjs 9000
```

**3. Proxy**

```bash
export REVERSE_PROXY_URL=http://127.0.0.1:9000
export MONGODB_URI=mongodb://127.0.0.1:27017
export OLLAMA_HOST=http://127.0.0.1:11434
go run .
```

On Windows, `scripts/run-proxy.ps1` does this for you and reads the Mongo settings from `web/.env.local`:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run-proxy.ps1
```

**4. Dashboard**

```bash
cd web
npm install
cp .env.example .env.local     # then edit, see below
npm run geoip:download         # country lookup database (free, no account)
npm run dev                    # http://localhost:3000
```

With `MONGODB_URI` empty the dashboard shows mock data, so it runs without the proxy. Point `MONGODB_URI` at the same MongoDB as the proxy to see real traffic. Both default to database `telemetry`, collection `requests`.

## Demo: Traffic Lab → Admin dashboard

The Traffic Lab and the dashboard never talk to each other. The Lab writes to MongoDB and the dashboard reads the same collection. Both must point at **the same MongoDB**.

1. **Start the dependencies.** Make sure MongoDB is running, then pull the model with `ollama pull embeddinggemma:300m` and keep Ollama running.
2. **Configure the dashboard.** In `web/.env.local`, set `MONGODB_URI` to your MongoDB. Leave `MONGODB_DB=telemetry` and `MONGODB_COLLECTION=requests` (the proxy's defaults).
3. **Start a backend:** `node scripts/demo-backend.mjs 9000`
4. **Start the proxy and Traffic Lab** (one process, ports 8080 and 8081). Use `scripts/run-proxy.ps1` on Windows, which reuses the Mongo settings from `web/.env.local`, or export the variables and run `go run .` as in step 3 of the local setup.
5. **Start the dashboard:** `cd web && npm run dev`
6. **Generate traffic.** Open http://localhost:8081, set a rate (for example 5/sec) and a malicious mix (for example 30%), pick attack categories, and press start.
7. **Watch it land.** Open http://localhost:3000. The dashboard polls every few seconds, so new requests show up in the connection log and on the map. Blocked ones are red. Set `AI_PROVIDER=grok` and `XAI_API_KEY` to get AI triage and alerts.

Signs that something is misconfigured:

- **"Mock data" or the same fixed IPs:** `MONGODB_URI` is empty or unreachable. Check the dashboard's server console.
- **The Lab counts errors:** Ollama is down or the model tag is wrong. It must be `embeddinggemma:300m`.
- **The Lab works but the dashboard stays empty:** the two sides point at a different database or collection. Also make sure the proxy was restarted after pulling, so it runs the current code.

Real traffic works the same way. Send requests to http://localhost:8080 with `curl` or a browser and they appear on the dashboard as non-simulated rows.

## Configuration

**Proxy** (environment variables; Go does not read `.env`)

| Variable | Default | Purpose |
|---|---|---|
| `REVERSE_PROXY_URL` | none (required) | Backend to forward allowed requests to |
| `MONGODB_URI` | none (required) | MongoDB connection string |
| `MONGODB_DATABASE` / `MONGODB_COLLECTION` | `telemetry` / `requests` | Where logs are written |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Ollama server (Compose publishes its own on `127.0.0.1:11435`) |
| `OLLAMA_MODEL` | `embeddinggemma:300m` | Must match the model the weights were trained with |
| `CLASSIFIER_WEIGHTS` | `./classifier/weights.json` | Trained sigmoid head |

The block threshold is `proxy.THRESHOLD` (0.5) in `proxy/handler.go`.

**Dashboard** (`web/.env.local`, see `web/.env.example`)

| Variable | Purpose |
|---|---|
| `MONGODB_URI`, `MONGODB_DB`, `MONGODB_COLLECTION` | Log source (empty URI = mock data; defaults `telemetry` / `requests`) |
| `AI_PROVIDER=grok`, `XAI_API_KEY`, `XAI_MODEL` | Enable the Grok SOC analyst (empty = rule-based fallback) |
| `AI_WATCH_INTERVAL_SEC` | Escalation watcher interval (`0` disables) |
| `ALERT_WEBHOOK_URL` | Optional Slack or Discord webhook for alerts |
| `GEOIP_DB_PATH`, `TRUST_PROXY_HEADERS` | Geo-IP database path; trust `X-Forwarded-For` only behind your own CDN |

Never commit `.env.local`. It is gitignored.

## Using it

- **Traffic Lab (`:8081`)**: set rate, malicious mix and attack categories, then watch decisions live. `POST /submit` accepts a single telemetry-shaped request:
  ```bash
  curl http://localhost:8081/submit -H 'Content-Type: application/json' \
    -d '{"method":"GET","url":"/products?id=1%27%20OR%201%3D1","remote_addr":"45.79.23.14:51000","intended_classification":"sql_injection"}'
  ```
  Simulations are saved with `simulated: true` and never reach the backend. `timestamp` is when the Lab received the request, so it shows up live on the dashboard. The submitted (often 2020, training-era) date is kept in `request_timestamp`.
- **Dashboard (`:3000`)**: live world map, filterable connection log, AI triage summary, chat, and SOC alerts when severity rises.
- **Inspect logs**: `mongosh mongodb://127.0.0.1:27017/telemetry --eval 'db.requests.find().sort({_id:-1}).limit(5)'`

## Tests

```bash
go test ./...                                   # Go: classifier, proxy, simulation, telemetry
node --test simulation/web/generator.test.mjs   # traffic generator templates
cd web && npm test && npm run lint              # dashboard
MONGODB_TEST_URI=mongodb://127.0.0.1:27017 go test ./telemetry -run TestMongoRequestPersistence -v   # optional, needs MongoDB
```

## Docs

[Design](docs/DESIGN.md) · [Dashboard](docs/WEB.md) · [External services](docs/SERVICES.md) · [Testing](docs/TESTING.md) · [Classifier training fixtures](classifier/embeddings/testdata/training_examples/README.md)

## Known limitations

- The proxy serves plain HTTP; terminate TLS in front of it.
- The classifier is trained on a 2020 private-network dataset. Scores for public IPs and unseen attacks are approximate.
- Gemini support is a stub. Only Grok is wired.
- Slack/Discord webhooks and Grok requests include client IPs, URLs and user agents.
