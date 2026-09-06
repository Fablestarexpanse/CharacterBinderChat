// ─── Scene image generation ───────────────────────────────────────────────────
// One entry point for "make an image of this scene", used by the /image
// command (scene = end of chat) and the per-message generate button (scene =
// the story up to THAT message, with the card inserted right after it).
//
// Pipeline: recent messages + character appearance → scene-director route on
// the local uncensored utility model → distilled visual prompt → ComfyUI job
// → image message placed at the right spot in the chat.

import { useFableStore, DEFAULT_UTILITY_MODEL } from "@/lib/store";
import { ComfyUIProvider } from "@/lib/providers/comfyui";
import { sendJson } from "@/lib/api/client";
import type { ImageJob, ImageGenerationSettings } from "@/lib/types";

/**
 * The one way to start an image render. Creates the job, registers it with the
 * store, and runs the ComfyUI pipeline in the background; progress lands
 * through the store's updateImageJob. Returns immediately with status "queued".
 *
 * This lives here rather than in the ComfyUI adapter because the lifecycle is
 * app-layer work — it touches the store and calls one of the app's own routes.
 * The adapter underneath it is transport only.
 */
export function queueImage(settings: ImageGenerationSettings, chatId?: string): ImageJob {
  const store = useFableStore.getState();
  const comfyui = new ComfyUIProvider(store.providerSettings.comfyui.baseUrl);
  const job: ImageJob = {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `job-${Math.random().toString(36).slice(2)}`,
    chatId,
    prompt: settings.prompt,
    status: "queued",
    settings,
    outputUrls: [],
    createdAt: new Date().toISOString(),
  };
  store.addImageJob(job);

  void (async () => {
    const onUpdate = useFableStore.getState().updateImageJob;
    try {
      // ComfyUI and Ollama share one GPU: evict Ollama's resident models
      // first or the UNet load thrashes for minutes. Best-effort — Ollama
      // reloads on demand after the render.
      await fetch("/api/ollama/unload", { method: "POST" }).catch(() => {});
      if (!(await comfyui.checkConnection())) {
        throw new Error(
          `ComfyUI is not reachable at ${comfyui.baseUrl}. Start ComfyUI (or fix the URL in Settings) and try again.`
        );
      }
      const promptId = await comfyui.queuePrompt(await comfyui.prepareWorkflow(settings));
      onUpdate(job.id, { status: "generating", promptId });
      onUpdate(job.id, {
        status: "complete",
        outputUrls: await comfyui.waitForImages(promptId),
        completedAt: new Date().toISOString(),
      });
    } catch (err) {
      onUpdate(job.id, {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        completedAt: new Date().toISOString(),
      });
    }
  })();

  return job;
}

export interface SceneImageOptions {
  /** Generate for the story as it stood at this message; the image card is
   *  inserted immediately after it. Omit = current end of chat. */
  uptoMessageId?: string;
  /** Optional shot guidance ("close-up on her face") */
  focus?: string;
  /** Phase callback for UI spinners */
  onPhase?: (phase: "directing" | "queued" | "failed") => void;
}

export async function generateSceneImage(
  chatId: string,
  { uptoMessageId, focus, onPhase }: SceneImageOptions = {}
): Promise<{ ok: boolean; error?: string }> {
  const store = useFableStore.getState();
  const chat = store.chats.find((c) => c.id === chatId);
  if (!chat) return { ok: false, error: "chat not found" };

  const character = store.characters.find((c) => c.id === chat.characterId);
  const persona = store.personas.find((p) => p.id === store.activePersonaId);

  // The story up to the anchor point (inclusive)
  let messages = chat.messages;
  if (uptoMessageId) {
    const idx = messages.findIndex((m) => m.id === uptoMessageId);
    if (idx !== -1) messages = messages.slice(0, idx + 1);
  }
  const sceneMessages = messages
    .filter((m) => !m.error && !m.imageJobId && m.content.trim())
    .slice(-8)
    .map((m) => ({
      role: m.role,
      content: m.content,
      speaker: m.role === "user"
        ? persona?.name ?? "User"
        : store.characters.find((c) => c.id === m.characterId)?.name ?? character?.name ?? "Character",
    }));

  // ── Director: distill the scene into a visual prompt ────────────────────
  let prompt = focus ?? "";
  if (sceneMessages.length > 0) {
    onPhase?.("directing");
    try {
      const data = await sendJson<{ prompt?: string }>("POST", "/api/image/scene-prompt", {
        messages:      sceneMessages,
        focus:         focus || undefined,
        appearance:    character
          ? [character.name + ":", character.description, character.personality].filter(Boolean).join("\n")
          : undefined,
        ollamaBaseUrl: store.providerSettings.ollama.baseUrl,
        modelId:       store.providerSettings.ollama.utilityModel ?? DEFAULT_UTILITY_MODEL,
      });
      if (data.prompt) {
        prompt = data.prompt;
      } else if (!focus) {
        onPhase?.("failed");
        return { ok: false, error: "scene director failed" };
      }
    } catch (e) {
      // With a focus the user typed, their words are the prompt and the
      // director is only an enhancement — without one there is nothing to
      // render, so the failure has to surface.
      if (!focus) {
        onPhase?.("failed");
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
  }
  if (!prompt.trim()) {
    onPhase?.("failed");
    return { ok: false, error: "nothing to render — empty scene and no prompt" };
  }

  // ── Queue to ComfyUI + place the card ───────────────────────────────────
  onPhase?.("queued");
  const job = queueImage({ ...store.imageSettings, prompt }, chatId);

  const imageMessage = {
    chatId,
    role: "assistant" as const,
    content: prompt,
    imageJobId: job.id,
  };
  if (uptoMessageId) {
    store.insertMessageAfter(chatId, uptoMessageId, imageMessage);
  } else {
    store.addMessage(chatId, imageMessage);
  }
  return { ok: true };
}
