"use client";

// ─── Narrow screens ───────────────────────────────────────────────────────────
// True below Tailwind's `md` breakpoint (768 px), where the sidebar becomes a
// drawer and the inspector a sheet. Read through useSyncExternalStore so it
// never needs a setState in an effect; the server snapshot is "wide", and the
// page renders only after hydration anyway.

import { useSyncExternalStore } from "react";

export const NARROW_QUERY = "(max-width: 767px)";

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(NARROW_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function useNarrow(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(NARROW_QUERY).matches, () => false);
}
