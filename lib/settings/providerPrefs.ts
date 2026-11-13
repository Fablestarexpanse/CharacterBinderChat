// ─── Chat-model settings the server keeps ─────────────────────────────────────
// The non-secret part of ProviderSettings: where Ollama, LM Studio and ComfyUI
// are, which providers are on, the utility model, the default model for new
// chats and the picture reader. They lived only in the browser (localStorage),
// so clearing site data, or opening FableChat in another browser, lost them
// while the server kept everything else. Now the server holds a copy
// (/api/provider-settings, app_kv "providers:settings") and the browser's is a
// cache (components/ProviderSettingsSync.tsx). The OpenRouter key is not here:
// it has its own encrypted store (/api/secrets).
//
// Pure and client-safe: the route and the sync component both use these.

import type { ProviderSettings } from "@/lib/types";
import { isProviderType, type ProviderType } from "@/lib/llm/callers";

export interface ProviderPrefs {
  ollama: { baseUrl: string; enabled: boolean; utilityModel?: string };
  lmstudio: { baseUrl: string; enabled: boolean };
  openrouter: { enabled: boolean; defaultModel?: string };
  comfyui: { baseUrl: string; enabled: boolean };
  vision?: { provider: ProviderType; model: string };
}

/** The part of the settings the server keeps (never the key) */
export function pickProviderPrefs(ps: ProviderSettings): ProviderPrefs {
  return {
    ollama: { baseUrl: ps.ollama.baseUrl, enabled: ps.ollama.enabled, ...(ps.ollama.utilityModel ? { utilityModel: ps.ollama.utilityModel } : {}) },
    lmstudio: { baseUrl: ps.lmstudio.baseUrl, enabled: ps.lmstudio.enabled },
    openrouter: { enabled: ps.openrouter.enabled, ...(ps.openrouter.defaultModel ? { defaultModel: ps.openrouter.defaultModel } : {}) },
    comfyui: { baseUrl: ps.comfyui.baseUrl, enabled: ps.comfyui.enabled },
    ...(ps.vision ? { vision: ps.vision } : {}),
  };
}

const str = (v: unknown, max = 500) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const url = (v: unknown) => { const s = str(v); if (!s) return undefined; try { const u = new URL(s); return u.protocol === "http:" || u.protocol === "https:" ? s : undefined; } catch { return undefined; } };
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});

/** Untrusted input (a request body, a stored value) made safe; null when it holds nothing usable. */
export function cleanProviderPrefs(raw: unknown): ProviderPrefs | null {
  const r = obj(raw);
  const o = obj(r.ollama), l = obj(r.lmstudio), or = obj(r.openrouter), c = obj(r.comfyui), v = obj(r.vision);
  const ollamaUrl = url(o.baseUrl), lmUrl = url(l.baseUrl), comfyUrl = url(c.baseUrl);
  if (!ollamaUrl || !lmUrl || !comfyUrl) return null;
  const utility = str(o.utilityModel, 300), def = str(or.defaultModel, 300), visionModel = str(v.model, 300);
  return {
    ollama: { baseUrl: ollamaUrl, enabled: o.enabled !== false, ...(utility ? { utilityModel: utility } : {}) },
    lmstudio: { baseUrl: lmUrl, enabled: l.enabled !== false },
    openrouter: { enabled: or.enabled !== false, ...(def ? { defaultModel: def } : {}) },
    comfyui: { baseUrl: comfyUrl, enabled: c.enabled !== false },
    ...(isProviderType(v.provider) && visionModel ? { vision: { provider: v.provider, model: visionModel } } : {}),
  };
}

/** The settings with the server's copy applied over them; the key (and anything not kept) stays as it was. */
export function applyProviderPrefs(ps: ProviderSettings, prefs: ProviderPrefs): ProviderSettings {
  return {
    ...ps,
    ollama: { ...ps.ollama, ...prefs.ollama, utilityModel: prefs.ollama.utilityModel },
    lmstudio: { ...ps.lmstudio, ...prefs.lmstudio },
    openrouter: { ...ps.openrouter, enabled: prefs.openrouter.enabled, defaultModel: prefs.openrouter.defaultModel },
    comfyui: { ...ps.comfyui, ...prefs.comfyui },
    vision: prefs.vision,
  };
}
