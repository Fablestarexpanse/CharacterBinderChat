"use client";

// ─── Provider settings sync ───────────────────────────────────────────────────
// The server keeps the chat-model settings (lib/settings/providerPrefs.ts); the
// browser's copy is a cache. On mount: if the server has them, they replace the
// browser's (so a cleared or new browser gets them back); if it has none, this
// browser's are uploaded (the migration for an existing install). After that,
// changes are mirrored up with a short debounce.

import { useEffect, useRef } from "react";
import { useFableStore } from "@/lib/store";
import { getJson, sendJson } from "@/lib/api/client";
import { applyProviderPrefs, pickProviderPrefs, type ProviderPrefs } from "@/lib/settings/providerPrefs";

const DEBOUNCE_MS = 800;

export function ProviderSettingsSync() {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribe = () => {};
    let disposed = false;
    let lastSent = "";

    const send = (prefs: ProviderPrefs) => {
      const body = JSON.stringify(prefs);
      if (body === lastSent) return;
      lastSent = body;
      void sendJson("PUT", "/api/provider-settings", prefs)
        .catch((e: Error) => { lastSent = ""; console.warn("[provider-settings] could not save:", e.message); });
    };

    (async () => {
      try {
        const { prefs } = await getJson<{ prefs: ProviderPrefs | null }>("/api/provider-settings");
        if (disposed) return;
        const st = useFableStore.getState();
        if (prefs) {
          useFableStore.setState({ providerSettings: applyProviderPrefs(st.providerSettings, prefs) });
          lastSent = JSON.stringify(prefs);
        } else {
          send(pickProviderPrefs(st.providerSettings));
        }
      } catch (e) {
        // Server unreachable: keep working from the browser's copy
        console.warn("[provider-settings] could not load:", e instanceof Error ? e.message : e);
        return;
      }
      if (disposed) return;
      unsubscribe = useFableStore.subscribe((s, prev) => {
        if (s.providerSettings === prev.providerSettings) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => send(pickProviderPrefs(useFableStore.getState().providerSettings)), DEBOUNCE_MS);
      });
    })();

    return () => { disposed = true; unsubscribe(); if (timer) clearTimeout(timer); };
  }, []);

  return null;
}
