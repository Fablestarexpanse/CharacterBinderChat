// Server-only: the Contact & media switches, in app_kv (so they are in backups).
import { getStore } from "@/lib/db";
import { cleanContactSettings, type ContactSettings } from "@/lib/media/contact";

const KEY = "contact:settings";

export function getContactSettings(): ContactSettings {
  const raw = getStore().getKv(KEY);
  try { return cleanContactSettings(raw ? JSON.parse(raw) : {}); } catch { return cleanContactSettings({}); }
}

export function setContactSettings(patch: unknown): ContactSettings {
  const next = cleanContactSettings({ ...getContactSettings(), ...((patch ?? {}) as object) });
  getStore().setKv(KEY, JSON.stringify(next));
  return next;
}
