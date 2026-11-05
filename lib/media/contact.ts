// ─── Contact & media settings ─────────────────────────────────────────────────
// The master switches for everything in docs/plan-contact-media.md. Off until
// the user turns them on: while `enabled` is false nothing generates, sends or
// reaches out, and no prompt tells the model it could. Stored on the server
// (app_kv) so a later server-side outreach reads the same switches.

import type { CharacterOutreach, OutreachSettings, StoryTrigger } from "@/lib/outreach/rules";

export interface ContactSettings extends OutreachSettings {
  /** Master switch: Settings → Contact & media */
  enabled: boolean;
  /** Show each media prompt for approval before anything is generated */
  reviewMedia: boolean;
  /** What you are up to, shown to characters who reach out ("at work until six") */
  userNote: string;
  /** Browser notifications for messages in chats you are not looking at */
  notifications: boolean;
}

export const DEFAULT_CONTACT: ContactSettings = {
  enabled: false, reviewMedia: true, paused: false, userStatus: "available", userNote: "",
  quietStart: 23 * 60, quietEnd: 8 * 60, dailyLimit: 3, notifications: false,
};

const minutes = (v: unknown, d: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < 1440 ? (v as number) : d);

export function cleanContactSettings(raw: unknown): ContactSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const limit = Number(r.dailyLimit);
  return {
    enabled: r.enabled === true,
    reviewMedia: r.reviewMedia !== false,
    paused: r.paused === true,
    userStatus: r.userStatus === "away" || r.userStatus === "dnd" ? r.userStatus : "available",
    userNote: typeof r.userNote === "string" ? r.userNote.trim().slice(0, 120) : "",
    quietStart: minutes(r.quietStart, DEFAULT_CONTACT.quietStart),
    quietEnd: minutes(r.quietEnd, DEFAULT_CONTACT.quietEnd),
    dailyLimit: Number.isInteger(limit) && limit >= 0 && limit <= 20 ? limit : DEFAULT_CONTACT.dailyLimit,
    notifications: r.notifications === true,
  };
}

/** Per character, on the character row. Not a card field: it is the user's choice, not the card's. */
export interface CharacterContact extends CharacterOutreach {
  /** May send you photos of themselves */
  photos?: boolean;
}

export const STORY_TRIGGERS: ReadonlyArray<{ id: StoryTrigger; label: string; hint: string }> = [
  { id: "promise", label: "A promise", hint: "they promised you something that is still open" },
  { id: "repair", label: "Repair", hint: "trust was recently broken and they want to say something" },
  { id: "question", label: "An unanswered question", hint: "they asked you something and you went quiet" },
  { id: "absence", label: "A long absence", hint: "a day or more without hearing from you" },
];

/** May this character offer photos? Both switches, and nothing else, decide. */
export const mayOfferPhotos = (settings: ContactSettings, who: { contact?: CharacterContact } | undefined) =>
  settings.enabled && !!who?.contact?.photos;
