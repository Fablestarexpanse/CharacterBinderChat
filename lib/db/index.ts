// ─── Singleton FableStore ─────────────────────────────────────────────────────
// One DB connection per server process. API routes import getStore() rather
// than constructing FableStore directly.

import path from "path";
import { FableStore } from "./store";

// Cached on globalThis, not in a module variable: Next's dev server replaces
// module instances on hot reload, and a fresh module variable means a second
// better-sqlite3 connection to the same file — two writers, one of them with a
// stale schema view.
//
// The cache remembers which FableStore class built it. When a hot reload
// replaces the class, the cached instance is from the old module and is
// missing anything the edit added — so it is closed and rebuilt. Without this
// check, editing store.ts in dev leaves every route calling the previous
// version until the server restarts.
const globalForStore = globalThis as {
  _fableStoreCache?: { store: FableStore; builtBy: unknown };
};

export function getStore(): FableStore {
  const cached = globalForStore._fableStoreCache;
  if (cached && cached.builtBy === FableStore) return cached.store;

  cached?.store?.close();
  const dbPath =
    process.env.FABLE_DB_PATH ??
    path.join(process.cwd(), "data", "fablestore.db");
  const store = new FableStore(dbPath);
  globalForStore._fableStoreCache = { store, builtBy: FableStore };
  return store;
}

export * from "./models";
