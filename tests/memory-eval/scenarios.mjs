// ─── Memory eval scenarios ────────────────────────────────────────────────────
// Each scenario drives scripted turns through the real extraction pipeline, then
// asserts on the resulting knowledge graph. Scenarios target the specific ways
// this pipeline is known to be able to fail — see README.md.
//
// A scenario is:
//   id            stable slug, used in result files
//   what          one line: the behaviour under test
//   why           why it matters / which failure mode it catches
//   characterId   namespaced per scenario so runs don't collide
//   batches       arrays of messages; each batch is one extraction call, so a
//                 two-batch scenario simulates two consecutive exchanges
//   refreshCore   also exercise the Drawer 1 rewrite after the last batch
//   check(q)      returns [{ name, pass, detail }]

const u = (content) => ({ role: "user", content });
const a = (content) => ({ role: "assistant", content });

// ── Helpers shared by checks ─────────────────────────────────────────────────

/** Live facts whose canonical predicate means "where the subject is" */
const locationFacts = (facts) =>
  facts.filter((f) => ["located_at", "lives_at", "current_location"].includes(f.predicate));

const objectText = (f) => (f.object_literal ?? f.object_id ?? "").toLowerCase();

const mentions = (facts, needle) =>
  facts.some((f) => objectText(f).includes(needle.toLowerCase()));

// ─────────────────────────────────────────────────────────────────────────────

export const SCENARIOS = [
  {
    id: "location-supersession",
    what: "A new location replaces the old one rather than accumulating alongside it",
    why: "Single-valued predicates must supersede. This is the core bi-temporal guarantee and the thing the controlled predicate vocabulary exists to protect.",
    characterId: "eval-ronan",
    characterName: "Ronan",
    batches: [
      [
        u("Where are you holed up these days?"),
        a("The safehouse in Sector 4. Three levels underground, and it stays that way."),
      ],
      [
        u("Where are you holed up these days?"),
        a("The safehouse in Sector 4. Three levels underground, and it stays that way."),
        u("I heard you left the city entirely."),
        a("I did. I live in Kaelen now — packed up the safehouse last week and haven't looked back."),
      ],
    ],
    check(q) {
      const live = locationFacts(q.liveFacts("eval-ronan"));
      const all  = locationFacts(q.allFacts("eval-ronan"));
      const superseded = all.filter((f) => f.superseded_by !== null);

      return [
        {
          name: "exactly one live location",
          pass: live.length === 1,
          detail: `${live.length} live location fact(s): ${live.map((f) => `${f.predicate}=${objectText(f)}`).join(", ") || "none"}`,
        },
        {
          name: "the live location is Kaelen",
          pass: live.length === 1 && objectText(live[0]).includes("kaelen"),
          detail: live.length ? objectText(live[0]) : "no live location",
        },
        {
          name: "the old location was superseded, not deleted",
          pass: superseded.length >= 1 && superseded.some((f) => objectText(f).includes("sector 4") || objectText(f).includes("safehouse")),
          detail: `${superseded.length} superseded: ${superseded.map(objectText).join(", ") || "none"}`,
        },
      ];
    },
  },

  {
    id: "entity-id-stability",
    what: "The same entity keeps one id across turns instead of spawning near-duplicates",
    why: "Extraction mints snake_case ids from names. Without stable reuse the graph fragments into kaspar / kaspar_division / the_kaspar_division, which is why the inspector needs a merge tool at all.",
    characterId: "eval-fen",
    characterName: "Fen",
    batches: [
      [
        u("What do you know about the Kaspar Division?"),
        a("Kaspar Division runs security for the upper levels. I've tangled with them twice."),
      ],
      [
        u("What do you know about the Kaspar Division?"),
        a("Kaspar Division runs security for the upper levels. I've tangled with them twice."),
        u("Are they still hunting you?"),
        a("Kaspar Division doesn't forget. They flagged my implant signature months ago."),
      ],
      [
        u("What do you know about the Kaspar Division?"),
        a("Kaspar Division runs security for the upper levels. I've tangled with them twice."),
        u("Are they still hunting you?"),
        a("Kaspar Division doesn't forget. They flagged my implant signature months ago."),
        u("Could you bribe someone inside?"),
        a("Inside Kaspar Division? Their internal audits are worse than their perimeter."),
      ],
    ],
    check(q) {
      const clusters = q.duplicateClusters();
      const kaspar = q.entities().filter((e) => e.name.toLowerCase().includes("kaspar") || e.id.includes("kaspar"));
      return [
        {
          name: "Kaspar Division is a single entity",
          pass: kaspar.length <= 1,
          detail: `${kaspar.length} kaspar entit(ies): ${kaspar.map((e) => e.id).join(", ") || "none"}`,
        },
        {
          name: "no duplicate clusters anywhere in the graph",
          pass: clusters.length === 0,
          detail: clusters.length ? clusters.map((c) => c.join("/")).join(" | ") : "none",
        },
      ];
    },
  },

  {
    id: "stat-direction",
    what: "Relationship stats move in the direction the scene implies",
    why: "Nothing validates the sign of a stat delta. An inverted delta would make characters warm to betrayal, and the bug would be invisible because the number still 'updates'.",
    characterId: "eval-mira",
    characterName: "Mira",
    personaName: "Kira",
    batches: [
      [
        u("I pulled you out of that collapse. You were unconscious for an hour."),
        a("You carried me out? *quiet for a moment* Nobody's done that for me. I owe you more than thanks."),
      ],
    ],
    followUp: {
      // A second, separate batch whose emotional valence is clearly negative
      batches: [
        [
          u("I sold your location to Kaspar. I needed the money."),
          a("*goes very still* You sold me. After the collapse. Get out before I do something we'll both regret."),
        ],
      ],
    },
    check(q, ctx) {
      // character -> player: how Mira feels about the user
      const first  = ctx.snapshots[0]?.stats ?? {};
      const second = q.stats("eval-mira", "player");
      const axis = (s, k) => (s[k] === undefined ? null : s[k]);

      const trustUp   = axis(first, "trust") !== null && axis(first, "trust") > 0;
      const affUp     = axis(first, "affection") !== null && axis(first, "affection") > 0;
      const anyPosFirst = trustUp || affUp;

      // After the betrayal, at least one axis must be below its post-rescue value
      const dropped = Object.keys(second).some(
        (k) => first[k] !== undefined && second[k] < first[k]
      );

      return [
        {
          name: "rescue produced a positive stat change",
          pass: anyPosFirst,
          detail: `after rescue: ${JSON.stringify(first)}`,
        },
        {
          name: "betrayal moved at least one axis down",
          pass: dropped,
          detail: `after betrayal: ${JSON.stringify(second)}`,
        },
      ];
    },
  },

  {
    id: "fact-grounding",
    what: "Extracted facts are grounded in the conversation text",
    why: "A model that invents plausible detail poisons the graph permanently — and because facts are injected into every later prompt, one hallucination compounds across the whole story.",
    characterId: "eval-theron",
    characterName: "Theron",
    batches: [
      [
        u("Tell me about yourself."),
        a("I'm Theron. I keep the lighthouse at Bramble Point, and I've never once left the coast. My sister Elen sends letters from the capital."),
      ],
    ],
    check(q) {
      const facts = q.liveFacts("eval-theron");
      const text = "i'm theron. i keep the lighthouse at bramble point, and i've never once left the coast. my sister elen sends letters from the capital.";

      // Crude grounding signal: every content word of a fact's free-text object
      // should appear in the source. Only literals are checked — an object_id
      // points at a resolved entity whose id carries prefixes ("char-theron")
      // that legitimately never appear in the conversation.
      const ungrounded = facts.filter((f) => {
        if (f.object_id) return false;
        const obj = (f.object_literal ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ");
        const words = obj.split(/\s+/).filter((w) => w.length > 3);
        if (words.length === 0) return false;
        return !words.every((w) => text.includes(w));
      });

      return [
        {
          name: "extracted at least 2 facts",
          pass: facts.length >= 2,
          detail: `${facts.length} facts: ${facts.map((f) => `${f.predicate}=${objectText(f)}`).join("; ")}`,
        },
        {
          name: "captured the lighthouse",
          pass: mentions(facts, "lighthouse") || mentions(facts, "bramble"),
          detail: mentions(facts, "lighthouse") || mentions(facts, "bramble") ? "found" : "missed",
        },
        {
          name: "captured the sister",
          pass: mentions(facts, "elen") || facts.some((f) => f.predicate.includes("sister")),
          detail: mentions(facts, "elen") ? "found" : "missed",
        },
        {
          name: "no ungrounded facts",
          pass: ungrounded.length === 0,
          detail: ungrounded.length ? ungrounded.map((f) => `${f.predicate}=${objectText(f)}`).join("; ") : "all grounded",
        },
      ];
    },
  },

  {
    id: "persona-awareness",
    what: "The active persona names the user in the graph, not 'user'",
    why: "Persona feeds the prompt, the extraction labels, and the player entity. If extraction still says 'the user', facts about you are unattributable.",
    characterId: "eval-ronan-p",
    characterName: "Ronan",
    personaName: "Kira",
    batches: [
      [
        u("I run courier jobs through the lower city. That's how I know the tunnels."),
        a("A courier. That explains the tunnel knowledge — and why you're never where I expect you to be."),
      ],
    ],
    check(q) {
      const player = q.entity("player");
      const facts = q.liveFacts("player");
      const allNames = q.entities().map((e) => e.name.toLowerCase());
      return [
        {
          name: "player entity is named after the persona",
          pass: !!player && player.name === "Kira",
          detail: player ? `player.name = ${player.name}` : "no player entity",
        },
        {
          name: "no entity is literally named 'user'",
          pass: !allNames.includes("user"),
          detail: allNames.join(", "),
        },
        {
          name: "captured a fact about the persona",
          pass: facts.length > 0 || q.allFacts("kira").length > 0,
          detail: `${facts.length} fact(s) with player as subject`,
        },
      ];
    },
  },

  {
    id: "commitment-capture",
    what: "Promises are captured as commitments, surfaced to the character, and resolved",
    why: "The commitments table sat empty for the app's whole life; the longitudinal soak proved a planted deadline was never captured anywhere. Promises are what players most expect to be held onto.",
    characterId: "eval-brann",
    characterName: "Brann",
    personaName: "Kira",
    batches: [
      [
        u("If you get me across the ford by nightfall, I'll pay you double. You have my word."),
        a("*spits in palm, offers hand* Double by nightfall. I'll hold you to that, Kira."),
      ],
    ],
    followUp: {
      batches: [
        [
          u("Here — double, as promised. Count it if you like."),
          a("*weighs the purse without opening it* Paid in full, like you said. That's worth remembering."),
        ],
      ],
    },
    check(q, ctx) {
      // Kira made the promise, so it's filed under the player entity
      const commits = q.commitments("player");
      const afterFirst = ctx.snapshots[0]?.commitments ?? [];
      return [
        {
          name: "the promise was captured as a commitment",
          pass: afterFirst.length >= 1,
          detail: `${afterFirst.length} commitment(s) after act 1: ${afterFirst.map((c) => c.description).join(" | ") || "none"}`,
        },
        {
          name: "active commitments reached Core Memory",
          pass: afterFirst.length === 0 || (ctx.snapshots[0]?.coreCommitments ?? []).length > 0,
          detail: JSON.stringify(ctx.snapshots[0]?.coreCommitments ?? []),
        },
        {
          name: "keeping the promise resolved it",
          pass: commits.some((c) => c.status === "fulfilled"),
          detail: commits.map((c) => `${c.status}: ${c.description}`).join(" | ") || "no commitments",
        },
      ];
    },
  },

  {
    id: "core-memory-rewrite",
    what: "The Drawer 1 rewrite produces usable, bounded state",
    why: "narrative_summary is instructed to accumulate with no cap and is injected into every prompt. Unbounded growth is a slow-burn context leak; empty output means the whole drawer is dead weight.",
    characterId: "eval-sable",
    characterName: "Sable",
    personaName: "Kira",
    refreshCore: true,
    batches: [
      [
        u("The storm's getting worse. We should stay put tonight."),
        a("*bolts the shutter* Agreed. I don't like the idea of being caught on the ridge road in this."),
        u("You seem uneasy. More than the weather warrants."),
        a("*hesitates* Last time I was in weather like this I lost someone. I'd rather not repeat it."),
      ],
    ],
    check(q) {
      const cm = q.coreMemory("eval-sable");
      if (!cm) return [{ name: "core memory exists", pass: false, detail: "no row" }];
      const d = cm.data;
      const summaryLen = (d.narrative_summary ?? "").length;
      return [
        {
          name: "narrative summary was written",
          pass: summaryLen > 40 && d.narrative_summary !== "The story is just beginning.",
          detail: `${summaryLen} chars: ${(d.narrative_summary ?? "").slice(0, 90)}`,
        },
        {
          name: "narrative summary is bounded (<1200 chars)",
          pass: summaryLen < 1200,
          detail: `${summaryLen} chars`,
        },
        {
          name: "internal thoughts populated",
          pass: Array.isArray(d.internal_thoughts) && d.internal_thoughts.length > 0,
          detail: JSON.stringify(d.internal_thoughts ?? null)?.slice(0, 120),
        },
        {
          name: "mood is valid VAD numbers",
          pass: ["valence", "arousal", "dominance"].every(
            (k) => typeof d.mood?.[k] === "number" && Number.isFinite(d.mood[k])
          ),
          detail: JSON.stringify(d.mood),
        },
        {
          name: "mood reflects a somber scene (valence <= 0.3)",
          pass: typeof d.mood?.valence === "number" && d.mood.valence <= 0.3,
          detail: `valence = ${d.mood?.valence}`,
        },
      ];
    },
  },
];
