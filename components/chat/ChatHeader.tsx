"use client";

import { useEffect, useState } from "react";
import { useFableStore, DEFAULT_UTILITY_MODEL } from "@/lib/store";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { allChatProviders } from "@/lib/providers/factory";
import { regenerateLastReply } from "@/lib/chat/generation";
import type { ModelInfo, ProviderId } from "@/lib/types";
import {
  PanelRightOpen,
  PanelRightClose,
  Settings2,
  RefreshCw,
  Trash2,
  Loader2,
  X,
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
    customModels, addCustomModel, removeCustomModel,
    updateChatSettings, toggleMemberPresence,
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

  // Generation settings dialog
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ── Fetch real model lists whenever providers change ──────────────────────

  // Flattened so the deps array holds a plain string (statically checkable)
  const providerConnectivity = providerStatuses.map((p) => `${p.id}:${p.connected}`).join(",");

  useEffect(() => {
    let cancelled = false;
    const fetchAll = async () => {
      setLoadingModels(true);

      // Every reachable provider is queried in parallel
      const lists = await Promise.all(
        allChatProviders(providerSettings).map((p) =>
          p.listModels().catch(() => [] as ModelInfo[])
        )
      );

      if (!cancelled) {
        const collected = lists.flat();
        setModels(collected.length > 0 ? collected : FALLBACK_MODELS);
        setLoadingModels(false);
      }
    };

    fetchAll();
    return () => { cancelled = true; };
    // Deps are the three fields that actually change the model lists, not the
    // whole providerSettings object — ComfyUI's URL and the utility model live
    // there too, and neither should trigger a chat-model refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    providerSettings.ollama.baseUrl,
    providerSettings.lmstudio.baseUrl,
    providerSettings.openrouter.apiKey,
    providerConnectivity,
  ]);

  // Backend models never belong in the chat selector: the image scene
  // director is configured in Settings, and embedding models can't chat at
  // all. They still RUN — just not as a conversational choice here.
  const utilityModel = providerSettings.ollama.utilityModel ?? DEFAULT_UTILITY_MODEL;
  const isBackendModel = (m: ModelInfo) => m.id === utilityModel || /embed/i.test(m.id);
  const chatModels = models.filter((m) => !isBackendModel(m));

  // A chat with no model yet DISPLAYS the first available model, but
  // generation used a hardcoded default that may not be installed — commit
  // the displayed choice so what you see is what generates. (Hook must sit
  // before the early return below.)
  // Only commit once the REAL provider lists have loaded — committing while
  // the static fallback list is showing wrote a model that isn't installed.
  const realModelsLoaded = models !== FALLBACK_MODELS;
  const firstAvailable = customModels[0] ?? (realModelsLoaded ? chatModels[0] : undefined);
  useEffect(() => {
    if (chat && !chat.modelId && firstAvailable) {
      setChatModel(chat.id, firstAvailable.id, firstAvailable.providerId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat?.id, chat?.modelId, firstAvailable?.id]);

  if (!chat) return null;

  const contextPct = chat.contextMax
    ? Math.round(((chat.contextUsed ?? 0) / chat.contextMax) * 100)
    : 0;

  // Custom models the user typed in, plus whatever the providers reported. If
  // the chat's saved model isn't in either list (e.g. set before a provider
  // went offline), surface it so the selector still shows the truth.
  const knownModels: ModelInfo[] = [...customModels, ...chatModels];
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
      {/* Character info / group members with presence toggles */}
      <div className="flex items-center gap-2.5 flex-1 min-w-0">
        {(chat.memberIds?.length ?? 0) >= 2 ? (
          <div className="flex items-center gap-1.5 min-w-0">
            {chat.memberIds!.map((id) => {
              const m = characters.find((c) => c.id === id);
              if (!m) return null;
              const absent = chat.absentIds?.includes(id) ?? false;
              return (
                <button
                  key={id}
                  onClick={() => toggleMemberPresence(chat.id, id)}
                  title={absent ? `${m.name} is away — click to bring into the scene` : `${m.name} is present — click to send away`}
                  className={`rounded-full transition-opacity cursor-pointer ${absent ? "opacity-30 grayscale" : ""}`}
                >
                  <Avatar name={m.name} src={m.avatar} size="sm" />
                </button>
              );
            })}
            <div className="min-w-0 ml-1">
              <div className="font-semibold text-sm text-[var(--foreground)] truncate">{chat.name}</div>
              <div className="text-[11px] text-[var(--muted-fg)] truncate">
                group · click an avatar to toggle who is in the scene
              </div>
            </div>
          </div>
        ) : (
          <>
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
          </>
        )}
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
        <Button variant="ghost" size="icon" title="Generation settings" onClick={() => setSettingsOpen(true)}>
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

      {/* Generation settings dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-sm" aria-describedby={undefined}>
          <div className="border-b border-[var(--border)] px-5 py-4">
            <DialogTitle>Generation settings — {chat.name}</DialogTitle>
          </div>
          <div className="space-y-5 px-5 py-4">
            <Slider
              label={`Temperature — ${(chat.settings?.temperature ?? 0.8) < 0.5 ? "focused" : (chat.settings?.temperature ?? 0.8) > 1.1 ? "wild" : "balanced"}`}
              value={chat.settings?.temperature ?? 0.8}
              onChange={(v) => updateChatSettings(chat.id, { temperature: v })}
              min={0} max={2} step={0.05}
            />
            <Slider
              label="Top P"
              value={chat.settings?.topP ?? 0.95}
              onChange={(v) => updateChatSettings(chat.id, { topP: v })}
              min={0.1} max={1} step={0.05}
            />
            <Slider
              label="Max response tokens"
              value={chat.settings?.maxTokens ?? 2048}
              onChange={(v) => updateChatSettings(chat.id, { maxTokens: v })}
              min={256} max={8192} step={256}
            />
            <p className="text-[11px] leading-snug text-[var(--muted-fg)]">
              Applies to this chat only. Higher temperature means more surprising prose;
              lower keeps the character precise and consistent.
            </p>
          </div>
          <div className="flex items-center justify-between border-t border-[var(--border)] px-5 py-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => updateChatSettings(chat.id, { temperature: 0.8, topP: 0.95, maxTokens: 2048 })}
            >
              Reset defaults
            </Button>
            <Button variant="purple" size="sm" onClick={() => setSettingsOpen(false)}>
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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

            {/* Without this a mistyped id stayed in the dropdown forever */}
            {customModels.length > 0 && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--foreground)]">Your custom models</label>
                <div className="space-y-1">
                  {customModels.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-2 py-1"
                    >
                      <span className="flex-1 min-w-0 truncate font-mono text-[11px] text-[var(--foreground)]">
                        {m.id}
                      </span>
                      <span className="text-[10px] text-[var(--muted-fg)] flex-shrink-0">
                        {PROVIDER_LABELS[m.providerId ?? ""] ?? m.providerId}
                      </span>
                      <button
                        onClick={() => removeCustomModel(m.id)}
                        title="Remove from the model list"
                        className="flex-shrink-0 rounded p-0.5 text-[var(--muted-fg)] hover:text-red-500 transition-colors cursor-pointer"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
