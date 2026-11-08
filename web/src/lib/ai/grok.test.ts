import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GrokError, grokChat, isGrokConfigured } from "./grok";

const ok = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

function lastCall(fetchMock: ReturnType<typeof vi.fn>) {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, init, body: JSON.parse(init.body as string) };
}

describe("grokChat", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ok("hi"));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("XAI_API_KEY", "k");
    vi.stubEnv("XAI_MODEL", "");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("sends bearer key, model and messages", async () => {
    vi.stubEnv("XAI_MODEL", "grok-x");
    const reply = await grokChat([{ role: "user", content: "q" }]);
    const { url, init, body } = lastCall(fetchMock);
    expect(reply).toBe("hi");
    expect(url).toBe("https://api.x.ai/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
    expect(body.model).toBe("grok-x");
    expect(body.messages).toEqual([{ role: "user", content: "q" }]);
  });

  it("defaults model to grok-4", async () => {
    await grokChat([{ role: "user", content: "q" }]);
    expect(lastCall(fetchMock).body.model).toBe("grok-4");
  });

  it("json option sets response_format", async () => {
    await grokChat([{ role: "user", content: "q" }], { json: true });
    expect(lastCall(fetchMock).body.response_format).toEqual({ type: "json_object" });
  });

  it("throws GrokError with status on non-2xx", async () => {
    fetchMock.mockResolvedValueOnce(new Response("slow down", { status: 429 }));
    await expect(grokChat([{ role: "user", content: "q" }])).rejects.toMatchObject({
      name: "GrokError",
      status: 429,
    });
  });

  it("throws GrokError(null) when key missing", async () => {
    vi.stubEnv("XAI_API_KEY", "");
    await expect(grokChat([{ role: "user", content: "q" }])).rejects.toMatchObject({ status: null });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(isGrokConfigured()).toBe(false);
  });

  it("aborts after timeoutMs", async () => {
    fetchMock.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_res, rej) => init.signal?.addEventListener("abort", () => rej(init.signal?.reason))),
    );
    await expect(grokChat([{ role: "user", content: "q" }], { timeoutMs: 10 })).rejects.toBeInstanceOf(GrokError);
  });
});
