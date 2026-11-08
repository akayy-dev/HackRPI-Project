import "server-only";
import type { DashboardData } from "@/lib/types";
import { isMongoConfigured } from "@/lib/db/mongodb";
import { getMockDashboard } from "./mock";
import { getMongoDashboard } from "./mongo";
import { getFeedDashboard, isFeedPresent } from "./feed";

/**
 * Single entry point for dashboard data.
 * - MONGODB_URI set              → real data from MongoDB
 * - data/live-feed.ndjson exists → local JSON feed (written by `npm run test:live`)
 * - otherwise                    → hard-coded mock data
 */
export async function getDashboardData(): Promise<DashboardData> {
  if (isMongoConfigured()) {
    try {
      return await getMongoDashboard();
    } catch (err) {
      console.error("[data] MongoDB read failed, serving mock data:", err);
      return getMockDashboard();
    }
  }
  if (isFeedPresent()) {
    try {
      return await getFeedDashboard();
    } catch (err) {
      console.error("[data] feed read failed, serving mock data:", err);
    }
  }
  return getMockDashboard();
}
