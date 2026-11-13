"use client";

// ─── "How images draw them" ───────────────────────────────────────────────────
// The image look of a character or persona, edited as plain text fields and
// turned into an ImageLook (cleaned) on save. Collapsed unless something is set.
// "Fill from description" asks the local memory model (/api/image/look-from-text)
// to write both tag sets from what the editor holds; Undo puts the old ones back.

import { useState } from "react";
import { Dice5, Loader2, Undo2, Wand2 } from "lucide-react";
import { useFableStore } from "@/lib/store";
import { sendJson } from "@/lib/api/client";
import { cleanImageLook, type ImageLook } from "@/lib/media/imageLook";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export interface LookDraft { tags: string; undressedTags: string; avoid: string; loraName: string; loraTrigger: string; loraWeight: string; seed: string; likeness: boolean }

export function toLookDraft(look: ImageLook | undefined): LookDraft {
  return {
    tags: look?.tags ?? "", undressedTags: look?.undressedTags ?? "", avoid: look?.avoid ?? "",
    loraName: look?.lora?.name ?? "", loraTrigger: look?.lora?.trigger ?? "",
    loraWeight: look?.lora?.weight !== undefined ? String(look.lora.weight) : "",
    seed: look?.seed !== undefined ? String(look.seed) : "",
    likeness: look?.likeness ?? false,
  };
}

export function fromLookDraft(d: LookDraft): ImageLook | undefined {
  return cleanImageLook({
    tags: d.tags, undressedTags: d.undressedTags, avoid: d.avoid,
    lora: d.loraName.trim() ? { name: d.loraName, trigger: d.loraTrigger, weight: d.loraWeight.trim() ? Number(d.loraWeight) : undefined } : undefined,
    seed: d.seed.trim() ? Number(d.seed) : undefined,
    likeness: d.likeness,
  });
}

export function ImageLookFields({ value, onChange, who, open, children, describe }: {
  value: LookDraft; onChange: (d: LookDraft) => void; who: string; open?: boolean; children?: React.ReactNode;
  /** The words the tags are made from (description, personality…); enables Fill from description */
  describe?: () => string;
}) {
  const ollama = useFableStore((s) => s.providerSettings.ollama);
  const [filling, setFilling] = useState(false);
  const [fillError, setFillError] = useState<string | null>(null);
  const [before, setBefore] = useState<{ tags: string; undressedTags: string } | null>(null);
  const fill = async () => {
    const text = describe?.().trim() ?? "";
    if (!text) { setFillError(`Write ${who === "you" ? "your" : "their"} description first: the tags are made from it.`); return; }
    setFilling(true); setFillError(null);
    try {
      const r = await sendJson<{ ok: boolean; tags?: string; undressedTags?: string; error?: string }>("POST", "/api/image/look-from-text", {
        name: who, text, ollamaBaseUrl: ollama.baseUrl, utilityModel: ollama.utilityModel,
      });
      setBefore({ tags: value.tags, undressedTags: value.undressedTags });
      onChange({ ...value, tags: r.tags || value.tags, undressedTags: r.undressedTags || value.undressedTags });
    } catch (e) {
      setFillError(e instanceof Error ? e.message : String(e));
    } finally {
      setFilling(false);
    }
  };
  const set = (k: Exclude<keyof LookDraft, "likeness">) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ ...value, [k]: e.target.value });
  const anySet = value.likeness || Object.values(value).some((v) => typeof v === "string" && v.trim());
  const seedBad = value.seed.trim() !== "" && !(Number.isInteger(Number(value.seed)) && Number(value.seed) >= 0 && Number(value.seed) <= 0xffffffff);
  const weightBad = value.loraWeight.trim() !== "" && !Number.isFinite(Number(value.loraWeight));
  return (
    <details className="rounded-lg border border-[var(--border)] px-3 py-2" open={anySet || open}>
      <summary className="cursor-pointer select-none text-xs font-medium text-[var(--foreground)]">
        How images draw {who} <span className="font-normal text-[var(--muted-fg)]">— used in every picture of {who}</span>
      </summary>
      <div className="mt-3 space-y-4">
        <label className="flex items-start gap-3 cursor-pointer rounded-lg bg-[var(--purple-light)] px-3 py-2">
          <input type="checkbox" checked={value.likeness} onChange={(e) => onChange({ ...value, likeness: e.target.checked })}
            className="mt-0.5 h-4 w-4 accent-[var(--purple)] cursor-pointer" aria-label={`Make pictures look like ${who}`} />
          <span>
            <span className="block text-xs font-medium text-[var(--foreground)]">Make pictures look like {who}</span>
            <span className="block text-[11px] text-[var(--muted-fg)] mt-0.5">
              Draws {who} with a likeness workflow that uses the reference pictures below to keep the face: one of yours
              that takes an image, or the bundled SDXL Likeness. The image tags, LoRA and seed below are always used.
            </span>
          </span>
        </label>
        {describe && (
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" type="button" disabled={filling} onClick={() => void fill()}
                title="The local memory model reads the description and writes both tag sets">
                {filling ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Wand2 className="h-3.5 w-3.5 mr-1" />}
                {filling ? "Reading the description…" : "Fill from description"}
              </Button>
              {before && !filling && (
                <Button variant="ghost" size="sm" type="button" onClick={() => { onChange({ ...value, ...before }); setBefore(null); }}>
                  <Undo2 className="h-3.5 w-3.5 mr-1" />Undo
                </Button>
              )}
            </div>
            {fillError && <div role="alert" className="text-[11px] text-red-600">{fillError}</div>}
          </div>
        )}
        <Field label="Image tags" hint="short, comma-separated, for the image model; used word for word">
          <Textarea value={value.tags} onChange={set("tags")} rows={2} aria-label="Image tags"
            placeholder="silver hair, scar across left jaw, green eyes, grey trench coat" />
        </Field>
        <Field label="Image tags, undressed" hint="optional: the same person with no clothing words; used instead of the tags above when a picture shows them undressed">
          <Textarea value={value.undressedTags} onChange={set("undressedTags")} rows={2} aria-label="Image tags, undressed"
            placeholder="silver hair, scar across left jaw, green eyes, athletic build, freckled shoulders" />
        </Field>
        <p className="-mt-2 text-[11px] text-[var(--muted-fg)]">
          Each picture picks one set by itself: when its prompt (from the scene, a photo, or what you typed) has {who} nude or
          undressed, the undressed tags lead; otherwise the tags above. For adult characters only.
        </p>
        <Field label="Avoid" hint="kept out of their pictures">
          <Input value={value.avoid} onChange={set("avoid")} aria-label="Avoid" placeholder="glasses, beard" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_5rem]">
          <Field label="LoRA" hint="optional, trained on them">
            <Input value={value.loraName} onChange={set("loraName")} aria-label="LoRA name" placeholder="ronan_v2" />
          </Field>
          <Field label="Trigger word">
            <Input value={value.loraTrigger} onChange={set("loraTrigger")} aria-label="LoRA trigger word" placeholder="r0nan" disabled={!value.loraName.trim()} />
          </Field>
          <Field label="Weight">
            <Input value={value.loraWeight} onChange={set("loraWeight")} aria-label="LoRA weight" placeholder="1" inputMode="decimal" disabled={!value.loraName.trim()} />
          </Field>
        </div>
        {weightBad && <div role="alert" className="text-[11px] text-red-600">The weight must be a number, like 0.8.</div>}
        <Field label="Fixed seed" hint="optional: the same face and framing more often, with less variety">
          <div className="flex gap-2">
            <Input value={value.seed} onChange={set("seed")} aria-label="Fixed seed" placeholder="random each time" inputMode="numeric" />
            <Button variant="outline" size="sm" type="button" title="Pick a seed"
              onClick={() => onChange({ ...value, seed: String(Math.floor(Math.random() * 0xffffffff)) })}>
              <Dice5 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </Field>
        {seedBad && <div role="alert" className="text-[11px] text-red-600">The seed must be a whole number from 0 to 4294967295.</div>}
        {children}
        <p className="text-[11px] text-[var(--muted-fg)]">
          Written for image models, not the story: the chat uses the description above.
        </p>
      </div>
    </details>
  );
}
