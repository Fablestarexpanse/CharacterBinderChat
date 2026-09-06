// ─── Drawer 2 sync signals ──────────────────────────────────────────────────────
// Drawer 2 sync signals — what the inspector watches to know when to refetch.

import type { StateCreator } from "zustand";
import type { FableStore } from "../index";


export interface MemorySlice {
  /**
   * True once the initial GET /api/state has resolved, either way. The app
   * renders nothing until then: before it lands the store still holds the
   * localStorage cache, and an edit made in that window was overwritten by
   * hydration and never reached SQLite.
   */
  syncReady: boolean;
  setSyncReady: (v: boolean) => void;

  // Drawer 2 — knowledge graph sync signal
  // Bump this after extraction completes so inspector tabs re-fetch from the DB.
  extractionVersion: number;
  bumpExtraction: () => void;
  isExtracting: boolean;
  setIsExtracting: (v: boolean) => void;
  /** Error from the most recent extraction / core-memory refresh, or null */
  lastExtractionError: string | null;
  setLastExtractionError: (e: string | null) => void;
  /** Error from the most recent durable-state read or write, or null. Without
   *  this a failed save was a console warning nobody sees, and the app went on
   *  looking like it had persisted the change. */
  lastSyncError: string | null;
  setLastSyncError: (e: string | null) => void;
}

export const createMemorySlice: StateCreator<FableStore, [], [], MemorySlice> = (set) => ({
  syncReady: false,
  setSyncReady: (v) => set({ syncReady: v }),

  extractionVersion: 0,
  bumpExtraction:    () => set((s) => ({ extractionVersion: s.extractionVersion + 1 })),
  isExtracting:      false,
  setIsExtracting:   (v) => set({ isExtracting: v }),
  lastExtractionError:    null,
  setLastExtractionError: (e) => set({ lastExtractionError: e }),
  lastSyncError:          null,
  setLastSyncError:       (e) => set({ lastSyncError: e }),
});
