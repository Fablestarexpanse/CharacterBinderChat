import { NextRequest } from "next/server";
import { badRequest, guard, routeError } from "@/lib/api/server";
import { readJsonCapped } from "@/lib/server/assets";
import { callLLM, parseLLMJson } from "@/lib/llm/callers";
import { backgroundModel } from "@/lib/server/backgroundModel";
import { promptTemplate } from "@/lib/server/prompts";
import { renderTemplate } from "@/lib/prompts/render";
import { cleanLookSuggestion } from "@/lib/media/imageLook";

export const dynamic = "force-dynamic";

// ─── POST /api/image/look-from-text ───────────────────────────────────────────
// "Fill from description" in a character's or persona's look: the editable
// image.look-from-text prompt, run on the background model (the local memory
// model; never the chat's model, which may be paid and may refuse), turns what
// they wrote into image tags and undressed tags.
// Body: { name, text, ollamaBaseUrl?, utilityModel? } → { ok: true, tags, undressedTags }

export async function POST(req: NextRequest) {
  try {
    const denied = guard(req);
    if (denied) return denied;
    const body = (await readJsonCapped(req, 64 * 1024, "the request").catch(() => null)) as Record<string, unknown> | null;
    const name = typeof body?.name === "string" ? body.name.trim().slice(0, 200) : "";
    const text = typeof body?.text === "string" ? body.text.trim().slice(0, 8000) : "";
    if (!text) return badRequest("Write a description first: the tags are made from it.");

    let backend;
    try {
      backend = await backgroundModel({
        ollamaBaseUrl: typeof body?.ollamaBaseUrl === "string" ? body.ollamaBaseUrl : undefined,
        utilityModel: typeof body?.utilityModel === "string" ? body.utilityModel : undefined,
      }, null);
    } catch (e) {
      return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
    }
    const prompt = renderTemplate(promptTemplate("image.look-from-text"), { name: name || "them", text });
    let raw: string;
    try {
      raw = await callLLM(backend, prompt, { maxTokens: 500 });
    } catch (e) {
      return Response.json({ ok: false, error: `The model could not run: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
    }
    const look = cleanLookSuggestion(parseLLMJson<unknown>(raw.replace(/<think>[\s\S]*?<\/think>/g, ""), null));
    if (!look) return Response.json({ ok: false, error: "The model's answer could not be read as tags. Try again." }, { status: 502 });
    return Response.json({ ok: true, ...look });
  } catch (err) {
    return routeError("[image/look-from-text POST]", err);
  }
}
