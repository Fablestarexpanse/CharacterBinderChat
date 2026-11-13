import { NextRequest } from "next/server";
import { routeError, badRequest, guard } from "@/lib/api/server";
import { readJsonCapped } from "@/lib/server/assets";
import { parseProviderBase } from "@/lib/llm/callers";
import {
  MEMORY_MODEL, ensureOllama, getBackground, ollamaExecutable, ollamaModels, pullState, setBackground, startPull,
} from "@/lib/server/backgroundModel";

import {
  GGUF, LLAMA_BUILD, assetForHere, builtinReady, builtinRunning, defaultFolder, getBuiltin, installState, removeBuiltin, startInstall, stopBuiltin,
} from "@/lib/server/builtinModel";

export const dynamic = "force-dynamic";

// ─── /api/background ──────────────────────────────────────────────────────────
// The local model that runs memory and image prompts (lib/server/backgroundModel.ts).
// GET  ?ollama=<base>        → { settings, memoryModel, ollama: { installed, running, models }, pull }
// PUT  { fallbackToChat?, ollamaModel? }      → { ok: true, settings }
// POST { action: "pull", ollama?: <base> }    → starts the download into Ollama (progress in GET's `pull`)
//      { action: "start", ollama?: <base> }   → starts Ollama if it is installed
//      { action: "builtin-install", folder }  → downloads llama.cpp and the model (progress in GET's `builtin.install`)
//      { action: "builtin-stop" }             → stops the built-in model (it starts again when needed)
//      { action: "builtin-remove" }           → stops it and deletes its files

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
      builtin: (() => {
        const s = getBuiltin();
        return {
          available: !!assetForHere(), build: LLAMA_BUILD, gb: +(GGUF.bytes / 1e9).toFixed(1),
          folder: s.folder ?? defaultFolder(), installed: builtinReady(s), install: installState(),
        };
      })(),
      builtinRunning: await builtinRunning(),
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
    const body = (await readJsonCapped(req, 16 * 1024, "the request").catch(() => null)) as { action?: unknown; ollama?: unknown; folder?: unknown } | null;
    if (body?.action === "builtin-install") {
      if (typeof body.folder !== "string" || !body.folder.trim()) return badRequest("folder is required");
      const r = startInstall(body.folder.trim());
      return r.ok ? Response.json({ ok: true }) : Response.json({ ok: false, error: r.error }, { status: 409 });
    }
    if (body?.action === "builtin-stop") { await stopBuiltin(); return Response.json({ ok: true }); }
    if (body?.action === "builtin-remove") { await removeBuiltin(); return Response.json({ ok: true }); }
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
