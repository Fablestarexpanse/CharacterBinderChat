# Code-health run — desloppify, branch `desloppify/code-health`

NEXT: triage is complete. All seven stages are recorded and confirmed, and
the execution queue now holds nine clusters and 28 steps in dependency order,
starting with `unsafe-cast-hardening`. Of the 101 open review findings, 58
verified as already fixed by the commits below and were resolved with per-issue
notes, 9 were permanently skipped with specific reasons, and 34 became the
clustered work. Run `desloppify next` from the workspace root to start
executing, or `desloppify plan cluster show <name>` to read a cluster's steps.
See "Triage outcome" below for what the verification found.

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

## Triage outcome

The blind review that produced the 101 findings ran before the remediation
commits landed, so most of it described code that no longer exists. Five
subagents re-read the source behind every finding: 59 verified as false
positives (58 of them "already fixed", one a reviewer misread), 26 as genuine,
9 as exaggerated, 6 as not worth the churn and 1 as over-engineering. The 58
fixed ones were resolved rather than skipped, so the record of the work
survives; the 9 judgment calls were skipped one at a time with their own
reasons rather than in bulk.

Two auto-clusters were decided. Both `json_parse_unguarded` findings are false
positives: `lib/db/transfer.ts:33` already has a try/catch, and
`lib/import/applyCards.ts:50` sits inside `importCardFiles`' per-file handler,
which turns a throw into an `ok: false` result. The `untested_module` cluster
was broken up: six of its fifteen members are covered by `tests/unit`, which
the detector cannot see because those tests load app modules through a dynamic
import plus a resolve hook rather than a colocated file.

A second adversarial pass over the 28 executor-ready steps corrected 17 of
them. Three would have broken the build or the app: a step that deleted the
`/image` director state along with the decay effect it meant to move, one that
assumed `applySettingsToWorkflow` was exported from `lib/providers/comfyui.ts`
when it is a bare function, and one that would have pasted a block-level banner
into the flex row in `app/page.tsx` and squeezed the sidebar.

### A tool bug, fixed

`desloppify plan triage --stage organize` reconciles the reflect ledger against
plan state, where an issue is either clustered or in `plan["skipped"]`. An issue
resolved as fixed is neither, so all 58 read as "not skipped, not clustered" and
the stage refused to record — and `plan skip` is a no-op on an already-resolved
issue, so the state it demanded was unreachable. The fix teaches the validator
that a `fixed` or `auto_resolved` work item satisfies whatever the ledger
intended, since resolving is a stronger outcome than skipping. It is committed
with four tests as `tooling/desloppify-organize-resolved-issues.patch` in the
workspace root, and still needs pushing upstream — `gh` was not authenticated
when it was written.
