"use client";

// ─── State Sync ───────────────────────────────────────────────────────────────
// Mounts the sync engine (lib/sync/engine.ts, where the logic and its
// documentation live). Renders nothing. The start/stop rule that survives React's
// development double-invoke is lib/sync/lifecycle.ts.

import { useEffect, useRef } from "react";
import { startSync } from "@/lib/sync/engine";
import { createLifecycle } from "@/lib/sync/lifecycle";

export function StateSync() {
  const life = useRef<ReturnType<typeof createLifecycle> | null>(null);
  useEffect(() => {
    life.current ??= createLifecycle(startSync);
    const l = life.current;
    l.mount();
    return () => l.unmount();
  }, []);
  return null;
}
