// ─── Reading a picture you sent ───────────────────────────────────────────────
// Server-only. A picture you attach to a message is described once, in a
// sentence or two, by a model that can see images (the "picture reader" in
// Settings → Chat models). The chat model then reads that description like any
// other attachment ("[sent a photo: …]"), so any chat model understands it and
// memory picks it up. Works with Ollama (`images`), LM Studio and OpenRouter
// (OpenAI-style image parts). OpenRouter's key is the one the server holds.

import { getStore } from "@/lib/db";
import { decryptSecret, loadKey } from "@/lib/server/secrets";
import { readJsonCapped, resized } from "@/lib/server/assets";
import type { ProviderType } from "@/lib/llm/callers";
import path from "node:path";

const OPENROUTER_API_BASE = "https://openrouter.ai/api";

export interface VisionBackend { providerType: ProviderType; providerBaseUrl: string; modelId: string }

function openRouterKey(): string | null {
  const blob = getStore().getKv("secret:openrouterApiKey");
  const dir = path.dirname(process.env.FABLE_DB_PATH ?? path.join(process.cwd(), "data", "x"));
  return blob ? decryptSecret(blob, loadKey(dir)) : null;
}

/** What a reasoning model wrote before its answer is not the answer. */
export function cleanDescription(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^[\s\S]*<\/think>/i, "")
    .replace(/^\s*(description|caption)\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

/**
 * Describe a picture. Big pictures are sent at 1024 px wide (when the optional
 * `sharp` is installed), which is plenty to read and much faster.
 */
export async function describeImage(backend: VisionBackend, hash: string, bytes: Buffer, mime: string, prompt: string, timeoutMs = 120_000): Promise<string> {
  const small = await resized(hash, bytes, 1024).catch(() => null);
  const data = (small ?? bytes).toString("base64");
  const type = small ? "image/webp" : mime;
  const { providerType, providerBaseUrl, modelId } = backend;

  let text: string | undefined;
  if (providerType === "ollama") {
    const res = await fetch(`${providerBaseUrl}/api/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelId, stream: false, messages: [{ role: "user", content: prompt, images: [data] }] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const j = (await readJsonCapped(res).catch(() => null)) as { message?: { content?: string }; error?: string } | null;
    if (!res.ok || typeof j?.message?.content !== "string") throw new Error(j?.error ?? `Ollama HTTP ${res.status}`);
    text = j.message.content;
  } else {
    const base = providerType === "openrouter" ? OPENROUTER_API_BASE : providerBaseUrl;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (providerType === "openrouter") {
      const key = openRouterKey();
      if (!key) throw new Error("no OpenRouter key is saved (Settings → Chat models)");
      headers.Authorization = `Bearer ${key}`;
    }
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST", headers,
      body: JSON.stringify({
        model: modelId, stream: false,
        messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:${type};base64,${data}` } }] }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const j = (await readJsonCapped(res).catch(() => null)) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } | string } | null;
    const content = j?.choices?.[0]?.message?.content;
    if (!res.ok || typeof content !== "string") {
      const detail = typeof j?.error === "string" ? j.error : j?.error?.message;
      throw new Error(detail ?? `HTTP ${res.status}`);
    }
    text = content;
  }
  const out = cleanDescription(text ?? "");
  if (!out) throw new Error("the model answered with nothing (is it a model that can see images?)");
  return out;
}
