"use client";

import { useEffect, useRef, useState } from "react";
import type { AiSummary } from "@/lib/types";
import { SectionTitle } from "./ui";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

const EQ_DELAYS = [0, 0.2, 0.4, 0.1, 0.3, 0.5, 0.15, 0.35];

export default function AiPanel({ summary }: { summary: AiSummary }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || pending) return;
    const next = [...messages, { role: "user" as const, content }];
    setMessages(next);
    setInput("");
    setPending(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const data = (await res.json()) as { configured: boolean; reply: string };
      setConfigured(data.configured);
      setMessages((m) => [...m, { role: "assistant", content: data.reply }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Network error — could not reach /api/chat." }]);
    } finally {
      setPending(false);
    }
  }

  return (
    <aside className="flex flex-col gap-4 rounded-xl border border-obsidian-700 bg-obsidian-900 p-4 shadow-2xl sm:p-5 lg:col-span-4" data-purpose="ai-summary-helper">
      <div className="flex items-center justify-between border-b border-obsidian-800 pb-3">
        <SectionTitle>AI summary &amp; helper</SectionTitle>
        <div className="flex h-4 items-end gap-0.5 rounded border border-tactical/30 bg-obsidian-950 px-1.5 py-0.5" aria-hidden>
          {EQ_DELAYS.map((d, i) => (
            <div key={i} className="eq-bar w-1 rounded-t-sm bg-tactical" style={{ animationDelay: `${d}s`, animationDuration: `${0.8 + (i % 4) * 0.2}s` }} />
          ))}
        </div>
      </div>

      {/* Summary */}
      <div className="space-y-2.5 rounded-lg border border-obsidian-800 bg-obsidian-950/80 p-3.5">
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="rounded border border-obsidian-800 bg-obsidian-900 p-2">
            <div className="text-[10px] text-gray-400">TRAFFIC</div>
            <div className="font-bold text-white">
              {(summary.trafficPerMin / 1000).toFixed(1)}k/min <span className="text-[10px] text-tactical">{summary.trafficStatus}</span>
            </div>
          </div>
          <div className="rounded border border-obsidian-800 bg-obsidian-900 p-2">
            <div className="text-[10px] text-gray-400">ANOMALIES</div>
            <div className="font-bold text-tactical">
              {summary.activeAnomaly ?? "None"} {summary.activeAnomaly && <span className="text-[10px]">ACTIVE</span>}
            </div>
          </div>
        </div>
        <p className="border-t border-obsidian-800 pt-2 text-[11px] leading-relaxed text-gray-300">{summary.summary}</p>
      </div>

      {/* Suggested actions */}
      <div className="space-y-2">
        <div className="text-xs font-bold text-gray-300">Suggested actions</div>
        {summary.suggestedActions.map((a) => (
          <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-obsidian-800 bg-obsidian-850 p-2 transition-colors hover:border-tactical/40">
            <span className="truncate text-xs text-gray-200">{a.label}</span>
            {/* TODO: wire to proxy control API */}
            <button
              type="button"
              className={
                a.variant === "primary"
                  ? "shrink-0 whitespace-nowrap rounded bg-tactical px-3 py-1 text-xs font-bold text-obsidian-950 shadow-[0_0_8px_rgba(0,255,136,0.3)] transition-all hover:bg-tactical-dim"
                  : "shrink-0 whitespace-nowrap rounded border border-tactical/60 px-3 py-1 text-xs font-semibold text-tactical transition-all hover:bg-tactical/15"
              }
            >
              {a.actionLabel}
            </button>
          </div>
        ))}
      </div>

      {/* Chat */}
      <div className="mt-auto space-y-2.5">
        <div ref={scrollRef} className="flex max-h-56 min-h-24 flex-col gap-2 overflow-y-auto rounded-lg border border-dashed border-obsidian-700 bg-obsidian-950 p-3">
          {messages.length === 0 && (
            <p className="m-auto text-center text-[11px] text-gray-500">
              AI assistant {configured === false ? "not configured" : "ready"} — ask about traffic.
              <br />
              <span className="text-gray-600">(Grok / Gemini plugs in via AI_PROVIDER)</span>
            </p>
          )}
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="max-w-[90%] self-end rounded-lg rounded-br-none border border-obsidian-700 bg-obsidian-800 px-3 py-1.5 text-xs text-gray-200">
                <span className="block text-[10px] text-gray-400">Admin</span>
                {m.content}
              </div>
            ) : (
              <div key={i} className="max-w-[90%] self-start rounded-lg rounded-bl-none border border-tactical/40 bg-tactical/10 px-3 py-1.5 text-xs text-tactical">
                <span className="block text-[10px] text-tactical/70">AI Sentinel</span>
                {m.content}
              </div>
            ),
          )}
          {pending && (
            <div className="self-start text-xs text-tactical">
              <span className="inline-block h-3 w-1.5 animate-cursor bg-tactical align-middle" />
            </div>
          )}
        </div>

        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <div className="relative grow">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-tactical">&gt;</span>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about traffic or enter command..."
              aria-label="Ask the AI assistant"
              className="w-full rounded-lg border border-obsidian-700 bg-obsidian-950 py-2 pl-7 pr-3 text-xs text-white placeholder-gray-500 outline-none transition-colors focus:border-tactical focus:ring-1 focus:ring-tactical"
            />
          </div>
          <button
            type="submit"
            disabled={pending || !input.trim()}
            className="shrink-0 rounded-lg bg-tactical px-4 py-2 text-xs font-bold text-obsidian-950 shadow-[0_0_10px_rgba(0,255,136,0.3)] transition-all hover:bg-tactical-dim disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </div>
    </aside>
  );
}
