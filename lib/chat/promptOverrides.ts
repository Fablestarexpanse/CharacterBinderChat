// ─── Prompt overrides, read from the browser ──────────────────────────────────
// The chat prompt is assembled in the browser, so prompts it uses (such as
// "Replying by text message") read the user's override from /api/prompts.
// Cached briefly: a prompt edited in Settings applies within seconds, without
// a request per message. Falls back to the shipped text when the server is
// unreachable.

import { getJson } from "@/lib/api/client";
import { promptDef, type PromptId } from "@/lib/prompts/defaults";
import { checkTemplate } from "@/lib/prompts/render";

let cache: { at: number; overrides: Record<string, string> } | null = null;
const TTL_MS = 10_000;

export async function clientPromptTemplate(id: PromptId): Promise<string> {
  if (!cache || Date.now() - cache.at > TTL_MS) {
    try {
      const r = await getJson<{ prompts: Array<{ id: string; override: string | null; overrideInvalid: boolean }> }>("/api/prompts");
      cache = { at: Date.now(), overrides: Object.fromEntries(r.prompts.filter((p) => p.override !== null && !p.overrideInvalid).map((p) => [p.id, p.override!])) };
    } catch {
      cache = { at: Date.now(), overrides: cache?.overrides ?? {} };
    }
  }
  const def = promptDef(id);
  const o = cache.overrides[id];
  return o !== undefined && checkTemplate(o, def.variables).ok ? o : def.template;
}

/** For tests and after a save in Settings. */
export const forgetPromptCache = () => { cache = null; };
