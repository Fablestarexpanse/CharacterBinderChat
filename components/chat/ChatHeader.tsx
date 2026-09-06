"use client";

import { useEffect, useState } from "react";
import { useFableStore, DEFAULT_UTILITY_MODEL } from "@/lib/store";
import { useUiStore } from "@/lib/store/ui";
import { useModelCatalog } from "@/lib/hooks/useModelCatalog";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { GenerationSettingsDialog } from "./GenerationSettingsDialog";
import { CustomModelDialog } from "./CustomModelDialog";
import { regenerateLastReply } from "@/lib/chat/generation";
import type { ModelInfo, ProviderId } from "@/lib/types";
import {
  PanelRightOpen,
  PanelRightClose,
  Settings2,
  RefreshCw,
  Trash2,
  Loader2,
  ChevronLeft,
} from "lucide-react";

const PROVIDER_LABELS: Record<string, string> = {
  ollama:      "Ollama",
  lmstudio:    "LM Studio",
  openrouter:  "OpenRouter",
};

// ─── Component ────────────────────────────────────────────────────────────────
// The bar itself: who is in the scene, which model answers, and the actions.
// Model discovery lives in useModelCatalog and the two dialogs are their own
// components — this file used to hold all three.

export function ChatHeader() {
  const {
    activeChatId, chats, characters, setChatModel, clearChat, isGenerating,
    customModels, toggleMemberPresence, setActiveChatId,
  } = useFableStore();
  const { inspectorOpen, setInspectorOpen } = useUiStore();

  const chat      = chats.find((c) => c.id === activeChatId);
  const character = characters.find((c) => c.id === chat?.characterId);

  const { models, loading: loadingModels, loaded: realModelsLoaded } = useModelCatalog();

  const [confirmClear, setConfirmClear] = useState(false);
  const [customOpen,   setCustomOpen]   = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Backend models never belong in the chat selector: the image scene
  // director is configured in Settings, and embedding models can't chat at
  // all. They still RUN — just not as a conversational choice here.
  const providerSettings = useFableStore((s) => s.providerSettings);
  const utilityModel = providerSettings.ollama.utilityModel ?? DEFAULT_UTILITY_MODEL;
  const isBackendModel = (m: ModelInfo) => m.id === utilityModel || /embed/i.test(m.id);
  const chatModels = models.filter((m) => !isBackendModel(m));

  // A chat with no model yet DISPLAYS the first available model, but
  // generation used a hardcoded default that may not be installed — commit
  // the displayed choice so what you see is what generates. (Hook must sit
  // before the early return below.)
  // Only commit once the REAL provider lists have loaded — committing while
  // the static fallback list is showing wrote a model that isn't installed.
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
      setCustomOpen(true);
      return;
    }
    const model = allModels.find((m) => m.id === modelId);
    // Only fall back to ollama for genuinely unknown ids; a known model always
    // carries its own provider, so cloud models can't get routed locally.
    const provider = model?.providerId ?? "ollama";
    setChatModel(chat.id, modelId, provider);
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
      {/* Back to the chat list — clearing the active chat is what shows it */}
      <button
        onClick={() => setActiveChatId(null)}
        title="All chats"
        className="flex-shrink-0 rounded-lg p-1 text-[var(--muted-fg)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] transition-colors cursor-pointer"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

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

      <GenerationSettingsDialog
        chatId={chat.id}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />

      {/* Mounted only while open so the typed id starts empty each time */}
      {customOpen && (
        <CustomModelDialog chatId={chat.id} open onOpenChange={setCustomOpen} />
      )}
    </div>
  );
}
