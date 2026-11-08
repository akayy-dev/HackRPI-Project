import type { RequestLog } from "./types";

/** "127.0.0.1:54344" → "127.0.0.1", "[::1]:54344" → "::1", bare IPs pass through. */
export function parseRemoteAddr(remoteAddr: string): string {
  const addr = remoteAddr.trim();
  const v6 = addr.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (v6) return v6[1];
  const colons = addr.split(":").length - 1;
  if (colons === 1) return addr.slice(0, addr.lastIndexOf(":")); // ipv4:port
  return addr; // bare IPv4 or bare IPv6
}

/** Case-insensitive header lookup; returns the first value. */
export function getHeader(log: Pick<RequestLog, "headers">, name: string): string | null {
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(log.headers ?? {})) {
    if (k.toLowerCase() === want) return v?.[0] ?? null;
  }
  return null;
}

/** Path part of `url` (drops the query string) — useful for grouping. */
export const urlPath = (url: string) => url.split("?")[0] || "/";

/**
 * The real client IP. Behind a CDN / load balancer `remote_addr` is the middlebox,
 * so when `trustProxyHeaders` is on we prefer the forwarding headers.
 * Never enable that when the proxy is exposed directly: clients can spoof them.
 */
export function clientIp(log: Pick<RequestLog, "remote_addr" | "headers">, trustProxyHeaders: boolean): string {
  if (trustProxyHeaders) {
    const fwd =
      getHeader(log, "CF-Connecting-IP") ??
      getHeader(log, "X-Real-IP") ??
      getHeader(log, "X-Forwarded-For")?.split(",")[0];
    if (fwd?.trim()) return parseRemoteAddr(fwd.trim());
  }
  return parseRemoteAddr(log.remote_addr ?? "");
}
