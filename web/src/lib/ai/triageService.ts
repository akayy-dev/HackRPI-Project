/**
 * Cost guard around provider.triage: one cached analysis shared by every dashboard tab
 * and the watcher, a throttle on forced refreshes, and a heuristic fallback so the
 * summary card always shows something true.
 */
import type { AiSummary, ConnectionEvent } from "@/lib/types";
import { heuristicTriage, type TriageResult } from "./analyst";
import type { ChatProvider } from "./provider";
import { buildSocContext } from "./socContext";

export interface TriageResponse {
  configured: boolean;
  source: "grok" | "heuristic";
  summary: AiSummary;
  analyzedAt: string;
  /** Why the AI result was not used (provider error or invalid reply) */
  error?: string;
}

export interface TriageDeps {
  provider: ChatProvider | null;
  now: () => number;
  ttlMs: number;
  minRefreshMs: number;
}

export interface TriageOptions {
  /** User-requested re-analysis: bypasses the cache, throttled to one per minRefreshMs */
  refresh?: boolean;
  /** Always analyze these events now (watcher on escalation; it is rate-limited by its own cooldown) */
  force?: boolean;
}

export interface TriageService {
  get(events: ConnectionEvent[], opts?: TriageOptions): Promise<TriageResponse>;
}

export function createTriageService({ provider, now, ttlMs, minRefreshMs }: TriageDeps): TriageService {
  let cached: { at: number; value: TriageResponse } | null = null;
  let inflight: Promise<TriageResponse> | null = null;

  async function analyze(events: ConnectionEvent[]): Promise<TriageResponse> {
    const t = now();
    const ctx = buildSocContext(events, t);
    let result: TriageResult | null = null;
    let error: string | undefined;
    if (provider && ctx.total > 0) {
      try {
        result = await provider.triage(ctx);
        if (!result) error = "AI reply was not valid triage JSON";
      } catch (err) {
        error = (err as Error)?.message ?? String(err);
        console.error("[triage] provider failed:", error);
      }
    }
    const source = result ? (provider!.name as "grok") : "heuristic";
    return {
      configured: provider !== null,
      source,
      summary: { ...(result ?? heuristicTriage(ctx)), trafficPerMin: ctx.perMin },
      analyzedAt: new Date(t).toISOString(),
      ...(error ? { error } : {}),
    };
  }

  return {
    async get(events, opts = {}) {
      if (opts.force) {
        // An in-flight analysis may predate the events we were handed: let it finish, then run ours
        if (inflight) await inflight.catch(() => undefined);
      } else {
        if (inflight) return inflight;
        const t = now();
        const fresh = cached && t - cached.at < ttlMs;
        const refreshAllowed = opts.refresh && (!cached || t - cached.at >= minRefreshMs);
        if (cached && fresh && !refreshAllowed) return cached.value;
      }

      const t = now();
      inflight = analyze(events)
        .then((value) => {
          cached = { at: t, value };
          return value;
        })
        .finally(() => {
          inflight = null;
        });
      return inflight;
    },
  };
}
