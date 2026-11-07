// ─── Hearing a reply in their voice ───────────────────────────────────────────
// Client-side. A reply is spoken by the voice server (/api/voice/speak) in the
// voice of the character who wrote it, kept as an audio asset on the message
// (`speech`), and played here. The asset is keyed by the words and the voice,
// so playing it again costs nothing, and an edited reply or a changed voice is
// spoken afresh. "Read replies aloud" (`chat.readAloud`) speaks each new reply
// once, as it finishes. One thing plays at a time.
//
// With a narrator (Settings → Media → Narrator) a story reply is read like an
// audiobook: the narrator reads the narration, the character speaks what is in
// quotes, and the two voices come back as one clip (the voice server's
// multi-speaker dialogue). Texts and call lines are the character alone.

import { useFableStore } from "@/lib/store";
import { useUiStore } from "@/lib/store/ui";
import { getJson, sendJson } from "@/lib/api/client";
import { cleanNarrator, hasVoice, type CharacterVoice, type NarratorSettings } from "@/lib/media/voice";
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

export interface SpeechPart { by: "narrator" | "character"; text: string }

/** Plain words for the voice server: no markers, no markdown (its own cleaner would drop an *action* as a stage direction) */
const plain = (s: string) => s.replace(/[*_#`>~]+/g, "").replace(/\s+/g, " ").trim();
const hasWords = (s: string) => /[\p{L}\p{N}]/u.test(s);

/**
 * A reply as the parts a narrator and the character read. Without a narrator,
 * or for a text or a call line, it is the character alone saying spokenText.
 * With one, a story reply alternates: everything outside quotes (narration,
 * actions, "she whispers") is the narrator's, the quoted words the character's,
 * in order, with neighbours of the same voice joined.
 */
export function speechParts(m: Pick<Message, "content" | "channel">, narrate: boolean): SpeechPart[] {
  if (!narrate || m.channel === "text" || m.channel === "call") {
    const t = spokenText(m);
    return t ? [{ by: "character", text: t }] : [];
  }
  const src = m.content.replace(/\[(?:photo|video|voice note|sent [^\]]*)[^\]]*\]/gi, " ");
  const parts: SpeechPart[] = [];
  const push = (by: SpeechPart["by"], raw: string) => {
    const text = plain(raw);
    if (!hasWords(text)) return;
    const last = parts[parts.length - 1];
    if (last && last.by === by) last.text = `${last.text} ${text}`;
    else parts.push({ by, text });
  };
  let at = 0;
  for (const q of src.matchAll(/[“"]([^”"]+)[”"]/g)) {
    push("narrator", src.slice(at, q.index));
    push("character", q[1]);
    at = (q.index ?? 0) + q[0].length;
  }
  push("narrator", src.slice(at));
  // The voice server takes at most 8,000 characters in one dialogue
  let budget = MAX_SPOKEN * 2;
  return parts.flatMap((p) => {
    if (budget <= 0) return [];
    const text = p.text.slice(0, Math.min(MAX_SPOKEN, budget));
    budget -= text.length;
    return [{ ...p, text }];
  });
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

/**
 * The key for a reply read in parts. One part by the character is exactly
 * speechKey, so audio made before the narrator was turned on is still used for
 * a reply that is all speech; with narration, both voices and the split are in it.
 */
export function partsKey(parts: SpeechPart[], character: CharacterVoice | undefined, narrator: CharacterVoice | undefined): string {
  if (parts.length === 1 && parts[0].by === "character") return speechKey(parts[0].text, character);
  return `${voiceKey(character)}+${voiceKey(narrator)}:${hash(JSON.stringify(parts))}`;
}

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

let narratorCache: { at: number; value: NarratorSettings } | null = null;
/** The narrator setting (cached for 10 s; Settings calls forgetNarrator after a change) */
export async function narratorSettings(): Promise<NarratorSettings> {
  if (narratorCache && Date.now() - narratorCache.at < 10_000) return narratorCache.value;
  try {
    narratorCache = { at: Date.now(), value: cleanNarrator(await getJson<unknown>("/api/voice/narrator")) };
  } catch {
    narratorCache = { at: Date.now(), value: cleanNarrator({}) };
  }
  return narratorCache.value;
}
export const forgetNarrator = () => { narratorCache = null; };

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
  const narrator = await narratorSettings();
  const parts = speechParts(msg, narrator.enabled);
  if (!parts.length) throw new Error("There is nothing to say out loud in this message.");
  if (!who) throw new Error("Whoever wrote this is no longer in your library.");
  if (!hasVoice(who.voice)) throw new Error(`${who.name} has no voice yet: choose one in their editor (Voice).`);

  stopSpeaking();
  const ui = useUiStore.getState();
  const key = partsKey(parts, who.voice, narrator.voice);
  let url = msg.speech?.key === key ? msg.speech.url : null;
  if (!url) {
    ui.setSpeaking({ messageId, phase: "making" });
    // One voice: a line. Narrator and character: one clip, the two voices taking turns
    const body = parts.length === 1 && parts[0].by === "character"
      ? { text: parts[0].text, voice: who.voice }
      : { lines: parts.map((p) => ({ text: p.text, voice: p.by === "narrator" ? narrator.voice : who.voice })) };
    const r = await sendJson<{ ok?: boolean; url?: string; error?: string }>("POST", "/api/voice/speak?store=1", body)
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
