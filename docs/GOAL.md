# Project Goal

## Summary
A **reverse proxy** that sits in front of a website at the HTTPS layer. Every incoming request is checked by an **ML classifier** that labels it **safe** or **malicious**:
- **Safe** → forwarded to the website
- **Malicious** → blocked (`403 Forbidden`)

Every decision is logged to **MongoDB**. An **Admin Dashboard** reads those logs so admins can monitor, investigate, and act on the traffic.

## Data Flow

```
User → Reverse Proxy → ML Classifier → MongoDB → Admin UI → (enact action)
                ↑                                                  │
                └────────────── blocklist (MongoDB) ←──────────────┘
```

1. **User → Reverse Proxy:** HTTPS request (IP, method, path, headers, body)
2. **Reverse Proxy → ML Classifier:** extracted request fields → verdict, e.g. `{ "label": "malicious", "score": 0.93 }`
3. **→ MongoDB:** one log document per request (safe requests are forwarded, malicious ones get `403`):
   ```json
   {
     "timestamp": "2026-11-07T10:00:00Z",
     "ip": "1.2.3.4",
     "location": "City, Country",
     "method": "POST",
     "path": "/login",
     "label": "malicious",
     "score": 0.93,
     "action": "blocked"
   }
   ```
4. **MongoDB → Admin UI:** the dashboard's backend API reads request logs and stats and serves JSON to the page, which polls for updates
5. **Admin UI → (enact action):** admin blocks/allows an IP → written to a `blocklist` collection that the proxy checks on each request

> The dashboard never talks to the proxy directly — **MongoDB is the bridge**.

## Admin UI
A web dashboard to **monitor, investigate, and control** traffic going through the proxy.

- **Header:** app title, proxy & ML classifier status, admin menu
- **Stats row:** total requests, allowed, blocked, requests/min
- **Live connection map:** world map; each connection is a dot at its location, plus a marker for our server
  - Green = allowed, red = blocked
  - Hover a dot → IP, location, request count, last verdict
  - Time range + filter controls
- **AI summary & helper:**
  - Auto-updated summary of current traffic and threats
  - Suggested actions (e.g. block an IP)
  - Chat box to ask questions about the traffic
- **Connection log:** table of requests (time, IP, location, method, path, ML score, status)
  - Filter: All / Allowed / Blocked
  - Search by IP or path

**Design:** [Figma — Admin Dashboard](https://www.figma.com/design/vpLQ1peFEDTK3N6VkJKGu1) · [DESIGN.md](DESIGN.md)

## Current Status (stubs)
For now, parts of the pipeline are placeholders so the UI can be built and demoed on its own:

| Piece | Status |
|---|---|
| Global map | **Stub** — renders hardcoded locations; not yet driven by real geo-IP data |
| AI summary / chat (LLM) | **Stub** — fixed summary text and canned replies; no LLM provider connected |
| Connections / IPs | **Hardcoded test data** — mock requests from fixed test IPs, not read from MongoDB yet |
| Enact action (blocklist) | Not wired — suggested-action buttons do nothing yet |

Next: replace the mock data with MongoDB reads, then wire the blocklist write-back, then the real map data and LLM.
