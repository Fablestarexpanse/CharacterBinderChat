// ─── Generation ───────────────────────────────────────────────────────────────
// Shared client-side generation pipeline, extracted from ChatInput so the
// header (Regenerate) and message rows can trigger it too. One generation at
// a time; isGenerating lives in the store so every component sees it, while
// the AbortController stays module-local (not serialisable).

import { useFableStore } from "@/lib/store";
import { getJson, sendJson } from "@/lib/api/client";
import { createChatProvider, resolveRouteCredentials } from "@/lib/providers/factory";
import { buildSystemPrompt, estimateTokens } from "./promptBuilder";
import { matchLoreEntries, booksForChat } from "./lorebook";
import { resolveGeneration } from "./settings";
import { fitHistoryToBudget } from "./tokenBudget";
import type { Chat, Character, MessageRole, MemoryTaskRequest } from "@/lib/types";
import type { CoreMemoryGetResponse } from "@/lib/api/dto";

let abortController: AbortController | null = null;

// How many extractions are in flight. A turn can start one while the previous
// is still running (long histories, a slow local model), and a plain boolean
// meant the first to finish cleared the spinner for both.
let extractionsInFlight = 0;

export function stopGeneration(): void {
  abortController?.abort();
}

// ─── Core Memory fetcher ──────────────────────────────────────────────────────

/** What the route returns when there is nothing to return. */
const NO_MEMORY: CoreMemoryGetResponse = {
  coreMemory: null, version: 0, updatedAt: 0,
  knownFacts: [], episodes: [], insights: [], sharedLanguage: [],
};

async function fetchCoreMemory(
  chatId:        string,
  characterId:   string,
  characterName: string,
  context = ""
): Promise<CoreMemoryGetResponse> {
  try {
    // Context lets retrieval rank facts by relevance to what's being discussed.
    // Capped so the query string stays a sane length.
    const ctxParam = context ? `&context=${encodeURIComponent(context.slice(0, 600))}` : "";
    const data = await getJson<CoreMemoryGetResponse>(
      `/api/chat/core-memory?chatId=${encodeURIComponent(chatId)}&characterId=${encodeURIComponent(characterId)}&name=${encodeURIComponent(characterName)}${ctxParam}`
    );
    // The ?? [] guards stay: this is JSON off the wire that nothing validates.
    return {
      ...data,
      knownFacts: data.knownFacts ?? [],
      episodes:   data.episodes ?? [],
      insights:   data.insights ?? [],
      sharedLanguage: data.sharedLanguage ?? [],
    };
  } catch (e) {
    return degraded(e instanceof Error ? e.message : String(e));
  }
}

/**
 * Generate without memory rather than not at all — but say so.
 *
 * Silently returning empties made a broken memory API look exactly like a
 * brand-new character: the reply comes back fluent, remembering nothing, and
 * nothing anywhere says why. The inspector already surfaces
 * `lastExtractionError`, so the failure lands where a user would look.
 */
function degraded(reason: string): CoreMemoryGetResponse {
  console.warn("[core-memory] fetch failed, generating without memory:", reason);
  useFableStore.getState().setLastExtractionError(`memory could not be loaded — ${reason}`);
  return NO_MEMORY;
}

// ─── Group helpers ────────────────────────────────────────────────────────────

/** Present (non-absent) member ids of a group chat, [] for 1:1. */
export function presentMemberIds(chat: Chat): string[] {
  if (!chat.memberIds || chat.memberIds.length < 2) return [];
  const absent = new Set(chat.absentIds ?? []);
  return chat.memberIds.filter((id) => !absent.has(id));
}

/**
 * Who speaks next in a group when the user didn't choose: a present member
 * named in the last user message wins; otherwise round-robin from whoever
 * spoke last.
 */
function pickSpeaker(chat: Chat, characters: Character[]): string {
  const present = presentMemberIds(chat);
  const lastUser = [...chat.messages].reverse().find((m) => m.role === "user" && !m.error);
  if (lastUser) {
    const text = lastUser.content.toLowerCase();
    // Earliest mention wins: "Fen, before Ronan gets back…" addresses Fen,
    // even though Ronan is also named (and joined the group first).
    let named: string | undefined;
    let best = Infinity;
    for (const id of present) {
      const name = characters.find((c) => c.id === id)?.name.toLowerCase();
      if (!name) continue;
      const at = text.indexOf(name);
      if (at !== -1 && at < best) { best = at; named = id; }
    }
    if (named) return named;
  }
  const lastSpeaker = [...chat.messages].reverse()
    .find((m) => m.role === "assistant" && m.characterId && present.includes(m.characterId))?.characterId;
  const idx = lastSpeaker ? present.indexOf(lastSpeaker) : -1;
  return present[(idx + 1) % present.length];
}

// ─── Generate a reply to the chat's current history ──────────────────────────

export async function generateAssistantReply(chatId: string, speakerId?: string): Promise<void> {
  const store = useFableStore.getState();
  if (store.isGenerating) return;

  const chat = store.chats.find((c) => c.id === chatId);
  if (!chat) return;
  const present = presentMemberIds(chat);
  const isGroup = present.length >= 2;
  // Group: explicit speaker (if present in scene) > auto pick. 1:1: the character.
  const speakerCharId = isGroup
    ? (speakerId && present.includes(speakerId) ? speakerId : pickSpeaker(chat, store.characters))
    : chat.characterId;
  const character  = store.characters.find((c) => c.id === speakerCharId);
  const providerId = chat.providerId ?? "ollama";
  const modelId    = chat.modelId    ?? "llama3.2:latest";
  const provider   = createChatProvider(providerId, store.providerSettings);

  if (!provider) {
    store.addMessage(chatId, {
      chatId,
      role:    "assistant",
      content: "⚠️ No provider available. Check Settings — make sure your provider is running and any required API key is set.",
      error:   true,
    });
    return;
  }

  // Claim the generation slot BEFORE the awaits below — checking the guard at
  // entry but setting it after fetchCoreMemory left a window where a second
  // trigger (Enter + Regenerate) started two concurrent streams.
  store.setIsGenerating(true);
  let assistantMsgId: string | null = null;
  let accumulated = "";
  let failed = false;
  /** Did the model emit anything? Distinct from `accumulated` being non-empty,
   *  which a prefill alone would satisfy — saving a bare prefill as a reply
   *  would also schedule extraction on words the model never wrote. */
  let produced = false;

  try {
    // ── Fetch Core Memory (Drawer 1) + Drawer 2 known facts ────────────────
    // The last few turns act as the relevance signal for fact retrieval
    const recentText = chat.messages.slice(-3).map((m) => m.content).join(" ");
    const { coreMemory, knownFacts, episodes, insights, sharedLanguage } = character
      ? await fetchCoreMemory(chatId, character.id, character.name, recentText)
      : NO_MEMORY;

    // ── Build message history within the model's token budget ──────────────
    const persona = store.personas.find((p) => p.id === store.activePersonaId) ?? null;
    // Preset + global instructions + per-chat overrides, collapsed once.
    // NOTE: none of this may be forwarded to the extraction routes — they run
    // format:"json" on backend defaults, and a roleplay temperature or a
    // jailbreak prompt would break structured extraction.
    const resolved = resolveGeneration(chat, store);
    // Lorebook entries fire on keywords in the recent turns — a wider window
    // than fact retrieval so lore doesn't flicker out one exchange after its
    // subject was raised.
    const loreScanText = chat.messages.slice(-6).map((m) => m.content).join("\n");
    const lore = matchLoreEntries(booksForChat(store.lorebooks, chat), loreScanText);
    // A chat-builder scenario snapshot overrides the character sheet's own
    const promptCharacter = character && chat.scenarioText
      ? { ...character, scenario: chat.scenarioText }
      : character;
    let systemPrompt = buildSystemPrompt({
      character: promptCharacter,
      coreMemory, persona,
      knownFacts, episodes, insights, lore, sharedLanguage,
      globalPrompt:   resolved.globalPrompt,
      customPrompt:   resolved.customPrompt,
      forbiddenWords: resolved.forbiddenWords,
    });

    // ── Group scene block ───────────────────────────────────────────────────
    // The speaker needs to know who else is in the room, and that other
    // characters' lines in the history are not theirs to continue.
    if (isGroup && character) {
      const othersHere = present
        .filter((id) => id !== character.id)
        .map((id) => store.characters.find((c) => c.id === id))
        .filter((c): c is Character => !!c);
      const away = (chat.absentIds ?? [])
        .map((id) => store.characters.find((c) => c.id === id)?.name)
        .filter(Boolean);
      systemPrompt +=
        `\n\n[Scene]\nThis is a group scene. Also present:\n` +
        othersHere.map((c) => `  - ${c.name}: ${c.description.slice(0, 160)}`).join("\n") +
        (away.length ? `\nNot currently present (do not have them act): ${away.join(", ")}` : "") +
        `\nOther characters' lines appear in the conversation prefixed with their name. ` +
        `Speak and act ONLY as ${character.name} — never write dialogue or actions for anyone else.`;
    }

    // Failure notices (m.error) are UI artifacts, not dialogue — sending them
    // back to the model taught it to roleplay error messages.
    // In groups, only the speaker's own lines are assistant turns; everyone
    // else (player and other characters) arrives as named user turns.
    const speakerLabel = (m: { role: string; characterId?: string }) =>
      m.role === "user"
        ? persona?.name ?? "User"
        : store.characters.find((c) => c.id === m.characterId)?.name ?? "Narrator";
    const fullHistory: Array<{ role: MessageRole; content: string }> = chat.messages
      .filter((m) => m.content.trim().length > 0 && !m.imageJobId && !m.error)
      .map((m) => {
        if (!isGroup) return { role: m.role as MessageRole, content: m.content };
        const own = m.role === "assistant" && m.characterId === character?.id;
        return own
          ? { role: "assistant" as MessageRole, content: m.content }
          : { role: "user" as MessageRole, content: `${speakerLabel(m)}: ${m.content}` };
      });
    // ── Prefill ─────────────────────────────────────────────────────────────
    // A trailing assistant turn is how every backend here expresses "continue
    // from this" — the reply comes back as the continuation, not a fresh turn.
    // It goes in BEFORE the fit so it counts against the budget, and the fit's
    // "newest is always kept" rule then protects it from being trimmed.
    const prefill = resolved.prefill;
    if (prefill) fullHistory.push({ role: "assistant", content: prefill });
    accumulated = prefill;

    const fit = fitHistoryToBudget(systemPrompt, fullHistory, modelId, undefined, resolved.params.contextSize);
    if (fit.dropped > 0) {
      console.info(`[chat] context window: dropped ${fit.dropped} oldest message(s) to fit`);
    }
    store.setChatContext(chatId, fit.usedTokens, fit.contextMax);
    const history: Array<{ role: MessageRole; content: string }> = [
      { role: "system", content: systemPrompt },
      ...fit.messages,
    ];

    // ── Create placeholder assistant message + stream into it ───────────────
    // Seeded with the prefill so the bubble reads correctly from the first
    // frame — the model continues it rather than repeating it.
    assistantMsgId = store.addMessage(chatId, {
      chatId,
      role:        "assistant",
      content:     prefill,
      characterId: character?.id,
    });
    // Provenance: record exactly which memory was injected into this reply's
    // prompt, so the message can answer "why did you say that?"
    store.setMessageMemoryTrace(chatId, assistantMsgId, {
      facts: knownFacts, episodes, insights, sharedLanguage, lore,
      storyTime: coreMemory?.story_time ?? null,
    });

    const controller = new AbortController();
    abortController = controller;

    try {
      for await (const token of provider.streamChat(history, modelId, resolved.params, controller.signal)) {
        produced = true;
        accumulated += token;
        store.updateMessageContent(chatId, assistantMsgId, accumulated);
      }
    } catch (err) {
      // User pressed Stop — keep whatever was generated, no error message
      const aborted = err instanceof Error && err.name === "AbortError";
      if (!aborted) {
        failed = true;
        const detail = err instanceof Error ? err.message : String(err);
        store.updateMessageContent(
          chatId,
          assistantMsgId,
          `⚠️ **Response failed** — ${detail}\n\nMake sure **${providerId}** is running and the model \`${modelId}\` is available.`
        );
        store.markMessageError(chatId, assistantMsgId);
      }
    }

    if (!failed && produced) {
      // Only the generated part is new: fit.usedTokens already counted the
      // prefill, which was part of the history sent.
      store.setChatContext(
        chatId,
        fit.usedTokens + estimateTokens(accumulated.slice(prefill.length)) + 4,
        fit.contextMax
      );
      // Extraction waits until the exchange settles — see schedulePending.
      schedulePendingExtraction(chatId, speakerCharId, assistantMsgId);
    } else if (!failed && assistantMsgId) {
      // Stop pressed before the first token — drop the bubble. Checking
      // `produced` rather than the text means a bubble holding only the
      // prefill goes too, instead of being saved as if the model wrote it.
      store.removeMessage(chatId, assistantMsgId);
    }
  } finally {
    abortController = null;
    store.setIsGenerating(false);
  }
}

// ─── Regenerate the last reply ────────────────────────────────────────────────
// Drops the trailing assistant message (if any) and generates a fresh one
// from the remaining history. Also works as "retry" after a failed reply.

export async function regenerateLastReply(chatId: string): Promise<void> {
  const store = useFableStore.getState();
  if (store.isGenerating) return;

  const chat = store.chats.find((c) => c.id === chatId);
  if (!chat || chat.messages.length === 0) return;

  const last = chat.messages[chat.messages.length - 1];
  let speaker: string | undefined;
  if (last.role === "assistant" && !last.imageJobId) {
    speaker = last.characterId; // groups: regenerate as the same speaker
    // A discarded take must leave no trace in memory — drop its pending
    // extraction rather than letting the re-rolled version stack a second
    // round of facts and stat deltas on top of it.
    cancelPendingExtraction(last.id);
    store.removeMessage(chatId, last.id);
  }
  await generateAssistantReply(chatId, speaker);
}

// ─── Deferred extraction ──────────────────────────────────────────────────────
// Extraction used to fire the instant a reply finished, which meant every
// re-roll wrote ANOTHER round of facts, stat deltas and bond cards for a take
// the user then threw away (deltaStat accumulates, so three re-rolls moved the
// relationship three times). Now a finished reply is only *pending*: it
// extracts once the exchange settles — the user sends their next message, a
// different reply supersedes it, or the idle timer expires. Re-rolling or
// deleting the reply before then cancels it outright.

interface PendingExtraction {
  chatId:    string;
  speakerId?: string;
  messageId: string;
  timer:     ReturnType<typeof setTimeout>;
}

let pending: PendingExtraction | null = null;

/** Idle fallback so a conversation left mid-turn still records its memory. */
const SETTLE_IDLE_MS = 120_000;

function schedulePendingExtraction(chatId: string, speakerId: string | undefined, messageId: string): void {
  // A new reply means the previous one is settled — flush it first.
  flushPendingExtraction();
  pending = {
    chatId,
    speakerId,
    messageId,
    timer: setTimeout(() => flushPendingExtraction(), SETTLE_IDLE_MS),
  };
}

/** Run any pending extraction now (called when the user sends their next message). */
export function flushPendingExtraction(): void {
  if (!pending) return;
  const p = pending;
  pending = null;
  clearTimeout(p.timer);
  runExtraction(p.chatId, p.speakerId);
}

/**
 * Drop a pending extraction. With a messageId, only cancels when that exact
 * reply is the one pending — so deleting an unrelated message can't silently
 * discard another turn's memory.
 */
function cancelPendingExtraction(messageId?: string): boolean {
  if (!pending) return false;
  if (messageId && pending.messageId !== messageId) return false;
  clearTimeout(pending.timer);
  pending = null;
  return true;
}

// ─── Knowledge extraction (Drawer 2 + Core Memory refresh) ───────────────────

function runExtraction(chatId: string, speakerId?: string): void {
  // Read current store state directly rather than a stale snapshot — the
  // assistant's completed reply is only present in the live store state.
  const {
    chats, characters, personas, activePersonaId, providerSettings,
    setIsExtracting, setLastExtractionError, bumpExtraction,
  } = useFableStore.getState();

  const chat      = chats.find((c) => c.id === chatId);
  const character = characters.find((c) => c.id === (speakerId ?? chat?.characterId));
  const persona   = personas.find((p) => p.id === activePersonaId) ?? null;
  if (!chat || !character) return;
  // The chat may have been cleared while this was pending — extracting from
  // an empty (or image-only) history would hallucinate memory from nothing.
  if (!chat.messages.some((m) => m.role === "assistant" && !m.error && !m.imageJobId)) return;

  // Witness list for group scenes: everyone present right now (+ player).
  // 1:1 chats send no list, and their facts stay public.
  const present = presentMemberIds(chat);
  const participants = present.length >= 2
    ? [
        ...present.map((id) => ({
          id, name: characters.find((c) => c.id === id)?.name ?? id,
        })),
        { id: "player", name: persona?.name ?? "User" },
      ]
    : undefined;

  const { providerType, providerBaseUrl, apiKey } =
    resolveRouteCredentials(chat.providerId, providerSettings);
  const modelId = chat.modelId ?? "llama3.2:latest";

  extractionsInFlight++;
  setIsExtracting(true);

  // In groups every message carries its speaker's name so the extractor
  // never attributes one character's line to another.
  const recentMessages = chat.messages
    .filter((m) => !m.error && !m.imageJobId)
    .slice(-16)
    .map((m) => ({
      role: m.role,
      content: m.content,
      ...(participants
        ? {
            speaker: m.role === "user"
              ? persona?.name ?? "User"
              : characters.find((c) => c.id === m.characterId)?.name ?? character.name,
          }
        : {}),
    }));

  const extractionBody: MemoryTaskRequest = {
    messages:        recentMessages,
    chatId,
    characterId:     character.id,
    characterName:   character.name,
    personaName:     persona?.name,
    // Drift anchor for the persona rewrite. Character sheet ONLY — never fold
    // in the global or preset prompt. Extraction runs format:"json" on backend
    // defaults, and a roleplay instruction here would poison the anchor and
    // break structured output. Same reason no generation params are sent.
    characterAnchor: [character.description, character.personality].filter(Boolean).join(" "),
    participants,
    providerType,
    providerBaseUrl,
    modelId,
    apiKey,
  };

  // POST and return a readable error string (or null on success) so a
  // model that can't emit JSON is visibly different from a quiet turn.
  /**
   * Fire one memory task and reduce it to an error string or null.
   *
   * `extra` carries the one field that differs between calls — the reflection
   * pass is the same body with mode:"reflect" — which is what an inline copy
   * of this was there for, with its own divergent message and no warning.
   */
  const post = (url: string, label: string, extra?: Partial<MemoryTaskRequest>): Promise<string | null> =>
    sendJson("POST", url, { ...extractionBody, ...extra })
      .then(() => null)
      .catch((e: Error) => {
        const msg = `${label}: ${e.message}`;
        console.warn(`[${label}]`, msg);
        return msg;
      });

  // Episodic cadence: a scene card every ~8 exchanges, a reflection every ~24.
  // Derived from message count so it needs no separate bookkeeping.
  const exchanges = chat.messages.filter((m) => m.role === "assistant" && !m.error && !m.imageJobId).length;
  const calls: Array<Promise<string | null>> = [
    post("/api/drawer/extract",           "extraction"),
    post("/api/chat/core-memory/refresh", "core memory"),
  ];
  if (exchanges > 0 && exchanges % 8 === 0) {
    calls.push(post("/api/drawer/episode", "episode"));
  }
  if (exchanges > 0 && exchanges % 24 === 0) {
    calls.push(post("/api/drawer/episode", "reflection", { mode: "reflect" }));
  }

  Promise.all(calls)
    .then((errors) => {
      setLastExtractionError(errors.find((e) => e !== null) ?? null);
      bumpExtraction();
    })
    .finally(() => {
      extractionsInFlight--;
      if (extractionsInFlight === 0) setIsExtracting(false);
    });
}
