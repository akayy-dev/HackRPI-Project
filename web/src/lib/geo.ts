import "server-only";
import path from "node:path";
import { existsSync } from "node:fs";
import maxmind, { type CountryResponse, type Reader } from "maxmind";
import type { GeoLocation, RequestLog } from "./types";
import { getHeader } from "./requestLog";
import CENTROIDS from "./countryCentroids.json";

/**
 * Country-level IP geolocation, resolved by the dashboard at read time.
 *
 * Order: private/loopback → "LAN" · trusted CF-IPCountry header → DB-IP
 * country database → demo IPs (mock data) → null (log only, not on map).
 *
 * Database: DB-IP "IP to Country Lite" (CC BY 4.0) — `npm run geoip:download`.
 * Country centers: mledoze/countries (ODbL), see countryCentroids.json.
 */

type Centroid = [name: string, lat: number, lon: number];
const COUNTRY = CENTROIDS as unknown as Record<string, Centroid>;

const DB_PATH = path.resolve(process.cwd(), process.env.GEOIP_DB_PATH ?? "data/dbip-country-lite.mmdb");

/** Only trust X-Forwarded-For & co. when the proxy sits behind a load balancer/CDN you control. */
export const TRUST_PROXY_HEADERS = process.env.TRUST_PROXY_HEADERS === "true";

/** RFC 5737 documentation IPs used by the mock data → country code. */
const DEMO_IPS: Record<string, string> = {
  "203.0.113.12": "US",
  "198.51.100.7": "RU",
  "203.0.113.45": "GB",
  "192.0.2.88": "BR",
  "203.0.113.3": "JP",
  "198.51.100.23": "AU",
  "203.0.113.77": "US",
  "198.51.100.9": "RU",
  "203.0.113.150": "SG",
  "192.0.2.14": "ZA",
  "203.0.113.201": "IN",
  "203.0.113.90": "GB",
  "192.0.2.201": "IN",
  "203.0.113.31": "DE",
  "198.51.100.66": "BR",
  "203.0.113.8": "JP",
  "192.0.2.50": "US",
};

export function countryLocation(code: string | null | undefined): GeoLocation | null {
  const iso = code?.toUpperCase();
  const c = iso ? COUNTRY[iso] : undefined;
  return c && iso ? { code: iso, name: c[0], country: iso, lat: c[1], lon: c[2] } : null;
}

export function isPrivateIp(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === "::1" || v === "localhost" || v.startsWith("fe80:") || v.startsWith("fc") || v.startsWith("fd")) return true;
  const ipv4 = v.startsWith("::ffff:") ? v.slice(7) : v;
  const p = ipv4.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n))) return false;
  return (
    p[0] === 127 ||
    p[0] === 10 ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 169 && p[1] === 254)
  );
}

// One reader per server process (survives Next.js hot reloads).
const g = globalThis as unknown as { _geoReader?: Promise<Reader<CountryResponse> | null> };

function loadReader(): Promise<Reader<CountryResponse> | null> {
  if (!g._geoReader) {
    g._geoReader = existsSync(DB_PATH)
      ? maxmind.open<CountryResponse>(DB_PATH).catch((err) => {
          console.warn(`[geo] could not open ${DB_PATH}:`, err);
          return null;
        })
      : (console.warn(`[geo] ${DB_PATH} not found — run \`npm run geoip:download\`. Public IPs will be unlocated.`),
        Promise.resolve(null));
  }
  return g._geoReader;
}

export type GeoResolver = (ip: string, log: Pick<RequestLog, "headers">) => GeoLocation | null;

/** Resolves once (loads the database), then each lookup is synchronous and ~µs. */
export async function getGeoResolver(server: GeoLocation): Promise<GeoResolver> {
  const reader = await loadReader();
  return (ip, log) => {
    if (isPrivateIp(ip)) {
      // Offset a little so the node doesn't sit under the server marker.
      return { code: "LAN", name: "Local network", country: server.country, lat: server.lat - 4, lon: server.lon - 6 };
    }
    if (TRUST_PROXY_HEADERS) {
      const cf = countryLocation(getHeader(log, "CF-IPCountry"));
      if (cf) return cf;
    }
    if (reader && maxmind.validate(ip)) {
      const hit = countryLocation(reader.get(ip)?.country?.iso_code);
      if (hit) return hit;
    }
    return countryLocation(DEMO_IPS[ip]);
  };
}
