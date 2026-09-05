import { NextRequest } from "next/server";
import { parseProviderBase } from "@/lib/llm/callers";

export const dynamic = "force-dynamic";

// ─── POST /api/ollama/unload ──────────────────────────────────────────────────
// Evict every model Ollama has resident in VRAM. Called before each ComfyUI
// job: the GPU can't hold the 9B utility model and the Krea2 UNet at once, and
// leaving Ollama loaded forces a multi-minute model shuffle per image. Ollama
// reloads on demand, so chat/extraction just pay a short reload on next use.

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as { baseUrl?: string } | null;
    const base = parseProviderBase(body?.baseUrl ?? "http://localhost:11434");
    if (!base) {
      return Response.json({ ok: false, error: "baseUrl must be an http(s) URL" }, { status: 400 });
    }

    const ps = await fetch(`${base}/api/ps`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!ps.ok) {
      // Ollama not running = nothing occupying VRAM = mission accomplished
      return Response.json({ ok: true, unloaded: [] });
    }
    const data = (await ps.json()) as { models?: Array<{ name?: string; model?: string }> };
    const names = (data.models ?? [])
      .map((m) => m.model ?? m.name)
      .filter((n): n is string => !!n);

    const unloaded: string[] = [];
    for (const model of names) {
      const res = await fetch(`${base}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, keep_alive: 0 }),
        signal: AbortSignal.timeout(30_000),
      }).catch(() => null);
      if (res?.ok) unloaded.push(model);
    }
    return Response.json({ ok: true, unloaded });
  } catch (err) {
    // Best-effort: a failed unload should never block image generation
    return Response.json({ ok: false, error: String(err) });
  }
}
