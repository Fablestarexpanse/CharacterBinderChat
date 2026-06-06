"use client";

import { useRef, useState, useEffect, type KeyboardEvent } from "react";
import { useFableStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { ComfyUIProvider } from "@/lib/providers/comfyui";
import { OllamaProvider } from "@/lib/providers/ollama";
import { LMStudioProvider } from "@/lib/providers/lmstudio";
import { OpenRouterProvider } from "@/lib/providers/openrouter";
import { buildSystemPrompt } from "@/lib/chat/promptBuilder";
import type { Character, ChatProvider, ProviderSettings, MessageRole } from "@/lib/types";
import type { CoreMemory } from "@/lib/db/models";
import {
  Paperclip,
  ImageIcon,
  BookOpen,
  Wrench,
  Send,
  Wand2,
} from "lucide-react";

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

// ─── Component ────────────────────────────────────────────────────────────────

export function ChatInput() {
  const {
    activeChatId, chats, characters,
    inputValue, setInputValue,
    addMessage, updateMessageContent,
    addImageJob, imageSettings,
    providerSettings,
    bumpExtraction, setIsExtracting,
  } = useFableStore();

  const textareaRef      = useRef<HTMLTextAreaElement>(null);
  const decayFiredRef    = useRef(false);
  const [isGenerating, setIsGenerating] = useState(false);

  // ── Lazy stat decay ────────────────────────────────────────────────────────
  // On the first render of this component (i.e. first session), compute how
  // many days have passed since the last session and apply Ebbinghaus decay
  // once. Completely in-process — no scheduler, no cron.
  useEffect(() => {
    const LAST_SESSION_KEY = "fablechat:lastSessionAt";
    const now = Date.now();
    const lastStr = localStorage.getItem(LAST_SESSION_KEY);
    localStorage.setItem(LAST_SESSION_KEY, String(now));

    if (!lastStr) return; // first ever session — nothing to decay yet
    const daysElapsed = (now - Number(lastStr)) / (1000 * 60 * 60 * 24);
    if (daysElapsed < 0.01) return; // same session, skip

    fetch("/api/drawer/stats/decay", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ days: daysElapsed }),
    }).catch((e) => console.warn("[decay]", e));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Core send handler ─────────────────────────────────────────────────────

  const handleSend = async () => {
    if (!inputValue.trim() || !activeChatId || isGenerating) return;

    const userContent = inputValue.trim();
    setInputValue("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    // /image command
    if (userContent.startsWith("/image ")) {
      await handleImageGeneration(userContent.slice(7).trim());
      return;
    }

    // Add user message
    addMessage(activeChatId, { chatId: activeChatId, role: "user", content: userContent });

    // ── Resolve provider + model ────────────────────────────────────────────
    const chat      = chats.find((c) => c.id === activeChatId);
    const character = characters.find((c) => c.id === chat?.characterId);
    const providerId = chat?.providerId ?? "ollama";
    const modelId    = chat?.modelId    ?? "llama3.2:latest";
    const provider   = instantiateProvider(providerId, providerSettings);

    // ── No provider / missing API key ───────────────────────────────────────
    if (!provider) {
      addMessage(activeChatId, {
        chatId:  activeChatId,
        role:    "assistant",
        content: "⚠️ No provider available. Check Settings — make sure your provider is running and any required API key is set.",
      });
      return;
    }

    // ── Fetch Core Memory (Drawer 1) + Drawer 2 known facts ────────────────
    const { coreMemory, knownFacts } = character
      ? await fetchCoreMemory(character.id, character.name)
      : { coreMemory: null, knownFacts: [] };

    // ── Build message history ───────────────────────────────────────────────
    const systemPrompt = buildSystemPrompt(character, coreMemory, knownFacts);
    const history: Array<{ role: MessageRole; content: string }> = [
      { role: "system", content: systemPrompt },
      // Existing messages (skip image-only placeholders)
      ...(chat?.messages
        .filter((m) => m.content.trim().length > 0)
        .map((m) => ({ role: m.role as MessageRole, content: m.content })) ?? []),
      // The message we just sent
      { role: "user", content: userContent },
    ];

    // ── Create placeholder assistant message ────────────────────────────────
    setIsGenerating(true);
    const assistantMsgId = addMessage(activeChatId, {
      chatId:      activeChatId,
      role:        "assistant",
      content:     "",
      characterId: character?.id,
    });

    // ── Stream tokens ───────────────────────────────────────────────────────
    try {
      let accumulated = "";

      for await (const token of provider.streamChat(history, modelId)) {
        accumulated += token;
        updateMessageContent(activeChatId, assistantMsgId, accumulated);
      }

      // Extraction runs after the full response is received
      if (accumulated.trim()) {
        triggerExtraction(activeChatId);
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      updateMessageContent(
        activeChatId,
        assistantMsgId,
        `⚠️ **Response failed** — ${detail}\n\nMake sure **${providerId}** is running and the model \`${modelId}\` is available.`
      );
    } finally {
      setIsGenerating(false);
    }
  };

  // ── Knowledge extraction ──────────────────────────────────────────────────

  const triggerExtraction = (chatId: string) => {
    const chat      = chats.find((c) => c.id === chatId);
    const character = characters.find((c) => c.id === chat?.characterId);
    if (!chat || !character) return;

    const providerType =
      chat.providerId === "lmstudio"   ? "lmstudio"
      : chat.providerId === "openrouter" ? "openrouter"
      : "ollama";
    const baseUrl =
      providerType === "lmstudio"    ? providerSettings.lmstudio.baseUrl
      : providerType === "openrouter"  ? "https://openrouter.ai/api"
      : providerSettings.ollama.baseUrl;
    const modelId = chat.modelId ?? "llama3.2:latest";
    const apiKey  = providerType === "openrouter" ? providerSettings.openrouter.apiKey : undefined;

    setIsExtracting(true);

    const recentMessages = chat.messages.slice(-16).map((m) => ({ role: m.role, content: m.content }));

    // Run Drawer-2 extraction and Core Memory refresh in parallel
    const extractionBody = {
      messages:        recentMessages,
      characterId:     character.id,
      characterName:   character.name,
      providerType,
      providerBaseUrl: baseUrl,
      modelId,
      apiKey,
    };

    Promise.all([
      fetch("/api/drawer/extract", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(extractionBody),
      }).catch((e) => console.warn("[drawer2/extract]", e)),

      fetch("/api/chat/core-memory/refresh", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(extractionBody),
      }).catch((e) => console.warn("[core-memory/refresh]", e)),
    ])
      .then(() => bumpExtraction())
      .finally(() => setIsExtracting(false));
  };

  // ── Image generation ──────────────────────────────────────────────────────

  const handleImageGeneration = async (prompt: string) => {
    if (!activeChatId) return;
    const settings = { ...imageSettings, prompt };
    const comfyui  = new ComfyUIProvider(providerSettings.comfyui.baseUrl);
    const job       = comfyui.createMockJob(settings, activeChatId);
    addImageJob(job);
    addMessage(activeChatId, {
      chatId:      activeChatId,
      role:        "assistant",
      content:     prompt,
      imageJobId:  job.id,
    });
  };

  // ── Keyboard / resize ─────────────────────────────────────────────────────

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  };

  const isImageCommand = inputValue.startsWith("/image ");

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="px-4 pb-4 pt-2 flex-shrink-0">
      {isImageCommand && (
        <div className="flex items-center gap-2 mb-2 px-1">
          <Wand2 className="h-3.5 w-3.5 text-[var(--purple-fg)]" />
          <span className="text-xs text-[var(--purple-fg)]">
            Image generation — press Enter to generate
          </span>
        </div>
      )}

      <div
        className={`flex flex-col gap-2 rounded-2xl border bg-white p-2 transition-colors ${
          isImageCommand ? "border-[var(--purple)]" : "border-[var(--border)]"
        } focus-within:border-[var(--purple)] focus-within:ring-1 focus-within:ring-[var(--purple)]`}
      >
        <textarea
          ref={textareaRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder={
            isGenerating
              ? "Generating response…"
              : "Message… (try /image a cyberpunk alley at night)"
          }
          disabled={isGenerating}
          rows={1}
          className="w-full resize-none bg-transparent px-2 py-1 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-fg)] focus:outline-none disabled:opacity-50"
          style={{ minHeight: "36px", maxHeight: "160px" }}
        />

        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-0.5">
            <Button variant="ghost" size="icon" className="h-7 w-7" title="Attach file">
              <Paperclip className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title="Generate image (/image)"
              onClick={() => setInputValue("/image ")}
            >
              <ImageIcon className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" title="Insert lorebook">
              <BookOpen className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" title="Tools">
              <Wrench className="h-3.5 w-3.5" />
            </Button>
          </div>

          <Button
            variant="purple"
            size="icon"
            className="h-8 w-8 rounded-xl"
            onClick={handleSend}
            disabled={!inputValue.trim() || isGenerating}
            title="Send (Enter)"
          >
            <Send className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="text-center mt-1.5">
        <span className="text-[10px] text-[var(--muted-fg)]">
          Shift+Enter for new line · /image to generate · FableChat v0.1
        </span>
      </div>
    </div>
  );
}
