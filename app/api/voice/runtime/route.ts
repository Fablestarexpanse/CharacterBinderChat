import { NextRequest } from "next/server";
import path from "node:path";
import { routeError, badRequest, guard } from "@/lib/api/server";
import {
  DEFAULT_RUNTIME, RUNTIME_EXTRA_GB, VOICE_MODELS, ensureRunning, forgetInstall, getRuntime, health,
  savedSetupLog, setupState, startSetup, stopServer, voiceServerLog,
} from "@/lib/server/voiceRuntime";

export const dynamic = "force-dynamic";

// ─── /api/voice/runtime ───────────────────────────────────────────────────────
// GET → { runtime, setup, health, models, extraGb, suggestedFolder, log }
// POST { action: "setup", folder, model }  → starts the download and install (nothing is fetched before this)
// POST { action: "start" | "stop" | "forget" }

export async function GET(req: NextRequest) {
  try {
    const denied = guard(req);
    if (denied) return denied;
    const runtime = getRuntime();
    return Response.json({
      runtime, setup: setupState(), health: runtime.installed ? await health(runtime) : null,
      models: VOICE_MODELS, extraGb: RUNTIME_EXTRA_GB, defaults: DEFAULT_RUNTIME,
      suggestedFolder: path.join(path.dirname(process.cwd()), "FableChat Voice"),
      log: voiceServerLog(),
      // After a restart the in-memory setup log is empty; the saved one says what happened
      savedLog: setupState().log.length ? [] : savedSetupLog(),
    });
  } catch (err) {
    return routeError("[voice/runtime GET]", err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const denied = guard(req);
    if (denied) return denied;
    const body = (await req.json()) as { action?: unknown; folder?: unknown; model?: unknown };
    switch (body.action) {
      case "setup": {
        if (typeof body.folder !== "string" || typeof body.model !== "string") return badRequest("folder and model are required");
        const r = startSetup(body.folder.trim().replace(/^["']|["']$/g, ""), body.model);
        return r.ok ? Response.json({ ok: true }) : badRequest(r.error);
      }
      case "start":
        try { await ensureRunning(); return Response.json({ ok: true, health: await health() }); }
        catch (e) { return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 }); }
      case "stop":
        await stopServer();
        return Response.json({ ok: true });
      case "forget":
        await stopServer();
        forgetInstall();
        return Response.json({ ok: true });
      default:
        return badRequest("action must be setup, start, stop or forget");
    }
  } catch (err) {
    return routeError("[voice/runtime POST]", err);
  }
}
