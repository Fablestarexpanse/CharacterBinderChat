"use client";

// ─── State Sync ───────────────────────────────────────────────────────────────
// Makes SQLite the durable home of characters/chats/messages (they previously
// lived only in localStorage, where clearing site data destroyed everything).
//
// On mount:  GET /api/state — if the server has data it wins (hydrate the
//            store); if it's empty, push the local state up (first run /
//            migration from localStorage).
// After:     subscribe to the store and PUT the full state, debounced, so the
//            durable copy trails edits by at most a few seconds. localStorage
//            persist stays on as a same-browser cache.
//
// Known limitation: last-write-wins. Two browsers editing simultaneously will
// not merge — fine for a single-user local app.

import { useEffect, useRef } from "react";
import { useFableStore } from "@/lib/store";
import type { Character, Chat, Persona, Lorebook, Scenario } from "@/lib/types";

const DEBOUNCE_MS = 800;   // trailing quiet-period before a save
const MAX_WAIT_MS = 5000;  // during constant streaming, save at least this often

export function StateSync() {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // guard against StrictMode double-invoke
    started.current = true;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastSaveAt = 0;
    let unsubscribe = () => {};

    const save = async () => {
      lastSaveAt = Date.now();
      const { characters, chats, personas, lorebooks, scenarios } = useFableStore.getState();
      try {
        const res = await fetch("/api/state", {
          method:  "PUT",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ characters, chats, personas, lorebooks, scenarios }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          console.warn("[state-sync] save rejected:", data?.error ?? res.status);
        }
      } catch (e) {
        console.warn("[state-sync] save failed:", e);
      }
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      const overdue = Date.now() - lastSaveAt > MAX_WAIT_MS;
      timer = setTimeout(save, overdue ? 0 : DEBOUNCE_MS);
    };

    (async () => {
      try {
        const res  = await fetch("/api/state", { cache: "no-store" });
        const data = (await res.json()) as {
          characters?: Character[]; chats?: Chat[]; personas?: Persona[]; lorebooks?: Lorebook[]; scenarios?: Scenario[];
        };
        const serverHasData =
          (data.characters?.length ?? 0) > 0 ||
          (data.chats?.length ?? 0) > 0 ||
          (data.personas?.length ?? 0) > 0;

        if (serverHasData) {
          useFableStore.getState().hydrateFromServer(
            data.characters ?? [], data.chats ?? [], data.personas ?? [], data.lorebooks ?? [], data.scenarios ?? []
          );
        } else {
          // First run: seed the durable copy from local state
          await save();
        }
      } catch (e) {
        console.warn("[state-sync] initial load failed:", e);
      }

      // Subscribe only after hydration so the initial replace doesn't echo back
      unsubscribe = useFableStore.subscribe((state, prev) => {
        if (
          state.characters !== prev.characters ||
          state.chats !== prev.chats ||
          state.personas !== prev.personas ||
          state.lorebooks !== prev.lorebooks ||
          state.scenarios !== prev.scenarios
        ) {
          schedule();
        }
      });
    })();

    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, []);

  return null;
}
