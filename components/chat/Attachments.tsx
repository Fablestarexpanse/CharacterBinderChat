"use client";

// ─── Photos, clips and voice notes on a message ───────────────────────────────
// Each attachment shows its state: waiting for your review (change the prompt,
// take it or skip it), being made, failed (try again), or ready (redo it).

import { useState } from "react";
import { AlertTriangle, Camera, Clapperboard, Loader2, RefreshCw, X } from "lucide-react";
import type { Attachment, Message } from "@/lib/types";
import { useFableStore } from "@/lib/store";
import { sizedSrc } from "@/lib/chat/assets";
import { makePhoto } from "@/lib/chat/photos";
import { cancelClip, makeClip, startClip } from "@/lib/chat/videos";
import { isMaking } from "@/lib/chat/inflight";
import { readPicture } from "@/lib/chat/userPictures";
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
  const run = (prompt?: string) => message.characterId && void (a.kind === "video"
    ? makeClip(message.chatId, message.id, a.id, message.characterId, prompt)
    : makePhoto(message.chatId, message.id, a.id, message.characterId, prompt));
  const what = a.kind === "image" ? "photo" : a.kind === "video" ? "clip" : "voice note";

  if (a.fromUser) return <SentPicture a={a} message={message} onView={onView} />;

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
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--foreground)]">
          {a.kind === "video"
            ? <><Clapperboard className="h-3.5 w-3.5" />A clip from this photo. What happens in it:</>
            : <><Camera className="h-3.5 w-3.5" />A {what} to send. Change the prompt if you like:</>}
        </div>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} aria-label={`${what} prompt`}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] p-2 text-xs" />
        <div className="flex gap-2 justify-end">
          {/* Skipping a Redo keeps the picture you already have; skipping a first take removes it */}
          <Button variant="outline" size="sm" onClick={() => a.url ? set({ awaitingReview: false }) : removeAttachment(message.chatId, message.id, a.id)}>
            <X className="h-3 w-3 mr-1" />{a.url ? "Keep this one" : "Skip"}
          </Button>
          <Button variant="purple" size="sm" onClick={() => run(draft)} disabled={!draft.trim()}>
            {a.kind === "video" ? <><Clapperboard className="h-3 w-3 mr-1" />Make the clip</> : <><Camera className="h-3 w-3 mr-1" />Take the {what}</>}
          </Button>
        </div>
        <div className="text-[10px] text-[var(--muted-fg)]">
          {a.kind === "video"
            ? "The photo is the first frame, so say what happens rather than what it looks like. About 5 seconds, with sound."
            : "Their image tags and look are added."} Turn off review in Settings → Contact &amp; media.
        </div>
      </figure>
    );
  }
  // Pending but nothing in this tab is making it: a reload stopped it
  const interrupted = a.status === "pending" && !isMaking(a.id);
  return (
    <figure className="max-w-xs space-y-1">
      {interrupted && (
        <div role="alert" className="w-56 space-y-2 rounded-xl border border-amber-300 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200">
          <div className="flex items-start gap-2"><AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-px" /><span>The {what} stopped before it was finished (the page was reloaded, or it is being made in another tab).</span></div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => run()}>Try again</Button>
            <Button variant="ghost" size="sm" onClick={() => removeAttachment(message.chatId, message.id, a.id)}>Remove</Button>
          </div>
        </div>
      )}
      {a.status === "pending" && !interrupted && (
        <div role="status" className="flex h-40 w-40 flex-col items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--muted)] text-[11px] text-[var(--muted-fg)]">
          <Loader2 className="h-5 w-5 animate-spin" />
          {a.kind === "image" ? "Taking the photo…" : a.kind === "video" ? "Recording the clip… (a minute or two)" : "Recording…"}
          {a.kind === "video" && a.jobId && (
            <Button variant="outline" size="sm" onClick={() => void cancelClip(message.chatId, message.id, a.id)}>Cancel</Button>
          )}
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
          {a.url && (
            <button className="flex items-center gap-1 hover:text-[var(--foreground)] cursor-pointer" title="Make a short clip with sound from this photo"
              onClick={() => void startClip(message.chatId, message.id, a, message.characterId!)}>
              <Clapperboard className="h-3 w-3" />Make a clip
            </button>
          )}
          <button className="hover:text-red-600 cursor-pointer" onClick={() => set({ status: "removed" })} title="Remove (you can undo)">Remove</button>
          {done && <span role="status" className="text-green-700 dark:text-green-400">{done}</span>}
        </div>
      )}
      {a.status === "ready" && a.kind === "video" && message.characterId && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[var(--muted-fg)]" role="toolbar" aria-label="Clip actions">
          <button onClick={() => set({ awaitingReview: true })} className="flex items-center gap-1 hover:text-[var(--foreground)] cursor-pointer" title="Change what happens and make it again (this take is kept)">
            <RefreshCw className="h-3 w-3" />Redo
          </button>
          <button className="hover:text-red-600 cursor-pointer" onClick={() => set({ status: "removed" })} title="Remove (you can undo)">Remove</button>
        </div>
      )}
      {a.status === "ready" && (a.previous?.length ?? 0) > 0 && (
        <div className="flex items-center gap-1" aria-label="Earlier takes">
          <span className="text-[10px] text-[var(--muted-fg)]">Earlier:</span>
          {a.previous!.map((p, i) => a.kind === "video" ? (
            <button key={p.url} onClick={() => switchToTake(p.url)} title={p.prompt ?? "Use this take instead"} aria-label="Use an earlier take"
              className="cursor-pointer rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] hover:border-[var(--purple)]">Take {a.previous!.length - i}</button>
          ) : (
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

/**
 * A picture you sent: the picture, and what the character was told it shows
 * (from the picture reader). You can correct that, or write it yourself when
 * no reader is set up; a re-read asks the reader again.
 */
function SentPicture({ a, message, onView }: { a: Attachment; message: Message; onView: (u: string) => void }) {
  const { setAttachment, characters, chats } = useFableStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(a.prompt ?? "");
  const reading = a.status === "pending" && isMaking(a.id);
  const chat = chats.find((c) => c.id === message.chatId);
  const who = characters.find((c) => c.id === chat?.characterId)?.name ?? "The character";
  const save = () => {
    const t = draft.trim();
    setAttachment(message.chatId, message.id, { ...a, status: "ready", prompt: t || undefined, error: undefined });
    setEditing(false);
  };
  if (a.status === "removed") return null;
  return (
    <figure className="max-w-[16rem] space-y-1">
      {a.url && (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element -- a stored asset, resized by the server */}
          <img src={sizedSrc(a.url, 320)} alt={a.prompt ?? "A picture you sent"} onClick={() => onView(a.url!)}
            className={`max-h-72 rounded-2xl border border-[var(--border)] object-cover cursor-pointer ${reading ? "opacity-70" : ""}`} />
          {reading && (
            <div role="status" className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 rounded-b-2xl bg-black/55 py-1 text-[11px] text-white">
              <Loader2 className="h-3 w-3 animate-spin" />Reading the picture…
            </div>
          )}
        </div>
      )}
      {!reading && !editing && (
        <figcaption className="text-[10px] leading-snug text-[var(--muted-fg)]">
          {a.prompt
            ? <>{who} sees: <span className="text-[var(--foreground)]">{a.prompt}</span></>
            : <span className="text-amber-700 dark:text-amber-300">{who} only knows you sent a picture{a.error ? ` (not read: ${a.error})` : ""}.</span>}
          {" "}
          <button className="underline cursor-pointer hover:text-[var(--foreground)]" onClick={() => { setDraft(a.prompt ?? ""); setEditing(true); }}>{a.prompt ? "Correct" : "Describe it"}</button>
          {" · "}
          <button className="underline cursor-pointer hover:text-[var(--foreground)]" onClick={() => void readPicture(message.chatId, message.id, a.id)}>Read again</button>
        </figcaption>
      )}
      {editing && (
        <div className="space-y-1">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} aria-label="What the picture shows"
            placeholder="What the picture shows, in a sentence" className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] p-1.5 text-xs" />
          <div className="flex gap-1.5">
            <Button variant="purple" size="sm" onClick={save}>Save</Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </figure>
  );
}
