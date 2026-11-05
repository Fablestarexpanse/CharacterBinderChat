"use client";

// ─── Photos, clips and voice notes on a message ───────────────────────────────
// Each attachment shows its state: waiting for your review (change the prompt,
// take it or skip it), being made, failed (try again), or ready (redo it).

import { useState } from "react";
import { AlertTriangle, Camera, Loader2, RefreshCw, X } from "lucide-react";
import type { Attachment, Message } from "@/lib/types";
import { useFableStore } from "@/lib/store";
import { sizedSrc } from "@/lib/chat/assets";
import { makePhoto } from "@/lib/chat/photos";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { Button } from "@/components/ui/button";

export function Attachments({ message }: { message: Message }) {
  const [viewer, setViewer] = useState<string | null>(null);
  const items = message.attachments ?? [];
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2" aria-label="Attachments">
      {items.map((a) => <AttachmentView key={a.id} a={a} message={message} onView={setViewer} />)}
      <ImageLightbox url={viewer} filename="fablechat-photo.png" onClose={() => setViewer(null)} />
    </div>
  );
}

function AttachmentView({ a, message, onView }: { a: Attachment; message: Message; onView: (u: string) => void }) {
  const { setAttachment, removeAttachment, characters, updateCharacter } = useFableStore();
  const character = characters.find((c) => c.id === message.characterId);
  const [done, setDone] = useState<string | null>(null);
  const set = (patch: Partial<Attachment>) => setAttachment(message.chatId, message.id, { ...a, ...patch });
  const switchToTake = (url: string) => {
    if (!a.url) return;
    const take = a.previous?.find((p) => p.url === url);
    set({ url, prompt: take?.prompt ?? a.prompt, previous: [{ url: a.url, prompt: a.prompt }, ...(a.previous ?? []).filter((p) => p.url !== url)] });
  };
  const [draft, setDraft] = useState(a.prompt ?? "");
  const run = (prompt?: string) => message.characterId && void makePhoto(message.chatId, message.id, a.id, message.characterId, prompt);
  const what = a.kind === "image" ? "photo" : a.kind === "video" ? "clip" : "voice note";

  if (a.status === "removed") {
    return (
      <div role="status" className="flex items-center gap-2 rounded-xl border border-dashed border-[var(--border)] px-3 py-2 text-[11px] text-[var(--muted-fg)]">
        {a.kind === "image" ? "Photo" : a.kind === "video" ? "Clip" : "Voice note"} removed.
        <button className="underline cursor-pointer text-[var(--foreground)]" onClick={() => set({ status: a.url ? "ready" : "failed" })}>Undo</button>
        <button className="cursor-pointer hover:text-[var(--foreground)]" onClick={() => removeAttachment(message.chatId, message.id, a.id)} title="Remove for good">Dismiss</button>
      </div>
    );
  }
  if (a.awaitingReview) {
    return (
      <figure role="group" aria-label={`Review ${what}`} className="w-80 space-y-2 rounded-xl border border-[var(--purple)] bg-[var(--purple-light)]/40 p-3">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--foreground)]"><Camera className="h-3.5 w-3.5" />A {what} to send. Change the prompt if you like:</div>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} aria-label={`${what} prompt`}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] p-2 text-xs" />
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={() => removeAttachment(message.chatId, message.id, a.id)}><X className="h-3 w-3 mr-1" />Skip</Button>
          <Button variant="purple" size="sm" onClick={() => run(draft)} disabled={!draft.trim()}><Camera className="h-3 w-3 mr-1" />Take the {what}</Button>
        </div>
        <div className="text-[10px] text-[var(--muted-fg)]">Their image tags and look are added. Turn off review in Settings → Contact &amp; media.</div>
      </figure>
    );
  }
  return (
    <figure className="max-w-xs space-y-1">
      {a.status === "pending" && (
        <div role="status" className="flex h-40 w-40 flex-col items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--muted)] text-[11px] text-[var(--muted-fg)]">
          <Loader2 className="h-5 w-5 animate-spin" />
          {a.kind === "image" ? "Taking the photo…" : a.kind === "video" ? "Recording the clip…" : "Recording…"}
        </div>
      )}
      {a.status === "failed" && (
        <div role="alert" className="w-56 space-y-2 rounded-xl border border-red-200 px-3 py-2 text-[11px] text-red-600">
          <div className="flex items-start gap-2"><AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-px" /><span>The {what} could not be made: {a.error ?? "unknown error"}</span></div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => run()}>Try again</Button>
            <Button variant="ghost" size="sm" onClick={() => removeAttachment(message.chatId, message.id, a.id)}>Remove</Button>
          </div>
        </div>
      )}
      {a.status === "ready" && a.url && a.kind === "image" && (
        // eslint-disable-next-line @next/next/no-img-element -- a stored asset, resized by the server
        <img src={sizedSrc(a.url, 480)} alt={a.prompt ?? "Photo"} onClick={() => onView(a.url!)}
          className="max-h-72 rounded-xl border border-[var(--border)] object-cover cursor-pointer" />
      )}
      {a.status === "ready" && a.url && a.kind === "video" && (
        <video src={a.url} controls playsInline className="max-h-72 rounded-xl border border-[var(--border)]" aria-label={a.prompt ?? "Video"} />
      )}
      {a.status === "ready" && a.url && a.kind === "audio" && (
        <audio src={a.url} controls className="h-9 w-64" aria-label={a.prompt ?? "Voice note"} />
      )}
      {a.status === "ready" && a.kind === "image" && message.characterId && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[var(--muted-fg)]" role="toolbar" aria-label="Photo actions">
          <button onClick={() => set({ awaitingReview: true })} className="flex items-center gap-1 hover:text-[var(--foreground)] cursor-pointer" title="Change the prompt and take it again (this take is kept)">
            <RefreshCw className="h-3 w-3" />Redo
          </button>
          {character && a.url && (
            <>
              <button className="hover:text-[var(--foreground)] cursor-pointer" title={`Make this ${character.name}'s portrait`}
                onClick={() => { updateCharacter(character.id, { avatar: a.url }); setDone("Now their portrait."); }}>Use as portrait</button>
              <button className="hover:text-[var(--foreground)] cursor-pointer" title={`Add to ${character.name}'s reference pictures`}
                disabled={(character.referenceImages ?? []).includes(a.url)}
                onClick={() => { updateCharacter(character.id, { referenceImages: [...(character.referenceImages ?? []), a.url!] }); setDone("Kept as a reference."); }}>
                {(character.referenceImages ?? []).includes(a.url) ? "Kept as reference" : "Keep as reference"}
              </button>
            </>
          )}
          <button className="hover:text-red-600 cursor-pointer" onClick={() => set({ status: "removed" })} title="Remove (you can undo)">Remove</button>
          {done && <span role="status" className="text-green-700 dark:text-green-400">{done}</span>}
        </div>
      )}
      {a.status === "ready" && (a.previous?.length ?? 0) > 0 && (
        <div className="flex items-center gap-1" aria-label="Earlier takes">
          <span className="text-[10px] text-[var(--muted-fg)]">Earlier:</span>
          {a.previous!.map((p) => (
            <button key={p.url} onClick={() => switchToTake(p.url)} title="Use this take instead" aria-label="Use an earlier take" className="cursor-pointer">
              {/* eslint-disable-next-line @next/next/no-img-element -- a stored asset at thumbnail size */}
              <img src={sizedSrc(p.url, 96)} alt="" className="h-9 w-9 rounded object-cover border border-[var(--border)] hover:border-[var(--purple)]" />
            </button>
          ))}
        </div>
      )}
    </figure>
  );
}
