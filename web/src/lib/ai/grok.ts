import "server-only";

/**
 * Thin client for xAI's OpenAI-compatible Chat Completions API.
 * Env: XAI_API_KEY (required), XAI_MODEL (default "grok-4").
 */

const ENDPOINT = "https://api.x.ai/v1/chat/completions";
const DEFAULT_MODEL = "grok-4";

export interface GrokMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GrokOptions {
  /** Ask for a JSON object reply */
  json?: boolean;
  temperature?: number;
  timeoutMs?: number;
}

export class GrokError extends Error {
  /** HTTP status from xAI, or null for config/network/timeout failures */
  status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = "GrokError";
    this.status = status;
  }
}

export function isGrokConfigured(): boolean {
  return Boolean(process.env.XAI_API_KEY?.trim());
}

export async function grokChat(messages: GrokMessage[], opts: GrokOptions = {}): Promise<string> {
  const key = process.env.XAI_API_KEY?.trim();
  if (!key) throw new GrokError("XAI_API_KEY is not set", null);

  const body: Record<string, unknown> = {
    model: process.env.XAI_MODEL?.trim() || DEFAULT_MODEL,
    messages,
    temperature: opts.temperature ?? 0.2,
    max_tokens: 800,
  };
  if (opts.json) body.response_format = { type: "json_object" };

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    });
  } catch (err) {
    const timedOut = (err as Error)?.name === "TimeoutError";
    throw new GrokError(timedOut ? "Grok request timed out" : `Grok request failed: ${(err as Error)?.message}`, null);
  }

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new GrokError(`Grok HTTP ${res.status}${detail ? `: ${detail}` : ""}`, res.status);
  }

  const data = (await res.json().catch(() => null)) as { choices?: { message?: { content?: unknown } }[] } | null;
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new GrokError("Grok returned no message content", res.status);
  return content;
}
