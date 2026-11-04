"use client";

// Memory behaviour preferences for this browser. Separate from useFableStore for
// the same reason as the theme: a preference, not story data, so not synced.

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ExtractionGateMode } from "@/lib/chat/extractionGate";

interface MemorySettings {
  /** Skip memory calls for empty exchanges. Off by default: it is unproven on short-form chat. */
  extractionGate: ExtractionGateMode;
  setExtractionGate: (m: ExtractionGateMode) => void;
}

export const useMemorySettings = create<MemorySettings>()(
  persist(
    (set) => ({
      extractionGate: "off",
      setExtractionGate: (extractionGate) => set({ extractionGate }),
    }),
    { name: "fablechat-memory-settings", partialize: (s) => ({ extractionGate: s.extractionGate }) }
  )
);
