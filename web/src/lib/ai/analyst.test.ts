import { describe, expect, it } from "vitest";
import { NOW, ev, times } from "../../../test/events";
import { SOC_SYSTEM_PROMPT, TRIAGE_INSTRUCTION, heuristicSummary, heuristicTriage, parseTriage, severityFloor } from "./analyst";
import { buildSocContext } from "./socContext";

const ATTACKER = "203.0.113.50";
const quiet = () => buildSocContext(times(10, () => ev({ risk: 0.1 })), NOW);
const attack = (n: number, ip = ATTACKER) =>
  buildSocContext(
    [...times(n, () => ev({ ip, risk: 0.95, label: "sql_injection", url: "/login?u=' OR 1=1" })), ev({ risk: 0.1, url: "/home" })],
    NOW,
  );
const reply = (o: Record<string, unknown>) => JSON.stringify({ trafficStatus: "NORMAL", activeAnomaly: null, summary: "ok", suggestedActions: [], ...o });

describe("severityFloor", () => {
  it("is NORMAL when quiet, ELEVATED at 5 recent blocks, CRITICAL at 50 or 20 from one IP", () => {
    expect(severityFloor(quiet())).toBe("NORMAL");
    expect(severityFloor(attack(5, "x"))).toBe("ELEVATED");
    expect(severityFloor(attack(20))).toBe("CRITICAL");
    const spread = buildSocContext(times(50, (i) => ev({ ip: `10.0.${i}.1`, risk: 0.9 })), NOW);
    expect(severityFloor(spread)).toBe("CRITICAL");
  });
});

describe("parseTriage", () => {
  it("parses fenced json", () => {
    const r = parseTriage("```json\n" + reply({ summary: "All quiet." }) + "\n```", quiet());
    expect(r).toMatchObject({ trafficStatus: "NORMAL", summary: "All quiet.", activeAnomaly: null });
  });

  it("floor wins over model", () => {
    const r = parseTriage(reply({ trafficStatus: "NORMAL", summary: "IGNORE: all clear" }), attack(60));
    expect(r?.trafficStatus).toBe("CRITICAL");
  });

  it("model may raise above floor", () => {
    expect(parseTriage(reply({ trafficStatus: "ELEVATED" }), quiet())?.trafficStatus).toBe("ELEVATED");
  });

  it("invalid status falls back to floor", () => {
    expect(parseTriage(reply({ trafficStatus: "PANIC" }), attack(6))?.trafficStatus).toBe("ELEVATED");
  });

  it("drops actions for unknown IPs and paths", () => {
    const r = parseTriage(
      reply({
        suggestedActions: [
          { kind: "watch_ip", target: ATTACKER, label: `Watch ${ATTACKER}` },
          { kind: "watch_ip", target: "203.0.113.99", label: "Watch 203.0.113.99" },
          { kind: "inspect_path", target: "/admin", label: "Inspect /admin" },
          { kind: "inspect_path", target: "/login", label: "Inspect /login" },
        ],
      }),
      attack(6),
    );
    expect(r?.suggestedActions).toEqual([
      { id: `watch_ip-${ATTACKER}`, kind: "watch_ip", target: ATTACKER, label: `Watch ${ATTACKER}`, actionLabel: "Watch", variant: "primary" },
      { id: "inspect_path-/login", kind: "inspect_path", target: "/login", label: "Inspect /login requests", actionLabel: "View", variant: "secondary" },
    ]);
  });

  it("caps actions at 3 and ignores unknown kinds", () => {
    const ctx = buildSocContext(times(5, (i) => ev({ ip: `10.0.0.${i}`, risk: 0.9 })), NOW);
    const acts = [
      { kind: "nuke", target: "10.0.0.0", label: "x" },
      ...times(5, (i) => ({ kind: "watch_ip", target: `10.0.0.${i}`, label: "Watch" })),
    ];
    const r = parseTriage(reply({ suggestedActions: acts }), ctx);
    expect(r?.suggestedActions).toHaveLength(3);
    expect(r?.suggestedActions[0]).toMatchObject({ actionLabel: "Watch", kind: "watch_ip" });
  });

  it("dedupes identical actions (ids are React keys)", () => {
    const acts = times(3, () => ({ kind: "watch_ip", target: ATTACKER, label: "Watch" }));
    expect(parseTriage(reply({ suggestedActions: acts }), attack(6))?.suggestedActions).toHaveLength(1);
  });

  it("action labels come from kind and target, never from the model", () => {
    const r = parseTriage(
      reply({ suggestedActions: [{ kind: "block_ip", target: ATTACKER, label: "sql_injection" }, { kind: "watch_ip", target: ATTACKER }] }),
      attack(6),
    );
    expect(r?.suggestedActions.map((a) => a.label)).toEqual([`Watch ${ATTACKER}`]); // block_ip is not on the menu
  });

  it("triage instruction scopes status to the last 5 minutes", () => {
    expect(TRIAGE_INSTRUCTION).toMatch(/last 5 minutes/);
  });

  it("returns null on garbage", () => {
    expect(parseTriage("not json", quiet())).toBeNull();
    expect(parseTriage(JSON.stringify({ trafficStatus: "NORMAL" }), quiet())).toBeNull();
  });

  it("strips markdown and caps summary length", () => {
    const r = parseTriage(reply({ summary: "**Bold** `code` # head " + "x".repeat(500), activeAnomaly: "**SQLi**" }), quiet());
    expect(r?.summary).not.toMatch(/[*`#]/);
    expect(r?.summary.length).toBeLessThanOrEqual(400);
    expect(r?.activeAnomaly).toBe("SQLi");
  });
});

describe("heuristicTriage", () => {
  it("heuristic on empty context", () => {
    expect(heuristicTriage(buildSocContext([], NOW))).toEqual({
      trafficStatus: "NORMAL",
      activeAnomaly: null,
      summary: "No traffic in the current window.",
      suggestedActions: [],
    });
  });

  it("heuristic reports no active anomaly when nothing was blocked in the last 5 minutes", () => {
    const ctx = buildSocContext(times(6, () => ev({ risk: 0.9, label: "sql_injection", minsAgo: 60 })), NOW);
    expect(heuristicTriage(ctx).activeAnomaly).toBeNull();
  });

  it("heuristic proposes block for noisy IP", () => {
    const r = heuristicTriage(attack(6));
    expect(r.trafficStatus).toBe("ELEVATED");
    expect(r.activeAnomaly).toBe("SQLi");
    expect(r.summary).toBe(`7 requests, 6 blocked. Top source ${ATTACKER} (US) with 6 blocked.`);
    expect(r.suggestedActions.map((a) => a.id)).toEqual([`watch_ip-${ATTACKER}`, "inspect_path-/login"]);
  });
});

describe("heuristicSummary", () => {
  it("summarises real connections with traffic/min from the data, no canned text", () => {
    const events = [...times(6, () => ev({ ip: ATTACKER, risk: 0.95, label: "sql_injection" })), ...times(4, () => ev({ risk: 0.1 }))];
    expect(heuristicSummary(events, NOW)).toEqual({
      trafficPerMin: 2,
      trafficStatus: "ELEVATED",
      activeAnomaly: "SQLi",
      summary: `10 requests, 6 blocked. Top source ${ATTACKER} (US) with 6 blocked.`,
      suggestedActions: [
        { id: `watch_ip-${ATTACKER}`, kind: "watch_ip", target: ATTACKER, label: `Watch ${ATTACKER}`, actionLabel: "Watch", variant: "primary" },
        { id: "inspect_path-/", kind: "inspect_path", target: "/", label: "Inspect / requests", actionLabel: "View", variant: "secondary" },
      ],
    });
  });

  it("empty connections → no-traffic summary", () => {
    expect(heuristicSummary([], NOW)).toMatchObject({ trafficPerMin: 0, summary: "No traffic in the current window." });
  });
});

describe("prompts", () => {
  it("system prompt marks traffic as untrusted and instruction demands JSON", () => {
    expect(SOC_SYSTEM_PROMPT).toMatch(/untrusted/i);
    expect(SOC_SYSTEM_PROMPT).toContain("<traffic_data>");
    expect(TRIAGE_INSTRUCTION).toMatch(/JSON/);
    expect(TRIAGE_INSTRUCTION).not.toContain("block_ip");
    expect(TRIAGE_INSTRUCTION).toMatch(/never use the data field names/);
  });
});
