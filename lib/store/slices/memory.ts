// ─── Drawer 2 sync signals ──────────────────────────────────────────────────────
// Drawer 2 sync signals — what the inspector watches to know when to refetch.

import type { StateCreator } from "zustand";
import type { FableStore } from "../index";


export interface MemorySlice {
  // Drawer 2 — knowledge graph sync signal
  // Bump this after extraction completes so inspector tabs re-fetch from the DB.
  extractionVersion: number;
  bumpExtraction: () => void;
  isExtracting: boolean;
  setIsExtracting: (v: boolean) => void;
  /** Error from the most recent extraction / core-memory refresh, or null */
  lastExtractionError: string | null;
  setLastExtractionError: (e: string | null) => void;
}

export const createMemorySlice: StateCreator<FableStore, [], [], MemorySlice> = (set) => ({
  extractionVersion: 0,
  bumpExtraction:    () => set((s) => ({ extractionVersion: s.extractionVersion + 1 })),
  isExtracting:      false,
  setIsExtracting:   (v) => set({ isExtracting: v }),
  lastExtractionError:    null,
  setLastExtractionError: (e) => set({ lastExtractionError: e }),
});
