import { NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import { badRequest, guard, routeError } from "@/lib/api/server";
import { readJsonCapped } from "@/lib/server/assets";
import { cleanProviderPrefs } from "@/lib/settings/providerPrefs";

export const dynamic = "force-dynamic";

// ─── /api/provider-settings ───────────────────────────────────────────────────
// The non-secret chat-model settings (lib/settings/providerPrefs.ts), kept by the
// server so clearing browser data or opening another browser doesn't lose them.
// GET → { prefs: ProviderPrefs | null }   PUT ProviderPrefs → { ok: true, prefs }

const KEY = "providers:settings";

export async function GET(req: NextRequest) {
  try {
    const denied = guard(req);
    if (denied) return denied;
    const raw = getStore().getKv(KEY);
    let prefs = null;
    try { prefs = raw ? cleanProviderPrefs(JSON.parse(raw)) : null; } catch { prefs = null; }
    return Response.json({ prefs });
  } catch (err) {
    return routeError("[provider-settings GET]", err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const denied = guard(req);
    if (denied) return denied;
    const prefs = cleanProviderPrefs(await readJsonCapped(req, 16 * 1024, "the request").catch(() => null));
    if (!prefs) return badRequest("the settings need http(s) addresses for Ollama, LM Studio and ComfyUI");
    getStore().setKv(KEY, JSON.stringify(prefs));
    return Response.json({ ok: true, prefs });
  } catch (err) {
    return routeError("[provider-settings PUT]", err);
  }
}
