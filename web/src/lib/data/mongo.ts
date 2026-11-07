import "server-only";
import type { ObjectId } from "mongodb";
import type { DashboardData, RequestLog } from "@/lib/types";
import { getDb } from "@/lib/db/mongodb";
import { getGeoResolver } from "@/lib/geo";
import { toConnectionEvent } from "./toEvent";
import { getMockDashboard, MOCK_SERVER } from "./mock";

/**
 * MongoDB-backed dashboard data.
 * One document per proxied request, written by the proxy (see README → "MongoDB schema").
 * Anything not yet stored in Mongo (server info, AI summary) falls back to mock.
 */

interface RequestLogDoc extends Omit<RequestLog, "timestamp"> {
  _id: ObjectId;
  timestamp: Date;
}

const COLLECTION = process.env.MONGODB_COLLECTION ?? "connections";
const LOOKBACK_MS = 24 * 60 * 60_000;
const LIMIT = 500;

export async function getMongoDashboard(): Promise<DashboardData> {
  const db = await getDb();
  const since = new Date(Date.now() - LOOKBACK_MS);

  const docs = await db
    .collection<RequestLogDoc>(COLLECTION)
    .find({ timestamp: { $gte: since } })
    .sort({ timestamp: -1 })
    .limit(LIMIT)
    .toArray();

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
    connections,
    source: "mongodb",
  };
}
