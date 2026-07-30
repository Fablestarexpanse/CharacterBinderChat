"use client";

import { useSyncExternalStore } from "react";

// Never changes, so React never re-subscribes or re-renders from this store.
const emptySubscribe = () => () => {};

/**
 * False during SSR and the first client render, true afterwards.
 *
 * Use it to gate anything whose output depends on the current time (relative
 * timestamps like "2m ago") or on browser-only state. Those values are
 * inherently different on the server than at hydration, and React treats the
 * mismatch as an error that throws away the tree.
 *
 * Implemented with useSyncExternalStore rather than useState+useEffect: the
 * server/client snapshot split is exactly what this hook wants, and it avoids
 * a setState-in-effect cascading render.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,   // client
    () => false   // server
  );
}
