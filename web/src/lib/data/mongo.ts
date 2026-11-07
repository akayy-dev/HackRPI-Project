import "server-only";
import type { ObjectId } from "mongodb";
import type { ConnectionEvent, DashboardData } from "@/lib/types";
import { getDb } from "@/lib/db/mongodb";
import { getMockDashboard, MOCK_SERVER } from "./mock";

/**
 * MongoDB-backed dashboard data.
 * Collection `connections` — one document per proxied request (see README).
 * Anything not yet stored in Mongo (server info, AI summary) falls back to mock.
 */

interface ConnectionDoc extends Omit<ConnectionEvent, "id" | "timestamp"> {
  _id: ObjectId;
  timestamp: Date;
}

const LOOKBACK_MS = 24 * 60 * 60_000;
const LIMIT = 500;

export async function getMongoDashboard(): Promise<DashboardData> {
  const db = await getDb();
  const since = new Date(Date.now() - LOOKBACK_MS);

  const docs = await db
    .collection<ConnectionDoc>("connections")
    .find({ timestamp: { $gte: since } })
    .sort({ timestamp: -1 })
    .limit(LIMIT)
    .toArray();

  const connections: ConnectionEvent[] = docs.map(({ _id, timestamp, ...rest }) => ({
    ...rest,
    id: _id.toString(),
    timestamp: timestamp.toISOString(),
  }));

  const fallback = getMockDashboard();
  return {
    ...fallback,
    server: MOCK_SERVER, // TODO: read from a `servers` collection
    connections,
    source: "mongodb",
  };
}
