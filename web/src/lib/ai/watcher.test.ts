import { describe, expect, it, vi } from "vitest";
import type { ConnectionEvent } from "@/lib/types";
import { NOW, ev, times } from "../../../test/events";
import type { TriageResponse } from "./triageService";
import { alertPayload, createWatcher, type Alert } from "./watcher";

const MIN = 60_000;
const ATTACKER = "203.0.113.50";

/** n blocked requests from one IP, `atMin` minutes after NOW (so the watcher clock can move forward). */
const blockedAt = (n: number, atMin = 0, ip = ATTACKER) =>
  times(n, () => ev({ ip, risk: 0.95, label: "sql_injection", minsAgo: -atMin + 0.5 }));
const allowedAt = (n: number, atMin = 0) => times(n, () => ev({ risk: 0.1, minsAgo: -atMin + 0.5 }));

const grokReply = (summary = "Grok: SQLi burst from 203.0.113.50"): TriageResponse => ({
  configured: true,
  source: "grok",
  analyzedAt: new Date(NOW).toISOString(),
  summary: {
    trafficPerMin: 1,
    trafficStatus: "ELEVATED",
    activeAnomaly: "SQLi",
    summary,
    suggestedActions: [{ id: `block_ip-${ATTACKER}`, label: `Block ${ATTACKER}`, actionLabel: "Block", variant: "primary" }],
  },
});

function setup(opts: { analyze?: (e: ConnectionEvent[]) => Promise<TriageResponse>; emit?: (a: Alert) => Promise<void> } = {}) {
  let t = NOW;
  let events: ConnectionEvent[] = [];
  const analyze = vi.fn(opts.analyze ?? (async () => grokReply()));
  const emit = vi.fn(opts.emit ?? (async () => {}));
  const w = createWatcher({ getEvents: async () => events, analyze, emit, now: () => t });
  return {
    w,
    analyze,
    emit,
    set: (e: ConnectionEvent[]) => (events = e),
    at: (min: number) => (t = NOW + min * MIN),
  };
}

describe("watcher", () => {
  it("quiet traffic → no analyze, no emit", async () => {
    const s = setup();
    s.set(allowedAt(20));
    expect(await s.w.tick()).toBeNull();
    expect(s.analyze).not.toHaveBeenCalled();
    expect(s.emit).not.toHaveBeenCalled();
  });

  it("NORMAL → ELEVATED fires once", async () => {
    const s = setup();
    s.set(blockedAt(6));
    const alert = await s.w.tick();
    expect(alert).toMatchObject({ level: "ELEVATED", source: "grok", blocked5m: 6, topIp: ATTACKER });
    expect(alert?.summary).toContain("SQLi burst");
    expect(alert?.actions).toHaveLength(1);
    expect(s.analyze).toHaveBeenCalledTimes(1);
    expect(s.emit).toHaveBeenCalledTimes(1);
  });

  it("sustained attack fires once", async () => {
    const s = setup();
    s.set(blockedAt(6));
    for (let i = 0; i < 10; i++) await s.w.tick();
    expect(s.emit).toHaveBeenCalledTimes(1);
  });

  it("escalation fires again", async () => {
    const s = setup();
    s.set(blockedAt(6, 0, "10.0.0.1"));
    await s.w.tick();
    s.set(times(60, (i) => ev({ ip: `10.1.${i}.1`, risk: 0.9 })));
    const second = await s.w.tick();
    expect(second?.level).toBe("CRITICAL");
    expect(s.emit).toHaveBeenCalledTimes(2);
  });

  it("re-arms after calm", async () => {
    const s = setup();
    s.set(blockedAt(6, 0));
    await s.w.tick();
    s.at(6);
    s.set(allowedAt(5, 6));
    expect(await s.w.tick()).toBeNull();
    s.at(11);
    s.set(blockedAt(6, 11));
    expect((await s.w.tick())?.level).toBe("ELEVATED");
    expect(s.emit).toHaveBeenCalledTimes(2);
  });

  it("flapping within cooldown → 1 alert", async () => {
    const s = setup();
    s.set(blockedAt(6, 0));
    await s.w.tick();
    s.at(2);
    s.set(allowedAt(5, 2));
    await s.w.tick();
    s.at(5);
    s.set(blockedAt(6, 5));
    expect(await s.w.tick()).toBeNull();
    expect(s.emit).toHaveBeenCalledTimes(1);
  });

  it("attack resuming inside the cooldown alerts once the cooldown expires", async () => {
    const s = setup();
    s.set(blockedAt(6, 0)); // short probe → alert
    await s.w.tick();
    s.at(1);
    s.set(allowedAt(5, 1)); // calm
    await s.w.tick();
    s.at(5);
    s.set(blockedAt(6, 5)); // real attack starts inside cooldown → suppressed
    expect(await s.w.tick()).toBeNull();
    s.at(11);
    s.set(blockedAt(6, 11)); // still going after cooldown → must alert
    expect((await s.w.tick())?.level).toBe("ELEVATED");
    expect(s.emit).toHaveBeenCalledTimes(2);
  });

  it("old attacks ignored", async () => {
    const s = setup();
    s.set(times(60, () => ev({ ip: ATTACKER, risk: 0.95, minsAgo: 10 })));
    expect(await s.w.tick()).toBeNull();
  });

  it("Grok down still alerts", async () => {
    const s = setup({ analyze: async () => ({ ...grokReply("6 requests, 6 blocked."), source: "heuristic", error: "Grok HTTP 503" }) });
    s.set(blockedAt(6));
    expect(await s.w.tick()).toMatchObject({ source: "heuristic", summary: "6 requests, 6 blocked." });
  });

  it("analyze throwing still alerts with the heuristic summary", async () => {
    const s = setup({ analyze: async () => Promise.reject(new Error("db down")) });
    s.set(blockedAt(6));
    const alert = await s.w.tick();
    expect(alert).toMatchObject({ source: "heuristic", level: "ELEVATED" });
    expect(alert?.summary).toContain("6 blocked");
  });

  it("emit failure does not throw", async () => {
    const s = setup({ emit: async () => Promise.reject(new Error("webhook 500")) });
    s.set(blockedAt(6));
    await expect(s.w.tick()).resolves.toMatchObject({ level: "ELEVATED" });
  });

  it("overlapping tick skipped", async () => {
    let release!: (r: TriageResponse) => void;
    const s = setup({ analyze: () => new Promise((r) => (release = r)) });
    s.set(blockedAt(6));
    const first = s.w.tick();
    await new Promise((r) => setTimeout(r, 0));
    expect(await s.w.tick()).toBeNull();
    release(grokReply());
    expect(await first).toMatchObject({ level: "ELEVATED" });
    expect(s.analyze).toHaveBeenCalledTimes(1);
  });
});

describe("alertPayload", () => {
  it("neutralises mentions and links from attacker-controlled text", () => {
    const alert: Alert = {
      at: new Date(NOW).toISOString(),
      level: "CRITICAL",
      source: "grok",
      summary: "UA was @everyone <https://evil.example|Acknowledge alert> & <!channel> [click](https://evil.example)",
      actions: [{ id: "x", label: "Inspect <!here>", actionLabel: "View", variant: "secondary" }],
      blocked5m: 60,
      topIp: ATTACKER,
    };
    const p = alertPayload(alert);
    expect(p.allowed_mentions).toEqual({ parse: [] });
    expect(p.text).not.toMatch(/[<>]/);
    expect(p.text).toContain("&lt;https://evil.example|Acknowledge alert&gt;");
    expect(p.text).toContain("&amp;");
    expect(p.content).not.toContain("](");
    expect(p.text).toContain(`Top: ${ATTACKER} · 60 blocked/5m`);
  });
});
