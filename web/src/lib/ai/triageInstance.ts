import "server-only";
import { getChatProvider } from "./provider";
import { createTriageService, type TriageService } from "./triageService";

const g = globalThis as typeof globalThis & { __socTriage?: TriageService };

/** One triage cache per server process, shared by /api/triage and the alert watcher. */
export function getTriageService(): TriageService {
  if (!g.__socTriage) {
    const ttlSec = Number(process.env.AI_TRIAGE_TTL_SEC);
    g.__socTriage = createTriageService({
      provider: getChatProvider(),
      now: Date.now,
      ttlMs: (Number.isFinite(ttlSec) && ttlSec > 0 ? ttlSec : 60) * 1000,
      minRefreshMs: 15_000,
    });
  }
  return g.__socTriage;
}
