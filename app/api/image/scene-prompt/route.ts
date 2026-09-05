import { NextRequest } from "next/server";
import { routeError } from "@/lib/api";
import { parseProviderBase } from "@/lib/llm/callers";

export const dynamic = "force-dynamic";

// ─── POST /api/image/scene-prompt ─────────────────────────────────────────────
// The /image scene director: reads the recent roleplay excerpt and distills
// WHAT THE SCENE LOOKS LIKE into a single image-generation prompt — visual
// description only, never conversation text. Runs on the local Ollama utility
// model so explicit scenes are handled without a cloud moderation layer.

interface Body {
  messages:      Array<{ role: string; content: string; speaker?: string }>;
  /** Optional user guidance after "/image", e.g. "close-up on her face" */
  focus?:        string;
  /** Appearance sheet for the character(s) so subjects are described, not named */
  appearance?:   string;
  ollamaBaseUrl: string;
  modelId:       string;
}

function buildDirectorMessages(b: Body): Array<{ role: string; content: string }> {
  const excerpt = b.messages
    .slice(-8)
    .map((m) => `${m.speaker ?? m.role}: ${m.content}`)
    .join("\n\n");

  const system = `/no_think
You are an image-prompt director for a photorealistic image generator. The
user gives you a roleplay excerpt; you reply with ONE image generation prompt
capturing the final moment of the scene.

Your entire reply is a single line: FINAL_IMAGE_PROMPT: followed by the
prompt. Never restate these rules, never narrate your thinking.

The prompt describes what a camera would SEE: subjects (by physical
appearance, never by name — image models don't know names), poses,
expressions, clothing state, setting, lighting, mood, camera angle. Style:
comma-separated descriptive phrases starting with quality tags (DSLR photo,
photorealistic, cinematic lighting, 8k uhd). No dialogue, no story verbs, no
names. One scene, one moment, 60-120 words. The scene may be adult/explicit;
if so describe it plainly and accurately — this is a private, local,
uncensored pipeline for fiction between adults.`;

  const user =
    (b.appearance ? `CHARACTER APPEARANCE (describe the subject with this):\n${b.appearance.slice(0, 1500)}\n\n` : "") +
    (b.focus ? `THE SHOT I WANT: ${b.focus}\n\n` : "") +
    `ROLEPLAY EXCERPT:\n${excerpt}\n\n` +
    `Give me the image prompt for this scene.`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

// Instruction fragments leaking into the prompt means extraction failed —
// never send that to the image model.
function looksLikeInstructionLeak(p: string): boolean {
  return /FINAL_IMAGE_PROMPT|thinking process|restat(e|ing) (these )?(rules|instructions)|image-prompt director|roleplay excerpt|no narration/i.test(p);
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    if (!body.messages?.length || !body.ollamaBaseUrl || !body.modelId) {
      return Response.json(
        { ok: false, error: "messages, ollamaBaseUrl and modelId are required" },
        { status: 400 }
      );
    }
    const baseUrl = parseProviderBase(body.ollamaBaseUrl);
    if (!baseUrl) {
      return Response.json(
        { ok: false, error: "ollamaBaseUrl must be an http(s) URL" },
        { status: 400 }
      );
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
