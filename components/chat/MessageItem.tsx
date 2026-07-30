"use client";

import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useFableStore } from "@/lib/store";
import { regenerateLastReply } from "@/lib/chat/generation";
import { formatTime } from "@/lib/utils";
import type { Message } from "@/lib/types";
import {
  Copy,
  Pencil,
  RefreshCw,
  ThumbsUp,
  ThumbsDown,
  MoreHorizontal,
  Check,
  ImageIcon,
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
  const { characters, chats, isGenerating } = useFableStore();
  const [copied, setCopied] = useState(false);
  const [liked, setLiked] = useState<"up" | "down" | null>(null);

  const isUser = message.role === "user";
  const character = characters.find((c) => c.id === message.characterId);
  const displayName = isUser ? "You" : character?.name ?? "Assistant";
  const avatarSrc = isUser ? undefined : character?.avatar;

  // Regenerate only applies to the newest message in the chat
  const chat = chats.find((c) => c.id === message.chatId);
  const isLastMessage = chat?.messages[chat.messages.length - 1]?.id === message.id;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
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

        {/* Action buttons — visible on hover */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCopy} title="Copy">
            {copied ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" title="Edit">
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
            className={`h-6 w-6 ${liked === "up" ? "text-green-600" : ""}`}
            onClick={() => setLiked(liked === "up" ? null : "up")}
            title="Good response"
          >
            <ThumbsUp className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={`h-6 w-6 ${liked === "down" ? "text-red-500" : ""}`}
            onClick={() => setLiked(liked === "down" ? null : "down")}
            title="Bad response"
          >
            <ThumbsDown className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" title="More options">
            <MoreHorizontal className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function ImageCard({ message }: { message: Message }) {
  const { imageJobs } = useFableStore();
  const job = imageJobs.find((j) => j.id === message.imageJobId);

  return (
    <div className="px-4 py-3 mx-2">
      <div className="flex gap-3">
        <div className="h-8 w-8 rounded-full bg-[var(--purple-light)] flex items-center justify-center flex-shrink-0 mt-0.5">
          <ImageIcon className="h-4 w-4 text-[var(--purple-fg)]" />
        </div>
        <div className="flex-1">
          <div className="text-xs font-semibold text-[var(--foreground)] mb-2">Image Generation</div>
          <div className="rounded-xl border border-[var(--border)] overflow-hidden max-w-sm">
            <div className="bg-[var(--muted)] aspect-square flex items-center justify-center relative">
              {job?.status === "complete" && job.outputUrls.length > 0 ? (
                // eslint-disable-next-line @next/next/no-img-element -- served straight from local ComfyUI
                <img
                  src={job.outputUrls[0]}
                  alt={job.prompt.slice(0, 80)}
                  className="w-full h-full object-cover cursor-pointer"
                  onClick={() => window.open(job.outputUrls[0], "_blank")}
                  title="Open full size"
                />
              ) : job?.status === "failed" ? (
                <div className="flex flex-col items-center gap-2 px-4 text-center">
                  <ImageIcon className="h-6 w-6 text-red-400" />
                  <div className="text-xs text-red-600 break-words">
                    {job.error ?? "Generation failed"}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <div className="h-8 w-8 rounded-full border-2 border-[var(--purple)] border-t-transparent animate-spin" />
                  <div className="text-xs text-[var(--muted-fg)]">
                    {job?.status === "generating" ? "Generating…" : "Queued…"}
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
                    onClick={() => window.open(url, "_blank")}
                  />
                ))}
              </div>
            )}
            <div className="p-3 border-t border-[var(--border)]">
              <div className="text-xs text-[var(--foreground)] line-clamp-2">{job?.prompt ?? message.content}</div>
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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
