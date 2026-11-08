import "server-only";
import { MongoClient, type Db } from "mongodb";

/**
 * Cached MongoDB connection. Reuses one client across hot reloads in dev
 * and across requests in prod (standard Next.js pattern).
 *
 * - Fails fast (5 s) when the server is unreachable, so the dashboard falls back to mock
 *   data quickly instead of hanging ~30 s per poll.
 * - A failed connection is not cached: the next poll retries, so switching networks
 *   (e.g. onto a hotspot that can reach Atlas) recovers without restarting the dev server.
 * - zlib wire compression (built into Node) shrinks the data pulled from a cloud cluster.
 */
const globalForMongo = globalThis as unknown as { _mongoClient?: Promise<MongoClient> };

export function isMongoConfigured(): boolean {
  return Boolean(process.env.MONGODB_URI);
}

export async function getDb(): Promise<Db> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");

  if (!globalForMongo._mongoClient) {
    const client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 5_000,
      connectTimeoutMS: 5_000,
      compressors: ["zlib"],
    });
    globalForMongo._mongoClient = client.connect().catch((err) => {
      globalForMongo._mongoClient = undefined; // retry on the next request
      void client.close().catch(() => {});
      throw err;
    });
  }
  const client = await globalForMongo._mongoClient;
  return client.db(process.env.MONGODB_DB || "telemetry");
}
