"use client";

// ─── Image Studio (full page) ─────────────────────────────────────────────────
// The sidebar entry used to open a "Coming soon" placeholder while a working
// studio existed only as a 280px inspector tab. Same controls, room to see the
// output: settings on the left, every render this session on the right.
//
// Each render can be deleted (its chat image cards go with it; what uses it is
// said first, and an Undo bar follows) or used for a character
// (UseRenderDialog). Delete works on the whole job, as the Gallery does.

import { useState } from "react";
import { useFableStore } from "@/lib/store";
import { ImageStudioTab } from "@/components/image/ImageStudioTab";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { UseRenderDialog, type RenderTarget } from "@/components/image/UseRenderDialog";
import { ImageIcon, Download, X, Trash2, UserRound, Undo2 } from "lucide-react";
import { downloadFromUrl } from "@/lib/utils";
import { renderUsage, renderIsUsed, type RemovedRenders, type RenderUsage } from "@/lib/media/renders";
import { plural } from "@/lib/chat/references";

/** What deleting did to chats, for the Undo bar */
const cardsNote = (u: RenderUsage) => {
  const n = u.cards.reduce((t, c) => t + c.count, 0);
  return n ? ` and ${plural(n, "image card")} from ${u.cards.map((c) => `“${c.chatName}”`).join(", ")}` : "";
};

export function ImageStudioView() {
  const { imageJobs, chats, characters, personas, deleteRenders, restoreRenders } = useFableStore();
  const [viewer, setViewer] = useState<{ url: string; id: string } | null>(null);
  const [useFor, setUseFor] = useState<RenderTarget | null>(null);
  // Asked first when something uses the render, or it is a batch of several pictures
  const [confirm, setConfirm] = useState<{ jobId: string; usage: RenderUsage; pictures: number } | null>(null);
  const [undo, setUndo] = useState<{ removed: RemovedRenders; note: string } | null>(null);

  const doDelete = (jobId: string, usage: RenderUsage) => {
    const removed = deleteRenders([jobId]);
    const pictures = removed.jobs[0]?.job.outputUrls.length ?? 1;
    setUndo({ removed, note: `Deleted ${pictures > 1 ? `a render of ${pictures} pictures` : "a render"}${cardsNote(usage)}.` });
    setConfirm(null);
  };

  const askDelete = (jobId: string) => {
    const job = imageJobs.find((j) => j.id === jobId);
    if (!job) return;
    const usage = renderUsage(job, chats, [...characters, ...personas]);
    const pictures = job.outputUrls.length;
    if (renderIsUsed(usage) || pictures > 1) setConfirm({ jobId, usage, pictures });
    else doDelete(jobId, usage);
  };

  const outputs = imageJobs.flatMap((job) =>
    job.outputUrls.map((url, i) => ({ url, index: i, id: `${job.id}-${i}`, jobId: job.id, prompt: job.prompt }))
  );
  const pending = imageJobs.filter((j) => j.status === "queued" || j.status === "generating");

  const download = (url: string, id: string) =>
    downloadFromUrl(url, `fablechat-${id.slice(0, 8)}.png`);

  return (
    // Below md the settings stack above the renders (a 320px column left a phone
    // ~70px for them); the settings keep their own scroll at a fixed height there.
    <div className="flex-1 flex flex-col md:flex-row min-w-0 overflow-y-auto md:overflow-hidden bg-[var(--card)]">
      {/* Settings — the same panel the inspector uses */}
      <div className="w-full md:w-[320px] h-[55vh] md:h-auto flex-shrink-0 border-b md:border-b-0 md:border-r border-[var(--border)] flex flex-col">
        <div className="px-4 py-3 border-b border-[var(--border)] flex-shrink-0">
          <h1 className="text-sm font-bold text-[var(--foreground)]">Image Studio</h1>
          <p className="text-[11px] text-[var(--muted-fg)]">
            ComfyUI · {pending.length > 0 ? `${pending.length} running` : "idle"}
          </p>
        </div>
        <div className="flex-1 min-h-0">
          <ImageStudioTab />
        </div>
      </div>

      {/* Outputs */}
      <div className="flex-1 min-w-0 md:overflow-y-auto p-4 md:p-6">
        {outputs.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <ImageIcon className="h-8 w-8 text-[var(--muted-fg)] mx-auto mb-2" />
              <div className="text-sm text-[var(--muted-fg)]">No renders yet</div>
              <div className="text-xs text-[var(--muted-fg)] mt-1">
                Write a prompt on the left and hit Generate.
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-sm font-semibold text-[var(--foreground)]">Renders</h2>
              <Badge variant="default">{outputs.length}</Badge>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(220px,100%),1fr))] gap-4">
              {outputs.map((out) => (
                <div
                  key={out.id}
                  className="group rounded-xl border border-[var(--border)] overflow-hidden hover:border-[var(--purple)] transition-colors"
                >
                  <div className="relative aspect-square bg-[var(--muted)]">
                    {/* eslint-disable-next-line @next/next/no-img-element -- local ComfyUI output */}
                    <img
                      src={out.url}
                      alt={out.prompt.slice(0, 60)}
                      className="w-full h-full object-cover cursor-pointer"
                      onClick={() => setViewer({ url: out.url, id: out.jobId })}
                      title="View full size"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7 absolute top-2 right-2 bg-[var(--card)]/90 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Download"
                      onClick={() => download(out.url, out.jobId)}
                    >
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="p-2 space-y-1.5">
                    <p className="text-[11px] text-[var(--muted-fg)] line-clamp-2">{out.prompt}</p>
                    {/* Always visible, not on hover: a touch screen has no hover */}
                    <div className="flex items-center justify-between gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        title="Set as someone's portrait, or start a new character from it"
                        onClick={() => setUseFor({ jobId: out.jobId, index: out.index, url: out.url, prompt: out.prompt })}
                      >
                        <UserRound className="h-3.5 w-3.5 mr-1" />Use for a character
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-[var(--muted-fg)] hover:text-red-600"
                        title="Delete this render"
                        aria-label="Delete this render"
                        onClick={() => askDelete(out.jobId)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {pending.length > 0 && (
          <div className="mt-6 flex items-center gap-2 text-xs text-[var(--muted-fg)]">
            <div className="h-3 w-3 rounded-full border-2 border-[var(--purple)] border-t-transparent animate-spin" />
            {pending.length} render{pending.length === 1 ? "" : "s"} in progress
          </div>
        )}
        {imageJobs[0]?.status === "failed" && pending.length === 0 && (
          <div className="mt-6 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-600">
            <X className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
            Last render failed: {imageJobs[0].error ?? "unknown error"}
          </div>
        )}
      </div>

      {undo && (
        <div role="status" className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2rem)] max-w-md flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-lg px-3 py-2 text-xs text-[var(--foreground)]">
          <span className="flex-1 min-w-0">{undo.note}</span>
          <Button variant="outline" size="sm" className="h-7" onClick={() => { restoreRenders(undo.removed); setUndo(null); }}>
            <Undo2 className="h-3.5 w-3.5 mr-1" />Undo
          </Button>
          <button className="p-1 text-[var(--muted-fg)] hover:text-[var(--foreground)] cursor-pointer" aria-label="Dismiss" onClick={() => setUndo(null)}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <Dialog open={!!confirm} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <DialogContent className="max-w-sm p-5" aria-describedby={undefined}>
          {confirm && (
            <>
              <DialogTitle>Delete this render?</DialogTitle>
              <ul className="mt-3 space-y-1.5 text-xs text-[var(--muted-fg)] leading-relaxed list-disc pl-4">
                {confirm.pictures > 1 && <li>It is a batch: all {confirm.pictures} of its pictures go.</li>}
                {confirm.usage.cards.map((c) => (
                  <li key={c.chatId}>
                    {plural(c.count, "image card")} in <span className="text-[var(--foreground)]">“{c.chatName}”</span> go with it. The conversation is untouched.
                  </li>
                ))}
                {confirm.usage.portraitOf.length > 0 && (
                  <li>Portrait of <span className="text-[var(--foreground)]">{confirm.usage.portraitOf.join(", ")}</span>: they keep their own copy.</li>
                )}
                {confirm.usage.referenceOf.length > 0 && (
                  <li>Reference picture of <span className="text-[var(--foreground)]">{confirm.usage.referenceOf.join(", ")}</span>: they keep their own copy.</li>
                )}
              </ul>
              <p className="mt-2 text-[11px] text-[var(--muted-fg)]">You can undo this straight after.</p>
              <div className="flex justify-end gap-2 mt-4">
                <Button variant="outline" size="sm" onClick={() => setConfirm(null)}>Cancel</Button>
                <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white" onClick={() => doDelete(confirm.jobId, confirm.usage)}>
                  <Trash2 className="h-3 w-3 mr-1.5" />Delete
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <UseRenderDialog target={useFor} onClose={() => setUseFor(null)} />

      <ImageLightbox
        url={viewer?.url ?? null}
        filename={`fablechat-${(viewer?.id ?? "image").slice(0, 8)}.png`}
        onClose={() => setViewer(null)}
      />
    </div>
  );
}
