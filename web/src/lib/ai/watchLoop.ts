import "server-only";
import { getDashboardData } from "@/lib/data";
import { getDb, isMongoConfigured } from "@/lib/db/mongodb";
import { getTriageService } from "./triageInstance";
import { alertPayload, createWatcher, type Alert } from "./watcher";

/**
 * Runs the escalation watcher inside the Next.js server process (started from instrumentation.ts).
 * Env: AI_WATCH_INTERVAL_SEC (default 30, 0 disables), ALERT_WEBHOOK_URL (Slack or Discord, optional).
 */

const g = globalThis as typeof globalThis & { __socWatcher?: NodeJS.Timeout };

async function emit(alert: Alert): Promise<void> {
  console.warn("[SOC ALERT]", alert.level, alert.summary);
  const jobs: Promise<unknown>[] = [];

  if (isMongoConfigured()) {
    jobs.push(getDb().then((db) => db.collection("alerts").insertOne({ ...alert, at: new Date(alert.at) })));
  }

  const hook = process.env.ALERT_WEBHOOK_URL?.trim();
  if (hook) {
    jobs.push(
      fetch(hook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(alertPayload(alert)),
        signal: AbortSignal.timeout(5_000),
      }).then((res) => {
        if (!res.ok) throw new Error(`webhook HTTP ${res.status}`);
      }),
    );
  }

  const failed = (await Promise.allSettled(jobs)).filter((r) => r.status === "rejected");
  if (failed.length) throw new Error(failed.map((r) => String((r as PromiseRejectedResult).reason)).join("; "));
}

export function startWatchLoop(): void {
  if (g.__socWatcher) return;
  const raw = process.env.AI_WATCH_INTERVAL_SEC;
  const sec = raw === undefined || raw === "" ? 30 : Number(raw);
  if (!Number.isFinite(sec) || sec <= 0) {
    console.info("[watcher] disabled (AI_WATCH_INTERVAL_SEC=0)");
    return;
  }

  const watcher = createWatcher({
    getEvents: async () => {
      const data = await getDashboardData();
      return data.source === "mock" ? [] : data.connections; // never alert on demo data
    },
    analyze: (events) => getTriageService().get(events, { force: true }),
    emit,
    now: Date.now,
  });

  g.__socWatcher = setInterval(() => {
    watcher.tick().catch((err) => console.error("[watcher] tick failed:", err));
  }, sec * 1000);
  g.__socWatcher.unref();
  console.info(`[watcher] watching traffic every ${sec}s`);
}
