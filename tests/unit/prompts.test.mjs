// The prompt library: shipped defaults render exactly what the hard-coded
// builders used to, templates are checked before use, and overrides apply.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const F = await import("./fixtures/prompt-inputs.mjs");
const WANT = JSON.parse(fs.readFileSync(new URL("./fixtures/prompt-defaults.json", import.meta.url), "utf8"));
const { buildExtractionPrompt } = await import("../../lib/server/extractionPrompt.ts");
const { buildRewritePrompt } = await import("../../lib/server/memoryRewriter.ts");
const { episodePrompt, reflectPrompt } = await import("../../lib/server/episodePrompts.ts");
const { buildDirectorMessages } = await import("../../lib/server/scenePrompt.ts");
const { PROMPTS, promptDef } = await import("../../lib/prompts/defaults.ts");
const { renderTemplate, checkTemplate, usedVariables } = await import("../../lib/prompts/render.ts");

test("every shipped default renders byte for byte what its old builder produced", () => {
  for (const f of F.extraction) assert.equal(buildExtractionPrompt(f.input), WANT.extraction[f.name], `extraction: ${f.name}`);
  for (const f of F.rewrite) assert.equal(buildRewritePrompt(...f.args), WANT.rewrite[f.name], `rewrite: ${f.name}`);
  for (const f of F.episode) assert.equal(episodePrompt(...f.args), WANT.episode[f.name], `episode: ${f.name}`);
  for (const f of F.reflect) assert.equal(reflectPrompt(...f.args), WANT.reflect[f.name], `reflect: ${f.name}`);
  for (const f of F.director) assert.deepEqual(buildDirectorMessages(f.input), WANT.director[f.name], `director: ${f.name}`);
});

test("each default uses exactly the variables it declares, and passes its own check", () => {
  for (const def of PROMPTS) {
    assert.deepEqual(usedVariables(def.template).sort(), def.variables.map((v) => v.name).sort(), def.id);
    const check = checkTemplate(def.template, def.variables);
    assert.ok(check.ok, `${def.id}: ${check.errors.join("; ")}`);
    assert.equal(check.warnings.length, 0, def.id);
  }
});

test("a template is refused for unknown or missing required variables, and an empty one", () => {
  const vars = promptDef("memory.reflection").variables;
  const unknown = checkTemplate("{{facts}} {{mood}}", vars);
  assert.equal(unknown.ok, false);
  assert.match(unknown.errors.join(" "), /\{\{mood\}\} is not a variable/);
  assert.match(checkTemplate("Just think about {{user_label}}.", vars).errors.join(" "), /\{\{facts\}\} is required/);
  assert.equal(checkTemplate("   ", vars).ok, false);
  const fine = checkTemplate("Facts: {{facts}}", vars);
  assert.ok(fine.ok);
  assert.ok(fine.warnings.some((w) => w.includes("{{episodes}}")), "an unused optional variable is only a warning");
});

test("rendering fills variables, accepts {{char}}/{{user}}, and leaves unknown braces alone", () => {
  assert.equal(renderTemplate("{{ character_name }} and {{user}} at {{x}}", { character_name: "Ronan", user_label: "Kira" }), "Ronan and Kira at {{x}}");
  assert.equal(renderTemplate("{{char}}", { character_name: "Ronan" }), "Ronan");
  assert.deepEqual(usedVariables("{{char}} {{character_name}} {{facts}}"), ["character_name", "facts"]);
  assert.equal(renderTemplate('{"a": {"b": 1}}', {}), '{"a": {"b": 1}}', "JSON braces in a prompt are not slots");
});

test("an override replaces the text wherever the prompt is built", () => {
  const t = "Remember for {{character_name}}:\n{{conversation}}";
  const out = buildExtractionPrompt(F.extraction[0].input, t);
  assert.equal(out, "Remember for Ronan:\nRonan: You're late.\n\nKira: Checkpoint was locked down.");
  assert.equal(episodePrompt("c", "Ronan", "Kira", [], "{{user_label}} / {{conversation}}"), "Kira / c");
  const [sys, user] = buildDirectorMessages(F.director[1].input, { system: "SYS", request: "Shot: {{excerpt}}" });
  assert.deepEqual([sys.content, user.content], ["SYS", "Shot: user: Look."]);
});

test("the line diff shows what changed, with context and gaps", async () => {
  const { lineDiff, diffHunks } = await import("../../lib/prompts/diff.ts");
  const before = ["a", "b", "c", "d", "e", "f", "g", "h"].join("\n");
  const after = ["a", "B", "c", "d", "e", "f", "g", "h", "i"].join("\n");
  const d = lineDiff(before, after);
  assert.deepEqual(d.filter((l) => l.kind !== "same"), [{ kind: "del", text: "b" }, { kind: "add", text: "B" }, { kind: "add", text: "i" }]);
  const h = diffHunks(d, 1);
  assert.ok(h.includes(null), "unchanged middle collapses to a gap");
  assert.deepEqual(diffHunks(lineDiff("same", "same")), [], "no change, no hunks");
});
