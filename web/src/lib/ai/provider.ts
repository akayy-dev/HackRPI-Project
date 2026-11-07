import "server-only";

/**
 * Pluggable AI chat provider. Not configured yet.
 *
 * To plug one in later:
 *   1. Set AI_PROVIDER=grok   + XAI_API_KEY     (or)
 *      AI_PROVIDER=gemini     + GEMINI_API_KEY
 *   2. Implement the matching `chat()` below.
 * The UI and /api/chat already speak this interface.
 */

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatProvider {
  name: string;
  chat(messages: ChatMessage[], context: string): Promise<string>;
}

const grok: ChatProvider = {
  name: "grok",
  async chat() {
    // TODO: POST https://api.x.ai/v1/chat/completions (OpenAI-compatible) with XAI_API_KEY
    throw new Error("Grok provider not implemented yet");
  },
};

const gemini: ChatProvider = {
  name: "gemini",
  async chat() {
    // TODO: use @google/genai with GEMINI_API_KEY
    throw new Error("Gemini provider not implemented yet");
  },
};

const PROVIDERS: Record<string, ChatProvider> = { grok, gemini };

/** Returns null when no provider is configured — callers show a placeholder. */
export function getChatProvider(): ChatProvider | null {
  const key = process.env.AI_PROVIDER?.toLowerCase();
  return (key && PROVIDERS[key]) || null;
}
