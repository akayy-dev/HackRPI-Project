// Minimal HTTP backend for the reverse proxy to forward allowed requests to.
// Usage: node scripts/demo-backend.mjs [port]   (default 9000)
import http from "node:http";

const port = Number(process.argv[2] ?? process.env.PORT ?? 9000);

http
  .createServer((req, res) => {
    const body = JSON.stringify({ ok: true, backend: "demo", method: req.method, url: req.url });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(body + "\n");
    console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  })
  .listen(port, "127.0.0.1", () => console.log(`demo backend on http://127.0.0.1:${port}`));
