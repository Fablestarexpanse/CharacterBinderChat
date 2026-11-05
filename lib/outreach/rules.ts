// ─── When a character reaches out ─────────────────────────────────────────────
// Pure rules, no model calls: a model is only asked to *write* the message once
// these say one is due. Hard limits come first and nothing gets past them:
// the master switch, Pause all, Do not disturb, the character's own
// "can contact me", quiet hours, the daily limit, the silence to wait and the
// follow-up limit. Then the reason: something in the story (Story), a check-in
// time (Timed), or either (Both).

export type ContactMode = "story" | "timed" | "both";
export type StoryTrigger = "promise" | "repair" | "question" | "absence";
export type TimedTrigger = "morning" | "evening" | "checkin";
export type Trigger = StoryTrigger | TimedTrigger;

export interface OutreachSettings {
  enabled: boolean;
  paused: boolean;
  /** "available" | "away" | "dnd": Do not disturb stops everything */
  userStatus: "available" | "away" | "dnd";
  /** Minutes after midnight; quiet when start > end wraps midnight (23:00–08:00) */
  quietStart: number;
  quietEnd: number;
  /** Most outreach messages per day, across all characters */
  dailyLimit: number;
}

export interface CharacterOutreach {
  canContact?: boolean;
  mode?: ContactMode;
  /** Story triggers switched off for this character */
  off?: StoryTrigger[];
  /** Minutes of silence before the first message (default 120) */
  waitMinutes?: number;
  /** Follow-ups while you stay silent (default 2); each waits twice as long as the last */
  maxFollowUps?: number;
  /** This character's own daily limit; can only lower the global one */
  dailyLimit?: number;
}

export interface ChatSignals {
  /** When you last wrote in this chat (ms), or null */
  lastUserAt: number | null;
  /** Outreach messages in this chat since your last message */
  sinceLastUser: number;
  /** When the last one of those was sent (ms) */
  lastOutreachAt: number | null;
  /** The character's last message ends with a question you never answered */
  unansweredQuestion: boolean;
  /** An active promise the character made to you, if any */
  openPromise: string | null;
  /** The relationship is inside a post-rupture window */
  ruptureNote: string | null;
}

export type Decision =
  | { send: false; why: string }
  | { send: true; trigger: Trigger; reason: string };

const DEFAULT_WAIT = 120, DEFAULT_FOLLOWUPS = 2, ABSENCE_HOURS = 24;
const minutesOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();

export function inQuietHours(now: Date, start: number, end: number): boolean {
  if (start === end) return false;
  const m = minutesOfDay(now);
  return start < end ? m >= start && m < end : m >= start || m < end;
}

export const hoursText = (ms: number) => {
  const h = ms / 3_600_000;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} minutes` : h < 48 ? `${Math.round(h)} hour${Math.round(h) === 1 ? "" : "s"}` : `${Math.round(h / 24)} days`;
};

/**
 * Should this character send a message now? `sentToday` counts outreach
 * messages today: `all` across characters, `mine` from this one.
 */
export function decideOutreach(
  now: Date,
  s: OutreachSettings,
  c: CharacterOutreach | undefined,
  chat: ChatSignals,
  sentToday: { all: number; mine: number },
): Decision {
  if (!s.enabled) return { send: false, why: "Contact & media is off" };
  if (s.paused) return { send: false, why: "paused" };
  if (s.userStatus === "dnd") return { send: false, why: "you are on Do not disturb" };
  if (!c?.canContact) return { send: false, why: "this character may not contact you" };
  if (inQuietHours(now, s.quietStart, s.quietEnd)) return { send: false, why: "quiet hours" };
  if (sentToday.all >= s.dailyLimit) return { send: false, why: "today's limit is reached" };
  if (c.dailyLimit !== undefined && sentToday.mine >= Math.min(c.dailyLimit, s.dailyLimit)) return { send: false, why: "their limit for today is reached" };
  if (chat.lastUserAt === null) return { send: false, why: "you have not talked yet" };

  // Silence: the first message after `wait`; follow-ups each wait twice as long as the last
  const wait = (c.waitMinutes ?? DEFAULT_WAIT) * 60_000;
  const maxFollow = c.maxFollowUps ?? DEFAULT_FOLLOWUPS;
  if (chat.sinceLastUser > maxFollow) return { send: false, why: "no reply to the last ones, so they wait for you" };
  const silence = now.getTime() - chat.lastUserAt;
  const since = chat.lastOutreachAt === null ? silence : now.getTime() - chat.lastOutreachAt;
  const needed = chat.sinceLastUser === 0 ? wait : wait * 2 ** chat.sinceLastUser;
  if (since < needed) return { send: false, why: "not quiet for long enough yet" };

  const mode = c.mode ?? "story";
  const off = new Set(c.off ?? []);
  const story = (t: StoryTrigger) => (mode === "story" || mode === "both") && !off.has(t);
  const timed = mode === "timed" || mode === "both";
  const away = hoursText(silence);

  // Story first: a reason in the story outranks a time of day
  if (story("repair") && chat.ruptureNote) return { send: true, trigger: "repair", reason: `things between you are strained (${chat.ruptureNote}) and they want to say something about it` };
  if (story("promise") && chat.openPromise) return { send: true, trigger: "promise", reason: `of the promise they made you: ${chat.openPromise}` };
  if (story("question") && chat.unansweredQuestion && chat.sinceLastUser === 0) return { send: true, trigger: "question", reason: "they asked you something and you never answered" };
  if (story("absence") && silence >= ABSENCE_HOURS * 3_600_000) return { send: true, trigger: "absence", reason: `they have not heard from you in ${away}` };

  if (timed) {
    const m = minutesOfDay(now);
    if (m >= 7 * 60 && m < 10 * 60) return { send: true, trigger: "morning", reason: "it is morning and they thought of you" };
    if (m >= 20 * 60 && m < 23 * 60) return { send: true, trigger: "evening", reason: "it is evening and they wanted to check in" };
    return { send: true, trigger: "checkin", reason: `they have not heard from you in ${away}` };
  }
  return { send: false, why: "nothing in the story calls for it" };
}

/** "12:30" ↔ minutes after midnight, for the settings form */
export const toMinutes = (hhmm: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  return m ? Math.min(23, Number(m[1])) * 60 + Math.min(59, Number(m[2])) : null;
};
export const fromMinutes = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
