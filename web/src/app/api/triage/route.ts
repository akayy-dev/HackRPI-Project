import { NextResponse } from "next/server";
import { getTriageService } from "@/lib/ai/triageInstance";
import { getDashboardData } from "@/lib/data";

export const dynamic = "force-dynamic";

/** AI Sentinel's current read of the traffic. Cached; `?refresh=1` forces a (throttled) re-analysis. */
export async function GET(req: Request) {
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  const data = await getDashboardData();
  return NextResponse.json(await getTriageService().get(data.connections, { refresh }));
}
