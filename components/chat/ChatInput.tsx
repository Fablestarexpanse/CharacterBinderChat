"use client";

import { useRef, useEffect, useState, type KeyboardEvent } from "react";
import { useFableStore } from "@/lib/store";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { generateSceneImage } from "@/lib/chat/imageGen";
import {
  generateAssistantReply,
  stopGeneration,
  presentMemberIds,
  flushPendingExtraction,
} from "@/lib/chat/generation";
import {
  ImageIcon,
  BookOpen,
  Send,
  Square,
  Wand2,
} from "lucide-react";
import { useUiStore } from "@/lib/store/ui";
import { sendJson } from "@/lib/api/client";

export function ChatInput() {
  const { activeChatId, chats, characters, personas, activePersonaId, setActivePersona, addMessage, isGenerating } = useFableStore();
  const { inputValue, setInputValue, setActiveSection } = useUiStore();

  const activePersona = personas.find((p) => p.id === activePersonaId);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Group chats: who replies next. null = auto (name-mention, else round-robin)
  const [nextSpeaker, setNextSpeaker] = useState<string | null>(null);
  const chat = chats.find((c) => c.id === activeChatId);
  const present = chat ? presentMemberIds(chat) : [];
  const isGroup = present.length >= 2;

  // /image: the scene director is reading the chat and writing a visual prompt
  const [directing, setDirecting] = useState(false);

  // ── Lazy stat decay ────────────────────────────────────────────────────────
  // On the first render of this component (i.e. first session), apply
  // Ebbinghaus decay once. The server computes decay per-row from each stat's
  // own last_updated timestamp; this just decides whether a new session began.
  useEffect(() => {
    const LAST_SESSION_KEY = "fablechat:lastSessionAt";
    const now = Date.now();
    const lastStr = localStorage.getItem(LAST_SESSION_KEY);
    localStorage.setItem(LAST_SESSION_KEY, String(now));

    if (!lastStr) return; // first ever session — nothing to decay yet
    if (now - Number(lastStr) < 15 * 60 * 1000) return; // same sitting, skip

    // Fire-and-forget by design — nothing waits on decay — but through
    // sendJson so a rejected request is a warning rather than a success: the
    // bare fetch only caught network errors, so a 500 looked like it worked.
    sendJson("POST", "/api/drawer/stats/decay")
      .catch((e: Error) => console.warn("[decay]", e.message));
  }, []);

  // ── Send handler ──────────────────────────────────────────────────────────

  const handleSend = async () => {
    if (!inputValue.trim() || !activeChatId || isGenerating || !activePersona) return;

    const userContent = inputValue.trim();
    setInputValue("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    // /image command — bare "/image" snapshots the current scene; any text
    // after it becomes focus guidance for the scene director
    if (userContent === "/image" || userContent.startsWith("/image ")) {
      await handleImageGeneration(userContent.slice(6).trim());
      return;
    }

    // Replying settles the previous exchange: the reply survived, so its
    // memory can be written now (re-rolling instead would have cancelled it).
    flushPendingExtraction();

    addMessage(activeChatId, { chatId: activeChatId, role: "user", content: userContent });
    generateAssistantReply(activeChatId, nextSpeaker ?? undefined);
  };

  // Group scene: tap a character with an empty input to have them speak now
  const handleSpeakerTap = (id: string) => {
    if (!activeChatId || isGenerating) return;
    if (!inputValue.trim()) {
      generateAssistantReply(activeChatId, id);
    } else {
      setNextSpeaker((prev) => (prev === id ? null : id));
    }
  };

  // ── Image generation ──────────────────────────────────────────────────────
  // Scene director + ComfyUI queueing live in lib/chat/imageGen.ts (shared
  // with the per-message generate button). Any text after /image steers the
  // shot; failures are logged, not silently swallowed into an empty render.

  const handleImageGeneration = async (focus: string) => {
    if (!activeChatId || !chat) return;
    try {
      const result = await generateSceneImage(activeChatId, {
        focus: focus || undefined,
        onPhase: (phase) => setDirecting(phase === "directing"),
      });
      if (!result.ok) console.warn("[/image] scene director failed:", result.error);
    } finally {
      setDirecting(false);
    }
  };

  // ── Keyboard / resize ─────────────────────────────────────────────────────

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  };

  const isImageCommand = inputValue === "/image" || inputValue.startsWith("/image ");

  // ── Render ────────────────────────────────────────────────────────────────

  // RP needs an identity: no persona, no chatting. Offer the existing
  // personas as one-tap chips; otherwise point at the creator.
  if (!activePersona) {
    return (
      <div className="px-4 pb-4 pt-2 flex-shrink-0">
        <div className="rounded-2xl border border-[var(--purple)] bg-[var(--purple-light)] p-4 space-y-2">
          <div className="text-sm font-semibold text-[var(--purple-fg)]">Who are you in this story?</div>
          <div className="text-xs text-[var(--purple-fg)] opacity-80">
            Pick a persona before chatting — the character remembers <em>you</em>, and memory needs to know who that is.
          </div>
          {personas.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {personas.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setActivePersona(p.id)}
                  className="flex items-center gap-1.5 rounded-full bg-white pl-1 pr-3 py-1 text-xs text-[var(--foreground)] border border-[var(--border)] hover:border-[var(--purple)] transition-colors cursor-pointer"
                >
                  <Avatar name={p.name} src={p.avatar} size="xs" />
                  {p.name}
                </button>
              ))}
            </div>
          ) : (
            <Button size="sm" className="mt-1" onClick={() => setActiveSection("characters")}>
              Create a persona
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pb-4 pt-2 flex-shrink-0">
      {/* Group scene: pick who replies (tap with empty input = speak now) */}
      {isGroup && (
        <div className="flex items-center gap-1.5 mb-2 px-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-fg)]">
            Reply:
          </span>
          <button
            onClick={() => setNextSpeaker(null)}
            className={`rounded-full px-2 py-0.5 text-[11px] transition-colors cursor-pointer ${
              nextSpeaker === null
                ? "bg-[var(--purple)] text-white"
                : "bg-[var(--muted)] text-[var(--muted-fg)] hover:text-[var(--foreground)]"
            }`}
          >
            Auto
          </button>
          {present.map((id) => {
            const m = characters.find((c) => c.id === id);
            if (!m) return null;
            return (
              <button
                key={id}
                onClick={() => handleSpeakerTap(id)}
                disabled={isGenerating}
                title={inputValue.trim() ? `${m.name} replies to your message` : `${m.name} speaks now`}
                className={`flex items-center gap-1 rounded-full pl-0.5 pr-2 py-0.5 text-[11px] transition-colors cursor-pointer ${
                  nextSpeaker === id
                    ? "bg-[var(--purple-light)] text-[var(--purple-fg)] ring-1 ring-[var(--purple)]"
                    : "bg-[var(--muted)] text-[var(--muted-fg)] hover:text-[var(--foreground)]"
                }`}
              >
                <Avatar name={m.name} src={m.avatar} size="xs" />
                {m.name}
              </button>
            );
          })}
        </div>
      )}

      {(isImageCommand || directing) && (
        <div className="flex items-center gap-2 mb-2 px-1">
          {directing ? (
            <>
              <div className="h-3 w-3 rounded-full border-2 border-[var(--purple)] border-t-transparent animate-spin" />
              <span className="text-xs text-[var(--purple-fg)]">
                Reading the scene and directing the shot…
              </span>
            </>
          ) : (
            <>
              <Wand2 className="h-3.5 w-3.5 text-[var(--purple-fg)]" />
              <span className="text-xs text-[var(--purple-fg)]">
                Image — Enter snapshots the current scene; add words to steer the shot
              </span>
            </>
          )}
        </div>
      )}

      <div
        className={`flex flex-col gap-2 rounded-2xl border bg-white p-2 transition-colors ${
          isImageCommand ? "border-[var(--purple)]" : "border-[var(--border)]"
        } focus-within:border-[var(--purple)] focus-within:ring-1 focus-within:ring-[var(--purple)]`}
      >
        <textarea
          ref={textareaRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder={
            isGenerating
              ? "Generating response…"
              : "Message… (try /image a cyberpunk alley at night)"
          }
          disabled={isGenerating}
          rows={1}
          className="w-full resize-none bg-transparent px-2 py-1 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-fg)] focus:outline-none disabled:opacity-50"
          style={{ minHeight: "36px", maxHeight: "160px" }}
        />

        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title="Generate image (/image)"
              onClick={() => setInputValue("/image ")}
            >
              <ImageIcon className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title="Edit lorebooks"
              onClick={() => setActiveSection("lorebooks")}
            >
              <BookOpen className="h-3.5 w-3.5" />
            </Button>
          </div>

          <Button
            variant="purple"
            size="icon"
            className="h-8 w-8 rounded-xl"
            onClick={isGenerating ? stopGeneration : handleSend}
            disabled={!isGenerating && !inputValue.trim()}
            title={isGenerating ? "Stop generating" : "Send (Enter)"}
          >
            {isGenerating
              ? <Square className="h-3.5 w-3.5" />
              : <Send   className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      <div className="text-center mt-1.5">
        <span className="text-[10px] text-[var(--muted-fg)]">
          Shift+Enter for new line · /image to generate · FableChat v0.1
        </span>
      </div>
    </div>
  );
}
