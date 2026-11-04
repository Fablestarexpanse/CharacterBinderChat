"use client";

// ─── Theme preferences ────────────────────────────────────────────────────────
// How the app looks to this person on this browser. Deliberately separate from
// useFableStore: it is a display preference, not story data, so it is neither
// synced to SQLite nor part of the JSON export, and it must be readable before
// /api/state answers.

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_THEME, THEME_STORAGE_KEY, normalizeHex, type ThemePrefs } from "@/lib/theme";

interface ThemeStore extends ThemePrefs {
  setMode: (mode: ThemePrefs["mode"]) => void;
  setAccent: (accentId: string) => void;
  /** Ignores anything that is not a valid hex colour rather than storing it. */
  setCustomAccent: (hex: string) => void;
  reset: () => void;
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      ...DEFAULT_THEME,
      setMode: (mode) => set({ mode }),
      setAccent: (accentId) => set({ accentId }),
      setCustomAccent: (hex) => {
        const n = normalizeHex(hex);
        if (n) set({ customAccent: n, accentId: "custom" });
      },
      reset: () => set({ ...DEFAULT_THEME }),
    }),
    {
      name: THEME_STORAGE_KEY,
      partialize: (s) => ({ mode: s.mode, accentId: s.accentId, customAccent: s.customAccent }),
    }
  )
);
