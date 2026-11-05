// ─── Pictures you send ────────────────────────────────────────────────────────
// Client-side. You attach a picture to a message (in person or by text); it is
// stored as an asset, put on your message, read once by the picture reader
// (Settings → Chat models, a model that can see images: /api/vision/describe),
// and only then does the character reply, so they know what you sent. The
// description is the attachment's `prompt`, which is how every attachment
// reaches the model ("[sent a photo: …]"). Without a reader, or if it fails,
// the picture still goes and you can describe it yourself on the message.

import { useFableStore } from "@/lib/store";
import { sendJson } from "@/lib/api/client";
import { uploadImage } from "@/lib/chat/assets";
import { generateAssistantReply, flushPendingExtraction } from "@/lib/chat/generation";
import { whileMaking } from "@/lib/chat/inflight";
import type { Attachment, MessageChannel } from "@/lib/types";

const newId = () => `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** The picture reader, when one is chosen */
export function pictureReader() {
  const s = useFableStore.getState().providerSettings;
  const v = s.vision;
  if (!v?.model) return null;
  const providerBaseUrl = v.provider === "ollama" ? s.ollama.baseUrl : v.provider === "lmstudio" ? s.lmstudio.baseUrl : "https://openrouter.ai";
  return { providerType: v.provider, providerBaseUrl, modelId: v.model };
}

/** Ask the picture reader what a stored picture shows. Rejects with the reason it could not. */
export async function describePicture(assetUrl: string, characterName?: string): Promise<string> {
  const reader = pictureReader();
  if (!reader) throw new Error("No picture reader is set up (Settings → Chat models).");
  const st = useFableStore.getState();
  const persona = st.personas.find((p) => p.id === st.activePersonaId);
  const r = await sendJson<{ ok?: boolean; description?: string; error?: string }>("POST", "/api/vision/describe", {
    assetUrl, ...reader, characterName, userLabel: persona?.name,
  });
  if (!r.description) throw new Error(r.error ?? "the picture reader gave no description");
  return r.description;
}

const findAttachment = (chatId: string, messageId: string, id: string) =>
  useFableStore.getState().chats.find((c) => c.id === chatId)?.messages.find((m) => m.id === messageId)?.attachments?.find((a) => a.id === id);

/** Read (or re-read) a picture you sent, and keep what it shows on the attachment. */
export function readPicture(chatId: string, messageId: string, attachmentId: string): Promise<void> {
  return whileMaking(attachmentId, () => readNow(chatId, messageId, attachmentId));
}

async function readNow(chatId: string, messageId: string, attachmentId: string): Promise<void> {
  const st = useFableStore.getState();
  const att = findAttachment(chatId, messageId, attachmentId);
  if (!att?.url) return;
  const chat = st.chats.find((c) => c.id === chatId);
  const character = st.characters.find((c) => c.id === chat?.characterId);
  const update = (patch: Partial<Attachment>) => {
    const cur = findAttachment(chatId, messageId, attachmentId);
    if (cur) useFableStore.getState().setAttachment(chatId, messageId, { ...cur, ...patch });
  };
  update({ status: "pending", error: undefined });
  try {
    update({ status: "ready", prompt: await describePicture(att.url, character?.name) });
  } catch (e) {
    // The picture still counts as sent; the character just is not told what it shows
    update({ status: "ready", error: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Send a picture, with or without words. The reply waits for the picture to be
 * read, so the character answers knowing what it shows.
 */
export async function sendPicture(chatId: string, file: Blob, text: string, channel: MessageChannel, speakerId?: string): Promise<void> {
  const url = await uploadImage(file);
  flushPendingExtraction();
  const att: Attachment = { id: newId(), kind: "image", status: "pending", url, fromUser: true };
  const messageId = useFableStore.getState().addMessage(chatId, {
    chatId, role: "user", content: text.trim(), attachments: [att], ...(channel !== "scene" ? { channel } : {}),
  });
  await readPicture(chatId, messageId, att.id);
  await generateAssistantReply(chatId, speakerId);
}
