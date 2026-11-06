"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
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
  Smartphone,
  Camera,
  Paperclip,
  X,
} from "lucide-react";
import { sendPicture } from "@/lib/chat/userPictures";
import { askForPhoto, contactSettings } from "@/lib/chat/photos";
import { useUiStore } from "@/lib/store/ui";

export function ChatInput() {
  const { activeChatId, chats, characters, personas, activePersonaId, setActivePersona, addMessage, isGenerating: writing } = useFableStore();
  // A picture you sent is still uploading or being read: the composer waits as it does for a reply
  const sendingPicture = useUiStore((s) => s.sendingPicture);
  const isGenerating = writing || sendingPicture;
  const { inputValue, setInputValue, setActiveSection, textModeChats, setTextMode } = useUiStore();
  const textMode = !!(activeChatId && textModeChats[activeChatId]);

  const activePersona = personas.find((p) => p.id === activePersonaId);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Group chats: who replies next. null = auto (name-mention, else round-robin)
  const [nextSpeaker, setNextSpeaker] = useState<string | null>(null);
  const chat = chats.find((c) => c.id === activeChatId);
  // "Ask for a photo": a small row above the box. null = closed; the string is what you asked for.
  const [photoAsk, setPhotoAsk] = useState<{ open: boolean; what: string; allowed: boolean | null }>({ open: false, what: "", allowed: null });
  const photoFrom = characters.find((c) => c.id === (nextSpeaker ?? chat?.characterId));
  const activeCharacterName = photoFrom?.name;
  const openPhotoAsk = async () => {
    if (photoAsk.open) { setPhotoAsk({ open: false, what: "", allowed: null }); return; }
    setPhotoAsk({ open: true, what: "", allowed: null });
    const s = await contactSettings();
    setPhotoAsk((p) => ({ ...p, allowed: s.enabled }));
  };
  const sendPhotoAsk = () => {
    if (!activeChatId || !photoFrom) return;
    void askForPhoto(activeChatId, photoFrom, photoAsk.what, textMode ? "text" : "scene");
    setPhotoAsk({ open: false, what: "", allowed: null });
  };
  const present = chat ? presentMemberIds(chat) : [];
  const isGroup = present.length >= 2;

  // /image: the scene director is reading the chat and writing a visual prompt
  const [directing, setDirecting] = useState(false);

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

    addMessage(activeChatId, { chatId: activeChatId, role: "user", content: userContent, ...(textMode ? { channel: "text" as const } : {}) });
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

  // ── A picture you send ────────────────────────────────────────────────────
  // Picked, pasted or dropped: shown above the box until you send (with or
  // without words) or take it off. It is read by the picture reader before
  // the character answers (lib/chat/userPictures.ts).
  // Staged for one chat: switching chats does not carry it into another conversation
  const [staged, setPicture] = useState<{ chatId: string; file: File; preview: string } | null>(null);
  const picture = staged && staged.chatId === activeChatId ? staged : null;
  // Each preview address is released when it is replaced, taken off, or the box goes away
  useEffect(() => {
    const url = staged?.preview;
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [staged]);
  const [pictureError, setPictureError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const takePicture = (file: File | undefined | null) => {
    if (!file || !file.type.startsWith("image/") || !activeChatId) return;
    setPicture({ chatId: activeChatId, file, preview: URL.createObjectURL(file) });
    setPictureError(null);
  };
  const dropPicture = () => setPicture(null);
  const sendWithPicture = async () => {
    if (!picture || !activeChatId || isGenerating || !activePersona) return;
    const text = inputValue.trim();
    const file = picture.file;
    dropPicture();
    setInputValue("");
    try {
      await sendPicture(activeChatId, file, text, textMode ? "text" : "scene", nextSpeaker ?? undefined);
    } catch (e) {
      setPictureError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (picture) void sendWithPicture(); else handleSend();
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
                  className="flex items-center gap-1.5 rounded-full bg-[var(--card)] pl-1 pr-3 py-1 text-xs text-[var(--foreground)] border border-[var(--border)] hover:border-[var(--purple)] transition-colors cursor-pointer"
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
      {photoAsk.open && (
        <div role="group" aria-label="Ask for a photo" className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2">
          {photoAsk.allowed === null ? <span className="text-xs text-[var(--muted-fg)]">…</span>
            : !photoAsk.allowed ? (
              <>
                <span className="text-xs text-[var(--muted-fg)] flex-1">Photos are off. Turn on Contact &amp; media in Settings to ask for one.</span>
                <Button variant="outline" size="sm" onClick={() => { setPhotoAsk({ open: false, what: "", allowed: null }); useUiStore.getState().setSettingsTab("contact"); setActiveSection("settings"); }}>Open Settings</Button>
              </>
            ) : (
              <>
                <Camera className="h-3.5 w-3.5 text-[var(--purple-fg)]" />
                <input autoFocus value={photoAsk.what} onChange={(e) => setPhotoAsk((p) => ({ ...p, what: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") sendPhotoAsk(); if (e.key === "Escape") setPhotoAsk({ open: false, what: "", allowed: null }); }}
                  placeholder={`A photo from ${photoFrom?.name ?? "them"} of… (optional)`} aria-label="What the photo shows"
                  className="h-8 flex-1 min-w-[10rem] rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 text-xs" />
                <Button variant="purple" size="sm" onClick={sendPhotoAsk} disabled={!photoFrom}>Ask</Button>
              </>
            )}
        </div>
      )}
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
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }}
        onDrop={(e) => {
          const f = [...e.dataTransfer.files].find((x) => x.type.startsWith("image/"));
          // Only a picture dropped on the box is taken here; card files go to the window-wide importer
          if (f) { e.preventDefault(); e.stopPropagation(); takePicture(f); }
        }}
        className={`flex flex-col gap-2 rounded-2xl border bg-[var(--card)] p-2 transition-colors ${
          isImageCommand ? "border-[var(--purple)]" : "border-[var(--border)]"
        } focus-within:border-[var(--purple)] focus-within:ring-1 focus-within:ring-[var(--purple)]`}
      >
        {picture && (
          <div className="flex items-center gap-2 px-1">
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the file you picked */}
              <img src={picture.preview} alt="Picture to send" className="h-16 w-16 rounded-lg border border-[var(--border)] object-cover" />
              <button onClick={dropPicture} aria-label="Remove picture" title="Remove"
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--foreground)] text-[var(--card)] cursor-pointer"><X className="h-3 w-3" /></button>
            </div>
            <span className="text-[11px] text-[var(--muted-fg)]">Add words if you like, then send. {activeCharacterName ?? "They"} will see it.</span>
          </div>
        )}
        {pictureError && <div role="alert" className="px-1 text-[11px] text-red-600">The picture was not sent: {pictureError}</div>}
        <textarea
          ref={textareaRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onPaste={(e) => {
            const f = [...e.clipboardData.files].find((x) => x.type.startsWith("image/"));
            if (f) { e.preventDefault(); takePicture(f); }
          }}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder={
            sendingPicture
              ? "Sending your picture…"
              : isGenerating
              ? "Generating response…"
              : textMode ? "Text message…" : "Message… (try /image a cyberpunk alley at night)"
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
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" aria-label="Picture to send"
              onChange={(e) => { takePicture(e.target.files?.[0]); e.target.value = ""; }} />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title="Send a picture (or paste or drop one in the box)"
              aria-label="Send a picture"
              onClick={() => fileRef.current?.click()}
            >
              <Paperclip className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={`h-7 w-7 ${photoAsk.open ? "bg-[var(--purple-light)] text-[var(--purple-fg)]" : ""}`}
              title={`Ask ${photoFrom?.name ?? "them"} for a photo`}
              aria-label="Ask for a photo"
              onClick={openPhotoAsk}
            >
              <Camera className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={`h-7 w-7 ${textMode ? "bg-[var(--purple-light)] text-[var(--purple-fg)]" : ""}`}
              title={textMode ? "Sending texts: you and the character are apart. Click to talk in person" : "Talk in person. Click to send texts instead, as if by phone"}
              aria-pressed={textMode}
              aria-label="Send as text message"
              onClick={() => activeChatId && setTextMode(activeChatId, !textMode)}
            >
              <Smartphone className="h-3.5 w-3.5" />
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
            onClick={writing ? stopGeneration : picture ? () => void sendWithPicture() : handleSend}
            disabled={sendingPicture || (!writing && !inputValue.trim() && !picture)}
            title={sendingPicture ? "Sending your picture…" : writing ? "Stop generating" : "Send (Enter)"}
          >
            {writing
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
