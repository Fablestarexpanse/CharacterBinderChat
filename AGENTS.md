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

**Two migration mechanisms, and which to use.** `CREATE TABLE IF NOT EXISTS` never alters an existing table, so a schema change needs both halves. For a **new column**: add it to `CREATE_TABLES_SQL` (the real shape of a fresh table) *and* add an `addCol` line to `FableStore._ensureColumns`, which ALTERs databases created before it existed. For a **shape change** — a table keyed differently, data that must be rewritten — write a version-detecting step like `_migrateIfNeeded`, which is what carried v1's character-global memory onto v2's chat scoping.

**Predicates are canonicalized on write.** `normPredicate()` in `lib/db/predicates.ts` snake_cases and maps aliases (`is_located_at` → `located_at`). Both the extract route and the manual facts route must store the canonical form, or fact supersession silently stops working.

**Stat scales differ between drawers.** Drawer 2 stats are **−100..100** (0 = neutral). Core Memory's `relationship_with_user` is **0..100** (50 = neutral). `syncStatsToCore` converts between them. Any new stat bar must know which scale it is on — `((v + 100) / 200) * 100` for Drawer 2, `clamp(v, 0, 100)` for Drawer 1.

**Memory is scoped to a CHAT, not a character.** Every Drawer 1/2 table carries `chat_id`, and every store method takes it as the first parameter. Starting a new chat with the same character is a fresh start; carrying memories forward is an explicit `/api/drawer/transfer`, never implicit. Deleting a chat purges its memory (via `purgeOrphanedChatMemory` on state sync). Schema v1 was character-global; `FableStore._migrateIfNeeded` upgrades old databases.

**Stat deltas are not linear.** `deltaStat` applies headroom scaling toward extremes and ×1.5 loss aversion on negative trust/affection/connection changes, and the Drawer 1 rewrite blends mood with the prior (0.6/0.4) instead of replacing it. These exist because the 200-exchange soak showed linear deltas pin every stat at +100 by exchange ~40, which locks the character's emotional range. Don't "simplify" them back to raw addition.

**Ruptures have inertia.** A bond-stat drop of ≥12 effective points opens a 6-step refractory window (`rupture_recovery` on relationship_stats): positive deltas land at ×0.35 until it drains, and `syncStatsToCore` sets `relationship_note` so the prompt carries the wound. Don't bypass `deltaStat` with `setStat` for story events — it skips all of this.

**Embeddings are optional infrastructure.** `lib/llm/embeddings.ts` uses local Ollama (`nomic-embed-text`) with a 60s unavailability cache; every caller must handle `null` and fall back to lexical ranking. Vectors are L2-normalised at creation so `cosine()` is a plain dot product. Never make retrieval *require* embeddings — local-first means Ollama may not be running.

**Eval harnesses spawn Next directly** (`process.execPath` + `node_modules/next/dist/bin/next`), never via `npx` with `shell:true` — the shell wrapper orphaned real servers three separate times, and Next 16 refuses to start while an orphan owns `.next`.

**Stat direction is `character -> player`.** `relationship_stats` rows are directed: observer is the character, target is `player`. That matches what `relationship_with_user` means and what the prompt injects. Querying `player -> character` reads an empty set — that bug shipped once already.

**Entity ids from the model are untrusted.** Extraction will mint `ronan` next to an existing `char-ronan` however the prompt is worded. `EntityResolver` in the extract route folds incoming ids onto existing entities by normalized name before anything is written; never bypass it when adding a new write path. The response's `remapped` field shows what got folded — a growing list means prompt anchoring is losing.

**`lib/server/` is server-only.** Modules there touch SQLite through `FableStore` and must never be imported from a component — the path is the statement, replacing a header comment nothing enforced. `lib/chat/` is client-safe and runs in the browser.

**Client-side generation.** Providers are called from the browser, not from route handlers. `lib/chat/generation.ts` owns the whole turn (prompt build → token budget → stream → extraction). `isGenerating` lives in the Zustand store so every component sees it; the `AbortController` is module-local because it isn't serialisable.

**Persistence is two-layer.** `localStorage` (zustand persist) is a same-browser cache; SQLite is the durable copy. `StateSync` hydrates from `/api/state` on load, then mirrors changes back with a debounce. `PUT /api/state` is a full replace, guarded against wiping existing data with an empty payload.

**Hydration.** Everything is `"use client"`, but Next still server-renders the first pass. Never render a value derived from the current clock (`formatRelative`, `Date.now()`) without gating it behind `useHydrated()`. Placeholder data uses fixed `seedTime()` offsets rather than `Date.now()` for the same reason.

**UI primitives are hand-rolled.** `components/ui/` wraps native elements with Tailwind classes; Radix is pulled in only where focus trapping and portalling have to be correct, which today is `dialog.tsx` alone. `"use client"` marks the primitives that genuinely need it (state, or a client-only portal) rather than every file in the directory.

**Effects must not call setState synchronously.** React Compiler lint rules are on and `react-hooks/set-state-in-effect` is an error. The pattern used throughout the inspector: hold one result object keyed by what was fetched, derive `loading` from `result.key !== fetchKey`, and only setState inside async continuations behind a `cancelled` guard.

**One success envelope per route kind.** Reads return the bare payload (`{ facts }`, `{ entities }`); mutations return `{ ok: true, ... }`; every non-2xx body is `{ ok: false, error }`, which `routeError` in `lib/api.ts` guarantees for the 500 path. Clients branch on `res.ok` for reads and on `body.ok` for mutations — three different success checks across the inspector was the bug this replaced.

**LLM output is untrusted.** `parseLLMJson` returns a fallback on unparseable input, so callers must distinguish "parse failed" from "nothing found" and report it rather than returning `ok: true` with empty arrays. Route bodies are validated explicitly; `PATCH /api/chat/core-memory` whitelists keys because the patch is spread into the stored document.

## Before you finish

`npm run lint` and `npx tsc --noEmit` are both expected to be clean. Verify UI changes in the running app rather than assuming.
