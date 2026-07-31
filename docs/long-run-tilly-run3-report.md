# Long-run soak #3 — Tilly & Kael, embeddings live, post-fix validation

Run: same scenario as soak #2 (`--scenario tilly`, DeepSeek), but with the four
soak-#2 fixes applied **and local embeddings running** (`nomic-embed-text`).
Completed 143/200 exchanges — a transient OpenRouter failure exhausted the
harness's three quick retries at turn 144 (now hardened to six attempts with
exponential backoff). $0.76 · 0 extraction failures · 0 drift · 0 remaps.
Every checkpoint up to the stop is valid data, and the run covered the full
rupture and most of the repair.

## Did the fixes work?

**Mood cap — yes, exactly.** Valence sat at precisely **0.35** through the
entire cold-aftermath beat (t115–130) while the blend pushed higher. Soak #2
hit 0.99 in the same beat with trust at 28; the emotional-amnesia read is gone.
Once repair began and the refractory drained, the cap released (V 0.55 at t140).

**Identity-core pinning — yes, verified directly.** After the run I queried the
final database (86 live facts vs the 20-slot window) through the real retrieval
API under four different contexts — family talk, schedule talk, an unrelated
remark, and no context at all:

```
family/fear context   lila: YES  storm: YES
schedule context      lila: YES  storm: YES
unrelated context     lila: YES  storm: YES
no context            lila: YES  storm: YES
```

Lila and the thunderstorm fear are in the window *unconditionally* — pinned,
not relevance-lucky. The "you're an only child" confabulation class is closed
for kinship and fears. The mid-run probe agrees: at t100 memory-only recalled
sister + fear + rift and beat the full-history reply (which mid-meltdown only
produced fear + symposium).

**Semantic dedupe — yes, dramatically.** 60 of 146 facts folded or superseded
(41%), versus 9 of 129 (7%) in soak #2. The live set at t143 was 86 facts where
run #2 carried 120 — restatements are being folded into their originals instead
of stealing window slots.

**Stat whitelist — yes.** No stray `mood` stat row this run.

**Rupture dynamics again behaved** (this story's betrayal landed harder — every
run tells its own version): trust 49 → **−90** across six turns, affection
untouched at ~96, then the signature refractory crawl (−90 → −84 over twenty
cold-aftermath turns) before repair began moving it (−49 by t140, climbing).

## What the run exposed

**Gap: the symposium wasn't pinned.** Extraction stored it as `has_event` with
importance 0.5 — outside both the kinship/fear/obligation hints and the
importance floor. Fixed: `event`/`appointment` joined the obligation hints, so
scheduled things a partner is expected to remember now pin too.

**New pathology: commitment explosion.** ~200 active commitment rows by t143,
because exact-string dedupe can't see that "Wear the Meshuggah shirt next
Thursday" and "Tilly will wear the Meshuggah shirt next Thursday at 2PM" are
the same promise — DeepSeek re-emitted running gags (Brutus's belly-rub treaty,
the coffee thermos protocol) as fresh commitments every few turns. Fixed:
per-promisor content-word Jaccard dedupe (≥0.5 overlap → duplicate). The
commitment *resolution* path did work — several promises were marked fulfilled
when kept in-story.

**Harness fragility.** One provider blip killed the run at 71%. chat() now
makes six attempts with exponential backoff and logs the API error it saw.

All fixes re-validated against the deterministic mock suite: **25/25**.

## Where this leaves the memory system

Across three soaks the failure frontier has moved twice: from *storing* facts
(solved by run #1's fixes — nothing has been lost from the graph since), to
*selecting* facts under budget (solved for identity-core facts by pinning +
shrunk by dedupe), to what's left now — mostly hygiene at the write path
(commitment spam, importance calibration) rather than architecture. The
emotional layer has now produced two differently-shaped but equally plausible
relationship arcs from the same beats, which is exactly what a dynamics system
should do.

Worth running when convenient: a fresh full 200 with everything live — pinning
+ event hints + both dedupes + hardened retries — to confirm the late-window
probes hold 4/4 where soak #2 decayed to 2/4. Expected cost ~$1.50.
