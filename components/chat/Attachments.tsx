"use client";

// ─── Photos, clips and voice notes on a message ───────────────────────────────

import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { Attachment } from "@/lib/types";
import { sizedSrc } from "@/lib/chat/assets";
import { ImageLightbox } from "@/components/ui/ImageLightbox";

export function Attachments({ items }: { items: Attachment[] }) {
  const [viewer, setViewer] = useState<string | null>(null);
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2" aria-label="Attachments">
      {items.map((a) => (
        <figure key={a.id} className="max-w-xs">
          {a.status === "pending" && (
            <div role="status" className="flex h-40 w-40 flex-col items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--muted)] text-[11px] text-[var(--muted-fg)]">
              <Loader2 className="h-5 w-5 animate-spin" />
              {a.kind === "image" ? "Taking the photo…" : a.kind === "video" ? "Recording the clip…" : "Recording…"}
            </div>
          )}
          {a.status === "failed" && (
            <div role="alert" className="flex w-56 items-start gap-2 rounded-xl border border-red-200 px-3 py-2 text-[11px] text-red-600">
              <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-px" />
              <span>{a.kind === "image" ? "The photo" : a.kind === "video" ? "The clip" : "The voice note"} could not be made: {a.error ?? "unknown error"}</span>
            </div>
          )}
          {a.status === "ready" && a.url && a.kind === "image" && (
            // eslint-disable-next-line @next/next/no-img-element -- a stored asset, resized by the server
            <img src={sizedSrc(a.url, 480)} alt={a.prompt ?? "Photo"} onClick={() => setViewer(a.url!)}
              className="max-h-72 rounded-xl border border-[var(--border)] object-cover cursor-pointer" />
          )}
          {a.status === "ready" && a.url && a.kind === "video" && (
            <video src={a.url} controls playsInline className="max-h-72 rounded-xl border border-[var(--border)]" aria-label={a.prompt ?? "Video"} />
          )}
          {a.status === "ready" && a.url && a.kind === "audio" && (
            <audio src={a.url} controls className="h-9 w-64" aria-label={a.prompt ?? "Voice note"} />
          )}
        </figure>
      ))}
      <ImageLightbox url={viewer} filename="fablechat-photo.png" onClose={() => setViewer(null)} />
    </div>
  );
}
