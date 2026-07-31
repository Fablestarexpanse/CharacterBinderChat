# Long-run soak #2 — Tilly & Dr. Kael Mercer (200 exchanges)

Run: `tests/memory-eval/long-chat.mjs --turns 200 --scenario tilly` · model `deepseek/deepseek-chat`
· 394 API calls · 6.97M in / 60K out tokens · **$1.44** · full transcript in
`tests/memory-eval/results/long-chat-tilly-2026-07-31T04-25-14-855Z.md` (kept out of the repo),
metrics in the matching `.json`.

This is the first soak since the Phase A–C work (emotional dynamics, rupture inertia,
importance gating, episodic memory, embeddings-with-fallback) and the first on a
user-authored card: Tilly (character, slice-of-life romance) opposite the Dr. Kael Mercer
persona. The arc seeds three player facts early (sister **Lila**, the **Friday symposium**,
a childhood **thunderstorm fear**), breaks trust at ~turn 90 (Kael repeats a confidence
to Lila), then repairs across the back half. Probes at 25/50/75/99% ask Tilly what she
knows about Kael, answered twice: with full history + memory, and with **memory only**.

## Headline numbers

| metric | result |
|---|---|
| exchanges completed | 200/200 |
| extraction failures | **0** (394 calls) |
| persona-drift turns | **0** |
| entity id remaps | **0** |
| entities / live facts | 23 / 120 (129 total — supersession working) |
| final stats (char → player) | trust 73.7 · affection 100 · connection 94.6 · desire 90.6 |
| est. cost | $1.44 |

The pre-fix pathologies stayed fixed: no entity explosion (23 entities vs the trivia
flood of run #1), no id splits, no assistant-voice drift, and the narrative summary
stayed bounded (~230c → ~480c) instead of growing without limit.

## The rupture — dynamics working as designed

Trust going into the confession (t89): **95.5**. The collapse was staged, not a cliff:

```
t90  73.0   t91  58.0   t92  35.5   t93  7.1   t94  -7.9   t95  -26.9
```

Six turns from 95.5 to −26.9, driven by loss aversion (×1.5 on negative bond deltas).
Meanwhile **affection only fell 99.6 → 84.8** and never lower — the axes decoupled
exactly the way a real person's would: she still loves him; she doesn't trust him.

Then the refractory window did its job. From t96–t108 — thirteen turns of Kael
apologising — trust moved **−26.9 → −22.0**. Five points. Warmth was being damped
×0.35 while the wound was fresh. Recovery after the window drained came in steps
tied to *acts*, not vibes:

| window | beat | trust |
|---|---|---|
| t114–123 | cold aftermath (he gives her space) | −0.2 → 28.6 |
| t123–135 | cold aftermath | flat at 28.6 |
| t137–155 | repair (the Marrow's apprenticeship gesture) | → 47.8 |
| t155–180 | earned trust (warm, plans made) | **flat at 47.8** |
| t185–200 | settling (the honest accounting) | 57.8 → **73.7** |

Trust plateaued through 25 turns of pleasant warmth and only moved again when the
conversation did explicit trust-work. That is arguably the *right* shape — trust
rebuilds on trustworthy acts, not ambient niceness — and it means the betrayal was
never fully erased: the run ends at 73.7 against a pre-rupture 95.5. Contrast run #1
before the inertia work, where a betrayal was completely forgiven in ~15 exchanges.

Mood separated cleanly from the relationship: valence bottomed at −0.69 during the
confession and recovered to ~0.85 by t111 **while trust was still negative** —
atmosphere tracking the scene, stats tracking the wound. (If anything, valence ran
too sunny during "cold aftermath" — 0.99 while trust sat at 28 — worth watching.)

One artifact: a stat row named `mood` (−11) appeared in `relationship_stats`. The
extractor invented a stat name outside the intended set. Harmless here, but the
extract route should whitelist stat names.

## Memory probes — storage is solved; **selection under budget is the frontier**

Anchor presence in the *graph* vs the *injected prompt window* (20-fact cap, 120 live
facts by the end):

```
            sister  fear  symposium  rift
graph  t80+   Y      Y       Y        Y      ← never lost, all 200 turns
prompt t100   .      Y       .        Y
prompt t160   .      Y       Y        Y
prompt t200   Y      Y       .        Y
```

Probe scores (memory-only): 3/4 → **4/4** at the rupture → 3/4 → **2/4** at t198.
Storage never regressed — every anchor stayed live in Drawer 2 from the moment it was
extracted. What degraded was *which 20 of 120 facts made the window* on a given turn.

And the failure mode when a core fact misses the window is the bad one. The final
memory-only probe answered the "family" question with:

> "You're an only child, which is why you hoard hoodies like a dragon with treasure."

Lila — the fact the entire story hangs on — was in the graph but not the window, and
the model didn't say "I don't remember your family." It confabulated the **opposite**,
plus invented specifics (the hoodie-hoarding, a laminated-notes history). The
anti-confabulation instruction reduces this but does not survive roleplay pressure
when the model feels obligated to answer richly.

**Caveat that matters:** Ollama was not running during this run, so retrieval used the
lexical fallback the whole way. "My family" has no lexical overlap with "Lila is his
sister" — precisely the gap embeddings exist to close. The same run with
`nomic-embed-text` live is the immediate follow-up.

## Recommendations (in order)

1. **Pin identity-core facts.** Durable, high-importance facts about the player
   (family relations, fears, standing commitments) should bypass relevance ranking
   entirely — a small always-injected set, exactly like `constant` lorebook entries.
   The durable-predicate floor (0.75) softens but does not prevent crowd-out at 120
   live facts. This directly kills the only-child confabulation.
2. **Rerun with embeddings live** to measure how much semantic ranking closes the
   window-selection gap before adding mechanism.
3. **Dedupe near-identical facts at write time.** 120 live facts include many
   restatements of relationship progress; each redundant fact steals a window slot.
   Embedding similarity at write time (when available) can fold them.
4. **Whitelist stat names** in the extract route (trust/affection/connection/desire).
5. **Consider mood floor coupling**: valence 0.99 during a beat where trust is 28
   reads as emotional amnesia. A soft cap tying max valence to bond-stat recovery
   would keep the atmosphere honest without re-coupling the axes.

## Verdict

The emotional layer now behaves like a relationship: staged collapse, refractory
grief, act-driven repair, permanent scar tissue, decoupled axes. Zero pipeline
failures across 394 calls. The open problem has moved decisively from *remembering*
(solved: nothing was ever lost from the graph) to *surfacing the right memories under
a fixed budget* — and the cost of a miss is not silence but confident fiction.
Priority one is pinning identity-core facts; priority two is measuring embeddings'
contribution to the same problem.
