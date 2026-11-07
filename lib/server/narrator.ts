// Server-only: the narrator's voice (Settings → Media → Narrator), in app_kv so
// backups keep it. Its sample is an asset; the asset sweep counts app_kv too.
import { getStore } from "@/lib/db";
import { cleanNarrator, type NarratorSettings } from "@/lib/media/voice";

const KEY = "voice:narrator";

export function getNarrator(): NarratorSettings {
  const raw = getStore().getKv(KEY);
  try { return cleanNarrator(raw ? JSON.parse(raw) : {}); } catch { return cleanNarrator({}); }
}

/** Change some of it, keep the rest. `voice: null` clears the voice (and so turns narration off). */
export function setNarrator(patch: unknown): NarratorSettings {
  const p = (patch && typeof patch === "object" ? patch : {}) as Record<string, unknown>;
  const cur = getNarrator();
  const next = cleanNarrator({ enabled: "enabled" in p ? p.enabled : cur.enabled, voice: "voice" in p ? p.voice : cur.voice });
  getStore().setKv(KEY, JSON.stringify(next));
  return next;
}
