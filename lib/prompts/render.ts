// ─── Prompt templates ─────────────────────────────────────────────────────────
// Every prompt the app sends to a model is a template with {{variable}} slots.
// The code computes the variables (the conversation, the entity roster, …) and
// this renders them. Pure: no store, no DOM, so the server, the Settings preview
// and the tests all render the same way.

/** `{{name}}` — lower-case letters, digits and underscores */
const SLOT = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g;

/**
 * Familiar card macros accepted as spellings of the real variables, so someone
 * used to character cards can write {{char}} and get the character's name.
 */
const ALIASES: Record<string, string> = { char: "character_name", user: "user_label" };

export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(SLOT, (whole, raw: string) => {
    const name = ALIASES[raw] && !(raw in vars) ? ALIASES[raw] : raw;
    return name in vars ? vars[name] : whole;
  });
}

/** Variable names a template uses, in order of first use, aliases resolved. */
export function usedVariables(template: string): string[] {
  const seen: string[] = [];
  for (const m of template.matchAll(SLOT)) {
    const name = ALIASES[m[1]] ?? m[1];
    if (!seen.includes(name)) seen.push(name);
  }
  return seen;
}

export interface TemplateCheck { ok: boolean; errors: string[]; warnings: string[] }

/**
 * Is this template safe to use for a prompt? Unknown variables and missing
 * required ones are errors (the first would reach the model as literal braces,
 * the second would silently drop what the prompt exists to process); an empty
 * template is an error; optional variables left out are only warnings.
 */
export function checkTemplate(
  template: string,
  variables: ReadonlyArray<{ name: string; required?: boolean }>,
): TemplateCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!template.trim()) errors.push("The prompt is empty.");
  const known = new Set(variables.map((v) => v.name));
  const used = usedVariables(template);
  for (const name of used) if (!known.has(name)) errors.push(`{{${name}}} is not a variable this prompt has.`);
  for (const v of variables) {
    if (used.includes(v.name)) continue;
    if (v.required) errors.push(`{{${v.name}}} is required: without it the prompt has nothing to work on.`);
    else warnings.push(`{{${v.name}}} is not used.`);
  }
  return { ok: errors.length === 0, errors, warnings };
}
