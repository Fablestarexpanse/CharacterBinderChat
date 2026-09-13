"use client";

// ─── Model catalog ────────────────────────────────────────────────────────────
// Every reachable chat provider's model list, refetched when the provider
// settings that can change it change. Owns `setAvailableModels` in the store —
// the Presets view reads supportedParameters from there rather than running a
// second discovery pass — so the ownership lives under the name that describes
// it instead of inside the chat header.

import { useEffect, useState } from "react";
import { useFableStore } from "@/lib/store";
import { allChatProviders } from "@/lib/providers/factory";
import type { ModelInfo } from "@/lib/types";

/** Shown before the first load lands, and whenever every provider is offline. */
export const FALLBACK_MODELS: ModelInfo[] = [
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

export function useModelCatalog() {
  const { providerSettings, providerStatuses } = useFableStore();

  const [models,  setModels]  = useState<ModelInfo[]>(FALLBACK_MODELS);
  const [loading, setLoading] = useState(false);

  // Flattened so the deps array holds a plain string (statically checkable)
  const providerConnectivity = providerStatuses.map((p) => `${p.id}:${p.connected}`).join(",");

  useEffect(() => {
    let cancelled = false;
    const fetchAll = async () => {
      setLoading(true);

      // Every reachable provider is queried in parallel
      const lists = await Promise.all(
        allChatProviders(providerSettings).map((p) =>
          p.listModels().catch(() => [] as ModelInfo[])
        )
      );

      if (!cancelled) {
        const collected = lists.flat();
        setModels(collected.length > 0 ? collected : FALLBACK_MODELS);
        useFableStore.getState().setAvailableModels(collected);
        setLoading(false);
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

  return {
    models,
    loading,
    /** False while the static fallback list is still showing. */
    loaded: models !== FALLBACK_MODELS,
  };
}
