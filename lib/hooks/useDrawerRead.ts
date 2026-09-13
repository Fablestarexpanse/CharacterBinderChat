"use client";

// ─── Keyed drawer reads ───────────────────────────────────────────────────────
// Six inspector views were each hand-rolling the same effect, and the shape
// matters: the fetch key is written twice in every copy (once for the render,
// once inside the effect), and if those two drift the view spins forever.
//
// The rules it encodes, all of which came from bugs:
//   - result is keyed by what was fetched, so a stale response can't render
//     under a new selection and `loading` is derived rather than set — the
//     effect never calls setState synchronously (react-hooks/set-state-in-effect)
//   - a cancelled guard as well, so rapid switching can't let the slower of two
//     responses resolve last
//   - a failed read is an error to show, never an empty state

import { useEffect, useState } from "react";
import { getJson } from "@/lib/api/client";

export interface DrawerRead<T> {
  data:    T | null;
  error:   string | null;
  loading: boolean;
}

/**
 * Fetch `url` whenever `key` changes. `key` is both the cache key and the
 * dependency — one string, so the two cannot disagree.
 *
 * A null `url` means "nothing to fetch yet" (no chat selected, say): the hook
 * stays in its loading state without issuing a request.
 */
export function useDrawerRead<T>(key: string, url: string | null): DrawerRead<T> {
  const [result, setResult] = useState<{ key: string; data: T | null; error: string | null } | null>(null);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    getJson<T>(url)
      .then((data) => { if (!cancelled) setResult({ key, data, error: null }); })
      .catch((e: Error) => { if (!cancelled) setResult({ key, data: null, error: e.message }); });
    return () => { cancelled = true; };
  }, [key, url]);

  const fresh = result?.key === key ? result : null;
  return {
    data:    fresh?.data ?? null,
    error:   fresh?.error ?? null,
    loading: !!url && result?.key !== key,
  };
}
