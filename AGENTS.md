<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# FableChat project rules

## Project shape

Single-user, local-first app. Next.js 16 + React 19 + Tailwind 4 + Zustand, with `better-sqlite3` running synchronously inside the Next server process. `lib/db/store.ts` (`FableStore`) is the only thing that touches SQL.

Two memory layers, both per-character:

- **Drawer 1** — `core_memory` table, one JSON document per character, always injected into the prompt. Served by `app/api/chat/core-memory/route.ts` (GET plus the key-whitelisting PATCH) and `app/api/chat/core-memory/refresh/route.ts` (POST).
- **Drawer 2** — bi-temporal graph (`entities` / `facts` / `relationship_stats` / `commitments`), retrieved into the prompt. Served by everything under `app/api/drawer/`: entities, entities/merge, entities/overview, episode, extract, facts, graph, stats, stats/decay, summary/[entityId] and transfer.

`fable_drawer2/` (sibling directory, tracked in the parent repo) is the Python reference implementation with 77 passing tests. Treat its semantics as the spec when changing bi-temporal behaviour, and keep `lib/db/schema.ts` in step with `schema.py`.

## Conventions that matter here

**Schema changes.** `CREATE_TABLES_SQL` is split on `;` and executed statement by statement. Never put a semicolon inside a SQL comment — it truncates the statement and the table silently fails to create. `_initSchema` only swallows "already exists" errors; everything else throws, deliberately.

**Two migration mechanisms, and which to use.** `CREATE TABLE IF NOT EXISTS` never alters an existing table, so a schema change needs both halves. For a **new column**: add it to `CREATE_TABLES_SQL` (the real shape of a fresh table) *and* add an `addCol` line to `FableStore._ensureColumns`, which ALTERs databases created before it existed. For a **shape change** — a table keyed differently, data that must be rewritten — write a version-detecting step like `migrateToChatScoped` in `lib/db/migrate.ts`, which is what carried v1's character-global memory onto v2's chat scoping.

**Predicates are canonicalized on write.** `normPredicate()` in `lib/db/predicates.ts` snake_cases and maps aliases (`is_located_at` → `located_at`). Both the extract route and the manual facts route must store the canonical form, or fact supersession silently stops working.

**Stat scales differ between drawers.** Drawer 2 stats are **−100..100** (0 = neutral). Core Memory's `relationship_with_user` is **0..100** (50 = neutral). `syncStatsToCore` converts between them. Any new stat bar must know which scale it is on — `((v + 100) / 200) * 100` for Drawer 2, `clamp(v, 0, 100)` for Drawer 1.

**Memory is scoped to a CHAT, not a character.** Every Drawer 1/2 table carries `chat_id`, and every store method takes it as the first parameter. Starting a new chat with the same character is a fresh start; carrying memories forward is an explicit `/api/drawer/transfer`, never implicit. Deleting a chat purges its memory (via `purgeOrphanedChatMemory` on state sync). Schema v1 was character-global; `migrateToChatScoped` in `lib/db/migrate.ts` upgrades old databases, and the store calls it before creating any table.

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

**One success envelope per route kind.** Reads return the bare payload (`{ facts }`, `{ entities }`); mutations return `{ ok: true, ... }`; every non-2xx body is `{ ok: false, error }`, which `routeError` in `lib/api/server.ts` guarantees for the 500 path. Clients branch on `res.ok` for reads and on `body.ok` for mutations — three different success checks across the inspector was the bug this replaced.

**LLM output is untrusted.** `parseLLMJson` returns a fallback on unparseable input, so callers must distinguish "parse failed" from "nothing found" and report it rather than returning `ok: true` with empty arrays. Route bodies are validated explicitly; `PATCH /api/chat/core-memory` whitelists keys because the patch is spread into the stored document.

**Access control is `proxy.ts` + `lib/security/access.ts`.** The npm scripts bind `127.0.0.1`; the proxy refuses any non-localhost `Host` unless `FABLE_PASSWORD` is set (then HTTP Basic auth covers everything), and refuses cross-origin writes, because routes parse JSON whatever the Content-Type. A new route needs nothing — it is covered — but never read `req.json()` from a path that skips the proxy matcher. Limit: `Host` is client-supplied, so the loopback bind is the real protection when no password is set.

**API keys are encrypted at rest.** `lib/server/secrets.ts` (AES-256-GCM, key in `data/.fable-secret` or `FABLE_SECRET_KEY`); `/api/secrets` whitelists names; `SecretsSync` keeps the OpenRouter key out of localStorage once the server has confirmed it holds it. Never add a secret to `app_kv` outside that whitelist, and never to the state export.

**Branching is point-in-time.** `lib/db/branch.ts` filters timestamped memory by a cutoff and reopens facts whose superseder had not happened yet. Stats and core memory are current-state only, so they come from `memory_snapshots` (saved when a message's extraction finishes); without one the branch is flagged `approximate` — never silently exact. The branch route writes the chat row and the memory in one request because `purgeOrphanedChatMemory` deletes memory for chats not in `app_chats`.

**Facts can be pinned and locked.** Pin: always injected ahead of ranking, capped at half the window. Lock: `assertFact` returns `duplicate: true, blockedByLock: true` for a conflicting extracted value, and `supersedeFact` skips locked rows unless forced. Hand-entered facts pass `respectLocks: false`. New write paths that supersede must go through `supersedeFact`.

**State sync is incremental.** `StateSync` PATCHes a diff (`lib/sync/stateDiff.ts`) by object identity; PUT is first-run seeding only. A new synced collection needs a row in `APP_COLLECTIONS`, the client's `SYNCED_COLLECTIONS`, and the diff's `SyncedName`.

**Prompt assembly is `assemblePrompt`.** Peek Prompt previews through the same function generation uses; keep it free of side effects (the context meter is set by the caller).

**The extraction gate is deliberately dumb.** See `docs/extraction-gate.md` before changing it: content-based skipping was measured and rejected. Run `npm run eval:gate` after touching it.

**Cards are `lib/cards/`.** `png.ts` is the only PNG codec (read and write); `tavern.ts` owns Character ↔ Tavern V2 and `expandMacros`. Import (`lib/import/cardFile.ts`) and export (`lib/cards/export.ts`) both go through it, so a field is added in one place and round-trips. A new `Character` field needs: the type, `characterToCard`, `cardToCharacterDraft`, the editor form, and a line in `tests/unit/cardsTavern.test.mjs`. Anything the editor does not show but the card carries (`cardExtensions`, `characterVersion`) must be passed through on save — `CharacterEditorDialog` builds the character from the form, so a field missing from `handleSave` is silently dropped. A new `LoreEntry` field needs the type, `entryTriggered` if it changes matching, `convertLoreEntry` (import), `loreToCharacterBook` and `lorebookToCard` (export), and `tests/unit/lorebookCards.test.mjs`. `textParser.ts`, `platforms.ts`, `convert.ts` and `validate.ts` are ported from CharacterBinder and carry its tests via `tests/unit/_vitest.mjs`; change their behaviour only with the tests. A new platform needs a registry entry (including its field-support table) AND a converter, or the "writes every field it claims to keep" test fails. Archive import (`lib/import/archive.ts`, `lib/cards/zip.ts`) reads untrusted files: keep the entry-count and inflated-size caps, count what was produced rather than what a header declares, and keep imports idempotent (duplicates skipped). The migration plan is `docs/merge-characterbinder.md`.

**Card text has placeholders.** `{{char}}` / `{{user}}` are expanded once, over the whole assembled system prompt (`buildSystemPrompt`) and in opening messages (`fillGreeting`). Never send card-sourced text to a model another way.

**The server is authoritative; the tab is a cache that syncs.** Every write to app state bumps a revision (`bumpRev` in `lib/db/appState.ts`) and stamps its rows; deletions leave tombstones. Never write `app_*` tables except through `patchAppState` / `replaceAppState`, or the revision, tombstones and every open tab's view go stale. `SERVER_WINS` collections (characters, lorebooks, personas, scenarios, presets) keep the server's copy when a stale write arrives; **chats are browser-wins** — do not make chats server-wins, a streaming reply dirties its row on every token. The tab's merge policy is `lib/sync/remote.ts`; change it only with its tests. `StateSync` must pull before it saves and must re-baseline rows it took from the server, or the next diff sends them straight back.

**Outside writers go through `lib/server/cards.ts`**, never straight to SQLite: it validates, converts card formats, keeps the previous version (`app_history`) and records an event (`app_events`) in the same transaction as the write, so the change is atomic, attributable and undoable. A new card field must be added to `CHARACTER_FIELDS` there as well as to the editor, or `update_card` will refuse it. `mcp/tools.mjs` holds no card logic on purpose; keep it that way.

**Backup is a database snapshot, and restore swaps the file.** `lib/db/backup.ts`: `writeBackup` uses SQLite's online backup, stamps it, strips `secret:*` keys and vacuums; `swapInDatabase` validates first (magic bytes, `integrity_check`, required tables), renames the old database (never deletes it; the newest three are kept), restores the live API keys into the new file, and mints a new **epoch**. Tabs compare epochs on every poll and reload when it changes: revision numbers mean nothing across databases. Add a table the app needs to `REQUIRED_TABLES` only if an older backup would be unusable without it, or old backups become unrestorable. The JSON export (`/api/state?download=1`) deliberately omits memory; do not describe it as a backup.

**The sync loop lives in `lib/sync/engine.ts`, not in a component.** `StateSync` only mounts it through `createLifecycle`, because React's development double-invoke runs an effect's cleanup right after its first run; a loop whose cleanup disposes it then silently never starts (no polling, no saving, in development only). Unit tests cannot see that class of bug: after any change to sync, run it in a browser and confirm `/api/state/changes` is being requested.

## Before you finish

`npm run lint` and `npx tsc --noEmit` are both expected to be clean. Verify UI changes in the running app rather than assuming.
