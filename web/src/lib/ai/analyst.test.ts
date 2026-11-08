import { describe, expect, it } from "vitest";
import { NOW, ev, times } from "../../../test/events";
import { SOC_SYSTEM_PROMPT, TRIAGE_INSTRUCTION, heuristicTriage, parseTriage, severityFloor } from "./analyst";
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
          { kind: "block_ip", target: ATTACKER, label: `Block ${ATTACKER}` },
          { kind: "block_ip", target: "203.0.113.99", label: "Block 203.0.113.99" },
          { kind: "inspect_path", target: "/admin", label: "Inspect /admin" },
          { kind: "inspect_path", target: "/login", label: "Inspect /login" },
        ],
      }),
      attack(6),
    );
    expect(r?.suggestedActions).toEqual([
      { id: `block_ip-${ATTACKER}`, label: `Block ${ATTACKER}`, actionLabel: "Block", variant: "primary" },
      { id: "inspect_path-/login", label: "Inspect /login", actionLabel: "View", variant: "secondary" },
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
    expect(r?.suggestedActions[0]).toMatchObject({ actionLabel: "Watch", variant: "secondary" });
  });

  it("dedupes identical actions (ids are React keys)", () => {
    const acts = times(3, () => ({ kind: "watch_ip", target: ATTACKER, label: "Watch" }));
    expect(parseTriage(reply({ suggestedActions: acts }), attack(6))?.suggestedActions).toHaveLength(1);
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

  it("heuristic proposes block for noisy IP", () => {
    const r = heuristicTriage(attack(6));
    expect(r.trafficStatus).toBe("ELEVATED");
    expect(r.activeAnomaly).toBe("SQLi");
    expect(r.summary).toBe(`7 requests, 6 blocked. Top source ${ATTACKER} (US) with 6 blocked.`);
    expect(r.suggestedActions.map((a) => a.id)).toEqual([`block_ip-${ATTACKER}`, "inspect_path-/login"]);
  });
});

describe("prompts", () => {
  it("system prompt marks traffic as untrusted and instruction demands JSON", () => {
    expect(SOC_SYSTEM_PROMPT).toMatch(/untrusted/i);
    expect(SOC_SYSTEM_PROMPT).toContain("<traffic_data>");
    expect(TRIAGE_INSTRUCTION).toMatch(/JSON/);
  });
});
