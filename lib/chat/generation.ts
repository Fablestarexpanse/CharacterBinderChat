// ─── Generation ───────────────────────────────────────────────────────────────
// Shared client-side generation pipeline, extracted from ChatInput so the
// header (Regenerate) and message rows can trigger it too. One generation at
// a time; isGenerating lives in the store so every component sees it, while
// the AbortController stays module-local (not serialisable).

import { useFableStore } from "@/lib/store";
import { OllamaProvider } from "@/lib/providers/ollama";
import { LMStudioProvider } from "@/lib/providers/lmstudio";
import { OpenRouterProvider } from "@/lib/providers/openrouter";
import { buildSystemPrompt, estimateTokens } from "./promptBuilder";
import { matchLoreEntries } from "./lorebook";
import { fitHistoryToBudget } from "./tokenBudget";
import type { Chat, Character, ChatProvider, MessageRole, ProviderSettings } from "@/lib/types";
import type { CoreMemory } from "@/lib/db/models";

let abortController: AbortController | null = null;

export function stopGeneration(): void {
  abortController?.abort();
}

// ─── Provider factory ─────────────────────────────────────────────────────────

function instantiateProvider(
  providerId: string | undefined,
  settings: ProviderSettings
): ChatProvider | null {
  switch (providerId) {
    case "lmstudio":
      return new LMStudioProvider(settings.lmstudio.baseUrl);
    case "openrouter":
      if (!settings.openrouter.apiKey) return null;
      return new OpenRouterProvider(settings.openrouter.apiKey);
    case "ollama":
    default:
      return new OllamaProvider(settings.ollama.baseUrl);
  }
}

// ─── Core Memory fetcher ──────────────────────────────────────────────────────

interface CoreMemoryResponse {
  coreMemory: CoreMemory | null;
  knownFacts: string[];
  episodes:   string[];
  insights:   string[];
  bits:       string[];
}

async function fetchCoreMemory(
  chatId:        string,
  characterId:   string,
  characterName: string,
  context = ""
): Promise<CoreMemoryResponse> {
  try {
    // Context lets retrieval rank facts by relevance to what's being discussed.
    // Capped so the query string stays a sane length.
    const ctxParam = context ? `&context=${encodeURIComponent(context.slice(0, 600))}` : "";
    const res = await fetch(
      `/api/chat/core-memory?chatId=${encodeURIComponent(chatId)}&characterId=${encodeURIComponent(characterId)}&name=${encodeURIComponent(characterName)}${ctxParam}`,
      { cache: "no-store" }
    );
    if (!res.ok) return { coreMemory: null, knownFacts: [], episodes: [], insights: [], bits: [] };
    const data = (await res.json()) as {
      ok: boolean; coreMemory: CoreMemory; knownFacts?: string[]; episodes?: string[];
      insights?: string[]; bits?: string[];
    };
    return {
      coreMemory: data.ok ? data.coreMemory : null,
      knownFacts: data.knownFacts ?? [],
      episodes:   data.episodes ?? [],
      insights:   data.insights ?? [],
      bits:       data.bits ?? [],
    };
  } catch {
    return { coreMemory: null, knownFacts: [], episodes: [], insights: [], bits: [] };
  }
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
  const provider   = instantiateProvider(providerId, store.providerSettings);

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

  try {
    // ── Fetch Core Memory (Drawer 1) + Drawer 2 known facts ────────────────
    // The last few turns act as the relevance signal for fact retrieval
    const recentText = chat.messages.slice(-3).map((m) => m.content).join(" ");
    const { coreMemory, knownFacts, episodes, insights, bits } = character
      ? await fetchCoreMemory(chatId, character.id, character.name, recentText)
      : { coreMemory: null, knownFacts: [], episodes: [], insights: [], bits: [] };

    // ── Build message history within the model's token budget ──────────────
    const persona = store.personas.find((p) => p.id === store.activePersonaId) ?? null;
    // Lorebook entries fire on keywords in the recent turns — a wider window
    // than fact retrieval so lore doesn't flicker out one exchange after its
    // subject was raised.
    const loreScanText = chat.messages.slice(-6).map((m) => m.content).join("\n");
    const lore = matchLoreEntries(store.lorebooks, loreScanText);
    let systemPrompt = buildSystemPrompt(character, coreMemory, knownFacts, persona, episodes, insights, lore, bits);

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
    const fit = fitHistoryToBudget(systemPrompt, fullHistory, modelId);
    if (fit.dropped > 0) {
      console.info(`[chat] context window: dropped ${fit.dropped} oldest message(s) to fit`);
    }
    store.setChatContext(chatId, fit.usedTokens, fit.contextMax);
    const history: Array<{ role: MessageRole; content: string }> = [
      { role: "system", content: systemPrompt },
      ...fit.messages,
    ];

    // ── Create placeholder assistant message + stream into it ───────────────
    assistantMsgId = store.addMessage(chatId, {
      chatId,
      role:        "assistant",
      content:     "",
      characterId: character?.id,
    });
    // Provenance: record exactly which memory was injected into this reply's
    // prompt, so the message can answer "why did you say that?"
    store.setMessageMemoryTrace(chatId, assistantMsgId, {
      facts: knownFacts, episodes, insights, bits, lore,
      storyTime: coreMemory?.story_time ?? null,
    });

    const controller = new AbortController();
    abortController = controller;

    try {
      for await (const token of provider.streamChat(history, modelId, chat.settings, controller.signal)) {
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

    if (!failed && accumulated.trim()) {
      // Include the finished reply in the context meter
      store.setChatContext(chatId, fit.usedTokens + estimateTokens(accumulated) + 4, fit.contextMax);
      // Extraction runs after the full (or stopped-partial) response,
      // attributed to whoever just spoke
      triggerExtraction(chatId, speakerCharId);
    } else if (!failed && assistantMsgId) {
      // Stop pressed before the first token — drop the empty bubble
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
    store.removeMessage(chatId, last.id);
  }
  await generateAssistantReply(chatId, speaker);
}

// ─── Knowledge extraction (Drawer 2 + Core Memory refresh) ───────────────────

function triggerExtraction(chatId: string, speakerId?: string): void {
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

  const providerType =
    chat.providerId === "lmstudio"     ? "lmstudio"
    : chat.providerId === "openrouter" ? "openrouter"
    : "ollama";
  const baseUrl =
    providerType === "lmstudio"       ? providerSettings.lmstudio.baseUrl
    : providerType === "openrouter"   ? "https://openrouter.ai/api"
    : providerSettings.ollama.baseUrl;
  const modelId = chat.modelId ?? "llama3.2:latest";
  const apiKey  = providerType === "openrouter" ? providerSettings.openrouter.apiKey : undefined;

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

  const extractionBody = {
    messages:        recentMessages,
    chatId,
    characterId:     character.id,
    characterName:   character.name,
    personaName:     persona?.name,
    // Drift anchor for the persona rewrite
    characterAnchor: [character.description, character.personality].filter(Boolean).join(" "),
    participants,
    providerType,
    providerBaseUrl: baseUrl,
    modelId,
    apiKey,
  };

  // POST and return a readable error string (or null on success) so a
  // model that can't emit JSON is visibly different from a quiet turn.
  const post = (url: string, label: string): Promise<string | null> =>
    fetch(url, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(extractionBody),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => null) as { ok?: boolean; error?: string } | null;
        if (!res.ok || data?.ok === false) {
          const msg = `${label}: ${data?.error ?? `HTTP ${res.status}`}`;
          console.warn(`[${label}]`, msg);
          return msg;
        }
        return null;
      })
      .catch((e) => {
        console.warn(`[${label}]`, e);
        return `${label}: ${e instanceof Error ? e.message : String(e)}`;
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
    calls.push(
      fetch("/api/drawer/episode", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ ...extractionBody, mode: "reflect" }),
      })
        .then(async (res) => {
          const data = await res.json().catch(() => null) as { ok?: boolean; error?: string } | null;
          return !res.ok || data?.ok === false ? `reflection: ${data?.error ?? res.status}` : null;
        })
        .catch((e) => `reflection: ${e instanceof Error ? e.message : String(e)}`)
    );
  }

  Promise.all(calls)
    .then((errors) => {
      setLastExtractionError(errors.find((e) => e !== null) ?? null);
      bumpExtraction();
    })
    .finally(() => setIsExtracting(false));
}
