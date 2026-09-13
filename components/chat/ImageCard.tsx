"use client";

// ─── The image card in a transcript ───────────────────────────────────────────
// A message whose content is a render: its job's progress, the finished image,
// and the actions on it — retry, re-roll with a fresh seed, edit the prompt and
// regenerate in place, collapse, delete.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useFableStore } from "@/lib/store";
import { queueImage } from "@/lib/chat/imageGen";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { downloadFromUrl } from "@/lib/utils";
import type { Message } from "@/lib/types";
import {
  ImageIcon, Download, Minus, Trash2, ChevronDown, RefreshCw, Pencil,
} from "lucide-react";

export function ImageCard({ message }: { message: Message }) {
  const {
    imageJobs, setMessageImageJob,
    updateMessageContent, toggleMessageCollapsed, removeMessage,
  } = useFableStore();
  const job = imageJobs.find((j) => j.id === message.imageJobId);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Edit-prompt mode: tweak the prompt and regenerate in place — the new
  // render replaces this card's image (the message keeps its spot in the chat)
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [promptDraft, setPromptDraft] = useState("");

  const runWithSettings = (settings: NonNullable<typeof job>["settings"]) => {
    const newJob = queueImage(settings, message.chatId);
    setMessageImageJob(message.chatId, message.id, newJob.id);
  };

  // Failed → exact retry with the same settings. Complete → re-roll with a
  // fresh random seed for a new take on the same prompt.
  const handleRetry = () => {
    if (!job?.settings) return;
    runWithSettings(job.status === "complete" ? { ...job.settings, seed: -1 } : job.settings);
  };

  const handleEditedRun = () => {
    if (!job?.settings) return;
    const prompt = promptDraft.trim();
    if (!prompt) return;
    runWithSettings({ ...job.settings, prompt, seed: -1 });
    // Keep the message's durable copy of the prompt in step with what's shown
    updateMessageContent(message.chatId, message.id, prompt);
    setEditingPrompt(false);
  };

  // Batch outputs get a -2, -3 suffix so they don't overwrite each other
  const handleDownload = (url: string, index = 0) =>
    downloadFromUrl(
      url,
      `fablechat-${(job?.id ?? "image").slice(0, 8)}${index > 0 ? `-${index + 1}` : ""}.png`
    );

  const busy = job?.status === "queued" || job?.status === "generating";

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
                // Jobs live in localStorage; the message is durable. Deleting
                // from the gallery removes the card too, so reaching this state
                // means a cache clear — show a terminal state, not a spinner
                // that never resolves.
                <div className="flex flex-col items-center gap-2 px-4 text-center">
                  <ImageIcon className="h-6 w-6 text-[var(--muted-fg)]" />
                  <div className="text-xs text-[var(--muted-fg)]">
                    Image no longer available — its render data was cleared with the browser cache.
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
                  {job?.settings?.workflow ?? "unknown workflow"}
                </span>
                <span className="text-[10px] text-[var(--muted-fg)]">·</span>
                <span className="text-[10px] text-[var(--muted-fg)]">
                  {job?.settings?.width}×{job?.settings?.height}
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
                  {job?.status ?? "missing"}
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
