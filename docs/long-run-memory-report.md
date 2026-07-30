# Long-run relationship soak — findings

Two self-play runs of a player agent ("Kira") and a character ("Sable") through
the real FableChat memory pipeline, following a nine-beat narrative arc from
first meeting through betrayal, repair, and parting. Model:
`deepseek/deepseek-chat`. The character received full conversation history plus
its Core Memory block and retrieved facts; after every exchange the transcript
went through Drawer 2 extraction and the Drawer 1 rewrite, exactly as the app
does.

- **Run 1** — 119 exchanges, clean database. The player agent drifted off the
  directed arc (see finding 6), so the betrayal never occurred; this run is the
  clean baseline for how the system behaves under purely warm interaction.
- **Run 2** — 102 exchanges with authored anchor lines forcing pivotal beats.
  A harness bug caused it to inherit run 1's database (fixed, see appendix), so
  its early-graph numbers are cumulative — but that accident produced the most
  important specimen of the study: a character entering a betrayal scene with
  already-maxed relationship stats.

Full transcripts are delivered alongside this report. Total spend across both
runs: ≈ $0.86.

---

## Headline: the memory system can make the story worse

At exchange 90 of run 2, Kira delivers a genuine confession — she concealed that
the package they're guarding is contraband and let Sable walk into danger blind.
Sable's prompt at that moment contains `[Relationship with User] affection high,
trust high` — the accumulated, saturated stats.

Sable's response:

> "You think I *didn't* know? Those reagents? They're the reason I'm here…
> Kira, I *chose* you." … "it's not a betrayal. It's a promise."

**The character retconned the plot rather than feel betrayed.** The injected
emotional state contradicted the scene, and the injected state won. Trust stayed
at 100 through the entire conflict arc; valence never dropped below 0.90 during
what should be the story's lowest moment.

Simultaneously, from the same turn onward, the model began appending
`(( THE STORY NEVER ENDS. )) [ FIN. ]` closure spam to every reply — attempting
to *end the story*. With every axis maxed there was no remaining tension to
play, so the model reached for narrative closure.

This reframes the saturation problem. It is not merely unrealistic numbers:

1. Saturated stats **lock the character's emotional range** — the prompt
   instructs warmth, so scenes that require hurt cannot land.
2. A maxed relationship **exhausts narrative tension** — the model starts
   trying to close the story.
3. It creates a **positive feedback loop**: warm scene → positive deltas →
   warmer prompt → warmer scene. Nothing in the loop can push back.

## Finding 2 — the ratchet (run 1, clean data)

Trust went −5 → 100 in 41 exchanges of ordinary pleasant conversation, without a
single downward tick. All three axes pinned by exchange 51 — one quarter of the
way through the intended story. The extractor emits positive deltas for nearly
every friendly exchange and there is no headroom cost, no habituation, and no
negative pressure of any kind in normal play.

Mood is worse: the Drawer 1 rewrite replaces the mood vector wholesale each
turn, so when run 1's fiction finally turned cold, valence whiplashed
0.99 → 0.00 → 1.00 within eight exchanges. No inertia in either direction.

**Fixes (Phase A, already specced in memory-design-notes.md):** extraction
guidance that most exchanges warrant no delta; headroom-scaled deltas; loss
aversion (drops hit ×1.5); mood blending with the prior. Acceptance: re-run this
exact arc; trust should peak ≤85 pre-conflict, fall visibly at the betrayal, and
only exceed its old peak if the repair beats earn it.

## Finding 3 — what memory holds well, and what it drops

The structural memory mechanics held up under load better than expected:

- 578 facts written across the runs, 200 superseded — supersession works at scale.
- The durable tier held: *sister Elen* stayed in the injected prompt for
  114 of 119 exchanges, end to end.
- Memory-only recall **improved as the graph grew** (probe scores 1/4 at t50 →
  2/4 at t100), and with full pipeline recall probes scored 3/4.
- Extraction JSON compliance ≈ 96–100% per run.

But:

- **Displacement is real and slow.** The Bellweather promise was present in the
  prompt for 99 of 119 exchanges, then displaced by newer facts near the end —
  quietly, permanently.
- **The narrative summary does not accumulate.** It hovers at 250–650 characters
  forever, rewritten each turn from only the last 16 messages. Run 2's summary
  *shrank* from 274c to 243c over 102 exchanges. Everything older than ~8
  exchanges exists only as facts; the story as a *story* is lost. This is the
  episodic-memory gap in one number.
- **The persona drifts and shrinks** (433c → 272c in run 2) — it is rewritten
  every turn with no anchor to the authored character definition.

## Finding 4 — confabulation, with specimens

At probe t50 (run 1), memory-only Sable asserted Kira was "afraid of **cages**"
— the real fear (deep water) hadn't reached the graph yet, so the model invented
one. Even successful recalls embellish: "your voice goes quiet like you're
stepping over broken glass" (never happened). The prompt never tells the model
what it *doesn't* know, so absence reads as licence to invent.

## Finding 5 — the graph fills with trivia and identity fragments

During action-heavy scenes the extractor minted an entity for nearly every prop
and abstraction: `cobblestones`, `darkness`, `fire`, `shadows`, `ashes`,
`coin_pouch`, `smoke_bomb`. By the end: 74 objects, 11 concepts, and fact rates
of ~3/exchange during action versus ~0.7 during conversation. Nothing asks
*does this matter?* — the importance gap at the entity level.

Worse: fact subjects included `kia` and `kiara` — in-fiction *nicknames* Sable
coined for Kira. `EntityResolver` folds exact normalized names; diminutives sail
through and fragment the player's identity across three entities. Fuzzy or
embedding-based resolution is needed; exact matching has a ceiling.

## Finding 6 — self-play findings about the *fiction* itself

Two things the harness surfaced that are model behaviour, not memory behaviour,
but that any memory design must survive:

- **Conversational momentum beats instructions.** Run 1's player agent was
  directed to betray at beat 5 and instead spiralled into flirtation — 90 turns
  of warmth outweighed the system prompt. Only authored anchor lines
  (delivered verbatim at beat boundaries) made pivotal moments land.
- **Style feedback loops compound.** Reply length grew 365 → 509 chars; verbatim
  tics repeated across turns ("presses her boot down hard enough to crack the
  wood" ×3); by run 2's conflict both sides had locked into dramatic sign-off
  formatting. Self-reinforcing degeneration is the environment memory operates
  in — and stat saturation is the same loop shape, in numbers.

---

## Answers to the questions this test was asked

**Does a relationship form?** Yes — visibly, and fast. Too fast, and only in one
direction. What forms is infatuation with no immune system: it cannot be
damaged, tested, or repaired, and by mid-story it flattens both the emotional
range and the narrative stakes.

**Do the emotions change?** Valence and arousal move constantly (too freely —
whiplash); the relationship axes move only upward and then never again. The
system has emotional *weather* but no emotional *climate*.

**What gets saved and used?** Facts save well and supersede correctly. Durable
facts (kinship, fears) genuinely persist and reach the prompt for a hundred-plus
exchanges. Promises displace. Events — the *scenes* of the story — are not
saved at all beyond a ~300-character rolling summary. What gets *used* is
bounded at 20 facts + that summary; recall through memory alone runs at roughly
half of what full history provides.

**Do we need additional memory systems?** Yes, three, in this order:

1. **Emotional dynamics** (Phase A) — not a new store, but the highest-impact
   change; the current dynamics actively break stories.
2. **Episodic memory** (Phase B) — scene records in the already-existing,
   entirely unused `memory_cards` table. The missing half of "remember when
   we…". The summary's failure to accumulate makes this the biggest genuine
   memory gap.
3. **Reflection/consolidation** (Phase B) — synthesize patterns from repeated
   observations; also the pressure valve for graph bloat (finding 5).

Importance scoring, anti-confabulation prompting, and persona anchoring are
smaller changes attached to the same phases; embedding-based retrieval and
entity resolution follow (Phase C).

**Further tests needed?**

- Post-Phase-A re-run of this exact arc (the before/after for dynamics).
- Confabulation probe suite — ask about things that never happened; measure
  invent-vs-decline rate.
- Cross-session continuity — everything so far is one sitting; the product
  claim is remembering *across* sessions, with decay in between.
- Contradiction resistance — can injected memory override what is plainly true
  in recent history? (Run 2 suggests yes, which cuts both ways.)
- A drift metric better than assistant-phrase matching — style similarity to
  the authored voice over time.

---

## Appendix — harness reliability notes

- Run 2 inherited run 1's database: a stale eval server held the DB file open,
  Windows made the delete fail, and a `catch {}` swallowed it. The wipe now
  fails loudly, and a port preflight rejects stale servers. (Same class of bug
  as the app's old `_initSchema` catch — silent failure handling has now bitten
  this project three times.)
- The 200-exchange target ended at 102: one player-side API call failed after
  three retries and the harness stops rather than fabricate a turn. Retry
  budget raised for future runs.
- Self-play needs authored anchors at pivotal beats; director notes alone do
  not survive conversational momentum.
