import { NextRequest } from "next/server";
import { routeError, badRequest, guard, upstreamError } from "@/lib/api/server";
import { getStore } from "@/lib/db";
import { isProviderType, parseProviderBase, PROVIDER_TYPES } from "@/lib/llm/callers";
import { describeImage } from "@/lib/server/vision";
import { promptTemplate } from "@/lib/server/prompts";
import { renderTemplate } from "@/lib/prompts/render";
import { testFrame } from "@/lib/server/videoTest";
import { hashBytes } from "@/lib/db/assets";

export const dynamic = "force-dynamic";

// ─── POST /api/vision/describe ────────────────────────────────────────────────
// { assetUrl, providerType, providerBaseUrl, modelId, characterName?, userLabel? }
//   → { ok: true, description }: a sentence or two on what the picture shows,
//     from a model that can see images, using the editable "Describing a
//     picture" prompt. The picture is read from the asset store, never from
//     the request.
// { test: true, providerType, providerBaseUrl, modelId } → describes a small
//   built-in test picture, for the Test button in Settings.
// A model that is down or refuses: 502 { ok: false, error }.

export async function POST(req: NextRequest) {
  try {
    const denied = guard(req);
    if (denied) return denied;
    const body = (await req.json()) as {
      assetUrl?: unknown; test?: unknown; providerType?: unknown; providerBaseUrl?: unknown; modelId?: unknown;
      characterName?: unknown; userLabel?: unknown;
    };
    if (!isProviderType(body.providerType)) return badRequest(`providerType must be one of: ${PROVIDER_TYPES.join(", ")}`);
    if (typeof body.modelId !== "string" || !body.modelId.trim()) return badRequest("choose the model that reads pictures (modelId)");
    const base = parseProviderBase(typeof body.providerBaseUrl === "string" ? body.providerBaseUrl : "https://openrouter.ai");
    if (!base) return badRequest("providerBaseUrl must be an http(s) URL");

    let hash: string, bytes: Buffer, mime: string;
    if (body.test === true) {
      bytes = Buffer.from(testFrame(256));
      hash = hashBytes(bytes);
      mime = "image/png";
    } else {
      const m = typeof body.assetUrl === "string" ? /\/api\/assets\/([0-9a-f]{64})/.exec(body.assetUrl) : null;
      if (!m) return badRequest("assetUrl must be a stored picture (/api/assets/<hash>)");
      const asset = getStore().getAsset(m[1]);
      if (!asset || !asset.mime.startsWith("image/")) return badRequest("no such picture");
      hash = m[1]; bytes = asset.bytes; mime = asset.mime;
    }

    const prompt = renderTemplate(promptTemplate("image.describe"), {
      character_name: typeof body.characterName === "string" && body.characterName ? body.characterName : "the character",
      user_label: typeof body.userLabel === "string" && body.userLabel ? body.userLabel : "User",
    });
    try {
      const description = await describeImage({ providerType: body.providerType, providerBaseUrl: base, modelId: body.modelId.trim() }, hash, bytes, mime, prompt);
      return Response.json({ ok: true, description });
    } catch (e) {
      return upstreamError("[vision/describe]", e);
    }
  } catch (err) {
    return routeError("[vision/describe POST]", err);
  }
}
