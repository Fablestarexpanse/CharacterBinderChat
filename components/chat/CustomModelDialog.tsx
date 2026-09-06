"use client";

// ─── Custom model ID ──────────────────────────────────────────────────────────
// Type a model id the providers didn't report — a fresh OpenRouter slug, a
// locally pulled Ollama tag — and use it for this chat. Also the only place a
// mistyped custom id can be removed from the selector again.

import { useState } from "react";
import { useFableStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { ProviderId } from "@/lib/types";
import { X } from "lucide-react";

const PROVIDER_LABELS: Record<string, string> = {
  ollama:      "Ollama",
  lmstudio:    "LM Studio",
  openrouter:  "OpenRouter",
};

export function CustomModelDialog({
  chatId,
  open,
  onOpenChange,
}: {
  chatId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { customModels, addCustomModel, removeCustomModel, setChatModel, providerSettings } =
    useFableStore();

  const [modelId,  setModelId]  = useState("");
  const [provider, setProvider] = useState<ProviderId>("openrouter");

  const save = () => {
    const id = modelId.trim();
    if (!id) return;
    addCustomModel({ id, name: id, providerId: provider });
    setChatModel(chatId, id, provider);
    setModelId("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        <div className="border-b border-[var(--border)] px-5 py-4">
          <DialogTitle>Use a custom model</DialogTitle>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-[var(--foreground)]">Model ID</label>
            <Input
              autoFocus
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") save(); }}
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
              value={provider}
              onChange={(e) => setProvider(e.target.value as ProviderId)}
              className="h-9 w-full rounded-lg border border-[var(--border)] bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--purple)]"
            >
              <option value="openrouter">OpenRouter</option>
              <option value="ollama">Ollama</option>
              <option value="lmstudio">LM Studio</option>
            </select>
            {provider === "openrouter" && !providerSettings.openrouter.apiKey && (
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
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="purple" size="sm" onClick={save} disabled={!modelId.trim()}>
            Use model
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
