// ─── Mount lifecycle that survives React's development double-invoke ──────────
// In development React runs an effect, immediately runs its cleanup, then runs it
// again, all in one task. A service started in the effect and stopped in the
// cleanup is therefore stopped before it has done anything, and the second run
// must not start a second copy. This keeps ONE service running through that dance
// and still stops it for a real unmount.
//
// Extracted from the component so the rule can be tested without React: the bug
// it prevents (the sync loop silently never starting in development) passed every
// unit test and was only visible in a browser.

export interface Lifecycle {
  /** Call from the effect body. Starts the service if it is not already running. */
  mount: () => void;
  /** Call from the effect cleanup. Stops the service unless a mount follows straight away. */
  unmount: () => void;
}

export function createLifecycle(start: () => () => void): Lifecycle {
  let stop: (() => void) | null = null;
  let mounted = false;
  return {
    mount() {
      mounted = true;
      if (!stop) stop = start();
    },
    unmount() {
      mounted = false;
      // The double-invoke re-mounts in the same task, before this microtask runs
      queueMicrotask(() => {
        if (mounted) return;
        stop?.();
        stop = null;
      });
    },
  };
}
