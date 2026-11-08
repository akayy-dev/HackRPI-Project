import "server-only";
import { MongoClient, type Db } from "mongodb";

/**
 * Cached MongoDB connection. Reuses one client across hot reloads in dev
 * and across requests in prod (standard Next.js pattern).
 */
const globalForMongo = globalThis as unknown as { _mongoClient?: Promise<MongoClient> };

export function isMongoConfigured(): boolean {
  return Boolean(process.env.MONGODB_URI);
}

export async function getDb(): Promise<Db> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");

  if (!globalForMongo._mongoClient) {
    globalForMongo._mongoClient = new MongoClient(uri).connect();
  }
  const client = await globalForMongo._mongoClient;
  return client.db(process.env.MONGODB_DB ?? "proxy");
}
