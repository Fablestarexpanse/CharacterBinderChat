// ─── Text messages and attachments in the story ───────────────────────────────
// Client-safe and pure. A message is in person (the default) or a phone text;
// it may carry photos, clips or voice notes. These helpers decide how that
// reaches the model, so the prompt, Peek Prompt and extraction agree.

import type { Attachment, Message, MessageChannel } from "@/lib/types";

export const channelOf = (m: Pick<Message, "channel">): MessageChannel => m.channel ?? "scene";

/** A reply goes out the way the last thing you sent came in. */
export function replyChannel(messages: Array<Pick<Message, "role" | "channel" | "error">>): MessageChannel {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user" && !m.error) return channelOf(m);
  }
  return "scene";
}

const KIND_WORD: Record<Attachment["kind"], string> = { image: "a photo", video: "a video", audio: "a voice note" };

/** What the model is told an attachment was ("sent a photo: by the river at dusk"). Pending/failed ones are left out. */
export function attachmentNote(a: Attachment): string | null {
  if (a.status !== "ready") return null;
  return `[sent ${KIND_WORD[a.kind]}${a.prompt ? `: ${a.prompt.slice(0, 200)}` : ""}]`;
}

/** A message as the model reads it: marked when it was a text, with its attachments described. */
export function historyContent(m: Pick<Message, "content" | "channel" | "attachments">): string {
  const notes = (m.attachments ?? []).map(attachmentNote).filter((n): n is string => !!n);
  const body = [m.content.trim(), ...notes].filter(Boolean).join("\n");
  return channelOf(m) === "text" && body ? `(by text) ${body}` : body;
}

/** Whether a message has anything for the model at all (text, or an attachment that is ready). */
export const hasHistoryContent = (m: Pick<Message, "content" | "attachments">) =>
  m.content.trim().length > 0 || (m.attachments ?? []).some((a) => a.status === "ready");
