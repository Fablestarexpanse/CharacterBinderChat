// ─── Renders: what uses one, removing it, and putting it back ────────────────
// A render is an ImageJob (one or more pictures from one ComfyUI prompt). Its
// pictures are ComfyUI URLs until something keeps one: setting it as a portrait
// or a reference stores the bytes as an asset and records that asset URL on the
// job (`keptAs`), so "what uses this render?" can be answered by URL match.
//
// Removing a render takes its image cards out of chats with it (a card with no
// job behind it is a dangling reference). What a character or persona kept is
// its own asset row, so it survives; gcAssets keeps the bytes while anything
// still refers to them. Pure and client-safe: the store and Image Studio call it.

import type { Character, Chat, ImageJob, Message } from "@/lib/types";
import type { ImageLook } from "@/lib/media/imageLook";

type Person = Pick<Character, "id" | "name" | "avatar" | "referenceImages">;

export interface RenderUsage {
  /** Image cards showing this render, per chat (they are removed with it) */
  cards: { chatId: string; chatName: string; count: number }[];
  /** People whose portrait is a kept copy of this render (they keep it) */
  portraitOf: string[];
  /** People who keep a copy of it among their reference pictures (they keep it) */
  referenceOf: string[];
}

const bare = (url: string) => url.split("?")[0];

/** Everything that points at this render, and what deleting it does to each. */
export function renderUsage(
  job: Pick<ImageJob, "id" | "keptAs">,
  chats: Pick<Chat, "id" | "name" | "messages">[],
  people: Person[],
): RenderUsage {
  const cards = chats
    .map((c) => ({ chatId: c.id, chatName: c.name, count: c.messages.filter((m) => m.imageJobId === job.id).length }))
    .filter((c) => c.count > 0);
  const kept = new Set(Object.values(job.keptAs ?? {}).map(bare));
  const portraitOf = kept.size ? people.filter((p) => p.avatar && kept.has(bare(p.avatar))).map((p) => p.name) : [];
  const referenceOf = kept.size
    ? people.filter((p) => (p.referenceImages ?? []).some((r) => kept.has(bare(r)))).map((p) => p.name)
    : [];
  return { cards, portraitOf, referenceOf };
}

export const renderIsUsed = (u: RenderUsage) => u.cards.length + u.portraitOf.length + u.referenceOf.length > 0;

/** What a removal took, with positions, so Undo can put each piece back where it was. */
export interface RemovedRenders {
  jobs: { job: ImageJob; index: number }[];
  messages: { chatId: string; message: Message; index: number }[];
}

/** Remove renders and every image card that shows them. Unknown ids are ignored. */
export function removeRenders<C extends Pick<Chat, "id" | "messages">>(
  imageJobs: ImageJob[],
  chats: C[],
  jobIds: string[],
): { imageJobs: ImageJob[]; chats: C[]; removed: RemovedRenders } {
  const doomed = new Set(jobIds);
  const removed: RemovedRenders = { jobs: [], messages: [] };
  if (doomed.size === 0) return { imageJobs, chats, removed };
  const keptJobs = imageJobs.filter((job, index) => {
    if (!doomed.has(job.id)) return true;
    removed.jobs.push({ job, index });
    return false;
  });
  const nextChats = chats.map((c) => {
    const kept = c.messages.filter((message, index) => {
      if (!message.imageJobId || !doomed.has(message.imageJobId)) return true;
      removed.messages.push({ chatId: c.id, message, index });
      return false;
    });
    return kept.length === c.messages.length ? c : { ...c, messages: kept };
  });
  return { imageJobs: removed.jobs.length ? keptJobs : imageJobs, chats: nextChats, removed };
}

/**
 * Put removed renders back at their old positions (clamped to what is there now).
 * Anything already back is skipped, and a card whose chat has since been deleted
 * stays gone rather than recreating the chat.
 */
export function restoreRenders<C extends Pick<Chat, "id" | "messages">>(
  imageJobs: ImageJob[],
  chats: C[],
  removed: RemovedRenders,
): { imageJobs: ImageJob[]; chats: C[] } {
  const jobs = [...imageJobs];
  for (const { job, index } of [...removed.jobs].sort((a, b) => a.index - b.index)) {
    if (jobs.some((j) => j.id === job.id)) continue;
    jobs.splice(Math.min(index, jobs.length), 0, job);
  }
  const byChat = new Map<string, RemovedRenders["messages"]>();
  for (const m of removed.messages) byChat.set(m.chatId, [...(byChat.get(m.chatId) ?? []), m]);
  const nextChats = chats.map((c) => {
    const back = byChat.get(c.id);
    if (!back) return c;
    const messages = [...c.messages];
    for (const { message, index } of [...back].sort((a, b) => a.index - b.index)) {
      if (messages.some((m) => m.id === message.id)) continue;
      messages.splice(Math.min(index, messages.length), 0, message);
    }
    return messages.length === c.messages.length ? c : { ...c, messages };
  });
  return { imageJobs: jobs, chats: nextChats };
}

/**
 * A starting point for a new character's image look from the prompt that made
 * the render: the prompt is already written for an image model, so it is the
 * tags as they stand, trimmed to what cleanImageLook keeps. Undefined when empty.
 */
export function lookFromRenderPrompt(prompt: string | undefined): ImageLook | undefined {
  const tags = (prompt ?? "").replace(/\s+/g, " ").trim().slice(0, 1000).trim();
  return tags ? { tags } : undefined;
}
