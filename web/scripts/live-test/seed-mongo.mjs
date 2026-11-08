#!/usr/bin/env node
/**
 * Loads the mock request logs (scripts/live-test/mock-requests.json, networking-proxy shape)
 * into MongoDB so the dashboard has data without running the proxy.
 *
 *   npm run db:seed                 # insert into MONGODB_DB.MONGODB_COLLECTION from .env.local
 *   npm run db:seed -- --dry-run    # no network: validate the fixture and show what would be sent
 *   npm run db:seed -- --force      # insert even if the collection already has documents
 *
 * Timestamps are shifted so the newest document is "now" (spacing kept), so everything falls in
 * the dashboard's 24 h window. They are stored as BSON dates, like the Go proxy writes them.
 * Uses zlib wire compression and one insertMany round trip to keep cloud traffic small.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { MongoClient } from "mongodb";

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry-run");
const FORCE = argv.includes("--force");
const FIXTURE = path.resolve("scripts/live-test/mock-requests.json");

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB ?? "telemetry";
const colName = process.env.MONGODB_COLLECTION ?? "requests";
const masked = (uri ?? "").replace(/\/\/([^:/]+):[^@]*@/, "//$1:***@");

const docs = JSON.parse(await readFile(FIXTURE, "utf8"));
const newest = Math.max(...docs.map((d) => Date.parse(d.timestamp)));
const shift = Date.now() - newest;
const rows = docs.map((d) => ({ ...d, timestamp: new Date(Date.parse(d.timestamp) + shift) }));
const kb = (Buffer.byteLength(JSON.stringify(docs)) / 1024).toFixed(0);

console.log(`Fixture: ${rows.length} docs (~${kb} KB as JSON, less on the wire with zlib)`);
console.log(`Target:  ${masked || "(MONGODB_URI not set)"} → ${dbName}.${colName}`);
if (DRY) {
  console.log(`Range:   ${rows[0].timestamp.toISOString()} … ${rows.at(-1).timestamp.toISOString()}`);
  console.log("DRY RUN: nothing sent.");
  process.exit(uri ? 0 : 1);
}
if (!uri) {
  console.error("MONGODB_URI is not set (check .env.local).");
  process.exit(1);
}

// Atlas uses port 27017, which the RPI campus network blocks: fail early with a clear message.
if (uri.startsWith("mongodb+srv://")) {
  try {
    const org = (await (await fetch("https://ipinfo.io/org", { signal: AbortSignal.timeout(10_000) })).text()).trim();
    if (/Rensselaer/i.test(org)) {
      console.error(`You're on ${org}: it blocks MongoDB's port. Switch to the hotspot and re-run.`);
      process.exit(1);
    }
    console.log(`Network: ${org}`);
  } catch {
    console.log("Network: couldn't check; trying anyway");
  }
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8_000, compressors: ["zlib"] });
try {
  await client.connect();
  const col = client.db(dbName).collection(colName);
  const before = await col.estimatedDocumentCount();
  if (before > 0 && !FORCE) {
    console.log(`${dbName}.${colName} already has ${before} documents; not inserting duplicates (use --force).`);
  } else {
    const { insertedCount } = await col.insertMany(rows, { ordered: true });
    console.log(`Inserted ${insertedCount} (collection: ${before} → ${before + insertedCount})`);
  }
  await col.createIndex({ timestamp: -1 }); // the dashboard sorts/filters on it; no-op if present
  console.log("RESULT: OK");
} catch (err) {
  console.error(`RESULT: FAILED ${err.name}: ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.close();
}
