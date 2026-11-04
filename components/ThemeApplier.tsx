"use client";

import { useEffect } from "react";
import { useThemeStore } from "@/lib/store/theme";
import { THEME_CACHE_KEY, buildThemeCache, resolveTheme } from "@/lib/theme";

// Pushes the saved theme onto <html>: a `dark` class plus the three accent
// variables. Renders nothing. The inline script in app/layout.tsx does the same
// from a cache before first paint; this keeps it live afterwards (picker
// changes, OS dark-mode flips while mode is "system") and refreshes the cache.

export function ThemeApplier() {
  const mode = useThemeStore((s) => s.mode);
  const accentId = useThemeStore((s) => s.accentId);
  const customAccent = useThemeStore((s) => s.customAccent);

  useEffect(() => {
    const prefs = { mode, accentId, customAccent };
    const mq = window.matchMedia("(prefers-color-scheme: dark)");

    const apply = () => {
      const { dark, vars } = resolveTheme(prefs, mq.matches);
      const el = document.documentElement;
      el.classList.toggle("dark", dark);
      for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
    };

    apply();
    try {
      localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(buildThemeCache(prefs)));
    } catch { /* private mode / quota: the theme still applies, it just flashes on reload */ }

    if (mode !== "system") return;
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [mode, accentId, customAccent]);

  return null;
}
