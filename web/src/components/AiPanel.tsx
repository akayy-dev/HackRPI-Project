"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AiSummary, SuggestedAction } from "@/lib/types";
import type { TriageResponse } from "@/lib/ai/triageService";
import { SectionTitle } from "./ui";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

const TRIAGE_POLL_MS = 60_000;

const QUICK_PROMPTS = [
  "Explain the top threat",
  "Which IPs should I block and why?",
];

const perMinLabel = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`);

function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
}

export default function AiPanel({
  summary: initialSummary,
  activeActionId = null,
  onAction,
}: {
  summary: AiSummary;
  activeActionId?: string | null;
  onAction?: (a: SuggestedAction) => void;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [triage, setTriage] = useState<TriageResponse | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const scrollRef = useRef<HTMLDivElement>(null);
  const summary = triage?.summary ?? initialSummary;

  const loadTriage = useCallback(async (refresh = false) => {
    setAnalyzing(true);
    try {
      const res = await fetch(`/api/triage${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as TriageResponse;
        setTriage(data);
        setConfigured((c) => c ?? data.configured);
      }
    } catch {
      // keep the last good summary
    } finally {
      setAnalyzing(false);
    }
  }, []);

  useEffect(() => {
    loadTriage();
    const poll = setInterval(() => loadTriage(), TRIAGE_POLL_MS);
    const clock = setInterval(() => setNow(Date.now()), 10_000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [loadTriage]);

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
    <aside className="flex flex-col gap-4 rounded-xl border border-obsidian-700 bg-obsidian-900 p-4 shadow-2xl sm:p-5 lg:col-span-4 lg:h-0 lg:min-h-full lg:overflow-hidden" data-purpose="ai-summary-helper">
      <div className="flex items-center justify-between gap-2 border-b border-obsidian-800 pb-3">
        <SectionTitle>AI summary &amp; helper</SectionTitle>
        <div className="flex shrink-0 items-center gap-2">
          {triage && (
            <span
              title={triage.error ?? `Analyzed ${new Date(triage.analyzedAt).toLocaleTimeString()}`}
              className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                triage.source === "heuristic" ? "border-obsidian-700 text-gray-400" : "border-tactical/50 text-tactical"
              }`}
              data-testid="triage-source"
            >
              {triage.source === "heuristic" ? "Heuristic" : `Grok · ${ago(triage.analyzedAt, now)}`}
            </span>
          )}
          <button
            type="button"
            onClick={() => loadTriage(true)}
            disabled={analyzing}
            className="rounded border border-tactical/60 px-2 py-0.5 text-[10px] font-semibold text-tactical transition-all hover:bg-tactical/15 disabled:opacity-50"
          >
            {analyzing ? "Analyzing…" : "Re-analyze"}
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="space-y-2.5 rounded-lg border border-obsidian-800 bg-obsidian-950/80 p-3.5">
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="rounded border border-obsidian-800 bg-obsidian-900 p-2">
            <div className="text-[10px] text-gray-400">TRAFFIC</div>
            <div className="font-bold text-white">
              {perMinLabel(summary.trafficPerMin)}/min{" "}
              <span className={`text-[10px] ${summary.trafficStatus === "NORMAL" ? "text-tactical" : "text-threat"}`}>{summary.trafficStatus}</span>
            </div>
          </div>
          <div className={`rounded border p-2 ${summary.activeAnomaly ? "border-threat/40 bg-threat/10" : "border-obsidian-800 bg-obsidian-900"}`}>
            <div className="text-[10px] text-gray-400">ANOMALIES</div>
            <div className={`font-bold ${summary.activeAnomaly ? "text-threat" : "text-tactical"}`}>
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
            <button
              type="button"
              onClick={() => onAction?.(a)}
              aria-pressed={activeActionId === a.id}
              title={activeActionId === a.id ? "Clear focus" : `Focus the map and log on ${a.target}`}
              className={
                activeActionId === a.id
                  ? "shrink-0 whitespace-nowrap rounded bg-white px-3 py-1 text-xs font-bold text-obsidian-950 transition-all"
                  : a.variant === "primary"
                    ? "shrink-0 whitespace-nowrap rounded bg-tactical px-3 py-1 text-xs font-bold text-obsidian-950 transition-all hover:bg-tactical-dim"
                    : "shrink-0 whitespace-nowrap rounded border border-tactical/60 px-3 py-1 text-xs font-semibold text-tactical transition-all hover:bg-tactical/15"
              }
            >
              {a.actionLabel}
            </button>
          </div>
        ))}
      </div>

      {/* Chat */}
      <div className="mt-auto flex min-h-0 flex-1 flex-col gap-2.5">
        <div ref={scrollRef} className="flex max-h-56 min-h-24 flex-1 flex-col lg:max-h-none gap-2 overflow-y-auto rounded-lg border border-dashed border-obsidian-700 bg-obsidian-950 p-3">
          {messages.length === 0 && (
            <p className="m-auto text-center text-[11px] text-gray-500">
              AI Sentinel {configured === false ? "not configured" : "ready"} — ask about traffic.
              <br />
              <span className="text-gray-600">
                {configured === false ? "(set AI_PROVIDER=grok + XAI_API_KEY)" : "(powered by Grok)"}
              </span>
            </p>
          )}
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="max-w-[90%] self-end rounded-lg rounded-br-none border border-obsidian-700 bg-obsidian-800 px-3 py-1.5 text-xs text-gray-200">
                <span className="block text-[10px] text-gray-400">Admin</span>
                {m.content}
              </div>
            ) : (
              <div key={i} className="max-w-[90%] self-start rounded-lg rounded-bl-none border border-tactical/40 bg-tactical/10 px-3 py-1.5 whitespace-pre-line break-words text-xs text-tactical">
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

        <div className="flex flex-wrap gap-1.5">
          {QUICK_PROMPTS.map((p) => (
            <button
              key={p}
              type="button"
              disabled={pending}
              onClick={() => send(p)}
              className="rounded-full border border-obsidian-700 bg-obsidian-950 px-2.5 py-1 text-[10px] text-gray-300 transition-colors hover:border-tactical/60 hover:text-tactical disabled:opacity-50"
            >
              {p}
            </button>
          ))}
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
            className="shrink-0 rounded-lg bg-tactical px-4 py-2 text-xs font-bold text-obsidian-950 transition-all hover:bg-tactical-dim disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </div>
    </aside>
  );
}
