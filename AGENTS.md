<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# FableChat project rules

## Project shape

Single-user, local-first app. Next.js 16 + React 19 + Tailwind 4 + Zustand, with `better-sqlite3` running synchronously inside the Next server process. `lib/db/store.ts` (`FableStore`) is the only thing that touches SQL.

Two memory layers, both per-character:

- **Drawer 1** — `core_memory` table, one JSON document per character, always injected into the prompt.
- **Drawer 2** — bi-temporal graph (`entities` / `facts` / `relationship_stats` / `commitments`), retrieved into the prompt.

`fable_drawer2/` (sibling directory, tracked in the parent repo) is the Python reference implementation with 77 passing tests. Treat its semantics as the spec when changing bi-temporal behaviour, and keep `lib/db/schema.ts` in step with `schema.py`.

## Conventions that matter here

**Schema changes.** `CREATE_TABLES_SQL` is split on `;` and executed statement by statement. Never put a semicolon inside a SQL comment — it truncates the statement and the table silently fails to create. `_initSchema` only swallows "already exists" errors; everything else throws, deliberately.

**No migrations exist.** Every table is `CREATE TABLE IF NOT EXISTS`, so adding a column to an existing table will not apply to a live database. Write a migration step if you need one.

**Predicates are canonicalized on write.** `normPredicate()` in `lib/db/predicates.ts` snake_cases and maps aliases (`is_located_at` → `located_at`). Both the extract route and the manual facts route must store the canonical form, or fact supersession silently stops working.

**Stat scales differ between drawers.** Drawer 2 stats are **−100..100** (0 = neutral). Core Memory's `relationship_with_user` is **0..100** (50 = neutral). `syncStatsToCore` converts between them. Any new stat bar must know which scale it is on — `((v + 100) / 200) * 100` for Drawer 2, `clamp(v, 0, 100)` for Drawer 1.

**Stat direction is `character -> player`.** `relationship_stats` rows are directed: observer is the character, target is `player`. That matches what `relationship_with_user` means and what the prompt injects. Querying `player -> character` reads an empty set — that bug shipped once already.

**Entity ids from the model are untrusted.** Extraction will mint `ronan` next to an existing `char-ronan` however the prompt is worded. `EntityResolver` in the extract route folds incoming ids onto existing entities by normalized name before anything is written; never bypass it when adding a new write path. The response's `remapped` field shows what got folded — a growing list means prompt anchoring is losing.

**Client-side generation.** Providers are called from the browser, not from route handlers. `lib/chat/generation.ts` owns the whole turn (prompt build → token budget → stream → extraction). `isGenerating` lives in the Zustand store so every component sees it; the `AbortController` is module-local because it isn't serialisable.

**Persistence is two-layer.** `localStorage` (zustand persist) is a same-browser cache; SQLite is the durable copy. `StateSync` hydrates from `/api/state` on load, then mirrors changes back with a debounce. `PUT /api/state` is a full replace, guarded against wiping existing data with an empty payload.

**Hydration.** Everything is `"use client"`, but Next still server-renders the first pass. Never render a value derived from the current clock (`formatRelative`, `Date.now()`) without gating it behind `useHydrated()`. Placeholder data uses fixed `seedTime()` offsets rather than `Date.now()` for the same reason.

**Effects must not call setState synchronously.** React Compiler lint rules are on and `react-hooks/set-state-in-effect` is an error. The pattern used throughout the inspector: hold one result object keyed by what was fetched, derive `loading` from `result.key !== fetchKey`, and only setState inside async continuations behind a `cancelled` guard.

**LLM output is untrusted.** `parseLLMJson` returns a fallback on unparseable input, so callers must distinguish "parse failed" from "nothing found" and report it rather than returning `ok: true` with empty arrays. Route bodies are validated explicitly; `PATCH /api/chat/core-memory` whitelists keys because the patch is spread into the stored document.

## Before you finish

`npm run lint` and `npx tsc --noEmit` are both expected to be clean. Verify UI changes in the running app rather than assuming.
