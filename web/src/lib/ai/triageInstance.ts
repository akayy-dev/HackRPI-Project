import "server-only";
import { getChatProvider } from "./provider";
import { createTriageService, type TriageService } from "./triageService";

// Module scope (not globalThis): a dev hot-reload rebuilds the service with the new code
let service: TriageService | null = null;

/** One triage cache per server process, shared by every /api/triage request. */
export function getTriageService(): TriageService {
  if (!service) {
    const ttlSec = Number(process.env.AI_TRIAGE_TTL_SEC);
    service = createTriageService({
      provider: getChatProvider(),
      now: Date.now,
      ttlMs: (Number.isFinite(ttlSec) && ttlSec > 0 ? ttlSec : 60) * 1000,
      minRefreshMs: 15_000,
    });
  }
  return service;
}
