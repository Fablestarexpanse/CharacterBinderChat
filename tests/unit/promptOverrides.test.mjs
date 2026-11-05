// Prompt overrides on a real database: saved after a check, used by the
// builders' callers, refused when broken, and ignored if they go bad later.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fable-prompts-"));
process.env.FABLE_DB_PATH = path.join(dir, "t.db");
const { getStore } = await import("../../lib/db/index.ts");
const P = await import("../../lib/server/prompts.ts");
const { promptDef } = await import("../../lib/prompts/defaults.ts");

test("no override: the default is used and nothing is marked edited", () => {
  assert.equal(P.promptTemplate("memory.reflection"), promptDef("memory.reflection").template);
  assert.deepEqual(P.editedPromptIds(), []);
});

test("a valid override is stored and used; reset brings the default back", () => {
  const check = P.setPromptOverride("memory.reflection", "Think about {{user_label}}:\n{{facts}}");
  assert.ok(check.ok);
  assert.ok(check.warnings.length > 0, "unused optional variables are reported");
  assert.equal(P.promptTemplate("memory.reflection"), "Think about {{user_label}}:\n{{facts}}");
  assert.deepEqual(P.editedPromptIds(), ["memory.reflection"]);
  P.clearPromptOverride("memory.reflection");
  assert.equal(P.promptTemplate("memory.reflection"), promptDef("memory.reflection").template);
});

test("a broken override is refused and nothing is stored", () => {
  const check = P.setPromptOverride("memory.extraction", "Extract {{things}}");
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((e) => e.includes("{{things}}")));
  assert.ok(check.errors.some((e) => e.includes("{{conversation}}")));
  assert.equal(getStore().getKv("prompt:memory.extraction"), null);
});

test("saving the default text verbatim stores no override", () => {
  P.setPromptOverride("memory.episode", promptDef("memory.episode").template);
  assert.equal(getStore().getKv("prompt:memory.episode"), null);
});

test("an override that later goes bad falls back to the default and says so", () => {
  getStore().setKv("prompt:memory.reflection", JSON.stringify("Old variable {{removed_in_a_release}} {{facts}}"));
  assert.equal(P.promptTemplate("memory.reflection"), promptDef("memory.reflection").template);
  const entry = P.listPrompts().find((p) => p.id === "memory.reflection");
  assert.equal(entry.overrideInvalid, true);
  assert.deepEqual(P.editedPromptIds(), []);
});
