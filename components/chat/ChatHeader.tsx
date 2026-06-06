"use client";

import { useEffect, useState } from "react";
import { useFableStore } from "@/lib/store";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { OllamaProvider } from "@/lib/providers/ollama";
import { LMStudioProvider } from "@/lib/providers/lmstudio";
import { OpenRouterProvider } from "@/lib/providers/openrouter";
import type { ModelInfo } from "@/lib/types";
import {
  PanelRightOpen,
  PanelRightClose,
  Settings2,
  RefreshCw,
  Trash2,
  Loader2,
} from "lucide-react";

// ─── Fallback static list (shown before dynamic load or when offline) ─────────

const FALLBACK_MODELS: ModelInfo[] = [
  { id: "llama3.2:latest",             name: "Llama 3.2",              providerId: "ollama" },
  { id: "llama3.1:latest",             name: "Llama 3.1",              providerId: "ollama" },
  { id: "mistral:latest",              name: "Mistral 7B",             providerId: "ollama" },
  { id: "lmstudio-model",              name: "LM Studio (loaded model)",providerId: "lmstudio" },
  { id: "anthropic/claude-3.5-sonnet", name: "Claude 3.5 Sonnet",      providerId: "openrouter" },
  { id: "anthropic/claude-3-haiku",    name: "Claude 3 Haiku",         providerId: "openrouter" },
  { id: "openai/gpt-4o",               name: "GPT-4o",                 providerId: "openrouter" },
  { id: "openai/gpt-4o-mini",          name: "GPT-4o Mini",            providerId: "openrouter" },
  { id: "google/gemini-flash-1.5",     name: "Gemini Flash 1.5",       providerId: "openrouter" },
];

const PROVIDER_LABELS: Record<string, string> = {
  ollama:      "Ollama",
  lmstudio:    "LM Studio",
  openrouter:  "OpenRouter",
};

// ─── Component ────────────────────────────────────────────────────────────────

export function ChatHeader() {
  const {
    activeChatId, chats, characters,
    inspectorOpen, setInspectorOpen,
    setChatModel, providerSettings, providerStatuses,
  } = useFableStore();

  const chat      = chats.find((c) => c.id === activeChatId);
  const character = characters.find((c) => c.id === chat?.characterId);

  const [models,        setModels]        = useState<ModelInfo[]>(FALLBACK_MODELS);
  const [loadingModels, setLoadingModels] = useState(false);

  // ── Fetch real model lists whenever providers change ──────────────────────

  useEffect(() => {
    let cancelled = false;
    const fetchAll = async () => {
      setLoadingModels(true);

      // All three provider fetches run in parallel
      const [ollamaModels, lmModels, orModels] = await Promise.all([
        new OllamaProvider(providerSettings.ollama.baseUrl).listModels().catch(() => [] as ModelInfo[]),
        new LMStudioProvider(providerSettings.lmstudio.baseUrl).listModels().catch(() => [] as ModelInfo[]),
        providerSettings.openrouter.apiKey
          ? new OpenRouterProvider(providerSettings.openrouter.apiKey).listModels().then((ms) => ms.slice(0, 30)).catch(() => [] as ModelInfo[])
          : Promise.resolve([] as ModelInfo[]),
      ]);

      if (!cancelled) {
        const collected = [...ollamaModels, ...lmModels, ...orModels];
        setModels(collected.length > 0 ? collected : FALLBACK_MODELS);
        setLoadingModels(false);
      }
    };

    fetchAll();
    return () => { cancelled = true; };
    // Re-fetch whenever settings or connection status changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    providerSettings.ollama.baseUrl,
    providerSettings.lmstudio.baseUrl,
    providerSettings.openrouter.apiKey,
    // Trigger when a provider comes online
    providerStatuses.map((p) => `${p.id}:${p.connected}`).join(","),
  ]);

  if (!chat) return null;

  const contextPct = chat.contextMax
    ? Math.round(((chat.contextUsed ?? 0) / chat.contextMax) * 100)
    : 0;

  const currentModel = chat.modelId ?? models[0]?.id ?? "";

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const modelId  = e.target.value;
    const model    = models.find((m) => m.id === modelId);
    const provider = model?.providerId ?? "ollama";
    setChatModel(chat.id, modelId, provider);
  };

  // Group models by provider for <optgroup>
  const grouped = Object.entries(
    models.reduce<Record<string, ModelInfo[]>>((acc, m) => {
      const key = m.providerId ?? "other";
      (acc[key] ??= []).push(m);
      return acc;
    }, {})
  );

  return (
    <div className="flex items-center gap-3 px-4 h-14 border-b border-[var(--border)] bg-white flex-shrink-0">
      {/* Character info */}
      <div className="flex items-center gap-2.5 flex-1 min-w-0">
        <Avatar name={character?.name ?? chat.name} src={character?.avatar} size="sm" />
        <div className="min-w-0">
          <div className="font-semibold text-sm text-[var(--foreground)] truncate">
            {chat.name}
          </div>
          {character && (
            <div className="text-[11px] text-[var(--muted-fg)] truncate">
              {character.tags.slice(0, 2).join(" · ")}
            </div>
          )}
        </div>
      </div>

      {/* Model selector */}
      <div className="flex items-center gap-2">
        <div className="relative flex items-center">
          {loadingModels && (
            <Loader2 className="h-3 w-3 animate-spin text-[var(--muted-fg)] absolute left-2 pointer-events-none z-10" />
          )}
          <select
            value={currentModel}
            onChange={handleModelChange}
            className={`h-8 rounded-lg border border-[var(--border)] bg-white text-xs text-[var(--foreground)] pr-2 focus:outline-none focus:ring-1 focus:ring-[var(--purple)] focus:border-[var(--purple)] ${
              loadingModels ? "pl-6" : "pl-2"
            }`}
            style={{ maxWidth: "200px" }}
          >
            {grouped.map(([providerId, providerModels]) => (
              <optgroup key={providerId} label={PROVIDER_LABELS[providerId] ?? providerId}>
                {providerModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name ?? m.id}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {/* Context bar */}
        <div className="flex items-center gap-1.5 text-xs text-[var(--muted-fg)] min-w-[80px]">
          <div className="h-1.5 w-16 rounded-full bg-[var(--border)] overflow-hidden">
            <div
              className="h-full rounded-full bg-[var(--purple)] transition-all"
              style={{ width: `${contextPct}%` }}
            />
          </div>
          <span className="text-[10px] tabular-nums">{contextPct}%</span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" title="Chat settings">
          <Settings2 className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" title="Regenerate last message">
          <RefreshCw className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" title="Clear chat">
          <Trash2 className="h-4 w-4" />
        </Button>
        <div className="h-4 w-px bg-[var(--border)] mx-1" />
        <Button
          variant="ghost"
          size="icon"
          title={inspectorOpen ? "Hide inspector" : "Show inspector"}
          onClick={() => setInspectorOpen(!inspectorOpen)}
        >
          {inspectorOpen ? (
            <PanelRightClose className="h-4 w-4" />
          ) : (
            <PanelRightOpen className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
