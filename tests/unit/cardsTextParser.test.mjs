// Ported from CharacterBinder (src/shared/cardTextParser.test.ts) via the vitest shim.
import { describe, it, expect } from "./_vitest.mjs";
import { parseCardText, isSeparatorLine, toCharacterFields } from "../../lib/cards/textParser.ts";

/**
 * The parser's job is to move an author's own words into the right fields
 * without losing any of them. Most of these cases come from real card formats
 * seen in the wild — JanitorAI paragraph dumps, hand-written section headings,
 * W++ attribute lists, and JSON exports.
 */

describe("labelled sections", () => {
  it("splits on `Label:` lines and keeps unrecognised sections in description", () => {
    const r = parseCardText(`Name: Mira Voss
Age: 27
Gender: Female
Appearance: Short, freckled, copper hair usually in a messy bun.
Personality: Anxious but curious. Talks fast when excited.
Background: Grew up in a lighthouse town. Studied marine biology.
Likes: Tide pools, bad horror movies
Tags: human, scientist, anxious`);

    expect(r.method).toBe("labelled");
    expect(r.fields.name).toBe("Mira Voss");
    expect(r.fields.appearance).toContain("copper hair");
    expect(r.fields.personality).toContain("Anxious but curious");
    expect(r.fields.background).toContain("lighthouse town");
    expect(r.tags).toEqual(["human", "scientist", "anxious"]);

    // Age / Gender / Likes have no home field, so they must survive in description.
    expect(r.fields.description).toContain("Age: 27");
    expect(r.fields.description).toContain("Gender: Female");
    expect(r.fields.description).toContain("Likes: Tide pools");
  });

  it("reads markdown headings", () => {
    const r = parseCardText(`## Name
Dr. Elias Thorn

## Appearance
Tall and gaunt, silver beard.

## Personality
Patient, pedantic, secretly warm.`);

    expect(r.method).toBe("labelled");
    expect(r.fields.name).toBe("Dr. Elias Thorn");
    expect(r.fields.appearance).toBe("Tall and gaunt, silver beard.");
    expect(r.fields.personality).toBe("Patient, pedantic, secretly warm.");
  });

  it("reads bare headings sitting alone above their paragraphs", () => {
    // The most common hand-written shape, and the one that regressed before:
    // no colon, no markdown, just the word on its own line.
    const r = parseCardText(`Name: Kael Mercer

⸻

Appearance

Tall and athletic, with sleek dark ears and amber eyes.

⸻

Personality

Brilliant without being arrogant. His humor is dry.`);

    expect(r.method).toBe("labelled");
    expect(r.fields.name).toBe("Kael Mercer");
    expect(r.fields.appearance).toContain("amber eyes");
    expect(r.fields.personality).toContain("Brilliant without being arrogant");
  });

  it("strips divider rules instead of embedding them in a field", () => {
    const r = parseCardText(`Name: Test

⸻

Appearance

Tall.

---

Personality

Kind.`);
    expect(r.fields.appearance).toBe("Tall.");
    expect(r.fields.appearance).not.toContain("⸻");
    expect(r.fields.personality).not.toContain("---");
  });

  it("merges several sections into one field, keeping their own labels", () => {
    const r = parseCardText(`Name: Test

Personality

Brilliant but impatient.

Habits

* Drinks too much coffee.

Interests

* Rock climbing`);

    expect(r.fields.personality).toContain("Brilliant but impatient");
    // Sub-labels are preserved so the merged field stays readable.
    expect(r.fields.personality).toContain("Habits:");
    expect(r.fields.personality).toContain("Interests:");
    expect(r.fields.personality).toContain("Drinks too much coffee");
    expect(r.fields.personality).toContain("Rock climbing");
  });

  it("does not mistake a bulleted list item for a heading", () => {
    // "* Philosophy" would match the `background`-ish vocabulary if bullets
    // were treated as headings.
    const r = parseCardText(`Name: Test

Interests

* Philosophy
* Story
* History`);
    expect(r.fields.personality).toContain("Philosophy");
    expect(r.fields.personality).toContain("History");
  });

  it("loses no content from a full real-world card", () => {
    const src = `Name: Dr. Kael Mercer

Age: 28

Occupation: Theoretical Physicist

⸻

Appearance

At 6'5", Kael has a presence that draws attention. Tall and athletic.

His eyes are amber-gold, sharp and intelligent.

⸻

Personality

Brilliant without being arrogant.

His humor is dry and delivered straight-faced.

⸻

Habits

* Ears twitch when concentrating.
* Drinks far too much coffee.

⸻

Reputation

Known as the professor who makes impossible concepts understandable.`;

    const r = parseCardText(src);
    const all = Object.values(r.fields).join("\n");

    const lost = src
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !isSeparatorLine(l) && l.length > 3)
      .map((l) => l.replace(/^[*-]\s*/, "").trim())
      // Heading lines are consumed as labels; their content is what must survive.
      .filter((l) => !/^(Name:|Occupation:|Appearance|Personality|Habits|Reputation)/.test(l))
      .filter((l) => !all.includes(l));

    expect(lost).toEqual([]);
  });
});

describe("unstructured prose", () => {
  it("sorts paragraphs by what they talk about", () => {
    const r = parseCardText(`Kael Ardent

Kael is a wiry man in his early thirties with black hair he keeps tied back and sharp grey eyes. He wears a patched leather coat two sizes too big.

He's blunt to the point of rudeness and enjoys needling people he likes. Underneath it he's fiercely loyal and protective. He hates being thanked.

Born in the river district of Anvale, he grew up running errands for smugglers before the guild took him in at fifteen.`);

    expect(r.method).toBe("prose");
    expect(r.fields.name).toBe("Kael Ardent");
    expect(r.fields.appearance).toContain("wiry man");
    expect(r.fields.personality).toContain("blunt to the point of rudeness");
    expect(r.fields.background).toContain("river district of Anvale");
  });

  it("falls back to sentence-level sorting for one solid block", () => {
    const r = parseCardText(
      `Rowan is a broad-shouldered woman with cropped auburn hair and a burn scar across her left forearm. She is stubborn, loyal, and has almost no patience for small talk. She was raised by her grandmother in a fishing village and worked the docks from the age of twelve.`
    );

    expect(r.method).toBe("prose");
    expect(r.fields.appearance).toContain("auburn hair");
    expect(r.fields.personality).toContain("stubborn");
    expect(r.fields.background).toContain("fishing village");
  });

  it("does not treat prose starting with a section word as a heading", () => {
    // Regression guard: "History repeats itself" must not open a background section.
    const r = parseCardText(`History repeats itself, or so he claims.

He is a cheerful, talkative man who enjoys company and hates silence. Friendly to a fault.`);

    expect(r.method).toBe("prose");
    expect(r.fields.description).toContain("History repeats itself");
  });

  it("requires a clear winner before moving a chunk off description", () => {
    // A single stray keyword shouldn't be enough to reassign a paragraph.
    const r = parseCardText(`Someone entirely unremarkable.

They own a hat.`);
    expect(r.method).toBe("prose");
    expect(r.fields.description).toBeTruthy();
  });
});

describe("machine formats", () => {
  it("reads W++ attribute lists", () => {
    const r = parseCardText(`Name("Sable")
Appearance("tall" + "black hair" + "amber eyes")
Personality("aloof" + "witty" + "protective")
Likes("rain" + "old books")`);

    expect(r.method).toBe("wpp");
    expect(r.fields.name).toBe("Sable");
    expect(r.fields.appearance).toBe("tall, black hair, amber eyes");
    expect(r.fields.personality).toBe("aloof, witty, protective");
    expect(r.fields.description).toContain("Likes: rain, old books");
  });

  it("reads JSON exports and keeps unmapped keys", () => {
    const r = parseCardText(
      JSON.stringify({
        name: "Juniper",
        description: "A travelling herbalist.",
        personality: "Gentle, observant, stubborn.",
        appearance: "Freckled, sun-worn.",
        age: 34,
        tags: ["herbalist", "traveller"],
      })
    );

    expect(r.method).toBe("json");
    expect(r.fields.name).toBe("Juniper");
    expect(r.fields.personality).toBe("Gentle, observant, stubborn.");
    expect(r.tags).toEqual(["herbalist", "traveller"]);
    expect(r.fields.description).toContain("Age: 34");
  });

  it("flattens Tavern V2 `data` nesting", () => {
    const r = parseCardText(
      JSON.stringify({ spec: "chara_card_v2", data: { name: "Nested", personality: "Calm" } })
    );
    expect(r.method).toBe("json");
    expect(r.fields.name).toBe("Nested");
    expect(r.fields.personality).toBe("Calm");
  });

  it("does not mistake prose containing parentheses for W++", () => {
    // Regression: the block pattern matched any `word(...)`, so English
    // parentheticals were read as attributes — and because the W++ strategy
    // builds its result only from matches, the rest of the paste was discarded.
    const src = `Kael Ardent

He works (nights) at the docks (usually) hauling crates for the shipping guild.

She whispered "run" + "now" was all he heard before the lights went out.

He is stubborn, loyal, and hates being thanked for anything at all.`;

    const r = parseCardText(src);
    expect(r.method).not.toBe("wpp");

    // Nothing may be lost, whichever strategy claims it.
    const all = Object.values(r.fields).join("\n");
    expect(all).toContain("hauling crates");
    expect(all).toContain("before the lights went out");
    expect(all).toContain("hates being thanked");
  });

  it("keeps parentheses that live inside a quoted W++ value", () => {
    const r = parseCardText(`Name("Sable")
Personality("kind (mostly)" + "shy" + "loyal")
Appearance("tall" + "amber eyes")`);

    expect(r.method).toBe("wpp");
    expect(r.fields.personality).toBe("kind (mostly), shy, loyal");
  });

  it("keeps arrays and nested objects from a JSON card", () => {
    // Regression: objects stringified to "" and the leftovers branch accepted
    // only scalars, so greetings, lorebooks and extensions vanished silently.
    const r = parseCardText(
      JSON.stringify({
        name: "Rook",
        description: "A dockhand.",
        alternate_greetings: ["Hey there.", "Well, look who it is."],
        character_book: { name: "Docks", entries: [{ keys: ["wharf"], content: "Built on stilts." }] },
        extensions: { depth_prompt: { depth: 4, prompt: "Stay terse." } },
      })
    );

    expect(r.method).toBe("json");
    const all = Object.values(r.fields).join("\n");
    expect(all).toContain("Well, look who it is.");
    expect(all).toContain("Built on stilts.");
    expect(all).toContain("Stay terse.");
  });

  it("does not treat malformed JSON as JSON", () => {
    const r = parseCardText(`{ this is not json, it is just prose that starts with a brace`);
    expect(r.method).not.toBe("json");
  });
});

describe("character card mapping", () => {
  it("does not treat {{char}}: / {{user}}: dialogue lines as headings", () => {
    // {{char}} normalises to "char", which is a Name alias — without a guard
    // every line of an example exchange opens a new Name section.
    const r = parseCardText(`Name: Rook
Personality: Curt but not unkind.
Example Dialogs: {{user}}: Why here?
{{char}}: Because nobody looks up.
{{user}}: Fair.
{{char}}: Usually.`);

    expect(r.fields.name).toBe("Rook");
    expect(r.fields.mes_example).toContain("{{char}}: Because nobody looks up.");
    expect(r.fields.mes_example).toContain("{{user}}: Fair.");
  });

  it("recognises scenario, greeting, and example-dialogue labels", () => {
    const r = parseCardText(`Name: Rook
Scenario: A rain-soaked rooftop above the market district.
First Message: "You're late." *He doesn't look up.*
Example Dialogs: {{user}}: Why here?
{{char}}: Because nobody looks up.`);

    expect(r.method).toBe("labelled");
    const c = toCharacterFields(r);
    expect(c.name).toBe("Rook");
    expect(c.scenario).toContain("rooftop");
    expect(c.first_mes).toContain("You're late");
    expect(c.mes_example).toContain("nobody looks up");
  });

  it("folds appearance and background into description, keeping their labels", () => {
    const r = parseCardText(`Name: Rook

Appearance

Lean, weather-beaten, always in a salt-stained coat.

Personality

Curt but not unkind.

Background

Grew up on the docks.`);

    const c = toCharacterFields(r);
    expect(c.personality).toBe("Curt but not unkind.");
    // No appearance/background fields exist on a character card…
    expect(c).not.toHaveProperty("appearance");
    expect(c).not.toHaveProperty("background");
    // …so that text has to survive inside description, labelled.
    expect(c.description).toContain("Appearance:");
    expect(c.description).toContain("salt-stained coat");
    expect(c.description).toContain("Background:");
    expect(c.description).toContain("docks");
  });

  it("keeps an existing description above the folded sections", () => {
    const r = parseCardText(`Name: Rook
Description: A dockhand who notices too much.
Appearance: Lean and weather-beaten.
Background: Grew up on the docks.`);

    const c = toCharacterFields(r);
    expect(c.description?.indexOf("notices too much")).toBeLessThan(
      c.description?.indexOf("Appearance:") ?? Infinity
    );
  });

  it("maps JanitorAI JSON keys onto character fields", () => {
    const r = parseCardText(
      JSON.stringify({ name: "Rook", persona: "A dockhand.", world: "The docks.", greeting: "You're late." })
    );
    const c = toCharacterFields(r);
    expect(c.name).toBe("Rook");
    expect(c.description).toContain("A dockhand.");
    expect(c.scenario).toBe("The docks.");
    expect(c.first_mes).toBe("You're late.");
  });
});

describe("edge cases", () => {
  it("reports empty input rather than throwing", () => {
    expect(parseCardText("").method).toBe("empty");
    expect(parseCardText("   \n  ").method).toBe("empty");
  });

  it("needs at least two recognised labels before trusting structure", () => {
    // One lone label is not enough signal; this should fall through to prose.
    const r = parseCardText(`Appearance: tall

and then some further rambling text that carries on for a while.`);
    expect(r.method).toBe("prose");
  });

  it("recognises divider lines", () => {
    expect(isSeparatorLine("⸻")).toBe(true);
    expect(isSeparatorLine("---")).toBe(true);
    expect(isSeparatorLine("***")).toBe(true);
    expect(isSeparatorLine("═══")).toBe(true);
    expect(isSeparatorLine("Appearance")).toBe(false);
    expect(isSeparatorLine("* a bullet")).toBe(false);
  });
});

describe("W++ keeps the text around the attribute blocks", () => {
  const wpp = `Kael is a physicist who never sleeps.

[character("Kael")
{
Age("28")
Personality("blunt" + "curious")
Appearance("wiry" + "ink-stained")
Body("tall" + "lean")
Likes("coffee" + "silence")
}]

He was last seen in Anvale.`;

  it("reads the attributes", () => {
    const parsed = parseCardText(wpp);
    expect(parsed.method).toBe("wpp");
    expect(parsed.fields.personality).toContain("blunt");
    expect(parsed.fields.appearance).toContain("wiry");
  });

  it("keeps the prose outside the blocks, rather than dropping it", () => {
    // The parser's promise is that nothing is ever dropped; this strategy used
    // to discard everything outside the attribute blocks.
    const parsed = parseCardText(wpp);
    const all = Object.values(parsed.fields).join("\n");
    expect(all).toContain("never sleeps");
    expect(all).toContain("Anvale");
  });

  it("says it kept the surrounding text", () => {
    expect(parseCardText(wpp).notes.join(" ")).toMatch(/outside the attribute blocks/i);
  });
});
