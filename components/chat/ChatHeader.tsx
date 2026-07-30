"use client";

import { useEffect, useState } from "react";
import { useFableStore } from "@/lib/store";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { OllamaProvider } from "@/lib/providers/ollama";
import { LMStudioProvider } from "@/lib/providers/lmstudio";
import { OpenRouterProvider } from "@/lib/providers/openrouter";
import { regenerateLastReply } from "@/lib/chat/generation";
import type { ModelInfo, ProviderId } from "@/lib/types";
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
    clearChat, isGenerating,
    customModels, addCustomModel,
  } = useFableStore();

  const chat      = chats.find((c) => c.id === activeChatId);
  const character = characters.find((c) => c.id === chat?.characterId);

  const [models,        setModels]        = useState<ModelInfo[]>(FALLBACK_MODELS);
  const [loadingModels, setLoadingModels] = useState(false);
  const [confirmClear,  setConfirmClear]  = useState(false);

  // Custom model entry
  const [customOpen,     setCustomOpen]     = useState(false);
  const [customId,       setCustomId]       = useState("");
  const [customProvider, setCustomProvider] = useState<ProviderId>("openrouter");

  // ── Fetch real model lists whenever providers change ──────────────────────

  // Flattened so the deps array holds a plain string (statically checkable)
  const providerConnectivity = providerStatuses.map((p) => `${p.id}:${p.connected}`).join(",");

  useEffect(() => {
    let cancelled = false;
    const fetchAll = async () => {
      setLoadingModels(true);

      // All three provider fetches run in parallel
      const [ollamaModels, lmModels, orModels] = await Promise.all([
        new OllamaProvider(providerSettings.ollama.baseUrl).listModels().catch(() => [] as ModelInfo[]),
        new LMStudioProvider(providerSettings.lmstudio.baseUrl).listModels().catch(() => [] as ModelInfo[]),
        providerSettings.openrouter.apiKey
          ? new OpenRouterProvider(providerSettings.openrouter.apiKey).listModels().catch(() => [] as ModelInfo[])
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
    // Re-fetch whenever settings change or a provider comes online
  }, [
    providerSettings.ollama.baseUrl,
    providerSettings.lmstudio.baseUrl,
    providerSettings.openrouter.apiKey,
    providerConnectivity,
  ]);

  if (!chat) return null;

  const contextPct = chat.contextMax
    ? Math.round(((chat.contextUsed ?? 0) / chat.contextMax) * 100)
    : 0;

  // Custom models the user typed in, plus whatever the providers reported. If
  // the chat's saved model isn't in either list (e.g. set before a provider
  // went offline), surface it so the selector still shows the truth.
  const knownModels: ModelInfo[] = [...customModels, ...models];
  const savedModelMissing =
    !!chat.modelId && !knownModels.some((m) => m.id === chat.modelId);
  const allModels: ModelInfo[] = savedModelMissing
    ? [
        { id: chat.modelId!, name: chat.modelId!, providerId: (chat.providerId ?? "ollama") as ProviderId },
        ...knownModels,
      ]
    : knownModels;

  const currentModel = chat.modelId ?? allModels[0]?.id ?? "";

  const CUSTOM_SENTINEL = "__custom__";

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const modelId = e.target.value;
    if (modelId === CUSTOM_SENTINEL) {
      setCustomId("");
      setCustomOpen(true);
      return;
    }
    const model = allModels.find((m) => m.id === modelId);
    // Only fall back to ollama for genuinely unknown ids; a known model always
    // carries its own provider, so cloud models can't get routed locally.
    const provider = model?.providerId ?? "ollama";
    setChatModel(chat.id, modelId, provider);
  };

  const handleCustomSave = () => {
    const id = customId.trim();
    if (!id) return;
    addCustomModel({ id, name: id, providerId: customProvider });
    setChatModel(chat.id, id, customProvider);
    setCustomOpen(false);
    setCustomId("");
  };

  // Group models by provider for <optgroup>
  const grouped = Object.entries(
    allModels.reduce<Record<string, ModelInfo[]>>((acc, m) => {
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
            <option value={CUSTOM_SENTINEL}>＋ Custom model ID…</option>
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
        <Button
          variant="ghost"
          size="icon"
          title="Regenerate last message"
          disabled={isGenerating || chat.messages.length === 0}
          onClick={() => regenerateLastReply(chat.id)}
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={confirmClear ? "text-red-500 hover:bg-red-50" : ""}
          title={confirmClear ? "Click again to clear all messages" : "Clear chat"}
          disabled={isGenerating || chat.messages.length === 0}
          onClick={() => {
            if (confirmClear) {
              clearChat(chat.id);
              setConfirmClear(false);
            } else {
              setConfirmClear(true);
              setTimeout(() => setConfirmClear(false), 3000);
            }
          }}
        >
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

      {/* Custom model ID dialog */}
      <Dialog open={customOpen} onOpenChange={setCustomOpen}>
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          <div className="border-b border-[var(--border)] px-5 py-4">
            <DialogTitle>Use a custom model</DialogTitle>
          </div>

          <div className="space-y-4 px-5 py-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--foreground)]">Model ID</label>
              <Input
                autoFocus
                value={customId}
                onChange={(e) => setCustomId(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCustomSave(); }}
                placeholder="deepseek/deepseek-chat"
                className="font-mono text-xs"
              />
              <p className="text-[11px] text-[var(--muted-fg)]">
                Exactly as the provider names it. OpenRouter uses{" "}
                <code className="bg-[var(--muted)] px-1 rounded">vendor/model</code> slugs — copy
                the ID from{" "}
                <a
                  href="https://openrouter.ai/models"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--purple-fg)] underline"
                >
                  openrouter.ai/models
                </a>
                . Ollama uses{" "}
                <code className="bg-[var(--muted)] px-1 rounded">name:tag</code>.
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--foreground)]">Provider</label>
              <select
                value={customProvider}
                onChange={(e) => setCustomProvider(e.target.value as ProviderId)}
                className="h-9 w-full rounded-lg border border-[var(--border)] bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--purple)]"
              >
                <option value="openrouter">OpenRouter</option>
                <option value="ollama">Ollama</option>
                <option value="lmstudio">LM Studio</option>
              </select>
              {customProvider === "openrouter" && !providerSettings.openrouter.apiKey && (
                <p className="text-[11px] text-amber-600">
                  No OpenRouter API key set — add one in Settings or the request will fail.
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
            <Button variant="outline" size="sm" onClick={() => setCustomOpen(false)}>
              Cancel
            </Button>
            <Button variant="purple" size="sm" onClick={handleCustomSave} disabled={!customId.trim()}>
              Use model
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
