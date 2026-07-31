# Memory design notes

> **Historical snapshot (July 2026).** This document describes the system
> BEFORE Phases A–C shipped. Much of what it lists as missing now exists:
> episodic memory cards + reflections, the anti-confabulation instruction,
> semantic retrieval via embeddings, wired commitments, persona anchoring,
> identity-core fact pinning, shared language, and the story clock. See
> `docs/long-run-*.md` for the current state. Kept for the problem framing
> and sources.

What people actually complain about in AI roleplay memory, which of those
problems FableChat already addresses, and which it does not. Written to inform
what to build next rather than to justify what exists.

Sources are listed at the end.

---

## The complaints, and where we stand

### 1. "Stored but never retrieved"

The single most common failure. SillyTavern's memory extensions store extracted
memories in a Data Bank, but without Vector Storage enabled *"memories are stored
but never retrieved — the character won't recall anything."*

**We shipped this exact bug.** `retrieveFactsForPrompt` queried only facts where
the character was subject or object, so everything the player said about
themselves was unreachable: 2 of 28 facts injected over a 14-exchange test.
Fixed by partitioning retrieval across character / player / world with a
guaranteed share each.

The general lesson is now baked into the harness: **assert on the prompt-facing
view, never on database state.** A green test suite that reads SQLite can coexist
with a character that remembers nothing.

### 2. Forgetting after ~100 messages

Reported consistently: characters forget events and people "after a hundred
messages or so", and most memory extensions are *"designed for chats with 100
messages or fewer"* — past that they summarise older material aggressively,
leaving *"full detail on recent history and a heavily compressed blur for
everything older."*

**Partially addressed.** Drawer 2 keeps facts indefinitely and bi-temporally, so
old facts are not compressed away — they are superseded, not deleted. But
retrieval only injects a bounded window (20), and once the graph exceeds that,
selection quality is everything. Our selection is keyword overlap plus a durable
heuristic, not semantic similarity.

### 3. Personality drift

Models slide out of character back toward a generic assistant voice — the
*"Assistant Axis"* — and *"emotional or self-reflective conversations are exactly
what trigger the slide."* Users report characters *"too bland or not at all
consistent with the tone you've assigned."*

**Partially addressed, untested until now.** Drawer 1 re-injects persona and mood
every turn, which should counteract drift. But nothing measured it, and the
rewrite loop can also *cause* drift: the persona field is rewritten by an LLM
after every exchange, so it can wander with no anchor back to the original
character definition. That is a plausible failure mode we introduced ourselves.

### 4. Static growth — the deepest complaint

Long-term companion users describe the character becoming *"a shell of her former
self"*, conversations like *"speaking to a somewhat broken record."* The
diagnosis: these systems *"cannot meaningfully evolve or deepen relationships
through genuine learning, only through pattern repetition."*

**This is what Drawer 1 is for**, and the honest question is whether its growth
is real or cosmetic. A mood vector and five stat axes can move without the
character behaving any differently. The relationship soak exists to answer that.

### 5. Confabulation

*"Inventing inconsistent details"* — a character confidently asserting a shared
history that never happened. Our own pilot did this at exchange 2, inventing a
tell ("you scratch your left thumb against your belt buckle") and asserting the
player had no family.

**Not addressed.** Nothing distinguishes "I know this" from "I am improvising."
The graph has `confidence`, but it is not surfaced to the model, and the prompt
never says *what the character does not know*. Absence of a fact reads to the
model as licence to invent.

---

## What the architecture literature says we are missing

The standard decomposition is working / episodic / semantic / procedural memory.
Mapping ours:

| Layer | Purpose | FableChat |
|---|---|---|
| Working | Active context | Message window + token budget — **have** |
| Semantic | Decontextualised facts | Drawer 2 triples — **have** |
| Episodic | Records of *experiences*, timestamped | **missing** |
| Reflection | Higher-order insight synthesised from observations | **partial** |
| Procedural | Skills, habits | not relevant here |

### Episodic memory is the biggest gap

Drawer 2 stores *facts* ("Kira fears deep water") but no *events* ("the night the
crossing flooded and she froze on the bank"). Roleplay memory is largely episodic
— "remember when we…" is the texture of a relationship, and we cannot represent
it. The `memory_cards` table exists, is described in the Drawer 2 spec as
Zettelkasten narrative notes, and is **completely unused**: zero rows, no writer,
no reader. The scaffolding is there.

### Reflection and consolidation

Generative Agents accumulates timestamped observations, then periodically runs a
*reflection* step that clusters related observations and synthesises higher-order
insights, triggered when accumulated importance crosses a threshold. Consolidation
turns repeated episodics into semantics — "the user corrected the date format on
Jan 5, Jan 12, Feb 1" becomes "user prefers DD/MM/YYYY".

We rewrite a narrative summary every turn, which is compression, not reflection.
Nothing ever concludes *"Kira consistently avoids water routes"* from three
separate observations. That inference is what makes a character feel like it
*understands* someone rather than holding a list about them.

### Importance ≠ confidence

Generative Agents scores each memory for **importance** and uses it both for
retrieval weighting and to trigger reflection. We store **confidence** (how sure
the extractor is) and use it as the retrieval sort key — which is a category
error. "Kira's sister is Elen" and "the bridge toll went up" can both be
confidence 0.95 while differing enormously in how much they matter.

Our durable-predicate heuristic is a crude proxy for importance. A real
importance score, assigned at extraction time, would be strictly better and is a
small change: one column, one prompt field.

### Retrieval is lexical, not semantic

Relevance is keyword overlap. Ask about "the crossing" and a fact stored as
"afraid of deep water" scores zero. Every mature system in this space uses
embeddings. This is the clearest single upgrade to retrieval quality, and the
Drawer 2 spec already anticipates it ("add an `embedding BLOB` column… hybrid
search: semantic retrieval narrows candidates, then exact temporal and
access-control filters apply").

---

## Proposed direction, in order of value per unit of work

1. **Importance scoring on facts.** One column, one extraction prompt field, used
   as the primary retrieval sort. Cheapest meaningful upgrade.
2. **Commitments actually wired.** The table and the Core Memory field both exist
   and are both empty. Promises are exactly what players expect to be held onto,
   and the soak test's planted promise was never extracted.
3. **Episodic layer via `memory_cards`.** Write a scene note per N exchanges:
   what happened, who was there, emotional weight. Retrieve alongside facts.
   Unlocks "remember when we…".
4. **Reflection pass.** Periodically, importance-gated, ask the model what
   patterns it now sees across recent facts and events, and store the conclusions
   as first-class memories. This is what produces apparent understanding.
5. **Embedding retrieval** to replace keyword relevance, keeping the durable and
   participant guarantees as filters over the candidate set.
6. **Anti-confabulation.** Surface confidence in the prompt and state explicitly
   what is unknown, so the model declines rather than invents. Our best observed
   behaviour — *"the specifics of that promise weren't shared with me"* — happened
   by luck, not design.
7. **Persona anchoring.** Keep the authored character definition immutable and
   separate from the LLM-rewritten persona, so drift has something to be measured
   and corrected against.

---

## Phase A specification — emotional dynamics

Motivated directly by the 200-exchange soak: trust/affection/connection all hit
+100 by exchange ~40 (20% through the story) and valence pinned at 0.9–1.0,
leaving no headroom for the betrayal arc. Observed cause: the extractor emits a
positive delta on nearly every pleasant exchange, and deltas apply linearly up
to the clamp.

Four changes, smallest-first:

1. **Extraction prompt guidance.** Add to the stat_changes rules: most exchanges
   warrant NO stat change; emit deltas only for meaningful shifts; ordinary
   pleasant conversation is `[]`. Expected to remove most of the ratchet on its
   own.

2. **Headroom-scaled deltas** in `deltaStat`. Movement *toward* an extreme is
   scaled by remaining headroom; movement *toward* neutral applies in full:

   ```
   headroom  = 1 − |current| / 100          (when delta pushes away from 0)
   effective = delta × headroom             (toward extreme)
   effective = delta                        (toward neutral)
   ```

   0→60 stays easy; 90→100 requires sustained extraordinary events. Recovery
   from an extreme is never dampened, so a betrayal at trust 100 bites in full.

3. **Loss aversion.** Negative deltas on affection/trust/connection are
   multiplied ×1.5 before headroom scaling. Trust builds slowly and shatters
   quickly — this is also what makes repair arcs earn their length.

4. **Mood homeostasis.** The Drawer 1 rewrite replaces mood wholesale from LLM
   output, which pins at ±1 under sustained tone. Blend instead:

   ```
   valence' = clamp(0.6 × llm + 0.4 × prior, −1, 1)
   ```

   plus rewrite-prompt guidance that ±1.0 is a once-a-story extreme. Arousal and
   dominance blend the same way. (Baseline-seeking decay across sessions already
   exists via applyDecay; this handles within-session pinning.)

Acceptance: re-run the identical 200-exchange arc; expect trust to peak ≤85
before the conflict, drop visibly at the betrayal, and recover to a value
*higher than the pre-conflict peak only if* the repair beats justify it — with
the trajectory graph as the artifact.

## Tests still worth building

- **Persona drift over long runs.** Does voice hold at exchange 200, especially
  through emotional beats? Currently only a crude assistant-phrase detector.
- **Confabulation rate.** Ask about things that never happened and measure how
  often the character invents versus declines.
- **Contradiction.** Does the character ever assert something the graph contradicts?
  With full context this also tests whether injected memory can *override* truth
  present in the transcript — memory actively making things worse.
- **Consolidation pressure.** 500+ exchanges, where even reserved retrieval slots
  overflow and merging redundant facts becomes mandatory.
- **Cross-session continuity.** Every test so far is one continuous run. The real
  claim is remembering across *sessions*, with decay applied between them.

---

## Sources

- [SillyTavern character memory extension](https://github.com/bal-spec/sillytavern-character-memory)
- [SillyTavern MemoryBooks](https://github.com/aikohanasaki/SillyTavern-MemoryBooks)
- [VectFox — vector memory for SillyTavern](https://github.com/KritBlade/VectFox)
- [Negative feedback on LLM storytelling & roleplay apps](https://cuckoo.network/blog/2025/04/17/negative-feedback-on-llm-powered-storytelling-and-roleplay-apps)
- [Why your AI companion loses its personality](https://www.roborhythms.com/ai-companion-losing-personality/)
- [Memory for autonomous LLM agents: mechanisms, evaluation, frontiers](https://arxiv.org/html/2603.07670v1)
- [Architecture and orchestration of memory systems in AI agents](https://www.analyticsvidhya.com/blog/2026/04/memory-systems-in-ai-agents/)
- [Memory consolidation in long-running AI agents](https://zylos.ai/research/2026-04-20-memory-consolidation-ai-agents/)
