# Code-health run — desloppify, branch `desloppify/code-health`

NEXT: 20 blind review batches prepared under
`.desloppify/subagents/runs/20260906_023729/`. Launch one subagent per prompt in
waves of four, each writing `results/batch-N.raw.txt`, then
`desloppify review --import-run <run-dir> --scan-after-import`. Everything
mechanical is done or recorded as accepted debt; the subjective re-review is the
only thing left that can move the strict score.

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
- **Tests, from none to a gate** — `npm test` (46 unit tests via `node --test`,
  no new dependencies), `npm run test:api` (15 route/bi-temporal tests against a
  running server), and CI running lint, typecheck and the unit suite.

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
