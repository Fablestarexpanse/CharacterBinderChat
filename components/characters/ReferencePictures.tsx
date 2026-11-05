"use client";

// ─── Reference pictures ───────────────────────────────────────────────────────
// A few pictures of someone, sent to workflows that take image inputs (an
// identity workflow, or a video's first frame) so pictures of them look like
// them. The first is the primary. Stored as assets, never inline.

import { useRef, useState } from "react";
import { ImagePlus, Star, X } from "lucide-react";
import { isAssetUrl, sizedSrc, uploadImage } from "@/lib/chat/assets";
import { MAX_REFERENCES } from "@/lib/media/imageLook";
import { Button } from "@/components/ui/button";

export function ReferencePictures({ value, onChange, avatar, who }: {
  value: string[]; onChange: (v: string[]) => void; avatar?: string; who: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const avatarAsset = isAssetUrl(avatar) ? avatar.split("?")[0] : undefined;

  const add = async (files: FileList) => {
    setBusy(true); setError(null);
    try {
      const urls: string[] = [];
      for (const f of Array.from(files)) urls.push(await uploadImage(f));
      onChange([...new Set([...value, ...urls])]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2" role="group" aria-label="Reference pictures">
      <div className="text-xs font-medium text-[var(--foreground)]">
        Reference pictures <span className="font-normal text-[var(--muted-fg)]">— sent to workflows that take an image, so pictures look like {who}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {value.map((url, i) => (
          <div key={url} role="listitem" aria-label={i === 0 ? "Primary reference" : `Reference ${i + 1}`}
            className={`relative h-20 w-20 rounded-lg overflow-hidden border ${i === 0 ? "border-[var(--purple)] border-2" : "border-[var(--border)]"} ${i >= MAX_REFERENCES ? "opacity-50" : ""}`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a stored asset at thumbnail size */}
            <img src={sizedSrc(url, 160)} alt="" className="h-full w-full object-cover" />
            {i === 0
              ? <span className="absolute left-1 top-1 rounded bg-[var(--purple)] px-1 text-[9px] font-medium text-white">primary</span>
              : <button type="button" onClick={() => onChange([url, ...value.filter((u) => u !== url)])} title="Make this the primary reference" aria-label="Make primary"
                  className="absolute left-1 top-1 rounded bg-black/50 p-0.5 text-white hover:bg-black/70 cursor-pointer"><Star className="h-3 w-3" /></button>}
            <button type="button" onClick={() => onChange(value.filter((u) => u !== url))} title="Remove" aria-label="Remove reference"
              className="absolute right-1 top-1 rounded bg-black/50 p-0.5 text-white hover:bg-black/70 cursor-pointer"><X className="h-3 w-3" /></button>
          </div>
        ))}
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
          className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-[var(--border)] text-[10px] text-[var(--muted-fg)] hover:border-[var(--purple)] hover:text-[var(--purple-fg)] cursor-pointer">
          <ImagePlus className="h-4 w-4" />{busy ? "Uploading…" : "Add"}
        </button>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple className="hidden" aria-label="Add reference pictures"
          onChange={(e) => { const f = e.target.files; if (f?.length) void add(f); e.target.value = ""; }} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted-fg)]">
        {avatarAsset && !value.includes(avatarAsset) && (
          <Button variant="outline" size="sm" type="button" onClick={() => onChange([...value, avatarAsset])}>Use the portrait</Button>
        )}
        <span>
          {value.length === 0 ? (avatarAsset ? "None chosen, so the portrait is used." : "None yet.") : `The first ${Math.min(value.length, MAX_REFERENCES)} ${value.length === 1 ? "is" : "are"} sent; star one to make it the primary.`}
          {" "}Keep good results with “Keep as reference” on any picture in a chat.
        </span>
      </div>
      {error && <div role="alert" className="text-[11px] text-red-600">{error}</div>}
    </div>
  );
}
