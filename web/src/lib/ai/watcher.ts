/**
 * Escalation watcher: a "band-aid on sight of a wound".
 * Each tick computes the severity floor from the last 5 minutes (free, no AI). It asks the
 * analyst for a write-up only when severity rises, so one attack produces one alert. When
 * traffic calms to NORMAL, it re-arms for the next one. No timers here (see watchLoop.ts).
 */
import type { AiSummary, ConnectionEvent, SuggestedAction } from "@/lib/types";
import { heuristicTriage, severityFloor } from "./analyst";
import { buildSocContext } from "./socContext";
import type { TriageResponse } from "./triageService";

type Level = AiSummary["trafficStatus"];
const RANK: Record<Level, number> = { NORMAL: 0, ELEVATED: 1, CRITICAL: 2 };

export interface Alert {
  at: string;
  level: Exclude<Level, "NORMAL">;
  source: "grok" | "heuristic";
  summary: string;
  actions: SuggestedAction[];
  blocked5m: number;
  topIp: string | null;
}

export interface WatcherDeps {
  getEvents: () => Promise<ConnectionEvent[]>;
  /** Normally triage.get(events, { refresh: true }) */
  analyze: (events: ConnectionEvent[]) => Promise<TriageResponse>;
  emit: (alert: Alert) => Promise<void>;
  now: () => number;
  /** Minimum gap between two alerts at the same level (default 10 min) */
  cooldownMs?: number;
}

export function createWatcher({ getEvents, analyze, emit, now, cooldownMs = 600_000 }: WatcherDeps) {
  let armed: Level = "NORMAL";
  const lastAlertAt: Partial<Record<Level, number>> = {};
  let busy = false;

  async function tick(): Promise<Alert | null> {
    if (busy) return null;
    busy = true;
    try {
      const events = await getEvents();
      const t = now();
      const ctx = buildSocContext(events, t);
      const level = severityFloor(ctx);

      if (level === "NORMAL") {
        armed = "NORMAL"; // wound healed: re-arm
        return null;
      }
      if (RANK[level] <= RANK[armed]) return null; // same wound, already reported

      const last = lastAlertAt[level];
      armed = level;
      if (last !== undefined && t - last < cooldownMs) return null; // flapping
      lastAlertAt[level] = t;

      let source: Alert["source"] = "heuristic";
      let triage = heuristicTriage(ctx);
      try {
        const res = await analyze(events);
        source = res.source;
        triage = res.summary;
      } catch (err) {
        console.error("[watcher] analysis failed, alerting with heuristic summary:", err);
      }

      const alert: Alert = {
        at: new Date(t).toISOString(),
        level,
        source,
        summary: triage.summary,
        actions: triage.suggestedActions,
        blocked5m: ctx.blocked5m,
        topIp: ctx.topIps[0]?.ip ?? null,
      };
      try {
        await emit(alert);
      } catch (err) {
        console.error("[watcher] alert delivery failed:", err);
      }
      return alert;
    } finally {
      busy = false;
    }
  }

  return { tick };
}
