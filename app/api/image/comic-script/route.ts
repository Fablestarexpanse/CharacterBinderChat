import { NextRequest } from "next/server";
import { badRequest, guard, routeError } from "@/lib/api/server";
import { readJsonCapped } from "@/lib/server/assets";
import { callLLM, parseLLMJson } from "@/lib/llm/callers";
import { backgroundModel } from "@/lib/server/backgroundModel";
import { promptTemplate } from "@/lib/server/prompts";
import { renderTemplate } from "@/lib/prompts/render";
import { MAX_PANELS, cleanComicScript, type ComicPerson } from "@/lib/media/comicPage";

export const dynamic = "force-dynamic";

// ─── POST /api/image/comic-script ─────────────────────────────────────────────
// Comic-it, step one: the editable image.comic-script prompt on the background
// model (the local memory model) turns the chat since the last page into a
// panel script. Coordinates are never asked for: lib/media/comicPage.ts lays
// the page out. The answer is untrusted and goes through cleanComicScript.
// Body: { people: [{ name, look, role? }], excerpt, recap?, ollamaBaseUrl?, utilityModel? }
//   → { ok: true, script } | { ok: false, error }

export async function POST(req: NextRequest) {
  try {
    const denied = guard(req);
    if (denied) return denied;
    const body = (await readJsonCapped(req, 256 * 1024, "the request").catch(() => null)) as Record<string, unknown> | null;
    const excerpt = typeof body?.excerpt === "string" ? body.excerpt.trim().slice(0, 24_000) : "";
    if (!excerpt) return badRequest("there is nothing new in the chat to make a page from");
    const people: Array<ComicPerson & { role: string }> = (Array.isArray(body?.people) ? body.people : [])
      .map((p) => (p && typeof p === "object" ? p : {}) as Record<string, unknown>)
      .map((p) => ({
        name: typeof p.name === "string" ? p.name.trim().slice(0, 80) : "",
        look: typeof p.look === "string" ? p.look.trim().slice(0, 600) : "",
        role: p.role === "you" ? "you" : p.role === "extra" ? "someone already seen" : "character",
      }))
      .filter((p) => p.name)
      .slice(0, 8);
    if (people.length === 0) return badRequest("nobody to draw");
    const recap = typeof body?.recap === "string" && body.recap.trim() ? `The previous page covered: ${body.recap.trim().slice(0, 600)} Continue from there.` : "";

    let backend;
    try {
      backend = await backgroundModel({
        ollamaBaseUrl: typeof body?.ollamaBaseUrl === "string" ? body.ollamaBaseUrl : undefined,
        utilityModel: typeof body?.utilityModel === "string" ? body.utilityModel : undefined,
      }, null);
    } catch (e) {
      return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
    }
    const prompt = renderTemplate(promptTemplate("image.comic-script"), {
      max_panels: String(MAX_PANELS),
      recap,
      people: people.map((p) => `${p.name} (${p.role})`).join("\n"),
      excerpt,
    });
    let raw: string;
    try {
      // Unloaded straight after: MOSS draws the page next and needs the GPU memory
      raw = await callLLM(backend, prompt, { maxTokens: 1800, keepAlive: 0 });
    } catch (e) {
      return Response.json({ ok: false, error: `The model could not run: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
    }
    const script = cleanComicScript(parseLLMJson<unknown>(raw.replace(/<think>[\s\S]*?<\/think>/g, ""), null), people);
    if (!script) return Response.json({ ok: false, error: "The model's script could not be read. Try again." }, { status: 502 });
    return Response.json({ ok: true, script });
  } catch (err) {
    return routeError("[image/comic-script POST]", err);
  }
}
