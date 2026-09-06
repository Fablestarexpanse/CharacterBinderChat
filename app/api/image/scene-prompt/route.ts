import { NextRequest } from "next/server";
import { routeError, badRequest } from "@/lib/api/server";
import { parseProviderBase } from "@/lib/llm/callers";
import {
  buildDirectorMessages, looksLikeInstructionLeak,
  type SceneDirectorInput,
} from "@/lib/server/scenePrompt";

export const dynamic = "force-dynamic";

// ─── POST /api/image/scene-prompt ─────────────────────────────────────────────
// The /image scene director: reads the recent roleplay excerpt and distills
// WHAT THE SCENE LOOKS LIKE into a single image-generation prompt — visual
// description only, never conversation text. Runs on the local Ollama utility
// model so explicit scenes are handled without a cloud moderation layer.

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as SceneDirectorInput;
    if (!body.messages?.length || !body.ollamaBaseUrl || !body.modelId) {
      return badRequest("messages, ollamaBaseUrl and modelId are required");
    }
    const baseUrl = parseProviderBase(body.ollamaBaseUrl);
    if (!baseUrl) {
      return badRequest("ollamaBaseUrl must be an http(s) URL");
    }

    // Chat format (system/user split) — instruct models follow it far more
    // reliably than raw completion; raw mode had the model restating the
    // rules instead of answering when the excerpt got long.
    // think:false — thinking models otherwise put the whole answer in the
    // `thinking` channel and content comes back empty. Retried without the
    // flag for models that reject it.
    const call = (withThink: boolean) =>
      fetch(`${baseUrl}/api/chat`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model:    body.modelId,
          messages: buildDirectorMessages(body),
          stream:   false,
          ...(withThink ? { think: false } : {}),
          // Unload the 9B director from VRAM the moment it answers — ComfyUI
          // needs that memory next, and leaving the model resident forces a
          // multi-minute UNet reload shuffle on every image job.
          keep_alive: 0,
          options:  { temperature: 0.6, num_predict: 1200 },
        }),
        signal: AbortSignal.timeout(90_000),
      });
    let res = await call(true);
    if (res.status === 400) res = await call(false);
    if (!res.ok) {
      return Response.json(
        { ok: false, error: `Ollama HTTP ${res.status} — is the utility model pulled and Ollama running?` },
        { status: 502 }
      );
    }
    const chatData = (await res.json()) as {
      message?: { content?: string; thinking?: string };
      error?:   string;
    };
    // Fall back to the thinking channel if content is empty — better to mine
    // the reasoning for the marker than to fail outright
    const data = {
      response: chatData.message?.content?.trim() || chatData.message?.thinking || "",
      error:    chatData.error,
    };
    // Models leak reasoning as plain text ("Thinking Process: …") even without
    // <think> tags — so the answer is anchored to a PROMPT: marker and we take
    // everything after its LAST occurrence. Fallbacks: strip think blocks,
    // then take the final paragraph.
    let raw = (data.response ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    const marker = raw.lastIndexOf("FINAL_IMAGE_PROMPT:");
    if (marker !== -1) {
      raw = raw.slice(marker + "FINAL_IMAGE_PROMPT:".length);
      // The marker line is the answer; drop anything on later lines
      raw = raw.split(/\n\s*\n/)[0];
    } else {
      const paras = raw.split(/\n\s*\n/).filter((p) => p.trim());
      if (paras.length > 1) raw = paras[paras.length - 1];
    }
    const prompt = raw.replace(/^["'`\s]+|["'`\s]+$/g, "").replace(/\s+/g, " ").slice(0, 1500);
    if (!prompt) {
      return Response.json(
        { ok: false, error: `utility model returned nothing${data.error ? `: ${data.error}` : ""}` },
        { status: 502 }
      );
    }
    if (looksLikeInstructionLeak(prompt)) {
      return Response.json(
        { ok: false, error: "scene director produced instructions instead of a prompt — try again" },
        { status: 502 }
      );
    }
    return Response.json({ ok: true, prompt });
  } catch (err) {
    return routeError("[image/scene-prompt POST]", err);
  }
}
