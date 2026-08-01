import { NextRequest } from "next/server";

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

function buildDirectorPrompt(b: Body): string {
  const excerpt = b.messages
    .slice(-8)
    .map((m) => `${m.speaker ?? m.role}: ${m.content}`)
    .join("\n\n");

  return `/no_think
You are an image-prompt director for a photorealistic image generator.
Answer directly — do not narrate a thinking process and do not restate these
instructions.

Read the roleplay excerpt below and produce ONE image generation prompt that
captures the CURRENT scene — the final moment of the excerpt.

Rules:
- Your entire reply is ONE line: the marker FINAL_IMAGE_PROMPT: followed by
  the image prompt. Nothing before it, nothing after it.
- Describe what a camera would SEE: subjects (by physical appearance, never by
  name — image models don't know names), poses, expressions, clothing state,
  the setting, lighting, mood, camera angle.
- Style: comma-separated descriptive phrases. Start with quality/medium tags
  like: DSLR photo, photorealistic, cinematic lighting, 8k uhd.
- Do NOT include dialogue, story verbs ("she says", "he remembers"), or names.
- One scene, one moment. 60-120 words.
- The scene may be adult/explicit; if so, describe it plainly and accurately —
  this is a private, local, uncensored pipeline for fiction between adults.
${b.appearance ? `\nCHARACTER APPEARANCE (use this to describe the subject):\n${b.appearance.slice(0, 1500)}\n` : ""}${b.focus ? `\nTHE USER SPECIFICALLY WANTS: ${b.focus}\nCenter the prompt on that, using the scene for context.\n` : ""}
ROLEPLAY EXCERPT:
${excerpt}

Reply now with one line starting with FINAL_IMAGE_PROMPT:`;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    if (!body.messages?.length || !body.ollamaBaseUrl || !body.modelId) {
      return Response.json(
        { error: "messages, ollamaBaseUrl and modelId are required" },
        { status: 400 }
      );
    }

    // Plain-text generation (no JSON mode — the output IS the prompt)
    const res = await fetch(`${body.ollamaBaseUrl.replace(/\/$/, "")}/api/generate`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model:  body.modelId,
        prompt: buildDirectorPrompt(body),
        stream: false,
        options: { temperature: 0.6, num_predict: 1200 },
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) {
      return Response.json(
        { error: `Ollama HTTP ${res.status} — is the utility model pulled and Ollama running?` },
        { status: 502 }
      );
    }
    const data = (await res.json()) as { response?: string; error?: string };
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
        { error: `utility model returned nothing${data.error ? `: ${data.error}` : ""}` },
        { status: 502 }
      );
    }
    return Response.json({ ok: true, prompt });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
