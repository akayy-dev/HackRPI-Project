// Downloads the free DB-IP "IP to Country Lite" database (CC BY 4.0, no signup)
// to data/dbip-country-lite.mmdb. DB-IP publishes a new file monthly; re-run to refresh.
// Usage: npm run geoip:download
import { mkdir, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import path from "node:path";

const OUT = path.resolve(process.env.GEOIP_DB_PATH ?? "data/dbip-country-lite.mmdb");

function month(offset) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - offset);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// This month's file may not be out yet on the 1st, so fall back to last month.
for (const m of [month(0), month(1)]) {
  const url = `https://download.db-ip.com/free/dbip-country-lite-${m}.mmdb.gz`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`${url} → HTTP ${res.status}`);
    continue;
  }
  const mmdb = gunzipSync(Buffer.from(await res.arrayBuffer()));
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, mmdb);
  console.log(`Saved ${(mmdb.length / 1e6).toFixed(1)} MB (${m}) → ${OUT}`);
  process.exit(0);
}
console.error("Could not download the DB-IP country database.");
process.exit(1);
