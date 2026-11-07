# HackRPI-Project

Start the Go reverse proxy and a simple Nginx HTTP backend:

```sh
docker compose up --build -d
curl http://localhost:8080
```

Open http://localhost:8080 to see the Nginx welcome page through the proxy.
Only the proxy publishes a host port; the backend is reachable by the proxy at
`http://target-web-app:80` on the Compose network. Compose waits for the backend
health check before starting the proxy.

The proxy currently forwards every request. A classifier can be added as a
handler before the reverse proxy to reject requests before they reach Nginx.
`REVERSE_PROXY_URL` configures the backend URL; the proxy listens on port 8080.

View logs with `docker compose logs -f`. Stop the services with
`docker compose down`.
