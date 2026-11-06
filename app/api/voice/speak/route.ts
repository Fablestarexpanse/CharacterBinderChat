import { NextRequest } from "next/server";
import { routeError, badRequest, guard } from "@/lib/api/server";
import { getStore } from "@/lib/db";
import { assetUrl } from "@/lib/db/assets";
import { speak, type SpeakLine } from "@/lib/server/voiceSpeak";

export const dynamic = "force-dynamic";

// ─── POST /api/voice/speak ────────────────────────────────────────────────────
// { text, voice? }                 → one line in that voice
// { lines: [{ text, voice? }] }    → a dialogue, up to four voices in one clip
// `voice` is a character's or persona's voice ({ sample?, demo?, consent }).
// ?store=1 keeps the result as an asset and answers { ok, url, seconds };
// otherwise the WAV itself. The voice server is started if needed.

export async function POST(req: NextRequest) {
  try {
    const denied = guard(req);
    if (denied) return denied;
    const body = (await req.json()) as { text?: unknown; voice?: unknown; lines?: unknown };
    const lines: SpeakLine[] = Array.isArray(body.lines)
      ? body.lines.slice(0, 200).map((l) => ({ text: String((l as { text?: unknown })?.text ?? ""), voice: (l as { voice?: SpeakLine["voice"] })?.voice }))
      : [{ text: String(body.text ?? ""), voice: body.voice as SpeakLine["voice"] }];
    if (!lines.some((l) => l.text.trim())) return badRequest("text is required");
    try {
      const { wav, seconds } = await speak(lines.filter((l) => l.text.trim()));
      if (req.nextUrl.searchParams.get("store") === "1") {
        const { hash } = getStore().putAsset(new Uint8Array(wav), { audio: true });
        return Response.json({ ok: true, url: assetUrl(hash), seconds });
      }
      return new Response(new Uint8Array(wav), { headers: { "Content-Type": "audio/wav", "X-Generation-Seconds": String(seconds) } });
    } catch (e) {
      return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
    }
  } catch (err) {
    return routeError("[voice/speak POST]", err);
  }
}
