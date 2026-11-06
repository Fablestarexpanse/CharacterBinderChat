// ─── Reaching out, while a FableChat tab is open ──────────────────────────────
// Once a minute: for each character you allowed to contact you, take their
// most recent one-to-one chat, read the signals, and let the rules decide
// (lib/outreach/rules.ts). At most one message per check. The model is only
// called to write a message the rules already approved.

import { useFableStore } from "@/lib/store";
import { useUiStore } from "@/lib/store/ui";
import { getJson } from "@/lib/api/client";
import { contactSettings } from "@/lib/chat/photos";
import { generateAssistantReply } from "@/lib/chat/generation";
import { decideOutreach, hoursText, reachOutBy, type ChatSignals } from "@/lib/outreach/rules";
import { ringIn } from "@/lib/chat/calls";
import { playTextChime } from "@/lib/chat/sounds";
import type { Character, Chat, Message } from "@/lib/types";

const real = (m: Message) => !m.error && !m.imageJobId;

/** Signals from the chat itself (memory signals are filled in separately). */
export function chatSignals(chat: Pick<Chat, "messages">): Omit<ChatSignals, "openPromise" | "ruptureNote"> {
  const msgs = chat.messages.filter(real);
  let lastUser = -1;
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === "user") { lastUser = i; break; }
  const after = lastUser === -1 ? [] : msgs.slice(lastUser + 1);
  const outreach = after.filter((m) => m.role === "assistant" && m.outreach);
  const last = msgs.at(-1);
  return {
    lastUserAt: lastUser === -1 ? null : Date.parse(msgs[lastUser].timestamp),
    sinceLastUser: outreach.length,
    lastOutreachAt: outreach.length ? Date.parse(outreach.at(-1)!.timestamp) : null,
    unansweredQuestion: !!last && last.role === "assistant" && !last.outreach && /\?["'”’)\]]*\s*$/.test(last.content.trim()),
  };
}

/** Outreach messages since local midnight, across chats and per character. */
export function sentToday(chats: Chat[], now: Date, characterId: string): { all: number; mine: number } {
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  let all = 0, mine = 0;
  for (const c of chats) for (const m of c.messages) {
    if (m.outreach && Date.parse(m.timestamp) >= midnight.getTime()) { all++; if (m.characterId === characterId) mine++; }
  }
  return { all, mine };
}

/** The chat a character reaches out in: their most recent one-to-one chat. */
export function chatFor(chats: Chat[], character: Character): Chat | undefined {
  return chats
    .filter((c) => c.characterId === character.id && !(c.memberIds && c.memberIds.length > 1))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
}

let running = false;

/** One check. Returns what happened, for the log and the tests of the loop. */
export async function outreachTick(now = new Date()): Promise<string> {
  if (running) return "busy";
  const st = useFableStore.getState();
  if (st.isGenerating) return "a reply is being written";
  const settings = await contactSettings();
  if (!settings.enabled) return "off";
  if (useUiStore.getState().call) return "on a call";
  if (useUiStore.getState().sendingPicture) return "a picture is being sent";
  running = true;
  const held: string[] = [];
  try {
    for (const character of st.characters.filter((c) => c.contact?.canContact)) {
      const chat = chatFor(st.chats, character);
      if (!chat) continue;
      const base = chatSignals(chat);
      const count = sentToday(st.chats, now, character.id);
      // The hard limits first, before fetching anything: a probe with a reason that always applies
      const probe = decideOutreach(now, settings, character.contact, { ...base, openPromise: "probe", ruptureNote: null }, count);
      if (!probe.send) { held.push(`${character.name}: ${probe.why}`); continue; }
      const cm = await getJson<{ coreMemory?: { active_commitments?: string[]; relationship_note?: string | null } }>(
        `/api/chat/core-memory?chatId=${encodeURIComponent(chat.id)}&characterId=${encodeURIComponent(character.id)}&name=${encodeURIComponent(character.name)}`,
      ).catch(() => ({ coreMemory: undefined }));
      const d = decideOutreach(now, settings, character.contact, {
        ...base,
        openPromise: cm.coreMemory?.active_commitments?.[0] ?? null,
        ruptureNote: cm.coreMemory?.relationship_note ?? null,
      }, count);
      if (!d.send) { held.push(`${character.name}: ${d.why}`); continue; }
      const silence = base.lastUserAt ? hoursText(now.getTime() - base.lastUserAt) : "a while";
      const request = { trigger: d.trigger, reason: d.reason, silence, userNote: settings.userNote || undefined };
      // A rupture or a long silence from someone allowed to call: the phone rings instead of a text
      // The checks above awaited the network: you may have started a call or a reply since
      if (useUiStore.getState().call) return "on a call";
      if (useFableStore.getState().isGenerating || useUiStore.getState().sendingPicture) return "a reply is being written";
      if (reachOutBy(d.trigger, character.contact) === "call") {
        await ringIn(chat.id, character.id, request);
        return `${character.name}: calling (${d.trigger})`;
      }
      const wrote = await generateAssistantReply(chat.id, character.id, request);
      // Only a text that was written is announced (a failed or stopped one is not "a text from them")
      if (!wrote) return `${character.name}: no text written`;
      announce(chat, character, settings.notifications, settings.sounds);
      return `${character.name}: ${d.trigger}`;
    }
    return held.length ? `nothing due (${held.join("; ")})` : "nothing due";
  } finally {
    running = false;
  }
}

/**
 * A text arrived: the chime (if sounds are on), and for a chat you are not
 * looking at an unread mark (its row in Recent Chats shows the text badge) and
 * a browser notification if you allowed them.
 */
export function announce(chat: Chat, character: Character, notify: boolean, sounds: boolean) {
  if (sounds) playTextChime();
  const viewing = useFableStore.getState().activeChatId === chat.id && useUiStore.getState().activeSection === "chats" && !document.hidden;
  if (viewing) return;
  useUiStore.getState().markUnread(chat.id);
  if (notify && typeof Notification !== "undefined" && Notification.permission === "granted") {
    const text = useFableStore.getState().chats.find((c) => c.id === chat.id)?.messages.at(-1)?.content.slice(0, 140) ?? "";
    const n = new Notification(character.name, { body: text, tag: `fablechat-${chat.id}` });
    n.onclick = () => {
      window.focus();
      useFableStore.getState().setActiveChatId(chat.id);
      useUiStore.getState().setActiveSection("chats");
      n.close();
    };
  }
}
