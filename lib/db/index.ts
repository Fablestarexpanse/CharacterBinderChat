// ─── Singleton FableStore ─────────────────────────────────────────────────────
// One DB connection per server process. API routes import getStore() rather
// than constructing FableStore directly.

import path from "path";
import { FableStore } from "./store";

// Cached on globalThis, not in a module variable: Next's dev server replaces
// module instances on hot reload, and a fresh module variable means a second
// better-sqlite3 connection to the same file — two writers, one of them with a
// stale schema view.
const globalForStore = globalThis as { _fableStore?: FableStore };

export function getStore(): FableStore {
  if (!globalForStore._fableStore) {
    const dbPath =
      process.env.FABLE_DB_PATH ??
      path.join(process.cwd(), "data", "fablestore.db");
    globalForStore._fableStore = new FableStore(dbPath);
  }
  return globalForStore._fableStore;
}

export * from "./models";
