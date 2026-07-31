# Memory eval harness

Three complementary tests:

| Script | Question it answers |
|---|---|
| `run.mjs` | Do the mechanics work on a single exchange? Supersession, entity identity, stat direction, grounding. Deterministic assertions, pass/fail. |
| `longitudinal.mjs` | **Does a character actually still know things many exchanges later, without the player restating them?** Plants facts early, buries them under filler, and tracks whether they still reach the prompt. |
| `long-chat.mjs` | **Does a relationship actually form over a 200-exchange story?** A player agent follows a scripted emotional arc (`--scenario <name>` loads `scenario-<name>.mjs`) through the real pipeline; probes compare full-history recall against memory-only recall, and metrics track the stat dynamics turn by turn. Costs real OpenRouter tokens (~$1.50 per 200-exchange DeepSeek run). |

The longitudinal test exists because the first one can pass completely while
memory is still useless. **Storage is not memory.** A fact can sit in SQLite
forever and never reach the model, because `retrieveFactsForPrompt()` injects
only a bounded subset. What matters is the *prompt-facing* view, so that's what
`longitudinal.mjs` measures — turn by turn — and it reports facts that are
"stranded": present in the database, invisible to the character.

```bash
node tests/memory-eval/longitudinal.mjs            # 14 exchanges, tracks retention
node tests/memory-eval/longitudinal.mjs --recall    # also asks the character to recall, end to end
```

Each turn prints `new[...] old[...]` for the planted facts, comparing the current
durable-tier retrieval against the previous confidence+recency ranking on the
same graph — so a retrieval change can be judged without re-running the story.
`✓` = in the prompt, `·` = in the database but not the prompt, `✗` = absent.

---


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

4. **Retrieval never looked at facts about the player.** `retrieveFactsForPrompt`
   queried only facts where the *character* was subject or object. Everything a
   player says about themselves is stored under the `player` entity, so none of
   it was reachable — the character could not recall your family, your fears, or
   your promises, which for roleplay is the half of the graph that matters.
   Measured over 14 exchanges: **2 of 28 facts injected**, and every planted
   fact sat in the database untouched for the whole story. Fixed by partitioning
   live facts into about-the-character / about-the-player / world knowledge, with
   a guaranteed share for each participant, ranked within each group by
   durability, then relevance to the current turn, then confidence, then recency.
   After: **20 of 28 injected**, planted facts reaching the prompt by turn 2 and
   holding to the end. Prompt-window retention went 0/3 → 2/3, with the
   remaining miss being an extraction gap, not a retrieval one.

Findings 2 and 3 shared a signature worth remembering: **all models failing a
scenario identically, with 100% JSON compliance.** That combination means the
pipeline is broken, not the model.

Finding 4 came with its own lesson: the scenario suite was fully green while
memory was still nearly useless, because it asserted on *database* state. Storage
is not memory. Only a test that reads the prompt-facing view could see it.

### Two mistakes this harness made about itself

Worth recording, because both produced confident wrong conclusions:

- **An unfaithful baseline.** The legacy-ranking comparison did not replicate the
  character-only subject filter, so the old behaviour scored 2/3 when it really
  scored 0/3 — which made the first attempted fix look like a regression against
  a strategy that never existed.
- **A metric that rewarded failure.** "Facts reaching the character" was computed
  as *not stranded*, so a fact that was never extracted counted as a success. The
  report now counts prompt presence directly and splits stranded (retrieval's
  fault) from never-extracted (extraction's fault), because those need opposite
  fixes.

### What it still cannot tell you

`--recall` asserts on *availability* — that a fact reached the prompt. It cannot
prove the model *used* it well. In one run retrieval correctly supplied
`Elen lives_at capital` and the model still conflated Elen with an unrelated
family. The recall probe is the only check that catches that class of problem,
and it does so by reading the answer, not the graph.

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
