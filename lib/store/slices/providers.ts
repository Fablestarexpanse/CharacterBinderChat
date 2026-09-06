// ─── Provider settings, live status, and the model catalogue. ───────────────────
// Provider settings, live status, and the model catalogue.

import type { StateCreator } from "zustand";
import { DEFAULT_UTILITY_MODEL } from "../defaults";
import type { FableStore } from "../index";
import type {
  ModelInfo, ProviderSettings, ProviderStatus, ProviderId,
} from "@/lib/types";

export interface ProvidersSlice {
  /** Models discovered from the providers, published by the chat header so
   *  other views (Presets) can read capabilities without a second fetch. */
  availableModels: ModelInfo[];
  setAvailableModels: (models: ModelInfo[]) => void;

  // Custom model IDs the user typed in (e.g. an OpenRouter slug that isn't in
  // the fetched catalogue). Merged into the model selector.
  customModels: ModelInfo[];
  addCustomModel: (model: ModelInfo) => void;
  removeCustomModel: (id: string) => void;

  // Provider Settings
  providerSettings: ProviderSettings;
  setProviderSetting: <K extends keyof ProviderSettings>(
    provider: K,
    value: Partial<ProviderSettings[K]>
  ) => void;

  // Provider Status
  providerStatuses: ProviderStatus[];
  setProviderStatus: (id: ProviderId, status: Partial<ProviderStatus>) => void;
}

export const createProvidersSlice: StateCreator<FableStore, [], [], ProvidersSlice> = (set) => ({
  availableModels: [],
  setAvailableModels: (models) => set({ availableModels: models }),

  customModels: [],
  addCustomModel: (model) =>
    set((s) => ({
      customModels: s.customModels.some((m) => m.id === model.id)
        ? s.customModels
        : [...s.customModels, model],
    })),
  removeCustomModel: (id) =>
    set((s) => ({ customModels: s.customModels.filter((m) => m.id !== id) })),

  providerSettings: {
    ollama: { baseUrl: "http://127.0.0.1:11434", enabled: true, utilityModel: DEFAULT_UTILITY_MODEL },
    lmstudio: { baseUrl: "http://127.0.0.1:1234", enabled: true },
    openrouter: { apiKey: "", enabled: false },
    comfyui: { baseUrl: "http://127.0.0.1:8188", enabled: true },
  },
  setProviderSetting: (provider, value) =>
    set((state) => ({
      providerSettings: {
        ...state.providerSettings,
        [provider]: { ...state.providerSettings[provider], ...value },
      },
    })),

  providerStatuses: [
    { id: "ollama", name: "Ollama", connected: false, checking: false },
    { id: "lmstudio", name: "LM Studio", connected: false, checking: false },
    { id: "openrouter", name: "OpenRouter", connected: false, checking: false },
    { id: "comfyui", name: "ComfyUI", connected: false, checking: false },
  ],
  setProviderStatus: (id, status) =>
    set((state) => ({
      providerStatuses: state.providerStatuses.map((p) =>
        p.id === id ? { ...p, ...status } : p
      ),
    })),
});
