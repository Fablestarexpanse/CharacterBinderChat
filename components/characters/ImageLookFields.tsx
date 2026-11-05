"use client";

// ─── "How images draw them" ───────────────────────────────────────────────────
// The image look of a character or persona, edited as plain text fields and
// turned into an ImageLook (cleaned) on save. Collapsed unless something is set.

import { Dice5 } from "lucide-react";
import { cleanImageLook, type ImageLook } from "@/lib/media/imageLook";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export interface LookDraft { tags: string; avoid: string; loraName: string; loraTrigger: string; loraWeight: string; seed: string; likeness: boolean }

export function toLookDraft(look: ImageLook | undefined): LookDraft {
  return {
    tags: look?.tags ?? "", avoid: look?.avoid ?? "",
    loraName: look?.lora?.name ?? "", loraTrigger: look?.lora?.trigger ?? "",
    loraWeight: look?.lora?.weight !== undefined ? String(look.lora.weight) : "",
    seed: look?.seed !== undefined ? String(look.seed) : "",
    likeness: look?.likeness ?? false,
  };
}

export function fromLookDraft(d: LookDraft): ImageLook | undefined {
  return cleanImageLook({
    tags: d.tags, avoid: d.avoid,
    lora: d.loraName.trim() ? { name: d.loraName, trigger: d.loraTrigger, weight: d.loraWeight.trim() ? Number(d.loraWeight) : undefined } : undefined,
    seed: d.seed.trim() ? Number(d.seed) : undefined,
    likeness: d.likeness,
  });
}

export function ImageLookFields({ value, onChange, who, open, children }: { value: LookDraft; onChange: (d: LookDraft) => void; who: string; open?: boolean; children?: React.ReactNode }) {
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
        <Field label="Image tags" hint="short, comma-separated, for the image model; used word for word">
          <Textarea value={value.tags} onChange={set("tags")} rows={2} aria-label="Image tags"
            placeholder="silver hair, scar across left jaw, green eyes, grey trench coat" />
        </Field>
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
