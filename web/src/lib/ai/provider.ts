import "server-only";
import { SOC_SYSTEM_PROMPT, TRIAGE_INSTRUCTION, parseTriage, type TriageResult } from "./analyst";
import { grokChat, isGrokConfigured } from "./grok";
import type { ChatMessage } from "./history";
import { renderContext, type SocContext } from "./socContext";

/**
 * Pluggable AI analyst provider.
 *   AI_PROVIDER=grok + XAI_API_KEY (+ optional XAI_MODEL)  → AI Sentinel on xAI Grok
 *   AI_PROVIDER=gemini + GEMINI_API_KEY                     → not implemented yet
 * Traffic always travels fenced in <traffic_data> as its own message, apart from the instructions.
 */

export type { ChatMessage };

export interface ChatProvider {
  name: string;
  /** Free-form analyst answer to the latest user turn */
  chat(history: ChatMessage[], ctx: SocContext): Promise<string>;
  /** Structured triage; null when the reply could not be validated */
  triage(ctx: SocContext): Promise<TriageResult | null>;
}

const grok: ChatProvider = {
  name: "grok",
  async chat(history, ctx) {
    return grokChat([
      { role: "system", content: SOC_SYSTEM_PROMPT },
      { role: "user", content: renderContext(ctx) },
      ...history,
    ]);
  },
  async triage(ctx) {
    const reply = await grokChat(
      [
        { role: "system", content: SOC_SYSTEM_PROMPT },
        { role: "user", content: `${renderContext(ctx)}\n\n${TRIAGE_INSTRUCTION}` },
      ],
      { json: true, temperature: 0 },
    );
    return parseTriage(reply, ctx);
  },
};

const gemini: ChatProvider = {
  name: "gemini",
  async chat() {
    throw new Error("Gemini provider not implemented yet");
  },
  async triage() {
    throw new Error("Gemini provider not implemented yet");
  },
};

const PROVIDERS: Record<string, { provider: ChatProvider; configured: () => boolean }> = {
  grok: { provider: grok, configured: isGrokConfigured },
  gemini: { provider: gemini, configured: () => Boolean(process.env.GEMINI_API_KEY) },
};

/** Returns null when no provider is selected or its key is missing — callers fall back to heuristics. */
export function getChatProvider(): ChatProvider | null {
  const entry = PROVIDERS[process.env.AI_PROVIDER?.toLowerCase() ?? ""];
  return entry?.configured() ? entry.provider : null;
}
