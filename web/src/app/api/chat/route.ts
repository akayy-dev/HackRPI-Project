import { NextResponse } from "next/server";
import { getChatProvider, type ChatMessage } from "@/lib/ai/provider";
import { getDashboardData } from "@/lib/data";

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
      recent: data.connections.slice(0, 50),
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
