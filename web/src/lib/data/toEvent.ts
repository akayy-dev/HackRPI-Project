import "server-only";
import type { ConnectionEvent, RequestLog } from "@/lib/types";
import { isThreatScore } from "@/lib/aggregate";
import { clientIp } from "@/lib/requestLog";
import { TRUST_PROXY_HEADERS, type GeoResolver } from "@/lib/geo";

/** Turn a stored RequestLog into what the UI renders. */
export function toConnectionEvent(log: RequestLog, id: string, geo: GeoResolver): ConnectionEvent {
  const headers = log.headers ?? {};
  const ip = clientIp({ remote_addr: log.remote_addr, headers }, TRUST_PROXY_HEADERS);
  // `risk` is absent when the proxy's classification failed (classification_error is set).
  const risk = typeof log.risk === "number" && Number.isFinite(log.risk) ? log.risk : 0;
  return {
    ...log,
    risk,
    headers,
    id,
    ip,
    verdict: isThreatScore(risk) ? "blocked" : "allowed",
    location: geo(ip, { headers }),
  };
}
