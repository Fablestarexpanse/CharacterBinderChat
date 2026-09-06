# Code-health run — desloppify, branch `desloppify/code-health`

NEXT: the target is met — strict 86.0 against a target of 85.0 (plan start
20.4). The queue holds one planning step: `desloppify plan triage` walks seven
stages that sort the 101 remaining review findings into clusters. Those findings
are the next cycle's backlog, not defects waiting on a fix; the ones that were
live defects are fixed and listed below. Run `desloppify plan triage` from
`F:\Cursor Projects\WaffleChat` to continue, or start a new cycle with a scan.

## Where it ended

| Score | Plan start | Now |
| --- | --- | --- |
| Strict (the north star) | 20.4 | **86.0** |
| Overall | — | 89.1 |
| Objective (mechanical) | — | 94.5 |

Twenty blind subagent reviews ran against the finished code; their findings
drove the last third of the work and are imported into the plan.

## What this run did

Worked the desloppify queue end to end. Every change was verified before it was
committed — `npx tsc --noEmit`, `npm run lint`, `npm test`, and for anything
visible, the running app driven with real clicks.

Themes, in the order they were tackled:

- **False abstractions removed** — a prompt builder taking eight positionals
  (five of them consecutive `string[]`), a memory-store wrapper that only
  forwarded, duplicated download helpers, a `Field` component copied between two
  dialogs.
- **One rule per thing** — `routeError` for the 500 path, one success envelope,
  one memory-task envelope validator, one lexical-overlap module, one
  fact-supersession implementation (`FableStore.assertFact`), one provider
  resolver, one renderer for a fact's object.
- **Failures made visible** — a failed memory read used to look exactly like
  empty memory; StateSync treated a failed load as "server has no data" and
  saved local state over the durable copy.
- **Placement** — extraction, retrieval, prompts and dedupe moved out of route
  files into `lib/server/`; the client store split into slices; `lib/db/store.ts`
  1423 → 1048 lines with `appState.ts`, `transfer.ts` and `rows.ts` extracted.
- **Tests, from none to a gate** — `npm test` (62 unit tests via `node --test`,
  no new dependencies) and `npm run test:api` (15 route and bi-temporal tests).
  CI runs lint, typecheck, the unit suite, and the API suite against a server it
  starts on a scratch database.

## Defects found and fixed, not just tidying

- The v1 → v2 migration reset every fact's importance and healed every open
  rupture, because its INSERT column lists predated those columns.
- A corrupted chat row shifted every later chat onto the previous chat's
  messages — on the corrupted-data path the skip-and-continue helper existed to
  survive.
- A failed `GET /api/state` was read as "the server has no data", which seeded
  the durable copy from local state.
- Constant lorebook entries never fired on a chat's first turn.
- `StateSync` was mounted at two tree positions across the readiness gate, so it
  remounted and re-ran its whole hydrate-or-seed effect.
- Five `JSON.parse` calls on database columns had no guard: one corrupted row
  made a whole read throw.
- The ComfyUI proxy checked one URL string and forwarded a different one.

## Accepted debt (recorded, not fixed)

- **Console diagnostics** stay. They are the only failure-visibility layer in a
  single-user local-first app, and most were added by this run.
- **React components have no automated coverage.** Asserting on them needs a DOM
  harness (jsdom + a testing library); they are verified by driving the app.

Strict score counts both as open, which is the honest signal.

## Notes for the next session

- `.desloppify` state lives in the workspace parent, not in `fablechat/`, so
  `desloppify` commands must be run from `F:\Cursor Projects\WaffleChat`.
  Commit tracking is off for the same reason — the rationale lives in commit
  messages.
- No backticks in `--note` strings; bash command-substitutes them.
- Editing `lib/db/store.ts` in dev used to leave routes calling the previous
  class through the globalThis cache. `getStore()` now rebuilds when the class
  changes, but a hard restart is still the fastest way to be sure.
