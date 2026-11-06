// ─── Text messages and attachments in the story ───────────────────────────────
// Client-safe and pure. A message is in person (the default) or a phone text;
// it may carry photos, clips or voice notes. These helpers decide how that
// reaches the model, so the prompt, Peek Prompt and extraction agree.

import type { Attachment, CallEvent, Message, MessageChannel } from "@/lib/types";

export const channelOf = (m: Pick<Message, "channel">): MessageChannel => m.channel ?? "scene";

/** A reply goes out the way the last thing you sent came in. */
export function replyChannel(messages: Array<Pick<Message, "role" | "channel" | "error" | "callEvent">>): MessageChannel {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    // A call starting or ending is not something you said: after hanging up, the reply is not "on the phone"
    if (m.role === "user" && !m.error && !m.callEvent) return channelOf(m);
  }
  return "scene";
}

const KIND_WORD: Record<Attachment["kind"], string> = { image: "a photo", video: "a video", audio: "a voice note" };

/** What the model is told an attachment was ("sent a photo: by the river at dusk"). Pending/failed ones are left out. */
export function attachmentNote(a: Attachment): string | null {
  if (a.status !== "ready") return null;
  return `[sent ${KIND_WORD[a.kind]}${a.prompt ? `: ${a.prompt.slice(0, 200)}` : ""}]`;
}

/** How long a call lasted, the way a phone shows it: "0:42", "12:05" */
export function callLength(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** What the model is told a call line was. Who called is the line's role: yours if you called. */
export function callNote(e: CallEvent): string {
  switch (e.kind) {
    case "started": return "[phone call starts]";
    case "ended": return `[phone call ends${e.seconds ? ` after ${Math.max(1, Math.round(e.seconds / 60))} min` : ""}]`;
    case "missed": return "[missed phone call: no answer]";
    case "declined": return "[phone call declined]";
  }
}

/** A message as the model reads it: marked when it was a text or said on a call, with its attachments described. */
export function historyContent(m: Pick<Message, "content" | "channel" | "attachments" | "callEvent">): string {
  const notes = (m.attachments ?? []).map(attachmentNote).filter((n): n is string => !!n);
  if (m.callEvent) return callNote(m.callEvent);
  const body = [m.content.trim(), ...notes].filter(Boolean).join("\n");
  if (!body) return body;
  const ch = channelOf(m);
  return ch === "text" ? `(by text) ${body}` : ch === "call" ? `(on the phone) ${body}` : body;
}

/** Whether a message has anything for the model at all (text, or an attachment that is ready). */
export const hasHistoryContent = (m: Pick<Message, "content" | "attachments" | "callEvent">) =>
  !!m.callEvent || m.content.trim().length > 0 || (m.attachments ?? []).some((a) => a.status === "ready");

// ── "I text Ronan 'thinking of you'" ─────────────────────────────────────────
// Written as a story line, a text is still a text: the message is turned into a
// phone text holding just the words sent, so it shows (and reaches the model)
// as one. Only a line that is clearly that: a texting verb, someone in the
// chat (or him/her/them), then the words in quotes or after a colon.

const VERB = String.raw`(?:texts?|texted|texting|txts?|messages?|messaged|send(?:s)?\s+(?:a\s+)?(?:text|message)\s+to|sends?\s+(?:a\s+)?(?:text|message)|sent\s+(?:a\s+)?(?:text|message)(?:\s+to)?)`;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The words of a text, if `input` is a line saying you text someone in the chat.
 * Returns who (an id from `people`, or null for him/her/them) and what was sent.
 */
export function parseTextIntent(input: string, people: Array<{ id: string; name: string }>): { to: string | null; text: string } | null {
  const line = input.trim();
  if (!line || line.length > 2000) return null;
  const names = people.filter((p) => p.name.trim()).map((p) => ({ id: p.id, re: esc(p.name.trim()), first: esc(p.name.trim().split(/\s+/)[0]) }));
  const who = [...names.flatMap((n) => [n.re, n.first]), "him", "her", "them"].join("|");
  // [narration] I text NAME [narration] "words"   or   … NAME: words   or   I send NAME a text: "words"
  const re = new RegExp(String.raw`^[*(_\s]*(?:[^"“”]*?\b)?(?:i\s+|we\s+)?(?:${VERB}\s+(?:to\s+)?(${who})|send\s+(${who})\s+(?:a\s+)?(?:text|message))\b([^"“”:]*?)[*)_\s]*(?::\s*["“]?|,?\s*(?:saying|that says|:)?\s*["“])([\s\S]+?)["”]?[*)_\s.]*$`, "i");
  const m = re.exec(line);
  if (!m) return null;
  const target = (m[1] ?? m[2] ?? "").toLowerCase();
  let text = m[4].trim();
  // A quoted text ends at its closing quote; anything after it is not part of the words
  const close = text.search(/["”]/);
  if (close >= 0) {
    // More story after the closing quote ("…and put my phone away"): leave the line as you wrote it rather than drop those words
    if (!/^[\s.!?,*)_]*$/.test(text.slice(close + 1))) return null;
    text = text.slice(0, close).trim();
  }
  if (!text) return null;
  const found = names.find((n) => new RegExp(`^(?:${n.re}|${n.first})$`, "i").test(target));
  return { to: found?.id ?? null, text };
}
