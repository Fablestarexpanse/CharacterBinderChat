import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createCastSlice,      type CastSlice }      from "./slices/cast";
import { createLibrarySlice,   type LibrarySlice }   from "./slices/library";
import { createChatsSlice,     type ChatsSlice }     from "./slices/chats";
import { createLoreSlice,      type LoreSlice }      from "./slices/lore";
import { createMediaSlice,     type MediaSlice }     from "./slices/media";
import { createProvidersSlice, type ProvidersSlice } from "./slices/providers";
import { createMemorySlice,    type MemorySlice }    from "./slices/memory";

// Re-exported so callers keep importing it from "@/lib/store"
export { DEFAULT_UTILITY_MODEL } from "./defaults";

// ─── Sidebar Navigation ───────────────────────────────────────────────────────

export type SidebarSection =
  | "characters"
  | "chats"
  | "groups"
  | "lorebooks"
  | "scenarios"
  | "presets"
  | "image-studio"
  | "gallery"
  | "workflows"
  | "settings";

// ─── Inspector Panel ──────────────────────────────────────────────────────────

// "summary" was removed (duplicated Memory + Core Mem); persisted selections
// of it fall back to "character" in InspectorPanel.
export type InspectorTab = "character" | "memory" | "graph" | "lore" | "image-studio" | "core-memory";

// ─── Store Shape ──────────────────────────────────────────────────────────────
// One store, composed from slices under ./slices. The file held every concern
// at once — 1015 lines, sixteen of them — so the split is by section, not by
// new abstraction: `useFableStore` and the import path are unchanged, and any
// slice's actions still see the whole store through `get()`.

export type FableStore =
  & CastSlice
  & LibrarySlice
  & ChatsSlice
  & LoreSlice
  & MediaSlice
  & ProvidersSlice
  & MemorySlice;

// ─── Store Implementation ─────────────────────────────────────────────────────

export const useFableStore = create<FableStore>()(
  persist(
    (...a) => ({
      ...createCastSlice(...a),
      ...createLibrarySlice(...a),
      ...createChatsSlice(...a),
      ...createLoreSlice(...a),
      ...createMediaSlice(...a),
      ...createProvidersSlice(...a),
      ...createMemorySlice(...a),
    }),
    {
      name: "fablechat-store",
      // Only persist settings, not transient UI state
      partialize: (state) => ({
        providerSettings: state.providerSettings,
        characters: state.characters,
        chats: state.chats,
        personas: state.personas,
        activePersonaId: state.activePersonaId,
        customModels: state.customModels,
        lorebooks: state.lorebooks,
        scenarios: state.scenarios,
        presets: state.presets,
        defaultPresetId: state.defaultPresetId,
        globalInstructions: state.globalInstructions,
        imageJobs: state.imageJobs,
      }),
      // The polling loop that drives queued/generating jobs dies with the
      // page, so anything still in-flight after a reload can never finish —
      // mark it failed instead of spinning forever.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.imageJobs = state.imageJobs.map((j) =>
          j.status === "queued" || j.status === "generating" || j.status === "pending"
            ? { ...j, status: "failed" as const, error: "Interrupted by page reload" }
            : j
        );
      },
    }
  )
);
