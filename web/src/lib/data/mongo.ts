import "server-only";
import type { ObjectId } from "mongodb";
import type { DashboardData, RequestLog } from "@/lib/types";
import { getDb } from "@/lib/db/mongodb";
import { getGeoResolver } from "@/lib/geo";
import { toConnectionEvent } from "./toEvent";
import { getMockDashboard, MOCK_SERVER } from "./mock";
import { heuristicSummary } from "@/lib/ai/analyst";

/**
 * MongoDB-backed dashboard data.
 * One document per proxied request, written by the proxy (see docs/WEB.md → "MongoDB schema").
 * Server info falls back to mock; the AI summary card is computed from these connections.
 *
 * Bandwidth: the dashboard polls every ~2 s, so re-reading the whole 24 h window each time
 * would pull hundreds of KB per poll from a cloud cluster. Instead the window is read once,
 * then each poll fetches only documents inserted since (`_id` greater than the newest seen;
 * ObjectIds grow with insert time, so late-arriving or back-dated documents are still caught).
 * A full re-read every FULL_REFRESH_MS picks up deletions or a reloaded collection.
 */

interface RequestLogDoc extends Omit<RequestLog, "timestamp"> {
  _id: ObjectId;
  timestamp: Date;
}

const COLLECTION = process.env.MONGODB_COLLECTION ?? "connections";
const LOOKBACK_MS = 24 * 60 * 60_000;
const LIMIT = 500;
const FULL_REFRESH_MS = 10 * 60_000;

interface Cache {
  key: string; // db/collection the cache was built from
  docs: RequestLogDoc[]; // newest timestamp first
  newestId: ObjectId | null;
  fullAt: number;
}
const globalForCache = globalThis as unknown as {
  _requestLogCache?: Cache;
  _requestLogInflight?: Promise<Loaded>;
};

interface Loaded {
  docs: RequestLogDoc[];
  /** Round trip of one query this poll (dashboard server → database), ms */
  latencyMs: number;
}

/** Times one database round trip. */
async function timed<T>(query: () => Promise<T>): Promise<[T, number]> {
  const t0 = performance.now();
  const result = await query();
  return [result, performance.now() - t0];
}

async function loadDocs(): Promise<Loaded> {
  const db = await getDb();
  const col = db.collection<RequestLogDoc>(COLLECTION);
  const key = `${db.databaseName}/${COLLECTION}`;
  const now = Date.now();
  const since = new Date(now - LOOKBACK_MS);
  let cache = globalForCache._requestLogCache;
  let latencyMs: number;

  if (!cache || cache.key !== key || now - cache.fullAt > FULL_REFRESH_MS) {
    // Newest _id first, so a document inserted between the two queries is fetched next poll.
    // Its tiny result makes it the latency sample; the second query's time includes the payload.
    const [newest, ms] = await timed(() =>
      col.find({}, { projection: { _id: 1 } }).sort({ _id: -1 }).limit(1).next(),
    );
    latencyMs = ms;
    const docs = await col.find({ timestamp: { $gte: since } }).sort({ timestamp: -1 }).limit(LIMIT).toArray();
    cache = { key, docs, newestId: newest?._id ?? null, fullAt: now };
  } else {
    const [fresh, ms] = await timed(() =>
      col
        .find(cache!.newestId ? { _id: { $gt: cache!.newestId } } : {})
        .sort({ _id: 1 })
        .limit(LIMIT)
        .toArray(),
    );
    latencyMs = ms;
    if (fresh.length) {
      const seen = new Set(cache.docs.map((d) => d._id.toHexString()));
      cache.docs = [...fresh.filter((d) => !seen.has(d._id.toHexString())), ...cache.docs];
      cache.newestId = fresh[fresh.length - 1]._id;
    }
  }

  cache.docs = cache.docs
    .filter((d) => new Date(d.timestamp).getTime() >= since.getTime())
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, LIMIT);
  globalForCache._requestLogCache = cache;
  return { docs: cache.docs, latencyMs };
}

/** Concurrent polls (several tabs) share one round trip to the database. */
function getDocs(): Promise<Loaded> {
  globalForCache._requestLogInflight ??= loadDocs().finally(() => {
    globalForCache._requestLogInflight = undefined;
  });
  return globalForCache._requestLogInflight;
}

export async function getMongoDashboard(): Promise<DashboardData> {
  const { docs, latencyMs } = await getDocs();

  const server = MOCK_SERVER; // TODO: read from a `servers` collection
  const geo = await getGeoResolver(server.location);
  const connections = docs.map(({ _id, timestamp, ...rest }) =>
    toConnectionEvent(
      { ...rest, timestamp: new Date(timestamp).toISOString(), risk: Number(rest.risk) },
      _id.toString(),
      geo,
    ),
  );

  const fallback = await getMockDashboard();
  return {
    ...fallback,
    server,
    status: { ...fallback.status, dbLatencyMs: Number(latencyMs.toFixed(1)) },
    connections,
    summary: heuristicSummary(connections, Date.now()),
    source: "mongodb",
  };
}
