import { NextResponse } from "next/server";
import { getChatProvider } from "@/lib/ai/provider";
import { sanitizeHistory } from "@/lib/ai/history";
import { buildSocContext } from "@/lib/ai/socContext";
import { getDashboardData } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { messages?: unknown } | null;
  const history = sanitizeHistory(body?.messages);

  const provider = getChatProvider();
  if (!provider) {
    return NextResponse.json({
      configured: false,
      reply: "AI analyst is not configured. Set AI_PROVIDER=grok and XAI_API_KEY in web/.env.local.",
    });
  }
  if (history.at(-1)?.role !== "user") {
    return NextResponse.json({ configured: true, reply: "Ask a question about the traffic." }, { status: 400 });
  }

  try {
    const data = await getDashboardData();
    const reply = await provider.chat(history, buildSocContext(data.connections, Date.now()));
    return NextResponse.json({ configured: true, reply });
  } catch (err) {
    console.error("[chat] AI provider failed:", err);
    return NextResponse.json({ configured: true, reply: `AI error: ${(err as Error).message}` }, { status: 502 });
  }
}
