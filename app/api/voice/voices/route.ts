import { NextRequest } from "next/server";
import { routeError, badRequest, guard } from "@/lib/api/server";
import { readBodyCapped } from "@/lib/server/assets";
import { ensureRunning, getRuntime, health, voiceHeaders } from "@/lib/server/voiceRuntime";

export const dynamic = "force-dynamic";

// ─── /api/voice/voices ────────────────────────────────────────────────────────
// The local voice server's voices, through FableChat (which starts it if needed).
// GET → { voices, running }: only when the server is already up (a GET never starts it,
//   so a page elsewhere cannot start it by loading this address)
// POST ?name=&consent=1&isolate=1, body: an audio sample → { ok, voice }
//   Refused without consent=1: the sample must be your voice, one you may use, or a made-up one.
// DELETE ?id=yours:<name> → { ok }

const base = () => `http://127.0.0.1:${getRuntime().port}`;

async function ready(): Promise<Response | null> {
  try { await ensureRunning(); return null; }
  catch (e) { return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 }); }
}

/** The voice server's answer in FableChat's envelope: { ok: false, error } for every failure */
async function relay(res: Response, ok: (j: Record<string, unknown>) => Record<string, unknown>): Promise<Response> {
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) return Response.json({ ok: false, error: typeof j.error === "string" ? j.error : `the voice server answered HTTP ${res.status}` }, { status: res.status });
  return Response.json(ok(j));
}

export async function GET(req: NextRequest) {
  try {
    const denied = guard(req);
    if (denied) return denied;
    if (!(await health())) return Response.json({ voices: [], running: false });
    const res = await fetch(`${base()}/v1/voices`, { headers: voiceHeaders(), signal: AbortSignal.timeout(10_000) });
    return relay(res, (j) => ({ voices: j.voices ?? [], running: true }));
  } catch (err) {
    return routeError("[voice/voices GET]", err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const denied = guard(req);
    if (denied) return denied;
    const q = req.nextUrl.searchParams;
    if (q.get("consent") !== "1") return badRequest("Confirm this is your voice, a voice you have permission to use, or a made-up one.");
    const name = (q.get("name") ?? "").trim().slice(0, 60) || "My voice";
    let bytes: Uint8Array;
    try { bytes = await readBodyCapped(req, 25 * 1024 * 1024); } catch (e) { return badRequest(e instanceof Error ? e.message : "the upload failed"); }
    if (bytes.length < 1000) return badRequest("send the voice sample as the request body");
    const notReady = await ready();
    if (notReady) return notReady;
    const res = await fetch(`${base()}/v1/voices?${new URLSearchParams({ name, consent: "1", isolate: q.get("isolate") === "0" ? "0" : "1" })}`, {
      method: "POST", headers: voiceHeaders(), body: Buffer.from(bytes), signal: AbortSignal.timeout(300_000),
    });
    return relay(res, (j) => ({ ok: true, voice: j.voice }));
  } catch (err) {
    return routeError("[voice/voices POST]", err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const denied = guard(req);
    if (denied) return denied;
    const id = req.nextUrl.searchParams.get("id") ?? "";
    if (!/^yours:[a-z0-9-]+$/.test(id)) return badRequest("only your own voices can be removed");
    if (!(await health())) return Response.json({ ok: false, error: "the voice server is not running" }, { status: 409 });
    const res = await fetch(`${base()}/v1/voices/${encodeURIComponent(id)}`, { method: "DELETE", headers: voiceHeaders(), signal: AbortSignal.timeout(10_000) });
    return relay(res, () => ({ ok: true }));
  } catch (err) {
    return routeError("[voice/voices DELETE]", err);
  }
}
