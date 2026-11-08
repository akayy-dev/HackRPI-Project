import { describe, expect, it, vi } from "vitest";
import { NOW, ev, times } from "../../../test/events";
import type { TriageResult } from "./analyst";
import type { ChatProvider } from "./provider";
import { createTriageService } from "./triageService";

const MODEL: TriageResult = { trafficStatus: "ELEVATED", activeAnomaly: "SQLi", summary: "Grok says hi", suggestedActions: [] };
const events = times(10, () => ev({ risk: 0.1 })); // 10 in the last 5 min → perMin 2

function setup(triage: ChatProvider["triage"] | null = vi.fn(async () => MODEL)) {
  let t = NOW;
  const provider = triage ? ({ name: "grok", chat: vi.fn(), triage } as ChatProvider) : null;
  const svc = createTriageService({ provider, now: () => t, ttlMs: 60_000, minRefreshMs: 15_000 });
  return { svc, triage, advance: (ms: number) => (t += ms) };
}

describe("triageService", () => {
  it("caches within ttl", async () => {
    const { svc, triage, advance } = setup();
    await svc.get(events);
    advance(10_000);
    const r = await svc.get(events);
    expect(triage).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ configured: true, source: "grok", summary: { summary: "Grok says hi" } });
  });

  it("refetches after ttl", async () => {
    const { svc, triage, advance } = setup();
    await svc.get(events);
    advance(61_000);
    await svc.get(events);
    expect(triage).toHaveBeenCalledTimes(2);
  });

  it("refresh bypasses cache but is throttled", async () => {
    const { svc, triage, advance } = setup();
    await svc.get(events, { refresh: true });
    advance(5_000);
    await svc.get(events, { refresh: true });
    expect(triage).toHaveBeenCalledTimes(1);
    advance(15_000);
    await svc.get(events, { refresh: true });
    expect(triage).toHaveBeenCalledTimes(2);
  });

  it("concurrent gets share one call", async () => {
    const { svc, triage } = setup();
    await Promise.all([svc.get(events), svc.get(events), svc.get(events)]);
    expect(triage).toHaveBeenCalledTimes(1);
  });

  it("provider null → heuristic, configured false", async () => {
    const { svc } = setup(null);
    expect(await svc.get(events)).toMatchObject({ configured: false, source: "heuristic" });
  });

  it("provider throws (GrokError 429) → heuristic with error message, configured true", async () => {
    const { svc } = setup(vi.fn(async () => Promise.reject(Object.assign(new Error("Grok HTTP 429"), { status: 429 }))));
    const r = await svc.get(events);
    expect(r).toMatchObject({ configured: true, source: "heuristic", error: "Grok HTTP 429" });
    expect(r.summary.summary).toBe("10 requests, 0 blocked.");
  });

  it("provider returns null (bad JSON) → heuristic", async () => {
    const { svc } = setup(vi.fn(async () => null));
    expect(await svc.get(events)).toMatchObject({ source: "heuristic", error: expect.stringMatching(/valid/i) });
  });

  it("empty events → heuristic, provider not called", async () => {
    const { svc, triage } = setup();
    const r = await svc.get([]);
    expect(triage).not.toHaveBeenCalled();
    expect(r).toMatchObject({ source: "heuristic", summary: { summary: "No traffic in the current window." } });
  });

  it("trafficPerMin comes from context, not model", async () => {
    const { svc } = setup(vi.fn(async () => ({ ...MODEL, trafficPerMin: 9999 }) as TriageResult));
    const r = await svc.get(events);
    expect(r.summary.trafficPerMin).toBe(2);
    expect(r.analyzedAt).toBe(new Date(NOW).toISOString());
  });
});
