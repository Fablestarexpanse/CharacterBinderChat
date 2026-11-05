"use client";

// ─── The call screen ──────────────────────────────────────────────────────────
// A phone call, over the whole window: their portrait large, their name, and
// the state (calling them, the timer while connected). A call ringing for you
// shows on its chat's row in Recent Chats instead, with Answer and Decline. While
// connected their lines show as captions and you type back; voice can join
// later through the same screen. State and actions are lib/chat/calls.ts.

import { useEffect, useMemo, useRef, useState } from "react";
import { PhoneOff, Send } from "lucide-react";
import { useFableStore } from "@/lib/store";
import { useUiStore } from "@/lib/store/ui";
import { hangUp, sayOnCall } from "@/lib/chat/calls";
import { callLength } from "@/lib/chat/channel";
import { unlockSounds } from "@/lib/chat/sounds";
import { sizedSrc } from "@/lib/chat/assets";

/** Seconds since `from`, ticking once a second while mounted */
function useElapsed(from: number | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!from) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [from]);
  return from ? Math.max(0, (now - from) / 1000) : 0;
}

export function CallScreen() {
  const call = useUiStore((s) => s.call);
  const { characters, chats, isGenerating } = useFableStore();
  const character = characters.find((c) => c.id === call?.characterId);
  const chat = chats.find((c) => c.id === call?.chatId);
  const elapsed = useElapsed(call?.phase === "connected" ? call.connectedAt : undefined);
  const [draft, setDraft] = useState("");
  const captionsEnd = useRef<HTMLDivElement>(null);

  // The lines said on this call: everything on the call channel since it started
  const lines = useMemo(() => {
    if (!chat || call?.phase !== "connected") return [];
    const start = chat.messages.findLastIndex((m) => m.callEvent?.kind === "started");
    return chat.messages.slice(start + 1).filter((m) => m.channel === "call" && !m.callEvent);
  }, [chat, call?.phase]);

  useEffect(() => { captionsEnd.current?.scrollIntoView({ block: "end" }); }, [lines]);

  // Ringing shows on the chat's row in Recent Chats (Answer / Decline there), not over the screen
  if (!call || !character || call.phase === "incoming") return null;
  const picture = character.avatar ?? character.referenceImages?.[0];
  const portrait = picture ? sizedSrc(picture, 512) : undefined;
  const status = call.phase === "calling" ? "Calling…" : callLength(elapsed);

  const send = () => {
    if (!draft.trim()) return;
    void sayOnCall(draft);
    setDraft("");
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={`Phone call with ${character.name}`}
      className="fixed inset-0 z-50 flex flex-col items-center overflow-hidden bg-neutral-950 text-white" onPointerDown={unlockSounds}>
      {/* Their picture, blurred, fills the screen behind everything */}
      {portrait && (
        // eslint-disable-next-line @next/next/no-img-element -- a stored asset, blurred as a backdrop
        <img src={portrait} alt="" aria-hidden className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-2xl" />
      )}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/30 via-black/40 to-black/80" />

      <div className="relative flex w-full max-w-md flex-1 flex-col items-center px-6 pt-12 pb-8 min-h-0">
        <div className="rounded-full p-1 ring-2 ring-white/20">
          {portrait
            // eslint-disable-next-line @next/next/no-img-element -- a stored asset, resized by the server
            ? <img src={portrait} alt={character.name} className="h-36 w-36 rounded-full object-cover sm:h-44 sm:w-44" />
            : <div className="flex h-36 w-36 items-center justify-center rounded-full bg-white/15 text-5xl font-semibold sm:h-44 sm:w-44">{character.name.slice(0, 1)}</div>}
        </div>
        <div className="mt-5 text-2xl font-semibold tracking-tight">{character.name}</div>
        <div role="status" className="mt-1 text-sm text-white/75 tabular-nums">{status}</div>

        {/* Captions: what they say (and what you said) on this call */}
        {call.phase === "connected" && (
          <div className="mt-6 w-full flex-1 min-h-0 overflow-y-auto rounded-2xl bg-white/5 p-3 space-y-2" aria-label="Call captions" aria-live="polite">
            {lines.length === 0 && <div className="text-center text-xs text-white/60">{isGenerating ? `${character.name} is speaking…` : "Say something."}</div>}
            {lines.map((m) => (
              <div key={m.id} className={`text-sm leading-snug ${m.role === "user" ? "text-right text-white/70" : "text-white"}`}>
                {m.content || <span className="text-white/50">…</span>}
              </div>
            ))}
            <div ref={captionsEnd} />
          </div>
        )}
        {call.phase !== "connected" && <div className="flex-1" />}

        {call.phase === "connected" && (
          <form className="mt-3 flex w-full gap-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Say on the call" placeholder={`Talk to ${character.name}…`} autoFocus
              className="h-10 flex-1 min-w-0 rounded-full border border-white/20 bg-white/10 px-4 text-sm text-white placeholder:text-white/50 focus:border-white/60 focus:outline-none" />
            <button type="submit" disabled={!draft.trim() || isGenerating} aria-label="Say it"
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-white/20 disabled:opacity-40 cursor-pointer"><Send className="h-4 w-4" /></button>
          </form>
        )}

        <div className="mt-8 flex items-center justify-center gap-16">
          <RoundButton label="Hang up" color="bg-red-500 hover:bg-red-600" onClick={hangUp}><PhoneOff className="h-7 w-7" /></RoundButton>
        </div>
        {call.phase === "connected" && <div className="mt-3 text-[11px] text-white/50">Their words show as captions. Voice comes with a voice connection.</div>}
      </div>
    </div>
  );
}

function RoundButton({ label, color, onClick, children }: { label: string; color: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <button onClick={onClick} aria-label={label} className={`flex h-16 w-16 items-center justify-center rounded-full text-white shadow-lg transition-colors cursor-pointer ${color}`}>{children}</button>
      <span className="text-xs text-white/80">{label}</span>
    </div>
  );
}
