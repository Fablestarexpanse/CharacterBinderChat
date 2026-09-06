"use client";

// ─── Image Studio (full page) ─────────────────────────────────────────────────
// The sidebar entry used to open a "Coming soon" placeholder while a working
// studio existed only as a 280px inspector tab. Same controls, room to see the
// output: settings on the left, every render this session on the right.

import { useState } from "react";
import { useFableStore } from "@/lib/store";
import { ImageStudioTab } from "@/components/image/ImageStudioTab";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ImageIcon, Download, X } from "lucide-react";
import { downloadFromUrl } from "@/lib/utils";

export function ImageStudioView() {
  const { imageJobs } = useFableStore();
  const [viewer, setViewer] = useState<{ url: string; id: string } | null>(null);

  const outputs = imageJobs.flatMap((job) =>
    job.outputUrls.map((url, i) => ({ url, id: `${job.id}-${i}`, jobId: job.id, prompt: job.prompt }))
  );
  const pending = imageJobs.filter((j) => j.status === "queued" || j.status === "generating");

  const download = (url: string, id: string) =>
    downloadFromUrl(url, `fablechat-${id.slice(0, 8)}.png`);

  return (
    <div className="flex-1 flex min-w-0 overflow-hidden bg-white">
      {/* Settings — the same panel the inspector uses */}
      <div className="w-[320px] flex-shrink-0 border-r border-[var(--border)] flex flex-col">
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
      <div className="flex-1 min-w-0 overflow-y-auto p-6">
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
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
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
                      className="h-7 w-7 absolute top-2 right-2 bg-white/90 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Download"
                      onClick={() => download(out.url, out.jobId)}
                    >
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="p-2">
                    <p className="text-[11px] text-[var(--muted-fg)] line-clamp-2">{out.prompt}</p>
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

      <ImageLightbox
        url={viewer?.url ?? null}
        filename={`fablechat-${(viewer?.id ?? "image").slice(0, 8)}.png`}
        onClose={() => setViewer(null)}
      />
    </div>
  );
}
