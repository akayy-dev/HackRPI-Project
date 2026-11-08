import { NextResponse } from "next/server";
import { getChatProvider, type ChatMessage } from "@/lib/ai/provider";
import { getDashboardData } from "@/lib/data";
import { getHeader } from "@/lib/requestLog";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { messages?: ChatMessage[] } | null;
  const messages = body?.messages ?? [];

  const provider = getChatProvider();
  if (!provider) {
    return NextResponse.json({
      configured: false,
      reply: "AI assistant is not configured yet. Set AI_PROVIDER (grok | gemini) and its API key.",
    });
  }

  try {
    const data = await getDashboardData();
    // Give the model a compact view of recent traffic as context
    const context = JSON.stringify({
      summary: data.summary,
      // Headers are bulky; send only what the model needs to reason about traffic
      recent: data.connections.slice(0, 50).map((e) => ({
        timestamp: e.timestamp,
        ip: e.ip,
        location: e.location?.code ?? null,
        method: e.method,
        url: e.url,
        host: e.host,
        risk: Number(e.risk.toFixed(3)),
        verdict: e.verdict,
        userAgent: getHeader(e, "User-Agent"),
      })),
    });
    const reply = await provider.chat(messages, context);
    return NextResponse.json({ configured: true, reply });
  } catch (err) {
    return NextResponse.json(
      { configured: true, reply: `AI error: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
