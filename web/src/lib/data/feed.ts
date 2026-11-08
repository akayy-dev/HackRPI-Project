import "server-only";
import path from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { DashboardData, RequestLog } from "@/lib/types";
import { getGeoResolver } from "@/lib/geo";
import { toConnectionEvent } from "./toEvent";
import { getMockDashboard, MOCK_SERVER } from "./mock";

/**
 * Local JSON feed: a stand-in for the Mongo collection while testing the UI.
 * One request document per line (NDJSON), same shape as the Mongo schema plus `_id`.
 * Written by `npm run test:live` (scripts/live-test/run.mjs), re-read on every poll.
 */

export const FEED_PATH = path.resolve(process.cwd(), process.env.MOCK_FEED_FILE ?? "data/live-feed.ndjson");

const LOOKBACK_MS = 24 * 60 * 60_000;
const LIMIT = 500;

interface FeedDoc extends RequestLog {
  _id: string;
}

export function isFeedPresent(): boolean {
  return existsSync(FEED_PATH);
}

function parseLines(text: string): FeedDoc[] {
  const docs: FeedDoc[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      docs.push(JSON.parse(line));
    } catch {
      /* half-written last line — picked up on the next poll */
    }
  }
  return docs;
}

export async function getFeedDashboard(): Promise<DashboardData> {
  const since = Date.now() - LOOKBACK_MS;
  const docs = parseLines(await readFile(FEED_PATH, "utf8"))
    .filter((d) => Date.parse(d.timestamp) >= since)
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, LIMIT);

  const server = MOCK_SERVER;
  const geo = await getGeoResolver(server.location);
  const connections = docs.map(({ _id, ...log }) =>
    toConnectionEvent({ ...log, risk: Number(log.risk) }, _id, geo),
  );

  const fallback = await getMockDashboard();
  return { ...fallback, server, connections, source: "feed" };
}
