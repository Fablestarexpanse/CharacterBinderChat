// ─── Photo messages ───────────────────────────────────────────────────────────
// A character's "[photo: …]" in a reply (only when you allowed them to send
// photos), or your "Ask for a photo", becomes an attachment on a message:
// optionally reviewed, then drawn with the character's look (tags, LoRA,
// references, likeness workflow), stored as an asset, and remembered as a
// dated fact so the character knows what they sent.

import { useFableStore } from "@/lib/store";
import { getJson, sendJson } from "@/lib/api/client";
import { queueImage } from "@/lib/chat/imageGen";
import { storePicture } from "@/lib/chat/assets";
import { clientPromptTemplate } from "@/lib/chat/promptOverrides";
import { renderTemplate } from "@/lib/prompts/render";
import { settingsForPerson } from "@/lib/media/imageLook";
import { DEFAULT_CONTACT, cleanContactSettings, type ContactSettings } from "@/lib/media/contact";
import type { WorkflowSummary } from "@/lib/api/dto";
import type { Attachment, Character, ImageJob } from "@/lib/types";

// ── Markers ───────────────────────────────────────────────────────────────────

const MARKER = /^[ \t]*\[(?:photo|selfie|picture)\s*:\s*([^\]\n]{1,300})\]\s*$/gim;

/** The reply without its photo markers, and what the (first) photo should show. */
export function takePhotoMarkers(text: string): { text: string; photo: string | null } {
  let photo: string | null = null;
  const clean = text.replace(MARKER, (_whole, what: string) => {
    photo ??= what.trim().replace(/^["']|["']$/g, "");
    return "";
  }).replace(/\n{3,}/g, "\n\n").trim();
  return { text: clean, photo };
}

// ── Settings (cached) ─────────────────────────────────────────────────────────

let settingsCache: { at: number; value: ContactSettings } | null = null;

export async function contactSettings(): Promise<ContactSettings> {
  if (settingsCache && Date.now() - settingsCache.at < 5000) return settingsCache.value;
  try {
    const value = cleanContactSettings(await getJson<unknown>("/api/contact-settings"));
    settingsCache = { at: Date.now(), value };
    return value;
  } catch {
    return settingsCache?.value ?? DEFAULT_CONTACT;
  }
}
export const forgetContactSettings = () => { settingsCache = null; };

// ── The pipeline ──────────────────────────────────────────────────────────────

const newId = () => `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** Wait for an image job in the store to finish. */
function waitForJob(jobId: string): Promise<ImageJob> {
  return new Promise((resolve) => {
    const check = (jobs: ImageJob[]) => {
      const j = jobs.find((x) => x.id === jobId);
      if (j && (j.status === "complete" || j.status === "failed")) { unsub(); resolve(j); return true; }
      return false;
    };
    const unsub = useFableStore.subscribe((s) => { check(s.imageJobs); });
    if (check(useFableStore.getState().imageJobs)) unsub();
  });
}

/**
 * Put a photo on a message. With review on, it waits as a prompt you can change
 * and approve; otherwise it is made straight away.
 */
export async function startPhoto(chatId: string, messageId: string, character: Character, what: string): Promise<void> {
  const settings = await contactSettings();
  const prompt = renderTemplate(await clientPromptTemplate("image.photo"), { what });
  const att: Attachment = { id: newId(), kind: "image", status: "pending", prompt, awaitingReview: settings.reviewMedia };
  useFableStore.getState().setAttachment(chatId, messageId, att);
  if (!settings.reviewMedia) await makePhoto(chatId, messageId, att.id, character.id);
}

/** Make (or re-make) a photo attachment with its current prompt. */
export async function makePhoto(chatId: string, messageId: string, attachmentId: string, characterId: string, promptOverride?: string): Promise<void> {
  const st = useFableStore.getState();
  const msg = st.chats.find((c) => c.id === chatId)?.messages.find((m) => m.id === messageId);
  const att = msg?.attachments?.find((a) => a.id === attachmentId);
  const character = st.characters.find((c) => c.id === characterId);
  if (!msg || !att || !character) return;
  const prompt = (promptOverride ?? att.prompt ?? "").trim();
  if (!prompt) return;
  const update = (patch: Partial<Attachment>) => {
    const cur = useFableStore.getState().chats.find((c) => c.id === chatId)?.messages.find((m) => m.id === messageId)?.attachments?.find((a) => a.id === attachmentId);
    if (cur) useFableStore.getState().setAttachment(chatId, messageId, { ...cur, ...patch });
  };
  update({ status: "pending", awaitingReview: false, error: undefined, prompt });

  const workflows = character.image?.likeness
    ? await getJson<{ workflows?: WorkflowSummary[] }>("/api/workflows").then((d) => d.workflows ?? []).catch(() => [])
    : [];
  const settings = settingsForPerson({ ...st.imageSettings, prompt, batchCount: 1 }, character, workflows);
  const job = queueImage(settings, chatId);
  update({ jobId: job.id, workflow: settings.workflow, negativePrompt: settings.negativePrompt, seed: settings.seed >= 0 ? settings.seed : undefined });
  const done = await waitForJob(job.id);
  if (done.status === "failed" || done.outputUrls.length === 0) {
    update({ status: "failed", error: done.error ?? "no picture came back" });
    return;
  }
  try {
    const url = await storePicture(done.outputUrls[0]);
    // A redo keeps the take it replaces, so you can go back to it
    const before = useFableStore.getState().chats.find((c) => c.id === chatId)?.messages.find((m) => m.id === messageId)?.attachments?.find((a) => a.id === attachmentId);
    const previous = att.url && att.url !== url ? [{ url: att.url, prompt: att.prompt }, ...(att.previous ?? [])].slice(0, 6) : before?.previous;
    update({ status: "ready", url, ...(previous ? { previous } : {}) });
  } catch (e) {
    update({ status: "failed", error: e instanceof Error ? e.message : String(e) });
    return;
  }
  // Remembered like anything else: a dated fact the character can recall
  await sendJson("POST", "/api/drawer/facts", {
    chatId, subjectId: character.id, predicate: "sent_photo", objectLiteral: prompt.slice(0, 300), importance: 0.5,
  }).catch((e: Error) => console.warn("[photo] could not record it in memory:", e.message));
}

/** You asked: a new message from the character carrying the photo. */
export async function askForPhoto(chatId: string, character: Character, what: string, channel: "scene" | "text"): Promise<void> {
  const st = useFableStore.getState();
  const messageId = st.addMessage(chatId, {
    chatId, role: "assistant", content: "", characterId: character.id, ...(channel === "text" ? { channel } : {}),
  });
  await startPhoto(chatId, messageId, character, what.trim() || "a photo of themselves, right now");
}
