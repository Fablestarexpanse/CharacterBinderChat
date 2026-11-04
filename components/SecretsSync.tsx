"use client";

// ─── Secrets sync ─────────────────────────────────────────────────────────────
// Keeps the OpenRouter key encrypted on the server instead of in localStorage.
//
// On mount: ask the server. If it holds a key, use it. If it holds none but the
// browser does (a pre-existing install), upload that one — the migration. Only
// after the server has confirmed it holds the key is it dropped from
// localStorage; until then localStorage stays the only copy and is left alone.
// After that, edits are mirrored up with a short debounce.

import { useEffect, useRef } from "react";
import { useFableStore, markSecretsOnServer } from "@/lib/store";
import { getJson, sendJson } from "@/lib/api/client";

const DEBOUNCE_MS = 600;

export function SecretsSync() {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribe = () => {};
    let disposed = false;
    let lastSent = "";

    const confirmed = (key: string) => {
      lastSent = key;
      markSecretsOnServer(true);
      // Rewrite localStorage now so the plaintext key leaves it immediately
      useFableStore.setState({});
    };

    (async () => {
      const local = useFableStore.getState().providerSettings.openrouter.apiKey;
      try {
        const { openrouterApiKey } = await getJson<{ openrouterApiKey: string | null }>("/api/secrets");
        if (openrouterApiKey) {
          useFableStore.getState().setProviderSetting("openrouter", { apiKey: openrouterApiKey });
          confirmed(openrouterApiKey);
        } else if (local) {
          await sendJson("PUT", "/api/secrets", { openrouterApiKey: local });
          confirmed(local);
        } else {
          confirmed("");   // nothing to protect yet; later edits still sync
        }
      } catch (e) {
        // Server unreachable: keep working from whatever the browser holds, and
        // leave markSecretsOnServer false so localStorage keeps the key.
        console.warn("[secrets] could not sync:", e instanceof Error ? e.message : e);
        return;
      }
      if (disposed) return;

      unsubscribe = useFableStore.subscribe((state, prev) => {
        const key = state.providerSettings.openrouter.apiKey;
        if (key === prev.providerSettings.openrouter.apiKey || key === lastSent) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          sendJson("PUT", "/api/secrets", { openrouterApiKey: key })
            .then(() => { lastSent = key; })
            .catch((e: Error) => console.warn("[secrets] save failed:", e.message));
        }, DEBOUNCE_MS);
      });
    })();

    return () => { disposed = true; unsubscribe(); if (timer) clearTimeout(timer); };
  }, []);

  return null;
}
