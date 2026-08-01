"use client";

import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useFableStore } from "@/lib/store";
import { regenerateLastReply } from "@/lib/chat/generation";
import { startImageJob } from "@/lib/providers/comfyui";
import { generateSceneImage } from "@/lib/chat/imageGen";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { formatTime } from "@/lib/utils";
import type { Message, MemoryTrace } from "@/lib/types";
import {
  Copy,
  Pencil,
  RefreshCw,
  ThumbsUp,
  ThumbsDown,
  Check,
  X,
  ImageIcon,
  ImagePlus,
  Brain,
  Clock,
  Download,
  Loader2,
  Minus,
  Trash2,
  ChevronDown,
} from "lucide-react";

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
  const character = characters.find((c) => c.id === message.characterId);
  // The user speaks AS their persona — show its name and portrait, not "You"
  const persona = isUser ? personas.find((p) => p.id === activePersonaId) : undefined;
  const displayName = isUser ? persona?.name ?? "You" : character?.name ?? "Assistant";
  const avatarSrc = isUser ? persona?.avatar : character?.avatar;

  // Regenerate only applies to the newest message in the chat
  const chat = chats.find((c) => c.id === message.chatId);
  const isLastMessage = chat?.messages[chat.messages.length - 1]?.id === message.id;

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
    try {
      await generateSceneImage(message.chatId, { uptoMessageId: message.id });
    } finally {
      setImagining(false);
    }
  };

  // Image card message
  if (message.imageJobId) {
    return <ImageCard message={message} />;
  }

  return (
    <div
      className={`group flex gap-3 px-4 py-3 hover:bg-[var(--muted)] transition-colors rounded-xl mx-2 ${
        isUser ? "flex-row-reverse" : ""
      }`}
    >
      <Avatar name={displayName} src={avatarSrc} size="sm" className="mt-0.5 flex-shrink-0" />

      <div className={`flex-1 min-w-0 space-y-1 ${isUser ? "items-end" : "items-start"} flex flex-col`}>
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-semibold text-[var(--foreground)]">{displayName}</span>
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
        <div
          className={`prose-chat text-sm text-[var(--foreground)] max-w-2xl ${
            isUser
              ? "bg-[var(--purple-light)] text-[var(--purple-fg)] px-3 py-2 rounded-2xl rounded-tr-sm"
              : ""
          }`}
        >
          {message.content.length === 0 ? (
            /* Typing / streaming indicator */
            <span className="flex items-center gap-1 text-[var(--muted-fg)]">
              <span className="h-2 w-2 rounded-full bg-[var(--purple)] opacity-60 animate-bounce [animation-delay:-0.3s]" />
              <span className="h-2 w-2 rounded-full bg-[var(--purple)] opacity-60 animate-bounce [animation-delay:-0.15s]" />
              <span className="h-2 w-2 rounded-full bg-[var(--purple)] opacity-60 animate-bounce" />
            </span>
          ) : (
            message.content.split("\n\n").map((para, i) => (
              <p key={i}>{renderContent(para)}</p>
            ))
          )}
        </div>
        )}

        {/* Action buttons — visible on hover */}
        {!editing && (
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
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
  const sections: Array<{ label: string; items: string[] }> = [
    { label: "Known facts",      items: trace.facts },
    { label: "Memorable scenes", items: trace.episodes },
    { label: "Understandings",   items: trace.insights },
    { label: "Shared language",  items: trace.bits },
    { label: "World lore",       items: trace.lore },
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

function ImageCard({ message }: { message: Message }) {
  const {
    imageJobs, providerSettings, addImageJob, updateImageJob, setMessageImageJob,
    updateMessageContent, toggleMessageCollapsed, removeMessage,
  } = useFableStore();
  const job = imageJobs.find((j) => j.id === message.imageJobId);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Edit-prompt mode: tweak the prompt and regenerate in place — the new
  // render replaces this card's image (the message keeps its spot in the chat)
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [promptDraft, setPromptDraft] = useState("");

  const runWithSettings = (settings: NonNullable<typeof job>["settings"]) => {
    const newJob = startImageJob(
      providerSettings.comfyui.baseUrl,
      settings,
      message.chatId,
      updateImageJob
    );
    addImageJob(newJob);
    setMessageImageJob(message.chatId, message.id, newJob.id);
  };

  // Failed → exact retry with the same settings. Complete → re-roll with a
  // fresh random seed for a new take on the same prompt.
  const handleRetry = () => {
    if (!job) return;
    runWithSettings(job.status === "complete" ? { ...job.settings, seed: -1 } : job.settings);
  };

  const handleEditedRun = () => {
    if (!job) return;
    const prompt = promptDraft.trim();
    if (!prompt) return;
    runWithSettings({ ...job.settings, prompt, seed: -1 });
    // Keep the message's durable copy of the prompt in step with what's shown
    updateMessageContent(message.chatId, message.id, prompt);
    setEditingPrompt(false);
  };

  // Save through a blob so the browser downloads instead of navigating —
  // the proxied /api/comfyui/view URL is same-origin, so this always works.
  const handleDownload = async (url: string, index = 0) => {
    try {
      const blob = await fetch(url).then((r) => r.blob());
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `fablechat-${(job?.id ?? "image").slice(0, 8)}${index > 0 ? `-${index + 1}` : ""}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      window.open(url, "_blank"); // fall back to opening it
    }
  };

  const busy = job?.status === "queued" || job?.status === "generating" || job?.status === "pending";

  // In-app viewer — clicking an image must never navigate away from the chat
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);

  const handleDelete = () => {
    if (confirmDelete) removeMessage(message.chatId, message.id);
    else {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
    }
  };

  // Minimized: one compact line with a thumbnail, so a long scene keeps its
  // images without them dominating the transcript.
  if (message.collapsed) {
    const thumb = job?.status === "complete" ? job.outputUrls[0] : undefined;
    return (
      <div className="px-4 py-1.5 mx-2">
        <div className="flex items-center gap-2 ml-11 max-w-sm rounded-lg border border-[var(--border)] bg-[var(--muted)] px-2 py-1.5">
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element -- served straight from local ComfyUI
            <img
              src={thumb}
              alt=""
              className="h-6 w-6 rounded object-cover flex-shrink-0 cursor-pointer"
              onClick={() => setViewerUrl(thumb)}
              title="View full size"
            />
          ) : (
            <ImageIcon className="h-3.5 w-3.5 text-[var(--muted-fg)] flex-shrink-0" />
          )}
          <span className="flex-1 min-w-0 text-[11px] text-[var(--muted-fg)] truncate">
            {job?.prompt ?? message.content}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 flex-shrink-0"
            title="Expand image"
            onClick={() => toggleMessageCollapsed(message.chatId, message.id)}
          >
            <ChevronDown className="h-3 w-3" />
          </Button>
        </div>
        <ImageLightbox
          url={viewerUrl}
          filename={`fablechat-${(job?.id ?? "image").slice(0, 8)}.png`}
          onClose={() => setViewerUrl(null)}
        />
      </div>
    );
  }

  return (
    <div className="px-4 py-3 mx-2">
      <div className="flex gap-3">
        <div className="h-8 w-8 rounded-full bg-[var(--purple-light)] flex items-center justify-center flex-shrink-0 mt-0.5">
          <ImageIcon className="h-4 w-4 text-[var(--purple-fg)]" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-1 mb-2 max-w-sm">
            <span className="text-xs font-semibold text-[var(--foreground)]">Image Generation</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 ml-auto"
              title="Minimize image"
              onClick={() => toggleMessageCollapsed(message.chatId, message.id)}
            >
              <Minus className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={`h-6 w-6 ${confirmDelete ? "text-red-500 bg-red-50" : ""}`}
              title={confirmDelete ? "Click again to remove this image from the chat" : "Remove image"}
              onClick={handleDelete}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
          <div className="rounded-xl border border-[var(--border)] overflow-hidden max-w-sm">
            <div className="bg-[var(--muted)] aspect-square flex items-center justify-center relative">
              {job?.status === "complete" && job.outputUrls.length > 0 ? (
                // eslint-disable-next-line @next/next/no-img-element -- served straight from local ComfyUI
                <img
                  src={job.outputUrls[0]}
                  alt={job.prompt.slice(0, 80)}
                  className="w-full h-full object-cover cursor-pointer"
                  onClick={() => setViewerUrl(job.outputUrls[0])}
                  title="View full size"
                />
              ) : job?.status === "failed" ? (
                <div className="flex flex-col items-center gap-2 px-4 text-center">
                  <ImageIcon className="h-6 w-6 text-red-400" />
                  <div className="text-xs text-red-600 break-words">
                    {job.error ?? "Generation failed"}
                  </div>
                </div>
              ) : !job ? (
                // Jobs live in localStorage; the message is durable. After a
                // cache clear the job is gone — show a terminal state, not a
                // spinner that never resolves.
                <div className="flex flex-col items-center gap-2 px-4 text-center">
                  <ImageIcon className="h-6 w-6 text-[var(--muted-fg)]" />
                  <div className="text-xs text-[var(--muted-fg)]">
                    Image no longer available — its job data was cleared with the browser cache.
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <div className="h-8 w-8 rounded-full border-2 border-[var(--purple)] border-t-transparent animate-spin" />
                  <div className="text-xs text-[var(--muted-fg)]">
                    {job.status === "generating" ? "Generating…" : "Queued…"}
                  </div>
                </div>
              )}
            </div>
            {/* Extra outputs from batch generation */}
            {job && job.outputUrls.length > 1 && (
              <div className="grid grid-cols-3 gap-1 p-1 border-t border-[var(--border)]">
                {job.outputUrls.slice(1).map((url) => (
                  // eslint-disable-next-line @next/next/no-img-element -- served straight from local ComfyUI
                  <img
                    key={url}
                    src={url}
                    alt="Batch output"
                    className="w-full aspect-square object-cover rounded cursor-pointer"
                    onClick={() => setViewerUrl(url)}
                  />
                ))}
              </div>
            )}
            <div className="p-3 border-t border-[var(--border)]">
              {editingPrompt && job ? (
                <div className="space-y-1.5">
                  <textarea
                    value={promptDraft}
                    onChange={(e) => setPromptDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleEditedRun();
                      if (e.key === "Escape") setEditingPrompt(false);
                    }}
                    rows={5}
                    autoFocus
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-2 text-xs text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--purple)] resize-y"
                  />
                  <div className="flex items-center gap-1.5">
                    <Button size="sm" className="h-7 text-[11px]" onClick={handleEditedRun} disabled={!promptDraft.trim()}>
                      <ImageIcon className="h-3 w-3 mr-1" />
                      Generate
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={() => setEditingPrompt(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-[var(--foreground)] line-clamp-2">{job?.prompt ?? message.content}</div>
              )}
              <div className="flex items-center gap-2 mt-2">
                <span className="text-[10px] text-[var(--muted-fg)]">
                  {job?.settings.workflow ?? "flux-cinematic"}
                </span>
                <span className="text-[10px] text-[var(--muted-fg)]">·</span>
                <span className="text-[10px] text-[var(--muted-fg)]">
                  {job?.settings.width}×{job?.settings.height}
                </span>
                <span
                  className={`ml-auto text-[10px] font-medium ${
                    job?.status === "complete"
                      ? "text-green-600"
                      : job?.status === "failed"
                        ? "text-red-600"
                        : "text-yellow-600"
                  }`}
                >
                  {job?.status ?? "pending"}
                </span>
              </div>
              {job && !busy && !editingPrompt && (
                <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-[var(--border)]">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={handleRetry}
                    title={job.status === "failed" ? "Run this generation again" : "Generate a new take (fresh seed)"}
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />
                    {job.status === "failed" ? "Try again" : "Re-roll"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={() => {
                      setPromptDraft(job.prompt);
                      setEditingPrompt(true);
                    }}
                    title="Tweak the prompt and regenerate — replaces this image"
                  >
                    <Pencil className="h-3 w-3 mr-1" />
                    Edit prompt
                  </Button>
                  {job.status === "complete" && job.outputUrls.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[11px]"
                      onClick={() => job.outputUrls.forEach((u, i) => handleDownload(u, i))}
                      title="Save image to your computer"
                    >
                      <Download className="h-3 w-3 mr-1" />
                      Download
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <ImageLightbox
        url={viewerUrl}
        filename={`fablechat-${(job?.id ?? "image").slice(0, 8)}.png`}
        onClose={() => setViewerUrl(null)}
      />
    </div>
  );
}
