"use client";

// ─── Gallery ──────────────────────────────────────────────────────────────────
// Every render, grouped by the chat it came from. The Image Studio is the
// working surface (settings + latest output); this is the archive: search by
// prompt, see the settings behind a render, download it, or drop it.

import { useState } from "react";
import { useFableStore } from "@/lib/store";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GalleryHorizontal, Download, Trash2, Search, MessageSquare } from "lucide-react";

export function GalleryView() {
  const { imageJobs, chats, removeImageJob, setActiveSection, setActiveChatId } = useFableStore();
  const [query, setQuery] = useState("");
  const [viewer, setViewer] = useState<{ url: string; id: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const completed = imageJobs.filter(
    (j) => j.status === "complete" && j.outputUrls.length > 0 && (!q || j.prompt.toLowerCase().includes(q))
  );

  // Group by originating chat; renders made from the Image Studio with no chat
  // open fall into "Studio".
  const groups = new Map<string, { label: string; chatId?: string; jobs: typeof completed }>();
  for (const job of completed) {
    const key = job.chatId ?? "__studio__";
    if (!groups.has(key)) {
      groups.set(key, {
        label: job.chatId
          ? chats.find((c) => c.id === job.chatId)?.name ?? "Deleted chat"
          : "Image Studio",
        chatId: job.chatId,
        jobs: [],
      });
    }
    groups.get(key)!.jobs.push(job);
  }

  const download = async (url: string, id: string) => {
    try {
      const blob = await fetch(url).then((r) => r.blob());
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `fablechat-${id.slice(0, 8)}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      window.open(url, "_blank");
    }
  };

  const totalImages = completed.reduce((n, j) => n + j.outputUrls.length, 0);

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-white">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl font-bold text-[var(--foreground)]">Gallery</h1>
            <p className="text-sm text-[var(--muted-fg)] mt-1">
              {totalImages} image{totalImages === 1 ? "" : "s"} across {groups.size} source
              {groups.size === 1 ? "" : "s"}
            </p>
          </div>
          <div className="relative w-64 flex-shrink-0">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-fg)] pointer-events-none" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search prompts…"
              className="pl-8 h-9 text-xs"
            />
          </div>
        </div>

        {completed.length === 0 && (
          <div className="rounded-xl border border-dashed border-[var(--border)] p-10 text-center">
            <GalleryHorizontal className="h-6 w-6 text-[var(--muted-fg)] mx-auto mb-2" />
            <div className="text-sm text-[var(--muted-fg)]">
              {q ? `No renders match "${query}".` : "No images yet — generate one from a chat or the Image Studio."}
            </div>
          </div>
        )}

        <div className="space-y-8">
          {[...groups.values()].map((group) => (
            <div key={group.label + (group.chatId ?? "")}>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-sm font-semibold text-[var(--foreground)]">{group.label}</h2>
                <Badge variant="default">
                  {group.jobs.reduce((n, j) => n + j.outputUrls.length, 0)}
                </Badge>
                {group.chatId && chats.some((c) => c.id === group.chatId) && (
                  <button
                    onClick={() => { setActiveChatId(group.chatId!); setActiveSection("chats"); }}
                    className="text-[11px] text-[var(--purple-fg)] hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <MessageSquare className="h-3 w-3" />
                    open chat
                  </button>
                )}
              </div>

              <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
                {group.jobs.flatMap((job) =>
                  job.outputUrls.map((url, i) => (
                    <div
                      key={`${job.id}-${i}`}
                      className="group rounded-xl border border-[var(--border)] overflow-hidden hover:border-[var(--purple)] transition-colors"
                    >
                      <div className="relative aspect-square bg-[var(--muted)]">
                        {/* eslint-disable-next-line @next/next/no-img-element -- local ComfyUI output */}
                        <img
                          src={url}
                          alt={job.prompt.slice(0, 60)}
                          className="w-full h-full object-cover cursor-pointer"
                          onClick={() => setViewer({ url, id: job.id })}
                          title="View full size"
                        />
                        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7 bg-white/90"
                            title="Download"
                            onClick={() => download(url, job.id)}
                          >
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                          {i === 0 && (
                            <Button
                              variant="outline"
                              size="icon"
                              className={`h-7 w-7 bg-white/90 ${confirmDelete === job.id ? "text-red-600 border-red-300" : ""}`}
                              title={confirmDelete === job.id
                                ? "Click again to remove from the gallery"
                                : "Remove from gallery (the file stays in ComfyUI's output folder)"}
                              onClick={() => {
                                if (confirmDelete === job.id) {
                                  removeImageJob(job.id);
                                  setConfirmDelete(null);
                                } else {
                                  setConfirmDelete(job.id);
                                  setTimeout(() => setConfirmDelete((v) => (v === job.id ? null : v)), 3000);
                                }
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="p-2.5 space-y-1.5">
                        <p className="text-[11px] text-[var(--foreground)] line-clamp-2 leading-snug">
                          {job.prompt}
                        </p>
                        <div className="flex items-center gap-1 flex-wrap">
                          <Badge variant="default">{job.settings.workflow}</Badge>
                          <Badge variant="default">{job.settings.width}×{job.settings.height}</Badge>
                          {job.settings.loras.length > 0 && (
                            <Badge variant="purple">{job.settings.loras.length} LoRA</Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <ImageLightbox
        url={viewer?.url ?? null}
        filename={`fablechat-${(viewer?.id ?? "image").slice(0, 8)}.png`}
        onClose={() => setViewer(null)}
      />
    </div>
  );
}
