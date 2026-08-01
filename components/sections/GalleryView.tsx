"use client";

// ─── Gallery ──────────────────────────────────────────────────────────────────
// Two levels: the albums (one per chat that produced renders), then that
// chat's images. A single flat wall of every render stopped being navigable
// somewhere around the second chat.
//
// Selection and deletion work on a *job*, not a URL: a batch render is one
// job with several outputs, and removing "one image" of it would leave the
// job half-real. Batch tiles say so with a +N badge.

import { useState } from "react";
import { useFableStore } from "@/lib/store";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  GalleryHorizontal, Download, Trash2, Search, MessageSquare,
  ChevronLeft, CheckSquare, Square, ImageIcon, AlertTriangle,
} from "lucide-react";
import type { ImageJob } from "@/lib/types";

const STUDIO_KEY = "__studio__";

export function GalleryView() {
  const { imageJobs, chats, deleteRenders, setActiveSection, setActiveChatId } = useFableStore();

  const [openAlbum, setOpenAlbum]   = useState<string | null>(null);
  const [query, setQuery]           = useState("");
  const [viewer, setViewer]         = useState<{ url: string; id: string } | null>(null);
  const [selecting, setSelecting]   = useState(false);
  const [selected, setSelected]     = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [confirmAlbum, setConfirmAlbum] = useState(false);

  const renders = imageJobs.filter((j) => j.status === "complete" && j.outputUrls.length > 0);

  // ── Albums ────────────────────────────────────────────────────────────────
  const albums = new Map<string, { key: string; label: string; chatId?: string; jobs: ImageJob[] }>();
  for (const job of renders) {
    const key = job.chatId ?? STUDIO_KEY;
    if (!albums.has(key)) {
      albums.set(key, {
        key,
        label: job.chatId
          ? chats.find((c) => c.id === job.chatId)?.name ?? "Deleted chat"
          : "Image Studio",
        chatId: job.chatId,
        jobs: [],
      });
    }
    albums.get(key)!.jobs.push(job);
  }
  const albumList = [...albums.values()].sort((a, b) => b.jobs.length - a.jobs.length);

  const album = openAlbum ? albums.get(openAlbum) : undefined;

  const leaveAlbum = () => {
    setOpenAlbum(null);
    setQuery("");
    setSelecting(false);
    setSelected(new Set());
  };

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

  // ── Album grid ────────────────────────────────────────────────────────────
  if (!album) {
    return (
      <div className="flex-1 overflow-y-auto p-6 bg-white">
        <div className="max-w-5xl mx-auto">
          <h1 className="text-xl font-bold text-[var(--foreground)]">Gallery</h1>
          <p className="text-sm text-[var(--muted-fg)] mt-1 mb-6">
            {renders.length} render{renders.length === 1 ? "" : "s"} across {albumList.length}{" "}
            {albumList.length === 1 ? "chat" : "chats"}
          </p>

          {albumList.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--border)] p-10 text-center">
              <GalleryHorizontal className="h-6 w-6 text-[var(--muted-fg)] mx-auto mb-2" />
              <div className="text-sm text-[var(--muted-fg)]">
                No images yet — generate one from a chat or the Image Studio.
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
              {albumList.map((a) => {
                const cover = a.jobs[0]?.outputUrls[0];
                const count = a.jobs.reduce((n, j) => n + j.outputUrls.length, 0);
                return (
                  <button
                    key={a.key}
                    onClick={() => setOpenAlbum(a.key)}
                    className="group text-left rounded-xl border border-[var(--border)] overflow-hidden hover:border-[var(--purple)] transition-colors cursor-pointer"
                  >
                    <div className="relative aspect-[4/3] bg-[var(--muted)]">
                      {cover ? (
                        // eslint-disable-next-line @next/next/no-img-element -- local ComfyUI output
                        <img src={cover} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <ImageIcon className="h-6 w-6 text-[var(--muted-fg)]" />
                        </div>
                      )}
                      <div className="absolute bottom-2 right-2">
                        <Badge variant="default" className="bg-white/90">
                          {count} image{count === 1 ? "" : "s"}
                        </Badge>
                      </div>
                    </div>
                    <div className="p-3">
                      <div className="text-sm font-medium text-[var(--foreground)] truncate group-hover:text-[var(--purple-fg)] transition-colors">
                        {a.label}
                      </div>
                      <div className="text-[11px] text-[var(--muted-fg)] mt-0.5">
                        {a.chatId ? "chat" : "studio renders"}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Inside an album ───────────────────────────────────────────────────────
  const q = query.trim().toLowerCase();
  const visible = album.jobs.filter((j) => !q || j.prompt.toLowerCase().includes(q));
  const allSelected = visible.length > 0 && visible.every((j) => selected.has(j.id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const deleteSelected = () => {
    const emptiesAlbum = album.jobs.every((j) => selected.has(j.id));
    deleteRenders([...selected]);
    setSelected(new Set());
    setSelecting(false);
    setConfirmBulk(false);
    if (emptiesAlbum) setOpenAlbum(null);
  };

  const deleteAlbum = () => {
    deleteRenders(album.jobs.map((j) => j.id));
    setConfirmAlbum(false);
    leaveAlbum();
  };

  const albumImageCount = album.jobs.reduce((n, j) => n + j.outputUrls.length, 0);
  const chatStillExists = !!album.chatId && chats.some((c) => c.id === album.chatId);

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-white">
      <div className="max-w-5xl mx-auto">
        <button
          onClick={leaveAlbum}
          className="flex items-center gap-1 text-xs text-[var(--muted-fg)] hover:text-[var(--foreground)] transition-colors mb-3 cursor-pointer"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          All albums
        </button>

        <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-[var(--foreground)]">{album.label}</h1>
              {album.chatId && chats.some((c) => c.id === album.chatId) && (
                <button
                  onClick={() => { setActiveChatId(album.chatId!); setActiveSection("chats"); }}
                  className="text-[11px] text-[var(--purple-fg)] hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <MessageSquare className="h-3 w-3" />
                  open chat
                </button>
              )}
            </div>
            <p className="text-sm text-[var(--muted-fg)] mt-1">
              {visible.length} render{visible.length === 1 ? "" : "s"}
              {q && ` matching “${query}”`}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative w-52">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-fg)] pointer-events-none" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search prompts…"
                className="pl-8 h-9 text-xs"
              />
            </div>
            {selecting ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setSelected(allSelected ? new Set() : new Set(visible.map((j) => j.id)))
                  }
                >
                  {allSelected ? "Clear" : "Select all"}
                </Button>
                <Button
                  size="sm"
                  className="bg-red-600 hover:bg-red-700 text-white"
                  disabled={selected.size === 0}
                  onClick={() => setConfirmBulk(true)}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  Delete {selected.size || ""}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setSelecting(false); setSelected(new Set()); }}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={() => setSelecting(true)}>
                  <CheckSquare className="h-3.5 w-3.5 mr-1.5" />
                  Select
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-red-600 border-red-200 hover:bg-red-50"
                  onClick={() => setConfirmAlbum(true)}
                  title="Remove every render in this album"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  Delete album
                </Button>
              </>
            )}
          </div>
        </div>

        {visible.length === 0 && (
          <div className="rounded-xl border border-dashed border-[var(--border)] p-10 text-center text-sm text-[var(--muted-fg)]">
            No renders match “{query}”.
          </div>
        )}

        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
          {visible.map((job) => {
            const url    = job.outputUrls[0];
            const extra  = job.outputUrls.length - 1;
            const isSel  = selected.has(job.id);
            return (
              <div
                key={job.id}
                className={`group rounded-xl border overflow-hidden transition-colors ${
                  isSel ? "border-[var(--purple)] ring-2 ring-[var(--purple)]" : "border-[var(--border)] hover:border-[var(--purple)]"
                }`}
              >
                <div className="relative aspect-square bg-[var(--muted)]">
                  {/* eslint-disable-next-line @next/next/no-img-element -- local ComfyUI output */}
                  <img
                    src={url}
                    alt={job.prompt.slice(0, 60)}
                    className="w-full h-full object-cover cursor-pointer"
                    onClick={() => (selecting ? toggle(job.id) : setViewer({ url, id: job.id }))}
                    title={selecting ? "Select" : "View full size"}
                  />

                  {selecting && (
                    <button
                      onClick={() => toggle(job.id)}
                      className="absolute top-2 left-2 rounded bg-white/90 p-1 cursor-pointer"
                      title={isSel ? "Deselect" : "Select"}
                    >
                      {isSel
                        ? <CheckSquare className="h-4 w-4 text-[var(--purple-fg)]" />
                        : <Square className="h-4 w-4 text-[var(--muted-fg)]" />}
                    </button>
                  )}

                  {extra > 0 && (
                    <Badge variant="default" className="absolute bottom-2 left-2 bg-white/90">
                      +{extra}
                    </Badge>
                  )}

                  {!selecting && (
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
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7 bg-white/90"
                        title="Select this render to delete"
                        onClick={() => { setSelecting(true); setSelected(new Set([job.id])); }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
                <div className="p-2.5 space-y-1.5">
                  <p className="text-[11px] text-[var(--foreground)] line-clamp-2 leading-snug">
                    {job.prompt}
                  </p>
                  <div className="flex items-center gap-1 flex-wrap">
                    {/* A job persisted by an older build can be missing
                        settings, or fields added since — never assume shape */}
                    {job.settings?.workflow && (
                      <Badge variant="default">{job.settings.workflow}</Badge>
                    )}
                    {job.settings?.width && job.settings?.height && (
                      <Badge variant="default">{job.settings.width}×{job.settings.height}</Badge>
                    )}
                    {(job.settings?.loras?.length ?? 0) > 0 && (
                      <Badge variant="purple">{job.settings.loras.length} LoRA</Badge>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bulk delete confirmation */}
      <Dialog open={confirmBulk} onOpenChange={(o) => !o && setConfirmBulk(false)}>
        <DialogContent className="max-w-sm p-5" aria-describedby={undefined}>
          <DialogTitle>
            Remove {selected.size} render{selected.size === 1 ? "" : "s"}?
          </DialogTitle>
          <p className="text-xs text-[var(--muted-fg)] mt-2 leading-relaxed">
            They leave the gallery, and their image cards are removed from the chat.
            The conversation itself is untouched, and the PNG files stay in
            ComfyUI&apos;s output folder — this only clears FableChat&apos;s record.
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" size="sm" onClick={() => setConfirmBulk(false)}>
              Cancel
            </Button>
            <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white" onClick={deleteSelected}>
              <Trash2 className="h-3 w-3 mr-1.5" />
              Remove
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Whole-album delete — the warning has to make it unmistakable that the
          chat survives, since "delete album" sits one word away from it */}
      <Dialog open={confirmAlbum} onOpenChange={(o) => !o && setConfirmAlbum(false)}>
        <DialogContent className="max-w-md p-5" aria-describedby={undefined}>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            Delete all {albumImageCount} image{albumImageCount === 1 ? "" : "s"} in “{album.label}”?
          </DialogTitle>

          <div className="mt-3 space-y-2">
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5">
              <Trash2 className="h-3.5 w-3.5 text-red-600 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-red-700 leading-relaxed">
                Every render in this album is removed, along with the image cards showing
                them in the chat. This can&apos;t be undone.
              </p>
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--muted)] p-2.5">
              <MessageSquare className="h-3.5 w-3.5 text-[var(--muted-fg)] mt-0.5 flex-shrink-0" />
              <p className="text-xs text-[var(--muted-fg)] leading-relaxed">
                {chatStillExists ? (
                  <>
                    The chat <span className="font-medium text-[var(--foreground)]">{album.label}</span> is{" "}
                    <span className="font-medium text-[var(--foreground)]">not</span> deleted — every message,
                    and everything the character remembers, stays exactly as it is.
                  </>
                ) : album.chatId ? (
                  <>This chat was already deleted; only its leftover renders remain.</>
                ) : (
                  <>These were made in the Image Studio and belong to no chat.</>
                )}{" "}
                The PNG files stay in ComfyUI&apos;s output folder.
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" size="sm" onClick={() => setConfirmAlbum(false)}>
              Cancel
            </Button>
            <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white" onClick={deleteAlbum}>
              <Trash2 className="h-3 w-3 mr-1.5" />
              Delete {albumImageCount} image{albumImageCount === 1 ? "" : "s"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ImageLightbox
        url={viewer?.url ?? null}
        filename={`fablechat-${(viewer?.id ?? "image").slice(0, 8)}.png`}
        onClose={() => setViewer(null)}
      />
    </div>
  );
}
