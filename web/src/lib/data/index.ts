import "server-only";
import type { DashboardData } from "@/lib/types";
import { isMongoConfigured } from "@/lib/db/mongodb";
import { getMockDashboard } from "./mock";
import { getMongoDashboard } from "./mongo";

/**
 * Single entry point for dashboard data.
 * - MONGODB_URI set   → real data from MongoDB
 * - MONGODB_URI unset → hard-coded mock data
 */
export async function getDashboardData(): Promise<DashboardData> {
  if (!isMongoConfigured()) return getMockDashboard();
  try {
    return await getMongoDashboard();
  } catch (err) {
    console.error("[data] MongoDB read failed, serving mock data:", err);
    return getMockDashboard();
  }
}
