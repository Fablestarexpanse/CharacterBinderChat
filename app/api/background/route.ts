import { NextRequest } from "next/server";
import { routeError, badRequest, guard } from "@/lib/api/server";
import { readJsonCapped } from "@/lib/server/assets";
import { parseProviderBase } from "@/lib/llm/callers";
import {
  MEMORY_MODEL, ensureOllama, getBackground, ollamaExecutable, ollamaModels, pullState, setBackground, startPull,
} from "@/lib/server/backgroundModel";

export const dynamic = "force-dynamic";

// ─── /api/background ──────────────────────────────────────────────────────────
// The local model that runs memory and image prompts (lib/server/backgroundModel.ts).
// GET  ?ollama=<base>        → { settings, memoryModel, ollama: { installed, running, models }, pull }
// PUT  { fallbackToChat?, ollamaModel? }      → { ok: true, settings }
// POST { action: "pull", ollama?: <base> }    → starts the download into Ollama (progress in GET's `pull`)
//      { action: "start", ollama?: <base> }   → starts Ollama if it is installed

const baseOf = (raw: string | null | undefined) => parseProviderBase(raw || "http://127.0.0.1:11434");

export async function GET(req: NextRequest) {
  try {
    const denied = guard(req);
    if (denied) return denied;
    const base = baseOf(req.nextUrl.searchParams.get("ollama"));
    if (!base) return badRequest("ollama must be an http(s) URL");
    const models = await ollamaModels(base);
    return Response.json({
      settings: getBackground(), memoryModel: MEMORY_MODEL,
      ollama: { installed: !!ollamaExecutable(), running: models !== null, models: models ?? [] },
      pull: pullState(),
    });
  } catch (err) {
    return routeError("[background GET]", err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const denied = guard(req);
    if (denied) return denied;
    const body = await readJsonCapped(req, 16 * 1024, "the request").catch(() => null);
    if (!body || typeof body !== "object") return badRequest("the body must be a JSON object");
    return Response.json({ ok: true, settings: setBackground(body) });
  } catch (err) {
    return routeError("[background PUT]", err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const denied = guard(req);
    if (denied) return denied;
    const body = (await readJsonCapped(req, 16 * 1024, "the request").catch(() => null)) as { action?: unknown; ollama?: unknown } | null;
    const base = baseOf(typeof body?.ollama === "string" ? body.ollama : null);
    if (!base) return badRequest("ollama must be an http(s) URL");
    if (body?.action === "pull") {
      const r = startPull(base);
      return r.ok ? Response.json({ ok: true }) : Response.json({ ok: false, error: r.error }, { status: 409 });
    }
    if (body?.action === "start") {
      const ok = await ensureOllama(base);
      return ok ? Response.json({ ok: true }) : Response.json({ ok: false, error: ollamaExecutable() ? "Ollama did not start" : "Ollama is not installed" }, { status: 409 });
    }
    return badRequest('action must be "pull" or "start"');
  } catch (err) {
    return routeError("[background POST]", err);
  }
}
