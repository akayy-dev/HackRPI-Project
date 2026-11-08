# Testing

## Live dashboard test (no MongoDB needed)

Checks that the admin panel picks up new requests in real time.

```bash
cd web
npm run dev          # terminal 1, MONGODB_URI unset
npm run test:live    # terminal 2 — then watch http://localhost:3000
```

What it does:
1. Reads `web/scripts/live-test/mock-requests.json`: a JSON array of request docs in the
   [MongoDB schema](WEB.md#mongodb-schema--one-document-per-proxied-request-written-by-the-proxy).
2. Appends them one at a time to `web/data/live-feed.ndjson` with random delays (plus occasional
   bursts), each stamped with the current time and an ObjectId-shaped `_id`.
3. Polls `/api/dashboard` (what the panel polls) and checks every request shows up.
   Prints latency (p50 / p95 / max) and PASS / FAIL; exit code 1 on failure.

Options (see the header of `web/scripts/live-test/run.mjs`):

| Flag | Default | |
|---|---|---|
| `--count <n>` | all | replay only the first n |
| `--min` / `--max <ms>` | 300 / 2500 | delay range between requests |
| `--url <url>` | `http://localhost:3000` | dashboard base URL |
| `--timeout <ms>` | 10000 | max time for a request to appear |
| `--loop` | off | keep replaying until Ctrl+C |
| `--no-verify` | off | only write the feed, don't check the dashboard |
| `--append` | off | keep the existing feed instead of starting empty |

While `data/live-feed.ndjson` exists (and `MONGODB_URI` is unset) the dashboard reads it instead of
the built-in mock data. Delete it to go back.

### Regenerating the input

```bash
npm run test:live:generate -- --count 200 --seed 7
```

`web/scripts/live-test/generate.mjs` builds a seeded mix of normal browsing and attacks (SQLi, path
traversal, scanners, uploads, XSS) from random public IPs that resolve in the geo-IP database, so every
request lands on the map. Needs `npm run geoip:download` first.

### Gotcha

Run only one `next dev` per folder. Several dev servers share `web/.next` and overwrite each other's
build manifests (random 500s, `Unexpected end of JSON input`).
