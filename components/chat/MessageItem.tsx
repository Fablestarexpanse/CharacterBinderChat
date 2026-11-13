"use client";

import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useFableStore } from "@/lib/store";
import { callLength } from "@/lib/chat/channel";
import { useUiStore } from "@/lib/store/ui";
import { branchChat } from "@/lib/chat/branch";
import { regenerateLastReply } from "@/lib/chat/generation";
import { generateSceneImage } from "@/lib/chat/imageGen";
import { ImageCard } from "@/components/chat/ImageCard";
import { Attachments } from "@/components/chat/Attachments";
import { formatTime } from "@/lib/utils";
import type { Message, MemoryTrace } from "@/lib/types";
import { Copy, Pencil, RefreshCw, ThumbsUp, ThumbsDown, Check, X, ImagePlus, Brain, GitBranch, Clock, Loader2, Phone, PhoneMissed, PhoneOff, Volume2, Square } from "lucide-react";
import { playMessage, spokenText, stopSpeaking } from "@/lib/chat/speech";

interface MessageItemProps {
  message: Message;
}

function renderContent(content: string) {
  // Handle **bold**, *italic*, and _italic_
  const parts = content.split(/(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if ((part.startsWith("*") && part.endsWith("*")) || (part.startsWith("_") && part.endsWith("_"))) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return <span key={i}>{part}</span>;
  });
}

export function MessageItem({ message }: MessageItemProps) {
  const { characters, chats, personas, activePersonaId, isGenerating, rateMessage, updateMessageContent } =
    useFableStore();
  const [copied, setCopied] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [imagining, setImagining] = useState(false);

  const isUser = message.role === "user";
  const isText = message.channel === "text";
  const isCall = message.channel === "call";
  const openCharacterEditor = useUiStore((s) => s.openCharacterEditor);
  const character = characters.find((c) => c.id === message.characterId);
  // The user speaks AS their persona — show its name and portrait, not "You"
  const persona = isUser ? personas.find((p) => p.id === activePersonaId) : undefined;
  const displayName = isUser ? persona?.name ?? "You" : character?.name ?? "Assistant";
  const avatarSrc = isUser ? persona?.avatar : character?.avatar;

  // Regenerate only applies to the newest message in the chat
  const chat = chats.find((c) => c.id === message.chatId);
  const isLastMessage = chat?.messages[chat.messages.length - 1]?.id === message.id;

  // Playing this reply in its writer's voice (lib/chat/speech.ts)
  const speaking = useUiStore((s) => (s.speaking?.messageId === message.id ? s.speaking : null));
  const [speakError, setSpeakError] = useState<string | null>(null);
  const speakerName = character ? `${character.name}'s` : undefined;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const startEdit = () => {
    setDraft(message.content);
    setEditing(true);
  };
  const saveEdit = () => {
    const next = draft.trim();
    if (next && next !== message.content) {
      updateMessageContent(message.chatId, message.id, next);
    }
    setEditing(false);
  };

  // "Generate image of this scene" — director runs on the story up to THIS
  // message; the card lands directly after it even mid-history.
  const handleSceneImage = async () => {
    if (imagining) return;
    setImagining(true);
    setSpeakError(null);
    try {
      // A failure is shown under the message, not only in the console (the button looked dead)
      const r = await generateSceneImage(message.chatId, { uptoMessageId: message.id });
      if (!r.ok) setSpeakError(`No picture: ${r.error ?? "the scene director failed"}`);
    } finally {
      setImagining(false);
    }
  };

  // Image card message
  if (message.imageJobId) {
    return <ImageCard message={message} />;
  }

  // A call starting, ending or being missed: one centred line, like a phone's log
  if (message.callEvent) {
    const e = message.callEvent;
    const who = character?.name ?? "them";
    const label = e.kind === "started" ? (isUser ? `You called ${who}` : `${who} called`)
      : e.kind === "ended" ? `Call · ${callLength(e.seconds ?? 0)}`
      : e.kind === "missed" ? (isUser ? `${who} didn't pick up` : `Missed call from ${who}`)
      : `You declined ${who}'s call`;
    const Icon = e.kind === "missed" || e.kind === "declined" ? PhoneMissed : e.kind === "ended" ? PhoneOff : Phone;
    return (
      <div role="note" className="flex items-center justify-center gap-1.5 py-2 text-[11px] text-[var(--muted-fg)]">
        <Icon className={`h-3.5 w-3.5 ${e.kind === "missed" || e.kind === "declined" ? "text-red-500" : "text-green-500"}`} />
        <span className="font-medium">{label}</span>
        <span>· {formatTime(message.timestamp)}</span>
      </div>
    );
  }

  // Texts read like a phone: no name over each bubble, "Delivered" under your newest
  const lastUserText = isText && isUser && chat?.messages.findLast((m) => m.role === "user")?.id === message.id;

  return (
    <div
      className={`group flex gap-3 px-4 py-3 hover:bg-[var(--muted)] transition-colors rounded-xl mx-2 ${
        isUser ? "flex-row-reverse" : ""
      }`}
    >
      <Avatar name={displayName} src={avatarSrc} size="sm" className="mt-0.5 flex-shrink-0" />

      <div className={`flex-1 min-w-0 space-y-1 ${isUser ? "items-end" : "items-start"} flex flex-col`}>
        <div className="flex items-baseline gap-2">
          {!isText && <span className="text-xs font-semibold text-[var(--foreground)]">{displayName}</span>}
          <span className="text-[10px] text-[var(--muted-fg)]">{formatTime(message.timestamp)}</span>
        </div>

        {editing ? (
          <div className="w-full max-w-2xl space-y-1.5">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveEdit();
                if (e.key === "Escape") setEditing(false);
              }}
              rows={Math.min(12, Math.max(3, draft.split("\n").length + 1))}
              autoFocus
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--purple)] resize-y"
            />
            <div className="flex items-center gap-1.5">
              <Button size="sm" className="h-7 text-[11px]" onClick={saveEdit} disabled={!draft.trim()}>
                <Check className="h-3 w-3 mr-1" />
                Save
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={() => setEditing(false)}>
                <X className="h-3 w-3 mr-1" />
                Cancel
              </Button>
              <span className="text-[10px] text-[var(--muted-fg)]">Ctrl+Enter to save · Esc to cancel</span>
            </div>
          </div>
        ) : (
        <>
        {isCall && (
          <span className="inline-flex items-center gap-1 text-[10px] text-[var(--muted-fg)]" title="Said on a phone call in the story">
            <Phone className="h-3 w-3 text-green-500" />on the call
          </span>
        )}
        {(message.content.length > 0 || !message.attachments?.length) && (
        <div
          className={`prose-chat text-sm text-[var(--foreground)] max-w-2xl ${
            isText
              // A phone's texts: yours green on the right, theirs gray on the left, each with a tail corner
              ? `px-3.5 py-2 rounded-[20px] ${isUser
                ? "bg-[#34C759] text-white rounded-br-[6px] [&_*]:text-white"
                : "bg-[#E9E9EB] text-black rounded-bl-[6px] dark:bg-[#3A3A3C] dark:text-white"}`
              : isUser
              ? "bg-[var(--purple-light)] text-[var(--purple-fg)] px-3 py-2 rounded-2xl rounded-tr-sm"
              : ""
          }`}
        >
          {message.content.length === 0 ? (
            /* Typing / streaming indicator */
            <span className="flex items-center gap-1 text-[var(--muted-fg)]">
              <span className={`h-2 w-2 rounded-full opacity-60 animate-bounce [animation-delay:-0.3s] ${isText ? "bg-gray-500" : "bg-[var(--purple)]"}`} />
              <span className={`h-2 w-2 rounded-full opacity-60 animate-bounce [animation-delay:-0.15s] ${isText ? "bg-gray-500" : "bg-[var(--purple)]"}`} />
              <span className={`h-2 w-2 rounded-full opacity-60 animate-bounce ${isText ? "bg-gray-500" : "bg-[var(--purple)]"}`} />
            </span>
          ) : (
            message.content.split("\n\n").map((para, i) => (
              <p key={i}>{renderContent(para)}</p>
            ))
          )}
        </div>
        )}
        {message.attachments && message.attachments.length > 0 && <Attachments message={message} />}
        {lastUserText && <span className="text-[10px] font-medium text-[var(--muted-fg)]">Delivered</span>}
        </>
        )}

        {message.outreach && (
          <div className="text-[10px] text-[var(--muted-fg)]">
            {displayName} reached out because {message.outreach.reason}.{" "}
            {message.characterId && (
              <button className="underline cursor-pointer hover:text-[var(--foreground)]" onClick={() => openCharacterEditor(message.characterId!)}
                title="Change whether and when they may contact you">Change</button>
            )}
          </div>
        )}

        {speakError && (
          <div role="alert" className="text-[10px] text-red-500">
            {speakError}{" "}
            <button className="underline cursor-pointer" onClick={() => setSpeakError(null)}>Dismiss</button>
          </div>
        )}

        {/* Action buttons: on hover with a mouse; always shown on a touch screen, which has no hover */}
        {!editing && (
        <div className={`flex flex-wrap items-center gap-0.5 transition-opacity ${speaking ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"}`}>
          {!isUser && !message.error && !message.callEvent && spokenText(message) && (
            <Button variant="ghost" size="icon" className="h-6 w-6"
              title={speaking?.phase === "making" ? "Making the audio… (click to cancel)" : speaking ? "Stop" : `Play in ${speakerName ?? "their"} voice`}
              aria-label={speaking ? "Stop playing" : "Play this reply"}
              onClick={() => {
                if (speaking) { stopSpeaking(); return; }
                setSpeakError(null);
                void playMessage(message.chatId, message.id).catch((e: unknown) => setSpeakError(e instanceof Error ? e.message : String(e)));
              }}>
              {speaking?.phase === "making" ? <Loader2 className="h-3 w-3 animate-spin text-[var(--purple-fg)]" />
                : speaking ? <Square className="h-3 w-3 text-[var(--purple-fg)]" /> : <Volume2 className="h-3 w-3" />}
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCopy} title="Copy">
            {copied ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" title="Edit message" onClick={startEdit}>
            <Pencil className="h-3 w-3" />
          </Button>
          {!isUser && isLastMessage && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              title="Regenerate"
              disabled={isGenerating}
              onClick={() => regenerateLastReply(message.chatId)}
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            title="Branch from here — new chat with the story and memory as of this message"
            disabled={isGenerating || message.error}
            onClick={() => { void branchChat(message.chatId, message.id); }}
          >
            <GitBranch className="h-3 w-3" />
          </Button>
          {!isUser && message.memoryTrace && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              title="What memory shaped this reply"
              onClick={() => setTraceOpen(true)}
            >
              <Brain className="h-3 w-3" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className={`h-6 w-6 ${message.rating === "up" ? "text-green-600" : ""}`}
            onClick={() => rateMessage(message.chatId, message.id, message.rating === "up" ? undefined : "up")}
            title="Good response"
          >
            <ThumbsUp className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={`h-6 w-6 ${message.rating === "down" ? "text-red-500" : ""}`}
            onClick={() => rateMessage(message.chatId, message.id, message.rating === "down" ? undefined : "down")}
            title="Bad response"
          >
            <ThumbsDown className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            title="Generate an image of this scene (placed right after this message)"
            disabled={imagining}
            onClick={handleSceneImage}
          >
            {imagining ? (
              <Loader2 className="h-3 w-3 animate-spin text-[var(--purple-fg)]" />
            ) : (
              <ImagePlus className="h-3 w-3" />
            )}
          </Button>
        </div>
        )}
      </div>

      {message.memoryTrace && (
        <MemoryTraceDialog
          open={traceOpen}
          onClose={() => setTraceOpen(false)}
          trace={message.memoryTrace}
          characterName={displayName}
        />
      )}
    </div>
  );
}

// ─── Memory provenance dialog ─────────────────────────────────────────────────
// "Why did you say that?" — the exact memory injected into the prompt that
// produced this reply, recorded at generation time.

function MemoryTraceDialog({
  open, onClose, trace, characterName,
}: {
  open: boolean;
  onClose: () => void;
  trace: MemoryTrace;
  characterName: string;
}) {
  // `?? []` throughout: traces are persisted with the messages, so a chat
  // written before a field existed (or was renamed — `bits` became
  // `sharedLanguage`) still has to render.
  const sections: Array<{ label: string; items: string[] }> = [
    { label: "Known facts",      items: trace.facts ?? [] },
    { label: "Memorable scenes", items: trace.episodes ?? [] },
    { label: "Understandings",   items: trace.insights ?? [] },
    { label: "Shared language",  items: trace.sharedLanguage ?? trace.bits ?? [] },
    { label: "World lore",       items: trace.lore ?? [] },
  ].filter((s) => s.items.length > 0);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-5">
        <DialogTitle className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-[var(--purple-fg)]" />
          What {characterName} was remembering
        </DialogTitle>
        <div className="mt-3 space-y-3 overflow-y-auto text-xs">
          {trace.storyTime && (
            <div className="flex items-center gap-1.5 text-[var(--muted-fg)]">
              <Clock className="h-3 w-3" />
              Story time: <span className="text-[var(--foreground)]">{trace.storyTime}</span>
            </div>
          )}
          {sections.length === 0 && !trace.storyTime && (
            <div className="text-[var(--muted-fg)]">
              Nothing was injected for this reply — the character worked from the conversation alone.
            </div>
          )}
          {sections.map((s) => (
            <div key={s.label}>
              <div className="font-semibold text-[var(--muted-fg)] uppercase tracking-wider text-[10px] mb-1">
                {s.label} ({s.items.length})
              </div>
              <ul className="space-y-0.5">
                {s.items.map((item, i) => (
                  <li key={i} className="text-[var(--foreground)] leading-relaxed">— {item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
