"use client";

// ─── Use a render for a character ─────────────────────────────────────────────
// Turn a good Image Studio render into someone's portrait, or into a new
// character, without downloading and re-uploading it. The picture is stored as
// an asset first (rows hold /api/assets/<hash>, never the bytes or a ComfyUI
// URL that dies with ComfyUI's output folder), and the job records the copy in
// `keptAs` so deleting the render can say who kept it.

import { useState } from "react";
import { useFableStore } from "@/lib/store";
import { useUiStore } from "@/lib/store/ui";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { storePicture } from "@/lib/chat/assets";
import { lookFromRenderPrompt } from "@/lib/media/renders";
import { UserRound, UserPlus, Check } from "lucide-react";

export interface RenderTarget {
  jobId: string;
  /** Which of the job's outputs */
  index: number;
  url: string;
  prompt: string;
}

export function UseRenderDialog({ target, onClose }: { target: RenderTarget | null; onClose: () => void }) {
  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md p-5 overflow-y-auto" aria-describedby={undefined}>
        {/* Keyed by the render so a second open starts clean */}
        {target && <UseRenderForm key={`${target.jobId}-${target.index}`} target={target} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function UseRenderForm({ target, onClose }: { target: RenderTarget; onClose: () => void }) {
  const { characters, personas, updateCharacter, updatePersona, updateImageJob } = useFableStore();
  const openCharacterEditor = useUiStore((s) => s.openCharacterEditor);

  const [who, setWho] = useState("");
  const [alsoReference, setAlsoReference] = useState(false);
  const [state, setState] = useState<{ busy?: "portrait" | "new"; done?: string; error?: string }>({});

  /** Store the picture as an asset (same bytes, same asset) and note the copy on the job. */
  const keep = async (): Promise<string> => {
    const asset = await storePicture(target.url);
    const job = useFableStore.getState().imageJobs.find((j) => j.id === target.jobId);
    if (job && job.keptAs?.[target.index] !== asset) {
      updateImageJob(job.id, { keptAs: { ...job.keptAs, [target.index]: asset } });
    }
    return asset;
  };

  const withReference = (current: string[] | undefined, asset: string) => {
    const list = current ?? [];
    return list.includes(asset) ? list : [...list, asset];
  };

  const setPortrait = async () => {
    const [kind, id] = [who.slice(0, 1), who.slice(2)];
    setState({ busy: "portrait" });
    try {
      const asset = await keep();
      // Read the row now, not from the render: it may have changed while the picture uploaded
      const s = useFableStore.getState();
      if (kind === "c") {
        const c = s.characters.find((x) => x.id === id);
        if (!c) throw new Error("That character no longer exists.");
        updateCharacter(id, { avatar: asset, ...(alsoReference ? { referenceImages: withReference(c.referenceImages, asset) } : {}) });
        setState({ done: `${c.name}'s portrait is now this picture${alsoReference ? ", and it is one of their reference pictures" : ""}.` });
      } else {
        const p = s.personas.find((x) => x.id === id);
        if (!p) throw new Error("That persona no longer exists.");
        updatePersona(id, { avatar: asset, ...(alsoReference ? { referenceImages: withReference(p.referenceImages, asset) } : {}) });
        setState({ done: `${p.name}'s portrait is now this picture${alsoReference ? ", and it is one of their reference pictures" : ""}.` });
      }
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  const newCharacter = async () => {
    setState({ busy: "new" });
    try {
      const asset = await keep();
      const image = lookFromRenderPrompt(target.prompt);
      onClose();
      openCharacterEditor(null, {
        avatar: asset,
        ...(image ? { image } : {}),
        ...(alsoReference ? { referenceImages: [asset] } : {}),
      });
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <>
      <DialogTitle>Use for a character</DialogTitle>
      <div className="mt-3 flex gap-3 items-start">
        {/* eslint-disable-next-line @next/next/no-img-element -- local ComfyUI output */}
        <img src={target.url} alt="" className="h-20 w-20 rounded-lg object-cover border border-[var(--border)] flex-shrink-0" />
        <p className="text-[11px] text-[var(--muted-fg)] line-clamp-5 min-w-0">{target.prompt}</p>
      </div>

      <label className="mt-4 flex items-start gap-2 text-xs text-[var(--foreground)] cursor-pointer">
        <input
          type="checkbox"
          checked={alsoReference}
          onChange={(e) => setAlsoReference(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[var(--purple)] cursor-pointer"
        />
        <span>
          Also add it to their reference pictures
          <span className="block text-[11px] text-[var(--muted-fg)]">Used to keep their face the same in new pictures.</span>
        </span>
      </label>

      <section className="mt-4 rounded-lg border border-[var(--border)] p-3 space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--foreground)]">
          <UserRound className="h-3.5 w-3.5" />Set as portrait of…
        </div>
        <Select value={who} onChange={(e) => { setWho(e.target.value); setState({}); }} aria-label="Whose portrait">
          <option value="">Choose someone</option>
          {characters.length > 0 && (
            <optgroup label="Characters">
              {characters.map((c) => <option key={c.id} value={`c:${c.id}`}>{c.name}</option>)}
            </optgroup>
          )}
          {personas.length > 0 && (
            <optgroup label="Personas">
              {personas.map((p) => <option key={p.id} value={`p:${p.id}`}>{p.name}</option>)}
            </optgroup>
          )}
        </Select>
        <div className="flex justify-end">
          <Button size="sm" disabled={!who || !!state.busy} onClick={setPortrait}>
            {state.busy === "portrait" ? "Saving…" : "Set portrait"}
          </Button>
        </div>
      </section>

      <section className="mt-3 rounded-lg border border-[var(--border)] p-3 space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--foreground)]">
          <UserPlus className="h-3.5 w-3.5" />New character from this
        </div>
        <p className="text-[11px] text-[var(--muted-fg)]">
          Opens the character editor with this picture as the portrait and its prompt as their image look, to edit before saving.
        </p>
        <div className="flex justify-end">
          <Button size="sm" variant="outline" disabled={!!state.busy} onClick={newCharacter}>{state.busy === "new" ? "Saving…" : "New character…"}</Button>
        </div>
      </section>

      {state.done && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-green-700"><Check className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />{state.done}</p>
      )}
      {state.error && <p className="mt-3 text-xs text-red-600">Could not keep that picture: {state.error}</p>}
    </>
  );
}
