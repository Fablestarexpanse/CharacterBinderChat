"use client";

// ─── Peek Prompt ──────────────────────────────────────────────────────────────
// Shows the exact messages the model receives, in two views:
//   • Last sent  — what really went out for the latest reply (kept in memory)
//   • Live       — what WOULD go out right now, built by the same assemblePrompt
//                  that generation uses, so it cannot drift from the real thing
// For debugging memory: "was that fact actually in the prompt?" is answerable
// at a glance instead of by inference from the reply.

import { useEffect, useState } from "react";
import { getJson } from "@/lib/api/client";
import { Check, Copy, Eye, Loader2 } from "lucide-react";
import { useFableStore } from "@/lib/store";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { assemblePrompt, nextSpeakerId } from "@/lib/chat/generation";
import { estimateTokens } from "@/lib/chat/promptBuilder";
import { getSentPrompt, type SentPrompt } from "@/lib/chat/sentPrompts";

type View = "sent" | "live";

/** One result keyed by what was fetched, so `loading` is derived rather than
 *  set from inside the effect (react-hooks/set-state-in-effect). */
interface LiveResult { key: string; prompt: SentPrompt | null; error: string | null }

export function PeekPromptDialog({
  chatId, open, onOpenChange,
}: { chatId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const sent = getSentPrompt(chatId);
  const [view, setView] = useState<View>(sent ? "sent" : "live");
  const [nonce, setNonce] = useState(0);
  const [live, setLive] = useState<LiveResult | null>(null);
  const [copied, setCopied] = useState(false);
  // Edited behind-the-scenes prompts (memory, images): not part of this prompt,
  // but they shape what the memory holds, so say so here where people look.
  const [editedPrompts, setEditedPrompts] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    getJson<{ prompts: Array<{ title: string; override: string | null; overrideInvalid: boolean }> }>("/api/prompts")
      .then((r) => { if (!cancelled) setEditedPrompts(r.prompts.filter((p) => p.override !== null && !p.overrideInvalid).map((p) => p.title)); })
      .catch(() => { /* informational only */ });
    return () => { cancelled = true; };
  }, []);

  const liveKey = `${chatId}:${nonce}`;
  useEffect(() => {
    if (view !== "live") return;
    let cancelled = false;
    (async () => {
      let result: LiveResult;
      try {
        const st = useFableStore.getState();
        const chat = st.chats.find((c) => c.id === chatId);
        const a = chat ? await assemblePrompt(chatId, nextSpeakerId(chat, st.characters)) : null;
        result = a
          ? {
              key: liveKey, error: null,
              prompt: {
                messages: a.history, providerId: a.providerId, modelId: a.modelId,
                speakerName: a.speakerName, usedTokens: a.fit.usedTokens,
                contextMax: a.fit.contextMax, dropped: a.fit.dropped, sentAt: Date.now(),
              },
            }
          : { key: liveKey, prompt: null, error: "Chat not found" };
      } catch (e) {
        result = { key: liveKey, prompt: null, error: e instanceof Error ? e.message : String(e) };
      }
      if (!cancelled) setLive(result);
    })();
    return () => { cancelled = true; };
  }, [view, chatId, liveKey]);

  const loading = view === "live" && live?.key !== liveKey;
  const prompt = view === "sent" ? sent : live?.key === liveKey ? live.prompt : null;
  const error = view === "live" && live?.key === liveKey ? live.error : null;

  const copyAll = async () => {
    if (!prompt) return;
    const text = prompt.messages.map((m) => `### ${m.role}\n${m.content}`).join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked: nothing useful to do */ }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-5">
        <DialogTitle className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-[var(--purple-fg)]" />
          Peek prompt
        </DialogTitle>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div role="tablist" className="inline-flex rounded-lg border border-[var(--border)] overflow-hidden">
            {([["sent", "Last sent"], ["live", "Live preview"]] as const).map(([id, label]) => (
              <button
                key={id} role="tab" aria-selected={view === id}
                onClick={() => setView(id)}
                className={`px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors ${
                  view === id ? "bg-[var(--purple)] text-white" : "hover:bg-[var(--muted)] text-[var(--foreground)]"
                }`}
              >{label}</button>
            ))}
          </div>
          {view === "live" && (
            <Button variant="outline" size="sm" onClick={() => setNonce((n) => n + 1)} disabled={loading}>Refresh</Button>
          )}
          <Button variant="outline" size="sm" onClick={copyAll} disabled={!prompt} className="ml-auto">
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied" : "Copy all"}
          </Button>
        </div>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto space-y-2 text-xs">
          {loading && (
            <div className="flex items-center gap-2 text-[var(--muted-fg)]"><Loader2 className="h-3 w-3 animate-spin" /> Building prompt…</div>
          )}
          {error && <div className="text-red-500">Could not build the prompt — {error}</div>}
          {view === "sent" && !sent && (
            <div className="text-[var(--muted-fg)]">
              Nothing has been sent in this session yet. Sent prompts are kept in memory only, so they
              disappear on reload — use Live preview to see what would be sent now.
            </div>
          )}
          {prompt && (
            <>
              <div className="rounded-lg bg-[var(--muted)] px-3 py-2 text-[var(--muted-fg)] leading-relaxed">
                <span className="text-[var(--foreground)] font-medium">{prompt.providerId} · {prompt.modelId}</span>
                {prompt.speakerName && <> · speaking as {prompt.speakerName}</>}
                <br />
                ~{prompt.usedTokens.toLocaleString()} / {prompt.contextMax.toLocaleString()} tokens
                {prompt.dropped > 0 && <> · {prompt.dropped} oldest message{prompt.dropped === 1 ? "" : "s"} dropped to fit</>}
                {view === "sent" && <> · sent {new Date(prompt.sentAt).toLocaleTimeString()}</>}
              </div>
              {editedPrompts.length > 0 && (
                <div className="rounded-lg border border-[var(--purple)] px-3 py-2 text-[11px] text-[var(--purple-fg)]">
                  Edited prompts in use behind the scenes: {editedPrompts.join(", ")}. Change or reset them in Settings → Prompts.
                </div>
              )}
              {prompt.messages.map((m, i) => (
                <details key={i} open={m.role === "system"} className="rounded-lg border border-[var(--border)]">
                  <summary className="cursor-pointer select-none px-3 py-1.5 flex items-center gap-2 text-[11px]">
                    <span className="font-semibold uppercase tracking-wider text-[var(--purple-fg)]">{m.role}</span>
                    <span className="text-[var(--muted-fg)]">~{estimateTokens(m.content).toLocaleString()} tokens</span>
                  </summary>
                  <pre className="px-3 pb-3 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-[var(--foreground)]">{m.content}</pre>
                </details>
              ))}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
