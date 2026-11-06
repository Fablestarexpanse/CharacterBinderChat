// ─── Clips from photos ────────────────────────────────────────────────────────
// A ready photo on a message can become a short clip with sound: the photo is
// the first frame of a ComfyUI video workflow (the bundled one is MiniMax H3
// image-to-video). Like photos: an attachment on the same message, optionally
// reviewed first, stored as an asset, remembered as a dated fact. Only while
// Contact & media is on.

import { useFableStore } from "@/lib/store";
import { getJson, sendJson } from "@/lib/api/client";
import { queueImage, cancelImageJob } from "@/lib/chat/imageGen";
import { storeClip } from "@/lib/chat/assets";
import { clientPromptTemplate } from "@/lib/chat/promptOverrides";
import { renderTemplate } from "@/lib/prompts/render";
import { contactSettings, waitForJob } from "@/lib/chat/photos";
import { whileMaking } from "@/lib/chat/inflight";
import { referencesFor } from "@/lib/media/imageLook";
import { clipPeople, isReferenceWorkflow, referenceLines } from "@/lib/media/clipRefs";
import { presentMemberIds } from "@/lib/chat/generation";
import type { WorkflowSummary } from "@/lib/api/dto";
import type { Attachment } from "@/lib/types";

/** The bundled image-to-video workflow (workflows/h3-image-to-video.json) */
export const BUNDLED_VIDEO = "h3-image-to-video";

/** H3's ~5 s, the shortest length it was trained on (24 fps, 17k+5 grid) */
export const CLIP_FRAMES = 124;

/** Local video takes minutes; a 5 s H3 clip on a 4090 is about one to three. */
const CLIP_TIMEOUT_MS = 30 * 60 * 1000;

const DEFAULT_MOTION = "They look into the camera, breathe, and give a small natural smile; the background moves gently";

/** The bundled reference workflow (workflows/h3-reference-clip.json): keeps everyone's look */
export const BUNDLED_REFERENCE_VIDEO = "h3-reference-clip";

type VideoWorkflowInfo = Pick<WorkflowSummary, "slug" | "source" | "purpose" | "controls" | "error"> & { classTypes?: string[] };

/**
 * Which workflow makes clips. With people who have pictures, a reference
 * workflow (H3 Ref2VA: every face held) is preferred: one of yours, else the
 * bundled one. Otherwise, or without one, a first-frame workflow: yours, else
 * the bundled one. Null when there is none.
 */
export function videoWorkflow(workflows: VideoWorkflowInfo[], withPeople = false): { slug: string; reference: boolean } | null {
  const ok = workflows.filter((w) => !w.error && w.purpose === "video" && w.controls.includes("referenceImage"));
  const isRef = (w: VideoWorkflowInfo) => isReferenceWorkflow(w.classTypes ?? []);
  const refs = ok.filter(isRef), frames = ok.filter((w) => !isRef(w));
  const pick = (list: VideoWorkflowInfo[], bundled: string) => list.find((w) => w.source === "imported") ?? list.find((w) => w.slug === bundled);
  const ref = withPeople ? pick(refs, BUNDLED_REFERENCE_VIDEO) : undefined;
  if (ref) return { slug: ref.slug, reference: true };
  const frame = pick(frames, BUNDLED_VIDEO);
  return frame ? { slug: frame.slug, reference: false } : null;
}

const newId = () => `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const findAttachment = (chatId: string, messageId: string, attachmentId: string) =>
  useFableStore.getState().chats.find((c) => c.id === chatId)?.messages.find((m) => m.id === messageId)?.attachments?.find((a) => a.id === attachmentId);

/**
 * Start a clip from a ready photo on the message. With review on it waits for
 * you to say what should happen; otherwise it is made straight away.
 */
export async function startClip(chatId: string, messageId: string, photo: Attachment, characterId: string): Promise<void> {
  if (photo.kind !== "image" || photo.status !== "ready" || !photo.url) return;
  const settings = await contactSettings();
  const att: Attachment = {
    id: newId(), kind: "video", status: "pending", from: photo.url,
    prompt: DEFAULT_MOTION, awaitingReview: settings.reviewMedia,
  };
  useFableStore.getState().setAttachment(chatId, messageId, att);
  if (!settings.reviewMedia) await makeClip(chatId, messageId, att.id, characterId);
}

/** Make (or re-make) a clip attachment. `motion` replaces what happens in it. */
export function makeClip(chatId: string, messageId: string, attachmentId: string, characterId: string, motion?: string): Promise<void> {
  return whileMaking(attachmentId, () => clipNow(chatId, messageId, attachmentId, characterId, motion));
}

async function clipNow(chatId: string, messageId: string, attachmentId: string, characterId: string, motion?: string): Promise<void> {
  const st = useFableStore.getState();
  const att = findAttachment(chatId, messageId, attachmentId);
  const character = st.characters.find((c) => c.id === characterId);
  if (!att || att.kind !== "video" || !att.from) return;
  const update = (patch: Partial<Attachment>) => {
    const cur = findAttachment(chatId, messageId, attachmentId);
    if (cur) useFableStore.getState().setAttachment(chatId, messageId, { ...cur, ...patch });
  };
  // Try again must say why it cannot, not do nothing
  if (!character) { update({ status: "failed", awaitingReview: false, error: "The character who sent this clip no longer exists." }); return; }
  const what = (motion ?? att.prompt ?? "").trim();
  if (!what) { update({ status: "failed", awaitingReview: false, error: "There is nothing to say what happens in the clip." }); return; }
  update({ status: "pending", awaitingReview: false, error: undefined, prompt: what });

  // The master switch decides, here as for photos: nothing is made while it is off
  if (!(await contactSettings()).enabled) {
    update({ status: "failed", error: "Contact & media is off (Settings → Contact & media)." });
    return;
  }
  // Everyone in the scene, with one picture each: the sender, your persona, and others present in a group
  const chat = st.chats.find((c) => c.id === chatId);
  const others = chat ? presentMemberIds(chat, st.characters).filter((id) => id !== character.id) : [];
  const persona = st.personas.find((p) => p.id === st.activePersonaId);
  const people = clipPeople([
    { name: character.name, picture: referencesFor(character)[0] },
    persona && { name: persona.name, picture: referencesFor(persona)[0] },
    ...others.map((id) => st.characters.find((c) => c.id === id)).map((c) => c && { name: c.name, picture: referencesFor(c)[0] }),
  ]);
  const workflows = await getJson<{ workflows?: WorkflowSummary[] }>("/api/workflows").then((d) => d.workflows ?? []).catch(() => []);
  const chosen = videoWorkflow(workflows, people.length > 0);
  if (!chosen) {
    update({ status: "failed", error: "No video workflow that takes a picture. Import one on the Workflows screen." });
    return;
  }
  // No image look here: the photo already shows them. A reference workflow is
  // told who is who (<Picture 1> the photo, <Subject N> each person); a
  // first-frame one is told only what happens, not what it looks like.
  let prompt: string;
  if (chosen.reference) {
    const r = referenceLines(people);
    prompt = renderTemplate(await clientPromptTemplate("video.reference-clip"), { motion: what, subjects: r.subjects, retention: r.retention, people: r.names });
  } else {
    prompt = renderTemplate(await clientPromptTemplate("video.clip"), { motion: what });
  }
  const job = queueImage({
    ...st.imageSettings, workflow: chosen.slug, prompt, negativePrompt: "", loras: [], batchCount: 1,
    referenceImages: chosen.reference ? [att.from, ...people.map((p) => p.picture)] : [att.from], videoLength: CLIP_FRAMES,
  }, chatId, { timeoutMs: CLIP_TIMEOUT_MS, kind: "video" });
  update({ jobId: job.id, workflow: chosen.slug });
  const done = await waitForJob(job.id);
  if (done.status === "failed" || done.outputUrls.length === 0) {
    update({ status: "failed", jobId: undefined, error: done.error ?? "no clip came back" });
    return;
  }
  try {
    const url = await storeClip(done.outputUrls[0], { who: character.name });
    const before = findAttachment(chatId, messageId, attachmentId);
    const previous = before?.url && before.url !== url ? [{ url: before.url, prompt: before.prompt }, ...(before.previous ?? [])].slice(0, 6) : before?.previous;
    update({ status: "ready", url, jobId: undefined, ...(previous ? { previous } : {}) });
  } catch (e) {
    update({ status: "failed", jobId: undefined, error: e instanceof Error ? e.message : String(e) });
    return;
  }
  await sendJson("POST", "/api/drawer/facts", {
    chatId, subjectId: character.id, predicate: "sent_video", objectLiteral: what.slice(0, 300), importance: 0.5,
  }).catch((e: Error) => console.warn("[clip] could not record it in memory:", e.message));
}

/** Stop a clip that is being made. */
export async function cancelClip(chatId: string, messageId: string, attachmentId: string): Promise<void> {
  const att = findAttachment(chatId, messageId, attachmentId);
  if (att?.jobId) await cancelImageJob(att.jobId);
}
