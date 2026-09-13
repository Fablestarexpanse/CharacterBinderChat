// ─── Presets and the standing instructions that layer under them. ───────────────

import type { StateCreator } from "zustand";
import { normalizeForbiddenWords } from "@/lib/utils";
import type { FableStore } from "../index";
import type {
  Preset, PromptInstructions,
} from "@/lib/types";

export interface LibrarySlice {
  // Presets — named bundles of sampler params + standing prompts
  presets: Preset[];
  /** Applied to any chat that hasn't picked one of its own */
  defaultPresetId: string | null;
  /** Standing instructions that apply to every chat regardless of preset */
  globalInstructions: PromptInstructions;
  addPreset: (name?: string) => string;
  updatePreset: (id: string, updates: Partial<Omit<Preset, "id" | "createdAt">>) => void;
  deletePreset: (id: string) => void;
  duplicatePreset: (id: string) => string | null;
  setDefaultPreset: (id: string | null) => void;
  setGlobalInstructions: (patch: Partial<PromptInstructions>) => void;
  /** Point a chat at a preset; undefined falls back to defaultPresetId */
  setChatPreset: (chatId: string, presetId: string | undefined) => void;
  /** Drop this chat's per-chat overrides so the preset shows through again */
  resetChatOverrides: (chatId: string) => void;
}

export const createLibrarySlice: StateCreator<FableStore, [], [], LibrarySlice> = (set, get) => ({
  presets: [],
  defaultPresetId: null,
  globalInstructions: {},

  addPreset: (name) => {
    const id = `preset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();
    set((s) => ({
      presets: [
        ...s.presets,
        { id, name: name ?? `Preset ${s.presets.length + 1}`, params: {}, createdAt: now, updatedAt: now },
      ],
      // The first preset someone makes is almost certainly the one they
      // want everywhere; without this it silently applies to nothing.
      defaultPresetId: s.defaultPresetId ?? id,
    }));
    return id;
  },

  updatePreset: (id, updates) => {
    set((s) => ({
      presets: s.presets.map((p) => {
        if (p.id !== id) return p;
        const next = { ...p, ...updates, id, updatedAt: new Date().toISOString() };
        // Cap and de-dupe here rather than only in the input, so no call
        // path can store an over-long or repetitive ban list.
        if (next.forbiddenWords) next.forbiddenWords = normalizeForbiddenWords(next.forbiddenWords);
        return next;
      }),
    }));
  },

  deletePreset: (id) => {
    set((s) => ({
      presets: s.presets.filter((p) => p.id !== id),
      // Chats pointing at a deleted preset fall back to the default
      defaultPresetId: s.defaultPresetId === id ? null : s.defaultPresetId,
      chats: s.chats.map((c) => {
        if (c.presetId !== id) return c;
        const rest = { ...c };
        delete rest.presetId;
        return rest;
      }),
    }));
  },

  duplicatePreset: (id) => {
    const source = get().presets.find((p) => p.id === id);
    if (!source) return null;
    const newId = `preset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();
    set((s) => ({
      presets: [
        ...s.presets,
        { ...source, id: newId, name: `${source.name} copy`, createdAt: now, updatedAt: now },
      ],
    }));
    return newId;
  },

  setDefaultPreset: (id) => set({ defaultPresetId: id }),

  setGlobalInstructions: (patch) => {
    set((s) => {
      const next = { ...s.globalInstructions, ...patch };
      if (next.forbiddenWords) next.forbiddenWords = normalizeForbiddenWords(next.forbiddenWords);
      return { globalInstructions: next };
    });
  },

  setChatPreset: (chatId, presetId) => {
    set((s) => ({
      chats: s.chats.map((c) => {
        if (c.id !== chatId) return c;
        if (presetId === undefined) {
          const rest = { ...c };
          delete rest.presetId;
          return rest;
        }
        return { ...c, presetId };
      }),
    }));
  },

  resetChatOverrides: (chatId) => {
    set((s) => ({
      chats: s.chats.map((c) => {
        if (c.id !== chatId) return c;
        const rest = { ...c };
        delete rest.settings;
        return rest;
      }),
    }));
  },
});
