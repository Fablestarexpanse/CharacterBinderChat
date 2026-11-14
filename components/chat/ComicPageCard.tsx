"use client";

// ─── A Comic-it page in the chat ──────────────────────────────────────────────
// The page (kept as an asset once drawn, so it outlives ComfyUI's output folder),
// its title and panel count, and what can be done with it: Redo page (a new
// script for the same stretch of the story), Re-draw (the same script, a new
// drawing), open it full size, or delete it. Deleting the latest page moves the
// chat's comic back to the page before (lib/store/slices/chats.ts removeMessage),
// so that stretch can be made again. The compiled layout prompt is never shown:
// it is a wall of coordinates.

import { useState } from "react";
import { LayoutGrid, Loader2, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { useFableStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { redoComicPage } from "@/lib/chat/comic";
import type { Message } from "@/lib/types";

export function ComicPageCard({ message }: { message: Message }) {
  const comic = message.comic!;
  const job = useFableStore((s) => s.imageJobs.find((j) => j.id === message.imageJobId));
  const removeMessage = useFableStore((s) => s.removeMessage);
  const [busy, setBusy] = useState<"script" | "draw" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [viewer, setViewer] = useState<string | null>(null);

  // The kept copy first; the ComfyUI output while it is being kept
  const url = comic.page ?? (job?.status === "complete" ? job.outputUrls[0] : undefined);
  const drawing = !comic.page && (job?.status === "queued" || job?.status === "generating");

  const redo = async (mode: "script" | "draw") => {
    setBusy(mode);
    setError(null);
    try {
      const r = await redoComicPage(message.chatId, message.id, mode);
      if (!r.ok) setError(r.error ?? "It could not be made again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="px-4 py-2">
      <div className="max-w-md rounded-xl border border-[var(--border)] overflow-hidden bg-[var(--card)]">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)]">
          <LayoutGrid className="h-3.5 w-3.5 text-[var(--purple-fg)] flex-shrink-0" />
          <span className="flex-1 min-w-0 truncate text-xs font-medium text-[var(--foreground)]">{comic.title}</span>
          <span className="text-[10px] text-[var(--muted-fg)] flex-shrink-0">{comic.panels} panels</span>
        </div>
        <div className="bg-[var(--muted)] aspect-[2/3] flex items-center justify-center">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element -- an asset, or local ComfyUI while it is being kept
            <img src={url} alt={`Comic page: ${comic.title}`} className="w-full h-full object-contain cursor-pointer" onClick={() => setViewer(url)} title="View full size" />
          ) : job?.status === "failed" ? (
            <div className="px-4 text-center text-xs text-red-600 break-words">{job.error ?? "The page could not be drawn."}</div>
          ) : drawing ? (
            <div className="flex flex-col items-center gap-2 text-xs text-[var(--muted-fg)]">
              <Loader2 className="h-6 w-6 animate-spin text-[var(--purple-fg)]" />
              Drawing the page…
            </div>
          ) : (
            <div className="px-4 text-center text-xs text-[var(--muted-fg)]">The page is not here any more. Re-draw it from its script.</div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-t border-[var(--border)]">
          <Button variant="outline" size="sm" disabled={!!busy} onClick={() => void redo("script")}
            title="A new script for the same stretch of the story, then a new drawing">
            {busy === "script" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}Redo page
          </Button>
          <Button variant="outline" size="sm" disabled={!!busy || drawing} onClick={() => void redo("draw")}
            title="The same panels and lines, drawn again (with the current looks, LoRAs and style)">
            {busy === "draw" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}Re-draw
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" className={confirmDelete ? "text-red-600 bg-red-50" : "text-[var(--muted-fg)]"}
            title={confirmDelete ? "Click again to delete this page" : "Delete this page (if it is the latest, the next page starts where this one did)"}
            onClick={() => {
              if (confirmDelete) removeMessage(message.chatId, message.id);
              else { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 3000); }
            }}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
        {error && <div role="alert" className="px-3 pb-2 text-[11px] text-red-600">{error}</div>}
      </div>
      <ImageLightbox url={viewer} filename={`comic-${comic.title.replace(/[^\w-]+/g, "_").slice(0, 40)}.png`} onClose={() => setViewer(null)} />
    </div>
  );
}
