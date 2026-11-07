// Server-only: the narrator's voice (Settings → Media → Narrator), in app_kv so
// backups keep it. Its sample is an asset; the asset sweep counts app_kv too.
import { getStore } from "@/lib/db";
import { cleanNarrator, type NarratorSettings } from "@/lib/media/voice";

const KEY = "voice:narrator";

export function getNarrator(): NarratorSettings {
  const raw = getStore().getKv(KEY);
  try { return cleanNarrator(raw ? JSON.parse(raw) : {}); } catch { return cleanNarrator({}); }
}

/**
 * Change some of it, keep the rest: `enabled`, `use` ("female" | "male"), and
 * the two voices `female` / `male` (null clears one). Narration is on only
 * while the narrator in use has a voice.
 */
export function setNarrator(patch: unknown): NarratorSettings {
  const p = (patch && typeof patch === "object" ? patch : {}) as Record<string, unknown>;
  const cur = getNarrator();
  const pick = (k: "enabled" | "use" | "female" | "male") => (k in p ? p[k] : cur[k]);
  const next = cleanNarrator({ enabled: pick("enabled"), use: pick("use"), female: pick("female") ?? null, male: pick("male") });
  const { voice: _derived, ...stored } = next;
  void _derived;
  getStore().setKv(KEY, JSON.stringify(stored));
  return next;
}
