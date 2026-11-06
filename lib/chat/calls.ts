// ─── Phone calls ──────────────────────────────────────────────────────────────
// Client-side, like generation. A call is part of the same chat and the same
// story: its lines are messages on the "call" channel, and call lines
// (started, ended, missed, declined) are messages with a `callEvent`, so the
// model, memory and the chat history all see that a call happened. The call
// screen (components/phone/CallScreen.tsx) shows the state kept here in the ui
// store. Voice is not part of this yet: their lines show as captions.
//
// Who calls: you, from the right-hand panel; or the character, when the
// outreach rules decide they reach out and `reachOutBy` says a call (a
// character you allowed to call, about a rupture or a long silence).

import { useFableStore } from "@/lib/store";
import { useUiStore, type CallState } from "@/lib/store/ui";
import { generateAssistantReply, stopGeneration, type OutreachRequest } from "@/lib/chat/generation";
import { contactSettings } from "@/lib/chat/photos";
import { startRingtone, stopRingtone } from "@/lib/chat/sounds";
import type { CallEvent } from "@/lib/types";

/** An unanswered call stops ringing after this long and becomes a missed call. */
export const RING_MS = 30_000;
/** How long "Calling…" shows before they pick up. */
const PICKUP_MS = 1800;

let missTimer: ReturnType<typeof setTimeout> | null = null;

const call = () => useUiStore.getState().call;
const setCall = (c: CallState | null) => useUiStore.getState().setCall(c);

function logCall(chatId: string, characterId: string, byYou: boolean, event: CallEvent, outreach?: OutreachRequest) {
  useFableStore.getState().addMessage(chatId, {
    chatId, role: byYou ? "user" : "assistant", content: "", characterId, channel: "call", callEvent: event,
    // A call they made counts toward their daily limit and backoff, answered or not
    ...(outreach ? { outreach: { trigger: outreach.trigger, reason: outreach.reason } } : {}),
  });
}

/** You call them. They pick up after a moment and speak first. */
let placing = false;

export async function placeCall(chatId: string, characterId: string): Promise<string | null> {
  if (call() || placing) return "You are already on a call.";
  placing = true; // a second click while the settings load must not start a second call
  let on: boolean;
  try { on = (await contactSettings()).enabled; } finally { placing = false; }
  if (!on) return "Calls are off. Turn on Contact & media in Settings to call.";
  if (call()) return "You are already on a call.";
  if (useFableStore.getState().isGenerating) return "Wait for the reply being written to finish.";
  if (useUiStore.getState().sendingPicture) return "Wait for your picture to finish sending.";
  setCall({ chatId, characterId, phase: "calling" });
  logCall(chatId, characterId, true, { kind: "started" });
  setTimeout(() => {
    const cur = call();
    if (!cur || cur.chatId !== chatId || cur.phase !== "calling") return;
    setCall({ ...cur, phase: "connected", connectedAt: Date.now() });
    void generateAssistantReply(chatId, characterId);
  }, PICKUP_MS);
  return null;
}

/** They call you: ring (with the ringtone, if sounds are on) until you answer, decline or it times out. */
export async function ringIn(chatId: string, characterId: string, outreach: OutreachRequest): Promise<void> {
  if (call()) return;
  setCall({ chatId, characterId, phase: "incoming", outreach: { ...outreach, channel: "call" } });
  const sounds = (await contactSettings()).sounds;
  // Answered, declined or replaced while the settings loaded: no ringtone for a call that is not ringing
  const now = call();
  if (sounds && now?.phase === "incoming" && now.chatId === chatId) startRingtone();
  if (missTimer) clearTimeout(missTimer);
  missTimer = setTimeout(() => { if (call()?.phase === "incoming") endIncoming("missed"); }, RING_MS);
}

function endIncoming(kind: "missed" | "declined") {
  const cur = call();
  if (!cur) return;
  stopRingtone();
  if (missTimer) clearTimeout(missTimer);
  logCall(cur.chatId, cur.characterId, false, { kind }, cur.outreach);
  setCall(null);
  // A missed call shows on the chat like an unread message
  const st = useFableStore.getState();
  const viewing = st.activeChatId === cur.chatId && useUiStore.getState().activeSection === "chats";
  if (!viewing) useUiStore.getState().markUnread(cur.chatId);
}

/** Pick up their call: they speak first, saying why they called. */
export async function answerCall(): Promise<void> {
  const cur = call();
  if (!cur || cur.phase !== "incoming") return;
  stopRingtone();
  if (missTimer) clearTimeout(missTimer);
  // Their call counts toward their limits and backoff (the outreach is on the line it started)
  logCall(cur.chatId, cur.characterId, false, { kind: "started" }, cur.outreach);
  setCall({ ...cur, phase: "connected", connectedAt: Date.now() });
  const st = useFableStore.getState();
  st.setActiveChatId(cur.chatId);
  useUiStore.getState().setActiveSection("chats");
  // A reply being written elsewhere would make them silent: stop it first
  if (st.isGenerating) {
    stopGeneration();
    const until = Date.now() + 5000;
    while (useFableStore.getState().isGenerating && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
    if (useFableStore.getState().isGenerating) return;
  }
  if (call()?.chatId !== cur.chatId) return; // hung up while waiting
  void generateAssistantReply(cur.chatId, cur.characterId, cur.outreach);
}

export const declineCall = () => endIncoming("declined");

/** Say something on the call. */
export async function sayOnCall(text: string): Promise<void> {
  const cur = call();
  const t = text.trim();
  if (!cur || cur.phase !== "connected" || !t || useFableStore.getState().isGenerating || useUiStore.getState().sendingPicture) return;
  useFableStore.getState().addMessage(cur.chatId, { chatId: cur.chatId, role: "user", content: t, channel: "call" });
  await generateAssistantReply(cur.chatId, cur.characterId);
}

/** End the call (either way it started). Stops a reply still being written. */
export function hangUp(): void {
  const cur = call();
  if (!cur) return;
  if (cur.phase === "incoming") { endIncoming("declined"); return; }
  const seconds = cur.connectedAt ? (Date.now() - cur.connectedAt) / 1000 : 0;
  stopGeneration();
  logCall(cur.chatId, cur.characterId, true, cur.phase === "calling" ? { kind: "missed" } : { kind: "ended", seconds });
  setCall(null);
}
