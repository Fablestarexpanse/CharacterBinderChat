// ─── Scene image generation ───────────────────────────────────────────────────
// One entry point for "make an image of this scene", used by the /image
// command (scene = end of chat) and the per-message generate button (scene =
// the story up to THAT message, with the card inserted right after it).
//
// Pipeline: recent messages + character appearance → scene-director route on
// the local uncensored utility model → distilled visual prompt → ComfyUI job
// → image message placed at the right spot in the chat.

import { useFableStore, DEFAULT_UTILITY_MODEL } from "@/lib/store";
import { startImageJob } from "@/lib/providers/comfyui";

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
      const res = await fetch("/api/image/scene-prompt", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages:      sceneMessages,
          focus:         focus || undefined,
          appearance:    character
            ? [character.name + ":", character.description, character.personality].filter(Boolean).join("\n")
            : undefined,
          ollamaBaseUrl: store.providerSettings.ollama.baseUrl,
          modelId:       store.providerSettings.ollama.utilityModel ?? DEFAULT_UTILITY_MODEL,
        }),
      });
      const data = await res.json().catch(() => null) as { prompt?: string; error?: string } | null;
      if (res.ok && data?.prompt) {
        prompt = data.prompt;
      } else if (!focus) {
        onPhase?.("failed");
        return { ok: false, error: data?.error ?? "scene director failed" };
      }
    } catch (e) {
      if (!focus) {
        onPhase?.("failed");
        return { ok: false, error: String(e) };
      }
    }
  }
  if (!prompt.trim()) {
    onPhase?.("failed");
    return { ok: false, error: "nothing to render — empty scene and no prompt" };
  }

  // ── Queue to ComfyUI + place the card ───────────────────────────────────
  onPhase?.("queued");
  const job = startImageJob(
    store.providerSettings.comfyui.baseUrl,
    { ...store.imageSettings, prompt },
    chatId,
    store.updateImageJob
  );
  store.addImageJob(job);

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
