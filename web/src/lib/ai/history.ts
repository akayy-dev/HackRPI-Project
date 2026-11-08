/** Chat turns as the browser may send them. System prompts are server-owned, never client-supplied. */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const MAX_TURNS = 10;
const MAX_CHARS = 2000;

/** Untrusted request body → safe history: user/assistant only, last 10 turns, 2000 chars each. */
export function sanitizeHistory(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (m): m is ChatMessage =>
        !!m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string",
    )
    .slice(-MAX_TURNS)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
}
