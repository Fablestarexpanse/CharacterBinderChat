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
import { fitHistoryToBudget } from "./tokenBudget";
import type { ChatProvider, MessageRole, ProviderSettings } from "@/lib/types";
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
  knownFacts:  string[];
}

async function fetchCoreMemory(
  characterId:   string,
  characterName: string
): Promise<CoreMemoryResponse> {
  try {
    const res = await fetch(
      `/api/chat/core-memory?characterId=${encodeURIComponent(characterId)}&name=${encodeURIComponent(characterName)}`,
      { cache: "no-store" }
    );
    if (!res.ok) return { coreMemory: null, knownFacts: [] };
    const data = (await res.json()) as { ok: boolean; coreMemory: CoreMemory; knownFacts?: string[] };
    return {
      coreMemory: data.ok ? data.coreMemory : null,
      knownFacts:  data.knownFacts ?? [],
    };
  } catch {
    return { coreMemory: null, knownFacts: [] };
  }
}

// ─── Generate a reply to the chat's current history ──────────────────────────

export async function generateAssistantReply(chatId: string): Promise<void> {
  const store = useFableStore.getState();
  if (store.isGenerating) return;

  const chat = store.chats.find((c) => c.id === chatId);
  if (!chat) return;
  const character  = store.characters.find((c) => c.id === chat.characterId);
  const providerId = chat.providerId ?? "ollama";
  const modelId    = chat.modelId    ?? "llama3.2:latest";
  const provider   = instantiateProvider(providerId, store.providerSettings);

  if (!provider) {
    store.addMessage(chatId, {
      chatId,
      role:    "assistant",
      content: "⚠️ No provider available. Check Settings — make sure your provider is running and any required API key is set.",
    });
    return;
  }

  // ── Fetch Core Memory (Drawer 1) + Drawer 2 known facts ──────────────────
  const { coreMemory, knownFacts } = character
    ? await fetchCoreMemory(character.id, character.name)
    : { coreMemory: null, knownFacts: [] };

  // ── Build message history within the model's token budget ────────────────
  const persona = store.personas.find((p) => p.id === store.activePersonaId) ?? null;
  const systemPrompt = buildSystemPrompt(character, coreMemory, knownFacts, persona);
  const fullHistory: Array<{ role: MessageRole; content: string }> = chat.messages
    .filter((m) => m.content.trim().length > 0 && !m.imageJobId)
    .map((m) => ({ role: m.role as MessageRole, content: m.content }));
  const fit = fitHistoryToBudget(systemPrompt, fullHistory, modelId);
  if (fit.dropped > 0) {
    console.info(`[chat] context window: dropped ${fit.dropped} oldest message(s) to fit`);
  }
  store.setChatContext(chatId, fit.usedTokens, fit.contextMax);
  const history: Array<{ role: MessageRole; content: string }> = [
    { role: "system", content: systemPrompt },
    ...fit.messages,
  ];

  // ── Create placeholder assistant message + stream into it ─────────────────
  store.setIsGenerating(true);
  const assistantMsgId = store.addMessage(chatId, {
    chatId,
    role:        "assistant",
    content:     "",
    characterId: character?.id,
  });

  const controller = new AbortController();
  abortController = controller;
  let accumulated = "";
  let failed = false;

  try {
    for await (const token of provider.streamChat(history, modelId, undefined, controller.signal)) {
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
    }
  } finally {
    abortController = null;
    store.setIsGenerating(false);
  }

  if (!failed && accumulated.trim()) {
    // Include the finished reply in the context meter
    store.setChatContext(chatId, fit.usedTokens + estimateTokens(accumulated) + 4, fit.contextMax);
    // Extraction runs after the full (or stopped-partial) response
    triggerExtraction(chatId);
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
  if (last.role === "assistant" && !last.imageJobId) {
    store.removeMessage(chatId, last.id);
  }
  await generateAssistantReply(chatId);
}

// ─── Knowledge extraction (Drawer 2 + Core Memory refresh) ───────────────────

function triggerExtraction(chatId: string): void {
  // Read current store state directly rather than a stale snapshot — the
  // assistant's completed reply is only present in the live store state.
  const {
    chats, characters, personas, activePersonaId, providerSettings,
    setIsExtracting, setLastExtractionError, bumpExtraction,
  } = useFableStore.getState();

  const chat      = chats.find((c) => c.id === chatId);
  const character = characters.find((c) => c.id === chat?.characterId);
  const persona   = personas.find((p) => p.id === activePersonaId) ?? null;
  if (!chat || !character) return;

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

  const recentMessages = chat.messages.slice(-16).map((m) => ({ role: m.role, content: m.content }));

  const extractionBody = {
    messages:        recentMessages,
    characterId:     character.id,
    characterName:   character.name,
    personaName:     persona?.name,
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

  Promise.all([
    post("/api/drawer/extract",           "extraction"),
    post("/api/chat/core-memory/refresh", "core memory"),
  ])
    .then(([extractErr, refreshErr]) => {
      setLastExtractionError(extractErr ?? refreshErr ?? null);
      bumpExtraction();
    })
    .finally(() => setIsExtracting(false));
}
