// ─── Singleton FableStore ─────────────────────────────────────────────────────
// One DB connection per server process. API routes import getStore() rather
// than constructing FableStore directly.

import path from "path";
import { FableStore } from "./store";

let _store: FableStore | null = null;

export function getStore(): FableStore {
  if (!_store) {
    const dbPath =
      process.env.FABLE_DB_PATH ??
      path.join(process.cwd(), "data", "fablestore.db");
    _store = new FableStore(dbPath);
  }
  return _store;
}

export { FableStore };
export * from "./models";
