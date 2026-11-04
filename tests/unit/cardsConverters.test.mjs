// Ported from CharacterBinder (src/shared/platforms/converters.test.ts) via the vitest shim.
import { describe, it, expect } from "./_vitest.mjs";
import { convertCardTo, convertCardFrom } from "../../lib/cards/convert.ts";
import { PLATFORMS, detectPlatform } from "../../lib/cards/platforms.ts";
import { createBlankCard as createBlankTavernCard } from "../../lib/cards/tavern.ts";
import { validateTavernCardV2 } from "../../lib/cards/validate.ts";

/**
 * These converters decide which of the user's fields survive an export, and the
 * same support table drives the "fields lost" count shown in the UI — so a
 * mismatch between the two doesn't just lose data, it lies about losing it.
 */

function fullCard() {
  const card = createBlankTavernCard("Rook");
  card.data = {
    ...card.data,
    description: "A dockhand who notices too much.",
    personality: "Curt but not unkind.",
    scenario: "{{char}} waits on a rain-soaked rooftop.",
    first_mes: "{{char}} doesn't look up. \"You're late.\"",
    mes_example: "{{user}}: Why here?\n{{char}}: Nobody looks up.",
    system_prompt: "Stay terse.",
    post_history_instructions: "Never break character.",
    alternate_greetings: ["Still here, then.", "Took your time."],
    tags: ["dockhand", "noir"],
    creator: "Fablestar",
    creator_notes: "Pairs well with the Anvale lorebook.",
    character_version: "2.5",
  };
  return card;
}

const ALL = ["sillytavern", "janitorai", "chub", "agnai", "venus", "backyard", "risu", "generic"];

describe("export never throws", () => {
  it.each(ALL)("converts a full card to %s", (platform) => {
    expect(() => convertCardTo(fullCard(), platform)).not.toThrow();
  });

  it.each(ALL)("converts a *slim* v2 card to %s", (platform) => {
    // Regression: convertCardFrom's v2 fast path returned the object unchanged,
    // so a third-party card with a partial data block produced undefined string
    // fields and the next converter threw "Cannot read properties of undefined".
    const slim = convertCardFrom(
      { spec: "chara_card_v2", spec_version: "2.0", data: { name: "Rook", personality: "P" } },
      "sillytavern"
    );
    expect(() => convertCardTo(slim, platform)).not.toThrow();
  });
});

describe("convertCardFrom normalises", () => {
  it("fills every required field from a partial v2 card", () => {
    const card = convertCardFrom(
      { spec: "chara_card_v2", spec_version: "2.0", data: { name: "Rook" } },
      "sillytavern"
    );
    // Whatever comes back must be safe to hand to any converter or the UI.
    for (const key of ["description", "personality", "scenario", "first_mes", "mes_example"]) {
      expect(typeof card.data[key]).toBe("string");
    }
    expect(Array.isArray(card.data.tags)).toBe(true);
    expect(Array.isArray(card.data.alternate_greetings)).toBe(true);
  });
});

describe("the support table matches what is actually written", () => {
  // A field the table calls "full", "partial" or "renamed" must appear in the
  // exported payload somewhere. Only "none" may be absent.
  /**
   * Compare on content, not on exact bytes: JSON.stringify escapes newlines,
   * and some platforms deliberately rewrite {{char}} to their own placeholder.
   * Neither is data loss, so neither should fail this check.
   */
  const normalise = (s) =>
    s
      .replace(/\\n/g, " ")
      .replace(/\{\{(char|bot|user)\}\}/g, "")
      .replace(/[\\"]/g, "") // JSON escaping of embedded quotes
      .replace(/\s+/g, " ")
      .trim();

  it.each(ALL)("%s writes every field it claims to keep", (platformId) => {
    const platform = PLATFORMS[platformId];
    const out = normalise(JSON.stringify(convertCardTo(fullCard(), platformId)));

    const claimed = platform.fields.filter((f) => f.support !== "none");
    const missing = claimed.filter((f) => {
      const value = fullCard().data[f.field];
      if (typeof value === "string") {
        const needle = normalise(value).slice(0, 24);
        return needle.length > 3 && !out.includes(needle);
      }
      if (Array.isArray(value)) {
        return value.length > 0 && !out.includes(normalise(String(value[0])));
      }
      return false;
    });

    expect(missing.map((m) => m.label)).toEqual([]);
  });
});

describe("round trips", () => {
  it("JanitorAI leaves no stale placeholders in either direction", () => {
    // Regression: {{char}}→{{bot}} was applied to some fields and not others,
    // so a round trip left literal {{bot}} sitting in the description.
    const exported = JSON.stringify(convertCardTo(fullCard(), "janitorai"));
    expect(exported).not.toContain("{{char}}");

    const back = convertCardFrom(JSON.parse(exported), "janitorai");
    const reimported = JSON.stringify(back.data);
    expect(reimported).not.toContain("{{bot}}");
  });

  it("Generic preserves character_version", () => {
    // Regression: export wrote `version`, import read neither `version` nor
    // `character_version`, so 2.5 came back as the default.
    const exported = convertCardTo(fullCard(), "generic");
    const back = convertCardFrom(exported, "generic");
    expect(back.data.character_version).toBe("2.5");
  });

  it("SillyTavern is lossless", () => {
    const original = fullCard();
    const back = convertCardFrom(convertCardTo(original, "sillytavern"), "sillytavern");
    expect(back.data).toEqual(original.data);
  });

  it("does not alias the live card", () => {
    const original = fullCard();
    const exported = convertCardTo(original, "sillytavern");
    exported.data.name = "Mutated";
    expect(original.data.name).toBe("Rook");
  });
});

describe("validator", () => {
  it("accepts a well-formed card", () => {
    const r = validateTavernCardV2(fullCard());
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("does not throw on a card with no data block", () => {
    // Regression: this used to throw reading .name of undefined.
    const r = validateTavernCardV2({ spec: "chara_card_v2", spec_version: "2.0" });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/data/i);
  });

  it("rejects wrong types that used to pass", () => {
    const card = fullCard();
    (card.data).tags = "not-an-array";
    (card.data).alternate_greetings = "nope";
    const r = validateTavernCardV2(card);
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toContain("'tags' must be an array");
    expect(r.errors.join(" ")).toContain("'alternate_greetings' must be an array");
  });

  it("rejects a non-string in a string field", () => {
    const card = fullCard();
    (card.data).personality = 42;
    expect(validateTavernCardV2(card).errors.join(" ")).toContain("'personality' must be a string");
  });

  it("checks an attached lorebook", () => {
    const card = fullCard();
    card.data.character_book = { entries: [{ keys: "wharf", content: "x" }] };
    const r = validateTavernCardV2(card);
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/keys' must be an array/);
  });

  it("warns about an entry that can never fire", () => {
    const card = fullCard();
    card.data.character_book = { entries: [{ keys: [], content: "x" }] };
    const r = validateTavernCardV2(card);
    expect(r.warnings.join(" ")).toMatch(/no trigger keys/);
  });
});

describe("chara_card_v3 import", () => {
  it("reads a v3 card's data block instead of importing it blank", () => {
    const v3 = {
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        name: "Wren",
        description: "A lamplighter.",
        personality: "dry",
        first_mes: "Evening.",
        // v3-only, and not something this app carries.
        group_only_greetings: ["hi all"],
      },
    };
    const card = convertCardFrom(v3, "sillytavern");
    expect(card.spec).toBe("chara_card_v2");
    expect(card.data.name).toBe("Wren");
    expect(card.data.description).toBe("A lamplighter.");
    expect(card.data.personality).toBe("dry");
    expect(card.data.first_mes).toBe("Evening.");
  });
});

describe("detectPlatform", () => {
  const v2 = (extensions = {}) => ({
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: { name: "Rook", description: "A dockhand.", extensions },
  });

  it("reads a v2 card's extensions to tell the v2-shaped platforms apart", () => {
    expect(detectPlatform(v2({ risuai: { assets: [] } }))).toBe("risu");
    expect(detectPlatform(v2({ chub: { id: 7 } }))).toBe("chub");
    expect(detectPlatform(v2())).toBe("sillytavern");
  });

  it("recognises each platform's own field names", () => {
    expect(detectPlatform({ kind: "character", persona: "p", sampleChat: "" })).toBe("agnai");
    expect(detectPlatform({ persona: "p", greeting: "hi" })).toBe("janitorai");
    expect(detectPlatform({ aiName: "Rook" })).toBe("backyard");
    expect(detectPlatform({ basePrompt: "..." })).toBe("backyard");
    expect(detectPlatform({ initialMessage: "hi" })).toBe("backyard");
    expect(detectPlatform({ name: "Rook", description: "d", first_mes: "hi" })).toBe("venus");
  });

  it("prefers the more specific clause when a payload matches two", () => {
    // A JanitorAI export also carries name/description, which is Venus's tell —
    // this pins the clause order that keeps it a JanitorAI card.
    expect(
      detectPlatform({ name: "Rook", description: "d", persona: "p", greeting: "hi", first_mes: "hi" })
    ).toBe("janitorai");
    // Agnai's payload also has `persona`, which is JanitorAI's tell.
    expect(
      detectPlatform({ kind: "character", persona: "p", sampleChat: "", greeting: "hi" })
    ).toBe("agnai");
  });

  it("falls back to generic for anything it cannot place", () => {
    expect(detectPlatform({ hello: "world" })).toBe("generic");
    expect(detectPlatform(null)).toBe("generic");
    expect(detectPlatform("not an object")).toBe("generic");
  });
});

describe("the support table does not understate what is written", () => {
  // The inverse of the check above: a field marked "none" must actually be
  // absent, or the panel is warning about a loss that does not happen.
  it.each(ALL)("%s drops every field it says it drops", (platformId) => {
    const platform = PLATFORMS[platformId];
    const out = JSON.stringify(convertCardTo(fullCard(), platformId));

    const kept = platform.fields
      .filter((f) => f.support === "none")
      .filter((f) => {
        const value = fullCard().data[f.field];
        return typeof value === "string" && value.length > 3 && out.includes(value.slice(0, 24));
      });

    expect(kept.map((k) => k.label)).toEqual([]);
  });
});
