// ─── Prompt overrides ─────────────────────────────────────────────────────────
// Server-only. A user's edited prompt lives in app_kv under `prompt:<id>`, so it
// is in every backup and survives a restore, like the rest of the database.
// Every place that builds one of these prompts asks promptTemplate() for the
// text, so an override applies wherever that prompt is sent.

import { getStore } from "@/lib/db";
import { PROMPTS, promptDef, type PromptDef, type PromptId } from "@/lib/prompts/defaults";
import { checkTemplate, type TemplateCheck } from "@/lib/prompts/render";

const kvKey = (id: PromptId) => `prompt:${id}`;

function readOverride(id: PromptId): string | null {
  const raw = getStore().getKv(kvKey(id));
  if (raw === null) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

/**
 * The text to send for a prompt: the user's override when there is one that
 * still passes its check, otherwise the shipped default. An override that has
 * become invalid (a later release removed a variable) falls back rather than
 * sending broken braces to the model.
 */
export function promptTemplate(id: PromptId): string {
  const def = promptDef(id);
  const override = readOverride(id);
  if (override !== null && checkTemplate(override, def.variables).ok) return override;
  return def.template;
}

export interface PromptEntry extends PromptDef {
  override: string | null;
  /** The override exists but fails its check, so the default is in use */
  overrideInvalid: boolean;
}

export function listPrompts(): PromptEntry[] {
  return PROMPTS.map((def) => {
    const override = readOverride(def.id);
    return { ...def, override, overrideInvalid: override !== null && !checkTemplate(override, def.variables).ok };
  });
}

/** Ids with an override in use: for "you are using an edited prompt" notices. */
export function editedPromptIds(): PromptId[] {
  return listPrompts().filter((p) => p.override !== null && !p.overrideInvalid).map((p) => p.id);
}

/** Save an override after checking it. Nothing is stored when the check fails. */
export function setPromptOverride(id: PromptId, template: string): TemplateCheck {
  const check = checkTemplate(template, promptDef(id).variables);
  if (!check.ok) return check;
  // Saving the default text verbatim is the same as having no override
  getStore().setKv(kvKey(id), template === promptDef(id).template ? null : JSON.stringify(template));
  return check;
}

export function clearPromptOverride(id: PromptId): void {
  getStore().setKv(kvKey(id), null);
}
