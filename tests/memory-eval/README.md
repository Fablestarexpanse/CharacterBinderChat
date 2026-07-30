# Memory eval harness

Scripted conversations driven through the **real** extraction and core-memory
routes against an **isolated database**, with assertions on the resulting
knowledge graph.

The point is that memory quality was previously unmeasurable. Extraction either
produced good facts or quietly produced nothing, and there was no way to tell a
prompt improvement from a regression — or to know whether a cheaper model would
do the job. This makes both observable.

## Running it

Add your key to `fablechat/.env.local` (gitignored) once:

```
OPENROUTER_API_KEY=sk-or-...
```

Then:

```bash
node tests/memory-eval/run.mjs                                  # default model
node tests/memory-eval/run.mjs --models deepseek/deepseek-chat,deepseek/deepseek-v3.2-exp
node tests/memory-eval/run.mjs --only location-supersession      # one scenario
node tests/memory-eval/run.mjs --provider lmstudio --base http://127.0.0.1:1234 --models local-model
```

The harness starts its own Next server on port **3157** with
`FABLE_DB_PATH` pointed at `tests/memory-eval/.eval-db/eval.db`, so your real
`data/fablestore.db` is never touched. The DB is recreated per run and wiped
between scenarios. Exit code is non-zero if any check fails, so it works in CI.

Each run writes a JSON snapshot to `results/` for tracking trends across prompt
or model changes. Results and the eval DB are gitignored.

Cost is small — roughly 11 model calls per scenario set, ~1–2k tokens each. The
report prints an estimated dollar cost using live OpenRouter pricing.

## What each scenario catches

| Scenario | Failure mode it detects |
|---|---|
| `location-supersession` | Contradictory facts accumulating instead of the old one being superseded. The core bi-temporal guarantee. |
| `entity-id-stability` | Entity ID drift (`kaspar` / `kaspar_division` / `the_kaspar_division`) fragmenting the graph — the reason the inspector needs a merge tool. |
| `stat-direction` | Relationship stat deltas with the wrong sign. Nothing else validates this, and a character warming to betrayal would look like a working feature. |
| `fact-grounding` | Hallucinated facts. These are permanent and compound, because facts are injected into every later prompt. |
| `persona-awareness` | The persona not reaching extraction, leaving facts about you attributed to a generic "user". |
| `core-memory-rewrite` | Drawer 1 producing empty output (dead weight) or an unbounded `narrative_summary` (a slow context leak, since it's in every prompt). |

Beyond pass/fail, every run reports:

- **JSON compliance** — share of calls returning parseable output. If this isn't
  ~100%, that model cannot drive the memory system at all, whatever its prose
  quality. This is the single most important number here.
- **Median latency** — extraction runs on every turn, so this is felt directly.
- **Duplicate clusters** — whether entity roster injection is holding.
- **Graph shape** — entity/fact counts, useful even when checks pass.

## What it has already found

Three real bugs, all of which had been invisible in normal use:

1. **Location predicates didn't supersede across the family.** `lives_at` and
   `located_at` are both single-valued, but supersession compared raw
   predicates, so a model drifting between them left a character living in two
   places at once. Fixed by comparing *predicate families*
   (`lib/db/predicates.ts`).

2. **Facts about the protagonist were filed under an id nothing read.** The
   prompt told the model to reuse roster ids and then, two rules later, to
   "use snake_case IDs derived from names". Models obeyed the second, emitting
   `ronan` beside the app's `char-ronan` — so every extracted fact landed on a
   twin entity and `retrieveFactsForPrompt(characterId)` returned nothing. The
   read path for the main character was entirely dead. Fixed by anchoring both
   participant ids in the prompt, removing the contradiction, and resolving
   incoming ids onto existing entities by name server-side (`EntityResolver`).
   All four models tested emitted the drifting id, so the prompt alone was
   never going to be enough.

3. **Relationship stats were written in one direction and read in the other.**
   Extraction emits `character -> player` (how the character feels about you,
   which is what the scene implies). But `syncStatsToCore`, `CharacterTab`, and
   `RelationshipsView` all queried `player -> character`, so the stat block was
   permanently empty even when extraction worked — while `characterSummary()`
   read the correct direction, which is why the two disagreed. Aligned
   everything to `character -> player` and migrated existing rows.

Findings 2 and 3 shared a signature worth remembering: **all models failing a
scenario identically, with 100% JSON compliance.** That combination means the
pipeline is broken, not the model.

## Adding a scenario

Append to `scenarios.mjs`. Each entry needs `batches` (one array of messages per
extraction call, cumulative like the real client sends) and a `check(q, ctx)`
returning `[{ name, pass, detail }]`. The `q` helper exposes `liveFacts`,
`allFacts`, `entities`, `entity`, `stats`, `coreMemory`, and
`duplicateClusters`.

Set `refreshCore: true` to also exercise the Drawer 1 rewrite. Use `followUp`
for two-act scenarios where you need to read state between acts — the reading
lands in `ctx.snapshots`.

Write assertions against *observable graph state*, not model wording. A check
that depends on phrasing will flake across models and teach you nothing.

## Known limitations

- Checks are deterministic assertions, not a judge model, so they catch
  structural failures rather than subtle quality differences. Grounding is
  approximated by token overlap with the source text.
- Single sample per scenario. Real models are non-deterministic; treat one run
  as a smoke test and re-run before concluding a model is bad.
- Chat prose quality is out of scope — this measures the memory pipeline.
