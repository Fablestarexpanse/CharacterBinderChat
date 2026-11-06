// ─── Hearing a reply in their voice ───────────────────────────────────────────
// Client-side. A reply is spoken by the voice server (/api/voice/speak) in the
// voice of the character who wrote it, kept as an audio asset on the message
// (`speech`), and played here. The asset is keyed by the words and the voice,
// so playing it again costs nothing, and an edited reply or a changed voice is
// spoken afresh. "Read replies aloud" (`chat.readAloud`) speaks each new reply
// once, as it finishes. One thing plays at a time.

import { useFableStore } from "@/lib/store";
import { useUiStore } from "@/lib/store/ui";
import { getJson, sendJson } from "@/lib/api/client";
import { hasVoice, type CharacterVoice } from "@/lib/media/voice";
import type { Message } from "@/lib/types";

/** The voice server answers at most this much text per line */
const MAX_SPOKEN = 4000;

/**
 * The words a reply says out loud. A text or a line on a call is all words. A
 * story reply mixes narration and speech: when it quotes someone, only the
 * quoted words are spoken; otherwise the narration is read, without its
 * *actions*. Markers like [photo: …] are never read.
 */
export function spokenText(m: Pick<Message, "content" | "channel">): string {
  let t = m.content.replace(/\[(?:photo|video|voice note|sent [^\]]*)[^\]]*\]/gi, " ");
  if (m.channel !== "text" && m.channel !== "call") {
    const quoted = [...t.matchAll(/[“"]([^”"]{2,})[”"]/g)].map((q) => q[1].trim()).filter(Boolean);
    if (quoted.length) t = quoted.join(" ");
    else t = t.replace(/\*[^*\n]+\*/g, " ");
  }
  t = t.replace(/[*_#`>~]+/g, "").replace(/\s+/g, " ").trim();
  return t.length > MAX_SPOKEN ? t.slice(0, MAX_SPOKEN) : t;
}

/** Which voice a voice is, for the cache key: their sample (by its asset) or the demo voice */
export function voiceKey(v: CharacterVoice | undefined): string {
  if (v?.sample && v.consent) return `sample:${(/([0-9a-f]{64})$/.exec(v.sample)?.[1] ?? v.sample).slice(0, 16)}`;
  return v?.demo ? v.demo : "none";
}

/** FNV-1a, enough to tell two texts apart in a cache key */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** The key a message's spoken audio is stored under: these words in this voice */
export const speechKey = (text: string, v: CharacterVoice | undefined) => `${voiceKey(v)}:${hash(text)}`;

// ── Is voice set up? (cached briefly, like the contact settings) ──────────────

let readyCache: { at: number; value: boolean } | null = null;
export async function voiceReady(): Promise<boolean> {
  if (readyCache && Date.now() - readyCache.at < 30_000) return readyCache.value;
  try {
    const r = await getJson<{ runtime?: { installed?: boolean } }>("/api/voice/runtime");
    readyCache = { at: Date.now(), value: !!r.runtime?.installed };
  } catch {
    readyCache = { at: Date.now(), value: false };
  }
  return readyCache.value;
}

// ── Playing ──────────────────────────────────────────────────────────────────

let audio: HTMLAudioElement | null = null;

/** Stop whatever is playing (or being made: its audio is kept, it just does not play) */
export function stopSpeaking(): void {
  if (audio) { audio.pause(); audio.src = ""; audio = null; }
  useUiStore.getState().setSpeaking(null);
}

function find(chatId: string, messageId: string) {
  const st = useFableStore.getState();
  const msg = st.chats.find((c) => c.id === chatId)?.messages.find((m) => m.id === messageId);
  const who = msg?.characterId ? st.characters.find((c) => c.id === msg.characterId) : undefined;
  return { msg, who };
}

/**
 * Speak one reply, making its audio first if it has none for these words in
 * this voice. Resolves when it starts playing; rejects with a reason to show.
 */
export async function playMessage(chatId: string, messageId: string): Promise<void> {
  const { msg, who } = find(chatId, messageId);
  if (!msg) return;
  const text = spokenText(msg);
  if (!text) throw new Error("There is nothing to say out loud in this message.");
  if (!who) throw new Error("Whoever wrote this is no longer in your library.");
  if (!hasVoice(who.voice)) throw new Error(`${who.name} has no voice yet: choose one in their editor (Voice).`);

  stopSpeaking();
  const ui = useUiStore.getState();
  const key = speechKey(text, who.voice);
  let url = msg.speech?.key === key ? msg.speech.url : null;
  if (!url) {
    ui.setSpeaking({ messageId, phase: "making" });
    const r = await sendJson<{ ok?: boolean; url?: string; error?: string }>("POST", "/api/voice/speak?store=1", { text, voice: who.voice })
      .catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }) as { ok?: boolean; url?: string; error?: string });
    if (!r.url) { useUiStore.getState().setSpeaking(null); throw new Error(r.error ?? "The voice server gave no audio."); }
    url = r.url;
    useFableStore.getState().setMessageSpeech(chatId, messageId, { url, key });
    // Stopped, or another message started, while this one was being made
    if (useUiStore.getState().speaking?.messageId !== messageId) return;
  }
  const a = new Audio(url);
  audio = a;
  a.onended = () => { if (audio === a) stopSpeaking(); };
  a.onerror = () => { if (audio === a) stopSpeaking(); };
  useUiStore.getState().setSpeaking({ messageId, phase: "playing" });
  await a.play().catch((e: unknown) => { if (audio === a) stopSpeaking(); throw e; });
}

/** Called as a reply finishes: with Read replies aloud on in that chat, speak it once */
export function readAloudIfOn(chatId: string, messageId: string): void {
  const chat = useFableStore.getState().chats.find((c) => c.id === chatId);
  if (!chat?.readAloud) return;
  void voiceReady().then((ready) => {
    if (!ready) return;
    return playMessage(chatId, messageId);
  }).catch((e: unknown) => console.warn("[read aloud]", e instanceof Error ? e.message : e));
}
